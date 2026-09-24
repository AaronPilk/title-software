import assert from 'node:assert/strict';
import test from 'node:test';
import { scanDocument, MAX_DOCUMENT_SCAN_BYTES } from '../../../web/lib/backend/document-security.ts';
const bytes = new TextEncoder().encode('Fictional clean document for verification.');
const env = { TITLE_SCANNER_URL: 'https://scanner.example.test/v1/scan', TITLE_SCANNER_TOKEN: 'x'.repeat(40) };
function receipt(init, overrides = {}) {
  return { protocolVersion: 1, requestId: init.headers['X-Scan-Request-ID'], status: 'clean',
    sha256: init.headers['X-Content-SHA256'], byteLength: bytes.length, scannedAt: new Date().toISOString(),
    engineVersion: 'ClamAV 1.5.4', signatureVersion: '28133', signatureUpdatedAt: new Date().toISOString(), ...overrides };
}
function json(value) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
test('exact bytes are hashed and sent with authenticated bounded non-redirecting request', async () => {
  const result = await scanDocument(env, bytes, async (url, init) => {
    assert.equal(url, env.TITLE_SCANNER_URL); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${env.TITLE_SCANNER_TOKEN}`);
    assert.deepEqual(init.body, bytes); assert.notEqual(init.body, bytes);
    return json(receipt(init));
  });
  assert.equal(result.status, 'clean'); assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.protocolVersion, 1);
});
test('actual infected receipt stays blocked', async () => {
  const result = await scanDocument(env, bytes, async (_url, init) => json(receipt(init, { status: 'infected' })));
  assert.equal(result.status, 'infected');
});
test('absent, weak, malformed, non-HTTPS, credential, query and fragment configurations fail before sending', async () => {
  const invalid = [{}, { ...env, TITLE_SCANNER_TOKEN: 'short' }, { ...env, TITLE_SCANNER_TIMEOUT_MS: '0' },
    { ...env, TITLE_SCANNER_TIMEOUT_MS: '30001' }, { ...env, TITLE_SCANNER_TIMEOUT_MS: '1e3' },
    ...['http://scanner.test/v1/scan', 'https://u:p@scanner.test/v1/scan', 'https://scanner.test/v1/scan?q=x',
      'https://scanner.test/v1/scan#x', 'https://scanner.test/anything', 'https://SCANNER.test/v1/scan', 'not a URL']
      .map(TITLE_SCANNER_URL => ({ ...env, TITLE_SCANNER_URL }))];
  for (const configuration of invalid) {
    const result = await scanDocument(configuration, bytes, () => { assert.fail('must not send'); });
    assert.equal(result.status, 'unavailable'); assert.notEqual(result.reason, 'scanner_unavailable');
  }
});
test('empty and oversized uploads never reach transport', async () => {
  for (const content of [new Uint8Array(), new Uint8Array(MAX_DOCUMENT_SCAN_BYTES + 1)]) {
    const result = await scanDocument(env, content, () => assert.fail('must not send'));
    assert.equal(result.reason, 'invalid_size');
  }
});
test('mismatched content, replay, protocol, stale/future scans and stale definitions fail closed', async () => {
  const bad = [{ sha256: '0'.repeat(64) }, { byteLength: bytes.length + 1 }, { requestId: crypto.randomUUID() },
    { protocolVersion: 0 }, { status: 'unknown' }, { engineVersion: 'scanner' }, { signatureVersion: '' },
    { scannedAt: new Date(Date.now() - 120000).toISOString() }, { scannedAt: new Date(Date.now() + 120000).toISOString() },
    { signatureUpdatedAt: new Date(Date.now() - 73 * 3600000).toISOString() },
    { signatureUpdatedAt: new Date(Date.now() + 120000).toISOString() }, { scannedAt: 'bad' }, { signatureUpdatedAt: null }];
  for (const override of bad) {
    const result = await scanDocument(env, bytes, async (_url, init) => json(receipt(init, override)));
    assert.equal(result.reason, 'invalid_receipt', JSON.stringify(override));
  }
});
test('redirect/error statuses, exceptions, non-JSON, oversized response and invalid JSON never leak scanner text', async () => {
  const transports = [async () => { throw new Error('private payload token'); },
    ...[301, 302, 307, 401, 500, 503].map(status => async () => new Response('private payload token', { status })),
    async () => new Response('private payload token'), async () => json('x'.repeat(4097)),
    async () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '5000' } })];
  for (const transport of transports) {
    const result = await scanDocument(env, bytes, transport);
    assert.equal(result.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(result), /private payload token/);
  }
});
test('a hanging transport and hanging response body meet the overall deadline', async () => {
  for (const transport of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } })]) {
    const started = Date.now();
    const result = await scanDocument({ ...env, TITLE_SCANNER_TIMEOUT_MS: '1000' }, bytes, transport);
    assert.equal(result.reason, 'scanner_timeout'); assert.ok(Date.now() - started < 2000);
  }
});
test('Buffer subarrays hash only their exact visible bytes and cannot retain a mutable shared backing buffer', async () => {
  const pooled = Buffer.alloc(8192, 100); pooled.set(bytes, 100);
  const view = pooled.subarray(100, 100 + bytes.length);
  const result = await scanDocument(env, view, async (_url, init) => {
    pooled.fill(0);
    assert.deepEqual(Array.from(init.body), Array.from(bytes));
    const expected = await crypto.subtle.digest('SHA-256', bytes);
    assert.equal(init.headers['X-Content-SHA256'], Buffer.from(expected).toString('hex'));
    return json(receipt(init));
  });
  assert.equal(result.status, 'clean');
});
