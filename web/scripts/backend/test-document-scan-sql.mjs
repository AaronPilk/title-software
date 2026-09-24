/** Isolated, fictional PostgreSQL only. No configured/hosted database is contacted. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
const binary = name => { for (const dir of dirs) { const candidate = path.join(dir, name); try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {} } throw new Error(`Local PostgreSQL ${name} required; no existing database is used.`); };
const bins = Object.fromEntries(['initdb','pg_ctl','psql'].map(name => [name,binary(name)]));
const dir = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'title-scan-gate-'));
const data = path.join(dir,'data'), user='title_security_fixture', port='55463';
const args=['-X','-h',dir,'-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-At'];
const command=(name,params,options={})=>execFileSync(bins[name],params,{encoding:'utf8',maxBuffer:8_000_000,...options});
const sql=input=>command('psql',args,{input,stdio:['pipe','pipe','pipe']}).trim();
const service=input=>sql(`set role service_role; ${input}`).split('\n').filter(line=>line!=='SET').join('\n');

const w='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001';
const object=id=>`${w}/30000000-0000-4000-8000-${String(id).padStart(12,'0')}`;
const hash='a'.repeat(64), other='b'.repeat(64);
const quote=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
const asset=(id,sha=hash,company='A',path=object(id))=>`insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by) values('${w}','asset-${id}','${company}','doc-${id}','${path}','text/plain','fictional.txt',5,'${sha}','${actor}');`;
const prep=(id,company='A')=>service(`select public.title_prepare_document_ingestion('${object(id)}','${w}','${company}','${hash}',5);`);
const receipt=(id,value='null')=>service(`select public.title_record_document_scan('${object(id)}','${w}','A','${hash}',5,${value});`);
const clean=()=>({status:'clean',protocolVersion:1,sha256:hash,byteLength:5,scannedAt:new Date().toISOString(),signatureUpdatedAt:new Date().toISOString(),engineVersion:'ClamAV 1.5.4',signatureVersion:'28133'});
let started=false;
try {
 command('initdb',['-D',data,`--username=${user}`,'--auth-local=trust','--auth-host=reject','--no-locale']);
 command('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k '${dir}' -h '' -p ${port} -F`,'-w','start']); started=true;
 sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;grant usage on schema auth to service_role;grant execute on function auth.uid() to service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
 for(const name of ['20260912142734_title_backend_foundation.sql','20260912145118_title_verified_access_gateway.sql','20260912145505_title_explicit_conflicts.sql','20260919215301_title_staff_access_lifecycle.sql','20260924173821_title_security_center.sql'])sql(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
 sql(`create table title_private.jv_portal_invites(id uuid primary key,workspace_id uuid,company_id text);create table title_private.jv_portal_attachments(id uuid primary key,invitation_id uuid,object_path text,sha256 text,byte_size bigint,state text,created_at timestamptz default now());insert into auth.users(id,email) values('${actor}','fixture@example.test');insert into public.title_workspaces(id,name,state) values('${w}','Fictional','{"companies":[{"id":"A"},{"id":"B"}]}');insert into public.title_memberships(workspace_id,user_id,role,all_companies,restricted_access) values('${w}','${actor}','owner',true,true);${asset(1)}`);
 sql(fs.readFileSync(path.join(root,'supabase/migrations/20260924174405_title_document_scan_gate.sql'),'utf8'));
 assert.equal(JSON.parse(service(`select public.title_document_scan_status('${w}');`)).legacyUnscannedCount,1);
 assert.equal(JSON.parse(prep(2)).policy,'pending_setup');
 service(asset(2)); // Previous API remains usable during pending-setup rollout, without clean status.
 assert.equal(sql(`select status from title_private.document_scan_receipts where object_path='${object(2)}'`),'pending_setup');
 assert.throws(()=>receipt(2),/duplicate/);
 assert.throws(()=>prep(3,'C'),/Invalid document scan target/);
 for(const role of ['anon','authenticated','service_role']) {
  assert.throws(()=>sql(`set role ${role};update title_private.document_scan_policy set mode='required';`),/permission denied/);
  assert.throws(()=>sql(`set role ${role};delete from title_private.document_scan_receipts;`),/permission denied/);
 }
 for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};select public.title_prepare_document_ingestion('${object(3)}','${w}','A','${hash}',5);`),/permission denied/);

 const oldInvitation='40000000-0000-4000-8000-000000000002',oldAttachment='50000000-0000-4000-8000-000000000002',oldPath=`jv-recipient/${oldInvitation}/${oldAttachment}`;
 sql(`insert into title_private.jv_portal_invites values('${oldInvitation}','${w}','A');insert into title_private.jv_portal_attachments(id,invitation_id,object_path,sha256,byte_size,state) values('${oldAttachment}','${oldInvitation}','${oldPath}','${hash}',5,'pending');`);
 service(`select public.title_record_document_scan('${oldPath}','${w}','A','${hash}',5,null);`);
 sql(`update title_private.jv_portal_attachments set state='ready' where id='${oldAttachment}';`);
 receipt(3);sql(`select title_private.activate_document_scanning();`);
 // A previously ready recipient original can still be adopted after activation.
 service(asset(8,hash,'A',oldPath));
 assert.equal(sql(`select status from title_private.document_scan_receipts where object_path='${oldPath}'`),'legacy_unscanned');

 assert.throws(()=>service(asset(3)),/clearance/);assert.throws(()=>service(asset(9)),/clearance/);
 assert.throws(()=>receipt(4),/clean document scan/);
 for(const value of [{...clean(),status:'infected'},{...clean(),sha256:other},{...clean(),byteLength:6},{...clean(),scannedAt:'2020-01-01T00:00:00Z'},{...clean(),signatureUpdatedAt:'2020-01-01T00:00:00Z'},{...clean(),protocolVersion:2}])assert.throws(()=>receipt(4,quote(value)),/Invalid clean scan receipt/);
 receipt(4,quote(clean()));assert.throws(()=>service(asset(4,other)),/clearance/);assert.throws(()=>service(asset(4,hash,'B')),/clearance/);service(asset(4));
 assert.equal(sql(`select count(*) from public.title_security_events where event_type='document.scan_clean'`),'1');
 // Recipient reservations are resolved in SQL, not from recipient-supplied workspace IDs.
 const invitation='40000000-0000-4000-8000-000000000001',attachment='50000000-0000-4000-8000-000000000001',jp=`jv-recipient/${invitation}/${attachment}`;
 sql(`insert into title_private.jv_portal_invites values('${invitation}','${w}','A');insert into title_private.jv_portal_attachments(id,invitation_id,object_path,sha256,byte_size,state) values('${attachment}','${invitation}','${jp}','${hash}',5,'pending');`);
 assert.throws(()=>sql(`update title_private.jv_portal_attachments set state='ready' where id='${attachment}';`),/clearance/);
 assert.equal(JSON.parse(service(`select public.title_prepare_document_ingestion('${jp}',null,null,'${hash}',5);`)).companyId,'A');
 assert.throws(()=>service(`select public.title_prepare_document_ingestion('${jp}',null,null,'${other}',5);`),/reservation unavailable/);
 service(`select public.title_record_document_scan('${jp}','${w}','A','${hash}',5,${quote(clean())});`);
 sql(`update title_private.jv_portal_attachments set state='ready' where id='${attachment}';`);
 service(asset(5,hash,'A',jp));
 assert.equal(JSON.parse(service(`select public.title_document_scan_status('${w}');`)).policy,'required_new_uploads');

 const backup=JSON.parse(service(`select public.title_create_audited_backup('${w}','${actor}',1);`));
 assert.equal(sql(`select count(*) from public.title_security_events where event_type='backup.created'`),'1');
 const before=sql(`select count(*) from public.title_backups`),revision=sql(`select revision from public.title_workspaces where id='${w}'`);
 sql(`create function title_private.synthetic_audit_outage() returns trigger language plpgsql as $$begin raise exception 'Fictional audit outage';end$$;create trigger synthetic_audit_outage before insert on public.title_security_events for each row execute function title_private.synthetic_audit_outage();`);
 assert.throws(()=>service(`select public.title_create_audited_backup('${w}','${actor}',1);`),/Fictional audit outage/);
 assert.equal(sql(`select count(*) from public.title_backups`),before);
 assert.throws(()=>service(`select public.title_restore_audited_backup('${w}','${actor}','fixture@example.test',1,${revision},'${backup.id}');`),/Fictional audit outage/);
 assert.equal(sql(`select count(*) from public.title_backups`),before);assert.equal(sql(`select revision from public.title_workspaces where id='${w}'`),revision);
 sql('drop trigger synthetic_audit_outage on public.title_security_events');
 service(`select public.title_restore_audited_backup('${w}','${actor}','fixture@example.test',1,${revision},'${backup.id}');`);
 assert.equal(sql(`select count(*) from public.title_security_events where event_type='backup.restored'`),'1');
 console.log('Document ingestion SQL: legacy labeling, policy privileges, missing scans, tampered/stale receipts, activation interleaving, asset binding and recipient adoption passed.');
} finally { if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(dir,{recursive:true,force:true}); }
