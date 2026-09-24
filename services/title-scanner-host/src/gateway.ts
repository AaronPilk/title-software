import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_BYTES = 52_428_800;
export const DEADLINE_MS = 28_000;
const RESPONSE_LIMIT = 4096;
export function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function validToken(token: unknown): token is string { return typeof token === 'string' && /^[\x21-\x7e]{32,512}$/.test(token); }
export function scannerEnabled(enabled: unknown, token: unknown) { return enabled === 'true' && validToken(token); }

/** The callback obtains the DO only after all public ingress checks; disabled hosts incur no container boot. */
export async function routeScannerRequest(request: Request, enabled: unknown, token: unknown, forward: Forwarder) {
  if (new URL(request.url).protocol !== 'https:') return reply(400, 'https_required');
  const rejected = validateRequest(request, token);
  if (rejected) return rejected;
  if (!scannerEnabled(enabled, token)) return reply(503, 'scanner_not_activated');
  return forward(request);
}
export function validateRequest(request: Request, token: unknown): Response | null {
  const url = new URL(request.url);
  if (url.search || url.hash || !((request.method === 'POST' && url.pathname === '/v1/scan') ||
      (request.method === 'GET' && url.pathname === '/v1/health'))) return reply(404, 'not_found');
  if (!validToken(token)) return reply(503, 'scanner_unavailable');
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.length > 520 || !timingSafeEqual(createHash('sha256').update(authorization).digest(),
    createHash('sha256').update(`Bearer ${token}`).digest())) return reply(401, 'unauthorized');
  const size = request.headers.get('content-length');
  if (request.headers.has('content-encoding') || request.headers.has('transfer-encoding')) return reply(400, 'invalid_request');
  if (request.method === 'GET') return (request.body || (size && size !== '0')) ? reply(400, 'invalid_request') : null;
  if (request.headers.get('content-type') !== 'application/octet-stream' || !size || !/^[0-9]+$/.test(size) ||
      !Number.isSafeInteger(Number(size)) || Number(size) < 1 || !request.body ||
      request.headers.get('x-scan-protocol') !== '1' ||
      !/^[a-f0-9]{64}$/.test(request.headers.get('x-content-sha256') ?? '') ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.headers.get('x-scan-request-id') ?? ''))
    return reply(400, 'invalid_request');
  return Number(size) > MAX_BYTES ? reply(413, 'document_too_large') : null;
}

export type FixedStream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
export type Forwarder = (request: Request) => Promise<Response>;

/** Stream exact bounded bytes; never retain uploads in Worker or Durable Object storage. */
export async function proxyRequest(request: Request, token: string, forward: Forwarder,
  fixed: (length: number) => FixedStream, deadlineMs = DEADLINE_MS): Promise<Response> {
  const rejected = validateRequest(request, token);
  if (rejected) return rejected;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let pipe: Promise<void> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }));
  // A cancelled caller also cancels transport and body streaming.
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    const run = async () => {
      const headers = new Headers({ authorization: `Bearer ${token}` });
      let body: ReadableStream<Uint8Array> | undefined;
      if (request.body) {
        const expected = Number(request.headers.get('content-length'));
        const bounded = fixed(expected); let seen = 0;
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, output) { seen += chunk.byteLength; if (seen > expected || seen > MAX_BYTES) throw new Error('body_size'); output.enqueue(chunk); },
          flush() { if (seen !== expected) throw new Error('body_size'); },
        });
        pipe = request.body.pipeThrough(counter).pipeTo(bounded.writable, { signal: controller.signal });
        // Immediately attach rejection handling while the upstream consumes the readable side.
        pipe.catch(() => controller.abort());
        body = bounded.readable;
        for (const name of ['content-type', 'content-length', 'x-content-sha256', 'x-scan-protocol', 'x-scan-request-id'])
          headers.set(name, request.headers.get(name)!);
      }
      const init: RequestInit & { duplex: 'half' } = { method: request.method, headers, body, signal: controller.signal, redirect: 'manual', duplex: 'half' };
      const response = await forward(new Request(`http://container${new URL(request.url).pathname}`, init));
      if (response.status !== 200) {
        await response.body?.cancel();
        return reply([400, 401, 413, 503, 504].includes(response.status) ? response.status : 503, 'scanner_unavailable');
      }
      if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !response.body)
        throw new Error('invalid_response');
      const advertised = response.headers.get('content-length');
      if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > RESPONSE_LIMIT)) throw new Error('invalid_response');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength; if (size > RESPONSE_LIMIT) throw new Error('invalid_response');
        chunks.push(next.value);
      }
      if (pipe) await pipe;
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid_response');
      // The API client validates the exact receipt and freshness; no rewriting of receipt content here.
      return new Response(bytes, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    };
    return await Promise.race([run(), aborted]);
  } catch { return reply(controller.signal.aborted ? 504 : 503, 'scanner_unavailable'); }
  finally {
    clearTimeout(timer); controller.abort(); request.signal.removeEventListener('abort', cancel);
    void reader?.cancel().catch(() => {});
  }
}

/** Egress is limited to official definition downloads, without request bodies, credentials or query strings. */
export function signatureRequest(request: Request): Request | null {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.hostname !== 'database.clamav.net' || url.port || url.username || url.password || url.search || url.hash ||
      !['GET', 'HEAD'].includes(request.method) || request.body ||
      !/^\/(?:main|daily|bytecode)(?:-[0-9]+)?\.(?:cvd|cld|cdiff)(?:\.sign)?$/.test(url.pathname)) return null;
  const headers = new Headers();
  for (const name of ['range', 'if-modified-since', 'if-none-match', 'user-agent']) {
    const value = request.headers.get(name); if (value && value.length <= 256) headers.set(name, value);
  }
  return new Request(url.href, { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(60000) });
}

export type Health = { status: 'ready' | 'unavailable'; checkedAt: string; signatureUpdatedAt?: string; consecutiveFailures: number; nextCheckAt: string };
export function healthResult(value: unknown, previous: number, now = Date.now()): Health {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const stamp = typeof v.signatureUpdatedAt === 'string' ? Date.parse(v.signatureUpdatedAt) : NaN;
  const checked = typeof v.checkedAt === 'string' ? Date.parse(v.checkedAt) : NaN;
  const ready = v.status === 'ready' && v.protocolVersion === 1 && Number.isFinite(stamp) &&
    stamp <= now + 60000 && now - stamp <= 48 * 3600000 && checked >= now - 60000 && checked <= now + 60000;
  const failures = ready ? 0 : Math.min(previous + 1, 12);
  // Never exceed the 15-minute idle timeout or a repaired warm engine could sleep before the retry.
  const delay = ready ? 5 * 60000 : Math.min(10, 5 * 2 ** Math.min(failures - 1, 1)) * 60000;
  return { status: ready ? 'ready' : 'unavailable', checkedAt: new Date(now).toISOString(),
    ...(ready ? { signatureUpdatedAt: new Date(stamp).toISOString() } : {}),
    consecutiveFailures: failures, nextCheckAt: new Date(now + delay).toISOString() };
}
