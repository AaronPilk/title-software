// Actual HTTP handler, parsers and projections; synthetic Auth/database/storage only.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const w='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001', eventId='30000000-0000-4000-8000-000000000001';
const ok=data=>({data,error:null}), fail=(code,message)=>({data:null,error:{code,message}});
let fixture,handler;
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://fictional.example.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'})[name]},serve:fn=>{handler=fn;}};
globalThis.__securityHttpClient={auth:{getUser:async()=>fixture.auth?ok({user:{id:actor,email:'staff@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'}}):{data:{user:null},error:{}},getClaims:async()=>ok({claims:{sub:actor,session_id:w,aal:'aal2'}})},
  from(table){const filters=[];const matches=row=>filters.every(([key,value])=>row[key]===value);const rows=()=>{
    if(table==='title_memberships')return[{workspace_id:w,user_id:actor,active:true,...fixture.member}].filter(matches);
    if(table==='title_workspaces')return[{id:w,revision:fixture.revision,state:fixture.state}].filter(matches);
    if(table==='title_assets')return[fixture.asset].filter(matches);
    if(table==='title_backups')return[fixture.backup].filter(matches);
    if(table==='title_audit')return[];
    throw Error('Unexpected table '+table);
  };return{select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},limit(){return this;},async maybeSingle(){const result=rows();assert.ok(result.length<=1);return ok(result[0]??null);},async single(){const result=rows();assert.equal(result.length,1);return ok(result[0]);},then(resolve,reject){return Promise.resolve(ok(rows())).then(resolve,reject);}};},
  async rpc(name,args){fixture.calls.push({name,args});
    if(name==='title_security_state')return ok({session_valid:true,password_change_required:false,has_totp:true,session_totp:true});
    if(name==='title_document_scan_status')return ok({policy:'pending_setup',legacyUnscannedCount:4});
    if(name==='title_record_security_event'){
      if(fixture.auditWait)await new Promise(resolve=>{fixture.releaseAudit=resolve;});
      if(fixture.auditFailure)return fail('P0001','PRIVATE_DATABASE_CONNECTION_STRING');
      if(args.p_event_type!=='authorization.denied'&&args.p_actor!==null&&args.p_access_version!==fixture.member.version)return fail('42501','Member access changed');
      if(args.p_event_type==='file.download'&&args.p_workspace_revision!==fixture.revision)return fail('42501','Workspace changed during download');
      fixture.events.push(args);return ok(eventId);
    }
    if(name==='title_security_center')return fixture.rpcDenied?fail('42501','Administrator access changed'):ok(fixture.summary);
    if(name==='title_security_events')return fixture.rpcDenied?fail('42501','Administrator access changed'):ok(fixture.page);
    if(name==='title_record_access_review'){
      if(fixture.reviewStale)return fail('40001','Memberships or company scope changed. Refresh and review again.');
      if(fixture.auditFailure)return fail('PT503','Security evidence unavailable.');
      fixture.reviews.push(args);return ok({id:eventId,createdAt:'2026-09-24T00:00:00Z',actorId:actor,snapshotDigest:args.p_snapshot_digest,memberCount:1,note:args.p_note,current:true});
    }
    if(name==='title_create_audited_backup'||name==='title_restore_audited_backup'){
      if(fixture.auditFailure)return fail('PT503','Security evidence unavailable.');
      fixture.mutations.push(name);return ok(name==='title_create_audited_backup'?fixture.backup:2);
    }
    throw Error('Unexpected RPC '+name);
  },storage:{from(){return{async download(){fixture.downloads++;if(fixture.duringDownload)fixture.duringDownload();return ok(new Blob(['PRIVATE_DOCUMENT_BYTES'],{type:'application/pdf'}));},async info(){return ok({});}};}}};
