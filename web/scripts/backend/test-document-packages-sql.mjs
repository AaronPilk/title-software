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
const dir = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'title-package-sql-'));
const data = path.join(dir, 'data'), user = 'title_package_fixture', port = '55455';
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
const w = '20000000-0000-4000-8000-000000000001', owner = '10000000-0000-4000-8000-000000000001', staff = '10000000-0000-4000-8000-000000000002';
async function until(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error(`Timed out: ${label}`);
}
async function blocked(firstAction, secondAction, label, failure) {
  const first = session();
  first.child.stdin.write(`begin; set local role service_role; ${firstAction} select 'FIRST_DONE';\n`);
  await until(() => first.output().includes('FIRST_DONE'), 'first request holds lifecycle lock');
  const second = session(`set application_name='package_race_second'; set role service_role; ${secondAction}`);
  const outcome = second.done.then(value => ({ value }), error => ({ error }));
  await until(() => sql(`select exists(select 1 from pg_stat_activity where application_name='package_race_second' and wait_event_type='Lock');`).trim() === 't', 'second request waits for lifecycle lock');
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
  for (const name of ['20260912142734_title_backend_foundation.sql','20260912145118_title_verified_access_gateway.sql','20260912145505_title_explicit_conflicts.sql','20260919215301_title_staff_access_lifecycle.sql','20260923212043_title_document_package_reviews.sql']) sql(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
    set role service_role; insert into public.title_workspaces(id,name,state) values('${w}','Fictional document review','{}');
    insert into public.title_memberships(workspace_id,user_id,role,all_companies) values('${w}','${owner}','owner',true),('${w}','${staff}','operations',false);`);
  const revision=Number(sql(`select revision from public.title_workspaces where id='${w}'`).trim());
  const call=(action,input={},actor=staff,version=1,rev=revision)=>`select public.title_document_package('${w}','${actor}',${version},${rev},'${action}','${JSON.stringify(input).replaceAll("'","''")}'::jsonb);`;
  const run=(...args)=>JSON.parse(sql(`set role service_role; ${call(...args)}`).trim().split('\n').at(-1));
  const source={documentId:'fictional',assetId:'asset',sha256:'b'.repeat(64)};
  const opened=run('open',{sources:[source],sourcesHash:'a'.repeat(64)});
  assert.equal(run('open',{sources:[source],sourcesHash:'a'.repeat(64)}).id,opened.id);
  assert.throws(()=>run('load',{id:opened.id},owner),/unavailable/);
  assert.throws(()=>run('load',{id:opened.id},staff,2),/access changed/);
  assert.throws(()=>run('load',{id:opened.id},staff,1,revision+1),/Workspace changed/);
  const change={id:opened.id,expectedVersion:1,checkpoint:{status:'partial'},pages:{'fictional:1':{text:'fictional text'}}};
  await blocked(call('save',change),call('save',change),'concurrent save loses cleanly with CAS',/review changed/);
  let saved=run('load',{id:opened.id});assert.equal(saved.version,2);assert.equal(saved.pages['fictional:1'].text,'fictional text');assert.equal(saved.checkpoint.status,'partial');
  assert.throws(()=>run('save',{...change,expectedVersion:2,pages:'bad'}),/Invalid scan batch/);
  saved=run('load',{id:opened.id});assert.equal(saved.version,2);
  const review=run('review',{id:opened.id,expectedVersion:2,decisions:[{candidateId:'fictional',disposition:'rejected'}]});assert.equal(review.version,3);
  const revoke=`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`;
  await blocked(revoke,call('load',{id:opened.id}),'revoke wins before review read',/access changed/);
  for(const role of ['anon','authenticated']){
    assert.throws(()=>sql(`set role ${role};select * from public.title_document_packages;`),/permission denied/);
    assert.throws(()=>sql(`set role ${role};${call('open',{sources:[source],sourcesHash:'a'.repeat(64)})}`),/permission denied/);
  }
  console.log('Document package SQL: lifecycle, atomicity, concurrency, isolation and browser-role denial passed (17 assertions).');
} finally {
  if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  fs.rmSync(dir,{recursive:true,force:true});
}
