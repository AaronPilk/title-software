import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle=await build({stdin:{contents:"export * from './lib/backend/document-packages'; export { emptyWorkspace } from './lib/backend/workspace'; export { analyzeTitleDocuments } from './lib/title/document-intelligence';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},write:false,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {verifyPackageTransition,documentPackageRequest,emptyWorkspace,analyzeTitleDocuments}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=document-packages-test-bundle.mjs').toString('base64')}`);
const hash=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
const source=(id='D1',companyId='C1')=>({documentId:id,assetId:`A-${id}`,version:1,name:`${id}.pdf`,mime:'application/pdf',companyId,visibility:'Internal',sha256:'a'.repeat(64),bytes:100});
const accessIdentity='W1:user-1:1';
const receipt=async page=>({page:page.page,method:page.method,textSha256:await hash(page.text),characters:page.text.length,lines:page.text.split(/\r\n|\r|\n/).length,...(page.confidence===undefined?{}:{confidence:page.confidence}),...(page.rotation===undefined?{}:{rotation:page.rotation})});
const checkpoint=(sources,status='reading')=>({version:1,accessIdentity,sources,status});
const entry=(identity=source(),totalPages=2,completed=[],issues=[])=>({identity,totalPages,completed,issues});
const batch=(pages=[],issues=[],identity=source())=>({source:identity,attemptedPages:[...pages.map(item=>item.page),...issues.map(item=>item.page)],pages,issues});
const saved=(sources=[source()])=>({id:'11111111-1111-4111-8111-111111111111',version:1,sources,checkpoint:null,pages:{},decisions:[]});
const page=(number,text=`Page ${number}`,method='pdf-text')=>({page:number,text,method});

function context(data=saved()){
 const state=emptyWorkspace();state.companies=[{id:'C1',name:'Cedar Example',initials:'CE',color:'blue',contact:'Example',email:'example@example.test',location:'Charlotte',jurisdiction:'NC',stage:'Onboarding',steps:[],members:[]}];
 state.companies=[...new Set(data.sources.map(item=>item.companyId))].map(id=>({...state.companies[0],id}));
 state.documents=data.sources.map(item=>({id:item.documentId,name:item.name,companyId:item.companyId,version:item.version,assetId:item.assetId,mime:item.mime,visibility:item.visibility,category:'Title',date:'2026-09-23',size:'100 bytes'}));
 const calls=[];const ctx={workspaceId:'W1',access:{userId:'user-1',email:'operator@example.test',role:'operations',companyIds:['C1'],allCompanies:false,restricted:false,version:1,partnerMembers:[]},state,revision:4,assets:data.sources.map(item=>({id:item.assetId,document_id:item.documentId,company_id:item.companyId,sha256:item.sha256,byte_size:item.bytes,mime:item.mime})),rpc:async args=>{calls.push(args);if(['open','load'].includes(args.p_action))return data;return {version:2,decisions:args.p_input.decisions??[]};}};
 return {ctx,calls};
}

test('exact batch receipts and failed-page retry retain every saved page',async()=>{
 const p1=page(1), failure={page:2,reason:'failed',message:'Unread scan'};
 const firstCheckpoint=checkpoint([entry(source(),2,[await receipt(p1)],[failure])],'partial');
 const first=await verifyPackageTransition(saved(),batch([p1],[failure]),firstCheckpoint,accessIdentity);
 const p2=page(2),next=checkpoint([entry(source(),2,[await receipt(p1),await receipt(p2)])],'complete');
 const result=await verifyPackageTransition({...saved(),checkpoint:first.checkpoint,pages:first.pages},batch([p2]),next,accessIdentity);
 assert.deepEqual(Object.keys(result.pages),['D1:2']);assert.equal(result.checkpoint.status,'complete');
});

test('source omission, source substitution and access-version substitution fail closed',async()=>{
 const p1=page(1),cp=checkpoint([entry(source(),2,[await receipt(p1)])]);
 for(const altered of [{...cp,accessIdentity:'W1:user-1:2'},{...cp,sources:[{...cp.sources[0],identity:{...source(),sha256:'b'.repeat(64)}}]}]) await assert.rejects(async()=>verifyPackageTransition(saved(),batch([p1]),altered,accessIdentity));
 await assert.rejects(async()=>verifyPackageTransition(saved([source(),source('D2')]),batch([p1]),cp,accessIdentity),/no longer matches/);
});

test('saved text cannot be forged against receipts, omitted, or replaced later',async()=>{
 const p1=page(1),cp=checkpoint([entry(source(),2,[await receipt(p1)])]);
 await assert.rejects(async()=>verifyPackageTransition(saved(),batch([{...p1,text:'Forged'}]),cp,accessIdentity),/receipt/);
 const old={...saved(),checkpoint:cp,pages:{'D1:1':{...p1,documentId:'D1'}}};
 await assert.rejects(async()=>verifyPackageTransition(old,batch(),checkpoint([entry()]),accessIdentity),/skipped|removed/);
 const replacement=page(1,'Changed');
 await assert.rejects(async()=>verifyPackageTransition(old,batch([replacement]),checkpoint([entry(source(),2,[await receipt(replacement)])]),accessIdentity),/cannot be replaced/);
 const p2=page(2);await assert.rejects(async()=>verifyPackageTransition(old,batch([p2]),checkpoint([entry(source(),1,[await receipt(p1)])]),accessIdentity),/manifest|invalid/);
});

test('failed pages remain visible and successful OCR receipt metadata cannot be altered',async()=>{
 const issue={page:1,reason:'timeout',message:'Timed out'};
 const old={...saved(),checkpoint:checkpoint([entry(source(),2,[],[issue])],'partial')};
 await assert.rejects(async()=>verifyPackageTransition(old,batch(),checkpoint([entry()]),accessIdentity),/Unread pages/);
 const ocr={...page(1,'Exact OCR','ocr'),confidence:91,rotation:90};const r=await receipt(ocr);
 await assert.rejects(async()=>verifyPackageTransition(saved(),batch([ocr]),checkpoint([entry(source(),2,[{...r,confidence:99}])]),accessIdentity),/receipt/);
});

test('out of range and falsely complete scans are rejected',async()=>{
 const p3=page(3);await assert.rejects(async()=>verifyPackageTransition(saved(),batch([p3]),checkpoint([entry()]),accessIdentity),/outside/);
 const p1=page(1);await assert.rejects(async()=>verifyPackageTransition(saved(),batch([p1]),checkpoint([entry(source(),2,[await receipt(p1)])],'complete'),accessIdentity));
 await assert.rejects(async()=>verifyPackageTransition(saved(),{source:source(),attemptedPages:[1],pages:[],issues:[]},checkpoint([entry()]),accessIdentity));
});

test('cross-company and restricted originals are unavailable before persistence',async()=>{
 for(const mutation of [ctx=>ctx.access.companyIds=['OTHER'],ctx=>ctx.state.documents[0].visibility='Restricted',ctx=>ctx.assets[0].document_id='OTHER',ctx=>ctx.access.role='viewer',ctx=>ctx.access.role='partner']){
 const {ctx,calls}=context();mutation(ctx);await assert.rejects(async()=>documentPackageRequest('open',{documentIds:['D1']},ctx),error=>error.status===403);assert.equal(calls.length,0);
 }
});

test('mixed-company packages and changed originals cannot resume',async()=>{
 const both=saved([source(),source('D2','C2')]);const first=context(both);first.ctx.access.allCompanies=true;
 await assert.rejects(async()=>documentPackageRequest('open',{documentIds:['D1','D2']},first.ctx),/one company's/);
 for(const mutation of [ctx=>ctx.state.documents[0].version++,ctx=>ctx.state.documents[0].name='Renamed.pdf',ctx=>ctx.assets[0].sha256='b'.repeat(64),ctx=>ctx.state.documents[0].visibility='Partner']){
 const {ctx}=context();mutation(ctx);await assert.rejects(async()=>documentPackageRequest('save',{id:saved().id,expectedVersion:1,batch:batch(),checkpoint:checkpoint([entry()])},ctx),error=>error.status===409);
 }
});

test('stale package writes are denied before saving and actor/revision are server supplied',async()=>{
 const {ctx,calls}=context();await assert.rejects(async()=>documentPackageRequest('save',{id:saved().id,expectedVersion:2,batch:batch(),checkpoint:checkpoint([entry()])},ctx),error=>error.status===409);
 assert.deepEqual(calls.map(call=>call.p_action),['load']);
 const p1=page(1);await documentPackageRequest('save',{id:saved().id,expectedVersion:1,batch:batch([p1]),checkpoint:checkpoint([entry(source(),2,[await receipt(p1)])])},ctx);
 const last=calls.at(-1);assert.equal(last.p_actor,'user-1');assert.equal(last.p_access_version,1);assert.equal(last.p_state_revision,4);
});

test('field review is recomputed from saved sources and cannot accept a forged candidate',async()=>{
 const p1=page(1,'DEED OF TRUST\nLoan amount: $250,000.00');const data={...saved(),pages:{'D1:1':{...p1,documentId:'D1'}},checkpoint:checkpoint([entry(source(),1,[await receipt(p1)])],'complete')};
 const {ctx,calls}=context(data);const analysis=analyzeTitleDocuments([{id:'D1',name:'D1.pdf',version:1,pages:[p1]}]);const candidate=analysis.fields.find(field=>field.fieldId==='loanAmount').candidates[0];
 await assert.rejects(async()=>documentPackageRequest('review',{id:data.id,expectedVersion:1,decisions:[{candidateId:'invented',action:'accepted',note:'Reviewed'}]},ctx));
 const result=await documentPackageRequest('review',{id:data.id,expectedVersion:1,decisions:[{candidateId:candidate.id,action:'corrected',value:'$250,900.00',note:'Compared to original image'}]},ctx);
 assert.equal(result.decisions[0].reviewerId,'user-1');assert.equal(result.decisions[0].originalValue,'$250,000.00');assert.equal(result.decisions[0].reviewedValue,'$250,900.00');assert.equal(result.decisions[0].evidence.documentId,'D1');
 assert.equal(calls.at(-1).p_action,'review');
});

test('sequential review submissions preserve other decisions and replace only the reviewed candidate',async()=>{
 const p1=page(1,'DEED OF TRUST\nLoan amount: $250,000.00\nTrustee: Example Trustee, Inc.');
 const data={...saved(),pages:{'D1:1':{...p1,documentId:'D1'}},checkpoint:checkpoint([entry(source(),1,[await receipt(p1)])],'complete')};
 const {ctx}=context(data);ctx.rpc=async args=>{
  if(args.p_action==='load')return structuredClone(data);
  assert.equal(args.p_action,'review');assert.equal(args.p_input.expectedVersion,data.version);
  data.decisions=args.p_input.decisions;data.version++;return {version:data.version,decisions:structuredClone(data.decisions)};
 };
 const analysis=analyzeTitleDocuments([{id:'D1',name:'D1.pdf',version:1,pages:[p1]}]);
 const loan=analysis.fields.find(field=>field.fieldId==='loanAmount').candidates[0],trustee=analysis.fields.find(field=>field.fieldId==='trustee').candidates[0];
 const record=(candidateId,action='accepted',value)=>documentPackageRequest('review',{id:data.id,expectedVersion:data.version,decisions:[{candidateId,action,...(value?{value}:{}),note:'Compared exact source page and relationship.'}]},ctx);
 await record(loan.id);assert.equal(data.decisions.length,1);
 await record(trustee.id);assert.equal(data.decisions.length,2);assert.deepEqual(new Set(data.decisions.map(item=>item.fieldId)),new Set(['loanAmount','trustee']));
 await record(loan.id,'corrected','$250,900.00');assert.equal(data.decisions.length,2);assert.equal(data.decisions.find(item=>item.fieldId==='loanAmount').reviewedValue,'$250,900.00');assert.equal(data.decisions.find(item=>item.fieldId==='trustee').reviewedValue,'Example Trustee, Inc.');
});
