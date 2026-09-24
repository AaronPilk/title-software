#!/usr/bin/env node
/** Read-only acceptance checks. Never creates/restores a project, installs keys, or sends mail. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dbConnection, verifyBundle } from './recovery.mjs';

const REF = /^[a-z0-9]{20}$/;
const ENV = /^[A-Z][A-Z0-9_]{2,100}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_OUTPUT = 16 * 1024 * 1024;
const evidence = value => typeof value === 'string' && /^EVIDENCE-[A-Za-z0-9_-]{3,120}$/.test(value);
const fail = () => { throw new Error('Hosted recovery verification stopped; configuration, archive or target evidence is invalid. Private details were suppressed.'); };
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value ? Date.parse(value) : NaN;
const check = (id, status, reason) => ({ id, status, reason });

const TABLES = ['public.title_workspaces','public.title_memberships','public.title_assets','public.title_jv_intakes','public.title_audit','public.title_security_events','public.title_access_reviews','title_private.jv_portal_invites','title_private.jv_portal_attachments','title_private.document_scan_policy','title_private.document_scan_receipts'];
const SERVICE_PRIVATE = ['public.title_jv_intakes','public.title_security_events','public.title_access_reviews','title_private.jv_portal_invites','title_private.jv_portal_attachments','title_private.document_scan_policy','title_private.document_scan_receipts'];
const tableArray = values => `array[${values.map(value => `'${value}'`).join(',')}]`;
const PUBLIC_RPCS = ['title_security_center','title_security_events','title_record_security_event','title_record_access_review','title_jv_intake','title_jv_portal_staff','title_jv_portal_public','title_prepare_document_ingestion','title_record_document_scan'];
const PRIVATE_JSON = "case when pg_input_is_valid(d.decrypted_secret,'jsonb') then d.decrypted_secret::jsonb else null end";

/** Fixed SQL only. Exposed for actual isolated PostgreSQL tests, never caller-supplied SQL. */
export const DATABASE_CHECKS = Object.freeze([
  { id: 'database_structure', sql: `select jsonb_build_object('pass',
    (select bool_and(to_regclass(name) is not null) from unnest(${tableArray([...TABLES,'auth.users','storage.buckets','storage.objects','vault.secrets','vault.decrypted_secrets'])}) name)
    and exists(select 1 from pg_roles where rolname='anon') and exists(select 1 from pg_roles where rolname='authenticated') and exists(select 1 from pg_roles where rolname='service_role'));` },
  { id: 'auth_workspace_membership_linkage', sql: `select jsonb_build_object('present',exists(select 1 from auth.users) and exists(select 1 from public.title_workspaces) and exists(select 1 from public.title_memberships),
    'pass',not exists(select 1 from public.title_memberships m left join auth.users u on u.id=m.user_id left join public.title_workspaces w on w.id=m.workspace_id where u.id is null or w.id is null or exists(select 1 from unnest(m.company_ids) c where not exists(select 1 from jsonb_array_elements(w.state->'companies') x where x->>'id'=c)))
      and not exists(select 1 from public.title_workspaces w where jsonb_typeof(w.state->'companies') is distinct from 'array'));` },
  { id: 'asset_company_document_linkage', sql: `select jsonb_build_object('present',exists(select 1 from public.title_workspaces w,jsonb_array_elements(w.state->'documents') d where d->>'assetId' is not null),
    'pass',not exists(select 1 from public.title_assets a left join public.title_workspaces w on w.id=a.workspace_id where w.id is null)
      and not exists(select 1 from public.title_workspaces w,jsonb_array_elements(w.state->'documents') d where d->>'assetId' is not null and
        (not exists(select 1 from public.title_assets a where a.workspace_id=w.id and a.id=d->>'assetId' and a.document_id=d->>'id' and a.company_id=d->>'companyId')
        or not exists(select 1 from jsonb_array_elements(w.state->'companies') c where c->>'id'=d->>'companyId'))));` },
  { id: 'private_payload_decryption', sql: `select jsonb_build_object('present',exists(select 1 from public.title_jv_intakes) and exists(select 1 from title_private.jv_portal_invites),
    'pass',not exists(select 1 from public.title_jv_intakes i left join public.title_workspaces w on w.id=i.workspace_id left join vault.secrets s on s.id=i.secret_id left join vault.decrypted_secrets d on d.id=i.secret_id where w.id is null or s.id is null or jsonb_typeof(${PRIVATE_JSON}) is distinct from 'object' or not exists(select 1 from jsonb_array_elements(w.state->'companies') c where c->>'id'=i.company_id))
      and not exists(select 1 from title_private.jv_portal_invites i left join public.title_workspaces w on w.id=i.workspace_id left join auth.users u on u.id=i.created_by left join vault.secrets s on s.id=i.secret_id left join vault.decrypted_secrets d on d.id=i.secret_id where w.id is null or u.id is null or s.id is null or jsonb_typeof(${PRIVATE_JSON}) is distinct from 'object' or jsonb_typeof((${PRIVATE_JSON})->'payload') is distinct from 'object' or not exists(select 1 from jsonb_array_elements(w.state->'companies') c where c->>'id'=i.company_id))
      and not exists(select 1 from title_private.jv_portal_attachments a left join title_private.jv_portal_invites i on i.id=a.invitation_id where i.id is null));` },
  { id: 'browser_table_schema_grants', sql: `select jsonb_build_object('pass',
    not exists(select 1 from unnest(array['anon','authenticated']) r cross join unnest(${tableArray([...TABLES,'auth.users','vault.secrets','vault.decrypted_secrets'])}) n where has_table_privilege(r,n,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,n,'SELECT,INSERT,UPDATE,REFERENCES'))
    and not exists(select 1 from unnest(array['anon','authenticated']) r where has_schema_privilege(r,'title_private','USAGE,CREATE') or has_schema_privilege(r,'vault','USAGE,CREATE'))
    and not exists(select 1 from pg_roles elevated cross join unnest(array['anon','authenticated']) r where (elevated.rolsuper or elevated.rolbypassrls) and pg_has_role(r,elevated.oid,'MEMBER')));` },
  { id: 'browser_rpc_grants', sql: `select jsonb_build_object('pass',
    (select count(distinct p.proname)=${PUBLIC_RPCS.length} from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${tableArray(PUBLIC_RPCS)}))
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated']) r where (n.nspname='title_private' or (n.nspname='public' and p.proname like 'title\\_%' escape '\\')) and has_function_privilege(r,p.oid,'EXECUTE')));` },
  { id: 'rls_and_evidence_protection', sql: `select jsonb_build_object('pass',
    (select bool_and(c.relrowsecurity) from unnest(${tableArray(TABLES)}) n join pg_class c on c.oid=to_regclass(n))
    and not exists(select 1 from unnest(${tableArray(SERVICE_PRIVATE)}) n where has_table_privilege('service_role',n,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_any_column_privilege('service_role',n,'SELECT,INSERT,UPDATE'))
    and (select count(*)=2 from pg_trigger t where t.tgrelid in ('public.title_security_events'::regclass,'public.title_access_reviews'::regclass) and not t.tgisinternal and t.tgenabled in ('O','A') and t.tgfoid='title_private.reject_security_evidence_mutation()'::regprocedure));` },
  { id: 'scanner_policy_enforced', sql: `select jsonb_build_object('pass',(select count(*)=1 and bool_and(mode='required' and activated_at is not null) from title_private.document_scan_policy));` },
]);

