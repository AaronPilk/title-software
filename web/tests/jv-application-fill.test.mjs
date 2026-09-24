import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{resolveDir:process.cwd(),contents:`export {applyJVApplicationFill} from './lib/title/jv-application-fill';export {newJVApplication,newJVApplicant} from './lib/title/jv-application';`},bundle:true,write:false,platform:'node',format:'esm'});
const {applyJVApplicationFill,newJVApplication,newJVApplicant}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
function fixture(){const app=newJVApplication();app.applicants=[{...newJVApplicant('existing-a'),name:'Original Fictional Applicant',email:'retained@example.test',residenceHistory:[{id:'r-old',address:'Old Fictional Address',from:'2020-01-01',to:''}],employmentHistory:[{id:'e-old',employer:'Retained Fictional Employer',role:'Analyst',address:'',from:'2020-01-01',to:''}]},{...newJVApplicant('existing-b'),name:'Untouched Fictional Applicant'}];app.notes='Keep these internal notes';app.logoPreferences='Keep this logo preference';app.sourceDocumentIds=['old-source'];app.steps[0]={...app.steps[0],status:'Complete',reference:'Fictional approved reference'};return app;}
const entry=(sourceApplicantKey,patch,targetApplicantId)=>({sourceApplicantKey,label:sourceApplicantKey,patch,...(targetApplicantId?{targetApplicantId}:{})});
test('reviewed packet maps one applicant and creates another without changing unselected answers',()=>{
 const current=fixture(),before=structuredClone(current);
 const updated=applyJVApplicationFill(current,{applicants:[entry('source-a',{name:'Reviewed Fictional Applicant'},'existing-a'),entry('source-b',{name:'New Fictional Applicant',ownershipType:'individual'})],logoPreferences:'Reviewed navy wordmark'},'returned-original');
 assert.equal(updated.applicants.length,3);assert.equal(updated.applicants[0].id,'existing-a');assert.equal(updated.applicants[0].name,'Reviewed Fictional Applicant');assert.equal(updated.applicants[0].email,'retained@example.test');assert.deepEqual(updated.applicants[1],before.applicants[1]);assert.equal(updated.applicants[2].name,'New Fictional Applicant');assert.equal(updated.applicants[2].email,'');assert.equal(updated.applicants[2].ownershipType,'individual');assert.notEqual(updated.applicants[2].id,'existing-a');assert.notEqual(updated.applicants[2].id,'existing-b');assert.equal(updated.notes,before.notes);assert.equal(updated.logoPreferences,'Reviewed navy wordmark');assert.deepEqual(current,before);
});
test('selected history replacement preserves unselected history, 17 setup steps, notes and original sources',()=>{
 const current=fixture(),before=structuredClone(current),rows=[{id:'r-new',address:'Reviewed Fictional Address',from:'2021-01-01',to:''}];
 const updated=applyJVApplicationFill(current,{applicants:[entry('source-a',{residenceHistory:rows},'existing-a')]},'old-source');
 assert.deepEqual(updated.applicants[0].residenceHistory,rows);assert.deepEqual(updated.applicants[0].employmentHistory,before.applicants[0].employmentHistory);assert.equal(updated.steps.length,17);assert.deepEqual(updated.steps,before.steps);assert.deepEqual(updated.sourceDocumentIds,['old-source']);assert.equal(updated.notes,before.notes);assert.equal(updated.logoPreferences,before.logoPreferences);assert.deepEqual(current,before);
 rows[0].address='Modified candidate';assert.equal(updated.applicants[0].residenceHistory[0].address,'Reviewed Fictional Address');updated.applicants[0].employmentHistory[0].employer='Modified result';assert.deepEqual(current,before);
});
test('application-only reviewed fields do not create people or clear other fields',()=>{
 const current=fixture();const updated=applyJVApplicationFill(current,{applicants:[],notes:'Reviewed returned note'},'new-source');assert.equal(updated.applicants.length,2);assert.deepEqual(updated.applicants,current.applicants);assert.equal(updated.logoPreferences,current.logoPreferences);assert.equal(updated.notes,'Reviewed returned note');assert.deepEqual(updated.sourceDocumentIds,['old-source','new-source']);
});
test('missing target, reused target and duplicated source reject atomically',()=>{
 for(const applicants of [[entry('source-a',{name:'Never applied'},'missing-person')],[entry('source-a',{name:'Never applied'},'existing-a'),entry('source-b',{email:'new@example.test'},'existing-a')],[entry('source-a',{name:'Never applied'},'existing-a'),entry('source-a',{name:'Never created'})]]){
  const current=fixture(),before=structuredClone(current);assert.throws(()=>applyJVApplicationFill(current,{applicants},'new-source'));assert.deepEqual(current,before);
 }
});
test('maximum applicant count accepts 20 and rejects 21 without mutating the draft',()=>{
 const current=fixture();current.applicants=Array.from({length:19},(_,i)=>newJVApplicant(`person-${i}`));const twenty=applyJVApplicationFill(current,{applicants:[entry('source-a',{name:'Twentieth Fictional Person'})]},'new-source');assert.equal(twenty.applicants.length,20);const before=structuredClone(twenty);assert.throws(()=>applyJVApplicationFill(twenty,{applicants:[entry('source-b',{name:'Twenty First Fictional Person'})]},'another-source'));assert.deepEqual(twenty,before);
});
test('candidate IDs cannot replace stable applicant IDs and invalid private fields are rejected',()=>{
 const current=fixture();assert.equal(applyJVApplicationFill(current,{applicants:[entry('source-a',{id:'forged-id',name:'Reviewed Fictional Name'},'existing-a')]},'new-source').applicants[0].id,'existing-a');
 for(const patch of [{ssn:'123-4O-6789'},{dob:'1980-02-30'},{residenceHistory:[{id:'bad',address:'Fictional',from:'2025-02-01',to:'2024-01-01'}]},{unexpectedField:'private'}])assert.throws(()=>applyJVApplicationFill(current,{applicants:[entry('source-a',patch,'existing-a')]},'new-source'));
 assert.throws(()=>applyJVApplicationFill(current,{applicants:[]},'invalid source id with spaces'));
});
