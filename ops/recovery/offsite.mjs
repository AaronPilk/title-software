#!/usr/bin/env node
/** Operator-only encrypted transport. Never reads database credentials or decrypts into persistent files. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyBundle } from './recovery.mjs';

const PROTOCOL = 'title-offsite-v1';
const CHUNK = 8 * 1024 * 1024;
const MAX_CHUNKS = 100_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const FILE = /^(?:bundle\.json|manifest\.enc|[0-9]{8}\.enc)$/;
class OffsiteError extends Error {}
const fail = message => { throw new OffsiteError(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const env = name => {
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(name ?? '') || !process.env[name]) fail('Required offsite secret environment variable is unavailable.');
  return process.env[name];
};
function settings(config) {
  const o = config.offsite;
  let endpoint; try { endpoint = new URL(o?.endpoint); } catch { fail('Set the approved HTTPS backup transport endpoint.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || endpoint.port) fail('Backup endpoint must be an HTTPS origin without credentials, path, query or port.');
  if (!/^[a-z0-9]{20}$/.test(config.source?.id ?? '') || !UUID.test(o?.destinationId ?? '') || !['same-account','independent-account'].includes(o.accountBoundary)) fail('Explicit source, destination and account boundary are required.');
  if (!Number.isSafeInteger(o.maxCiphertextBytes) || o.maxCiphertextBytes < 1 || o.maxCiphertextBytes > CHUNK * MAX_CHUNKS) fail('Set bounded ciphertext capacity, at most 800,000 MiB.');
  if (typeof o.retentionEvidence !== 'string' || o.retentionEvidence.length < 3 || o.retentionEvidence.length > 500 || /^(REPLACE|TODO)\b/i.test(o.retentionEvidence)) fail('Record independently verified bucket retention and account-control evidence.');
  const key = env(config.archiveKeyEnv);
  if (!HASH.test(key)) fail('Archive encryption key format is invalid.');
  return { ...o, endpoint, sourceId: config.source.id, key: Buffer.from(key, 'hex') };
}
const sign = (o, payload) => createHmac('sha256', o.key).update(PROTOCOL + '\n').update(JSON.stringify(payload)).digest('hex');
function token(o, mode) {
  const value = env(mode === 'write' ? o.writerTokenEnv : o.readerTokenEnv);
  if (!HASH.test(value)) fail('Offsite tokens must be 32 random bytes encoded as lowercase hex.');
  return value;
}
async function request(o, mode, suffix, options = {}) {
  const { headers = {}, ...rest } = options;
  try {
    return await fetch(new URL(suffix, o.endpoint), { ...rest, headers: {
      authorization: `Bearer ${token(o, mode)}`, 'x-title-source': o.sourceId,
      'x-title-destination': o.destinationId, ...headers
    }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  } catch (error) { if (error instanceof OffsiteError) throw error; fail('Backup transport request failed; provider details were suppressed.'); }
}
async function bounded(response, limit) {
  const announced = response.headers.get('content-length');
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > limit)) { await response.body?.cancel(); fail('Remote response exceeds its bound.'); }
  if (!response.body) fail('Remote response body is missing.');
  const reader = response.body.getReader(), pieces = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > limit) { await reader.cancel(); fail('Remote response exceeds its bound.'); } pieces.push(item.value); } }
  finally { reader.releaseLock(); }
  if (announced !== null && Number(announced) !== size) fail('Remote response length differs.');
  return Buffer.concat(pieces, size);
}
async function checkEndpoint(o, mode) {
  const r = await request(o, mode, '/v1/info'); if (!r.ok) { await r.body?.cancel(); fail('Backup transport authentication or configuration failed.'); }
  let info; try { info = JSON.parse((await bounded(r, 4096)).toString('utf8')); } catch { fail('Invalid backup endpoint metadata.'); }
  if (info.protocol !== PROTOCOL || info.sourceId !== o.sourceId || info.destinationId !== o.destinationId || info.accountBoundary !== o.accountBoundary || info.maxChunkBytes !== CHUNK) fail('Backup endpoint does not match the approved source/destination binding.');
}
async function readFileChunks(directory, file, visit) {
  const fd = await fsp.open(path.join(directory, file.name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat(); if (!stat.isFile() || stat.size !== file.bytes) fail('Encrypted bundle changed during transport.');
    const digest = createHash('sha256'); let offset = 0, index = 0;
    while (offset < file.bytes) {
      const data = Buffer.alloc(Math.min(CHUNK, file.bytes - offset));
      let used = 0;
      while (used < data.length) { const { bytesRead } = await fd.read(data, used, data.length - used, offset + used); if (!bytesRead) fail('Encrypted bundle truncated during transport.'); used += bytesRead; }
      digest.update(data); await visit(data, index++); offset += data.length;
    }
    if (file.sha256 && digest.digest('hex') !== file.sha256) fail('Encrypted bundle changed during transport.');
    return index;
  } finally { await fd.close(); }
}
async function describe(config, directory, o) {
  const manifest = await verifyBundle(config, directory);
  if (manifest.source.id !== o.sourceId || !UUID.test(manifest.archiveId)) fail('Archive belongs to another source.');
  const names = ['bundle.json', 'manifest.enc', ...manifest.entries.map(e => e.name)].sort();
  const files = []; let totalBytes = 0, chunks = 0;
  for (const name of names) {
    const stat = await fsp.lstat(path.join(directory, name));
    if (!FILE.test(name) || !stat.isFile() || stat.size < 1) fail('Unexpected encrypted archive file.');
    totalBytes += stat.size; if (totalBytes > o.maxCiphertextBytes) fail('Archive exceeds approved offsite capacity.');
    const file = { name, bytes: stat.size, sha256: '', chunks: [] }, digest = createHash('sha256');
    await readFileChunks(directory, file, async data => { if (++chunks > MAX_CHUNKS) fail('Archive transport chunk count exceeds its bound.'); digest.update(data); file.chunks.push({ sha256: hash(data), bytes: data.length }); });
    file.sha256 = digest.digest('hex'); files.push(file);
  }
  // Authenticate the complete set again after deriving its ciphertext inventory.
  await verifyBundle(config, directory);
  const payload = { protocol: PROTOCOL, archiveId: manifest.archiveId, sourceId: o.sourceId, destinationId: o.destinationId,
    accountBoundary: o.accountBoundary, capturedAt: manifest.createdAt, totalBytes, files };
  const receipt = { payload, hmac: sign(o, payload) }, data = Buffer.from(JSON.stringify(receipt));
  if (data.length > CHUNK) fail('Archive receipt exceeds its bound.');
  return { payload, data };
}
export async function offsitePlan(config, directory) {
  const o = settings(config), { payload } = await describe(config, directory, o);
  return { dryRun: true, archiveId: payload.archiveId, sourceId: o.sourceId, destinationId: o.destinationId, accountBoundary: o.accountBoundary,
    files: payload.files.length, ciphertextBytes: payload.totalBytes, retentionVerifiedByTool: false,
    limitation: o.accountBoundary === 'same-account' ? 'Additional provider copy; not independent Cloudflare account recovery.' : 'Independent account is operator-declared; verify ownership, retention and recovery credentials separately.' };
}
async function put(o, archiveId, name, data) {
  const digest = hash(data), suffix = `/v1/archives/${archiveId}/${name}`;
  const r = await request(o, 'write', suffix, { method: 'PUT', body: data, headers: { 'content-type': 'application/octet-stream', 'x-title-sha256': digest } });
  if (r.status !== 201 && r.status !== 409) { await r.body?.cancel(); fail('Encrypted object upload failed.'); }
  await r.body?.cancel();
  const h = await request(o, 'write', suffix, { method: 'HEAD' });
  if (!h.ok || h.headers.get('content-length') !== String(data.length) || h.headers.get('x-title-sha256') !== digest) { await h.body?.cancel(); fail('Stored object differs from the verified archive.'); }
}
export async function uploadOffsite(config, directory) {
  const o = settings(config), { payload, data } = await describe(config, directory, o);
  await checkEndpoint(o, 'write');
  for (const file of payload.files) await readFileChunks(directory, file, async (chunk, index) => {
    if (hash(chunk) !== file.chunks[index]?.sha256) fail('Encrypted bundle changed during transport.');
    await put(o, payload.archiveId, file.chunks[index].sha256, chunk);
  });
  // The signed receipt is create-only and published only after all chunks passed server hash checks.
  await put(o, payload.archiveId, 'receipt.json', data);
  return { uploaded: true, archiveId: payload.archiveId, sourceId: o.sourceId, destinationId: o.destinationId, ciphertextBytes: payload.totalBytes,
    accountBoundary: o.accountBoundary, remoteRecoveryVerified: false, next: 'Fetch with the separately controlled read credential and verify every encrypted entry.' };
}
function validateReceipt(o, receipt, archiveId) {
  const p = receipt?.payload;
  if (!HASH.test(receipt?.hmac ?? '') || !p || !timingSafeEqual(Buffer.from(receipt.hmac, 'hex'), Buffer.from(sign(o, p), 'hex'))) fail('Backup receipt authentication failed.');
  if (p.protocol !== PROTOCOL || p.archiveId !== archiveId || p.sourceId !== o.sourceId || p.destinationId !== o.destinationId || p.accountBoundary !== o.accountBoundary) fail('Backup receipt is bound to another archive, source or destination.');
  if (!Array.isArray(p.files) || p.files.length < 3 || p.files.length > 101_002 || !Number.isSafeInteger(p.totalBytes) || p.totalBytes < 1 || p.totalBytes > o.maxCiphertextBytes) fail('Invalid backup receipt capacity.');
  const names = new Set(); let total = 0, count = 0;
  for (const file of p.files) {
    if (!FILE.test(file.name) || names.has(file.name) || !HASH.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > o.maxCiphertextBytes || !Array.isArray(file.chunks) || !file.chunks.length) fail('Invalid backup file inventory.');
    names.add(file.name); let size = 0;
    for (let i = 0; i < file.chunks.length; i++) { const c = file.chunks[i]; if (++count > MAX_CHUNKS || !HASH.test(c.sha256 ?? '') || !Number.isSafeInteger(c.bytes) || c.bytes < 1 || c.bytes > CHUNK || (i < file.chunks.length - 1 && c.bytes !== CHUNK)) fail('Invalid backup chunk inventory.'); size += c.bytes; }
    if (size !== file.bytes) fail('Backup chunk total differs.'); total += size;
  }
  if (!names.has('bundle.json') || !names.has('manifest.enc') || total !== p.totalBytes) fail('Incomplete backup receipt.');
  return p;
}
export async function fetchOffsite(config, archiveId, destination) {
  const o = settings(config);
  if (!UUID.test(archiveId)) fail('Explicit archive UUID required.');
  if (await fsp.lstat(destination).catch(() => null)) fail('Recovery destination already exists.');
  await checkEndpoint(o, 'read');
  const r = await request(o, 'read', `/v1/archives/${archiveId}/receipt.json`);
  if (!r.ok) { await r.body?.cancel(); fail('Completed backup receipt is unavailable.'); }
  let receipt; try { receipt = JSON.parse((await bounded(r, CHUNK)).toString('utf8')); } catch { fail('Invalid completed backup receipt.'); }
  const p = validateReceipt(o, receipt, archiveId);
  const parent = path.dirname(path.resolve(destination)); await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const stage = await fsp.mkdtemp(path.join(parent, '.offsite-encrypted-')); await fsp.chmod(stage, 0o700);
  try {
    for (const file of p.files) {
      const fd = await fsp.open(path.join(stage, file.name), 'wx', 0o600), digest = createHash('sha256');
      try {
        for (const chunk of file.chunks) {
          const remote = await request(o, 'read', `/v1/archives/${archiveId}/${chunk.sha256}`);
          if (!remote.ok) { await remote.body?.cancel(); fail('An encrypted backup chunk is missing.'); }
          const data = await bounded(remote, chunk.bytes);
          if (data.length !== chunk.bytes || hash(data) !== chunk.sha256) fail('Encrypted backup chunk integrity failed.');
          digest.update(data); let offset = 0;
          while (offset < data.length) { const { bytesWritten } = await fd.write(data, offset, data.length - offset); if (!bytesWritten) fail('Encrypted backup file write stopped.'); offset += bytesWritten; }
        }
        if (digest.digest('hex') !== file.sha256) fail('Encrypted backup file integrity failed.');
        await fd.sync();
      } finally { await fd.close(); }
    }
    const manifest = await verifyBundle(config, stage);
    if (manifest.archiveId !== archiveId || manifest.source.id !== o.sourceId) fail('Recovered archive source binding differs.');
    // Reserve a new destination exclusively. An interruption marker prevents a crash
    // during publication from appearing as a complete, verifiable archive.
    await fsp.mkdir(destination, { mode: 0o700 });
    try {
      await fsp.writeFile(path.join(destination, '.offsite-incomplete'), 'incomplete', { mode: 0o600, flag: 'wx' });
      const names = (await fsp.readdir(stage)).sort((a, b) => Number(a === 'bundle.json') - Number(b === 'bundle.json'));
      for (const name of names) await fsp.rename(path.join(stage, name), path.join(destination, name));
      await fsp.unlink(path.join(destination, '.offsite-incomplete'));
    } catch (error) { await fsp.rm(destination, { recursive: true, force: true }); throw error; }
    await fsp.rmdir(stage);
    return { fetchedAndVerified: true, archiveId, sourceId: o.sourceId, destinationId: o.destinationId, files: p.files.length, objects: manifest.objects.length,
      accountBoundary: o.accountBoundary, hostedRestoreComplete: false, retentionVerifiedByTool: false };
  } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}
async function main() {
  const [command, configPath, value, destination, ...extra] = process.argv.slice(2);
  if (!['plan','upload','fetch'].includes(command) || !configPath || !value || extra.length || (command !== 'fetch' && destination) || (command === 'fetch' && !destination)) fail('Usage: node ops/recovery/offsite.mjs plan|upload CONFIG BUNDLE, or fetch CONFIG ARCHIVE_UUID NEW_DESTINATION');
  const stat = await fsp.stat(configPath); if (!stat.isFile() || stat.size > 32_768) fail('Invalid recovery configuration.');
  const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
  const result = command === 'plan' ? await offsitePlan(config, value) : command === 'upload' ? await uploadOffsite(config, value) : await fetchOffsite(config, value, destination);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(`Offsite transfer stopped: ${error instanceof OffsiteError ? error.message : 'Operation failed; confidential archive/provider details were suppressed.'}\n`); process.exitCode = 1;
});
