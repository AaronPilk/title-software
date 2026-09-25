// Standalone regression suite: real private editor and worksheet renderer; fictional transport only.
// Run: node --test tests/company-records-ui.test.mjs
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(`${web}/package.json`);
const { build } = require('esbuild'), { chromium } = require('playwright');
let server, browser, context, page, origin;
let errors = [];

before(async () => {
  const result = await build({
    absWorkingDir: web, nodePaths: [`${web}/node_modules`], write: false, bundle: true,
    platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent',
    loader: { '.css': 'empty', '.module.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: web, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {CompanyRecordsPanel} from './components/title/company-records';
      import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();const c=s.companies.find(c=>c.id===s.currentCompanyId);return c?<CompanyRecordsPanel company={c}/>:<p>No company</p>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: 'private-company-fixture', setup(b) {
      b.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: 'store', namespace: 'fixture' }));
      b.onLoad({ filter: /^store$/, namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';
        const query=new URLSearchParams(location.search),listeners=new Set();
        const members=[{id:'member-a',name:'Legacy Alder Member',share:60,email:'ledger-a@example.test',phone:'7045550111'},{id:'member-b',name:'Legacy Birch Member',share:40,email:'ledger-b@example.test',phone:'7045550222'}];
        if(query.has('legacy'))members.forEach(m=>delete m.id);
        const company={id:'company-one',name:'Fictional Title One',jurisdiction:'NC',operatingStates:['NC','SC'],members};
        const base={companyId:company.id,version:1,date:'2026-09-25',size:'1 KB',visibility:'Restricted',assetId:'fictional-asset',mime:'application/pdf'};
        let snapshot={s:{currentCompanyId:company.id,companies:[company,{...company,id:'company-two',name:'Fictional Title Two',members:[{id:'member-c',name:'Other Member',share:100}]}],orders:[],documents:[
          {...base,id:'application-source',name:'Original application.pdf',category:'Applications'},
          {...base,id:'formation-a',name:'Alder formation.pdf',category:'Formation'},
          {...base,id:'form-one',name:'Official worksheet form.pdf',category:query.has('reclassified')?'Formation':'Applications'},
          {...base,id:'internal-original',name:'Hidden internal.pdf',category:'Applications',visibility:'Internal'},
          {...base,id:'other-company-original',name:'Hidden other company.pdf',category:'Applications',companyId:'company-two'},
          {...base,id:'order-original',name:'Hidden title file.pdf',category:'Applications',orderId:'order-one'},
          {...base,id:'missing-asset',name:'Hidden missing asset.pdf',category:'Applications',assetId:undefined}
        ]},connection:query.has('local')?undefined:{workspaceId:'workspace-one',access:{userId:'staff-one',email:'owner@example.test',version:1,role:query.get('role')||'owner',restricted:!query.has('unrestricted'),allCompanies:!query.has('outofscope'),companyIds:[]}}};
        const emit=()=>listeners.forEach(fn=>fn());
        window.fixtureWorkspace=()=>structuredClone(snapshot);
        window.fixtureWorkspaceWrites=[];window.fixtureDownloads=[];
        window.fixtureChangeContext=patch=>{snapshot={...snapshot,connection:{...snapshot.connection,...patch,access:{...snapshot.connection?.access,...patch.access}}};emit();};
        window.fixtureSwitchCompany=id=>{snapshot={...snapshot,s:{...snapshot.s,currentCompanyId:id}};emit();};
        window.fixtureRemoveMember=id=>{snapshot={...snapshot,s:{...snapshot.s,companies:snapshot.s.companies.map(c=>c.id==='company-one'?{...c,members:c.members.filter(m=>m.id!==id).map(m=>({...m,share:100}))}:c)}};emit();};
        export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(fn,title,detail)=>{
          const next=structuredClone(snapshot.s);fn(next);window.fixtureWorkspaceWrites.push({title,detail,before:structuredClone(snapshot.s),after:structuredClone(next)});
          snapshot={...snapshot,s:next};emit();return true;
        }};}
        export function useOptionalWorkspace(){return useWorkspace();}
        export async function getAssetForDocument(){throw Error('No source downloads expected in this fixture');}
        export function download(name,content,type){window.fixtureDownloads.push({name,content,type});}
      ` }));
      b.onResolve({ filter: /^@\/lib\/backend\/jv-intake-client$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      b.onLoad({ filter: /^api$/, namespace: 'fixture' }, () => ({ loader: 'ts', resolveDir: web, contents: `
        import {newJVApplication,newJVApplicant,validateJVApplication,jvIntakeFingerprint} from '@/lib/title/jv-application';
        const query=new URLSearchParams(location.search),payload=newJVApplication();
        payload.applicants=[
          {...newJVApplicant('app-business'),name:'Casey Business',email:'casey@example.test',phone:'7045550333',ownershipType:'business',businessName:'Cedar Owner LLC',businessStatus:'existing',businessReference:'CEDAR-FILING'},
          {...newJVApplicant('app-individual'),name:'Drew Individual',email:'drew@example.test',phone:'7045550444',ownershipType:'individual'},
          {...newJVApplicant('app-unknown'),name:'Emery Unknown',email:'emery@example.test',phone:'7045550555',ownershipType:'undecided'}
        ];
        payload.notes='KEEP PRIVATE APPLICATION NOTE';payload.logoPreferences='Keep existing branding';payload.sourceDocumentIds=['application-source'];payload.steps[0].status='In progress';payload.steps[0].reference='KEEP STEP REFERENCE';
        const owner=(id,memberId,legalName,ein,reps)=>({id,memberId,kind:'llc',legalName,ein,representatives:reps,formationStatus:'Formed',formationBy:'Agency',formationState:'NC',formationReference:id+'-FILING',documentIds:id==='owner-a'?['formation-a']:[]});
        if(!query.has('empty'))payload.companyRecords={companyEin:'987654321',owners:[
          owner('owner-a','member-a','Alder Owner LLC','111111111',[{id:'rep-a1',name:'Alex One',email:'alex1@example.test',phone:'7045551001'},{id:'rep-a2',name:'Alex Two',email:'alex2@example.test',phone:'7045551002'}]),
          owner('owner-b','member-b','Birch Owner LLC','222222222',[{id:'rep-b1',name:'Blair One',email:'blair1@example.test',phone:'7045552001'},{id:'rep-b2',name:'Blair Two',email:'blair2@example.test',phone:'7045552002'}])
        ],agreements:[{id:'agreement-one',title:'Fictional agreement',effectiveOn:'2026-09-01',reference:'A-1',documentIds:[],terms:[{memberId:'member-b',label:'Recorded distribution term',percentage:'25'}],notes:'Keep agreement notes'}],worksheets:[{
          id:'worksheet-one',title:'Fictional <script>form</script>',version:'2026.1',documentId:'form-one',fields:[
            {id:'f-company',label:'Company',source:'company.name'},{id:'f-company-ein',label:'Company EIN',source:'company.ein'},
            {id:'f-owner',label:'Owner <img src=x>',source:'owner.name'},{id:'f-owner-ein',label:'Owner EIN',source:'owner.ein'},
            {id:'f-share',label:'Current ownership percentage',source:'owner.share'},
            {id:'f-contact',label:'Representative',source:'contact.name'},{id:'f-email',label:'Representative email',source:'contact.email'},
            {id:'f-phone',label:'Representative phone',source:'contact.phone'}
          ]
        }]};
        const makeRecord=(companyId,p)=>({companyId,version:1,payload:p,status:'Draft',reviewNote:'',updatedAt:null,updatedBy:null,reviewedAt:null,reviewedBy:null});
        const saved=new Map([['company-one',makeRecord('company-one',payload)],['company-two',makeRecord('company-two',newJVApplication())]]);
        window.fixtureRequests=[];window.fixturePending=[];
        window.fixtureReadRecord=(id='company-one')=>structuredClone(saved.get(id));
        export async function jvIntakeClientRequest(context,action,input={}){
          window.fixtureRequests.push({context:structuredClone(context),action,input:structuredClone(input)});
          const prior=structuredClone(saved.get(context.companyId));
          if(window.fixtureHold===action){window.fixtureHold='';await new Promise(resolve=>window.fixturePending.push(resolve));}
          if(window.fixtureFail?.action===action){const status=window.fixtureFail.status;window.fixtureFail=null;throw Object.assign(Error('DO NOT DISPLAY PRIVATE SERVER DETAILS'),{status});}
          if(action==='load')return prior;
          if(input.expectedVersion!==saved.get(context.companyId).version)throw Object.assign(Error('conflict'),{status:409});
          const nextPayload=validateJVApplication(input.payload),changed=jvIntakeFingerprint(nextPayload)!==jvIntakeFingerprint(prior.payload);
          const members=window.fixtureWorkspace().s.companies.find(c=>c.id===context.companyId).members;
          const memberIds=[...(nextPayload.companyRecords?.owners.map(o=>o.memberId)||[]),...(nextPayload.companyRecords?.agreements.flatMap(a=>a.terms.map(t=>t.memberId))||[])];
          if(memberIds.some(id=>!members.some(m=>m.id===id)))throw Object.assign(Error('Member link changed'),{status:409});
          const next={...prior,version:prior.version+1,payload:nextPayload,status:changed?'Draft':prior.status};saved.set(context.companyId,next);return structuredClone(next);
        }
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/app.mjs' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.mjs' ? result.outputFiles[0].contents : '<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.mjs"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
});

afterEach(async () => { await context?.close(); context = undefined; assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(query = '') {
  if (context) { await context.close(); assert.deepEqual(errors, []); }
  errors = []; context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (errors.push('Unexpected external request'), route.abort()));
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/?${query}`); await page.waitForFunction(() => !!window.fixtureRequests);
}
async function records(query = '') { await open(query); await page.getByRole('button', { name: 'Open owner details', exact: true }).click(); await page.getByLabel('Title company EIN', { exact: true }).waitFor(); }
const ownerSection = index => page.locator('form fieldset > section').nth(index);
// FieldLabel wraps native select text as well as its caption; exact accessible-name matching would include option labels.
const select = (caption, scope = page) => scope.getByLabel(caption, { exact: false });
async function save() { await page.getByRole('button', { name: 'Save owner & company records', exact: true }).click(); await page.getByText('Owner and company records saved.', { exact: true }).waitFor(); return page.evaluate(() => window.fixtureReadRecord()); }
async function copyApplicant(applicantId) { page.once('dialog', d => d.accept()); await select('Use saved application details', ownerSection(0)).selectOption(applicantId); }
async function worksheet() { await page.getByText('Application preparation for John', { exact: true }).click(); }

test('private records open only on demand and local/unauthorized roles collect no private input', async () => {
  await open(); assert.deepEqual(await page.evaluate(() => window.fixtureRequests), []); assert.equal(await page.locator('input').count(), 0);
  for (const query of ['local=1', 'role=operations', 'role=finance', 'role=partner', 'unrestricted=1', 'outofscope=1']) {
    await open(query); assert.equal(await page.getByRole('button', { name: 'Open owner details', exact: true }).count(), 0);
    assert.equal(await page.locator('input').count(), 0); assert.deepEqual(await page.evaluate(() => window.fixtureRequests), []);
  }
});

test('company and owner EINs save without documents, reload masked, and preserve all application data', async () => {
  await records('empty=1'); const before = await page.evaluate(() => ({ record: window.fixtureReadRecord(), state: window.fixtureWorkspace().s }));
  await page.getByLabel('Title company EIN', { exact: true }).fill('98-7654321');
  await ownerSection(0).getByRole('button', { name: 'Add owner details', exact: true }).click();
  await select('Who owns this interest?', ownerSection(0)).selectOption('llc');
  await ownerSection(0).getByLabel('Legal owner name', { exact: true }).fill('Fictional Newly Formed LLC');
  await ownerSection(0).getByLabel('Owner LLC / entity EIN', { exact: true }).fill('12-3456789');
  await ownerSection(0).getByLabel('Representative 1 name', { exact: true }).fill('Fictional Representative');
  const saved = await save();
  assert.equal(saved.payload.companyRecords.companyEin, '987654321'); assert.equal(saved.payload.companyRecords.owners[0].ein, '123456789');
  assert.deepEqual(saved.payload.companyRecords.owners[0].documentIds, []);
  const legacy = structuredClone(saved.payload); delete legacy.companyRecords; assert.deepEqual(legacy, before.record.payload);
  assert.deepEqual(await page.evaluate(() => window.fixtureWorkspace().s), before.state); assert.deepEqual(await page.evaluate(() => window.fixtureWorkspaceWrites), []);
  const call = await page.evaluate(() => window.fixtureRequests.at(-1)); assert.equal(call.input.expectedVersion, 1); assert.deepEqual(call.context, { workspaceId: 'workspace-one', userId: 'staff-one', companyId: 'company-one' });
  await page.getByRole('button', { name: 'Reload saved records', exact: true }).click();
  assert.equal(await page.getByLabel('Title company EIN', { exact: true }).inputValue(), '987654321');
  assert.equal(await ownerSection(0).getByLabel('Owner LLC / entity EIN', { exact: true }).inputValue(), '123456789');
  assert.equal(await page.getByLabel('Title company EIN', { exact: true }).getAttribute('type'), 'password');
  assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
});

test('legacy members gain stable IDs once without changing names, shares, or contacts', async () => {
  await open('empty=1&legacy=1'); const before = await page.evaluate(() => window.fixtureWorkspace().s.companies[0].members);
  await page.getByRole('button', { name: 'Open owner details', exact: true }).click(); await page.getByLabel('Title company EIN', { exact: true }).waitFor();
  const after = await page.evaluate(() => window.fixtureWorkspace().s.companies[0].members);
  assert.ok(after.every(m => typeof m.id === 'string' && m.id)); assert.equal(new Set(after.map(m => m.id)).size, after.length);
  assert.deepEqual(after.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"))), before); assert.equal(await page.evaluate(() => window.fixtureWorkspaceWrites.length), 1);
  await page.getByRole('button', { name: 'Reload saved records', exact: true }).click(); await page.waitForFunction(() => window.fixtureRequests.length === 2);
  assert.equal(await page.evaluate(() => window.fixtureWorkspaceWrites.length), 1);
});

test('copying a different business applicant clears the prior entity EIN, documents and formation state', async () => {
  await records(); const before = await page.evaluate(() => window.fixtureWorkspace().s.companies[0].members);
  await copyApplicant('app-business'); const saved = await save(), owner = saved.payload.companyRecords.owners[0];
  assert.equal(owner.kind, 'llc'); assert.equal(owner.legalName, 'Cedar Owner LLC'); assert.equal(owner.ein, ''); assert.deepEqual(owner.documentIds, []);
  assert.equal(owner.formationState, ''); assert.equal(owner.formationBy, 'Not confirmed'); assert.equal(owner.formationReference, 'CEDAR-FILING'); assert.equal(owner.formationStatus, 'Formed');
  assert.deepEqual(owner.representatives.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"))), [{ name: 'Casey Business', email: 'casey@example.test', phone: '7045550333' }]);
  assert.deepEqual(await page.evaluate(() => window.fixtureWorkspace().s.companies[0].members), before);
});

test('name corrections retain entity evidence while explicit replacement clears it and preserves the member ledger', async () => {
  await records(); const before = await page.evaluate(() => window.fixtureWorkspace().s);
  await ownerSection(0).getByLabel('Legal owner name', { exact: true }).fill('Alder Owner, LLC');
  const corrected = (await save()).payload.companyRecords.owners[0];
  assert.equal(corrected.ein, '111111111'); assert.deepEqual(corrected.documentIds, ['formation-a']);
  assert.equal(corrected.formationReference, 'owner-a-FILING'); assert.equal(corrected.representatives.length, 2);
  page.once('dialog', d => d.dismiss());
  await ownerSection(0).getByRole('button', { name: 'Use a different legal owner', exact: true }).click();
  assert.equal(await ownerSection(0).getByLabel('Legal owner name', { exact: true }).inputValue(), 'Alder Owner, LLC');
  page.once('dialog', d => d.accept());
  await ownerSection(0).getByRole('button', { name: 'Use a different legal owner', exact: true }).click();
  assert.equal(await ownerSection(0).getByLabel('Legal owner name', { exact: true }).inputValue(), '');
  await ownerSection(0).getByLabel('Legal owner name', { exact: true }).fill('Replacement Fictional LLC');
  const replacement = (await save()).payload.companyRecords.owners[0];
  assert.equal(replacement.ein, ''); assert.equal(replacement.formationReference, ''); assert.equal(replacement.formationState, '');
  assert.equal(replacement.formationStatus, 'Unknown'); assert.equal(replacement.formationBy, 'Not confirmed');
  assert.deepEqual(replacement.documentIds, []); assert.deepEqual(replacement.representatives, []);
  assert.deepEqual(await page.evaluate(() => window.fixtureWorkspace().s), before);
});

test('copying an individual applicant clears LLC-only data and changes the legal owner type', async () => {
  await records(); await copyApplicant('app-individual'); const owner = (await save()).payload.companyRecords.owners[0];
  assert.equal(owner.kind, 'individual'); assert.equal(owner.legalName, 'Drew Individual'); assert.equal(owner.ein, ''); assert.deepEqual(owner.documentIds, []);
  assert.equal(owner.formationState, ''); assert.equal(owner.formationReference, ''); assert.equal(owner.formationBy, 'Not confirmed'); assert.equal(owner.formationStatus, 'Not applicable');
  assert.equal(await ownerSection(0).getByLabel('Owner LLC / entity EIN', { exact: true }).count(), 0);
});

test('an applicant with unknown ownership copies only representative details, preserving recorded entity facts', async () => {
  await records(); const before = await page.evaluate(() => window.fixtureReadRecord().payload.companyRecords.owners[0]);
  await copyApplicant('app-unknown'); const owner = (await save()).payload.companyRecords.owners[0];
  const { representatives: oldReps, ...oldEntity } = before, { representatives: newReps, ...newEntity } = owner;
  assert.ok(oldReps.length); assert.deepEqual(newEntity, oldEntity); assert.deepEqual(newReps.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"))), [{ name: 'Emery Unknown', email: 'emery@example.test', phone: '7045550555' }]);
});

test('denied reload clears already loaded private inputs and suppresses server details', async () => {
  for (const status of [401, 403]) {
    await records(); await page.evaluate(status => window.fixtureFail = { action: 'load', status }, status);
    await page.getByRole('button', { name: 'Reload saved records', exact: true }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('input').count(), 0); assert.equal(await page.getByRole('button', { name: 'Download preparation draft', exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /Alder Owner LLC|Birch Owner LLC|PRIVATE SERVER DETAILS/);
  }
});

test('scope changes destroy drafts and ignore old in-flight private save results', async () => {
  const changes = [{ workspaceId: 'workspace-two' }, { access: { userId: 'staff-two' } }, { access: { version: 2 } }, { company: 'company-two' }];
  for (const change of changes) {
    await records(); await page.getByLabel('Title company EIN', { exact: true }).fill('876543219'); await page.evaluate(() => window.fixtureHold = 'save');
    await page.getByRole('button', { name: 'Save owner & company records', exact: true }).click(); await page.waitForFunction(() => window.fixturePending.length === 1);
    await page.evaluate(change => change.company ? window.fixtureSwitchCompany(change.company) : window.fixtureChangeContext(change), change);
    await page.getByRole('button', { name: 'Open owner details', exact: true }).waitFor(); await page.evaluate(() => window.fixturePending.shift()());
    await page.waitForTimeout(30); assert.equal(await page.locator('input').count(), 0); assert.doesNotMatch(await page.locator('body').innerText(), /Alder Owner LLC|Birch Owner LLC|876543219/);
  }
});

test('access withdrawal unmounts private records and denies further controls', async () => {
  await records(); await page.evaluate(() => window.fixtureChangeContext({ access: { restricted: false, version: 2 } }));
  await page.getByLabel('Title company EIN', { exact: true }).waitFor({ state: 'detached' }); assert.equal(await page.getByRole('button', { name: 'Open owner details', exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /Alder Owner LLC|Birch Owner LLC/);
});

test('worksheet selection uses only the chosen owner and representative, escapes markup, and preserves accounting shares', async () => {
  await records(); await worksheet(); const download = page.getByRole('button', { name: 'Download preparation draft', exact: true });
  assert.equal(await download.isDisabled(), true); await select('Prepare for owner').selectOption('owner-b');
  assert.deepEqual(await select('Prepare for representative').locator('option').allTextContents(), ['Choose representative…', 'Blair One', 'Blair Two']);
  await select('Prepare for representative').selectOption('rep-b2'); await download.click();
  const exported = await page.evaluate(() => window.fixtureDownloads[0]); assert.equal(exported.type, 'text/html'); assert.equal(exported.name, 'application-preparation.html');
  for (const value of ['Birch Owner LLC', '222222222', '987654321', 'Blair Two', 'blair2@example.test', '7045552002', '>40</td>']) assert.ok(exported.content.includes(value), value);
  assert.doesNotMatch(exported.content, /111111111|Alex One|Alex Two|Blair One|KEEP PRIVATE APPLICATION NOTE|Recorded distribution term|>25<|<script|<img/);
  assert.match(exported.content, /&lt;script&gt;form&lt;\/script&gt;/); assert.match(exported.content, /Owner &lt;img src=x&gt;/);
  assert.match(exported.content, /unsigned and is not an official completed form/);
  await select('Prepare for owner').selectOption('owner-a'); assert.equal(await select('Prepare for representative').inputValue(), ''); assert.equal(await download.isDisabled(), true);
  await select('Prepare for representative').selectOption('rep-a1'); await page.getByLabel('Title company EIN', { exact: true }).fill('876543219'); assert.equal(await download.isDisabled(), true);
  await save(); assert.equal(await download.isDisabled(), false); assert.deepEqual(await page.evaluate(() => window.fixtureWorkspaceWrites), []);
});

test('worksheet document choices exclude other companies, title files, internal files and missing assets', async () => {
  await records(); await worksheet(); const options = await select('Original form (optional)').locator('option').allTextContents();
  assert.ok(options.includes('Official worksheet form.pdf')); assert.ok(options.includes('Original application.pdf'));
  assert.equal(options.some(s => /Hidden|Alder formation/.test(s)), false);
});

test('a reclassified worksheet source is visibly unavailable and can be cleared before saving', async () => {
  await records('reclassified=1'); await worksheet(); const source = select('Original form (optional)');
  assert.match(await source.locator('option:checked').innerText(), /Unavailable original/);
  await source.selectOption(''); const saved = await save(); assert.equal(saved.payload.companyRecords.worksheets[0].documentId, '');
});

test('conflicts retain the draft, fence another save, and allow a confirmed reload', async () => {
  await records(); await page.getByLabel('Title company EIN', { exact: true }).fill('876543219');
  await page.evaluate(() => window.fixtureFail = { action: 'save', status: 409 }); await page.getByRole('button', { name: 'Save owner & company records', exact: true }).click();
  await page.getByRole('alert').waitFor(); assert.equal(await page.getByLabel('Title company EIN', { exact: true }).inputValue(), '876543219');
  assert.equal(await page.getByRole('button', { name: 'Save owner & company records', exact: true }).isDisabled(), true);
  page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Reload saved records', exact: true }).click(); assert.equal(await page.getByLabel('Title company EIN', { exact: true }).inputValue(), '876543219');
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Reload saved records', exact: true }).click(); await page.waitForFunction(() => document.querySelector('input[aria-label="Title company EIN"]')?.value === '987654321');
  assert.equal(await page.locator('fieldset').isDisabled(), false);
});

test('representative additions stop at the domain limit so an otherwise valid draft remains savable', async () => {
  await records(); const add = ownerSection(0).getByRole('button', { name: 'Add representative', exact: true });
  for (let i = 0; i < 8; i++) await add.click(); assert.equal(await add.isDisabled(), true);
  const saved = await save(); assert.equal(saved.payload.companyRecords.owners[0].representatives.length, 10);
});

test('former owners and stale agreement terms can be removed without deleting originals or blocking unrelated private changes', async () => {
  await records(); const before = await page.evaluate(() => window.fixtureReadRecord());
  const documents = await page.evaluate(() => window.fixtureWorkspace().s.documents);
  await page.evaluate(() => window.fixtureRemoveMember('member-b'));
  const remove = page.getByRole('button', { name: 'Remove former owner details', exact: true }); await remove.waitFor();
  assert.equal(await page.getByLabel('Relink owner record', { exact: true }).locator('option').count(), 1, 'remaining member already has owner records');
  page.once('dialog', d => d.dismiss()); await remove.click(); assert.equal(await remove.count(), 1);
  page.once('dialog', d => d.accept()); await remove.click(); assert.equal(await remove.count(), 0);
  await page.getByText('Agreements & financial terms', { exact: true }).click();
  assert.match(await page.getByLabel('Agreement member 1', { exact: true }).locator('option:checked').innerText(), /Member unavailable/);
  await page.getByRole('button', { name: 'Remove agreement term 1', exact: true }).click();
  await page.getByLabel('Title company EIN', { exact: true }).fill('876543219'); const saved = await save();
  assert.deepEqual(saved.payload.companyRecords.owners.map(o => o.id), ['owner-a']); assert.deepEqual(saved.payload.companyRecords.agreements[0].terms, []);
  assert.equal(saved.payload.companyRecords.companyEin, '876543219'); assert.deepEqual(saved.payload.applicants, before.payload.applicants);
  assert.deepEqual(await page.evaluate(() => window.fixtureWorkspace().s.documents), documents);
});

test('removing a selected representative cannot reuse a different person silently in worksheet export', async () => {
  await records(); await worksheet(); await select('Prepare for owner').selectOption('owner-b'); await select('Prepare for representative').selectOption('rep-b2');
  page.once('dialog', d => d.accept()); await ownerSection(1).getByRole('button', { name: 'Remove representative 2', exact: true }).click();
  await save(); const download = page.getByRole('button', { name: 'Download preparation draft', exact: true });
  if (!(await download.isDisabled())) { await download.click(); await page.getByRole('status').filter({ hasText: 'Choose a saved worksheet, owner and representative first.' }).waitFor(); }
  assert.deepEqual(await page.evaluate(() => window.fixtureDownloads), []);
  await select('Prepare for representative').selectOption('rep-b1'); await download.click(); const exported = await page.evaluate(() => window.fixtureDownloads[0].content);
  assert.match(exported, /Blair One/); assert.doesNotMatch(exported, /Blair Two|blair2@example.test/);
});
