import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { engineConfiguration } from './engine-config.mjs';
import { inspectClamd } from './clamd.mjs';
import { createScannerServer, scannerConfig } from './server.mjs';

export function containerConfiguration(env = process.env) {
  if (env.TITLE_SCANNER_TRANSPORT !== 'cloudflare-private-http' || env.TITLE_SCANNER_HOST !== '0.0.0.0' ||
      env.TITLE_SCANNER_PORT !== '8080') throw new Error('invalid_container_configuration');
  return scannerConfig({ ...env, CLAMD_SOCKET: '/run/title-scanner/clamd.sock' });
}

/** Foreground supervisor: no daemon/customer output reaches container logging. */
export async function runContainer(env = process.env) {
  const config = containerConfiguration(env);
  process.umask(0o077);
  const runtime = '/run/title-scanner', database = '/var/lib/clamav', temporary = `${runtime}/tmp`;
  const childEnv = { PATH: process.env.PATH, TZ: 'UTC' };
  const children = new Set();
  let server, stopped = false, updateTimer;
  const shutdown = async (exitCode) => {
    if (stopped) return;
    stopped = true; clearTimeout(updateTimer);
    server?.closeAllConnections(); server?.close();
    for (const child of children) child.kill('SIGTERM');
    await Promise.race([Promise.all([...children].map(child => new Promise(resolve => child.once('exit', resolve)))),
      new Promise(resolve => setTimeout(resolve, 5000))]);
    for (const child of children) child.kill('SIGKILL');
    await rm(temporary, { recursive: true, force: true });
    process.exit(exitCode);
  };
  const child = (binary, args) => {
    const task = spawn(binary, args, { stdio: 'ignore', env: childEnv });
    children.add(task);
    task.once('exit', () => children.delete(task));
    return task;
  };
  const update = () => new Promise((resolve, reject) => {
    const task = child('freshclam', [`--config-file=${runtime}/freshclam.conf`]);
    const timer = setTimeout(() => { task.kill('SIGKILL'); reject(new Error('signature_update_failed')); }, 180000);
    task.once('error', () => { clearTimeout(timer); reject(new Error('signature_update_failed')); });
    task.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('signature_update_failed')); });
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void shutdown(0); });
  try {
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    await mkdir(database, { recursive: true, mode: 0o700 });
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { mode: 0o700 });
    // Trust the platform's runtime HTTPS egress proxy without disabling origin certificate verification.
    // Freshclam officially supports CURL_CA_BUNDLE on Linux; no root trust-store modification is needed.
    try {
      const platformCA = await readFile('/etc/cloudflare/certs/cloudflare-containers-ca.crt');
      const systemCA = await readFile('/etc/ssl/certs/ca-certificates.crt');
      await writeFile(`${runtime}/egress-ca.pem`, Buffer.concat([systemCA, Buffer.from('\n'), platformCA]), { mode: 0o600 });
      childEnv.CURL_CA_BUNDLE = `${runtime}/egress-ca.pem`;
    } catch (error) {
      if (env.TITLE_SCANNER_REQUIRE_PLATFORM_CA === 'true' || error.code !== 'ENOENT') throw new Error('platform_ca_unavailable');
    }
    await writeFile(`${runtime}/clamd.conf`, engineConfiguration({ databaseDirectory: database,
      socketPath: config.socketPath, temporaryDirectory: temporary }), { mode: 0o600 });
    await writeFile(`${runtime}/freshclam.conf`, `DatabaseDirectory ${database}\nDatabaseOwner clamav\nDatabaseMirror database.clamav.net\nConnectTimeout 10\nReceiveTimeout 60\nMaxAttempts 1\nTestDatabases yes\nNotifyClamd ${runtime}/clamd.conf\n`, { mode: 0o600 });
    await update();
    const daemon = child('clamd', ['--foreground', `--config-file=${runtime}/clamd.conf`, '--fail-if-cvd-older-than=3']);
    daemon.once('error', () => { void shutdown(1); });
    daemon.once('exit', () => { if (!stopped) void shutdown(1); });
    const readyUntil = Date.now() + 180000;
    for (;;) {
      if (stopped) return;
      try { await inspectClamd(config, AbortSignal.timeout(2000)); break; }
      catch { if (Date.now() >= readyUntil) throw new Error('engine_start_failed'); }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    server = createScannerServer(config);
    server.once('error', () => { void shutdown(1); });
    await new Promise(resolve => server.listen(config.port, config.host, resolve));
    process.stdout.write('{"event":"scanner_ready"}\n');
    const refresh = async () => {
      try { await update(); process.stdout.write('{"event":"signature_update_ok"}\n'); }
      catch { process.stderr.write('{"event":"signature_update_failed"}\n'); }
      if (!stopped) updateTimer = setTimeout(refresh, 6 * 3600000);
    };
    updateTimer = setTimeout(refresh, 6 * 3600000);
  } catch {
    process.stderr.write('{"event":"scanner_start_failed"}\n');
    await shutdown(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runContainer().catch(() => { process.stderr.write('{"event":"invalid_container_configuration"}\n'); process.exitCode = 1; });
}
