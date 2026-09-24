import assert from 'node:assert/strict';
import { scanDocument } from '../../../web/lib/backend/document-security.ts';
import { zipFixture } from '../../title-scanner/tests/zip-fixture.mjs';

// Operator-driven after deployment; never sends customer files or changes scan policy.
const url = new URL(process.env.TITLE_SCANNER_URL ?? '');
const token = process.env.TITLE_SCANNER_TOKEN;
if (url.protocol !== 'https:' || url.pathname !== '/v1/scan' || url.username || url.password || url.search || url.hash ||
    !token || !/^[\x21-\x7e]{32,512}$/.test(token)) throw new Error('hosted_verification_configuration_required');
const environment = { TITLE_SCANNER_URL: url.href, TITLE_SCANNER_TOKEN: token };
const health = await fetch(new URL('/v1/health', url), { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
assert.equal(health.status, 200, 'host_not_ready');
assert.equal((await health.json()).status, 'ready', 'engine_not_ready');
assert.equal((await scanDocument(environment, new TextEncoder().encode('FICTIONAL HOSTED SCANNER CHECK - NO CLIENT DATA'))).status, 'clean');
const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
assert.equal((await scanDocument(environment, eicar)).status, 'infected');
assert.equal((await scanDocument(environment, zipFixture(eicar))).status, 'infected');
const invalid = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer invalid' }, redirect: 'error' });
assert.equal(invalid.status, 401);
process.stdout.write('Hosted synthetic scanner checks passed. This does not activate upload enforcement or prove Supabase-runtime reachability.\n');
