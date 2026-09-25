import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {ownerRecordsFixture} from './fixtures/company-records.mjs';
const built=await build({stdin:{contents:"export * from './lib/title/company-records';export * from './lib/title/company-workspace';export * from './lib/title/application-worksheet';export * from './lib/backend/workspace';export * from './lib/backend/jv-intake';export * from './lib/title/jv-application';export {createSeed} from './lib/title/model';export {saveCompanyUnderwriters} from './lib/title/business';export {captureCommands} from './lib/title/command-log';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node'});
const lib=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=company-workspace-test.mjs').toString('base64')}`);
const {validateCompanyRecords,validateCompanyWorkspace,validateCompanyDesk,prepareApplicationWorksheet,createSeed,emptyWorkspace,executeCommands,captureCommands,saveCompanyUnderwriters,projectWorkspace,newJVApplication,validateJVApplication,jvIntakeRequest}=lib;
const actor={userId:'test-owner',email:'owner@example.test',role:'owner',allCompanies:true,companyIds:[],restricted:true,version:1,partnerMembers:[]};
const apply=(before,mutate,access=actor)=>{const after=structuredClone(before);const commands=captureCommands(after,mutate);return executeCommands(before,commands,access);};
const desk=()=>({logoDocumentId:'',folders:[{id:'folder-1',name:'Owner formation'}],renewals:[{service:'Domain',renewalOn:'2027-02-01',provider:'Fictional registrar',reference:'company.example.test'},{service:'Email',renewalOn:'2027-05-02',provider:'Fictional email',reference:'Account A'},{service:'Website',renewalOn:'2027-08-03',provider:'Fictional host',reference:'Hosting B'}]});
const state=()=>{const s=emptyWorkspace();s.companies=[{id:'c1',name:'Fictional Cedar Title',initials:'FC',color:'teal',contact:'',email:'',location:'Charlotte',jurisdiction:'NC',operatingStates:['NC','SC'],stage:'Onboarding',steps:Array(7).fill(false),members:[{id:'member-a',name:'Fictional member A',share:49},{id:'member-b',name:'Fictional member B',share:51}]}];return s;};

test('optional contact creation captures both operating states and selected underwriters through server commands',()=>{
 const s=emptyWorkspace(),c=state().companies[0];c.members=[];
 const result=apply(s,d=>{d.companies.push(c);saveCompanyUnderwriters(d,{companyId:'c1',names:['Commonwealth','First American'],expected:[]});});
 assert.deepEqual(result.companies[0].operatingStates,['NC','SC']);assert.equal(result.companies[0].contact,'');assert.equal(result.companies[0].email,'');assert.deepEqual(result.business.onboarding[0].requiredUnderwriters,['Commonwealth','First American']);
 for(const states of [[],['NC','NC'],['SC'],['bad']])assert.throws(()=>apply(s,d=>d.companies.push({...c,operatingStates:states})));
});
test('logo, named folders, all three renewals and document placement survive command roundtrip',()=>{
 const s=state();s.documents=[{id:'logo',companyId:'c1',name:'logo.png',category:'Branding',visibility:'Internal',assetId:'logo-asset',mime:'image/png',version:1},{id:'formation',companyId:'c1',name:'formation.pdf',category:'Formation',visibility:'Restricted',assetId:'formation-asset',version:1}];
 const result=apply(s,d=>{d.companies[0].desk={...desk(),logoDocumentId:'logo'};d.documents[1].folderId='folder-1';});
 assert.deepEqual(result.companies[0].desk,{...desk(),logoDocumentId:'logo'});assert.equal(result.documents[1].folderId,'folder-1');
 assert.deepEqual(result.companies[0].members,s.companies[0].members);assert.equal(result.documents[1].visibility,'Restricted');
 const renamed=apply(result,d=>d.companies[0].desk.folders[0].name='Formation documents');assert.equal(renamed.documents[1].folderId,'folder-1');
});
test('old snapshots remain valid; invalid folder and cross-company or restricted logo boundaries fail',()=>{
 assert.doesNotThrow(()=>validateCompanyWorkspace(createSeed()));const s=state();s.companies[0].desk=desk();
 for(const doc of [{id:'logo',companyId:'other',category:'Branding',visibility:'Internal',assetId:'a',mime:'image/png'},{id:'logo',companyId:'c1',category:'Branding',visibility:'Restricted',assetId:'a',mime:'image/png'},{id:'logo',companyId:'c1',orderId:'o',category:'Branding',visibility:'Internal',assetId:'a',mime:'image/png'},{id:'logo',companyId:'c1',category:'Branding',visibility:'Internal',assetId:'a',mime:'image/svg+xml'}]){s.documents=[doc];s.companies[0].desk.logoDocumentId='logo';assert.throws(()=>validateCompanyWorkspace(s));}
 s.companies[0].desk.logoDocumentId='';s.documents=[{id:'doc',companyId:'c1',folderId:'foreign'}];assert.throws(()=>validateCompanyWorkspace(s));
 for(const value of [{...desk(),folders:[{id:'a',name:'Same'},{id:'b',name:' same '}]},{...desk(),renewals:[{...desk().renewals[0],renewalOn:'2026-02-30'}]},{...desk(),renewals:[{...desk().renewals[0],renewalOn:'0000-01-01'}]},{...desk(),secret:'x'}])assert.throws(()=>validateCompanyDesk(value));
});
test('production and partner projections omit agency desk; scoped users cannot edit other companies',()=>{
 const s=state();s.companies[0].desk=desk();
 assert.equal(projectWorkspace(s,{...actor,role:'operations'}).companies[0].desk,undefined);
 assert.equal(projectWorkspace(s,{...actor,role:'partner',partnerMembers:[{id:'grant',companyId:'c1',memberName:'Fictional member A'}]}).companies[0].desk,undefined);
 for(const access of [{...actor,role:'operations'},{...actor,allCompanies:false,companyIds:['c2']}])assert.throws(()=>apply(s,d=>{d.companies[0].desk=desk();d.companies[0].desk.renewals[0].provider='Different';},access));
});
test('member IDs survive edits and cannot be repurposed while shares retain separate meaning',()=>{
 const s=state();const result=apply(s,d=>{d.companies[0].members[0].share=40;d.companies[0].members[1].share=60;});assert.equal(result.companies[0].members[0].id,'member-a');
 for(const mutate of [m=>delete m.id,m=>m.id='other',m=>m.name='Different entity'])assert.throws(()=>apply(s,d=>mutate(d.companies[0].members[0])));
});
test('changing underwriters invalidates relevant approval evidence; unchanged names preserve it',()=>{
 const s=state(),c=s.companies[0];c.steps[0]=c.steps[4]=c.steps[6]=true;c.stage='Active';c.operatingStatus={status:'Active',confirmedBy:actor.email,confirmedAt:'2026-09-24T10:00:00.000Z',note:'Existing business confirmed by owner.'};
 s.business.onboarding=[{companyId:c.id,legalName:c.name,mailingAddress:'',contactEmail:'',secureApplicationReference:'',signatureReference:'',applicationStatus:'Not started',applicationNote:'',requiredUnderwriters:['WFG'],evidence:[{step:0},{step:4},{step:6}],launchedAt:'2026-09-24',launchSnapshot:'old'}];
 const unchanged=structuredClone(s);saveCompanyUnderwriters(unchanged,{companyId:'c1',names:['WFG'],expected:['WFG']});assert.deepEqual(unchanged,s);
 saveCompanyUnderwriters(s,{companyId:'c1',names:['First American'],expected:['WFG']});assert.deepEqual(c.steps,Array(7).fill(false));assert.equal(c.stage,'Onboarding');assert.equal(c.operatingStatus.status,'Active');assert.deepEqual(s.business.onboarding[0].evidence,[]);
 assert.throws(()=>saveCompanyUnderwriters(s,{companyId:'c1',names:['WFG'],expected:['WFG']}),/changed/);
});
test('private entities normalize EIN without requiring documents and preserve old application schema',()=>{
 const old=newJVApplication();assert.equal(Object.hasOwn(validateJVApplication(old),'companyRecords'),false);
 const records=ownerRecordsFixture();records.owners[0].ein='12-0000002';const normalized=validateCompanyRecords(records);assert.equal(normalized.owners[0].ein,'120000002');assert.deepEqual(normalized.owners[0].documentIds,[]);
 const full=validateJVApplication({...old,companyRecords:records});assert.deepEqual(full.applicants,old.applicants);assert.deepEqual(full.steps,old.steps);assert.deepEqual(full.companyRecords,normalized);
});
test('private record schema rejects nulls, extra keys, malformed numbers, impossible dates and mixed individual entity data',()=>{
 for(const mutate of [r=>r.companyEin=null,r=>r.companyEin='---',r=>r.companyEin='1-20000002',r=>r.owners.push({...r.owners[0]}),r=>r.owners[0].memberId='',r=>r.owners[0].kind='individual',r=>r.owners[0].representatives[0].email='bad',r=>r.agreements[0].terms[0].percentage='100.001',r=>r.agreements[0].effectiveOn='2026-02-30',r=>r.agreements[0].effectiveOn='0000-01-01',r=>r.worksheets[0].fields[0].source='applicant.ssn',r=>r.unknown='x']){const r=ownerRecordsFixture();mutate(r);assert.throws(()=>validateCompanyRecords(r));}
 const r=ownerRecordsFixture();r.agreements[0].terms[0].percentage='100.000';assert.equal(validateCompanyRecords(r).agreements[0].terms[0].percentage,'100.000');
});
test('worksheet uses selected owner and representative, escapes markup and keeps terms separate from ownership',()=>{
 const c=state().companies[0],r=ownerRecordsFixture();r.owners.push({...structuredClone(r.owners[0]),id:'owner-b',memberId:'member-b',legalName:'<script>Second entity</script>',ein:'990000009',representatives:[{id:'rep-c',name:'Person C',email:'c@example.test',phone:''}]});
 let sheet=prepareApplicationWorksheet(c,r,r.worksheets[0],'owner-b','rep-c');assert.match(sheet.html,/&lt;script&gt;/);assert.doesNotMatch(sheet.html,/<script>|Fictional Person A|a@example.test|70.125/);assert.ok(sheet.rows.some(row=>row.value==='51'));assert.ok(sheet.rows.some(row=>row.value==='990000009'));assert.ok(sheet.rows.some(row=>row.value==='120000001'));
 r.owners[1].ein='';sheet=prepareApplicationWorksheet(c,r,r.worksheets[0],'owner-b','rep-c');assert.deepEqual(sheet.missing,['Owner EIN']);assert.match(sheet.html,/Missing — review required/);
 assert.throws(()=>prepareApplicationWorksheet(c,r,r.worksheets[0],'owner-b','rep-a'));assert.deepEqual(c.members.map(m=>m.share),[49,51]);
});
function privateFixture(){const s=state();const calls=[];let stored=null;const ctx={workspaceId:'workspace',state:s,access:actor,rpc:async args=>{calls.push(args);if(args.p_action==='load')return stored;const i=args.p_input;stored={companyId:'c1',version:i.expectedVersion+1,payload:i.payload,status:i.status,reviewNote:i.reviewNote,updatedAt:null,updatedBy:null,reviewedAt:null,reviewedBy:null};return stored;}};return {s,calls,ctx,request:(action,input={})=>jvIntakeRequest(action,{workspaceId:'workspace',companyId:'c1',...input},ctx)};}
test('private save preserves applicants/history/checklist, adds no workspace secrets, rejects stale missing extension and member',async()=>{
 const f=privateFixture(),before=structuredClone(f.s),p={...newJVApplication(),companyRecords:ownerRecordsFixture()};let record=await f.request('save',{expectedVersion:0,payload:p});assert.deepEqual(f.s,before);assert.deepEqual(record.payload.applicants,p.applicants);assert.deepEqual(record.payload.companyRecords,p.companyRecords);
 await assert.rejects(()=>f.request('save',{expectedVersion:1,payload:newJVApplication()}),e=>e.status===409);
 const changed=structuredClone(p);changed.companyRecords.owners[0].memberId='unknown';await assert.rejects(()=>f.request('save',{expectedVersion:1,payload:changed}),e=>e.status===409);
 assert.equal(f.calls.filter(c=>c.p_action==='save').length,1);assert.doesNotMatch(JSON.stringify(f.s),/120000001|120000002/);
});
test('purpose-bound references require same company restricted originals and deduplicate only after validating all uses',async()=>{
 const f=privateFixture(),p={...newJVApplication(),companyRecords:ownerRecordsFixture()};p.companyRecords.owners[0].documentIds=['D1'];p.companyRecords.worksheets[0].documentId='D1';f.s.documents=[{id:'D1',companyId:'c1',category:'Company records',visibility:'Restricted',assetId:'A1',version:2}];
 await f.request('save',{expectedVersion:0,payload:p});assert.deepEqual(f.calls.at(-1).p_input.sourceManifest,[{documentId:'D1',assetId:'A1',version:2}]);
 for(const mutate of [d=>d.category='Formation',d=>d.visibility='Internal',d=>d.companyId='c2',d=>d.orderId='order',d=>d.assetId='']){const previous=structuredClone(f.s.documents[0]);mutate(f.s.documents[0]);await assert.rejects(()=>f.request('save',{expectedVersion:1,payload:p}),e=>e.status===403);f.s.documents[0]=previous;}
});
