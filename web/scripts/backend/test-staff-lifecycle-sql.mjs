/** Disposable PostgreSQL regressions; never connects to a configured or hosted database. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
const binary = name => {
  for (const dir of dirs) { const p = path.join(dir,name); try { fs.accessSync(p,fs.constants.X_OK); return p; } catch {} }
  throw new Error(`Install local PostgreSQL or set TITLE_TEST_PG_BIN (${name} missing). No existing database is used.`);
};
const bins = Object.fromEntries(['initdb','pg_ctl','psql'].map(name=>[name,binary(name)]));
const dir=fs.mkdtempSync(path.join(process.platform==='darwin'?'/tmp':os.tmpdir(),'title-staff-sql-'));
const data=path.join(dir,'data'), user='title_staff_fixture', port='55453';
const args=['-X','-h',dir,'-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-At'];
const command=(name,params,options={})=>execFileSync(bins[name],params,{encoding:'utf8',maxBuffer:8_000_000,...options});
const sql=input=>command('psql',args,{input,stdio:['pipe','pipe','pipe']});
function session(input) {
  const child=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']}); let output='', error='';
  child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',chunk=>{error+=chunk;});
  child.stdin.end(input);
  return {child, done:new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(`${error}\n${output}`)));})};
}
const w='20000000-0000-4000-8000-000000000001', owner='10000000-0000-4000-8000-000000000001', staff='10000000-0000-4000-8000-000000000002';
const setup=()=>sql(`truncate public.title_workspaces,auth.users cascade;
 insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
 set role service_role; insert into public.title_workspaces(id,name,state) values('${w}','Fictional concurrency','{"companies":[{"id":"A"}]}');
 insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies) values('${w}','${owner}','owner','{}',true),('${w}','${staff}','operations','{A}',false);
 select public.title_prepare_invitation('${w}','${owner}','owner@example.test',1,'staff@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());`);
async function awaitBlocked(app) {
  const until=Date.now()+10_000;
  while(Date.now()<until) {
    if(sql(`select exists(select 1 from pg_stat_activity where application_name='${app}' and wait_event_type='Lock');`).trim()==='t') return;
    await new Promise(r=>setTimeout(r,15));
  }
  throw new Error(`Session ${app} never reached its blocking lock`);
}
let started=false;
try {
  command('initdb',['-D',data,`--username=${user}`,'--auth-local=trust','--auth-host=reject','--no-locale']);
  command('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k '${dir}' -h '' -p ${port} -F`,'-w','start']); started=true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
   create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
   grant usage on schema auth to service_role; grant execute on function auth.uid() to service_role;
   create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  for(const name of ['20260912142734_title_backend_foundation.sql','20260912145118_title_verified_access_gateway.sql','20260912145505_title_explicit_conflicts.sql',
    '20260912163349_title_missive_reviewed_import.sql','20260914204132_title_reviewed_attachment_commit.sql',
    '20260914204134_title_missive_event_transactions.sql','20260914212201_title_multi_company_missive_routing.sql',
    '20260914222408_title_preserve_shared_inbox_context.sql','20260919211810_title_staff_access_lifecycle.sql','20260919212436_title_invitation_email_delivery.sql','20260919213925_title_atomic_staff_assignments.sql']) {
    if(name==='20260919211810_title_staff_access_lifecycle.sql') {
      // These records exist BEFORE the migration. They model legacy grants;
      // all Auth records and mutations here live only in disposable PostgreSQL.
      sql(`insert into auth.users(id,email,email_confirmed_at) values
        ('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now()),
        ('10000000-0000-4000-8000-000000000003','accepted@example.test',now()),
        ('10000000-0000-4000-8000-000000000004','cancelled@example.test',now()),
        ('10000000-0000-4000-8000-000000000005','expired@example.test',now()),
        ('10000000-0000-4000-8000-000000000006','ambiguous@example.test',now()),
        ('10000000-0000-4000-8000-000000000007','AMBIGUOUS@example.test',now());
        insert into public.title_workspaces(id,name,state) values('${w}','Fictional pre-migration grants','{"companies":[{"id":"A"}]}');
        insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies) values
          ('${w}','${owner}','owner','{}',true),('${w}','${staff}','operations','{A}',false);
        insert into public.title_invitations(workspace_id,email,role,company_ids,created_by,accepted_at,revoked_at,expires_at)
          select '${w}',email,'operations','{A}','${owner}',
            case when email='accepted@example.test' then now() end,
            case when email='cancelled@example.test' then now() end,
            case when email='expired@example.test' then now()-interval '1 day' else now()+interval '1 day' end
          from (values ('STAFF@example.test'),('new@example.test'),('accepted@example.test'),('cancelled@example.test'),('expired@example.test'),('ambiguous@example.test')) fixture(email);`);
    }
    sql(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
    if(name==='20260919211810_title_staff_access_lifecycle.sql') {
      assert.equal(sql(`select recipient_user_id::text from public.title_invitations where email='STAFF@example.test';`).trim(),staff,'usable legacy grant binds its unique current Auth identity');
      for(const email of ['new@example.test','accepted@example.test','cancelled@example.test','expired@example.test','ambiguous@example.test'])
        assert.equal(sql(`select (recipient_user_id is null)::text from public.title_invitations where email='${email}';`).trim(),'true',`${email} must not be backfilled`);
      sql(`update auth.users set email='renamed@example.test' where id='${staff}';
        insert into auth.users(id,email,email_confirmed_at) values('10000000-0000-4000-8000-000000000008','staff@example.test',now());
        set role service_role;
        select public.title_claim_access('10000000-0000-4000-8000-000000000008','staff@example.test','{}');`);
      assert.equal(sql(`select count(*) from public.title_memberships where user_id='10000000-0000-4000-8000-000000000008';`).trim(),'0','recycled legacy email cannot claim another account grant');
      sql(`set role service_role; select public.title_claim_access('${staff}','renamed@example.test','{}');`);
      assert.equal(sql(`select version from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(),'1','renamed account cannot consume old-address grant');
      sql(`set role service_role; select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`);
      assert.equal(sql(`select (revoked_at is not null)::text from public.title_invitations where email='STAFF@example.test';`).trim(),'true','revoke cancels backfilled grant after email changes');
      sql('truncate public.title_workspaces,auth.users cascade;');
      console.log('Migration backfill: 9 assertions passed for existing grants, exclusions, renamed/recycled identities and revoke');
    }
  }
  const tests=fs.readFileSync(path.join(root,'web/tests/staff-lifecycle.test.sql'),'utf8');
  for(let round=1;round<=5;round++) console.log(`Round ${round}: ${sql(tests).match(/\d+ staff lifecycle SQL assertions passed/)?.[0]}`);
  const emailTests=fs.readFileSync(path.join(root,'web/tests/invitation-email.test.sql'),'utf8');
  for(let round=1;round<=5;round++) console.log(`Email round ${round}: ${sql(emailTests).match(/\d+ invitation email SQL assertions passed/)?.[0]}`);
  const assignmentTests=fs.readFileSync(path.join(root,'web/tests/staff-assignment-commit.test.sql'),'utf8');
  for(let round=1;round<=5;round++) console.log(`Assignment round ${round}: ${sql(assignmentTests).match(/\d+ staff assignment commit SQL assertions passed/)?.[0]}`);
  for(const testFile of ['missive-routing.test.sql','missive-queue-pause.test.sql'])
    console.log(sql('begin;'+fs.readFileSync(path.join(root,'web/tests',testFile),'utf8')+';rollback;').trim().split('\n').filter(line=>line.includes('verification complete')).join('\n'));
  // Blocking transactions are coordinated by PostgreSQL lock state, not sleeps.
  // The winner owns the actual lifecycle lock before the other request begins.
  async function race(firstAction, secondAction, expectedVersion, label) {
    setup();
    const blocker=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']}); let output='',error='';
    blocker.stdout.on('data',chunk=>{output+=chunk;}); blocker.stderr.on('data',chunk=>{error+=chunk;});
    const finished=new Promise((resolve,reject)=>{blocker.on('error',reject);blocker.on('close',code=>code===0?resolve(output):reject(new Error(error)));});
    blocker.stdin.write(`begin; set local role service_role; ${firstAction} select 'FIRST_DONE';\n`);
    const until=Date.now()+10_000; while(!output.includes('FIRST_DONE')&&Date.now()<until) await new Promise(r=>setTimeout(r,15));
    assert.match(output,/FIRST_DONE/,'first mutation acquired lifecycle lock');
    const second=session(`set application_name='staff_race_second'; set role service_role; ${secondAction}`);
    await awaitBlocked('staff_race_second');
    blocker.stdin.end('commit;\n'); await finished; await second.done;
    assert.equal(sql(`select active::text||':'||version from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(),`false:${expectedVersion}`,label);
    assert.equal(sql(`select count(*) from public.title_invitations where workspace_id='${w}' and accepted_at is null and revoked_at is null;`).trim(),'0','no outstanding invitation survives revoke');
    console.log(`Concurrency: ${label} passed`);
  }
  await race(`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`,
    `select public.title_claim_access('${staff}','staff@example.test','{}');`,2,'revoke wins before claim');
  // Claim increments version. Simulates an administrator reading that new version
  // after the claim commits, while still proving both calls use the same lock.
  await race(`select public.title_claim_access('${staff}','staff@example.test','{}');`,
    `select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',2);`,3,'claim wins then current-version revoke removes access');
  setup();
  // A stale revoke must not acknowledge success after a concurrent claim.
  sql(`set role service_role; select public.title_claim_access('${staff}','staff@example.test','{}');`);
  assert.throws(()=>sql(`set role service_role; select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`),/Member access changed/);
  console.log('CAS: stale member revoke after claim rejects passed');

  async function blocked(firstAction,secondAction,{failure,label}={}) {
    const first=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']}); let output='',error='';
    first.stdout.on('data',c=>{output+=c;}); first.stderr.on('data',c=>{error+=c;});
    const finished=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',code=>code===0?resolve(output):reject(new Error(error)));});
    first.stdin.write(`begin; set local role service_role; ${firstAction} select 'FIRST_DONE';\n`);
    const until=Date.now()+10_000; while(!output.includes('FIRST_DONE')&&Date.now()<until) await new Promise(r=>setTimeout(r,15));
    assert.match(output,/FIRST_DONE/,'first mutation acquired lifecycle lock');
    const second=session(`set application_name='staff_race_second'; set role service_role; ${secondAction}`);
    // Attach the failure handler before permitting the blocked session to run.
    const outcome=second.done.then(value=>({value}),error=>({error}));
    await awaitBlocked('staff_race_second'); first.stdin.end('commit;\n'); await finished;
    const result=await outcome;
    if(failure) assert.match(String(result.error),failure,label); else if(result.error) throw result.error;
    console.log(`Concurrency: ${label} passed`); return result.value;
  }
  setup();
  let invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(`select public.title_cancel_invitation('${w}','${owner}','owner@example.test',1,'${invitation}',1);`,
    `select public.title_claim_access('${staff}','staff@example.test','{}');`,{label:'cancel wins against claim without changing existing membership'});
  assert.equal(sql(`select version||':'||active from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(),'1:true');
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(`select public.title_prepare_invitation('${w}','${owner}','owner@example.test',1,'staff@example.test','viewer','{A}',false,false,'[]','${invitation}',1,false);`,
    `select public.title_cancel_invitation('${w}','${owner}','owner@example.test',1,'${invitation}',1);`,{failure:/Invitation changed/,label:'edit wins then stale cancel conflicts'});
  assert.equal(sql(`select version||':'||(revoked_at is null) from public.title_invitations where id='${invitation}';`).trim(),'2:true');
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(`select public.title_claim_access('${staff}','staff@example.test','{}');`,
    `select public.title_prepare_invitation('${w}','${owner}','owner@example.test',1,'staff@example.test','viewer','{A}',false,false,'[]','${invitation}',1,false);`,{failure:/Accepted invitations/,label:'claim wins then edit cannot change accepted grant'});
  setup();
  const request='30000000-0000-4000-8000-000000000001';
  const prepare=`select public.title_prepare_invitation('${w}','${owner}','owner@example.test',1,'new@example.test','operations','{A}',false,false,'[]',null,null,false,'${request}');`;
  await blocked(prepare,prepare,{label:'concurrent same request creates one grant'});
  assert.equal(sql(`select count(*) from public.title_invitations where workspace_id='${w}' and email='new@example.test';`).trim(),'1');
  setup();
  const admin='10000000-0000-4000-8000-000000000003';
  sql(`insert into auth.users(id,email,email_confirmed_at) values('${admin}','admin@example.test',now());
    insert into public.title_memberships(workspace_id,user_id,role,company_ids) values('${w}','${admin}','admin','{A}');`);
  await blocked(`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${admin}',1);`,
    `select public.title_prepare_invitation('${w}','${admin}','admin@example.test',1,'new@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());`,
    {failure:/Administrator access changed/,label:'revoked actor cannot prepare after waiting for lifecycle lock'});
  assert.equal(sql(`select count(*) from public.title_invitations where email='new@example.test';`).trim(),'0');
  setup();
  const w2='20000000-0000-4000-8000-000000000002', staff2='10000000-0000-4000-8000-000000000003';
  sql(`insert into auth.users(id,email,email_confirmed_at) values('${staff2}','staff2@example.test',now());
    set role service_role;
    insert into public.title_workspaces(id,name,state) values('${w2}','Fictional second','{"companies":[{"id":"A"}]}');
    insert into public.title_memberships(workspace_id,user_id,role,all_companies) values('${w2}','${owner}','owner',true);
    select public.title_prepare_invitation('${w2}','${owner}','owner@example.test',1,'staff@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
    select public.title_prepare_invitation('${w2}','${owner}','owner@example.test',1,'staff2@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
    select public.title_prepare_invitation('${w}','${owner}','owner@example.test',1,'staff2@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());`);
  await blocked(`select public.title_claim_access('${staff}','staff@example.test','{}');`,
    `select public.title_claim_access('${staff2}','staff2@example.test','{}');`,{label:'opposite invitation insertion order claims two workspaces without deadlock'});
  assert.equal(sql(`select count(*) from public.title_memberships where user_id in ('${staff}','${staff2}') and active;`).trim(),'4');
  setup();
  sql(`update auth.users set email='renamed@example.test' where id='${staff}';
    set role service_role; select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`);
  assert.equal(sql(`select count(*) from public.title_invitations where revoked_at is not null and recipient_user_id='${staff}';`).trim(),'1');
  console.log('Identity binding: changing Auth email still cancels its old pending invitation passed');
  setup();
  sql(`update auth.users set email='renamed@example.test' where id='${staff}';
    insert into auth.users(id,email,email_confirmed_at) values('${staff2}','staff@example.test',now());
    set role service_role; select public.title_claim_access('${staff2}','staff@example.test','{}');`);
  assert.equal(sql(`select count(*) from public.title_memberships where user_id='${staff2}';`).trim(),'0');
  console.log('Identity binding: recycled email cannot claim an invitation bound to another account passed');
  setup();
  sql(`set role service_role; update public.title_workspaces set state='{"companies":[]}' where id='${w}';
    select public.title_claim_access('${staff}','staff@example.test','{}');`);
  assert.equal(sql(`select version from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(),'1');
  console.log('Claim validation: removed company does not install stale grants passed');

  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  const mailRequest='40000000-0000-4000-8000-000000000001';
  const beginMail=(id=invitation,requestId=mailRequest)=>`select public.title_begin_invitation_email('${w}','${owner}','owner@example.test',1,'${id}',1,'${requestId}');`;
  const duplicate=await blocked(beginMail(),beginMail(),{label:'concurrent same email request grants send only once'});
  assert.match(duplicate,/"send": false/);
  assert.equal(sql(`select count(*) from public.title_invitation_deliveries;`).trim(),'1');
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(beginMail(),beginMail(invitation,'40000000-0000-4000-8000-000000000002'),
    {failure:/recently requested/,label:'different concurrent email request is stopped by cooldown'});
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(`select public.title_cancel_invitation('${w}','${owner}','owner@example.test',1,'${invitation}',1);`,beginMail(),
    {failure:/Invitation changed/,label:'cancel wins against email begin'});
  assert.equal(sql(`select count(*) from public.title_invitation_deliveries;`).trim(),'0');
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(`select public.title_claim_access('${staff}','staff@example.test','{}');`,beginMail(),
    {failure:/Invitation changed/,label:'claim wins against email begin'});
  assert.equal(sql(`select count(*) from public.title_invitation_deliveries;`).trim(),'0');
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  await blocked(beginMail(),`select public.title_cancel_invitation('${w}','${owner}','owner@example.test',1,'${invitation}',1);`,
    {label:'authorized email intent does not block later invitation cancellation'});
  assert.equal(sql(`select (revoked_at is not null)::text from public.title_invitations where id='${invitation}';`).trim(),'true');
  assert.equal(sql(`select count(*) from public.title_invitation_deliveries;`).trim(),'1');
  // A canceled grant cannot become active merely because an earlier email send finishes.
  const delivery=sql(`select id from public.title_invitation_deliveries;`).trim();
  sql(`set role service_role; select public.title_finish_invitation_email('${w}','${owner}','owner@example.test','${delivery}','${mailRequest}','sent');
    select public.title_claim_access('${staff}','staff@example.test','{}');`);
  assert.equal(sql(`select version from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(),'1');
  console.log('Email finish: late provider success cannot resurrect a canceled grant passed');
  setup(); invitation=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
  sql(`update auth.users set email='renamed@example.test' where id='${staff}';`);
  assert.throws(()=>sql(`set role service_role; ${beginMail()}`),/account identity changed/);
  sql(`insert into auth.users(id,email,email_confirmed_at) values('${staff2}','staff@example.test',now());`);
  assert.throws(()=>sql(`set role service_role; ${beginMail()}`),/account identity changed/);
  assert.equal(sql(`select count(*) from public.title_invitation_deliveries;`).trim(),'0');
  console.log('Email identity: renamed and recycled emails cannot receive another account grant passed');

  const assignedState=JSON.stringify({companies:[{id:'A'}],tasks:[{id:'task-1',companyId:'A',owner:'staff@example.test',assigneeId:staff,title:'Fictional assigned work'}],orders:[]});
  const commitAssigned=`select public.title_commit('${w}','${owner}','owner@example.test',1,0,gen_random_uuid(),'assignment','${assignedState}','["editDraft"]','{A}');`;
  setup();
  await blocked(`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`,commitAssigned,
    {failure:/selected staff account no longer/,label:'revocation after API directory lookup blocks new assignment atomically'});
  assert.equal(sql(`select revision from public.title_workspaces where id='${w}';`).trim(),'0');
  assert.equal(sql(`select count(*) from public.title_command_receipts;`).trim(),'0');
  setup();
  await blocked(commitAssigned,`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`,
    {label:'assignment may commit before later revocation without deadlock'});
  assert.equal(sql(`select state->'tasks'->0->>'assigneeId' from public.title_workspaces where id='${w}';`).trim(),staff);
  assert.equal(sql(`select active::text from public.title_memberships where workspace_id='${w}' and user_id='${staff}';`).trim(),'false');
  // Three sessions exercise the nested import edge: an unrelated workspace
  // writer blocks the import, then a staff edit queues behind the import's
  // advisory lock. A wrapper that takes workspace first would fail this check
  // (and can deadlock when title_commit later tries to acquire the advisory lock).
  async function importOrder(importCall, label) {
    const holder=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']}); let output='',error='';
    holder.stdout.on('data',chunk=>{output+=chunk;}); holder.stderr.on('data',chunk=>{error+=chunk;});
    const held=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('close',code=>code===0?resolve(output):reject(new Error(error)));});
    holder.stdin.write(`begin; set local role service_role; select 1 from public.title_workspaces where id='${w}' for update; select 'HOLDER_READY';\n`);
    const until=Date.now()+10_000; while(!output.includes('HOLDER_READY')&&Date.now()<until) await new Promise(r=>setTimeout(r,15));
    assert.match(output,/HOLDER_READY/);
    const importer=session(`set application_name='staff_import_order'; set role service_role; ${importCall}`);
    const importResult=importer.done.then(value=>({value}),error=>({error}));
    await awaitBlocked('staff_import_order');
    const pending=sql(`select id from public.title_invitations where workspace_id='${w}';`).trim();
    const editor=session(`set application_name='staff_edit_order'; set role service_role;
      select public.title_prepare_invitation('${w}','${owner}','owner@example.test',1,'staff@example.test','viewer','{A}',false,false,'[]','${pending}',1,false);`);
    const editResult=editor.done.then(value=>({value}),error=>({error}));
    await awaitBlocked('staff_edit_order');
    assert.equal(sql(`select wait_event from pg_stat_activity where application_name='staff_edit_order';`).trim(),'advisory','staff mutation must wait before target membership/workspace row locks');
    holder.stdin.end('commit;\n'); await held;
    for(const result of await Promise.all([importResult,editResult])) if(result.error) throw result.error;
    assert.equal(sql(`select revision from public.title_workspaces where id='${w}';`).trim(),'1');
    console.log(`Concurrency: ${label} nested commit keeps advisory before workspace passed`);
  }
  const importState='{"companies":[{"id":"A"}],"tasks":[],"orders":[],"inbox":[]}';
  for(const name of ['title_import_missive','title_import_missive_attachment']) {
    setup();
    sql(`set role service_role; insert into public.title_integrations(workspace_id,provider,status,config) values('${w}','missive','configured','{"mapping":{"version":1,"companyId":"A"}}');`);
    await importOrder(`select public.${name}('${w}','${owner}','owner@example.test',1,0,gen_random_uuid(),'legacy','${importState}',1,'A');`,name);
  }
  setup();
  sql(`set role service_role; insert into public.title_integrations(workspace_id,provider,status,config) values('${w}','missive','configured','{"schemaVersion":2,"revision":1,"mappings":[{"id":"route:org:shared:A","organizationId":"org","teamId":"shared","companyId":"A","enabled":true,"version":1}]}');`);
  await importOrder(`select public.title_import_missive_routed('${w}','${owner}','owner@example.test',1,0,gen_random_uuid(),'routed','${importState}',1,'A',1,'route:org:shared:A','importMissiveText');`,'routed Missive');
  console.log('Staff lifecycle transaction verification complete; all databases were disposable local fixtures.');
} finally {
  if(started) command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  fs.rmSync(dir,{recursive:true,force:true});
}