const bundled=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:'import "../supabase/functions/title-api/index.ts"; export {emptyWorkspace} from "./lib/backend/workspace";'},write:false,bundle:true,format:'esm',platform:'node',target:'es2022',logLevel:'silent',plugins:[{name:'synthetic-security-transport',setup(b){b.onResolve({filter:/^npm:@supabase\/supabase-js@/},()=>({path:'client',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__securityHttpClient;'}));}}]});
const {emptyWorkspace}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
beforeEach(()=>{
  const state=emptyWorkspace('staff@example.test');state.companies=[{id:'A',name:'Fixture',initials:'A',color:'blue',contact:'',email:'',location:'Charlotte',jurisdiction:'NC',stage:'Onboarding',steps:[],members:[]}];
  state.documents=[{id:'doc_fixture',assetId:'asset_fixture',companyId:'A',name:'PRIVATE_DOCUMENT_NAME.pdf',category:'Other',date:'2026-09-24',version:1,visibility:'Internal',mime:'application/pdf',size:'10 bytes'}];
  fixture={auth:true,member:{role:'owner',all_companies:true,company_ids:[],restricted_access:true,partner_members:[],version:1},revision:1,state,calls:[],events:[],reviews:[],mutations:[],downloads:0,auditFailure:false,auditWait:false,
    asset:{workspace_id:w,id:'asset_fixture',company_id:'A',document_id:'doc_fixture',object_path:'PRIVATE_STORAGE_PATH',mime:'application/pdf',filename:'PRIVATE_DOCUMENT_NAME.pdf'},
    backup:{id:eventId,workspace_id:w,revision:1,created_at:'2026-09-24T00:00:00Z',state,asset_manifest:[]},
    page:{items:[{id:eventId,createdAt:'2026-09-24T00:00:00.123456+00:00',actorId:actor,eventType:'file.download',outcome:'success',companyId:'A',recordType:'asset',recordId:'asset_fixture',count:null}],nextCursor:null},
    summary:{checkedAt:'2026-09-24T00:00:00Z',snapshot:{companyIds:['A'],members:[]},snapshotDigest:'a'.repeat(32),latestReview:null,evidence:{eventCount:1,lastEventAt:null,lastBackupAt:null,backupCount:0}},env:{}
  };globalThis.Deno={env:{get:name=>fixture.env[name]}};
});
async function request(path,body){return handler(new Request('https://fictional.example.test/functions/v1/title-api'+path+(body?'':(path.includes('?')?'&':'?')+'workspaceId='+w),{method:body?'POST':'GET',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(body?{body:JSON.stringify({workspaceId:w,...body})}:{})}));}
const calls=name=>fixture.calls.filter(call=>call.name===name);
const review=()=>request('/security/access-review',{snapshotDigest:'a'.repeat(32),note:'Checked access and assigned follow-up.'});
test('security center and event routes reject staff and scoped administrators before querying evidence',async()=>{
  for(const member of [{role:'operations'},{role:'onboarding'},{role:'finance'},{role:'viewer'},{role:'partner'},{role:'admin',all_companies:false}]){
    fixture.member={...fixture.member,...member};for(const path of ['/security/center','/security/events','/security/events/export'])assert.equal((await request(path)).status,403);
    assert.equal((await review()).status,403);
  }
  assert.equal(calls('title_security_center').length+calls('title_security_events').length+calls('title_record_access_review').length,0);
  assert.ok(fixture.events.every(event=>event.p_event_type==='authorization.denied'&&!JSON.stringify(event).includes('PRIVATE')));
});
test('workspace-wide administrator receives truthful scan status with no document data',async()=>{
  fixture.member={...fixture.member,role:'admin',all_companies:true};const response=await request('/security/center');assert.equal(response.status,200);const data=await response.json();
  assert.deepEqual(data.documentScanning,{policy:'pending_setup',legacyUnscannedCount:4,configured:false});assert.ok(!JSON.stringify(data).includes('PRIVATE'));
  assert.equal(calls('title_security_center')[0].args.p_access_version,1);
});
test('event queries validate cursor pairs, duplicate keys and page bounds before RPC',async()=>{
  for(const query of ['limit=101','limit=0','limit=50&limit=100','before=x','format=html'])assert.equal((await request('/security/events?'+query)).status,400);
  assert.equal(calls('title_security_events').length,0);
  const timestamp='2026-09-24T00:00:00.123456+00:00';const response=await request('/security/events?'+new URLSearchParams({before:timestamp,beforeId:eventId,limit:'100'}));assert.equal(response.status,200);
  assert.equal(calls('title_security_events')[0].args.p_before,timestamp);assert.equal(calls('title_security_events')[0].args.p_limit,100);
});
test('export is redacted, audited before response and fails closed when evidence cannot persist',async()=>{
  for(const path of ['/security/events/export?format=json','/security/events/export?format=csv']){
    fixture.auditFailure=true;let response=await request(path);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE|asset_fixture/);
    fixture.auditFailure=false;response=await request(path);assert.equal(response.status,200);assert.ok(fixture.events.some(event=>event.p_event_type==='security.events_exported'));assert.equal(response.headers.get('Cache-Control'),'no-store');
    const body=await response.text();assert.ok(body.includes('asset_fixture'));assert.doesNotMatch(body,/PRIVATE/);
  }
});
test('review validates notes, propagates stale snapshot conflicts, and uses one transactional RPC',async()=>{
  assert.equal((await request('/security/access-review',{snapshotDigest:'a'.repeat(32),note:'',password:'PRIVATE'})).status,400);assert.equal(calls('title_record_access_review').length,0);
  fixture.reviewStale=true;assert.equal((await review()).status,409);assert.equal(fixture.reviews.length,0);
  fixture.reviewStale=false;fixture.auditFailure=true;assert.equal((await review()).status,503);assert.equal(fixture.reviews.length,0);
  fixture.auditFailure=false;const response=await review();assert.equal(response.status,200);assert.equal(fixture.reviews.length,1);assert.equal(calls('title_record_security_event').length,0,'HTTP does not perform a separate, non-atomic review event write');
});
test('document download releases bytes only after an awaited durable event and never logs content, path or filename',async()=>{
  fixture.auditWait=true;let completed=false;const pending=request('/assets/download?id=asset_fixture').then(response=>{completed=true;return response;});
  for(let i=0;!fixture.releaseAudit&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(completed,false);assert.equal(fixture.downloads,1);fixture.releaseAudit();const response=await pending;assert.equal(response.status,200);assert.equal(await response.text(),'PRIVATE_DOCUMENT_BYTES');
  const logged=fixture.events[0];assert.equal(logged.p_event_type,'file.download');assert.equal(logged.p_workspace_revision,1);assert.equal(logged.p_access_version,1);assert.doesNotMatch(JSON.stringify(logged),/PRIVATE|@example/);
});
test('audit failure, membership change, or document-state revision change during download returns no bytes',async()=>{
  for(const mutation of [()=>{fixture.auditFailure=true;},()=>{fixture.member.version++;},()=>{fixture.revision++;}]){
    fixture.auditFailure=false;fixture.member.version=1;fixture.revision=1;fixture.duringDownload=mutation;
    const response=await request('/assets/download?id=asset_fixture');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE_DOCUMENT|PRIVATE_DATABASE/);
  }
});
test('company and restricted document denials happen before storage and remain denied even if denial audit fails',async()=>{
  fixture.member={...fixture.member,role:'operations',all_companies:false,company_ids:['B'],restricted_access:false};fixture.auditFailure=true;
  assert.equal((await request('/assets/download?id=asset_fixture')).status,403);assert.equal(fixture.downloads,0);
  fixture.member.company_ids=['A'];fixture.state.documents[0].visibility='Restricted';assert.equal((await request('/assets/download?id=asset_fixture')).status,403);assert.equal(fixture.downloads,0);
});
test('backup creation routes through a single atomic evidence RPC and does not report success on audit failure',async()=>{
  fixture.auditFailure=true;assert.equal((await request('/backups',{})).status,503);assert.equal(fixture.mutations.length,0);
  fixture.auditFailure=false;assert.equal((await request('/backups',{})).status,200);assert.deepEqual(fixture.mutations,['title_create_audited_backup']);assert.equal(calls('title_record_security_event').length,0);
});
test('backup restore routes through its atomic RPC and rejects non-owner restoration before mutation',async()=>{
  fixture.backup.state=structuredClone(fixture.state);fixture.backup.state.documents=[];
  fixture.member.role='admin';assert.equal((await request('/backups/restore',{backupId:eventId,expectedRevision:1})).status,403);assert.equal(calls('title_restore_audited_backup').length,0);
  fixture.member.role='owner';fixture.auditFailure=true;assert.equal((await request('/backups/restore',{backupId:eventId,expectedRevision:1})).status,503);assert.equal(fixture.mutations.length,0);
  fixture.auditFailure=false;const response=await request('/backups/restore',{backupId:eventId,expectedRevision:1});assert.equal(response.status,200);assert.deepEqual(fixture.mutations,['title_restore_audited_backup']);
  assert.ok(calls('title_record_security_event').every(call=>call.args.p_event_type==='authorization.denied'),'restore does not append audit in a separate post-commit transaction');
});
