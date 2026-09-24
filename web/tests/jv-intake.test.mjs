import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle=await build({stdin:{contents:"export * from './lib/backend/jv-intake'; export { emptyWorkspace, ApiError } from './lib/backend/workspace'; export * from './lib/title/jv-application';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},write:false,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {jvIntakeRequest,emptyWorkspace,newJVApplication,jvReadiness,ApiError}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=jv-intake-fixture.mjs').toString('base64')}`);
const base={workspaceId:'W1',companyId:'C1'};
function complete(){
 const p=newJVApplication();Object.assign(p.applicants[0],{name:'Fictional Applicant',email:'applicant@example.test',phone:'7045550101',dob:'1985-01-15',ssn:'123456789',driverLicense:'FICTIONAL-DL',currentAddress:'10 Example Street',ownershipType:'individual',businessStatus:'not-applicable',residenceHistory:[{id:'residence-1',address:'10 Example Street',from:'2000-01-01',to:''}],employmentHistory:[{id:'job-1',employer:'Example Employer',role:'Coordinator',address:'20 Example Street',from:'2000-01-01',to:''}]});
 return p;
}
function fixture(){
 const state=emptyWorkspace();state.companies=[{id:'C1'},{id:'C2'}];
 state.documents=[{id:'D1',companyId:'C1',visibility:'Restricted',category:'Applications',assetId:'A1',version:1}];
 const calls=[];let stored=null;const fresh={active:true,version:7,company:true,restricted:true};
 const ctx={workspaceId:'W1',state,access:{userId:'user-1',email:'staff@example.test',role:'onboarding',companyIds:['C1'],allCompanies:false,restricted:true,version:7,partnerMembers:[]},rpc:async args=>{
  calls.push(structuredClone(args));
  if(!fresh.active||fresh.version!==args.p_access_version||!fresh.company||!fresh.restricted)throw new ApiError('Sensitive database error',403);
  if(args.p_action==='load')return structuredClone(stored);
  const i=args.p_input;
  if((stored?.version??0)!==i.expectedVersion)throw new ApiError('Sensitive CAS error',409);
  const stamp=new Date().toISOString();
  stored={companyId:args.p_company,version:i.expectedVersion+1,payload:structuredClone(i.payload),status:i.status,reviewNote:i.reviewNote,updatedAt:stamp,updatedBy:args.p_actor,reviewedAt:i.status==='Reviewed'?(stored?.reviewedAt??stamp):null,reviewedBy:i.status==='Reviewed'?(stored?.reviewedBy??args.p_actor):null};return structuredClone(stored);
 }};
 return {ctx,calls,fresh,get:()=>structuredClone(stored),set:value=>{stored=value},request:(action,input={})=>jvIntakeRequest(action,{...base,...input},ctx)};
}

test('only restricted owner/admin/onboarding with current company scope can open private intake',async()=>{
 for(const role of ['owner','admin','onboarding']){const f=fixture();f.ctx.access.role=role;assert.equal((await f.request('load')).version,0);}
 for(const mutate of [a=>a.access.role='operations',a=>a.access.role='finance',a=>a.access.role='viewer',a=>a.access.role='partner',a=>a.access.restricted=false,a=>a.access.companyIds=['C2'],a=>a.state.companies=[]]){
  const f=fixture();mutate(f.ctx);await assert.rejects(()=>f.request('load'),e=>e.status===403);assert.equal(f.calls.length,0);
 }
});
test('private application saves through explicit versioned RPC without workspace mutation',async()=>{
 const f=fixture(),before=structuredClone(f.ctx.state),p=complete();p.sourceDocumentIds=['D1'];assert.deepEqual(jvReadiness(p),[]);
 const r=await f.request('save',{expectedVersion:0,payload:p});assert.equal(r.version,1);assert.equal(r.status,'Draft');assert.equal(r.payload.applicants[0].ssn,'123456789');
 assert.deepEqual(f.ctx.state,before);assert.deepEqual(f.calls.map(c=>c.p_action),['load','save']);
 assert.deepEqual(Object.keys(f.calls[1]).sort(),['p_access_version','p_action','p_actor','p_company','p_input','p_workspace']);
 assert.deepEqual(Object.keys(f.calls[1].p_input).sort(),['expectedVersion','payload','reviewNote','sourceManifest','status']);
});
test('unknown request fields and missing/invalid version or payload cannot forge review metadata',async()=>{
 for(const input of [{expectedVersion:-1,payload:complete()},{expectedVersion:1.5,payload:complete()},{payload:complete()},{expectedVersion:0},{expectedVersion:0,payload:complete(),reviewedBy:'forged'},{expectedVersion:0,payload:{...complete(),reviewedAt:'forged'}},{workspaceId:'OTHER',expectedVersion:0,payload:complete()}]){
  const f=fixture();await assert.rejects(()=>f.request('save',input));assert.equal(f.get(),null);
 }
});
test('source documents must be uploaded restricted application originals from this company',async()=>{
 for(const mutate of [d=>d.companyId='C2',d=>d.visibility='Internal',d=>d.category='Company records',d=>d.orderId='O1',d=>delete d.assetId]){
  const f=fixture();mutate(f.ctx.state.documents[0]);const p=complete();p.sourceDocumentIds=['D1'];await assert.rejects(()=>f.request('save',{expectedVersion:0,payload:p}),e=>e.status===403);assert.equal(f.get(),null);
 }
 const f=fixture(),p=complete();p.sourceDocumentIds=['missing'];await assert.rejects(()=>f.request('save',{expectedVersion:0,payload:p}),e=>e.status===403);
});
test('explicit ready/review/reopen transitions preserve checklist review and reset changed intake',async()=>{
 const f=fixture();let r=await f.request('save',{expectedVersion:0,payload:complete()});
 await assert.rejects(()=>f.request('review',{expectedVersion:r.version,reviewNote:'Compared originals.'}),e=>e.status===409);
 r=await f.request('submit',{expectedVersion:r.version});assert.equal(r.status,'Ready for review');assert.equal(r.reviewedBy,null);
 await assert.rejects(()=>f.request('review',{expectedVersion:r.version,reviewNote:''}));
 r=await f.request('review',{expectedVersion:r.version,reviewNote:'Compared fictional originals and five-year histories.'});assert.equal(r.status,'Reviewed');assert.equal(r.reviewedBy,'user-1');
 const reviewedAt=r.reviewedAt,p=structuredClone(r.payload);p.steps[0].status='In progress';p.steps[0].assignee='Fictional staff';
 r=await f.request('save',{expectedVersion:r.version,payload:p});assert.equal(r.status,'Reviewed');assert.equal(r.reviewedAt,reviewedAt);assert.match(r.reviewNote,/fictional/);
 await assert.rejects(()=>f.request('submit',{expectedVersion:r.version}),e=>e.status===409);
 const changed=structuredClone(r.payload);changed.applicants[0].phone='7045550102';r=await f.request('save',{expectedVersion:r.version,payload:changed});assert.equal(r.status,'Draft');assert.equal(r.reviewedAt,null);assert.equal(r.reviewNote,'');
 r=await f.request('submit',{expectedVersion:r.version});r=await f.request('reopen',{expectedVersion:r.version});assert.equal(r.status,'Draft');
});
test('readiness and unchanged submitted intake gate review without completing setup steps',async()=>{
 const f=fixture();await assert.rejects(()=>f.request('submit',{expectedVersion:0,payload:newJVApplication()}));
 const p=complete();p.applicants[0].ownershipType='business';p.applicants[0].businessName='Fictional LLC';p.applicants[0].businessStatus='forming';p.applicants[0].businessReference='In progress';
 await assert.rejects(()=>f.request('submit',{expectedVersion:0,payload:p}));
 let r=await f.request('submit',{expectedVersion:0,payload:complete()});const changed=structuredClone(r.payload);changed.notes='Updated private notes';
 await assert.rejects(()=>f.request('review',{expectedVersion:r.version,payload:changed,reviewNote:'Reviewed'}),e=>e.status===409);
 r=await f.request('review',{expectedVersion:r.version,reviewNote:'Manually reviewed.'});assert.ok(r.payload.steps.every(s=>s.status==='Not started'));
});
test('stale versions and access revocation between load/save fail without a write',async()=>{
 const f=fixture();await f.request('save',{expectedVersion:0,payload:complete()});await assert.rejects(()=>f.request('save',{expectedVersion:0,payload:complete()}),e=>e.status===409);
 for(const field of ['active','restricted','company','version']){
  const f=fixture(),original=f.ctx.rpc;f.ctx.rpc=async args=>{const result=await original(args);if(args.p_action==='load')f.fresh[field]=field==='version'?8:false;return result;};
  await assert.rejects(()=>f.request('save',{expectedVersion:0,payload:complete()}),e=>e.status===403&&!e.message.includes('Sensitive'));assert.equal(f.get(),null);
 }
});
test('RPC failures and corrupt responses never echo private values or internal metadata',async()=>{
 for(const thrown of [new Error('123456789 Fictional Applicant'),new ApiError('123456789',409),{code:'42501',message:'123456789'},{code:'22023',message:'123456789'}]){
  const f=fixture();f.ctx.rpc=async()=>{throw thrown};await assert.rejects(()=>f.request('load'),e=>!e.message.includes('123456789')&&!e.message.includes('Fictional Applicant'));
 }
 const f=fixture();let r=await f.request('save',{expectedVersion:0,payload:complete()});f.set({...r,secret_id:'must-not-leak'});assert.equal((await f.request('load')).secret_id,undefined);
 f.set({...r,companyId:'C2'});await assert.rejects(()=>f.request('load'),e=>e.status===503);
});

test('database CAS after preflight load wins over stale save and source-change notices survive projection',async()=>{
 const f=fixture();await f.request('save',{expectedVersion:0,payload:complete()});const original=f.ctx.rpc;
 f.ctx.rpc=async args=>{const response=await original(args);if(args.p_action==='load')f.set({...f.get(),version:2});return response;};
 await assert.rejects(()=>f.request('save',{expectedVersion:1,payload:complete()}),e=>e.status===409);assert.equal(f.get().version,2);
 f.ctx.rpc=original;f.set({...f.get(),sourceChanged:true,status:'Draft'});assert.equal((await f.request('load')).sourceChanged,true);
});
