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
const dir=fs.mkdtempSync(path.join(process.platform==='darwin'?'/tmp':os.tmpdir(),'title-jv-portal-sql-'));
const data=path.join(dir,'data'),user='title_jv_fixture',port='55460';
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
 if(failure && !result.error && result.value?.includes('errorCode'))result.error=new Error(result.value.includes('conflict')?'Application changed':result.value.includes('invalid')?'Invalid application request':result.value);
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
const setup=()=>sql(`truncate public.title_workspaces,auth.users,vault.secrets,storage.objects,title_private.jv_portal_rates cascade;
 insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
 set role service_role;
 insert into public.title_workspaces(id,name,state) values('${w}','Fictional JV concurrency','{"companies":[{"id":"C1","name":"Fictional Company"},{"id":"C2","name":"Other Company"}],"documents":[{"id":"D1","companyId":"C1","assetId":"A1","version":1,"visibility":"Restricted","category":"Applications"}]}');
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
 if current_setting('title_test.vault_write_failure',true)='yes' or (current_setting('title_test.vault_adoption_failure',true)='yes' and new_name like 'title:jv:%') then raise exception 'FICTIONAL_PRIVATE_ERROR';end if;
 insert into vault.secrets(secret,name,description) values(encode(public.pgp_sym_encrypt(new_secret,'FICTIONAL_TEST_KEY_ONLY'),'base64'),new_name,new_description) returning id into result;return result;end $$;
 create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void language plpgsql set search_path='' as $$ begin
 if current_setting('title_test.vault_write_failure',true)='yes' then raise exception 'FICTIONAL_PRIVATE_ERROR';end if;
 update vault.secrets set secret=encode(public.pgp_sym_encrypt(new_secret,'FICTIONAL_TEST_KEY_ONLY'),'base64') where id=secret_id;
 if not found then raise exception 'FICTIONAL_PRIVATE_ERROR';end if;end $$;
 revoke all on schema vault from public,anon,authenticated,service_role;
 revoke all on all tables in schema vault from public,anon,authenticated,service_role;
 revoke all on all functions in schema vault from public,anon,authenticated,service_role;`);
 sql(`create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);`);
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260924150748_title_jv_intake.sql'),'utf8'));
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260924155947_title_jv_recipient_portal.sql'),'utf8'));
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260924173821_title_security_center.sql'),'utf8'));
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260924174405_title_document_scan_gate.sql'),'utf8'));
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260925182800_title_company_workspace_records.sql'),'utf8'));
 const hash=c=>c.repeat(64), token=hash('a'), sess=hash('b'), otp=hash('c'), ip=hash('d');
 const staffCall=(action,input={},actor=staff,company='C1')=>`select public.title_jv_portal_staff('${w}','${actor}',1,'${company}','${action}',${json(input)});`;
 const publicCall=(action,input={},credential=sess,ipHash=ip)=>`select public.title_jv_portal_public('${action}','${credential}','${ipHash}',${json(input)});`;
 const staffRun=(...args)=>result(sql(`set role service_role;${staffCall(...args)}`));
 const publicRun=(...args)=>{const r=result(sql(`set role service_role;${publicCall(...args)}`));if(['conflict','invalid','unavailable'].includes(r.errorCode))throw new Error({conflict:'Application changed',invalid:'Invalid application request',unavailable:'Application unavailable'}[r.errorCode]);return r;};
 const payload={applicants:[{id:'fictional-person',name:'FICTIONAL PRIVATE NAME',email:'private@example.test',phone:'7045550100',dob:'1980-01-01',ssn:'123456789',driverLicense:'FICTIONAL-PRIVATE-DL',currentAddress:'FICTIONAL PRIVATE ADDRESS',ownershipType:'individual',businessName:'',businessStatus:'not-applicable',businessReference:'',residenceHistory:[{id:'r1',address:'FICTIONAL PRIVATE ADDRESS',from:'2000-01-01',to:''}],employmentHistory:[{id:'e1',employer:'FICTIONAL PRIVATE EMPLOYER',role:'',address:'',from:'2000-01-01',to:''}]}],logoPreferences:'',notes:'FICTIONAL_PRIVATE_NOTE'};
 let id;
 const create=(credential=token,requestId='e8400000-0000-4000-8000-000000000010')=>staffRun('create',{requestId,recipientName:'FICTIONAL RECIPIENT',email:'recipient@example.test',tokenHash:credential});
 const start=(credential=token,codeHash=otp)=>{const started=publicRun('start',{codeHash},credential);if(started.job)publicRun('challenge-result',{jobId:started.job.jobId,status:'sent'},credential);return started;};
 const verify=(sessionHash=sess,codeHash=otp,credential=token)=>publicRun('verify',{codeHash,sessionHash},credential);
 const setupPortal=()=>{setup();id=create().request.id;start();return verify().application;};
 const reserve=(bytes=100)=>publicRun('reserve-attachment',{name:'fictional.txt',mime:'text/plain',bytes,sha256:hash('e')});
 const finalize=a=>{sql(`insert into storage.objects(bucket_id,name,metadata) values('title-documents','${a.objectPath}','{"size":100}');`);return publicRun('finalize-attachment',{attachmentId:a.id});};
 const submit=version=>publicRun('submit',{expectedVersion:version,payload});
 setupPortal();const initial=publicRun('load').application;assert.deepEqual(initial.payload,{applicants:[],logoPreferences:'',notes:''});assert.equal(initial.companyName,'Fictional Company');
 for(const key of ['workspaceId','companyId','secretId','createdBy','email','tokenHash','sessionHash'])assert.equal(Object.hasOwn(initial,key),false);
 assert.deepEqual(publicRun('start',{codeHash:otp},hash('f')),{});
 assert.equal(publicRun('load',{},hash('f')).errorCode,'forbidden');
 assert.throws(()=>publicRun('save',{expectedVersion:1,payload:{...payload,steps:[]}}),/Invalid application request/);
 assert.throws(()=>publicRun('save',{expectedVersion:1,payload,workspaceId:w}),/Invalid application request/);
 assert.throws(()=>staffRun('load-submission',{id},staff,'C2'),/Application access unavailable/);
 assert.throws(()=>staffRun('create',{requestId:'not-uuid',recipientName:'x',email:'x@example.test',tokenHash:token}),/Invalid application request/);
 assert.throws(()=>publicRun('submit',{expectedVersion:1,payload:{...payload,applicants:[]}}),/Invalid application request/);
 // Challenge attempts persist on a rejected request; consume is atomic and replay denied.
 setup();id=create().request.id;start();for(let i=0;i<5;i++)assert.equal(verify(sess,hash('f')).errorCode,'challenge_failed');assert.equal(verify().errorCode,'forbidden');assert.equal(sql(`select challenge_attempts from title_private.jv_portal_invites where id='${id}';`).trim(),'5');
 setup();id=create().request.id;start();await blocked(publicCall('verify',{codeHash:otp,sessionHash:sess},token),publicCall('verify',{codeHash:otp,sessionHash:hash('e')},token),'challenge consumption has one winner');assert.equal(verify().errorCode,'forbidden');assert.equal(publicRun('load').application.id,id);assert.equal(publicRun('load',{},hash('e')).errorCode,'forbidden');
 setupPortal();assert.deepEqual(start(),{});sql(`update title_private.jv_portal_invites set challenge_started_at=now()-interval '61 seconds' where id='${id}'`);assert.ok(start().job);
 for(let i=0;i<4;i++){sql(`update title_private.jv_portal_invites set challenge_started_at=now()-interval '61 seconds' where id='${id}'`);start();}assert.deepEqual(start(),{});assert.equal(sql(`select challenge_count from title_private.jv_portal_invites where id='${id}'`).trim(),'5');
 setupPortal();for(let i=0;i<101;i++)publicRun('verify',{codeHash:otp,sessionHash:hash('e')},hash('f'));assert.equal(publicRun('verify',{codeHash:otp,sessionHash:hash('e')},hash('f')).errorCode,'rate_limit');
 // CAS and fresh authority remain serialized against the existing membership lifecycle.
 setupPortal();await blocked(publicCall('save',{expectedVersion:1,payload}),publicCall('save',{expectedVersion:1,payload}),'recipient save CAS has one winner',/Application changed/);assert.equal(publicRun('load').application.version,2);
 const revokeMember=`select public.title_revoke_member('${w}','${owner}','owner@example.test',1,'${staff}',1);`;
 setupPortal();const revoked=await blocked(revokeMember,publicCall('load'),'membership revocation fences public reads');assert.equal(result(revoked).errorCode,'forbidden');
 setupPortal();await blocked(`update public.title_memberships set restricted_access=false where workspace_id='${w}' and user_id='${staff}';`,publicCall('save',{expectedVersion:1,payload}),'restricted withdrawal fences recipient writes');assert.equal(publicRun('load').errorCode,'forbidden');
 setupPortal();await blocked(`update public.title_memberships set company_ids='{}' where workspace_id='${w}' and user_id='${staff}';`,publicCall('load'),'company scope withdrawal fences recipient reads');assert.equal(publicRun('load').errorCode,'forbidden');
 setupPortal();await blocked(`update public.title_workspaces set state=jsonb_set(state,'{companies}','[]') where id='${w}';`,publicCall('load'),'company deletion fences recipient reads');assert.equal(publicRun('load').errorCode,'forbidden');
 setupPortal();const a=reserve();await blocked(staffCall('revoke',{id,expectedVersion:1}),publicCall('finalize-attachment',{attachmentId:a.id}),'invite revocation fences finalization');assert.equal(publicRun('load').errorCode,'forbidden');assert.equal(sql(`select count(*) from public.title_assets where recipient_invitation_id='${id}'`).trim(),'0');
 // Upload ownership, quota, original bytes metadata and atomic adoption.
 setupPortal();const upload=reserve();assert.throws(()=>publicRun('finalize-attachment',{attachmentId:upload.id}),/Application unavailable/);finalize(upload);
 assert.equal(publicRun('load').application.attachments.length,1);assert.equal(publicRun('download',{attachmentId:upload.id}).objectPath,upload.objectPath);
 assert.equal(publicRun('download',{attachmentId:crypto.randomUUID()}).errorCode,'forbidden');
 const submitted=submit(2);assert.equal(submitted.application.status,'Submitted');assert.ok(submitted.notificationJob);assert.equal(run('load').status,'Ready for review');assert.equal(run('load').updatedBy,null);assert.equal(run('load').payload.applicants[0].ssn,'123456789');assert.equal(run('load').payload.sourceDocumentIds.length,1);
 assert.equal(sql(`select uploaded_by is null and recipient_invitation_id='${id}' from public.title_assets where object_path='${upload.objectPath}'`).trim(),'t');
 assert.equal(sql(`select state->'documents'->1->>'visibility' from public.title_workspaces where id='${w}'`).trim(),'Restricted');
 assert.equal(submit(2).application.version,3);assert.equal(sql(`select count(*) from public.title_assets where recipient_invitation_id='${id}'`).trim(),'1');
 assert.throws(()=>publicRun('save',{expectedVersion:3,payload}),/Application changed/);assert.throws(()=>reserve(),/Application changed/);
 const correction=staffRun('request-changes',{id,expectedVersion:3,note:'Please review your current address.',tokenHash:hash('f')});assert.equal(correction.request.status,'Changes requested');assert.equal(publicRun('load').errorCode,'forbidden');assert.deepEqual(start(),{});sql(`update title_private.jv_portal_invites set challenge_started_at=now()-interval '61 seconds' where id='${id}'`);start(hash('f'));verify(sess,otp,hash('f'));
 publicRun('remove-attachment',{expectedVersion:4,attachmentId:upload.id});assert.equal(publicRun('load').application.attachments.length,0);assert.equal(sql(`select count(*) from storage.objects where name='${upload.objectPath}'`).trim(),'1');assert.equal(sql(`select count(*) from public.title_assets where object_path='${upload.objectPath}'`).trim(),'1');
 // A newer internal edit is never silently replaced; explicit apply has its own CAS.
 setupPortal();run('save',input(0));const original=run('load');submit(1);let metadata=staffRun('list').requests[0];assert.equal(metadata.needsMerge,true);assert.equal(run('load').version,original.version);assert.throws(()=>staffRun('apply',{id,expectedVersion:2,expectedApplicationVersion:0}),/Application changed/);staffRun('apply',{id,expectedVersion:2,expectedApplicationVersion:1});assert.equal(run('load').payload.sourceDocumentIds[0],'D1');assert.equal(run('load').version,2);
 assert.equal(staffRun('apply',{id,expectedVersion:2,expectedApplicationVersion:1}).request.appliedVersion,2);assert.equal(run('load').version,2);
 setupPortal();for(let i=0;i<4;i++)reserve(10485760);assert.throws(()=>reserve(1),/Invalid application request/);
 setupPortal();for(let i=0;i<4;i++){const retained=reserve(10485760);sql(`insert into storage.objects(bucket_id,name,metadata) values('title-documents','${retained.objectPath}','{"size":10485760}');`);publicRun('finalize-attachment',{attachmentId:retained.id});publicRun('remove-attachment',{expectedVersion:2+i*2,attachmentId:retained.id});}assert.throws(()=>reserve(1),/Invalid application request/);
 setupPortal();for(let i=0;i<10;i++)reserve(1);assert.throws(()=>reserve(1),/Invalid application request/);
 setupPortal();const failedUpload=reserve();finalize(failedUpload);const before=sql(`select state::text from public.title_workspaces where id='${w}'`);
 assert.deepEqual(result(sql(`set role service_role;set title_test.vault_write_failure='yes';${publicCall('submit',{expectedVersion:2,payload})}`)),{errorCode:'unavailable'});
 assert.equal(publicRun('load').application.status,'Draft');assert.equal(sql(`select count(*) from public.title_assets where recipient_invitation_id='${id}'`).trim(),'0');assert.equal(sql(`select state::text from public.title_workspaces where id='${w}'`),before);
 // Failure after asset registration still rolls back the entire adoption transaction.
 assert.deepEqual(result(sql(`set role service_role;set title_test.vault_adoption_failure='yes';${publicCall('submit',{expectedVersion:2,payload})}`)),{errorCode:'unavailable'});assert.equal(publicRun('load').application.status,'Draft');assert.equal(sql(`select count(*) from public.title_assets where recipient_invitation_id='${id}'`).trim(),'0');assert.equal(sql(`select state::text from public.title_workspaces where id='${w}'`),before);
 setupPortal();for(let i=0;i<9;i++)reserve(1);const reserveInput={name:'one.txt',mime:'text/plain',bytes:1,sha256:hash('e')};await blocked(publicCall('reserve-attachment',reserveInput),publicCall('reserve-attachment',reserveInput),'attachment quota reservation has one final-slot winner',/Invalid application request/);
 setupPortal();await blocked(call('save',input(0)),publicCall('submit',{expectedVersion:1,payload}),'concurrent staff edits prevent auto-overwrite');assert.equal(staffRun('list').requests[0].needsMerge,true);assert.equal(run('load').payload.notes,'FICTIONAL_PRIVATE_NOTE');
 // Blank-at-baseline protection, inherited original drift, limiter durability, and safe notification retry.
 setup();run('save',input(0,'Draft',{...p,applicants:payload.applicants}));id=create().request.id;start();verify();submit(1);assert.equal(staffRun('list').requests[0].needsMerge,true);assert.equal(run('load').payload.notes,'FICTIONAL_PRIVATE_NOTE');assert.equal(run('load').version,1);
 setup();run('save',input(0,'Draft',{...p,notes:''}));id=create().request.id;start();verify();sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,version}','2') where id='${w}'`);submit(1);assert.equal(staffRun('list').requests[0].needsMerge,true);assert.equal(run('load').version,1);
 setupPortal();publicRun('load');const rateBefore=Number(sql(`select count from title_private.jv_portal_rates where ip_hash='${ip}' and action='session'`).trim());for(let i=0;i<3;i++)assert.throws(()=>publicRun('save',{expectedVersion:999,payload}),/Application changed/);assert.equal(Number(sql(`select count from title_private.jv_portal_rates where ip_hash='${ip}' and action='session'`).trim()),rateBefore+3);
 setupPortal();const sent=submit(1);assert.equal(submit(1).notificationJob.jobId,sent.notificationJob.jobId);publicRun('notification-result',{jobId:sent.notificationJob.jobId,status:'sent',providerId:'fictional-notification'});assert.equal(submit(1).notificationJob,null);
 setupPortal();const download=reserve();finalize(download);assert.equal(staffRun('download-attachment',{id,attachmentId:download.id}).objectPath,download.objectPath);assert.throws(()=>staffRun('download-attachment',{id,attachmentId:crypto.randomUUID()}),/Application access unavailable/);assert.throws(()=>staffRun('download-attachment',{id,attachmentId:download.id},staff,'C2'),/Application access unavailable/);
 setupPortal();submit(1);sql(`update title_private.jv_portal_invites set expires_at=now()-interval '1 second' where id='${id}'`);assert.equal(publicRun('load').errorCode,'forbidden');assert.equal(staffRun('list').requests[0].status,'Submitted');assert.equal(staffRun('load-submission',{id}).payload.notes,payload.notes);assert.equal(staffRun('apply',{id,expectedVersion:2,expectedApplicationVersion:1}).request.status,'Submitted');const expiredChanges=staffRun('request-changes',{id,expectedVersion:2,note:'Please confirm your address.',tokenHash:hash('f')});assert.equal(expiredChanges.request.status,'Changes requested');assert.ok(Date.parse(expiredChanges.request.expiresAt)>Date.now());
 // Invitation send claim is exactly once, with explicit metadata on uncertain/failed delivery.
 setupPortal();const claimed=staffRun('send',{id,expectedVersion:1,tokenHash:hash('f')});assert.ok(claimed.job);assert.equal(claimed.request.deliveryStatus,'sending');sql(`update title_private.jv_portal_invites set delivery_at=now()-interval '3 minutes' where id='${id}'`);assert.equal(staffRun('list').requests[0].deliveryStatus,'unknown');assert.throws(()=>staffRun('send',{id,expectedVersion:1,tokenHash:hash('e')}),/Application changed/);assert.equal(staffRun('send',{id,expectedVersion:2,tokenHash:hash('e')}).job,undefined);staffRun('delivery-result',{id,jobId:claimed.job.jobId,status:'unknown'});assert.equal(staffRun('send',{id,expectedVersion:2,tokenHash:hash('e')}).request.deliveryStatus,'unknown');assert.equal(publicRun('load').errorCode,'forbidden');
 // Recipient links never expose internal owners/EINs, and applying a submission preserves them.
 setup();const companyRecords=ownerRecordsFixture();
 sql(`update public.title_workspaces set state=jsonb_set(state,'{companies,0,members}','[{"id":"member-a","name":"Fictional LLC","share":100}]') where id='${w}';`);
 run('save',input(0,'Draft',{...p,companyRecords}));id=create().request.id;start();verify();
 assert.equal(publicRun('load').application.payload.companyRecords,undefined);
 assert.throws(()=>publicRun('save',{expectedVersion:1,payload:{...payload,companyRecords}}),/Invalid application request/);
 submit(1);assert.equal(staffRun('list').requests[0].needsMerge,true);
 staffRun('apply',{id,expectedVersion:2,expectedApplicationVersion:1});
 assert.deepEqual(run('load').payload.companyRecords,companyRecords);assert.deepEqual(run('load').payload.applicants,payload.applicants);
 assert.doesNotMatch(JSON.stringify(publicRun('load')),/120000001|120000002|Fictional Cedar Holdings/);
 console.log('Company records portal: private owners and EINs preserved internally and excluded from recipient reads/writes passed.');
 // Encrypted data and audit boundaries, expiry, and gateway-only privileges.
 setupPortal();publicRun('save',{expectedVersion:1,payload});assert.equal(sql(`select count(*) from vault.secrets where secret like '%FICTIONAL_PRIVATE%'`).trim(),'0');
 for(const table of ['title_private.jv_portal_events','public.title_audit'])assert.equal(sql(`select count(*) from ${table} t where row_to_json(t)::text like '%FICTIONAL_PRIVATE%' or row_to_json(t)::text like '%123456789%'`).trim(),'0');
 sql(`update title_private.jv_portal_invites set session_expires_at=now()-interval '1 second' where id='${id}'`);assert.equal(publicRun('load').errorCode,'forbidden');
 setupPortal();sql(`update title_private.jv_portal_invites set expires_at=now()-interval '1 second' where id='${id}'`);assert.equal(publicRun('load').errorCode,'forbidden');assert.deepEqual(start(),{});assert.equal(staffRun('list').requests[0].status,'Expired');
 for(const role of ['anon','authenticated','service_role'])for(const table of ['jv_portal_invites','jv_portal_attachments','jv_portal_events','jv_portal_rates'])assert.throws(()=>sql(`set role ${role};select * from title_private.${table};`),/permission denied/);
 for(const role of ['anon','authenticated']){assert.throws(()=>sql(`set role ${role};${staffCall('list')}`),/permission denied/);assert.throws(()=>sql(`set role ${role};${publicCall('load')}`),/permission denied/);}
 console.log('JV recipient portal SQL: encrypted storage, capability/OTP/session security, atomic originals adoption, CAS, quotas, expiry, and real PostgreSQL lifecycle races passed.');
}finally{if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(dir,{recursive:true,force:true});}
