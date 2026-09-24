import assert from 'node:assert/strict';
import { scanDocument } from '../../../web/lib/backend/document-security.ts';
import { zipFixture } from '../tests/zip-fixture.mjs';

const url = new URL(process.env.TITLE_SCANNER_URL ?? '');
const token = process.env.TITLE_SCANNER_TOKEN;
if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !token || !/^[\x21-\x7e]{32,512}$/.test(token)) throw new Error('loopback_verification_configuration_required');
const headers = { authorization: `Bearer ${token}` };
const expires = Date.now() + 7 * 60000;
for (;;) {
  try {
    const response = await fetch(new URL('/v1/health', url), { headers, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (response.ok && (await response.json()).status === 'ready') break;
  } catch { /* Starting official signatures and engine; no payload or upstream diagnostics are logged. */ }
  if (Date.now() >= expires) throw new Error('container_readiness_deadline');
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const env = { TITLE_SCANNER_URL: 'https://scanner-verification.invalid/v1/scan', TITLE_SCANNER_TOKEN: token };
const transport = (_url, init) => fetch(new URL('/v1/scan', url), init);
const clean = Buffer.from('FICTIONAL TITLE SCANNER CONTAINER VERIFICATION — NO CLIENT DATA');
assert.equal((await scanDocument(env, clean, transport)).status, 'clean');
// EICAR is a harmless antivirus test string, constructed only in memory and never written to the checkout.
const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
assert.equal((await scanDocument(env, eicar, transport)).status, 'infected');
assert.equal((await scanDocument(env, zipFixture(eicar), transport)).status, 'infected');
const encrypted = zipFixture(clean); encrypted.writeUInt16LE(1, 6);
assert.equal((await scanDocument(env, encrypted, transport)).status, 'unavailable');
assert.equal((await scanDocument(env, zipFixture(Buffer.alloc(26 * 1024 * 1024)), transport)).status, 'unavailable');
assert.equal((await fetch(new URL('/v1/health', url), { redirect: 'error' })).status, 401);
assert.equal((await fetch(new URL('/v1/health', url), { headers: { authorization: 'Bearer wrong' }, redirect: 'error' })).status, 401);
assert.equal((await fetch(new URL('/v1/scan?redirect=1', url), { method: 'POST', headers, redirect: 'error' })).status, 404);
process.stdout.write('Container verified: ready, clean, EICAR, EICAR ZIP, encrypted/over-limit archive rejection, authentication and route boundaries.\n');
