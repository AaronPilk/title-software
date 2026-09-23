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
const dir = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'title-feedback-sql-'));
const data = path.join(dir, 'data'), user = 'title_feedback_fixture', port = '55454';
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
const note = '30000000-0000-4000-8000-000000000001';
const submit = (id = note, message = 'Feedback') => `select public.title_submit_feedback('${w}','${staff}','staff@example.test',1,'${id}','idea','${message}','Overview','agency');`;
const revoke = `select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`;
const setup = () => sql(`truncate public.title_workspaces,auth.users cascade;
 insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
 set role service_role;
 insert into public.title_workspaces(id,name,state) values('${w}','Fictional feedback concurrency','{}');
 insert into public.title_memberships(workspace_id,user_id,role,all_companies) values('${w}','${owner}','owner',true),('${w}','${staff}','operations',false);`);
async function until(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error(`Timed out: ${label}`);
}
async function blocked(firstAction, secondAction, label, failure) {
  const first = session();
  first.child.stdin.write(`begin; set local role service_role; ${firstAction} select 'FIRST_DONE';\n`);
  await until(() => first.output().includes('FIRST_DONE'), 'first request holds lifecycle lock');
  const second = session(`set application_name='feedback_race_second'; set role service_role; ${secondAction}`);
  const outcome = second.done.then(value => ({ value }), error => ({ error }));
  await until(() => sql(`select exists(select 1 from pg_stat_activity where application_name='feedback_race_second' and wait_event_type='Lock');`).trim() === 't', 'second request waits for lifecycle lock');
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
    '20260912145505_title_explicit_conflicts.sql', '20260919215301_title_staff_access_lifecycle.sql', '20260923173707_title_developer_feedback.sql']) {
    sql(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  console.log(sql(fs.readFileSync(path.join(root, 'web/tests/feedback.test.sql'), 'utf8')).match(/\d+ feedback SQL assertions passed/)?.[0]);
  setup();
  await blocked(submit(), submit(), 'concurrent same-ID retry creates one note');
  assert.equal(sql('select count(*) from public.title_feedback;').trim(), '1');
  setup();
  await blocked(submit(), submit(note, 'Different'), 'same-ID changed payload conflicts', /Feedback request changed/);
  assert.equal(sql('select count(*) from public.title_feedback;').trim(), '1');
  setup();
  sql(`set role service_role; insert into public.title_feedback(id,workspace_id,author_id,author_email,kind,message,page,view)
    select gen_random_uuid(),'${w}','${staff}','staff@example.test','idea','Earlier','Overview','agency' from generate_series(1,9);`);
  await blocked(submit(), submit('30000000-0000-4000-8000-000000000002'), 'concurrent tenth and eleventh notes enforce minute limit', /sent several notes recently/);
  assert.equal(sql('select count(*) from public.title_feedback;').trim(), '10');
  setup();
  sql(`set role service_role; insert into public.title_feedback(id,workspace_id,author_id,author_email,kind,message,page,view,created_at)
    select gen_random_uuid(),'${w}','${staff}','staff@example.test','idea','Earlier','Overview','agency',clock_timestamp()-interval '2 hours' from generate_series(1,99);`);
  await blocked(submit(), submit('30000000-0000-4000-8000-000000000002'), 'concurrent hundredth and 101st notes enforce daily limit', /sent several notes recently/);
  assert.equal(sql('select count(*) from public.title_feedback;').trim(), '100');
  setup();
  await blocked(revoke, submit(), 'revoke wins before submit', /Workspace access changed/);
  assert.equal(sql('select count(*) from public.title_feedback;').trim(), '0');
  setup();
  await blocked(submit(), revoke, 'submit wins then revoke completes without deadlock');
  assert.equal(sql(`select active::text||':'||version from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(), 'false:2');
  setup();
  sql(`set role service_role; ${submit()}`);
  await blocked(revoke, `select public.title_list_feedback('${w}','${staff}',1);`, 'revoke wins before listing feedback', /Workspace access changed/);
  setup();
  sql(`set role service_role; ${submit()}`);
  const update = (status, reply) => `select public.title_update_feedback('${w}','${owner}',1,'${note}',1,'${status}','${reply}');`;
  await blocked(update('in_progress', 'Reviewing'), update('done', 'Fixed'), 'concurrent owner response preserves CAS', /Feedback changed/);
  assert.equal(sql(`select status||':'||version from public.title_feedback where id='${note}';`).trim(), 'in_progress:2');
  setup();
  sql(`set role service_role; ${submit()}`);
  await blocked(update('in_progress', 'Reviewing'), update('in_progress', 'Reviewing'), 'concurrent exact owner retry is idempotent');
  assert.equal(sql(`select version from public.title_feedback where id='${note}';`).trim(), '2');
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => sql(`set role ${role}; select * from public.title_feedback;`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select public.title_list_feedback('${w}','${staff}',1);`), /permission denied/);
  }
  console.log('Browser-role enforcement: 4 direct SQL denial checks passed');
  console.log('Feedback transaction verification complete; all data used was fictional and disposable.');
} finally {
  if (started) command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}
