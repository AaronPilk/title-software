import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built=await build({stdin:{contents:"export * from './lib/backend/workspace'; export * from './lib/title/company-intake';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm'});
const {emptyWorkspace,executeCommands,buildCompanyFromCandidate}=await import(`data:text/javascript;base64,${Buffer.from(Buffer.concat([built.outputFiles[0].contents,Buffer.from('\n//# sourceURL=company-intake-backend-fixture.mjs')])).toString('base64')}`);
const actor={userId:crypto.randomUUID(),email:'owner@example.test',role:'owner',allCompanies:true,companyIds:[],restricted:true,version:1,partnerMembers:[]};
const draft=()=>buildCompanyFromCandidate({organizationId:'org',organizationName:'Fictional group',teamId:'team',teamName:'Fictional Cedar Title'},{id:'cedar',importedAt:'2026-09-23T21:00:00.000Z',importedBy:actor.email});
const edit=(value,insert=false,id='cedar')=>[{id:crypto.randomUUID(),name:'editDraft',args:[[{table:'companies',id,value,insert}]]}];
const apply=(state,value,insert=false,access=actor,id='cedar')=>executeCommands(state,edit(value,insert,id),access);
test('only organization administrators can import an incomplete company; normal creation still needs facts',()=>{
  const blank=emptyWorkspace(),c=draft();
  const result=apply(blank,c,true);assert.equal(result.companies[0].jurisdiction,'');assert.equal(result.companies[0].intake.teamId,'team');
  for(const access of [{...actor,role:'operations'},{...actor,role:'onboarding'},{...actor,role:'admin',allCompanies:false}])assert.throws(()=>apply(blank,c,true,access));
  const {intake,...regular}=c;assert.throws(()=>apply(blank,regular,true),/contact/);
  assert.throws(()=>apply(blank,{...c,intake:{...intake,importedBy:'other@example.test'}},true),/intake/);
});
test('duplicate provider identity is denied and company scopes do not change',()=>{
  const state=apply(emptyWorkspace(),draft(),true);
  assert.throws(()=>apply(state,{...draft(),id:'second'},true,actor,'second'),/already has/);
  assert.deepEqual(actor.companyIds,[]);assert.deepEqual(state.companies[0].members,[]);
});
test('partial profile persists; completion requires confirmed basics; provenance remains immutable',()=>{
  const c=draft(),state=apply(emptyWorkspace(),c,true);
  const partial=apply(state,{contact:'Fictional Contact',email:'',intake:c.intake});
  assert.equal(partial.companies[0].contact,'Fictional Contact');
  assert.throws(()=>apply(partial,{intake:{...c.intake,profileStatus:'complete',nameUnverified:false}}),/Complete/);
  assert.throws(()=>apply(partial,{intake:{...c.intake,teamId:'other'}}),/provenance/);
  const completed=apply(partial,{name:'Fictional Cedar Title LLC',contact:'Fictional Contact',email:'contact@example.test',location:'Charlotte',jurisdiction:'NC',operatingStates:['NC'],intake:{...c.intake,profileStatus:'complete',nameUnverified:false}});
  assert.equal(completed.companies[0].intake.profileStatus,'complete');assert.equal(completed.companies[0].steps.some(Boolean),false);
  assert.throws(()=>apply(completed,{jurisdiction:'SC'}),/operating state/);
  assert.throws(()=>apply(completed,{name:'Changed without review'}),/Review/);
});