export const STORAGE_INVENTORY_SQL = `select coalesce(jsonb_agg(jsonb_build_object('bucket',b.id,'name',o.name,'size',(o.metadata->>'size')::bigint,'version',o.version,'updatedAt',o.updated_at,'referenceSha256',r.sha256,'referencesMatch',coalesce(r.hashes<=1 and r.sizes<=1 and r.bytes=(o.metadata->>'size')::bigint,true)) order by b.id,o.name),'[]'::jsonb)
 from storage.buckets b join storage.objects o on o.bucket_id=b.id
 left join lateral (select min(x.sha256) sha256,count(distinct x.sha256) hashes,min(x.byte_size) bytes,count(distinct x.byte_size) sizes from (
   select sha256,byte_size from public.title_assets where b.id='title-documents' and object_path=o.name
   union all select sha256,byte_size from title_private.jv_portal_attachments where b.id='title-documents' and object_path=o.name) x) r on true where b.public is not true;`;

export function validateDrill(config, manifest, now = Date.now()) {
  const target = config.target, timing = config.drill;
  if (config.sslMode !== 'verify-full' || manifest.source?.kind !== 'managed-supabase' || !REF.test(config.sourceProjectRef ?? '') || manifest.source.id !== config.sourceProjectRef || manifest.source.host !== `db.${config.sourceProjectRef}.supabase.co` || manifest.source.database !== 'postgres') fail();
  if (target?.kind !== 'managed-supabase' || target.environment !== 'isolated-nonproduction' || !REF.test(target.projectRef ?? '') || target.projectRef === config.sourceProjectRef || target.storageUrl !== `https://${target.projectRef}.supabase.co/` || !ENV.test(target.serviceKeyEnv ?? '')) fail();
  if(typeof target.sslRootCertPath!=='string'||!path.isAbsolute(target.sslRootCertPath)||/[\x00-\x1f]/.test(target.sslRootCertPath))fail();
  const db = dbConnection(target.databaseUrlEnv);
  if (db.host !== `db.${target.projectRef}.supabase.co` || db.database !== 'postgres' || db.port !== '5432' || !db.user || !db.password) fail();
  for (const key of ['isolationEvidenceReference','configurationEvidenceReference','outboundDisabledEvidenceReference','targetWriteFreezeEvidenceReference']) if (!evidence(target[key])) fail();
  for (const key of ['sourceWriteFreezeEvidenceReference','providerRestoreEvidenceReference','objectivesEvidenceReference','keyCustodyEvidenceReference']) if (!evidence(timing?.[key])) fail();
  if (timing.sourceWriteFreezeEvidenceReference !== manifest.writeFreezeReference) fail();
  const names = ['captureStartedAt','sourceRecoveryPointAt','captureCompletedAt','recoveryStartedAt','providerRestoreCompletedAt'];
  const times = Object.fromEntries(names.map(name => [name,timestamp(timing[name])]));
  const archiveTime = timestamp(manifest.createdAt);
  if (Object.values(times).some(value => !Number.isFinite(value)) || !Number.isFinite(archiveTime) || times.captureStartedAt > archiveTime || archiveTime > times.captureCompletedAt || times.sourceRecoveryPointAt < times.captureStartedAt || times.sourceRecoveryPointAt > times.captureCompletedAt || times.captureCompletedAt > times.recoveryStartedAt || times.recoveryStartedAt > times.providerRestoreCompletedAt || times.providerRestoreCompletedAt > now) fail();
  if (!Number.isSafeInteger(timing.rpoMinutes) || !Number.isSafeInteger(timing.rtoMinutes) || timing.rpoMinutes < 1 || timing.rtoMinutes < 1 || timing.rpoMinutes !== manifest.recovery.rpoMinutes || timing.rtoMinutes !== manifest.recovery.rtoMinutes) fail();
  return { db, times };
}

