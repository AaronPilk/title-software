#!/usr/bin/env node
/** Operator-run recovery. No implicit configuration, shell, decrypted Vault query, or cloud mutation. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';

const FORMAT = 'title-recovery-v1';
const MAX_MANIFEST = 16 * 1024 * 1024;
const MAX_OBJECTS = 100_000;
const MAX_ENTRY = 1024 ** 4;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ENV = /^[A-Z][A-Z0-9_]{2,100}$/;
class RecoveryError extends Error {}
const fail = message => { throw new RecoveryError(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\x00-\x1f]/.test(value);
const reference = value => nonempty(value) && !/^(REPLACE|TODO)\b/i.test(value);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const bytes = value => Readable.from([Buffer.isBuffer(value) ? value : Buffer.from(value)]);
const blackhole = () => new Writable({ write(_chunk, _encoding, next) { next(); } });
function secret(name) {
  if (!SAFE_ENV.test(name ?? '') || !process.env[name]) fail('Required secret environment variable is unavailable.');
  return process.env[name];
}
function archiveKey(config) {
  const value = secret(config.archiveKeyEnv);
  if (!HASH.test(value)) fail('Archive key must be 32 random bytes encoded as 64 lowercase hex characters.');
  return Buffer.from(value, 'hex');
}
export function dbConnection(envName) {
  let url; try { url = new URL(secret(envName)); } catch { fail('Invalid database connection environment variable.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.search || url.hash || !url.pathname.slice(1)) fail('Use a PostgreSQL URL without query parameters. Configure TLS using sslMode.');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(database)) fail('Database name must be a simple PostgreSQL identifier.');
  return { host: url.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port: url.port || '5432', database, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}
function pgEnv(db, sslMode = 'verify-full') {
  if (!['verify-full', 'disable'].includes(sslMode)) fail('Unsupported TLS mode.');
  if (sslMode === 'disable' && !['127.0.0.1', '127.0.0.2', '127.0.0.3', '::1', 'localhost'].includes(db.host)) fail('TLS can only be disabled for local isolated fixtures.');
  return { PATH: process.env.PATH, LANG: 'C', PGHOST: db.host, PGPORT: db.port, PGDATABASE: db.database, PGUSER: db.user, PGPASSWORD: db.password, PGSSLMODE: sslMode, PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000' };
}
function processStream(config, name, args, db, input) {
  const executable = config.pgBin ? path.join(config.pgBin, name) : name;
  const child = spawn(executable, args, { env: pgEnv(db, config.sslMode), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  child.stderr.resume(); // Provider errors can contain data/credentials. Never surface their contents.
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60_000); timer.unref();
  const done = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(`${name} could not start.`)));
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${name} failed; confidential subprocess output was suppressed.`)); });
  });
  done.catch(() => {});
  if (input === null) { /* Caller streams authenticated archive bytes into stdin. */ }
  else if (input !== undefined) child.stdin.end(input);
  else if (name !== 'pg_restore') child.stdin.end();
  return { child, done };
}
async function sql(config, db, statement) {
  const { child, done } = processStream(config, 'psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], db, statement);
  const chunks = []; let count = 0;
  try { for await (const chunk of child.stdout) { count += chunk.length; if (count > MAX_MANIFEST) fail('Database inventory exceeds its bound.'); chunks.push(chunk); } await done; }
  catch (error) { child.kill(); await done.catch(() => {}); throw error; }
  return Buffer.concat(chunks).toString('utf8').trim();
}
async function jsonSql(config, db, statement) { return JSON.parse(await sql(config, db, statement)); }
const INVENTORY = `select coalesce(jsonb_agg(jsonb_build_object('bucket',b.id,'name',o.name,'size',(o.metadata->>'size')::bigint,'version',o.version,'updatedAt',o.updated_at,'referenceSha256',r.sha256,'referencesMatch',coalesce(r.hashes<=1 and r.sizes<=1 and r.bytes=(o.metadata->>'size')::bigint,true)) order by b.id,o.name),'[]'::jsonb)
 from storage.buckets b join storage.objects o on o.bucket_id=b.id
 left join lateral (select min(x.sha256) sha256,count(distinct x.sha256) hashes,min(x.byte_size) bytes,count(distinct x.byte_size) sizes from (
 select sha256,byte_size from public.title_assets where b.id='title-documents' and object_path=o.name
 union all select sha256,byte_size from title_private.jv_portal_attachments where b.id='title-documents' and object_path=o.name) x) r on true
 where b.public is not true;`;
function objectName(bucket, name) {
  if (!nonempty(bucket) || !/^[A-Za-z0-9_-]+$/.test(bucket) || typeof name !== 'string' || name.length > 2048 || name.split('/').some(s => !s || s === '.' || s === '..') || /[\\\x00-\x1f\x7f]/.test(name)) fail('Unsafe storage object path.');
  return `${bucket}/${name}`;
}
function inventoryValid(list, limit) {
  if (!Array.isArray(list) || list.length > MAX_OBJECTS) fail('Storage inventory exceeds its bound.');
  const seen = new Set();
  for (const item of list) { const name = objectName(item.bucket, item.name); if (seen.has(name) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > limit || item.referencesMatch !== true || (item.referenceSha256 !== null && !HASH.test(item.referenceSha256))) fail('Invalid or duplicate storage inventory entry.'); seen.add(name); }
}
function sourceSettings(config) {
  if (!['managed-supabase', 'isolated-fixture'].includes(config.source?.kind) || !nonempty(config.source?.id)) fail('Explicit source kind and identifier are required.');
  if (!reference(config.source.writeFreezeReference)) fail('Record a write-freeze procedure/evidence reference before exporting.');
  if (!reference(config.recovery?.owner) || !reference(config.recovery?.retentionReference) || !reference(config.recovery?.configurationReference) || !Number.isSafeInteger(config.recovery?.rpoMinutes) || config.recovery.rpoMinutes < 1 || !Number.isSafeInteger(config.recovery?.rtoMinutes) || config.recovery.rtoMinutes < 1) fail('Recovery owner, retention/configuration references and positive RPO/RTO minutes are required.');
  limits(config);
  const db = dbConnection(config.source.databaseUrlEnv);
  if (config.source.kind === 'managed-supabase') {
    if (!/^[a-z0-9]{20}$/.test(config.source.id) || !reference(config.recovery.vaultKeyEscrowReference) || !SAFE_ENV.test(config.source.vaultRootKeyEnv ?? '') || !SAFE_ENV.test(config.source.serviceKeyEnv ?? '')) fail('Managed Vault export requires a source project and independently escrowed root-key prerequisite.');
    const storageUrl = new URL(config.source.storageUrl);
    if (storageUrl.href !== `https://${config.source.id}.supabase.co/`) fail('Storage origin must match the source Supabase project.');
    if (db.host !== `db.${config.source.id}.supabase.co` || db.database !== 'postgres') fail('Managed export requires the source project direct database hostname and postgres database.');
  } else if (!['127.0.0.1', '127.0.0.2', '127.0.0.3', '::1'].includes(db.host)) {
    fail('Isolated fixture source must be a loopback database.');
  }
  return db;
}
function limits(config) {
  if (!Number.isSafeInteger(config.maxEntryBytes) || config.maxEntryBytes < 1 || config.maxEntryBytes > MAX_ENTRY || !Number.isSafeInteger(config.maxTotalBytes) || config.maxTotalBytes < config.maxEntryBytes || config.maxTotalBytes > 10 * MAX_ENTRY) fail('Set bounded maxEntryBytes and maxTotalBytes.');
}
export function exportPlan(config) {
  // No connection, object reads or output files. Secrets are not printed.
  sourceSettings(config);
  return { format: FORMAT, dryRun: true, source: config.source.id, includes: ['full PostgreSQL custom dump, including auth/title_private/Vault ciphertext', 'database role definitions without passwords', 'every object in every private Storage bucket, including unadopted/removed attachments', 'encrypted Vault root-key escrow (managed source only)', 'checked-in migration/config evidence'], limitations: ['Requires a verified write-freeze window spanning the database and storage capture.', 'Cloudflare Durable Object assistant history is excluded; retain separately or approve its loss.', 'Provider configuration, passwords, Edge/Worker secrets and external services require the referenced independent recovery procedure.', 'Managed project restore remains provider-assisted; native restore is only for an isolated empty nonproduction cluster.'] };
}
async function encryptedWrite(dir, name, input, key, archiveId, limit) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${FORMAT}/${archiveId}/${name}`));
  const target = path.join(dir, name), fd = await fsp.open(target, 'wx', 0o600);
  const digest = createHash('sha256'); let length = 0;
  const meter = new Transform({ transform(chunk, _encoding, next) { length += chunk.length; if (length > limit) return next(new Error('Recovery entry exceeds its byte limit.')); digest.update(chunk); next(null, chunk); } });
  try {
    await fd.write(iv);
    await pipeline(input, meter, cipher, fs.createWriteStream(target, { fd: fd.fd, start: 12, autoClose: false }));
    await fd.write(cipher.getAuthTag(), 0, 16, length + 12);
    await fd.sync();
    return { name, bytes: length, sha256: digest.digest('hex') };
  } finally { await fd.close().catch(error => { if (error.code !== 'EBADF') throw error; }); }
}
async function decrypt(dir, entry, key, archiveId, output, limit) {
  if (!/^(?:manifest|[0-9]{8})\.enc$/.test(entry.name)) fail('Unsafe encrypted entry name.');
  const fd = await fsp.open(path.join(dir, entry.name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size < 28 || stat.size - 28 > limit || (entry.bytes !== undefined && stat.size !== entry.bytes + 28)) fail('Encrypted entry has an invalid size.');
    const iv = Buffer.alloc(12), tag = Buffer.alloc(16); await fd.read(iv, 0, 12, 0); await fd.read(tag, 0, 16, stat.size - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(Buffer.from(`${FORMAT}/${archiveId}/${entry.name}`)); decipher.setAuthTag(tag);
    const digest = createHash('sha256'); let count = 0;
    const meter = new Transform({ transform(chunk, _encoding, next) { count += chunk.length; if (count > limit) return next(new Error('Decrypted entry exceeds its bound.')); digest.update(chunk); next(null, chunk); } });
    const stream = stat.size === 28 ? bytes('') : fs.createReadStream('', { fd: fd.fd, start: 12, end: stat.size - 17, autoClose: false });
    await pipeline(stream, decipher, meter, output);
    const sha256 = digest.digest('hex');
    if ((entry.sha256 && entry.sha256 !== sha256) || (entry.bytes !== undefined && entry.bytes !== count)) fail('Recovery entry integrity mismatch.');
    return { bytes: count, sha256 };
  } catch { fail('Encrypted recovery entry failed authentication or integrity verification.'); }
  finally { await fd.close().catch(error => { if (error.code !== 'EBADF') throw error; }); }
}
async function decryptBuffer(dir, entry, key, id, limit) {
  const chunks = [];
  await decrypt(dir, entry, key, id, new Writable({ write(chunk, _e, next) { chunks.push(chunk); next(); } }), limit);
  return Buffer.concat(chunks);
}
async function localObject(root, bucket, name) {
  const rel = objectName(bucket, name), target = path.join(root, rel);
  const realRoot = await fsp.realpath(root), realTarget = await fsp.realpath(target);
  if (!realTarget.startsWith(realRoot + path.sep)) fail('Storage object escapes its source directory.');
  const fd = await fsp.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  if (!(await fd.stat()).isFile()) { await fd.close(); fail('Storage object is not a regular file.'); }
  return fd.createReadStream();
}
async function objectStream(config, item) {
  if (config.source.kind === 'isolated-fixture') return localObject(config.source.objectDirectory, item.bucket, item.name);
  const endpoint = new URL(`storage/v1/object/authenticated/${objectName(item.bucket, item.name).split('/').map(encodeURIComponent).join('/')}`, config.source.storageUrl);
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${secret(config.source.serviceKeyEnv)}`, apikey: secret(config.source.serviceKeyEnv) }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body || (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== item.size)) { await response.body?.cancel(); fail('Private storage object download failed or changed.'); }
  return Readable.fromWeb(response.body);
}
async function evidenceFiles(config) {
  const repo = await fsp.realpath(config.repository), results = [];
  const names = (await fsp.readdir(path.join(repo, 'supabase/migrations'))).filter(name => /^[0-9]{14}_[a-z0-9_]+\.sql$/.test(name)).map(name => `supabase/migrations/${name}`);
  if (names.length > 1000) fail('Schema reference count exceeds its bound.');
  names.push('supabase/config.toml', 'services/title-applications/wrangler.jsonc', 'services/title-assistant/wrangler.jsonc');
  let total = 0;
  for (const name of names) {
    const location = await fsp.realpath(path.join(repo, name)); if (!location.startsWith(repo + path.sep)) fail('Schema/config reference escapes repository.');
    const stat = await fsp.stat(location); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) fail('Schema/config reference exceeds its bound.');
    total += stat.size; if (total > MAX_MANIFEST) fail('Schema/config reference collection exceeds its bound.');
    results.push({ path: name, data: await fsp.readFile(location) });
  }
  return results;
}
export async function exportBundle(config, destination) {
  const db = sourceSettings(config), key = archiveKey(config), archiveId = randomUUID();
  const rootKey = config.source.kind === 'managed-supabase' ? secret(config.source.vaultRootKeyEnv) : null;
  if (rootKey !== null && !HASH.test(rootKey)) fail('Escrowed managed Vault root key has invalid format.');
  if (config.source.kind === 'managed-supabase') secret(config.source.serviceKeyEnv);
  await fsp.mkdir(path.dirname(path.resolve(destination)), { recursive: true, mode: 0o700 });
  if (await fsp.lstat(destination).catch(() => null)) fail('Recovery output already exists.');
  const stage = await fsp.mkdtemp(path.join(path.dirname(path.resolve(destination)), '.recovery-encrypted-'));
  await fsp.chmod(stage, 0o700);
  const manifest = { format: FORMAT, archiveId, createdAt: new Date().toISOString(), source: { id: config.source.id, kind: config.source.kind, host: db.host, database: db.database }, recovery: config.recovery, writeFreezeReference: config.source.writeFreezeReference, entries: [], objects: [], roles: [], serverVersion: '', limitations: exportPlan(config).limitations };
  let total = 0;
  const add = async (kind, stream, extra = {}, limit = config.maxEntryBytes) => {
    const name = `${String(manifest.entries.length).padStart(8, '0')}.enc`;
    const entry = { ...await encryptedWrite(stage, name, stream, key, archiveId, Math.min(limit, config.maxEntryBytes, config.maxTotalBytes - total)), kind, ...extra };
    total += entry.bytes; if (total > config.maxTotalBytes) fail('Recovery archive exceeds its total bound.'); manifest.entries.push(entry); return entry;
  };
  try {
    const inventory = await jsonSql(config, db, INVENTORY); inventoryValid(inventory, config.maxEntryBytes);
    const schemas = await jsonSql(config, db, `select jsonb_agg(nspname) from pg_namespace where nspname in ('auth','storage','title_private','vault','public');`);
    if (!['auth', 'storage', 'title_private', 'vault', 'public'].every(name => schemas.includes(name))) fail('Required private/Auth/Vault schemas are missing.');
    if (await sql(config, db, `select bool_and(to_regclass(name) is not null) from unnest(array['auth.users','storage.buckets','storage.objects','public.title_workspaces','public.title_memberships','public.title_audit','public.title_jv_intakes','title_private.jv_portal_invites','title_private.jv_portal_attachments','vault.secrets']) name;`) !== 't') fail('Required private/Auth/Vault tables are missing.');
    manifest.serverVersion = await sql(config, db, 'show server_version_num;');
    manifest.source.bootstrapRole = await sql(config, db, 'select rolname from pg_roles where oid=10;');
    manifest.roles = await jsonSql(config, db, `select coalesce(jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls) order by rolname),'[]') from pg_roles where rolname !~ '^pg_';`);
    manifest.roleMemberships = await jsonSql(config, db, `select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'admin',a.admin_option) order by r.rolname,m.rolname),'[]') from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member;`);
    if (config.source.kind === 'managed-supabase') {
      manifest.vaultKeyFingerprint = hash(rootKey);
      await add('vault-root-key', bytes(rootKey), {}, 64);
    }
    const rolesDump = processStream(config, 'pg_dumpall', ['--roles-only', '--no-role-passwords', '--no-password', '--quote-all-identifiers'], db);
    try { await add('roles', rolesDump.child.stdout, {}, MAX_MANIFEST); await rolesDump.done; } catch (error) { rolesDump.child.kill(); await rolesDump.done.catch(() => {}); throw error; }
    const dump = processStream(config, 'pg_dump', ['--format=custom', '--no-password', '--serializable-deferrable'], db);
    try { await add('database', dump.child.stdout); await dump.done; } catch (error) { dump.child.kill(); await dump.done.catch(() => {}); throw error; }
    for (const item of inventory) {
      const entry = await add('object', await objectStream(config, item), { object: item }, item.size);
      if (entry.bytes !== item.size) fail('Storage object size changed during capture.');
      if (item.referenceSha256 && entry.sha256 !== item.referenceSha256) fail('Stored original hash differs from its registered reference.');
      manifest.objects.push({ ...item, entry: entry.name });
    }
    for (const file of await evidenceFiles(config)) await add('repository-evidence', bytes(file.data), { path: file.path }, 2 * 1024 * 1024);
    const after = await jsonSql(config, db, INVENTORY);
    if (JSON.stringify(inventory) !== JSON.stringify(after)) fail('Storage inventory changed; repeat export in a verified write-freeze window.');
    const encoded = Buffer.from(JSON.stringify(manifest)); if (encoded.length > MAX_MANIFEST) fail('Recovery manifest exceeds its bound.');
    await encryptedWrite(stage, 'manifest.enc', bytes(encoded), key, archiveId, MAX_MANIFEST);
    await fsp.writeFile(path.join(stage, 'bundle.json'), JSON.stringify({ format: FORMAT, archiveId }), { mode: 0o600, flag: 'wx' });
    if (await fsp.lstat(destination).catch(() => null)) fail('Recovery output already exists.');
    await fsp.rename(stage, destination);
    return { complete: true, archiveId, encryptedEntries: manifest.entries.length, objectCount: inventory.length, plaintextBytes: total, managedRestoreReady: false };
  } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}
