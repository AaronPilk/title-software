/** Encrypted archive transport only. No decryption keys, public objects, deletion or listing. */
import { createHash, timingSafeEqual } from 'node:crypto';

const CHUNK_BYTES = 8 * 1024 * 1024;
const PROTOCOL = 'title-offsite-v1';
const HEX = /^[a-f0-9]{64}$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const PATH = new RegExp(`^/v1/archives/(${UUID})/(receipt\\.json|[a-f0-9]{64})$`);
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'referrer-policy': 'no-referrer' };
const digest = value => createHash('sha256').update(value).digest('hex');
const fixedEqual = (left, right) => timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
const response = (status, value) => Response.json(value, { status, headers });
class BodyDeadline extends Error {}

function configured(env) {
  return /^[a-z0-9]{20}$/.test(env.BACKUP_SOURCE_ID ?? '') && new RegExp(`^${UUID}$`).test(env.BACKUP_DESTINATION_ID ?? '') &&
    ['same-account', 'independent-account'].includes(env.BACKUP_ACCOUNT_BOUNDARY) &&
    HEX.test(env.BACKUP_WRITE_TOKEN ?? '') && HEX.test(env.BACKUP_READ_TOKEN ?? '') &&
    !fixedEqual(env.BACKUP_WRITE_TOKEN, env.BACKUP_READ_TOKEN) && env.ARCHIVES;
}
async function boundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let length = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30_000);
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (timedOut) throw new BodyDeadline(); if (done) break;
      length += value.byteLength;
      if (length > CHUNK_BYTES) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export default {
  async fetch(request, env) {
    try {
      if (!configured(env)) return response(503, { error: 'Backup transport is not configured.' });
      const authorization = request.headers.get('authorization') ?? '';
      if (authorization.length > 256) return response(401, { error: 'Unauthorized.' });
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      // Always perform both fixed-size comparisons, including for malformed credentials.
      const writer = fixedEqual(token, env.BACKUP_WRITE_TOKEN);
      const reader = fixedEqual(token, env.BACKUP_READ_TOKEN);
      if (!writer && !reader) return response(401, { error: 'Unauthorized.' });
      const url = new URL(request.url);
      if (url.search || request.headers.has('origin')) return response(400, { error: 'Operator transport requests only.' });
      if (url.pathname === '/v1/info' && request.method === 'GET') return response(200, {
        protocol: PROTOCOL, sourceId: env.BACKUP_SOURCE_ID, destinationId: env.BACKUP_DESTINATION_ID,
        accountBoundary: env.BACKUP_ACCOUNT_BOUNDARY, maxChunkBytes: CHUNK_BYTES,
        retentionVerified: false, note: 'Bucket locks and account separation require independent operator verification.'
      });
      const match = PATH.exec(url.pathname);
      if (!match) return response(404, { error: 'Not found.' });
      if (request.headers.get('x-title-source') !== env.BACKUP_SOURCE_ID || request.headers.get('x-title-destination') !== env.BACKUP_DESTINATION_ID) return response(409, { error: 'Backup destination binding differs.' });
      const key = `${env.BACKUP_SOURCE_ID}/${env.BACKUP_DESTINATION_ID}/${match[1]}/${match[2]}`;
      if (request.method === 'PUT') {
        if (!writer) return response(403, { error: 'Writer access required.' });
        const expectedHash = request.headers.get('x-title-sha256');
        const length = request.headers.get('content-length');
        if (!HEX.test(expectedHash ?? '') || (length !== null && (!/^\d+$/.test(length) || Number(length) > CHUNK_BYTES))) return response(413, { error: 'Invalid upload bound or digest.' });
        if (request.headers.get('content-type') !== 'application/octet-stream' || (match[2] !== 'receipt.json' && match[2] !== expectedHash)) return response(400, { error: 'Invalid transport object.' });
        let data;
        try { data = await boundedBody(request); } catch (error) { return error instanceof BodyDeadline
          ? response(408, { error: 'Upload body deadline exceeded.' })
          : response(413, { error: 'Upload exceeds its bound.' }); }
        if (data.byteLength === 0 || (length !== null && Number(length) !== data.byteLength) || digest(data) !== expectedHash) return response(422, { error: 'Upload integrity check failed.' });
        const saved = await env.ARCHIVES.put(key, data, {
          onlyIf: { etagDoesNotMatch: '*' }, sha256: expectedHash,
          httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' },
          customMetadata: { sha256: expectedHash, protocol: PROTOCOL }
        });
        if (!saved) return response(409, { error: 'Object already exists.' });
        return response(201, { sha256: expectedHash, bytes: data.byteLength });
      }
      if (request.method === 'HEAD') {
        const object = await env.ARCHIVES.head(key);
        if (!object) return response(404, { error: 'Not found.' });
        return new Response(null, { headers: { ...headers, 'content-length': String(object.size), 'x-title-sha256': object.customMetadata?.sha256 ?? '' } });
      }
      if (request.method === 'GET') {
        if (!reader) return response(403, { error: 'Reader access required.' });
        const object = await env.ARCHIVES.get(key);
        if (!object) return response(404, { error: 'Not found.' });
        if (object.size > CHUNK_BYTES || !HEX.test(object.customMetadata?.sha256 ?? '')) return response(502, { error: 'Stored transport object is invalid.' });
        return new Response(object.body, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(object.size), 'x-title-sha256': object.customMetadata.sha256 } });
      }
      return response(405, { error: 'Method not allowed.' });
    } catch {
      // Never log paths, tokens, bodies or provider errors.
      console.error(JSON.stringify({ event: 'backup_transport_error' }));
      return response(503, { error: 'Backup transport is temporarily unavailable.' });
    }
  }
};
