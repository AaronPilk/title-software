/** Isolated, temporary PostgreSQL only. Never uses configured or hosted database credentials. */
import fs from 'node:fs';
import {ownerRecordsFixture} from '../../tests/fixtures/company-records.mjs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
const root=process.env.TITLE_JV_TEST_REPO||fileURLToPath(new URL('../../../',import.meta.url));
const dirs=[process.env.TITLE_TEST_PG_BIN,...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin'].filter(Boolean);
const binary=name=>{for(const dir of dirs){const candidate=path.join(dir,name);try{fs.accessSync(candidate,fs.constants.X_OK);return candidate;}catch{}}throw new Error(`Install local PostgreSQL or set TITLE_TEST_PG_BIN (${name} missing). No existing database is used.`);};
const bins=Object.fromEntries(['initdb','pg_ctl','psql'].map(name=>[name,binary(name)]));
const dir=fs.mkdtempSync(path.join(process.platform==='darwin'?'/tmp':os.tmpdir(),'title-jv-sql-'));
const data=path.join(dir,'data'),user='title_jv_fixture',port='55459';
const args=['-X','-h',dir,'-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-At'];
const command=(name,params,options={})=>execFileSync(bins[name],params,{encoding:'utf8',maxBuffer:8_000_000,...options});
const sql=input=>command('psql',args,{input,stdio:['pipe','pipe','pipe']});
function session(input){const child=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(error)));});if(input)child.stdin.end(input);return{child,done,output:()=>output};}
async function until(predicate,label){const deadline=Date.now()+10000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,15));}throw new Error(`Timed out: ${label}`);}
async function blocked(firstAction,secondAction,label,failure){
 const first=session();first.child.stdin.write(`begin;set local role service_role;${firstAction}select 'FIRST_DONE';\n`);
 await until(()=>first.output().includes('FIRST_DONE'),'first transaction holds locks');
 const second=session(`set application_name='jv_race_second';set role service_role;${secondAction}`),outcome=second.done.then(value=>({value}),error=>({error}));
 await until(()=>sql("select exists(select 1 from pg_stat_activity where application_name='jv_race_second' and wait_event_type='Lock');").trim()==='t','second transaction waits');
 first.child.stdin.end('commit;\n');await first.done;const result=await outcome;
 if(failure)assert.match(String(result.error),failure,label);else if(result.error)throw result.error;
 console.log(`Concurrency: ${label} passed`);return result.value;
}
const w='e8200000-0000-4000-8000-000000000010',owner='e8100000-0000-4000-8000-000000000010',staff='e8100000-0000-4000-8000-000000000011';
const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const p={schemaVersion:1,applicants:[],logoPreferences:'',notes:'FICTIONAL_PRIVATE_NOTE',sourceDocumentIds:['D1'],steps:['partnership-agreement','domain','secretary-of-state','federal-tax-id','bank-account','nipr','sc-insurance','nc-insurance','underwriters','softpro','website','email','business-cards','accounting','logo','aba','buyer-title-preference'].map(id=>({id,status:'Not started',assignee:'',dueDate:'',reference:'',note:''}))};
const input=(version,status='Draft',payload=p)=>({expectedVersion:version,payload,status,reviewNote:status==='Reviewed'?'FICTIONAL_PRIVATE_REVIEW':'',sourceManifest:[{documentId:'D1',assetId:'A1',version:1}]});
const call=(action,details={},actor=staff,version=1)=>`select public.title_jv_intake('${w}','${actor}',${version},'C1','${action}',${json(details)});`;
const result=output=>JSON.parse(output.trim().split('\n').filter(line=>line.startsWith('{')||line==='null').at(-1));
const run=(...params)=>result(sql(`set role service_role;${call(...params)}`));
const setup=()=>sql(`truncate public.title_workspaces,auth.users,vault.secrets cascade;
 insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
 set role service_role;
 insert into public.title_workspaces(id,name,state) values('${w}','Fictional JV concurrency','{"companies":[{"id":"C1"}],"documents":[{"id":"D1","companyId":"C1","assetId":"A1","version":1,"visibility":"Restricted","category":"Applications"}]}');
 insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access) values('${w}','${owner}','owner','{}',true,true),('${w}','${staff}','onboarding',array['C1'],false,true);
 insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by) values('${w}','A1','C1','D1','fictional-race/a1.pdf','application/pdf','fictional.pdf',100,repeat('a',64),'${owner}');`);
