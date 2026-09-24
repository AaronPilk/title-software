/** Isolated, fictional PostgreSQL only. No configured/hosted database is contacted. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
const binary = name => { for (const dir of dirs) { const candidate = path.join(dir, name); try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {} } throw new Error(`Local PostgreSQL ${name} required; no existing database is used.`); };
const bins = Object.fromEntries(['initdb','pg_ctl','psql'].map(name => [name,binary(name)]));
const dir = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'title-security-sql-'));
const data = path.join(dir,'data'), user='title_security_fixture', port='55463';
const args=['-X','-h',dir,'-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-At'];
const command=(name,params,options={})=>execFileSync(bins[name],params,{encoding:'utf8',maxBuffer:8_000_000,...options});
const sql=input=>command('psql',args,{input,stdio:['pipe','pipe','pipe']}).trim();
const service=input=>sql(`set role service_role; ${input}`).split('\n').filter(line=>line!=='SET').join('\n');
const w='20000000-0000-4000-8000-000000000001', w2='20000000-0000-4000-8000-000000000002';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1), admin=id(2), scoped=id(3), staff=id(4);
const center=(actor=owner,version=1,workspace=w)=>JSON.parse(service(`select public.title_security_center('${workspace}','${actor}',${version});`));
const review=(digest,actor=owner,version=1)=>service(`select public.title_record_access_review('${w}','${actor}',${version},'${digest}','Checked roles and company scopes; next review assigned.');`);
const event=(actor=owner,version=1)=>service(`select public.title_record_security_event('${w}','${actor}','file.download','success','A','asset','asset_fixture',1,${version},0);`);
const list=(before='null',beforeId='null',limit=2)=>JSON.parse(service(`select public.title_security_events('${w}','${owner}',1,${before},${beforeId},${limit});`));
let started=false;
try {
  command('initdb',['-D',data,`--username=${user}`,'--auth-local=trust','--auth-host=reject','--no-locale']);
  command('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k '${dir}' -h '' -p ${port} -F`,'-w','start']); started=true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('title_test.uid',true),'')::uuid $$;
    grant usage on schema auth to service_role; grant execute on function auth.uid() to service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  for(const name of ['20260912142734_title_backend_foundation.sql','20260912145118_title_verified_access_gateway.sql','20260912145505_title_explicit_conflicts.sql','20260919215301_title_staff_access_lifecycle.sql','20260924173821_title_security_center.sql']) sql(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  sql(`insert into auth.users(id,email,email_confirmed_at) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'account'||n||'@example.test',now() from generate_series(1,8) n;
    insert into public.title_workspaces(id,name,state) values('${w}','Fictional security fixture','{"companies":[{"id":"A"},{"id":"B"}],"documents":[{"id":"doc_fixture","assetId":"asset_fixture","companyId":"A"}]}'),('${w2}','Other fixture','{}');
    insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access)
      values('${w}','${owner}','owner','{}',true,true),('${w}','${admin}','admin','{}',true,false),('${w}','${scoped}','admin','{A}',false,false),('${w}','${staff}','operations','{A}',false,false),
      ('${w}','${id(5)}','onboarding','{A}',false,false),('${w}','${id(6)}','finance','{A}',false,false),('${w}','${id(7)}','viewer','{A}',false,false),('${w}','${id(8)}','partner','{A}',false,false);`);
  sql(`insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by) values('${w}','asset_fixture','A','doc_fixture','fixture/path','application/pdf','fixture.pdf',10,'fictional-hash','${owner}');`);
  const summary=center(); assert.equal(summary.snapshot.members.length,8); assert.equal(summary.latestReview,null);
  assert.deepEqual(summary.snapshot.companyIds,['A','B']); assert.equal(center(admin).snapshotDigest,summary.snapshotDigest);
  for(const actor of [scoped,staff,id(5),id(6),id(7),id(8)]) {
    assert.throws(()=>center(actor),/Workspace-wide administrator access changed/);
    assert.throws(()=>review(summary.snapshotDigest,actor),/Workspace-wide administrator access changed/);
    assert.throws(()=>service(`select public.title_security_events('${w}','${actor}',1);`),/Workspace-wide administrator access changed/);
  }
  assert.throws(()=>center(owner,2),/access changed/); assert.throws(()=>center(owner,1,w2),/access changed/);
  assert.throws(()=>service(`set title_test.uid='${staff}'; select public.title_security_center('${w}','${owner}',1);`),/Verified account required/);
  const saved=JSON.parse(review(summary.snapshotDigest)); assert.equal(saved.memberCount,8); assert.equal(center().latestReview.current,true);
  const stored=JSON.parse(sql(`select snapshot from public.title_access_reviews where id='${saved.id}';`));
  assert.equal(stored.members.find(m=>m.userId===owner).restricted,true); assert.equal(stored.members.find(m=>m.userId===staff).version,1);
  assert.ok(!JSON.stringify(stored).includes('@example.test'),'snapshots never include account emails');
  assert.ok(!service(`select public.title_security_events('${w}','${owner}',1);`).includes('Checked roles'),'review notes never enter event metadata');
  sql(`update public.title_memberships set company_ids='{B}',version=version+1 where workspace_id='${w}' and user_id='${staff}';`);
  assert.equal(center().latestReview.current,false); assert.throws(()=>review(summary.snapshotDigest),/Memberships or company scope changed/);
  assert.throws(()=>event(staff,1),/Member access changed/); assert.throws(()=>event(staff,2),/Company access denied/);
  sql(`update public.title_memberships set company_ids='{A}',version=version+1 where workspace_id='${w}' and user_id='${staff}';`);
  assert.equal(center().latestReview.current,false,'changing then restoring the grant still changes membership version');
  const newSummary=center(); review(newSummary.snapshotDigest);
  sql(`update public.title_workspaces set state=jsonb_set(state,'{companies}','[{"id":"A"},{"id":"B"},{"id":"C"}]') where id='${w}';`);
  assert.equal(center().latestReview.current,false,'all-company scope expansion invalidates review');
  for(const role of ['anon','authenticated','service_role']) {
    for(const table of ['title_security_events','title_access_reviews']) {
      for(const operation of [`select * from public.${table}`,`delete from public.${table}`,`truncate public.${table}`]) assert.throws(()=>sql(`set role ${role}; ${operation};`),/permission denied/);
    }
    assert.throws(()=>sql(`set role ${role}; insert into public.title_security_events(workspace_id,event_type,outcome) values('${w}','authorization.denied','denied');`),/permission denied/);
  }
  for(const role of ['anon','authenticated']) for(const call of [
    `public.title_security_center('${w}','${owner}',1)`, `public.title_security_events('${w}','${owner}',1)`,
    `public.title_record_access_review('${w}','${owner}',1,'${summary.snapshotDigest}','note')`,
    `public.title_record_security_event('${w}','${owner}','authorization.denied','denied')`,
    `title_private.security_center('${w}','${owner}',1)`]) assert.throws(()=>sql(`set role ${role}; select ${call};`),/permission denied/);
  for(const table of ['title_security_events','title_access_reviews']) assert.throws(()=>sql(`delete from public.${table};`),/append-only/);
  event();
  sql(`update public.title_workspaces set revision=1 where id='${w}';`);
  assert.throws(()=>event(),/Workspace changed during document download/);
  sql(`update public.title_workspaces set revision=0 where id='${w}';`);
  assert.throws(()=>service(`select public.title_record_security_event('${w}','${owner}','file.download','success','B','asset','asset_fixture',1,1,0);`),/Document binding changed/);
  assert.throws(()=>event(owner,2),/Member access changed/);
  assert.throws(()=>service(`select public.title_record_security_event('${w}','${owner}','file.download','success','A','asset','private filename.pdf',1,1);`),/Invalid security event metadata/);
  assert.throws(()=>service(`select public.title_record_security_event('${w}','${owner}','arbitrary','success',null,null,null,null,1);`),/Invalid security event type/);
  assert.throws(()=>service(`select public.title_record_security_event('${w}','${owner}','file.download','denied',null,null,null,null,1);`),/Invalid security event type/);
  assert.throws(()=>service(`select public.title_record_security_event('${w}',null,'workspace.export','success',null,'workspace','${w}',null,null);`),/Verified actor required/);
  assert.throws(()=>service(`select public.title_record_security_event('${w}',null,'document.scan_clean','success','missing');`),/Company unavailable/);
  service(`select public.title_record_security_event('${w}',null,'document.scan_clean','success','A');`);
  service(`select public.title_record_security_event('${w}','${staff}','authorization.denied','denied');`);
  // An audit-write failure rolls back the review in the same database transaction.
  const count=sql('select count(*) from public.title_access_reviews;');
  sql(`create function public.title_fixture_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit unavailable'; end $$;
    create trigger fixture_audit_failure before insert on public.title_security_events for each row execute function public.title_fixture_fail_audit();`);
  assert.throws(()=>review(center().snapshotDigest),/synthetic audit unavailable/); assert.equal(sql('select count(*) from public.title_access_reviews;'),count);
  sql('drop trigger fixture_audit_failure on public.title_security_events;');
  // Equal timestamp boundaries require the UUID tie breaker, with no skipped rows.
  sql(`insert into public.title_security_events(id,workspace_id,event_type,outcome,created_at) select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${w}','authorization.denied','denied','2026-09-24T00:00:00.123456Z' from generate_series(1,5) n;
    insert into public.title_security_events(workspace_id,event_type,outcome) values('${w2}','authorization.denied','denied');`);
  const all=[]; let page=list(); let pages=0;
  do { all.push(...page.items); assert.ok(page.items.length<=2); if(!page.nextCursor) break; page=list(`'${page.nextCursor.createdAt}'`,`'${page.nextCursor.id}'`); assert.ok(++pages<30); } while(true);
  assert.equal(new Set(all.map(e=>e.id)).size,all.length); assert.equal(all.length,Number(sql(`select count(*) from public.title_security_events where workspace_id='${w}';`)));
  assert.equal(all.filter(e=>e.createdAt.includes('.123456')).length,5);
  for(const limit of [0,101,-1]) assert.throws(()=>list('null','null',limit),/Invalid event pagination/);
  assert.throws(()=>list(`'2026-01-01'`,'null'),/Invalid event pagination/);
  assert.throws(()=>list(`'infinity'`,`'${owner}'`),/Invalid event pagination/);
  // The established staff lifecycle lock serializes a concurrent permission change before review.
  const digest=center().snapshotDigest;
  const first=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']}); let output='',errors='';
  first.stdout.on('data',c=>{output+=c;}); first.stderr.on('data',c=>{errors+=c;});
  const done=new Promise((resolve,reject)=>first.on('close',code=>code===0?resolve():reject(new Error(errors))));
  first.stdin.write(`begin; select pg_advisory_xact_lock(19492271,hashtext('${w}')); update public.title_memberships set restricted_access=true,version=version+1 where workspace_id='${w}' and user_id='${staff}'; select 'READY';\n`);
  const until=async predicate=>{const deadline=Date.now()+10000; while(!predicate()){if(Date.now()>deadline)throw new Error('fixture lock wait timed out'); await new Promise(r=>setTimeout(r,15));}};
  await until(()=>output.includes('READY'));
  const second=spawn(bins.psql,args,{stdio:['pipe','pipe','pipe']}); let secondErrors=''; second.stderr.on('data',c=>{secondErrors+=c;});
  const rejected=new Promise(resolve=>second.on('close',code=>resolve({code,error:secondErrors})));
  second.stdin.end(`set application_name='security_review_race'; set role service_role; select public.title_record_access_review('${w}','${owner}',1,'${digest}','Reviewed old snapshot');`);
  await until(()=>sql(`select exists(select 1 from pg_stat_activity where application_name='security_review_race' and wait_event_type='Lock');`)==='t');
  first.stdin.end('commit;\n'); await done; const result=await rejected;
  assert.notEqual(result.code,0); assert.match(result.error,/Memberships or company scope changed/);
  console.log('Security SQL checks passed: role/scope gates, snapshots, stale and concurrent reviews, append-only privileges, metadata validation, scanner actors, rollback and cursor pagination.');
} finally { if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']); fs.rmSync(dir,{recursive:true,force:true}); }
