import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createScannerServer, scannerConfig } from '../src/server.mjs';
import { tlsFixture, baseConfig, headersFor, request, listen, close } from './helpers.mjs';
import { scanWithClamd } from '../src/clamd.mjs';
import net from 'node:net';
import { join } from 'node:path';
const tls = tlsFixture(); after(() => tls.cleanup());
const bytes = Buffer.from('fictional clean fixture');
const clean = { status: 'clean', engineVersion: 'ClamAV 1.5.4', signatureVersion: '28133', signatureUpdatedAt: new Date().toISOString() };
test('TLS server authenticates before scanning; content binding, schema and route are enforced', async () => {
  const config = baseConfig(tls); let calls = 0;
  const server = await listen(createScannerServer(config, async received => { calls++; assert.deepEqual(received, bytes); return clean; }));
  try {
    for (const override of [{ Authorization: 'Bearer invalid' }, { 'X-Content-SHA256': '0'.repeat(64) },
      { 'X-Scan-Request-ID': 'invalid' }, { 'X-Scan-Protocol': '0' }, { 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]) {
      const response = await request(server, tls.cert, bytes, { ...headersFor(bytes, config.token), ...override });
      assert.ok([400, 401].includes(response.status)); assert.equal(calls, 0);
    }
    assert.equal((await request(server, tls.cert, bytes, headersFor(bytes, config.token), '/v1/scan?extra=yes')).status, 404);
    const result = await request(server, tls.cert, bytes, headersFor(bytes, config.token));
    assert.equal(result.status, 200); assert.equal(result.body.status, 'clean'); assert.equal(calls, 1);
    assert.equal(result.body.sha256, headersFor(bytes, config.token)['X-Content-SHA256']); assert.equal(result.body.byteLength, bytes.length);
  } finally { await close(server); }
});
test('oversized, engine failures, timed out and concurrency exhausted scans fail closed', async () => {
  const config = { ...baseConfig(tls), maxConcurrent: 1 }; let calls = 0;
  const server = await listen(createScannerServer(config, async (_bytes, _config, signal) => {
    calls++;
    if (calls === 1) throw new Error('private document engine failure');
    await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error()), { once: true }); });
    return clean;
  }));
  try {
    const tooBig = Buffer.alloc(1025);
    assert.equal((await request(server, tls.cert, tooBig, headersFor(tooBig, config.token))).status, 413);
    assert.equal(calls, 0);
    const failed = await request(server, tls.cert, bytes, headersFor(bytes, config.token));
    assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed), /private document/);
    const slow = request(server, tls.cert, bytes, headersFor(bytes, config.token));
    while (calls < 2) await new Promise(resolve => setTimeout(resolve, 5));
    const busy = await request(server, tls.cert, bytes, headersFor(bytes, config.token));
    assert.equal(busy.status, 503); assert.equal(busy.body.error, 'scanner_busy');
    const timeout = await slow; assert.equal(timeout.status, 504); assert.equal(timeout.body.error, 'scanner_timeout');
  } finally { await close(server); }
});
test('runtime configuration requires secrets, TLS, Unix socket and loopback bind; limits cannot silently widen', () => {
  const env = { TITLE_SCANNER_TOKEN: 'x'.repeat(40), TITLE_SCANNER_TLS_CERT: tls.certPath, TITLE_SCANNER_TLS_KEY: tls.keyPath, CLAMD_SOCKET: '/tmp/clamd.sock' };
  assert.equal(scannerConfig(env).host, '127.0.0.1');
  for (const override of [{ TITLE_SCANNER_TOKEN: 'short' }, { CLAMD_SOCKET: 'relative.sock' }, { TITLE_SCANNER_HOST: '0.0.0.0' },
    { TITLE_SCANNER_MAX_BYTES: '52428801' }, { TITLE_SCANNER_TIMEOUT_MS: '30001' }, { TITLE_SCANNER_CONCURRENCY: '5' }, { TITLE_SCANNER_MAX_SIGNATURE_AGE_HOURS: '73' }])
    assert.throws(() => scannerConfig({ ...env, ...override }), /invalid_scanner_configuration/);
});
test('clamd protocol rejects unknown, truncated, oversized, stale and explicit engine error replies', async () => {
  for (const reply of ['stream: parse ERROR\0', 'stream: OK', 'x'.repeat(4097) + '\0', 'stream: OK\0extra', 'random\0']) {
    const socketPath = join(tls.directory, `s${Math.random().toString(36).slice(2)}.sock`);
    const daemon = net.createServer(socket => socket.once('data', data => {
      if (data.toString().startsWith('zVERSION')) socket.end(`ClamAV 1.5.4/28133/${new Date().toUTCString().replace(/ GMT$/, '')}\0`);
      else socket.end(reply);
    }));
    await new Promise(resolve => daemon.listen(socketPath, resolve));
    try { await assert.rejects(scanWithClamd(bytes, { socketPath, maxSignatureAgeMs: 48 * 3600000 }, AbortSignal.timeout(1000)), /scanner_unavailable/); }
    finally { await new Promise(resolve => daemon.close(resolve)); }
  }
});
test('version freshness, mid-scan definition reload and uncertain daemon results are unavailable', async () => {
  for (const scenario of ['stale', 'future', 'reload', 'unknown', 'timeout']) {
    const socketPath = join(tls.directory, `s${Math.random().toString(36).slice(2)}.sock`);
    let versions = 0;
    const sockets = new Set();
    const daemon = net.createServer(socket => {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      socket.once('data', data => {
        if (data.toString().startsWith('zVERSION')) {
          versions++;
          const stamp = new Date(Date.now() + (scenario === 'stale' ? -73 * 3600000 : scenario === 'future' ? 120000 : 0));
          socket.end(`ClamAV 1.5.4/${scenario === 'reload' && versions > 1 ? '28134' : '28133'}/${stamp.toUTCString().replace(/ GMT$/, '')}\0`);
        } else if (scenario === 'timeout') { /* Hold socket until the request deadline. */ }
        else socket.end(scenario === 'unknown' ? 'stream: UNKNOWN\0' : 'stream: OK\0');
      });
    });
    await new Promise(resolve => daemon.listen(socketPath, resolve));
    try { await assert.rejects(scanWithClamd(bytes, { socketPath, maxSignatureAgeMs: 48 * 3600000 }, AbortSignal.timeout(100)), /scanner_unavailable/); }
    finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => daemon.close(resolve)); }
  }
});
test('generated engine policy enables archive/document inspection and treats encryption/limits as findings', async () => {
  const { engineConfiguration } = await import('../src/engine-config.mjs');
  const configuration = engineConfiguration({ databaseDirectory: '/private/db', socketPath: '/private/clamd.sock', temporaryDirectory: '/private/tmp' });
  for (const line of ['OfficialDatabaseOnly yes', 'LocalSocketMode 600', 'StreamMaxLength 50M', 'MaxScanTime 15000', 'MaxFileSize 50M',
    'MaxScanSize 200M', 'AlertEncrypted yes', 'AlertEncryptedArchive yes', 'AlertEncryptedDoc yes', 'AlertExceedsMax yes',
    'ScanArchive yes', 'ScanPDF yes', 'ScanOLE2 yes', 'ScanXMLDOCS yes', 'HeuristicAlerts yes']) assert.ok(configuration.split('\n').includes(line), line);
  assert.doesNotMatch(configuration, /TCPSocket|TCPAddr|LogFile /);
  assert.throws(() => engineConfiguration({ databaseDirectory: '/db\nTCPSocket 3310', socketPath: '/sock', temporaryDirectory: '/tmp' }));
});
