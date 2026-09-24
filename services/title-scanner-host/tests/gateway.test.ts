import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRequest, proxyRequest, healthResult, routeScannerRequest, scannerEnabled, signatureRequest, MAX_BYTES } from '../src/gateway.ts';
import { createHash, randomUUID } from 'node:crypto';
const token = 'fictional-gateway-test-token-'.repeat(2);
const bytes = new TextEncoder().encode('FICTIONAL GATEWAY FIXTURE');
function request(overrides: Record<string, string> = {}, body: BodyInit = bytes) {
  return new Request('https://scanner.example.test/v1/scan', { method: 'POST', body, duplex: 'half', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
    'x-content-sha256': createHash('sha256').update(bytes).digest('hex'), 'x-scan-protocol': '1', 'x-scan-request-id': randomUUID(), ...overrides,
  } } as RequestInit);
}
const stream = () => new TransformStream<Uint8Array, Uint8Array>();

test('disabled, missing-token, insecure and unauthenticated requests never obtain the DO or start compute', async () => {
  const forbidden = async () => assert.fail('must not obtain DO');
  assert.equal((await routeScannerRequest(request(), 'false', token, forbidden)).status, 503);
  assert.equal((await routeScannerRequest(request(), 'true', undefined, forbidden)).status, 503);
  assert.equal((await routeScannerRequest(request({ authorization: 'Bearer invalid' }), 'true', token, forbidden)).status, 401);
  assert.equal((await routeScannerRequest(new Request('http://scanner.test/v1/health'), 'true', token, forbidden)).status, 400);
  assert.equal(scannerEnabled('false', token), false); assert.equal(scannerEnabled('true', undefined), false);
  let routed = 0;
  assert.equal((await routeScannerRequest(request(), 'true', token, async () => { routed++; return new Response('ok'); })).status, 200);
  assert.equal(routed, 1);
});

test('unauthenticated or malformed scans are rejected before transport/compute', async () => {
  for (const headers of [{ authorization: 'Bearer bad' }, { 'content-length': String(MAX_BYTES + 1) }, { 'content-length': 'garbage' },
    { 'x-content-sha256': 'bad' }, { 'x-scan-protocol': '2' }, { 'content-encoding': 'gzip' }, { 'content-type': 'text/plain' }]) {
    const result = await proxyRequest(request(headers), token, async () => assert.fail('must not forward'), stream);
    assert.ok([400, 401, 413].includes(result.status));
  }
  assert.equal(validateRequest(new Request('https://scanner.test/v1/health'), token)?.status, 401);
  assert.equal(validateRequest(new Request('https://scanner.test/v1/health?secret=x'), token)?.status, 404);
});

test('stream forwards exact bytes with only protocol headers and preserves byte-bound receipt', async () => {
  const req = request({ 'x-client-filename': 'do-not-forward.pdf' });
  const receipt = { status: 'clean', requestId: req.headers.get('x-scan-request-id'), sha256: req.headers.get('x-content-sha256') };
  const response = await proxyRequest(req, token, async forwarded => {
    assert.equal(forwarded.url, 'http://container/v1/scan');
    assert.equal(forwarded.headers.get('x-client-filename'), null);
    assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), bytes);
    return Response.json(receipt);
  }, stream);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), receipt);
});

test('short and excessive streaming bodies never produce a successful scan response', async () => {
  for (const body of [bytes.subarray(1), new Uint8Array(bytes.length + 1)]) {
    const response = await proxyRequest(request({}, body), token, async incoming => {
      await incoming.arrayBuffer(); return Response.json({ status: 'clean' });
    }, stream, 200);
    assert.notEqual(response.status, 200);
  }
});

test('upstream private errors, redirects, malformed or oversized receipts become bounded failures', async () => {
  for (const upstream of [new Response('PRIVATE_DIAGNOSTIC', { status: 500 }), new Response(null, { status: 302 }),
    new Response('PRIVATE_DIAGNOSTIC'), Response.json('x'.repeat(5000)), Response.json([])]) {
    const response = await proxyRequest(request(), token, async incoming => { await incoming.arrayBuffer(); return upstream; }, stream);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE_DIAGNOSTIC/);
  }
});

test('hanging transport, upload stream, and response stream hit a total deadline', async () => {
  const hanging = new ReadableStream<Uint8Array>({ start() {} });
  const cases = [
    { req: request(), forward: async () => new Promise<Response>(() => {}) },
    { req: request({}, hanging), forward: async (incoming: Request) => { await incoming.arrayBuffer(); return Response.json({}); } },
    { req: request(), forward: async (incoming: Request) => { await incoming.arrayBuffer(); return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }); } },
  ];
  for (const scenario of cases) {
    const started = Date.now();
    const result = await proxyRequest(scenario.req, token, scenario.forward, stream, 50);
    assert.equal(result.status, 504); assert.ok(Date.now() - started < 500);
  }
});

test('health requires fresh complete evidence; persistent retries are bounded below idle timeout', () => {
  const now = Date.now();
  const good = { status: 'ready', protocolVersion: 1, checkedAt: new Date(now).toISOString(), signatureUpdatedAt: new Date(now - 1000).toISOString() };
  assert.equal(healthResult(good, 10, now).consecutiveFailures, 0);
  for (const raw of [null, {}, { ...good, signatureUpdatedAt: new Date(now - 49 * 3600000).toISOString() },
    { ...good, checkedAt: new Date(now - 120000).toISOString() }, { ...good, protocolVersion: 0 }]) {
    const bad = healthResult(raw, 100, now); assert.equal(bad.status, 'unavailable'); assert.equal(bad.consecutiveFailures, 12);
    assert.ok(Date.parse(bad.nextCheckAt) - now <= 10 * 60000);
  }
});

test('signature egress allows official downloads only and strips secrets', () => {
  const valid = signatureRequest(new Request('https://database.clamav.net/daily-28133.cdiff', { headers: { authorization: 'private-token', range: 'bytes=0-100' } }));
  assert.ok(valid); assert.equal(valid.headers.get('authorization'), null); assert.equal(valid.headers.get('range'), 'bytes=0-100');
  for (const url of ['http://database.clamav.net/daily.cvd', 'https://other.test/daily.cvd',
    'https://database.clamav.net/daily.cvd?private=anything', 'https://database.clamav.net/anything', 'https://database.clamav.net:444/daily.cvd'])
    assert.equal(signatureRequest(new Request(url)), null);
  assert.equal(signatureRequest(new Request('https://database.clamav.net/daily.cvd', { method: 'POST', body: 'PRIVATE' })), null);
});
