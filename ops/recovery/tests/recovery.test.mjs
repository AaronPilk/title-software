import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportPlan, exportBundle, verifyBundle, restoreNative, restorePlan } from '../recovery.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const dirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
const binary = name => { for (const dir of dirs) { const file = path.join(dir, name); try { fs.accessSync(file, fs.constants.X_OK); return file; } catch {} } throw new Error(`Local PostgreSQL executable ${name} is required. No hosted database is used.`); };
const bins = Object.fromEntries(['initdb', 'pg_ctl', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore'].map(name => [name, binary(name)]));
const hash = data => createHash('sha256').update(data).digest('hex');
const user = 'title_recovery_fixture';
const w = 'e8200000-0000-4000-8000-000000000010';
const owner = 'e8100000-0000-4000-8000-000000000010';
const staff = 'e8100000-0000-4000-8000-000000000011';
const invite = 'e8300000-0000-4000-8000-000000000010';
const privateText = 'FICTIONAL_RECOVERY_SSN_123456789_PRIVATE';
function command(name, args, input) { return execFileSync(bins[name], args, { input, encoding: 'utf8', maxBuffer: 8_000_000, stdio: ['pipe', 'pipe', 'pipe'] }); }
function sql(cluster, statement, db = 'postgres') { return command('psql', ['-X', '-h', cluster.host, '-p', cluster.port, '-U', cluster.user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-A', '-t'], statement).trim(); }
function startCluster(root, host, port, clusterUser = user) {
  const data = path.join(root, 'data'); fs.mkdirSync(root);
  command('initdb', ['-D', data, `--username=${clusterUser}`, '--auth-local=trust', '--auth-host=trust', '--no-locale']);
  command('pg_ctl', ['-D', data, '-l', path.join(root, 'server.log'), '-o', `-k ${root} -h ${host} -p ${port} -F`, '-w', 'start']);
  return { data, host, port, user: clusterUser, url: `postgresql://${clusterUser}@${host === '::1' ? '[::1]' : host}:${port}/postgres` };
}
function stopCluster(cluster) { if (cluster) command('pg_ctl', ['-D', cluster.data, '-m', 'immediate', '-w', 'stop']); }
async function fixture(source, dir) {
  // Reuse the existing application SQL runner's exact pgcrypto-backed Vault fixture.
  // This fixture validates recovery of encrypted envelopes, not hosted Vault cryptography.
  const runner = fs.readFileSync(path.join(repo, 'web/scripts/backend/test-jv-portal-sql.mjs'), 'utf8');
  const vault = runner.match(/sql\(`(create extension pgcrypto;create schema vault;[\s\S]*?revoke all on all functions in schema vault from public,anon,authenticated,service_role;)`\);/);
  assert.ok(vault, 'Existing isolated Vault fixture remains available');
  sql(source, `create role anon;create role authenticated;create role service_role bypassrls;
    grant anon to authenticated;alter role anon connection limit 12;alter role anon set statement_timeout='25s';
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to service_role;grant execute on function auth.uid() to service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text references storage.buckets(id),name text,metadata jsonb,version text,updated_at timestamptz default now(),primary key(bucket_id,name));`);
  for (const file of ['20260912142734_title_backend_foundation.sql', '20260912145118_title_verified_access_gateway.sql', '20260912145505_title_explicit_conflicts.sql', '20260919215301_title_staff_access_lifecycle.sql']) sql(source, fs.readFileSync(path.join(repo, 'supabase/migrations', file), 'utf8'));
  sql(source, vault[1]);
  for (const file of ['20260924150748_title_jv_intake.sql', '20260924155947_title_jv_recipient_portal.sql']) sql(source, fs.readFileSync(path.join(repo, 'supabase/migrations', file), 'utf8'));
  const objects = new Map([
    ['title-documents/company/source.pdf', Buffer.from('%PDF-1.4\nFictional private original\n%%EOF')],
    ['title-documents/recipient/unadopted.txt', Buffer.from('Unadopted recipient private original\n')],
    ['title-documents/recipient/retained.txt', Buffer.from('Removed original retained for recovery\n')],
    ['other-private/uncatalogued.bin', randomBytes(65537)],
  ]);
  sql(source, `insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
    insert into public.title_workspaces(id,name,state) values('${w}','Fictional recovery','{"companies":[{"id":"C1"}],"documents":[{"id":"D1","companyId":"C1","assetId":"A1","version":1,"visibility":"Restricted","category":"Applications"}]}');
    insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access) values('${w}','${owner}','owner','{}',true,true),('${w}','${staff}','onboarding',array['C1'],false,true);
    insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by) values('${w}','A1','C1','D1','company/source.pdf','application/pdf','source.pdf',${objects.get('title-documents/company/source.pdf').length},'${hash(objects.get('title-documents/company/source.pdf'))}','${owner}');
    insert into storage.buckets(id,name,public) values('other-private','other-private',false),('public-excluded','public-excluded',true);
    insert into public.title_jv_intakes(workspace_id,company_id,version,status,secret_id,updated_at,updated_by) values('${w}','C1',1,'Draft',vault.create_secret('{"ssn":"${privateText}","notes":"Encrypted original identity payload"}','fixture-private-jv'),now(),'${owner}');
    insert into title_private.jv_portal_invites(id,workspace_id,company_id,created_by,access_version,request_id,secret_id,token_hash,baseline_version)
      values('${invite}','${w}','C1','${staff}',1,gen_random_uuid(),vault.create_secret('{"payload":{"ssn":"${privateText}"},"recipientName":"Fictional Recipient","email":"fixture@example.test"}','fixture-private-recipient'),repeat('a',64),0);
    insert into public.title_audit(workspace_id,actor_id,actor_email,action) values('${w}','${owner}','owner@example.test','fixture.recovery');`);
  for (const [name, data] of objects) {
    const [bucket, ...segments] = name.split('/'), objectPath = segments.join('/');
    const target = path.join(dir, name); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, data);
    sql(source, `insert into storage.objects(bucket_id,name,metadata,version) values('${bucket}','${objectPath}','{"size":${data.length}}','fixture-v1');`);
    if (objectPath.startsWith('recipient/')) sql(source, `insert into title_private.jv_portal_attachments(invitation_id,object_path,filename,mime,byte_size,sha256,state) values('${invite}','${objectPath}','fixture.txt','text/plain',${data.length},'${hash(data)}','${objectPath.includes('retained') ? 'removed' : 'ready'}');`);
  }
  sql(source, `insert into storage.objects(bucket_id,name,metadata,version) values('public-excluded','not-private.txt','{"size":9}','v1');`);
  return objects;
}

test('encrypted recovery export, corruption/failure controls and actual isolated PostgreSQL restore', { timeout: 180_000 }, async t => {
  const dir = await fsp.mkdtemp(path.join('/tmp', 'title-recovery-test-'));
  let source, target;
  const envNames = ['TITLE_RECOVERY_TEST_SOURCE', 'TITLE_RECOVERY_TEST_TARGET', 'TITLE_RECOVERY_TEST_KEY', 'TITLE_RECOVERY_TEST_MANAGED', 'TITLE_RECOVERY_TEST_ROOT', 'TITLE_RECOVERY_TEST_SERVICE'];
  const prior = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  try {
    source = startCluster(path.join(dir, 'source'), '127.0.0.1', String(56500 + process.pid % 400));
    target = startCluster(path.join(dir, 'target'), '::1', String(56900 + process.pid % 400));
    process.env.TITLE_RECOVERY_TEST_SOURCE = source.url; process.env.TITLE_RECOVERY_TEST_TARGET = target.url; process.env.TITLE_RECOVERY_TEST_KEY = randomBytes(32).toString('hex');
    const originals = path.join(dir, 'originals'), objects = await fixture(source, originals);
    const config = { repository: repo, pgBin: path.dirname(bins.psql), archiveKeyEnv: 'TITLE_RECOVERY_TEST_KEY', sslMode: 'disable', maxEntryBytes: 8_000_000, maxTotalBytes: 64_000_000,
      source: { kind: 'isolated-fixture', id: 'fictional-source', databaseUrlEnv: 'TITLE_RECOVERY_TEST_SOURCE', objectDirectory: originals, writeFreezeReference: 'synthetic isolated fixture has no application writers' },
      recovery: { owner: 'Fictional drill operator', retentionReference: 'fixture only', configurationReference: 'fixture configuration', rpoMinutes: 60, rtoMinutes: 120 },
      target: { kind: 'isolated-native', environment: 'nonproduction', databaseUrlEnv: 'TITLE_RECOVERY_TEST_TARGET', databaseName: 'title_recovery_drill', objectDirectory: path.join(dir, 'restored') } };
    const bundle = path.join(dir, 'bundle'); let manifest;
    await t.test('plan is read-only and rejects missing operational/key prerequisites', () => {
      assert.equal(exportPlan(config).dryRun, true); assert.equal(fs.existsSync(bundle), false);
      assert.throws(() => exportPlan({ ...config, source: { ...config.source, writeFreezeReference: '' } }), /write-freeze/);
      assert.throws(() => exportPlan({ ...config, source: { ...config.source, kind: 'managed-supabase' } }), /Vault/);
      assert.throws(() => exportPlan({ ...config, recovery: { ...config.recovery, rpoMinutes: 0 } }), /RPO/);
    });
    await t.test('export includes full DB, unadopted/removed/uncatalogued private bytes and encrypted evidence', async () => {
      const result = await exportBundle(config, bundle); assert.equal(result.objectCount, 4); assert.equal(result.managedRestoreReady, false);
      manifest = await verifyBundle(config, bundle);
      assert.equal(manifest.objects.length, 4); assert.ok(manifest.roles.some(role => role.name === 'service_role' && role.bypassRls));
      assert.ok(manifest.entries.some(entry => entry.path?.endsWith('_title_jv_recipient_portal.sql')));
      assert.equal((await fsp.stat(bundle)).mode & 0o777, 0o700);
      for (const name of await fsp.readdir(bundle)) {
        assert.equal((await fsp.stat(path.join(bundle, name))).mode & 0o777, 0o600);
        const data = await fsp.readFile(path.join(bundle, name));
        for (const text of [privateText, 'FICTIONAL_TEST_KEY_ONLY', 'fixture@example.test', 'Unadopted recipient private original']) assert.equal(data.includes(Buffer.from(text)), false);
      }
      assert.equal((await restorePlan(config, bundle)).nativeRestoreAllowed, true);
    });
    await t.test('existing output, missing byte, traversal and oversize fail without leaving partial archives', async () => {
      await assert.rejects(exportBundle(config, bundle), /already exists/);
      const sourceFile = path.join(originals, 'title-documents/company/source.pdf'), originalBytes = await fsp.readFile(sourceFile), changedBytes = Buffer.from(originalBytes); changedBytes[10] ^= 1;
      await fsp.writeFile(sourceFile, changedBytes); await assert.rejects(exportBundle(config, path.join(dir, 'wrong-original')), /original hash/); await fsp.writeFile(sourceFile, originalBytes);
      await fsp.rename(path.join(originals, 'title-documents/recipient/unadopted.txt'), path.join(dir, 'held.txt'));
      await assert.rejects(exportBundle(config, path.join(dir, 'missing'))); await fsp.rename(path.join(dir, 'held.txt'), path.join(originals, 'title-documents/recipient/unadopted.txt'));
      sql(source, `insert into storage.objects(bucket_id,name,metadata,version) values('title-documents','../escape','{"size":1}','v1');`);
      await assert.rejects(exportBundle(config, path.join(dir, 'traversal')), /Unsafe/); sql(source, `delete from storage.objects where name='../escape';`);
      await assert.rejects(exportBundle({ ...config, maxEntryBytes: 10 }, path.join(dir, 'oversize')), /inventory/);
      await assert.rejects(exportBundle({ ...config, maxEntryBytes: 70_000 }, path.join(dir, 'dump-overflow')), /limit/);
      assert.deepEqual((await fsp.readdir(dir)).filter(name => name.startsWith('.recovery-encrypted-')), []);
      assert.equal(fs.existsSync(path.join(dir, 'missing')), false);
      assert.equal(fs.existsSync(path.join(dir, 'wrong-original')), false);
    });
    await t.test('managed envelope includes encrypted Vault key and complete private Storage through controlled transport; restore remains blocked', async () => {
      const project = 'a'.repeat(20), fakeBin = path.join(dir, 'managed-fixture-bin'); await fsp.mkdir(fakeBin);
      for (const name of ['psql', 'pg_dump', 'pg_dumpall']) {
        await fsp.writeFile(path.join(fakeBin, name), `#!${process.execPath}\nimport{spawnSync}from'node:child_process';const r=spawnSync(${JSON.stringify(bins[name])},process.argv.slice(2),{stdio:'inherit',env:{...process.env,PGHOST:'127.0.0.1',PGPORT:${JSON.stringify(source.port)},PGUSER:${JSON.stringify(source.user)},PGDATABASE:'postgres',PGSSLMODE:'disable'}});process.exit(r.status??1);`, { mode: 0o700 });
      }
      process.env.TITLE_RECOVERY_TEST_MANAGED = `postgresql://postgres@db.${project}.supabase.co/postgres`;
      process.env.TITLE_RECOVERY_TEST_ROOT = randomBytes(32).toString('hex'); process.env.TITLE_RECOVERY_TEST_SERVICE = 'fictional-service-token';
      const managed = { ...config, sslMode: 'verify-full', pgBin: fakeBin, source: { kind: 'managed-supabase', id: project, databaseUrlEnv: 'TITLE_RECOVERY_TEST_MANAGED', storageUrl: `https://${project}.supabase.co/`, serviceKeyEnv: 'TITLE_RECOVERY_TEST_SERVICE', vaultRootKeyEnv: 'TITLE_RECOVERY_TEST_ROOT', writeFreezeReference: 'synthetic controlled transport' }, recovery: { ...config.recovery, vaultKeyEscrowReference: 'fictional independent escrow' } };
      const originalFetch = globalThis.fetch; let calls = 0;
      globalThis.fetch = async (input, init) => {
        assert.equal(input.origin, `https://${project}.supabase.co`); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer fictional-service-token');
        const name = input.pathname.replace('/storage/v1/object/authenticated/', '').split('/').map(decodeURIComponent).join('/'); const data = objects.get(name); assert.ok(data); calls++;
        return new Response(data, { headers: { 'content-length': String(data.length) } });
      };
      try {
        const rootKey = process.env.TITLE_RECOVERY_TEST_ROOT; delete process.env.TITLE_RECOVERY_TEST_ROOT;
        await assert.rejects(exportBundle(managed, path.join(dir, 'missing-key')), /secret environment/); process.env.TITLE_RECOVERY_TEST_ROOT = rootKey;
        const archive = path.join(dir, 'managed'); await exportBundle(managed, archive); assert.equal(calls, 4);
        const saved = await verifyBundle(managed, archive); assert.equal(saved.vaultKeyFingerprint, hash(rootKey)); assert.equal(saved.entries.filter(e => e.kind === 'vault-root-key').length, 1);
        for (const name of await fsp.readdir(archive)) assert.equal((await fsp.readFile(path.join(archive, name))).includes(Buffer.from(rootKey)), false);
        assert.equal((await restorePlan(managed, archive)).nativeRestoreAllowed, false);
        await assert.rejects(restoreNative(managed, archive, 'anything'), /Managed Supabase restore is blocked/);
        globalThis.fetch = async (input, init) => {
          const name = input.pathname.replace('/storage/v1/object/authenticated/', '').split('/').map(decodeURIComponent).join('/');
          sql(source, "update storage.objects set version='changed-during-copy' where name='recipient/unadopted.txt';");
          return new Response(objects.get(name));
        };
        await assert.rejects(exportBundle(managed, path.join(dir, 'changed-inventory')), /inventory changed/);
        assert.equal(fs.existsSync(path.join(dir, 'changed-inventory')), false);
      } finally { globalThis.fetch = originalFetch; sql(source, "update storage.objects set version='fixture-v1' where bucket_id<>'public-excluded';"); }
    });
    await t.test('wrong keys, truncated/corrupt data, symlinks and unknown files fail verification', async () => {
      const key = process.env.TITLE_RECOVERY_TEST_KEY; process.env.TITLE_RECOVERY_TEST_KEY = randomBytes(32).toString('hex');
      await assert.rejects(verifyBundle(config, bundle), /authentication/); process.env.TITLE_RECOVERY_TEST_KEY = key;
      const corrupt = path.join(dir, 'corrupt'); await fsp.cp(bundle, corrupt, { recursive: true });
      const entryPath = path.join(corrupt, manifest.entries.find(e => e.kind === 'object').name), original = await fsp.readFile(entryPath);
      const changed = Buffer.from(original); changed[13] ^= 1; await fsp.writeFile(entryPath, changed);
      await assert.rejects(verifyBundle(config, corrupt), /authentication/);
      await assert.rejects(restoreNative(config, corrupt, `RESTORE ${manifest.archiveId} INTO title_recovery_drill`), /authentication/);
      assert.equal(sql(target, "select count(*) from pg_database where datname='title_recovery_drill';"), '0');
      await fsp.writeFile(entryPath, original.subarray(0, -1)); await assert.rejects(verifyBundle(config, corrupt), /authentication/);
      await fsp.unlink(entryPath); await fsp.symlink(path.join(bundle, path.basename(entryPath)), entryPath); await assert.rejects(verifyBundle(config, corrupt));
      await fsp.writeFile(path.join(bundle, 'unexpected'), 'x'); await assert.rejects(verifyBundle(config, bundle), /Unexpected/); await fsp.unlink(path.join(bundle, 'unexpected'));
    });
    await t.test('same-source targets, missing confirmation and existing target directory are rejected', async () => {
      await assert.rejects(restoreNative({ ...config, target: { ...config.target, databaseUrlEnv: 'TITLE_RECOVERY_TEST_SOURCE' } }, bundle, ''), /source database host/);
      await assert.rejects(restoreNative(config, bundle, 'yes'), /Exact/);
      await fsp.mkdir(config.target.objectDirectory); await assert.rejects(restoreNative(config, bundle, `RESTORE ${manifest.archiveId} INTO title_recovery_drill`), /already exist/); await fsp.rmdir(config.target.objectDirectory);
      sql(target, 'create database fictional_existing;'); await assert.rejects(restoreNative(config, bundle, `RESTORE ${manifest.archiveId} INTO title_recovery_drill`), /existing data/); sql(target, 'drop database fictional_existing;');
      sql(target, 'create table public.fictional_existing(id integer);'); await assert.rejects(restoreNative(config, bundle, `RESTORE ${manifest.archiveId} INTO title_recovery_drill`), /existing data/); sql(target, 'drop table public.fictional_existing;');
      assert.equal(sql(target, "select count(*) from pg_database where datname='title_recovery_drill';"), '0');
    });
    await t.test('actual native restore preserves ciphertext, private payloads, memberships, ACL/RLS and exact originals', async () => {
      const result = await restoreNative(config, bundle, `RESTORE ${manifest.archiveId} INTO title_recovery_drill`); assert.equal(result.restored, true); assert.equal(result.productionReady, false);
      const db = 'title_recovery_drill';
      assert.equal(sql(target, 'select count(*) from auth.users;', db), '2'); assert.equal(sql(target, 'select count(*) from public.title_memberships;', db), '2');
      assert.equal(sql(target, 'select count(*) from public.title_audit;', db), '1'); assert.equal(sql(target, 'select count(*) from title_private.jv_portal_attachments;', db), '2');
      assert.equal(sql(target, 'select count(*) from public.title_assets;', db), '1');
      assert.equal(sql(target, "select rolconnlimit=12 and rolconfig@>array['statement_timeout=25s'] and not rolcanlogin from pg_roles where rolname='anon';", db), 't');
      assert.equal(sql(target, "select pg_has_role('authenticated','anon','MEMBER');", db), 't');
      assert.equal(sql(target, `select count(*) from vault.decrypted_secrets where decrypted_secret like '%${privateText}%';`, db), '2');
      assert.equal(sql(target, "select bool_and(relrowsecurity) from pg_class where oid in ('public.title_jv_intakes'::regclass,'title_private.jv_portal_invites'::regclass,'public.title_memberships'::regclass);", db), 't');
      for (const role of ['anon', 'authenticated', 'service_role']) assert.throws(() => sql(target, `set role ${role};select * from public.title_jv_intakes;`, db));
      for (const role of ['anon', 'authenticated']) assert.throws(() => sql(target, `set role ${role};select * from public.title_workspaces;`, db));
      assert.throws(() => sql(target, 'set role service_role;delete from public.title_audit;', db));
      assert.equal(sql(target, "select position('FICTIONAL_RECOVERY_SSN' in state::text)=0 from public.title_workspaces;", db), 't');
      for (const [name, data] of objects) assert.deepEqual(await fsp.readFile(path.join(config.target.objectDirectory, name)), data);
      assert.equal(sql(source, 'select count(*) from public.title_memberships;'), '2', 'source remains intact');
      await assert.rejects(restoreNative(config, bundle, `RESTORE ${manifest.archiveId} INTO title_recovery_drill`), /already exist/);
    });
    await t.test('failed pg_restore removes its newly created DB and never exposes original files', async () => {
      stopCluster(target); target = undefined; await fsp.rm(path.join(dir, 'target'), { recursive: true });
      target = startCluster(path.join(dir, 'target'), '::1', String(56900 + process.pid % 400));
      const fakeBin = path.join(dir, 'failure-bin'); await fsp.mkdir(fakeBin);
      await fsp.symlink(bins.psql, path.join(fakeBin, 'psql'));
      await fsp.writeFile(path.join(fakeBin, 'pg_restore'), `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('FICTIONAL_PRIVATE_FAILURE');process.exit(1)});`, { mode: 0o700 });
      const failure = { ...config, pgBin: fakeBin, target: { ...config.target, databaseName: 'title_recovery_failure', objectDirectory: path.join(dir, 'failed-objects') } };
      await assert.rejects(restoreNative(failure, bundle, `RESTORE ${manifest.archiveId} INTO title_recovery_failure`), error => !String(error).includes('FICTIONAL_PRIVATE_FAILURE'));
      assert.equal(sql(target, "select count(*) from pg_database where datname='title_recovery_failure';"), '0'); assert.equal(fs.existsSync(failure.target.objectDirectory), false);
    });
  } finally {
    stopCluster(target); stopCluster(source); await fsp.rm(dir, { recursive: true, force: true });
    for (const name of envNames) prior[name] === undefined ? delete process.env[name] : process.env[name] = prior[name];
  }
});
