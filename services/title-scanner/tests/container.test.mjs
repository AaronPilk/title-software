import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { createScannerServer, scannerConfig } from '../src/server.mjs';
import { containerConfiguration } from '../src/container.mjs';
import { inspectClamd } from '../src/clamd.mjs';
import { tlsFixture, headersFor, listen, close } from './helpers.mjs';

test('container transport requires explicit opt-in and token; standalone TLS remains the default', () => {
  const env = { TITLE_SCANNER_TOKEN: 'test-token-'.repeat(4), CLAMD_SOCKET: '/private/clamd.sock' };
  assert.throws(() => scannerConfig(env));
  assert.throws(() => scannerConfig({ ...env, TITLE_SCANNER_HOST: '0.0.0.0' }));
  assert.throws(() => scannerConfig({ ...env, TITLE_SCANNER_TRANSPORT: 'http' }));
  const privateEnv = { ...env, TITLE_SCANNER_TRANSPORT: 'cloudflare-private-http', TITLE_SCANNER_HOST: '0.0.0.0', TITLE_SCANNER_PORT: '8080' };
  assert.equal(containerConfiguration(privateEnv).transport, 'cloudflare-private-http');
  assert.throws(() => containerConfiguration({ ...privateEnv, TITLE_SCANNER_TOKEN: '' }));
  assert.throws(() => containerConfiguration({ ...privateEnv, TITLE_SCANNER_PORT: '80' }));
});

test('private HTTP preserves authentication, byte receipt and authenticated engine readiness', async () => {
  const token = 'fictional-container-token-'.repeat(2);
  const config = scannerConfig({ TITLE_SCANNER_TOKEN: token, TITLE_SCANNER_TRANSPORT: 'cloudflare-private-http', CLAMD_SOCKET: '/absent.sock' });
  let scans = 0, checks = 0;
  const metadata = { engineVersion: 'ClamAV 1.5.4', signatureVersion: '28133', signatureUpdatedAt: new Date().toISOString() };
  const server = await listen(createScannerServer(config, async () => { scans++; return { status: 'clean', ...metadata }; },
    async () => { checks++; return { status: 'ready', ...metadata }; }));
  const request = (method, path, headers = {}, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.once('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }); req.once('error', reject); req.end(body);
  });
  try {
    assert.equal((await request('GET', '/v1/health')).status, 401); assert.equal(checks, 0);
    assert.equal((await request('GET', '/v1/health?anything=1', { authorization: `Bearer ${token}` })).status, 404);
    const ready = await request('GET', '/v1/health', { authorization: `Bearer ${token}` });
    assert.equal(ready.body.status, 'ready'); assert.equal(checks, 1);
    const bytes = Buffer.from('FICTIONAL PRIVATE CONTAINER FIXTURE');
    const result = await request('POST', '/v1/scan', headersFor(bytes, token), bytes);
    assert.equal(result.status, 200); assert.equal(result.body.byteLength, bytes.length); assert.equal(scans, 1);
  } finally { await close(server); }
});

test('real Unix readiness rejects stale engine signatures and unhealthy PING', async () => {
  const tmp = tlsFixture();
  try {
    for (const scenario of ['ready', 'stale', 'bad-ping']) {
      const socketPath = join(tmp.directory, `${scenario}.sock`);
      const daemon = net.createServer(socket => socket.once('data', data => {
        const date = new Date(Date.now() - (scenario === 'stale' ? 73 * 3600000 : 0));
        socket.end(data.toString().startsWith('zPING') ? `${scenario === 'bad-ping' ? 'BAD' : 'PONG'}\0`
          : `ClamAV 1.5.4/28133/${date.toUTCString().replace(/ GMT$/, '')}\0`);
      }));
      await new Promise(resolve => daemon.listen(socketPath, resolve));
      try {
        const check = inspectClamd({ socketPath, maxSignatureAgeMs: 48 * 3600000 }, AbortSignal.timeout(1000));
        if (scenario === 'ready') assert.equal((await check).status, 'ready'); else await assert.rejects(check);
      } finally { await new Promise(resolve => daemon.close(resolve)); }
    }
  } finally { tmp.cleanup(); }
});
