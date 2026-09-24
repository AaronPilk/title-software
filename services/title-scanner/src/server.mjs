import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanWithClamd, inspectClamd } from './clamd.mjs';

export const MAX_BYTES = 52428800;
function integer(raw, fallback, min, max) {
  const value = raw ?? String(fallback);
  if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error('invalid_scanner_configuration');
  return Number(value);
}
export function scannerConfig(env = process.env) {
  const token = env.TITLE_SCANNER_TOKEN;
  const transport = env.TITLE_SCANNER_TRANSPORT ?? 'https';
  if (!['https', 'cloudflare-private-http'].includes(transport) ||
      !token || !/^[\x21-\x7e]{32,512}$/.test(token) || !env.CLAMD_SOCKET || !isAbsolute(env.CLAMD_SOCKET)) throw new Error('invalid_scanner_configuration');
  const host = env.TITLE_SCANNER_HOST ?? '127.0.0.1';
  if (!(transport === 'https' ? ['127.0.0.1', '::1'] : ['127.0.0.1', '0.0.0.0']).includes(host) ||
      (transport === 'https' && (!env.TITLE_SCANNER_TLS_CERT || !env.TITLE_SCANNER_TLS_KEY))) throw new Error('invalid_scanner_configuration');
  return {
    token, host, transport, port: integer(env.TITLE_SCANNER_PORT, 9443, 1, 65535), socketPath: env.CLAMD_SOCKET,
    ...(transport === 'https' ? { cert: readFileSync(env.TITLE_SCANNER_TLS_CERT), key: readFileSync(env.TITLE_SCANNER_TLS_KEY) } : {}),
    maxBytes: integer(env.TITLE_SCANNER_MAX_BYTES, MAX_BYTES, 1, MAX_BYTES),
    timeoutMs: integer(env.TITLE_SCANNER_TIMEOUT_MS, 25000, 1000, 30000),
    maxConcurrent: integer(env.TITLE_SCANNER_CONCURRENCY, 2, 1, 4),
    maxSignatureAgeMs: integer(env.TITLE_SCANNER_MAX_SIGNATURE_AGE_HOURS, 48, 1, 72) * 3600000,
  };
}

function authorized(value, token) {
  if (typeof value !== 'string' || value.length > 520) return false;
  const supplied = createHash('sha256').update(value).digest();
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  return timingSafeEqual(supplied, expected);
}
function send(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': data.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' });
  res.end(data);
}

/** Exposed for in-process local tests; CLI always uses validated env configuration and the real engine. */
export function createScannerServer(config, scan = scanWithClamd, health = inspectClamd) {
  let active = 0;
  const handler = async (req, res) => {
    // No logs of URLs, headers, filenames, content, hashes, or raw engine errors.
    const healthRequest = req.method === 'GET' && req.url === '/v1/health';
    if (!healthRequest && (req.method !== 'POST' || req.url !== '/v1/scan')) return send(res, 404, { error: 'not_found' });
    if (!authorized(req.headers.authorization, config.token)) return send(res, 401, { error: 'unauthorized' });
    if (active >= config.maxConcurrent) return send(res, 503, { error: 'scanner_busy' });
    if (healthRequest) {
      if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))
        return send(res, 400, { error: 'invalid_request' });
      active += 1;
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([health(config, controller.signal), new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error()); }, 3000);
        })]);
        send(res, 200, { protocolVersion: 1, checkedAt: new Date().toISOString(), ...result });
      } catch { send(res, 503, { error: 'scanner_unavailable' }); }
      finally { clearTimeout(timer); controller.abort(); active -= 1; }
      return;
    }
    const length = req.headers['content-length'];
    const sha256 = req.headers['x-content-sha256'];
    const requestId = req.headers['x-scan-request-id'];
    if (req.headers['content-type'] !== 'application/octet-stream' || req.headers['content-encoding'] ||
        req.headers['transfer-encoding'] || req.headers['x-scan-protocol'] !== '1' ||
        typeof length !== 'string' || !/^[0-9]+$/.test(length) || Number(length) < 1 ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId))
      return send(res, 400, { error: 'invalid_request' });
    if (Number(length) > config.maxBytes) return send(res, 413, { error: 'document_too_large' });
    active += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      send(res, 504, { error: 'scanner_timeout' });
      req.destroy();
    }, config.timeoutMs);
    const closed = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', closed);
    try {
      const chunks = []; let byteLength = 0;
      for await (const chunk of req) {
        byteLength += chunk.length;
        if (controller.signal.aborted) throw new Error();
        if (byteLength > config.maxBytes || byteLength > Number(length)) {
          send(res, 413, { error: 'document_too_large' }); req.destroy(); return;
        }
        chunks.push(chunk);
      }
      if (byteLength !== Number(length)) { send(res, 400, { error: 'invalid_request' }); return; }
      const bytes = Buffer.concat(chunks, byteLength);
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) { send(res, 400, { error: 'content_mismatch' }); return; }
      const result = await scan(bytes, config, controller.signal);
      if (controller.signal.aborted) return;
      send(res, 200, { protocolVersion: 1, requestId, sha256, byteLength, scannedAt: new Date().toISOString(), ...result });
    } catch { send(res, controller.signal.aborted ? 504 : 503, { error: controller.signal.aborted ? 'scanner_timeout' : 'scanner_unavailable' }); }
    finally { clearTimeout(timer); res.off('close', closed); active -= 1; }
  };
  // Plain HTTP is opt-in for the private Cloudflare Container port only. The Worker terminates external TLS.
  // Never publish this port directly or use this mode for the standalone loopback service.
  const server = config.transport === 'cloudflare-private-http'
    ? http.createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, handler)
    : https.createServer({ cert: config.cert, key: config.key, minVersion: 'TLSv1.2', maxHeaderSize: 8192, handshakeTimeout: 5000, connectionsCheckingInterval: 1000 }, handler);
  server.headersTimeout = 5000;
  server.requestTimeout = config.timeoutMs;
  server.keepAliveTimeout = 1000;
  server.setTimeout(config.timeoutMs, socket => socket.destroy());
  server.maxHeadersCount = 16;
  server.maxRequestsPerSocket = 1;
  server.maxConnections = 16;
  // Reject Expect: 100-continue before accepting any body; the supported client never uses it.
  server.on('checkContinue', (_req, res) => send(res, 417, { error: 'invalid_request' }));
  server.on('clientError', (_error, socket) => { socket.destroy(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = scannerConfig();
    const server = createScannerServer(config);
    server.on('error', () => { process.stderr.write('scanner_start_failed\n'); process.exitCode = 1; });
    server.listen(config.port, config.host, () => process.stdout.write('scanner_ready\n'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      server.closeAllConnections(); server.close(() => { process.exitCode = 0; });
    });
  } catch { process.stderr.write('invalid_scanner_configuration\n'); process.exitCode = 1; }
}