async function query(config, db, statement) {
  const executable = config.pgBin ? path.join(config.pgBin,'psql') : 'psql';
  const child = spawn(executable,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'], { shell:false, stdio:['pipe','pipe','pipe'], env:{PATH:process.env.PATH,LANG:'C',PGHOST:db.host,PGPORT:db.port,PGDATABASE:db.database,PGUSER:db.user,PGPASSWORD:db.password,PGSSLMODE:'verify-full',PGSSLROOTCERT:config.target.sslRootCertPath,PGGSSENCMODE:'disable',PGCONNECT_TIMEOUT:'15',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000'} });
  child.stderr.resume(); child.stdin.on('error',()=>{});
  const timer = setTimeout(()=>child.kill('SIGKILL'),135_000); timer.unref();
  const done = new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Read-only database check failed.')));}); done.catch(()=>{});
  child.stdin.end(`BEGIN TRANSACTION READ ONLY;\n${statement}\nROLLBACK;\n`);
  try {
    const chunks=[];let size=0;
    for await (const chunk of child.stdout) {size+=chunk.length;if(size>MAX_OUTPUT)throw new Error('Output bound.');chunks.push(chunk);}
    await done; return JSON.parse(Buffer.concat(chunks).toString('utf8').trim());
  } catch { child.kill('SIGKILL'); await done.catch(()=>{}); throw new Error('Read-only database check failed; private details suppressed.'); }
  finally { clearTimeout(timer); }
}

