/** Real-engine evidence using synthetic files only. Requires official definitions already downloaded by freshclam. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { engineConfiguration } from '../src/engine-config.mjs';
import { clamdCommand } from '../src/clamd.mjs';
import { createScannerServer } from '../src/server.mjs';
import { tlsFixture, baseConfig, listen, close, request, headersFor } from '../tests/helpers.mjs';

const databaseDirectory = process.env.SCANNER_VERIFY_DATABASE_DIR && resolve(process.env.SCANNER_VERIFY_DATABASE_DIR);
if (!databaseDirectory || !['daily.cvd', 'daily.cld'].some(name => existsSync(join(databaseDirectory, name)))) {
  process.stderr.write('Set SCANNER_VERIFY_DATABASE_DIR to an isolated freshclam database directory.\n'); process.exit(1);
}
const directory = mkdtempSync(join(tmpdir(), 'title-scanner-real-'));
const tls = tlsFixture();
const socketPath = join(directory, 'clamd.sock');
const temporaryDirectory = join(directory, 'tmp'); mkdirSync(temporaryDirectory, { mode: 0o700 });
const configPath = join(directory, 'clamd.conf');
writeFileSync(configPath, engineConfiguration({ databaseDirectory, socketPath, temporaryDirectory }), { mode: 0o600 });
const engine = spawn(process.env.CLAMD_BINARY ?? 'clamd', ['--config-file', configPath, '--foreground', '--fail-if-cvd-older-than=3'],
  { env: { ...process.env, TZ: 'UTC' }, stdio: ['ignore', 'ignore', 'ignore'] });
let engineError = false; engine.on('error', () => { engineError = true; });
let server;
try {
  const deadline = Date.now() + 60000;
  let version;
  while (Date.now() < deadline && engine.exitCode === null && !engineError) {
    try { version = await clamdCommand(socketPath, 'VERSION', null, AbortSignal.timeout(1000)); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(version, 'real_clamd_start_failed');
  const config = { ...baseConfig(tls), socketPath, token: randomBytes(48).toString('hex'), maxBytes: 52428800, timeoutMs: 20000 };
  server = await listen(createScannerServer(config));
  const adapterPath = pathToFileURL(resolve(import.meta.dirname, '../../../web/lib/backend/document-security.ts')).href;
  const zipHelper = pathToFileURL(resolve(import.meta.dirname, '../tests/zip-fixture.mjs')).href;
  const encryptedPath = join(directory, 'encrypted.zip');
  writeFileSync(join(directory, 'clean.txt'), 'Fictional encrypted archive fixture.');
  execFileSync('zip', ['-q', '-P', 'synthetic-verification-only', encryptedPath, 'clean.txt'], { cwd: directory, stdio: 'ignore' });
  const childPath = join(directory, 'client.mjs');
  writeFileSync(childPath, `
import assert from 'node:assert/strict';
import { scanDocument } from ${JSON.stringify(adapterPath)};
import { readFileSync } from 'node:fs';
import { zipFixture } from ${JSON.stringify(zipHelper)};
const env = { TITLE_SCANNER_URL: process.env.VERIFY_URL, TITLE_SCANNER_TOKEN: process.env.VERIFY_TOKEN, TITLE_SCANNER_TIMEOUT_MS: '25000' };
const clean = await scanDocument(env, new TextEncoder().encode('Fictional TITLE scanner clean fixture.'));
assert.equal(clean.status, 'clean');
// EICAR is the standard harmless antivirus test string, assembled only in memory.
const eicar = new TextEncoder().encode('X5O!P%@AP[4' + String.fromCharCode(92) + 'PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const infected = await scanDocument(env, eicar); assert.equal(infected.status, 'infected');
const archived = await scanDocument(env, zipFixture(eicar)); assert.equal(archived.status, 'infected', 'EICAR inside ZIP must be blocked');
const encrypted = await scanDocument(env, readFileSync(${JSON.stringify(encryptedPath)})); assert.equal(encrypted.status, 'unavailable', 'Encrypted ZIP must be blocked');
const expansion = await scanDocument(env, zipFixture(Buffer.alloc(52428801))); assert.equal(expansion.status, 'unavailable', 'Archive expansion above MaxFileSize must be blocked');
let nested = Buffer.from('Fictional recursion fixture');
for (let i = 0; i < 20; i++) nested = zipFixture(nested, 'nested.zip');
const recursion = await scanDocument(env, nested); assert.equal(recursion.status, 'unavailable', 'Archive recursion above limit must be blocked');
const oversized = await scanDocument(env, new Uint8Array(52428801)); assert.equal(oversized.reason, 'invalid_size');
console.log(JSON.stringify({ realEngine: true, clean: clean.status, eicar: infected.status, eicarInZip: archived.status, encryptedZip: encrypted.status, archiveExpansionLimit: expansion.status, archiveRecursionLimit: recursion.status, oversize: oversized.reason,
  engineVersion: clean.engineVersion, signatureVersion: clean.signatureVersion, signatureUpdatedAt: clean.signatureUpdatedAt }));
`);
  const childEnv = { ...process.env, NODE_EXTRA_CA_CERTS: tls.certPath, VERIFY_TOKEN: config.token,
    VERIFY_URL: `https://127.0.0.1:${server.address().port}/v1/scan` };
  const child = spawn(process.execPath, ['--experimental-strip-types', childPath], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = ''; child.stdout.on('data', b => { output += b.toString(); }); child.stderr.on('data', b => { error += b.toString(); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `real_adapter_verification_failed: ${error.slice(0, 2000)}`);
  process.stdout.write(output);
  const sample = Buffer.from('Fictional HTTP boundary fixture.');
  const over = await request(server, tls.cert, sample, { ...headersFor(sample, config.token), 'Content-Length': '52428801' });
  assert.equal(over.status, 413);
  // Suspend only our own daemon to verify the real socket/HTTP deadline without replacing the engine.
  engine.kill('SIGSTOP'); config.timeoutMs = 1000;
  const timeoutStart = Date.now();
  const timed = await request(server, tls.cert, sample, headersFor(sample, config.token));
  engine.kill('SIGCONT'); config.timeoutMs = 20000;
  assert.equal(timed.status, 504); assert.ok(Date.now() - timeoutStart < 3000);
  process.stdout.write(JSON.stringify({ realServiceOversize: over.status, pausedRealEngineTimeout: timed.status }) + '\n');
  // Kill only our private daemon and prove the same HTTPS adapter closes access on engine failure.
  engine.kill('SIGTERM'); await once(engine, 'exit');
  writeFileSync(childPath, `
import assert from 'node:assert/strict';
import { scanDocument } from ${JSON.stringify(adapterPath)};
const result = await scanDocument({ TITLE_SCANNER_URL: process.env.VERIFY_URL, TITLE_SCANNER_TOKEN: process.env.VERIFY_TOKEN }, new TextEncoder().encode('Fictional failure fixture.'));
assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'scanner_unavailable');
console.log(JSON.stringify({ stoppedRealEngine: result.status, reason: result.reason }));
`);
  const stopped = spawn(process.execPath, ['--experimental-strip-types', childPath], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stoppedOutput = ''; stopped.stdout.on('data', b => { stoppedOutput += b.toString(); });
  const [stoppedCode] = await once(stopped, 'exit'); assert.equal(stoppedCode, 0, 'engine_failure_verification_failed');
  process.stdout.write(stoppedOutput);
} finally {
  if (server) await close(server);
  if (engine.exitCode === null) { engine.kill('SIGCONT'); engine.kill('SIGTERM'); await once(engine, 'exit').catch(() => {}); }
  tls.cleanup(); rmSync(directory, { recursive: true, force: true });
}
