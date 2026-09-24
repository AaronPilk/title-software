import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({absWorkingDir:root,entryPoints:['lib/backend/security-center.ts'],write:false,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const security=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const w='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001', id='30000000-0000-4000-8000-000000000001';
const event={id,createdAt:'2026-09-24T00:00:00.123456+00:00',actorId:actor,eventType:'file.download',outcome:'success',companyId:'A',recordType:'asset',recordId:'asset_fixture',count:1};
test('only an owner or a workspace-wide admin can read the security center',()=>{
  for(const role of ['operations','onboarding','finance','viewer','partner']) for(const allCompanies of [true,false]) assert.throws(()=>security.requireSecurityCenterAccess({role,allCompanies}),error=>error.status===403);
  assert.throws(()=>security.requireSecurityCenterAccess({role:'admin',allCompanies:false}),error=>error.status===403);
  security.requireSecurityCenterAccess({role:'admin',allCompanies:true}); security.requireSecurityCenterAccess({role:'owner',allCompanies:false});
});
test('event metadata rejects arbitrary payloads, names and invalid record types',()=>{
  for(const input of [
    {eventType:'file.download',outcome:'success',recordType:'asset',recordId:'record',detail:{password:'must not log'}},
    {eventType:'file.download',outcome:'success',recordType:'asset',recordId:'customer@example.test'},
    {eventType:'file.download',outcome:'success',recordType:'asset',recordId:'=HYPERLINK("http://bad")'},
    {eventType:'backup.restored',outcome:'success',recordType:'backup',recordId:'not-a-uuid'},
    {eventType:'unknown',outcome:'success'}, {eventType:'file.download',outcome:'success'},
    {eventType:'file.download',outcome:'denied'}, {eventType:'authorization.denied',outcome:'success'},
    {eventType:'document.scan_clean',outcome:'success',count:NaN},
  ]) assert.throws(()=>security.parseSecurityEvent(input));
  assert.doesNotThrow(()=>security.parseSecurityEvent({eventType:'document.scan_blocked',outcome:'failure',companyId:'A'}));
  const safe=security.redactSecurityEvent({...event,email:'secret@example.test',filename:'secret.pdf',detail:{secret:true}});
  assert.deepEqual(safe,event); assert.ok(!JSON.stringify(safe).includes('secret'));
});
test('cursor pagination preserves microseconds and rejects invalid or duplicate values',()=>{
  const page=security.parseSecurityPage(new URLSearchParams({before:event.createdAt,beforeId:id,limit:'100',format:'csv'}));
  assert.equal(page.before,event.createdAt); assert.equal(page.limit,100);
  for(const query of ['limit=101','limit=0','limit=NaN','before=invalid&beforeId='+id,'before='+encodeURIComponent(event.createdAt),'limit=50&limit=100','format=html','all=true']) assert.throws(()=>security.parseSecurityPage(new URLSearchParams(query)));
});
test('CSV exports contain a fixed value-free schema, bounded pages and no formula cells',()=>{
  const csv=security.securityEventsCsv([{...event,email:'secret@example.test',detail:{token:'secret'}}]);
  assert.ok(csv.startsWith('id,createdAt,actorId,eventType,outcome,companyId,recordType,recordId,count\r\n'));
  assert.ok(!csv.includes('secret')); assert.throws(()=>security.securityEventsCsv(Array.from({length:101},()=>event)));
  assert.throws(()=>security.securityEventsCsv([{...event,companyId:'=CMD'}]));
});
test('review intent requires exact bounded fields, version digest and a nonempty note',()=>{
  const input={workspaceId:w,snapshotDigest:'a'.repeat(32),note:' Checked access. '};
  assert.equal(security.parseAccessReview(input).note,'Checked access.');
  for(const changed of [{note:''},{note:'x'.repeat(1001)},{note:'a\u0000b'},{snapshotDigest:'wrong'},{workspaceId:'invalid'},{extra:'credential'}]) assert.throws(()=>security.parseAccessReview({...input,...changed}));
});
test('sensitive read event completion waits for a durable audit receipt and fails closed without leaking errors',async()=>{
  let resolve; let completed=false;
  const pending=security.recordSecurityEvent(async(name,payload)=>{
    assert.equal(name,'title_record_security_event'); assert.equal(payload.p_access_version,4); assert.equal(payload.p_record_id,'asset_fixture');
    return await new Promise(r=>{resolve=r;});
  },{workspaceId:w,actorId:actor,accessVersion:4,workspaceRevision:1},{eventType:'file.download',outcome:'success',recordType:'asset',recordId:'asset_fixture'}).then(()=>{completed=true;});
  await Promise.resolve(); assert.equal(completed,false); resolve({data:id,error:null}); await pending; assert.equal(completed,true);
  for(const transport of [async()=>({data:null,error:{message:'private connection string'}}),async()=>{throw new Error('private token');},async()=>({data:'not-a-receipt',error:null})]) await assert.rejects(security.recordSecurityEvent(transport,{workspaceId:w,actorId:actor,accessVersion:4,workspaceRevision:1},{eventType:'authorization.denied',outcome:'denied'}),error=>error.status===503&&!error.message.includes('private'));
  await assert.rejects(security.recordSecurityEvent(async()=>({data:id,error:null}),{workspaceId:w,actorId:actor},{eventType:'file.download',outcome:'success',recordType:'asset',recordId:'asset_fixture'}),error=>error.status===403);
});
test('readiness reports observations and missing external evidence without a compliance score',()=>{
  const controls=security.securityReadiness({latestReview:{current:false},evidence:{eventCount:0,lastEventAt:null,backupCount:1,lastBackupAt:event.createdAt}});
  assert.equal(controls.find(c=>c.id==='access').status,'needs_review'); assert.equal(controls.find(c=>c.id==='operations').status,'external_verification');
  assert.ok(controls.find(c=>c.id==='backup').detail.includes('does not prove original-file recovery'));
});
