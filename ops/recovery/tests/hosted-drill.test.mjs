import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportBundle, verifyBundle } from '../recovery.mjs';
import { DATABASE_CHECKS, STORAGE_INVENTORY_SQL, validateDrill, compareInventory, verifyHostedDrill } from '../hosted-drill.mjs';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const dirs=[process.env.TITLE_TEST_PG_BIN,...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/opt/postgresql@17/bin','/opt/homebrew/bin','/usr/local/bin'].filter(Boolean);
function binary(name){for(const dir of dirs){const file=path.join(dir,name);try{fs.accessSync(file,fs.constants.X_OK);return file;}catch{}}throw new Error(`Isolated PostgreSQL executable ${name} is required.`);}
const bins=Object.fromEntries(['initdb','pg_ctl','psql','pg_dump','pg_dumpall'].map(name=>[name,binary(name)]));
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceRef='a'.repeat(20),targetRef='b'.repeat(20),privateText='FICTIONAL_PRIVATE_HOSTED_DRILL_PAYLOAD';
const uid='dd100000-0000-4000-8000-000000000001',wid='dd200000-0000-4000-8000-000000000001',invite='dd300000-0000-4000-8000-000000000001';
const migrations=['20260912142734_title_backend_foundation.sql','20260912145118_title_verified_access_gateway.sql','20260912145505_title_explicit_conflicts.sql','20260919215301_title_staff_access_lifecycle.sql'];
const checkById=(result,id)=>result.checks.find(item=>item.id===id);

test('read-only hosted acceptance with real isolated PostgreSQL and explicitly simulated Storage', {timeout:180_000}, async t=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'title-hosted-drill-')),data=path.join(dir,'data'),user='title_hosted_drill_fixture',port=String(57000+process.pid%700);
  const envNames=['TITLE_DRILL_TEST_SOURCE_DB','TITLE_DRILL_TEST_TARGET_DB','TITLE_DRILL_TEST_ARCHIVE','TITLE_DRILL_TEST_VAULT','TITLE_DRILL_TEST_STORAGE'];
  const old=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
  let started=false;
  const command=(name,args,input)=>execFileSync(bins[name],args,{input,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
  const sql=statement=>command('psql',['-X','-q','-h','127.0.0.1','-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-At'],statement).trim();
  const read=statement=>Promise.resolve(JSON.parse(sql(`BEGIN READ ONLY;${statement}ROLLBACK;`)));
  try{
    command('initdb',['-D',data,`--username=${user}`,'--auth-local=trust','--auth-host=trust','--no-locale']);
    command('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h 127.0.0.1 -p ${port} -F`,'-w','start']);started=true;
    sql(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;grant usage on schema auth to service_role;grant execute on function auth.uid() to service_role;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(bucket_id text references storage.buckets(id),name text,metadata jsonb,version text,updated_at timestamptz default now(),primary key(bucket_id,name));`);
    for(const name of migrations)sql(fs.readFileSync(path.join(repo,'supabase/migrations',name),'utf8'));
    const runner=fs.readFileSync(path.join(repo,'web/scripts/backend/test-jv-portal-sql.mjs'),'utf8');
    const fixture=runner.match(/sql\(`(create extension pgcrypto;create schema vault;[\s\S]*?revoke all on all functions in schema vault from public,anon,authenticated,service_role;)`\);/);assert.ok(fixture);
    sql(fixture[1]);
    for(const name of ['20260924150748_title_jv_intake.sql','20260924155947_title_jv_recipient_portal.sql','20260924173821_title_security_center.sql'])sql(fs.readFileSync(path.join(repo,'supabase/migrations',name),'utf8'));
    const objects=new Map([['title-documents/company/original.txt',Buffer.from('Fictional original preserved in full\n')],['title-documents/company/superseded.txt',Buffer.from('Fictional superseded original\n')],['title-documents/company/unfinalized.txt',Buffer.from('Fictional upload without a current document\n')],['title-documents/recipient/unadopted.txt',Buffer.from('Fictional unadopted original\n')],['title-documents/recipient/removed.txt',Buffer.from('Fictional retained removed original\n')],['other-private/uncatalogued.bin',randomBytes(8193)]]);
    sql(`insert into auth.users values('${uid}','fictional-drill@example.test',now(),false);
      insert into public.title_workspaces(id,name,state)values('${wid}','Fictional acceptance','{"companies":[{"id":"C1"}],"documents":[{"id":"D1","companyId":"C1","assetId":"A1"}]}');
      insert into public.title_memberships(workspace_id,user_id,role,all_companies,restricted_access)values('${wid}','${uid}','owner',true,true);
      insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by)values('${wid}','A1','C1','D1','company/original.txt','text/plain','original.txt',${objects.get('title-documents/company/original.txt').length},'${hash(objects.get('title-documents/company/original.txt'))}','${uid}');
      insert into public.title_jv_intakes(workspace_id,company_id,version,status,secret_id,updated_at,updated_by)values('${wid}','C1',1,'Draft',vault.create_secret('{"ssn":"${privateText}"}','fictional-jv'),now(),'${uid}');
      insert into title_private.jv_portal_invites(id,workspace_id,company_id,created_by,access_version,request_id,secret_id,token_hash,baseline_version)values('${invite}','${wid}','C1','${uid}',1,gen_random_uuid(),vault.create_secret('{"payload":{"ssn":"${privateText}"},"email":"fictional-drill@example.test"}','fictional-portal'),repeat('a',64),0);
      insert into storage.buckets(id,name,public)values('other-private','other-private',false);`);
    for(const [name,bytes] of objects){const [bucket,...parts]=name.split('/'),object=parts.join('/');sql(`insert into storage.objects(bucket_id,name,metadata,version)values('${bucket}','${object}','{"size":${bytes.length}}','fixture-v1');`);if(object.startsWith('recipient/'))sql(`insert into title_private.jv_portal_attachments(invitation_id,object_path,filename,mime,byte_size,sha256,state)values('${invite}','${object}','fictional.txt','text/plain',${bytes.length},'${hash(bytes)}','${object.includes('removed')?'removed':'ready'}');`);}
    for(const [id,doc,name] of [['A0','D1','superseded'],['A2','D2','unfinalized']]){const bytes=objects.get(`title-documents/company/${name}.txt`);sql(`insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by)values('${wid}','${id}','C1','${doc}','company/${name}.txt','text/plain','fictional.txt',${bytes.length},'${hash(bytes)}','${uid}');`);}
    sql(fs.readFileSync(path.join(repo,'supabase/migrations/20260924174405_title_document_scan_gate.sql'),'utf8'));
    sql('select title_private.activate_document_scanning();');

    // These wrappers intentionally connect only to the disposable local fixture.
    // Their managed-shaped envelope is transport simulation, never hosted proof.
    const mockBin=path.join(dir,'managed-shaped-bin');await fsp.mkdir(mockBin);
    for(const name of ['psql','pg_dump','pg_dumpall'])await fsp.writeFile(path.join(mockBin,name),`#!${process.execPath}\nimport{spawnSync}from'node:child_process';const r=spawnSync(${JSON.stringify(bins[name])},process.argv.slice(2),{stdio:'inherit',env:{...process.env,PGHOST:'127.0.0.1',PGPORT:${JSON.stringify(port)},PGUSER:${JSON.stringify(user)},PGPASSWORD:'',PGDATABASE:'postgres',PGSSLMODE:'disable'}});process.exit(r.status??1);`,{mode:0o700});
    process.env.TITLE_DRILL_TEST_SOURCE_DB=`postgresql://postgres:fictional-source-password@db.${sourceRef}.supabase.co/postgres`;
    process.env.TITLE_DRILL_TEST_TARGET_DB=`postgresql://postgres:fictional-target-password@db.${targetRef}.supabase.co/postgres`;
    process.env.TITLE_DRILL_TEST_ARCHIVE=randomBytes(32).toString('hex');process.env.TITLE_DRILL_TEST_VAULT=randomBytes(32).toString('hex');process.env.TITLE_DRILL_TEST_STORAGE='fictional-storage-secret';
    const certPath=path.join(dir,'fictional-ca.pem');await fsp.writeFile(certPath,'FICTIONAL CONTROLLED TRANSPORT CA PLACEHOLDER - NO TLS CLAIM');
    const config={archiveKeyEnv:'TITLE_DRILL_TEST_ARCHIVE',maxEntryBytes:8_000_000,maxTotalBytes:64_000_000,sslMode:'verify-full',repository:repo,pgBin:mockBin,
      sourceProjectRef:sourceRef,source:{kind:'managed-supabase',id:sourceRef,databaseUrlEnv:'TITLE_DRILL_TEST_SOURCE_DB',storageUrl:`https://${sourceRef}.supabase.co/`,serviceKeyEnv:'TITLE_DRILL_TEST_STORAGE',vaultRootKeyEnv:'TITLE_DRILL_TEST_VAULT',writeFreezeReference:'EVIDENCE-source-freeze'},
      recovery:{owner:'Fictional operator',retentionReference:'EVIDENCE-fixture-retention',configurationReference:'EVIDENCE-fixture-config',vaultKeyEscrowReference:'EVIDENCE-fixture-key',rpoMinutes:60,rtoMinutes:120},
      target:{kind:'managed-supabase',environment:'isolated-nonproduction',projectRef:targetRef,databaseUrlEnv:'TITLE_DRILL_TEST_TARGET_DB',storageUrl:`https://${targetRef}.supabase.co/`,serviceKeyEnv:'TITLE_DRILL_TEST_STORAGE',sslRootCertPath:certPath,isolationEvidenceReference:'EVIDENCE-isolation',configurationEvidenceReference:'EVIDENCE-config',outboundDisabledEvidenceReference:'EVIDENCE-outbound',targetWriteFreezeEvidenceReference:'EVIDENCE-target-freeze'}};
    const captureStartedAt=new Date(Date.now()-1000).toISOString(),bundle=path.join(dir,'archive');
    const fetchObject=(origin,headers=true)=>async(url,init)=>{assert.equal(url.origin,origin);assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer fictional-storage-secret');const key=url.pathname.slice('/storage/v1/object/authenticated/'.length).split('/').map(decodeURIComponent).join('/');const bytes=objects.get(key);assert.ok(bytes);return new Response(bytes,{headers:headers?{'content-length':String(bytes.length)}:{}});};
    const originalFetch=globalThis.fetch;globalThis.fetch=fetchObject(`https://${sourceRef}.supabase.co`);
    try{await exportBundle(config,bundle);}finally{globalThis.fetch=originalFetch;}
    const manifest=await verifyBundle(config,bundle),captureCompletedAt=new Date().toISOString();
    config.drill={captureStartedAt,sourceRecoveryPointAt:manifest.createdAt,captureCompletedAt,recoveryStartedAt:captureCompletedAt,providerRestoreCompletedAt:captureCompletedAt,sourceWriteFreezeEvidenceReference:'EVIDENCE-source-freeze',providerRestoreEvidenceReference:'EVIDENCE-provider',objectivesEvidenceReference:'EVIDENCE-objectives',keyCustodyEvidenceReference:'EVIDENCE-key',rpoMinutes:60,rtoMinutes:120};
    const transports={query:read,fetch:fetchObject(`https://${targetRef}.supabase.co`)};

    await t.test('real SQL decrypts encrypted private records, checks linkage and denied grants without writes',async()=>{
      const before=sql('select md5(string_agg(secret,\'\' order by id)) from vault.secrets;');
      for(const item of DATABASE_CHECKS){const result=await read(item.sql);assert.equal(result.pass,true,item.id);}
      const result=await verifyHostedDrill(config,bundle,transports);
      assert.equal(result.automatedChecksPassed,true);assert.equal(result.status,'incomplete');assert.equal(result.hostedRecoveryProven,false);assert.equal(result.productionReady,false);assert.equal(result.evidenceMode,'simulated-transport');
      assert.equal(checkById(result,'database_archive_parity').status,'unverified');assert.equal(checkById(result,'private_original_bytes').status,'passed');assert.equal(checkById(result,'private_payload_decryption').status,'passed');
      assert.equal(sql('select md5(string_agg(secret,\'\' order by id)) from vault.secrets;'),before);
      for(const forbidden of [privateText,'fictional-drill@example.test','original.txt',sourceRef,targetRef,'fictional-storage-secret',process.env.TITLE_DRILL_TEST_ARCHIVE])assert.equal(JSON.stringify(result).includes(forbidden),false);
    });
    await t.test('source target, TLS, exact origins and evidence/timing prerequisites fail before transports',async()=>{
      const mutations=[c=>c.target.projectRef=sourceRef,c=>c.sslMode='disable',c=>c.target.storageUrl=`https://${sourceRef}.supabase.co/`,c=>c.target.environment='production',c=>c.target.sslRootCertPath='relative.pem',c=>c.target.isolationEvidenceReference='',c=>c.drill.sourceWriteFreezeEvidenceReference='EVIDENCE-different',c=>c.drill.providerRestoreCompletedAt='2999-01-01T00:00:00.000Z',c=>c.drill.rpoMinutes=999,c=>c.sourceProjectRef=targetRef];
      for(const mutate of mutations){const value=structuredClone(config);mutate(value);let calls=0;await assert.rejects(verifyHostedDrill(value,bundle,{query:async()=>{calls++;},fetch:async()=>{calls++;}}));assert.equal(calls,0);}
      const url=process.env.TITLE_DRILL_TEST_TARGET_DB;
      for(const invalid of [`postgresql://postgres:secret@db.${sourceRef}.supabase.co/postgres`,`postgresql://postgres:secret@db.${targetRef}.supabase.co:6432/postgres`,`postgresql://postgres:secret@db.${targetRef}.supabase.co/postgres?sslmode=disable`,`postgresql://postgres:secret@db.${targetRef}.supabase.co/other`,`postgresql://postgres:secret@evil.example/postgres`]){process.env.TITLE_DRILL_TEST_TARGET_DB=invalid;assert.throws(()=>validateDrill(config,manifest));}process.env.TITLE_DRILL_TEST_TARGET_DB=url;
    });
    await t.test('tampered encrypted archive and wrong key stop before any target query',async()=>{
      const key=process.env.TITLE_DRILL_TEST_ARCHIVE;process.env.TITLE_DRILL_TEST_ARCHIVE=randomBytes(32).toString('hex');let calls=0;
      await assert.rejects(verifyHostedDrill(config,bundle,{query:async()=>{calls++;}}));assert.equal(calls,0);process.env.TITLE_DRILL_TEST_ARCHIVE=key;
      const file=path.join(bundle,manifest.entries.find(entry=>entry.kind==='object').name),bytes=await fsp.readFile(file),changed=Buffer.from(bytes);changed[16]^=1;await fsp.writeFile(file,changed);
      await assert.rejects(verifyHostedDrill(config,bundle,{query:async()=>{calls++;}}));assert.equal(calls,0);await fsp.writeFile(file,bytes);
    });
    await t.test('grant drift, disabled RLS and wrong private decryption cannot pass',async()=>{
      const query=async id=>read(DATABASE_CHECKS.find(item=>item.id===id).sql);
      sql('grant select(id) on public.title_workspaces to authenticated;');assert.equal((await query('browser_table_schema_grants')).pass,false);sql('revoke select(id) on public.title_workspaces from authenticated;');
      sql('grant select(email) on auth.users to anon;');assert.equal((await query('browser_table_schema_grants')).pass,false);sql('revoke select(email) on auth.users from anon;');
      sql('grant execute on function public.title_jv_portal_public(text,text,text,jsonb) to public;');assert.equal((await query('browser_rpc_grants')).pass,false);sql('revoke execute on function public.title_jv_portal_public(text,text,text,jsonb) from public;');
      sql('alter table public.title_security_events disable row level security;');assert.equal((await query('rls_and_evidence_protection')).pass,false);sql('alter table public.title_security_events enable row level security;');
      const encrypted=sql("select secret from vault.secrets where name='fictional-jv';");sql("update vault.secrets set secret='wrong ciphertext' where name='fictional-jv';");
      const result=await verifyHostedDrill(config,bundle,transports);assert.equal(checkById(result,'private_payload_decryption').status,'unverified');assert.equal(result.automatedChecksPassed,false);assert.equal(JSON.stringify(result).includes(privateText),false);
      sql(`update vault.secrets set secret='${encrypted}' where name='fictional-jv';`);
      sql(`select vault.update_secret((select id from vault.secrets where name='fictional-jv'),'not json ${privateText}');`);assert.equal((await query('private_payload_decryption')).pass,false);sql(`update vault.secrets set secret='${encrypted}' where name='fictional-jv';`);
    });
    await t.test('missing representative data is unverified; empty fixtures cannot establish decryption',async()=>{
      const result=await verifyHostedDrill(config,bundle,{...transports,query:async statement=>statement===DATABASE_CHECKS.find(item=>item.id==='private_payload_decryption').sql?{present:false,pass:true}:read(statement)});
      assert.equal(checkById(result,'private_payload_decryption').status,'unverified');assert.equal(result.automatedChecksPassed,false);
    });
    await t.test('retained superseded and unfinalized originals are valid; wrong current bindings fail',async()=>{
      const statement=DATABASE_CHECKS.find(item=>item.id==='asset_company_document_linkage').sql;
      assert.equal((await read(statement)).pass,true);
      sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,assetId}','"A2"') where id='${wid}';`);assert.equal((await read(statement)).pass,false);
      sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,assetId}','"A1"') where id='${wid}';`);
      sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,companyId}','"other-company"') where id='${wid}';`);assert.equal((await read(statement)).pass,false);
      sql(`update public.title_workspaces set state=jsonb_set(state,'{documents,0,companyId}','"C1"') where id='${wid}';`);
    });
    await t.test('complete inventory includes unadopted/removed/uncatalogued originals and rejects omission or extra',async()=>{
      const inventory=await read(STORAGE_INVENTORY_SQL);assert.equal(inventory.length,6);assert.equal(compareInventory(manifest,inventory),true);
      assert.equal(compareInventory(manifest,inventory.slice(1)),false);assert.equal(compareInventory(manifest,[...inventory,inventory[0]]),false);
      const wrong=structuredClone(inventory);wrong[0].size++;assert.equal(compareInventory(manifest,wrong),false);
      wrong[0].name='../escape';assert.throws(()=>compareInventory(manifest,wrong));
      const result=await verifyHostedDrill(config,bundle,{...transports,query:async statement=>statement===STORAGE_INVENTORY_SQL?inventory.slice(1):read(statement)});assert.equal(checkById(result,'private_original_bytes').status,'failed');
    });
    await t.test('original corruption, unauthorized or redirected bodies and changing target inventory fail closed',async()=>{
      for(const fetcher of [async()=>new Response('corrupt'),async()=>new Response(null,{status:403}),async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}}),async()=>new Response('oversized',{headers:{'content-length':'90000000'}})]){
        const result=await verifyHostedDrill(config,bundle,{...transports,fetch:fetcher});assert.equal(checkById(result,'private_original_bytes').status,'failed');assert.equal(result.automatedChecksPassed,false);
      }
      let reads=0;const result=await verifyHostedDrill(config,bundle,{...transports,query:async statement=>{const value=await read(statement);if(statement===STORAGE_INVENTORY_SQL&&++reads===2)value[0].version='changed';return value;}});assert.equal(checkById(result,'target_storage_stability').status,'failed');
      reads=0;const readFailure=await verifyHostedDrill(config,bundle,{...transports,query:async statement=>{if(statement===STORAGE_INVENTORY_SQL&&++reads===2)throw new Error(privateText);return read(statement);}});assert.equal(checkById(readFailure,'target_storage_stability').status,'unverified');assert.equal(readFailure.checks.filter(item=>item.id==='private_original_bytes').length,1);
    });
    await t.test('measured verification end cannot conceal a missed approved recovery objective',async()=>{
      const now=Date.now;const future=now()+3*60*60_000;Date.now=()=>future;
      try{const result=await verifyHostedDrill(config,bundle,transports);assert.equal(checkById(result,'declared_recovery_timing').status,'failed');assert.ok(result.elapsedSinceDeclaredRecoveryStartMinutes>120);assert.equal(result.automatedChecksPassed,false);}finally{Date.now=now;}
    });
    await t.test('CLI suppresses confidential subprocess diagnostics and sets a nonzero incomplete exit',async()=>{
      const failBin=path.join(dir,'fail-bin');await fsp.mkdir(failBin);await fsp.writeFile(path.join(failBin,'psql'),`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{if(process.env.PGSSLMODE!=='verify-full'||process.env.PGSSLROOTCERT!==${JSON.stringify(certPath)}||!process.env.PGOPTIONS.includes('default_transaction_read_only=on'))process.exit(9);process.stderr.write(${JSON.stringify(privateText)});process.exit(1);});`,{mode:0o700});
      const configPath=path.join(dir,'verify.json');await fsp.writeFile(configPath,JSON.stringify({...config,pgBin:failBin}),{mode:0o600});
      const result=spawnSync(process.execPath,[path.join(repo,'ops/recovery/hosted-drill.mjs'),'verify',configPath,bundle],{encoding:'utf8',timeout:20_000});
      assert.equal(result.status,1);assert.equal((result.stdout+result.stderr).includes(privateText),false);assert.equal(JSON.parse(result.stdout).hostedRecoveryProven,false);
    });
  }finally{
    if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);await fsp.rm(dir,{recursive:true,force:true});
    for(const name of envNames)old[name]===undefined?delete process.env[name]:process.env[name]=old[name];
  }
});
