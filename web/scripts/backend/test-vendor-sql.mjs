/** Uses an isolated PostgreSQL socket/data directory; never a configured or hosted database. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
const binary = name => {
  for (const dir of dirs) { const candidate = path.join(dir, name); try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {} }
  throw new Error(`Install local PostgreSQL or set TITLE_TEST_PG_BIN (${name} missing). No existing database is used.`);
};
const bins = Object.fromEntries(['initdb', 'pg_ctl', 'psql'].map(name => [name, binary(name)]));
const dir = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'title-vendor-sql-'));
const data = path.join(dir, 'data'), user = 'title_vendor_fixture', port = '55458';
const args = ['-X', '-h', dir, '-p', port, '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'];
const command = (name, params, options = {}) => execFileSync(bins[name], params, { encoding: 'utf8', maxBuffer: 8_000_000, ...options });
const sql = input => command('psql', args, { input, stdio: ['pipe', 'pipe', 'pipe'] });
function session(input) {
  const child = spawn(bins.psql, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${error}\n${output}`)));
  });
  if (input) child.stdin.end(input);
  return { child, done, output: () => output };
}
const w = '20000000-0000-4000-8000-000000000001', owner = '10000000-0000-4000-8000-000000000001', admin = '10000000-0000-4000-8000-000000000002';
const migration = '20260923191146_title_vendor_oauth_credentials.sql';
const common = (actor = owner, version = 1) => `'${w}','${actor}',${version},'docusign','company-a'`;
const tokenJson = `'${JSON.stringify({ accessToken: 'synthetic-access-one', refreshToken: 'synthetic-refresh-one' })}'`;
const accountJson = `'${JSON.stringify({ accountId: '11111111-1111-1111-1111-111111111111', accountName: 'Fictional company', baseUri: 'https://demo.docusign.net' })}'`;
const state = 'a'.repeat(64), request = '30000000-0000-4000-8000-000000000001';
const start = (actor = owner) => `select public.title_vendor_start_oauth(${common(actor)},'sandbox',0,'${state}');`;
const claim = (actor = owner) => `select public.title_vendor_claim_oauth(${common(actor)},'${state}');`;
const finish = (lease, actor = owner) => `select public.title_vendor_finish(${common(actor)},'${lease}',${tokenJson},${accountJson},clock_timestamp()+interval '1 hour');`;
const revoke = `select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${admin}',1);`;
const setup = () => sql(`truncate public.title_workspaces,auth.users,vault.secrets cascade;
  insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.test',now()),('${admin}','admin@example.test',now());
  set role service_role;
  insert into public.title_workspaces(id,name,state) values('${w}','Fictional OAuth concurrency','{"companies":[{"id":"company-a"},{"id":"company-b"}]}');
  insert into public.title_memberships(workspace_id,user_id,role,all_companies) values('${w}','${owner}','owner',true),('${w}','${admin}','admin',true);`);
const resultJson = output => JSON.parse(output.trim().split('\n').filter(line => line.startsWith('{')).at(-1));
const connect = () => {
  sql(`set role service_role; ${start()}`);
  const result = resultJson(sql(`set role service_role; ${claim()}`));
  sql(`set role service_role; ${finish(result.leaseId)}`);
};
const refresh = (actor = owner) => resultJson(sql(`set role service_role; select public.title_vendor_claim_refresh(${common(actor)},1);`));
async function until(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error(`Timed out: ${label}`);
}
async function blocked(firstAction, secondAction, label, failure) {
  const first = session();
  first.child.stdin.write(`begin; set local role service_role; ${firstAction} select 'FIRST_DONE';\n`);
  await until(() => first.output().includes('FIRST_DONE'), 'first transaction holds lifecycle lock');
  const second = session(`set application_name='vendor_race_second'; set role service_role; ${secondAction}`);
  const outcome = second.done.then(value => ({ value }), error => ({ error }));
  await until(() => sql(`select exists(select 1 from pg_stat_activity where application_name='vendor_race_second' and wait_event_type='Lock');`).trim() === 't', 'second request waits for committed state');
  first.child.stdin.end('commit;\n');
  await first.done;
  const result = await outcome;
  if (failure) assert.match(String(result.error), failure, label); else if (result.error) throw result.error;
  console.log(`Concurrency: ${label} passed`);
  return result.value;
}
let started = false;
try {
  command('initdb', ['-D', data, `--username=${user}`, '--auth-local=trust', '--auth-host=reject', '--no-locale']);
  command('pg_ctl', ['-D', data, '-l', path.join(dir, 'server.log'), '-o', `-k '${dir}' -h '' -p ${port} -F`, '-w', 'start']);
  started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to service_role; grant execute on function auth.uid() to service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  for (const name of ['20260912142734_title_backend_foundation.sql', '20260912145118_title_verified_access_gateway.sql',
    '20260912145505_title_explicit_conflicts.sql', '20260919215301_title_staff_access_lifecycle.sql']) {
    sql(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  // Native PostgreSQL has no Supabase Vault extension. This API-compatible stub
  // verifies authorization and atomic rotation/deletion, NOT encryption at rest.
  sql(`create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null,name text unique,description text);
    create view vault.decrypted_secrets as select id,
      case when current_setting('title_test.vault_read_failure',true)='yes' then null else secret end as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid
      language plpgsql security invoker set search_path='' as $$ declare result uuid; begin
        if current_setting('title_test.vault_write_failure',true)='yes' then raise exception 'Synthetic Vault write failure'; end if;
        insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id into result; return result; end $$;
    create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void
      language plpgsql security invoker set search_path='' as $$ begin
        if current_setting('title_test.vault_write_failure',true)='yes' then raise exception 'Synthetic Vault write failure'; end if;
        update vault.secrets set secret=coalesce(new_secret,secret),name=coalesce(new_name,name),description=coalesce(new_description,description) where id=secret_id;
        if not found then raise exception 'Synthetic Vault record missing'; end if; end $$;
    revoke all on schema vault from public,anon,authenticated,service_role;
    revoke all on all tables in schema vault from public,anon,authenticated,service_role;
    revoke all on all functions in schema vault from public,anon,authenticated,service_role;`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
  console.log(sql(fs.readFileSync(path.join(root, 'web/tests/vendor-credentials.test.sql'), 'utf8')).trim());
  // Races below use two real PostgreSQL sessions, never a hosted database.
  setup(); sql(`set role service_role; ${start()}`);
  assert.equal(resultJson(await blocked(claim(), claim(), 'concurrent callback is single use')).ok, false);
  setup(); connect();
  assert.equal(resultJson(await blocked(`select public.title_vendor_claim_refresh(${common()},1);`, `select public.title_vendor_claim_refresh(${common(admin)},1);`, 'concurrent refresh is leased once')).ok, false);
  setup(); connect();
  let lease = refresh(admin).leaseId;
  await blocked(`select public.title_vendor_disconnect(${common()},1);`, finish(lease, admin), 'disconnect fences stale refresh completion', /lease expired or changed/);
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '0');
  setup(); connect(); lease = refresh(admin).leaseId;
  await blocked(finish(lease, admin), `select public.title_vendor_disconnect(${common()},1);`, 'refresh completion fences stale disconnect', /connection changed/);
  assert.equal(sql('select revision from public.title_vendor_connections;').trim(), '2');
  setup(); connect(); lease = refresh(admin).leaseId;
  await blocked(revoke, finish(lease, admin), 'revocation wins before refreshed credentials persist', /Administrator access changed/);
  assert.equal(sql('select revision from public.title_vendor_connections;').trim(), '1');
  setup(); connect(); lease = refresh(admin).leaseId;
  await blocked(finish(lease, admin), revoke, 'refresh commits then revocation without deadlock');
  assert.equal(sql(`select active::text||':'||version from public.title_memberships where user_id='${admin}';`).trim(), 'false:2');
  setup(); connect();
  await blocked(revoke, `select public.title_vendor_read(${common(admin)});`, 'revocation fences server credential reads', /Administrator access changed/);
  setup(); sql(`set role service_role; ${start(admin)}`);
  assert.equal(resultJson(await blocked(revoke, claim(admin), 'revoked callback consumes state and returns safe failure')).ok, false);
  assert.equal(sql('select consumed_at is not null from public.title_vendor_oauth_states;').trim(), 't');
  setup(); connect(); lease = refresh(admin).leaseId;
  await blocked(`update public.title_workspaces set state='{"companies":[{"id":"company-b"}]}' where id='${w}';`, finish(lease, admin), 'deleted company fences late credential persistence', /Administrator access changed/);
  setup(); connect();
  const reserve = hash => `select public.title_vendor_reserve_draft(${common()},1,'${request}','${hash.repeat(64)}');`;
  assert.equal(resultJson(await blocked(reserve('1'), reserve('1'), 'concurrent duplicate draft reservation never resends')).created, false);
  setup(); connect();
  await blocked(reserve('1'), reserve('2'), 'same draft request with changed payload conflicts', /Draft request changed/);
  setup(); connect(); sql(`set role service_role; ${reserve('1')}`);
  const checkDraft = `select public.title_vendor_claim_draft_check(${common()},'${request}');`;
  await blocked(checkDraft, checkDraft, 'concurrent provider checks enforce 15-minute interval', /Wait 15 minutes/);
  let denials = 0;
  for (const role of ['anon','authenticated','service_role']) {
    for (const table of ['title_vendor_connections','title_vendor_oauth_states','title_vendor_drafts']) {
      assert.throws(() => sql(`set role ${role}; select * from public.${table};`), /permission denied/); denials++;
    }
  }
  for (const role of ['anon','authenticated']) {
    assert.throws(() => sql(`set role ${role}; select public.title_vendor_read(${common()});`), /permission denied/); denials++;
    assert.throws(() => sql(`set role ${role}; select public.title_vendor_claim_draft_check(${common()},'${request}');`), /permission denied/); denials++;
  }
  console.log(`Direct table/RPC enforcement: ${denials} actual SQL denials passed`);
  console.log('Vendor credential verification complete: 12 concurrency scenarios, no hosted database touched.');
} finally {
  if (started) command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}