function objectKey(item) {
  if (!/^[A-Za-z0-9_-]{1,500}$/.test(item?.bucket ?? '') || typeof item.name!=='string' || item.name.length>2048 || /[\\\x00-\x1f\x7f]/.test(item.name) || item.name.split('/').some(value=>!value || value==='.' || value==='..')) fail();
  return `${item.bucket}/${item.name}`;
}
export function compareInventory(manifest, inventory) {
  if (!Array.isArray(inventory) || inventory.length>100_000 || inventory.length!==manifest.objects.length) return false;
  const expected=new Map(manifest.objects.map(item=>[objectKey(item),item]));const seen=new Set();
  for(const item of inventory) {
    const key=objectKey(item),saved=expected.get(key);
    if(seen.has(key)||!saved||item.size!==saved.size||item.referencesMatch!==true||item.referenceSha256!==saved.referenceSha256) return false;
    seen.add(key);
  }
  return true;
}
async function verifyObject(config, item, entry, fetcher) {
  const secret=process.env[config.target.serviceKeyEnv];if(!secret||/[\r\n]/.test(secret))fail();
  const url=new URL(`storage/v1/object/authenticated/${objectKey(item).split('/').map(encodeURIComponent).join('/')}`,config.target.storageUrl);
  const controller=new AbortController();let response,reader;
  let expired;const timeout=new Promise((_,reject)=>{expired=setTimeout(()=>{controller.abort();reject(new Error('Storage timeout.'));},120_000);expired.unref();});
  try {
    response=await Promise.race([fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${secret}`,apikey:secret},redirect:'error',signal:controller.signal}),timeout]);
    if(response.status!==200||!response.body||(response.url&&response.url!==url.href))throw new Error('Storage unavailable.');
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==item.size))throw new Error('Storage size mismatch.');
    const digest=createHash('sha256');let count=0;reader=response.body.getReader();
    while(true){const part=await Promise.race([reader.read(),timeout]);if(part.done)break;count+=part.value.length;if(count>item.size||count>config.maxEntryBytes)throw new Error('Storage bounds.');digest.update(part.value);}
    return count===entry.bytes&&digest.digest('hex')===entry.sha256;
  } finally {clearTimeout(expired);controller.abort();reader?.cancel().catch(()=>{});if(!reader)response?.body?.cancel().catch(()=>{});}
}

/** Injected query/fetch are visibly synthetic; CLI never accepts those transports. */
export async function verifyHostedDrill(config, directory, transports = {}) {
  const startedAt=new Date().toISOString(),started=Date.now();
  const manifest=await verifyBundle(config,directory);
  const {db,times}=validateDrill(config,manifest);
  const cert=await fs.lstat(config.target.sslRootCertPath);if(!cert.isFile()||cert.isSymbolicLink()||cert.size<1||cert.size>1024*1024)fail();
  const simulated=Object.keys(transports).length>0;
  const read=transports.query??((statement)=>query(config,db,statement));
  const fetcher=transports.fetch??globalThis.fetch;
  const checks=[check('encrypted_archive','passed','Every encrypted entry authenticated and matched its manifest digest.'),check('target_boundary','passed','Target references and direct TLS database origin are distinct from the archive source.'),check('operational_evidence','unverified','Evidence references were supplied; an operator or assessor must validate their contents and actual isolation.')];
  for(const item of DATABASE_CHECKS){
    try {const result=await read(item.sql);checks.push(check(item.id,result?.pass===true?(result.present===false?'unverified':'passed'):'failed',result?.pass===true?(result.present===false?'No representative restored records were present.':'Read-only aggregate database check matched its expected condition.'):'The expected database condition did not hold.'));}
    catch{checks.push(check(item.id,'unverified','The database check could not complete; confidential errors were suppressed.'));}
  }
  let before;
  try {
    before=await read(STORAGE_INVENTORY_SQL);
    if(!compareInventory(manifest,before))throw new Error('Inventory mismatch.');
    const entries=new Map(manifest.entries.filter(value=>value.kind==='object').map(value=>[value.name,value]));
    let good=true;
    for(const item of manifest.objects){const entry=entries.get(item.entry);if(!entry||!HASH.test(entry.sha256)||!await verifyObject(config,item,entry,fetcher)){good=false;break;}}
    if(!good)throw new Error('Object mismatch.');
    checks.push(check('private_original_bytes',manifest.objects.length?'passed':'unverified',manifest.objects.length?'The complete private inventory and every target object matched archive names, sizes and hashes.':'The archive contained no private objects to exercise recovery.'));
    try {const after=await read(STORAGE_INVENTORY_SQL);
      checks.push(check('target_storage_stability',JSON.stringify(before)===JSON.stringify(after)?'passed':'failed','Compared target Storage inventory and metadata before and after byte verification; this is not a distributed write lock.'));
    }catch{checks.push(check('target_storage_stability','unverified','The final target inventory could not be read; stability was not established.'));}
  }catch{checks.push(check('private_original_bytes','failed','Complete private inventory or byte verification did not pass; no object values were retained.'));checks.push(check('target_storage_stability','unverified','Storage verification was incomplete.'));}
  const completed=Date.now(),rpoMinutes=(times.recoveryStartedAt-times.sourceRecoveryPointAt)/60_000,rtoMinutes=(completed-times.recoveryStartedAt)/60_000;
  checks.push(check('declared_recovery_timing',rpoMinutes<=config.drill.rpoMinutes&&rtoMinutes<=config.drill.rtoMinutes?'passed':'failed','Calculated against supplied recovery-point/start evidence and the actual end of this verifier; evidence authenticity and complete functional recovery remain unverified.'));
  for(const [id,reason] of Object.entries({database_archive_parity:'Archive contains no independently comparable logical database baseline; structural/decryption checks do not prove every restored row equals the source.',application_acceptance:'Hosted sign-in, MFA, revoked/company/restricted-access behavior, private payload values and end-to-end workflows need separate acceptance tests.',platform_and_key_recovery:'Provider settings, secret custody, alert delivery, jobs, restored sessions/capabilities and Durable Object recovery require separate evidence.'}))checks.push(check(id,'unverified',reason));
  return {format:'title-hosted-recovery-check-v1',status:'incomplete',productionReady:false,hostedRecoveryProven:false,evidenceMode:simulated?'simulated-transport':'managed-target-read-only',startedAt,completedAt:new Date(completed).toISOString(),elapsedVerificationSeconds:Math.round((completed-started)/1000),declaredRpoMinutes:Math.round(rpoMinutes*100)/100,elapsedSinceDeclaredRecoveryStartMinutes:Math.round(rtoMinutes*100)/100,automatedChecksPassed:checks.filter(value=>!['operational_evidence','database_archive_parity','application_acceptance','platform_and_key_recovery'].includes(value.id)).every(value=>value.status==='passed'),checks};
}

async function main(){
  const [command,configPath,bundle,...rest]=process.argv.slice(2);if(command!=='verify'||!configPath||!bundle||rest.length)fail();
  const stat=await fs.lstat(configPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32_768)fail();
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const result=await verifyHostedDrill(config,bundle);process.stdout.write(JSON.stringify(result,null,2)+'\n');
  // Incomplete is intentionally nonzero: this command cannot certify a full hosted recovery.
  process.exitCode=result.checks.some(value=>value.status==='failed')?1:2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('Hosted recovery verification stopped; private configuration, database, object and provider details were suppressed.\n');process.exitCode=1;});