let started=false;
try{
 command('initdb',['-D',data,`--username=${user}`,'--auth-local=trust','--auth-host=reject','--no-locale']);
 command('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k '${dir}' -h '' -p ${port} -F`,'-w','start']);started=true;
 sql(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
 grant usage on schema auth to service_role;grant execute on function auth.uid() to service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
 for(const name of ['20260912142734_title_backend_foundation.sql','20260912145118_title_verified_access_gateway.sql','20260912145505_title_explicit_conflicts.sql','20260919215301_title_staff_access_lifecycle.sql'])sql(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
 // API-compatible local Vault fixture. pgcrypto encrypts fixture values, but this
 // does NOT verify Supabase Vault's encryption implementation or production key setup.
 sql(`create extension pgcrypto;create schema vault;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null,name text unique,description text);
 create view vault.decrypted_secrets as select id,case when current_setting('title_test.vault_read_failure',true)='yes' then null else public.pgp_sym_decrypt(decode(secret,'base64'),'FICTIONAL_TEST_KEY_ONLY') end as decrypted_secret from vault.secrets;
 create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql set search_path='' as $$ declare result uuid;begin
 if current_setting('title_test.vault_write_failure',true)='yes' then raise exception 'FICTIONAL_PRIVATE_ERROR';end if;
 insert into vault.secrets(secret,name,description) values(encode(public.pgp_sym_encrypt(new_secret,'FICTIONAL_TEST_KEY_ONLY'),'base64'),new_name,new_description) returning id into result;return result;end $$;
 create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void language plpgsql set search_path='' as $$ begin
 if current_setting('title_test.vault_write_failure',true)='yes' then raise exception 'FICTIONAL_PRIVATE_ERROR';end if;
 update vault.secrets set secret=encode(public.pgp_sym_encrypt(new_secret,'FICTIONAL_TEST_KEY_ONLY'),'base64') where id=secret_id;
 if not found then raise exception 'FICTIONAL_PRIVATE_ERROR';end if;end $$;
 revoke all on schema vault from public,anon,authenticated,service_role;
 revoke all on all tables in schema vault from public,anon,authenticated,service_role;
 revoke all on all functions in schema vault from public,anon,authenticated,service_role;`);
 const migration=process.env.TITLE_JV_TEST_MIGRATION||path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_title_jv_intake.sql')));
 sql(fs.readFileSync(migration,'utf8'));
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260925182800_title_company_workspace_records.sql'),'utf8'));
 sql(fs.readFileSync(process.env.TITLE_JV_TEST_SQL||path.join(root,'web/tests/jv-intake.test.sql'),'utf8'));console.log('Rollback SQL access/schema/CAS/review/encrypted-envelope/audit regression fixture passed.');
 setup();await blocked(call('save',input(0)),call('save',input(0)),'concurrent initial save has one winner',/Private application changed/);assert.equal(run('load').version,1);
 const revoke=`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`;
 setup();run('save',input(0));await blocked(revoke,call('load'),'revocation fences private reads',/Private application access changed/);
 setup();await blocked(revoke,call('save',input(0)),'revocation fences private writes',/Private application access changed/);
 setup();await blocked(`update public.title_memberships set restricted_access=false where workspace_id='${w}' and user_id='${staff}';`,call('save',input(0)),'restricted permission withdrawal fences save',/Private application access changed/);
 setup();await blocked(`update public.title_memberships set company_ids='{}' where workspace_id='${w}' and user_id='${staff}';`,call('save',input(0)),'company scope withdrawal fences save',/Private application access changed/);
 setup();await blocked(call('save',input(0)),revoke,'save commits before revocation without deadlock');assert.equal(sql(`select version from public.title_jv_intakes where workspace_id='${w}';`).trim(),'1');
 setup();const remove=`update public.title_workspaces set state=jsonb_set(state,'{companies}','[]') where id='${w}';`;await blocked(remove,call('save',input(0)),'company deletion fences saves',/Private application access changed/);
 setup();const replacement=`update public.title_workspaces set state=jsonb_set(state,'{documents,0,version}','2') where id='${w}';`;await blocked(replacement,call('save',input(0)),'source version race rejects stale handler snapshot',/Private application changed/);
 setup();run('save',input(0,'Ready for review'));run('save',input(1,'Reviewed'));
 sql(`update public.title_workspaces set state=jsonb_set(state,'{documents}',(state->'documents')||'[{"id":"UNRELATED","version":2}]') where id='${w}';`);assert.equal(run('load').status,'Reviewed');
 sql(replacement);const invalidated=run('load');assert.equal(invalidated.status,'Draft');assert.equal(invalidated.version,3);assert.equal(invalidated.sourceChanged,true);assert.equal(invalidated.reviewNote,'');assert.equal(invalidated.reviewedBy,null);
 assert.throws(()=>run('save',input(2,'Reviewed')),/Private application changed/);assert.equal(run('load').version,3);
 setup();run('save',input(0,'Ready for review'));await blocked(replacement,call('save',input(1,'Reviewed')),'replaced original fences manual review',/Private application changed/);assert.equal(run('load').status,'Draft');
 setup();run('save',input(0,'Ready for review'));sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,companyId}','"OTHER"') where id='${w}';`);assert.equal(run('load').status,'Draft');assert.throws(()=>run('save',input(2)),/Private application access changed/);
 setup();run('save',input(0,'Ready for review'));sql(`update public.title_assets set sha256=repeat('b',64) where workspace_id='${w}';`);assert.equal(run('load').status,'Draft');
 setup();run('save',input(0));const secretBefore=sql('select secret from vault.secrets;');
 assert.throws(()=>sql(`set role service_role;set title_test.vault_write_failure='yes';${call('save',input(1))}`),e=>/Private application unavailable/.test(String(e))&&!String(e).includes('FICTIONAL_PRIVATE_ERROR'));
 assert.equal(run('load').version,1);assert.equal(sql('select secret from vault.secrets;'),secretBefore);
 for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`set role ${role};select * from public.title_jv_intakes;`),/permission denied/);
 for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};${call('load')}`),/permission denied/);

 // Company records use the real encrypted-envelope functions, never a second store.
 setup();
 const companyRecords=ownerRecordsFixture(),extended={...p,companyRecords};
 sql(`update public.title_workspaces set state=jsonb_set(state,'{companies,0,members}','[{"id":"member-a","name":"Fictional LLC","share":49},{"id":"member-b","name":"Fictional Other","share":51}]') where id='${w}';`);
 assert.equal(sql(`select public.title_jv_payload_valid(${json(extended)});`).trim(),'t');
 for(const mutate of [r=>r.companyEin=null,r=>r.companyEin='---',r=>r.owners[0].memberId=null,r=>r.owners[0].kind='individual',r=>r.owners[0].representatives[0].email='bad',r=>r.agreements[0].terms[0].percentage='100.001',r=>r.agreements[0].effectiveOn='2026-02-30',r=>r.worksheets[0].fields[0].source='applicant.ssn',r=>r.extra=true]){
   const bad=structuredClone(extended);mutate(bad.companyRecords);assert.equal(sql(`select public.title_jv_payload_valid(${json(bad)});`).trim(),'f');
 }
 run('save',input(0,'Draft',extended));assert.deepEqual(run('load').payload,extended);
 assert.doesNotMatch(sql('select secret from vault.secrets;'),/120000001|120000002|Fictional Cedar/);
 assert.doesNotMatch(sql('select detail from public.title_audit;'),/120000001|120000002|Fictional Cedar/);
 assert.throws(()=>run('save',input(1,'Draft',p)),/Private application changed/);
 const orphan=structuredClone(extended);orphan.companyRecords.owners[0].memberId='foreign';assert.throws(()=>run('save',input(1,'Draft',orphan)),/Private application changed/);
 run('save',input(1,'Ready for review',extended));run('save',input(2,'Reviewed',extended));
 // Restore an older workspace with no optional member IDs: downgrade once and retain values for relinking.
 sql(`update public.title_workspaces set state=jsonb_set(state,'{companies,0,members}','[{"name":"Fictional LLC","share":49},{"name":"Fictional Other","share":51}]') where id='${w}';`);
 let restored=run('load');assert.equal(restored.status,'Draft');assert.equal(restored.sourceChanged,true);assert.equal(restored.version,4);assert.deepEqual(restored.payload,extended);assert.equal(run('load').version,4);
 // One original can serve two purposes, but each use must still be valid before deduplication.
 sql(`update public.title_workspaces set state=jsonb_set(state,'{companies,0,members}','[{"id":"member-a","name":"Fictional LLC","share":49},{"id":"member-b","name":"Fictional Other","share":51}]') where id='${w}';
 update public.title_workspaces set state=jsonb_set(state,'{documents,0,category}','"Company records"') where id='${w}';`);
 const linked=structuredClone(extended);linked.sourceDocumentIds=[];linked.companyRecords.owners[0].documentIds=['D1'];linked.companyRecords.worksheets[0].documentId='D1';
 run('save',input(4,'Ready for review',linked));run('save',input(5,'Reviewed',linked));
 assert.deepEqual(run('load').payload,linked);
 sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,category}','"Formation"') where id='${w}';`);
 restored=run('load');assert.equal(restored.status,'Draft');assert.equal(restored.version,7);assert.equal(restored.sourceChanged,true);
 assert.throws(()=>run('save',input(7,'Draft',linked)),/Private application access changed/);
 linked.companyRecords.worksheets[0].documentId='';assert.equal(run('save',input(7,'Draft',linked)).version,8);
 console.log('Company records SQL: schema parity, Vault roundtrip, private audit, member restore invalidation, purpose-bound originals and reconciliation passed.');
 console.log('JV SQL: authorization, real PostgreSQL races, source invalidation, atomic encryption-boundary writes, and role denial passed.');
}finally{if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(dir,{recursive:true,force:true});}