export async function verifyBundle(config, directory) {
  limits(config);
  const markerPath = path.join(directory, 'bundle.json');
  const markerStat = await fsp.lstat(markerPath); if (!markerStat.isFile() || markerStat.size > 512) fail('Invalid recovery marker.');
  const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  if (marker.format !== FORMAT || !/^[a-f0-9-]{36}$/.test(marker.archiveId)) fail('Invalid recovery format.');
  const key = archiveKey(config);
  const manifest = JSON.parse((await decryptBuffer(directory, { name: 'manifest.enc' }, key, marker.archiveId, MAX_MANIFEST)).toString('utf8'));
  if (manifest.format !== FORMAT || manifest.archiveId !== marker.archiveId || !Array.isArray(manifest.entries) || manifest.entries.length > MAX_OBJECTS + 1000 || !Array.isArray(manifest.objects)) fail('Invalid recovery manifest.');
  if (!['managed-supabase', 'isolated-fixture'].includes(manifest.source?.kind) || !nonempty(manifest.source?.host) || !nonempty(manifest.source?.id) || !nonempty(manifest.source?.bootstrapRole) || !Array.isArray(manifest.roles) || manifest.roles.length > 10_000 || !Array.isArray(manifest.roleMemberships) || manifest.roleMemberships.length > 100_000 || !/^[0-9]{5,6}$/.test(manifest.serverVersion)) fail('Invalid source/role inventory.');
  const roleNames = new Set();
  for (const role of manifest.roles) {
    if (!nonempty(role.name) || role.name.length > 63 || roleNames.has(role.name) || ['superuser','inherit','createRole','createDb','login','replication','bypassRls'].some(field => typeof role[field] !== 'boolean')) fail('Invalid role definition.');
    roleNames.add(role.name);
  }
  for (const grant of manifest.roleMemberships) if ((!roleNames.has(grant.role) && !/^pg_[a-z0-9_]+$/.test(grant.role)) || (!roleNames.has(grant.member) && !/^pg_[a-z0-9_]+$/.test(grant.member)) || typeof grant.admin !== 'boolean') fail('Invalid role membership.');
  inventoryValid(manifest.objects, config.maxEntryBytes);
  const names = new Set(['manifest.enc', 'bundle.json']), entriesByName = new Map(); let total = 0;
  for (const entry of manifest.entries) {
    if (!/^[0-9]{8}\.enc$/.test(entry.name) || names.has(entry.name) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > config.maxEntryBytes || !HASH.test(entry.sha256) || !['database', 'roles', 'object', 'vault-root-key', 'repository-evidence'].includes(entry.kind)) fail('Invalid recovery entry.');
    names.add(entry.name); entriesByName.set(entry.name, entry); total += entry.bytes; if (total > config.maxTotalBytes) fail('Recovery archive exceeds its total bound.');
    if (entry.kind === 'object') objectName(entry.object?.bucket, entry.object?.name);
    await decrypt(directory, entry, key, marker.archiveId, blackhole(), config.maxEntryBytes);
  }
  if (manifest.entries.filter(e => e.kind === 'roles').length !== 1 || manifest.entries.filter(e => e.kind === 'database').length !== 1 || manifest.entries.filter(e => e.kind === 'object').length !== manifest.objects.length || manifest.objects.some(({ entry, ...object }) => {
    const value = entriesByName.get(entry); return !value || value.kind !== 'object' || JSON.stringify(value.object) !== JSON.stringify(object) || value.bytes !== object.size || (object.referenceSha256 && value.sha256 !== object.referenceSha256);
  })) fail('Incomplete database/object manifest.');
  if (manifest.source?.kind === 'managed-supabase' && (manifest.entries.filter(e => e.kind === 'vault-root-key').length !== 1 || !HASH.test(manifest.vaultKeyFingerprint))) fail('Managed Vault recovery prerequisite missing.');
  if (manifest.source.kind === 'managed-supabase') {
    const root = await decryptBuffer(directory, manifest.entries.find(e => e.kind === 'vault-root-key'), key, marker.archiveId, 64);
    if (!HASH.test(root.toString('utf8')) || hash(root) !== manifest.vaultKeyFingerprint) fail('Managed Vault key escrow fingerprint mismatch.');
  }
  if ((await fsp.readdir(directory)).some(name => !names.has(name))) fail('Unexpected file in recovery bundle.');
  return manifest;
}
async function differentHost(source, target) {
  if (source.toLowerCase() === target.toLowerCase()) fail('Restore target must not use the source database host, even with a different port or database.');
  const [left, right] = await Promise.all([lookup(source, { all: true }), lookup(target, { all: true })]);
  if (left.some(a => right.some(b => a.address === b.address))) fail('Restore target resolves to the source host.');
}
export async function restorePlan(config, directory) {
  const manifest = await verifyBundle(config, directory);
  return { dryRun: true, archiveId: manifest.archiveId, objectCount: manifest.objects.length, sourceKind: manifest.source.kind,
    nativeRestoreAllowed: manifest.source.kind === 'isolated-fixture',
    steps: ['Keep source intact; use a distinct, isolated nonproduction target.', 'Recover the database, Auth state, memberships, private schemas and Vault ciphertext together.', 'Managed Supabase: arrange provider-supported restore and root-key preservation/import before decrypting private data; this CLI does not change managed keys or replay a full dump into managed system schemas.', 'Restore every private object, including unadopted/retained portal attachments; reconcile exact names, sizes and hashes.', 'Restore reviewed platform configuration and secrets through independent secret recovery; leave outgoing integrations disabled.', 'Verify private payload decryptability, role/RLS denials, staff isolation and original-byte hashes. Invalidate recovered sessions/capabilities before any production promotion.'],
    limitations: manifest.limitations };
}
export async function restoreNative(config, directory, confirmation) {
  const manifest = await verifyBundle(config, directory);
  if (manifest.source.kind !== 'isolated-fixture') fail('Managed Supabase restore is blocked: use the provider-assisted plan and independently verify root-key/platform recovery.');
  if (config.target?.kind !== 'isolated-native' || config.target?.environment !== 'nonproduction' || !/^title_recovery_[a-z0-9_]{1,40}$/.test(config.target.databaseName ?? '')) fail('Explicit isolated nonproduction target and a new title_recovery_ database name are required.');
  const db = dbConnection(config.target.databaseUrlEnv);
  if (db.database !== 'postgres') fail('Disposable target connection must use its empty postgres administration database.');
  await differentHost(manifest.source.host, db.host);
  if (!['127.0.0.1', '127.0.0.2', '127.0.0.3', '::1'].includes(db.host)) fail('Native automated restore is restricted to isolated loopback PostgreSQL.');
  if (confirmation !== `RESTORE ${manifest.archiveId} INTO ${config.target.databaseName}`) fail('Exact archive/target confirmation is required.');
  const destination = path.resolve(config.target.objectDirectory);
  if (await fsp.lstat(destination).catch(() => null)) fail('Target object directory must not already exist.');
  if (await sql(config, db, `select count(*) from pg_database where datname=${literal(config.target.databaseName)};`) !== '0') fail('Restore target database already exists.');
  if (await sql(config, db, "select count(*) from pg_database where datname not in ('postgres','template0','template1');") !== '0' || await sql(config, db, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_' and c.relkind in ('r','p','v','m','S','f');") !== '0') fail('Disposable target cluster contains existing data.');
  if ((await sql(config, db, 'show server_version_num;')).slice(0, 2) !== manifest.serverVersion.slice(0, 2)) fail('Native drill requires matching PostgreSQL major versions.');
  const existing = JSON.parse(await sql(config, db, `select jsonb_agg(rolname) from pg_roles where rolname !~ '^pg_';`));
  if (existing.length !== 1 || existing[0] !== db.user) fail('Native restore requires a disposable cluster containing only its bootstrap role.');
  if (db.user !== manifest.source.bootstrapRole || await sql(config, db, 'select rolname from pg_roles where oid=10;') !== db.user) fail('Disposable target must use the source bootstrap role name to preserve PostgreSQL grantor semantics.');
  const key = archiveKey(config); let created = false, objectsCreated = false;
  try {
    // PostgreSQL grantor identity distinguishes the OID-10 bootstrap superuser.
    // Keep that identity; omit only its exact CREATE ROLE, never ignore SQL errors.
    const roleScript = (await decryptBuffer(directory, manifest.entries.find(e => e.kind === 'roles'), key, manifest.archiveId, MAX_MANIFEST)).toString('utf8');
    const bootstrapCreate = `CREATE ROLE ${quote(db.user)};`;
    if (roleScript.split('\n').filter(line => line === bootstrapCreate).length !== 1) fail('Bootstrap role declaration is not unambiguous.');
    const roles = processStream(config, 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], db, roleScript.split('\n').filter(line => line !== bootstrapCreate).join('\n')); roles.child.stdout.resume();
    await roles.done;
    for (const role of manifest.roles) if (role.name !== db.user) await sql(config, db, `alter role ${quote(role.name)} NOLOGIN;`);
    await sql(config, db, `create database ${quote(config.target.databaseName)} template template0;`); created = true;
    const target = { ...db, database: config.target.databaseName };
    const restore = processStream(config, 'pg_restore', ['--exit-on-error', '--single-transaction', '--dbname', config.target.databaseName], target);
    try { await decrypt(directory, manifest.entries.find(e => e.kind === 'database'), key, manifest.archiveId, restore.child.stdin, config.maxEntryBytes); await restore.done; }
    catch (error) { restore.child.kill(); await restore.done.catch(() => {}); throw error; }
    const restoredInventory = await jsonSql(config, target, INVENTORY);
    if (JSON.stringify(restoredInventory) !== JSON.stringify(manifest.objects.map(({ entry, ...item }) => item))) fail('Restored database object inventory differs from archive.');
    await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fsp.mkdir(destination, { mode: 0o700 }); objectsCreated = true;
    for (const entry of manifest.entries.filter(e => e.kind === 'object')) {
      const location = path.join(destination, objectName(entry.object.bucket, entry.object.name)); await fsp.mkdir(path.dirname(location), { recursive: true, mode: 0o700 });
      await decrypt(directory, entry, key, manifest.archiveId, fs.createWriteStream(location, { flags: 'wx', mode: 0o600 }), config.maxEntryBytes);
    }
    await fsp.writeFile(path.join(destination, 'RECOVERY-COMPLETE.json'), JSON.stringify({ archiveId: manifest.archiveId, completedAt: new Date().toISOString(), productionReady: false }), { mode: 0o600, flag: 'wx' });
    return { restored: true, archiveId: manifest.archiveId, database: config.target.databaseName, objects: manifest.objects.length, productionReady: false, next: 'Run private payload, membership, permissions and exact-byte acceptance. Keep target isolated; no promotion is performed.' };
  } catch (error) {
    if (objectsCreated) await fsp.rm(destination, { recursive: true, force: true });
    if (created) {
      try { await sql(config, db, `drop database ${quote(config.target.databaseName)} with (force);`); }
      catch { fail('Restore and cleanup failed. Keep the disposable target cluster offline and retire it manually.'); }
    }
    throw error;
  }
}
async function main() {
  const [command, configPath, bundlePath, ...extra] = process.argv.slice(2);
  if (!['plan', 'export', 'verify', 'restore-plan', 'restore-native'].includes(command) || !configPath || extra.length > 1) fail('Usage: node ops/recovery/recovery.mjs plan|export|verify|restore-plan|restore-native CONFIG [BUNDLE] [CONFIRMATION]');
  const stat = await fsp.stat(configPath); if (stat.size > 32_768) fail('Recovery configuration exceeds its bound.');
  const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
  let result;
  if (command === 'plan') result = exportPlan(config);
  else if (!bundlePath) fail('Explicit bundle path is required.');
  else if (command === 'export') {
    if (extra[0] !== `EXPORT ${config.source?.id}`) fail('Run plan first; export requires the exact confirmation EXPORT <source-id>.');
    result = await exportBundle(config, bundlePath);
  } else if (command === 'verify') { const manifest = await verifyBundle(config, bundlePath); result = { verified: true, archiveId: manifest.archiveId, encryptedEntries: manifest.entries.length, objects: manifest.objects.length, managedRestoreReady: false }; }
  else if (command === 'restore-plan') result = await restorePlan(config, bundlePath);
  else result = await restoreNative(config, bundlePath, extra[0]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Recovery stopped: ${error instanceof RecoveryError ? error.message : 'An operation failed; confidential filesystem, database and provider details were suppressed.'}\n`); process.exitCode = 1; });
