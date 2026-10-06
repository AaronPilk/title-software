import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const built=await build({stdin:{contents:"export * from './lib/title/agency-setup';export * from './lib/title/agency-maintenance';export {emptyWorkspace,executeCommands,projectWorkspace} from './lib/backend/workspace';export {captureCommands} from './lib/title/command-log';export {businessDay} from './lib/title/business-date';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node'});
const L=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=newagency-backend-bundle.mjs').toString('base64')}`);
const staff=['owner','admin','onboarding','operations','finance','viewer','partner'].map((role,i)=>({role,userId:`00000000-0000-4000-8000-00000000000${i+1}`,email:`${role}@example.test`,allCompanies:true,companyIds:[]}));
const actor={...staff[0],restricted:true,version:1,partnerMembers:[],assignableStaff:staff,requireStaffAssignments:true};const scoped={...actor,role:'admin',allCompanies:false,companyIds:['c1']};
const cmd=(name,input)=>({id:crypto.randomUUID(),name,args:[input]});const exec=(state,name,input,access=actor)=>L.executeCommands(state,[cmd(name,input)],access);
function state(){const s=L.emptyWorkspace();s.companies=['c1','c2'].map(id=>({id,name:`Fictional ${id}`,initials:'FC',color:'blue',contact:'',email:'',location:'Charlotte',jurisdiction:'NC',stage:'Onboarding',steps:Array(7).fill(false),members:[]}));L.configureAgencySetup(s,{companyId:'c1',expectedVersion:0,templateVersion:1,owners:[],agreementCount:1,eoCovered:false});return s;}
const record=(companyId='c1',kind='Domain',id='maintenance-one')=>({id,revision:1,scope:companyId?'company':'agency',companyId,memberId:'',kind,title:'Fictional renewal',active:true,nextDueOn:L.businessDay(),intervalYears:1,schedule:'anniversary',source:'Fictional notice',verifiedOn:L.businessDay(),notes:'',owner:'',documentIds:[],standing:'Unknown'});
const taskInput=(task,overrides={})=>({taskId:task.id,expectedRevision:task.phaseOne.revision,status:'In Progress',due:'',completedOn:'',notes:'Working',documentIds:[],owner:'',...overrides});
const templateInput=()=>({expectedVersion:1,name:'Custom fixture template',items:L.defaultAgencySetupTemplate().items});
const settings={expected:{enabled:false,recipient:'',leadDays:14},enabled:true,recipient:'reminders@example.test'};
test('scoped admin cannot change templates, reminder settings, agency-wide records or global synchronization',()=>{const s=state();for(const [name,input] of [['saveAgencySetupTemplate',templateInput()],['saveAgencyMaintenanceNotifications',settings],['saveAgencyMaintenance',{expectedRevision:0,record:record('','Agency credential')}],['syncAgencyMaintenance',L.businessDay()]])assert.throws(()=>exec(s,name,input,scoped));});
test('operations, finance, viewer and partner cannot run any agency action',()=>{const s=state(),task=s.tasks.find(t=>!t.phaseOne.documentRequirement);const calls=[['configureAgencySetup',{companyId:'c1',expectedVersion:1,templateVersion:1,owners:[],agreementCount:1,eoCovered:false}],['syncAgencySetup','c1'],['saveAgencySetupTemplate',templateInput()],['updateAgencyTask',taskInput(task)],['activateAgencyCompany',{companyId:'c1',expectedVersion:1}],['saveAgencyMaintenance',{expectedRevision:0,record:record()}],['completeAgencyMaintenance',{maintenanceId:'missing',expectedRevision:1,cycleOn:L.businessDay(),completedOn:L.businessDay(),nextDueOn:'2028-10-06',notes:'',documentIds:[]}],['saveAgencyMaintenanceNotifications',settings],['syncAgencyMaintenance',L.businessDay()]];for(const role of ['operations','finance','viewer','partner'])for(const [name,input]of calls)assert.throws(()=>exec(s,name,input,{...actor,role}));});
test('scoped staff can create their first company maintenance record but never another company record',()=>{const s=state();assert.doesNotThrow(()=>exec(s,'saveAgencyMaintenance',{expectedRevision:0,record:record()},scoped));assert.throws(()=>exec(s,'saveAgencyMaintenance',{expectedRevision:0,record:record('c2')},scoped));});
test('raw task status, completion, requirement and phase metadata injections are rejected',()=>{const s=state(),task=s.tasks[0];for(const value of [{done:true},{completedOn:L.businessDay()},{status:'Complete'},{phaseOne:{...task.phaseOne,required:false}},{documentIds:[]}])assert.throws(()=>L.executeCommands(s,[cmd('editDraft',[{table:'tasks',id:task.id,value}])],actor));assert.throws(()=>L.executeCommands(s,[cmd('editDraft',[{table:'tasks',id:'injected',insert:true,value:{...task,id:'injected'}}])],actor));});
test('Agency assignments require active Agency staff with company access and server-derived owner labels',()=>{const s=state(),task=s.tasks.find(t=>!t.phaseOne.documentRequirement);for(const role of ['operations','finance','viewer','partner']){const member=staff.find(m=>m.role===role);assert.throws(()=>exec(s,'updateAgencyTask',taskInput(task,{assigneeId:member.userId,owner:'Forged name'})));assert.throws(()=>exec(s,'saveAgencyMaintenance',{expectedRevision:0,record:{...record(),assigneeId:member.userId,owner:'Forged'}}));}for(const role of ['owner','admin','onboarding']){const member=staff.find(m=>m.role===role),saved=exec(s,'updateAgencyTask',taskInput(task,{assigneeId:member.userId,owner:'Forged name'}));assert.equal(saved.tasks.find(t=>t.id===task.id).owner,member.email);}assert.throws(()=>exec(s,'updateAgencyTask',taskInput(task,{assigneeId:staff[2].userId,owner:'Name'}),{...actor,assignableStaff:staff.map(m=>m.role==='onboarding'?{...m,allCompanies:false,companyIds:['c2']}:m)}));});
test('projected maintenance, tasks and notifications retain company and restricted-document boundaries',()=>{const s=state();s.documents=[{id:'private-source',companyId:'c1',name:'private.pdf',category:'Company records',visibility:'Restricted',assetId:'asset',mime:'application/pdf',version:1,date:L.businessDay(),size:'1 KB'}];for(const r of [{...record(),documentIds:['private-source']},record('c2','Domain','foreign-maintenance'),record('','Agency credential','global-maintenance')])L.saveAgencyMaintenance(s,{expectedRevision:0,record:r});L.syncAgencyMaintenance(s);const visible=L.projectWorkspace(s,{...scoped,restricted:false});assert.deepEqual(visible.agencyMaintenance.records,[]);assert.equal(visible.agencyMaintenance.notifications,undefined);assert.equal(visible.tasks.some(t=>t.phaseOne?.maintenanceId),false);const production=L.projectWorkspace(s,{...actor,role:'operations'});assert.equal(production.agencyMaintenance,undefined);assert.equal(production.agencySetupTemplates,undefined);assert.equal(production.tasks.some(t=>t.phaseOne),false);});
test('hidden maintenance cannot be edited, completed or synchronized using guessed IDs or company scope',()=>{const s=state();s.documents=[{id:'private-source',companyId:'c1',name:'private.pdf',category:'Company records',visibility:'Restricted',assetId:'asset',mime:'application/pdf',version:1,date:L.businessDay(),size:'1 KB'}];L.saveAgencyMaintenance(s,{expectedRevision:0,record:{...record(),documentIds:['private-source']}});L.syncAgencyMaintenance(s);const access={...scoped,restricted:false};assert.throws(()=>exec(s,'saveAgencyMaintenance',{expectedRevision:1,record:{...record(),revision:2,documentIds:[]}},access));assert.throws(()=>exec(s,'completeAgencyMaintenance',{maintenanceId:'maintenance-one',expectedRevision:1,cycleOn:L.businessDay(),completedOn:L.businessDay(),notes:'Done',documentIds:[],nextDueOn:'2030-10-06'},access));assert.throws(()=>L.executeCommands(s,[{id:crypto.randomUUID(),name:'syncAgencyMaintenance',args:[L.businessDay(),'c1']}],access));});

test('partner projection strips internal setup configuration and other-owner choices',()=>{const s=state();s.companies[0].members=[{id:'m1',name:'Fixture Partner',share:50},{id:'m2',name:'Other Partner',share:50}];L.configureAgencySetup(s,{companyId:'c1',expectedVersion:1,templateVersion:1,owners:[{memberId:'m1',kind:'individual'},{memberId:'m2',kind:'existing'}],agreementCount:2,eoCovered:true});const visible=L.projectWorkspace(s,{...actor,role:'partner',allCompanies:false,companyIds:['c1'],partnerMembers:[{id:'grant',companyId:'c1',memberName:'Fixture Partner'}]});assert.equal(visible.companies.length,1);assert.equal(visible.companies[0].agencySetup,undefined);assert.equal(visible.agencySetupTemplates,undefined);assert.equal(visible.agencyMaintenance,undefined);assert.equal(visible.tasks.length,0);assert.doesNotMatch(JSON.stringify(visible),/m2|Other Partner/);});


const proposedOperatingConfirmation = {
  status: 'Active', confirmedBy: 'forged@example.test', confirmedAt: '2000-01-01T00:00:00.000Z',
  note: '  Existing operating company; company records are being collected.  ',
};
const newCompanyValue = (operatingStatus = proposedOperatingConfirmation) => ({
  name: 'Established Synthetic Title', initials: 'ST', color: 'blue', contact: '', email: '',
  location: 'Raleigh', jurisdiction: 'NC', operatingStates: ['NC', 'SC'], stage: 'Onboarding',
  steps: Array(7).fill(false), members: [], ...(operatingStatus === undefined ? {} : {operatingStatus}),
});
const insertCompany = (before, value, access = actor) => L.executeCommands(before, [cmd('editDraft', [
  {table: 'companies', id: 'existing-synthetic', insert: true, value},
])], access);

for (const role of ['owner', 'admin']) test(`${role} company insertion stamps existing operations with the authenticated actor and server time`, () => {
  const before = state(), copy = structuredClone(before), started = Date.now();
  const access = {...actor, ...staff.find(member => member.role === role)};
  const result = insertCompany(before, newCompanyValue(), access);
  const company = result.companies.find(row => row.id === 'existing-synthetic');
  assert.equal(company.operatingStatus.status, 'Active');
  assert.equal(company.operatingStatus.confirmedBy, access.email);
  assert.notEqual(company.operatingStatus.confirmedBy, proposedOperatingConfirmation.confirmedBy);
  assert.ok(Date.parse(company.operatingStatus.confirmedAt) >= started);
  assert.ok(Date.parse(company.operatingStatus.confirmedAt) <= Date.now());
  assert.equal(company.operatingStatus.note, proposedOperatingConfirmation.note.trim());
  assert.equal(company.stage, 'Onboarding');
  assert.deepEqual(company.steps, Array(7).fill(false));
  assert.deepEqual(company.operatingStates, ['NC', 'SC']);
  assert.equal(company.agencySetup, undefined);
  assert.deepEqual(result.tasks.filter(task => task.companyId === company.id), []);
  assert.deepEqual(before, copy, 'command replay must leave its input untouched');
});

for (const access of [
  {...actor, role: 'operations'}, {...actor, role: 'onboarding'},
  {...actor, role: 'admin', allCompanies: false, companyIds: ['c1']},
]) test(`${access.role} with all-company access ${access.allCompanies} cannot insert an existing-operation confirmation`, () => {
  const before = state(), copy = structuredClone(before);
  assert.throws(() => insertCompany(before, newCompanyValue(), access), error => error.status === 403);
  assert.deepEqual(before, copy);
});

test('company insertion rejects malformed existing-operation confirmations atomically', () => {
  for (const operatingStatus of [
    false, [], {}, {...proposedOperatingConfirmation, status: 'Licensed'},
    {...proposedOperatingConfirmation, note: ''}, {...proposedOperatingConfirmation, note: '   '},
    {...proposedOperatingConfirmation, note: 1}, {...proposedOperatingConfirmation, note: 'x'.repeat(1001)},
    {...proposedOperatingConfirmation, note: 'Bad\u0000note'}, {...proposedOperatingConfirmation, extra: true},
  ]) {
    const before = state(), copy = structuredClone(before);
    assert.throws(() => insertCompany(before, newCompanyValue(operatingStatus)), error => error.status === 400);
    assert.deepEqual(before, copy);
  }
});

test('onboarding staff can still create a new venture and its applicable setup checklist', () => {
  const before = state(), draft = structuredClone(before), value = newCompanyValue(null);
  delete value.operatingStatus;
  const commands = L.captureCommands(draft, workspace => {
    workspace.companies.unshift({id: 'new-synthetic', ...value});
    L.configureAgencySetup(workspace, {companyId: 'new-synthetic', expectedVersion: 0, templateVersion: 1, owners: [], agreementCount: 1, eoCovered: false});
  });
  const result = L.executeCommands(before, commands, {...actor, ...staff.find(member => member.role === 'onboarding')});
  const company = result.companies.find(row => row.id === 'new-synthetic');
  assert.equal(company.operatingStatus, undefined);
  assert.equal(company.stage, 'Onboarding');
  assert.ok(company.agencySetup);
  const tasks = result.tasks.filter(task => task.companyId === company.id);
  assert.ok(tasks.length > 1);
  assert.ok(tasks.every(task => task.phaseOne?.kind === 'setup' && task.phaseOne.applicable));
});
