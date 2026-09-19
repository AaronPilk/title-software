// Real daily-use components, date helpers and assignment hook. All records and transport are synthetic.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let browser, server, context, page, origin;
let errors = [];
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
before(async () => {
  const bundle = await build({ absWorkingDir: web, outfile: "daily-use-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {Tasks,InboxView,Automations} from './components/title/operations';
      import {Orders,NewOrder,OrderDetail} from './components/title/policies';
      import {Financials} from './components/title/financials'; import {CloseWorkspace} from './components/title/close-suite';
      import {OnboardingHub} from './components/title/onboarding-suite';
      import {Assistant} from './components/title/assistant';
      import {useWorkspace} from '@/lib/title/store'; import {executeRules} from './lib/title/engine';
      function App(){ const {s}=useWorkspace(); const q=new URLSearchParams(location.search); const [open,setOpen]=useState(q.has('dialog'));
        window.runRules=()=>{executeRules(s,['onboarding','exceptions']);return structuredClone(s.tasks);};
        window.runRenewals=()=>{s.rules.push({id:'renewals',enabled:true,runs:0,lastRun:'Never'});s.business.credentials=[{id:'at-cutoff',companyId:s.companies[0].id,state:'NC',kind:'Agency license',reviewer:'operator@example.test',expiresOn:'2027-03-02',reviewOn:''},{id:'after-cutoff',companyId:s.companies[0].id,state:'NC',kind:'Agency license',reviewer:'operator@example.test',expiresOn:'2027-03-03',reviewOn:''}];executeRules(s,['renewals']);return structuredClone(s.tasks);};
        const view=q.get('view');
        return <>{view==='assistant'?<Assistant navigate={()=>{}}/>:view==='tasks'?<Tasks/>:view==='inbox'?<InboxView onReview={()=>{}} onRevision={()=>{}} onCommitment={()=>{}}/>:view==='onboarding'?<OnboardingHub onOpen={()=>{}} onNew={()=>{}}/>:view==='financials'?<Financials/>:view==='close'?<CloseWorkspace/>:view==='automation'?<Automations/>:view==='detail'?<OrderDetail id={s.orders[0].id} onClose={()=>{}} onReview={()=>{}}/>:<><Orders onOpen={()=>{}} onNew={()=>setOpen(true)}/><NewOrder open={open} onClose={()=>setOpen(false)}/></>}
        <span id="fixture-ready"/></>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "synthetic-daily-workspace", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/assistant\/client$/ }, () => ({ path: "assistant", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: web, contents: args.path === "assistant" ? `
        export class AssistantClientError extends Error {status=500;}
        export async function assistantRequest(input){(window.dailyAssistantCalls ||= []).push(input);return {remaining:30,context:{companyName:'Fictional company',revision:1,sources:[]},threads:[{id:'thread-one',title:'Fictional review',turns:[{id:'turn-one',revision:1,createdAt:'2027-01-01T12:00:00Z',question:'What needs attention?',forks:[{id:'fork-one',status:'Complete',specialist:'Coordinator',result:{summary:'Fictional review complete',nextStep:'Review fictional formation evidence',findings:[]}}]}]}]};}
      ` : args.path === "client" ? `
        export const activeWorkspace=()=> 'synthetic-workspace';
        export async function backendRequest(path,data){
          if(path!=='/staff/assignable')throw Error('Unexpected synthetic API '+path);
          (window.dailyDirectoryCalls ||= []).push({path,data});
          const q=new URLSearchParams(location.search); if(q.has('stafferror'))throw Error('Synthetic staff unavailable');
          if(q.has('staffrecover')&&!window.dailyDirectoryRecovered)throw Error('Synthetic staff unavailable');
          if(q.has('staffdefer'))await new Promise(resolve=>(window.dailyDirectoryPending ||= []).push(resolve));
          return {unavailable:0,staff:q.has('nostaff')||(q.has('newstaff')&&!window.dailyDirectoryRecovered)?[]:[{userId:'${userId}',email:'operator@example.test',label:'operator@example.test'},{userId:'${otherId}',email:'reviewer@example.test',label:'reviewer@example.test'}]};
        }
      ` : `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';
        const q=new URLSearchParams(location.search),listeners=new Set();const state=createSeed(); state.user='operator@example.test';
        state.tasks=[{id:'task-test',title:'Review synthetic company',companyId:state.companies[0].id,owner:'Legacy Reviewer',due:'2027-01-04',priority:'Normal',done:false},{id:'task-mine',title:'My assigned task',companyId:state.companies[0].id,owner:'operator@example.test',assigneeId:'${userId}',due:'2027-01-04',priority:'Normal',done:false}];
        if(q.has('legacyemail'))state.tasks.push(
          {...state.tasks[0],id:'legacy-email',title:'Legacy email task',owner:'REVIEWER@EXAMPLE.TEST'},
          {...state.tasks[0],id:'legacy-email-copy',title:'Second legacy email task',owner:'reviewer@example.test'},
          {...state.tasks[0],id:'stable-reviewer',title:'Stable account task',owner:'reviewer@example.test',assigneeId:'${otherId}'},
          {...state.tasks[0],id:'different-id',title:'Different account with old label',owner:'reviewer@example.test',assigneeId:'${userId}'});
        state.inbox=[{id:'mail-test',companyId:state.companies[0].id,orderId:'',kind:'Company',from:'Synthetic Contact',email:'contact@example.test',subject:'Fictional company correspondence',body:'Synthetic message body',time:'Today',attachments:[],status:'New'}];
        if(q.has('missive')){state.inbox[0].missive={messageId:'message-test',sourceDocumentId:state.documents[0].id,importedAt:'2026-09-14T12:00:00Z',attachments:[{id:'att-saved',name:'Saved file.pdf',bytes:10},{id:'att-pending',name:'Pending file.pdf',bytes:20}]};state.documents.push({id:'saved-attachment',companyId:state.companies[0].id,name:'Saved file.pdf',assetId:'asset-test',version:1,providerSource:{provider:'Missive',sourceMailId:'mail-test',attachmentId:'att-saved'}});}
        const access=role=>role==='demo'?undefined:{access:{role,userId:'${userId}',email:'operator@example.test',version:1,allCompanies:true,restricted:!q.has('restricted')},revision:1};
        let snapshot={s:state,connection:access(q.get('role')||'owner')};window.dailyUpdates=[];window.dailyDownloads=[];
        const emit=()=>listeners.forEach(fn=>fn());window.dailyState=()=>structuredClone(snapshot.s);
        window.setDailyRole=role=>{snapshot={...snapshot,connection:access(role)};emit();};
        export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(fn,title)=>{const next=structuredClone(snapshot.s);fn(next);snapshot={...snapshot,s:next};window.dailyUpdates.push(title);emit();return true;}};}
        export const download=(name,value)=>window.dailyDownloads.push({name,value});export const exportCsv=(name,value)=>window.dailyDownloads.push({name,value});
        export const saveAsset=()=>{throw Error('Unexpected asset write');};export const getAsset=()=>{throw Error('Unexpected asset read');};
      ` }));
    } }],
  });
  server = createServer((req,res) => {
    if(new URL(req.url,"http://localhost").pathname==="/app.mjs"){res.writeHead(200,{"content-type":"text/javascript"});res.end(bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents);}
    else {res.writeHead(200,{"content-type":"text/html"});res.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)); origin=`http://127.0.0.1:${server.address().port}`;
  try {browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:"chrome",headless:true});}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[]);});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
async function open(view, query="", now="2027-01-02T02:30:00Z"){
  errors=[];context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(4000);
  await context.route("**/*",route=>{if(!route.request().url().startsWith(`${origin}/`)){errors.push('Unexpected external request');return route.abort();}return route.continue();});
  await page.clock.setFixedTime(new Date(now));page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/?view=${view}&${query}`);await page.locator('#fixture-ready').waitFor({state:'attached'});
}
test('new order rolls its ID, due date and receipt date forward using the Eastern business calendar',async()=>{
  await open('orders');await page.getByRole('button',{name:'New order',exact:true}).click();
  assert.equal(await page.getByLabel('Due date',{exact:true}).inputValue(),'2027-01-04');
  await page.getByLabel('Property address',{exact:true}).fill('100 Synthetic Way');await page.getByLabel('Client name',{exact:true}).fill('Fictional Client');
  await page.getByRole('button',{name:'Create order',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  const order=await page.evaluate(()=>window.dailyState().orders[0]);assert.equal(order.id,'T-2027-1');assert.equal(order.receivedAt,'2027-01-01');assert.equal(order.due,'2027-01-04');assert.equal(order.assigneeId,userId);assert.equal(order.owner,'operator@example.test');
});
test('new tasks use the next weekday and a real selected staff account',async()=>{
  await open('tasks');await page.getByRole('button',{name:'New task',exact:true}).click();assert.equal(await page.getByLabel('Due date',{exact:true}).inputValue(),'2027-01-04');
  await page.getByLabel('Task',{exact:true}).fill('Fictional next step');await page.getByRole('button',{name:'Create task',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  const task=await page.evaluate(()=>window.dailyState().tasks[0]);assert.equal(task.assigneeId,userId);assert.equal(task.owner,'operator@example.test');assert.equal(task.due,'2027-01-04');assert.equal(task.createdAt,'2027-01-02T02:30:00.000Z');
});
test('existing assignment remains visible until an explicit choice and My work matches account identity',async()=>{
  await open('tasks');const picker=page.getByRole('combobox',{name:'Assign Review synthetic company'});await picker.waitFor();assert.match(await picker.innerText(),/Legacy Reviewer/);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
  await picker.click();await page.getByRole('option',{name:'reviewer@example.test',exact:true}).click();
  const task=await page.evaluate(()=>window.dailyState().tasks.find(t=>t.id==='task-test'));assert.equal(task.assigneeId,otherId);assert.equal(task.owner,'reviewer@example.test');
  await page.getByRole('combobox',{name:'Filter tasks by owner'}).click();await page.getByRole('option',{name:'My work',exact:true}).click();assert.match(await page.locator('body').innerText(),/My assigned task/);assert.doesNotMatch(await page.locator('body').innerText(),/Review synthetic company/);
});
for(const query of ['stafferror=1','nostaff=1'])test(`directory ${query} does not permit creating a task or replacing a legacy assignment`,async()=>{
  await open('tasks',query);await page.getByRole('combobox',{name:'Assign Review synthetic company'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Assign Review synthetic company'}).isDisabled(),true);
  await page.getByRole('button',{name:'New task',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Create task',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
});
for(const role of ['viewer','partner'])test(`${role} can read tasks without mutation controls or an open creation dialog`,async()=>{
  await open('tasks',`role=${role}`);assert.equal(await page.getByRole('button',{name:'New task',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Mark waiting',exact:true}).count(),0);assert.equal(await page.getByRole('combobox',{name:'Assign Review synthetic company'}).count(),0);assert.equal(await page.getByRole('checkbox').first().isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.deepEqual(await page.evaluate(()=>window.dailyDirectoryCalls||[]),[]);
});
test('a staff account filter includes legacy email assignments without duplicate choices',async()=>{
  await open('tasks','legacyemail=1');const filter=page.getByRole('combobox',{name:'Filter tasks by owner'});await filter.click();
  await page.getByRole('option',{name:'reviewer@example.test',exact:true}).waitFor();assert.equal(await page.getByRole('option',{name:/reviewer@example\.test.*existing assignment/i}).count(),0);
  await page.getByRole('option',{name:'reviewer@example.test',exact:true}).click();const text=await page.locator('body').innerText();assert.match(text,/Legacy email task/);assert.match(text,/Second legacy email task/);assert.match(text,/Stable account task/);assert.doesNotMatch(text,/Different account with old label|My assigned task/);
});
test('a pending directory response stays hidden after the account becomes read-only',async()=>{
  await open('tasks','staffdefer=1');await page.waitForFunction(()=>window.dailyDirectoryPending?.length>0);
  const requests=await page.evaluate(()=>window.dailyDirectoryCalls.length);await page.evaluate(()=>window.setDailyRole('viewer'));await page.getByRole('button',{name:'New task',exact:true}).waitFor({state:'detached'});
  await page.evaluate(()=>window.dailyDirectoryPending.forEach(resolve=>resolve()));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  await page.getByRole('combobox',{name:'Filter tasks by owner'}).click();assert.equal(await page.getByRole('option',{name:'reviewer@example.test',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.dailyDirectoryCalls.length),requests);
});
test('revoking task permission dismisses an open form without saving',async()=>{
  await open('tasks');await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByRole('dialog').waitFor();await page.evaluate(()=>window.setDailyRole('viewer'));await page.getByRole('dialog').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
});
for(const role of ['viewer','onboarding','finance'])test(`${role} does not receive order creation controls even with an open parent`,async()=>{
  await open('orders',`role=${role}&dialog=1`);assert.equal(await page.getByRole('button',{name:'New order',exact:true}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);
});
test('restricted onboarding projections say access is needed instead of inventing empty evidence',async()=>{
  await open('onboarding','role=operations&restricted=1');const text=await page.locator('body').innerText();assert.match(text,/Application evidence requires additional access/);assert.doesNotMatch(text,/0 \/ 7 reviewed|Not started|Save application|Record reviewed evidence/);assert.equal(await page.getByLabel('Legal company name',{exact:true}).count(),0);
});
test('visible onboarding evidence remains read-only for an operations account',async()=>{
  await open('onboarding','role=operations');assert.equal(await page.getByLabel('Legal company name',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save application',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Record reviewed evidence',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
});
test('a company operator with restricted access retains editable application controls',async()=>{
  await open('onboarding','role=onboarding');assert.equal(await page.getByLabel('Legal company name',{exact:true}).isEnabled(),true);assert.equal(await page.getByRole('button',{name:'Save application',exact:true}).isEnabled(),true);
});
test('financial and close periods use the Eastern month and accept periods outside the seed data',async()=>{
  await open('financials','', '2027-02-01T02:30:00Z');assert.equal(await page.getByLabel('Reporting month',{exact:true}).inputValue(),'2027-01');await page.getByLabel('Reporting month',{exact:true}).fill('2028-03');assert.equal(await page.getByLabel('Reporting month',{exact:true}).inputValue(),'2028-03');assert.doesNotMatch(await page.locator('body').innerText(),/issued demo policies|Illustrative demo figures/);
  await context.close();await open('close','', '2027-02-01T02:30:00Z');assert.equal(await page.getByLabel('Close reporting month',{exact:true}).inputValue(),'2027-01');
});
test('filing connected correspondence uses the business day and does not label real content fictional',async()=>{
  await open('inbox');await page.getByRole('button',{name:'File to company',exact:true}).click();
  const doc=await page.evaluate(()=>window.dailyState().documents[0]);assert.equal(doc.date,'2027-01-01');assert.match(doc.text,/CAPTURED CORRESPONDENCE/);assert.doesNotMatch(doc.text,/DEMO|fictional/);
});
test('Missive attachment statuses reflect saved records rather than saying all downloads are disabled',async()=>{
  await open('inbox','missive=1');const text=await page.locator('body').innerText();assert.match(text,/Saved file.pdf · 10 bytes · Saved to documents/);assert.match(text,/Pending file.pdf · 20 bytes · Not saved/);assert.doesNotMatch(text,/Attachment download and email sending are not enabled|have not been downloaded/);
});
test('automation-generated tasks record creation times and next weekdays across year rollover',async()=>{
  await open('automation');const tasks=await page.evaluate(()=>window.runRules());const generated=tasks.filter(t=>t.id.startsWith('auto-'));assert.ok(generated.length>0);for(const task of generated){assert.equal(task.due,'2027-01-04');assert.equal(task.createdAt,'2027-01-02T02:30:00.000Z');}
});
test('renewal automation uses a thirty-day Eastern calendar window before UTC month rollover',async()=>{
  await open('automation','','2027-02-01T02:30:00Z');const tasks=await page.evaluate(()=>window.runRenewals());assert.ok(tasks.some(t=>t.id==='auto-renew-at-cutoff-2027-03-02'));assert.equal(tasks.some(t=>t.id==='auto-renew-after-cutoff-2027-03-03'),false);
});
test('viewer inbox and order detail retain records without editable production controls',async()=>{
  await open('inbox','role=viewer');assert.equal(await page.getByRole('button',{name:'Capture request',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'File to company',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Archive message',exact:true}).isDisabled(),true);
  await context.close();await open('detail','role=viewer');assert.equal(await page.getByRole('combobox',{name:'Order owner'}).count(),0);assert.equal(await page.getByRole('button',{name:'Record outcome',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Save notes',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
});
test('capture plus a new order requires explicit eligible staff and saves their stable account',async()=>{
  await open('inbox');await page.getByRole('button',{name:'Capture request',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Capture incoming request',exact:true});
  await dialog.getByLabel('Sender name',{exact:true}).fill('Fictional Sender');await dialog.getByLabel('Sender email',{exact:true}).fill('sender@example.test');await dialog.getByLabel('Subject',{exact:true}).fill('Fictional new transaction');await dialog.getByLabel('Original message',{exact:true}).fill('Please review this fictional title file.');
  await dialog.getByRole('combobox',{name:'Incoming request file'}).click();await page.getByRole('option',{name:'Create a new transaction file',exact:true}).click();
  await dialog.getByLabel('Property address',{exact:true}).fill('200 Fictional Street');await dialog.getByLabel('Client / proposed buyer',{exact:true}).fill('Fictional buyer');
  assert.equal(await dialog.getByRole('button',{name:'Capture request',exact:true}).isDisabled(),true);assert.match(await dialog.getByRole('combobox',{name:'Intake production staff'}).innerText(),/Choose production staff/);
  await dialog.getByRole('combobox',{name:'Intake production staff'}).click();await page.getByRole('option',{name:'reviewer@example.test',exact:true}).click();assert.equal(await dialog.getByLabel('Due date',{exact:true}).inputValue(),'2027-01-04');
  await dialog.getByRole('button',{name:'Capture request',exact:true}).click();await dialog.waitFor({state:'detached'});
  const state=await page.evaluate(()=>window.dailyState());const order=state.orders.find(row=>row.address==='200 Fictional Street');assert.equal(order.assigneeId,otherId);assert.equal(order.owner,'reviewer@example.test');assert.equal(order.receivedAt,'2027-01-01');assert.equal(order.due,'2027-01-04');assert.equal(state.inbox[0].orderId,order.id);
});
for(const scenario of ['staffrecover','newstaff'])test(`intake ${scenario} refresh updates both staff choices and save eligibility`,async()=>{
  await open('inbox',`${scenario}=1`);await page.getByRole('button',{name:'Capture request',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Capture incoming request',exact:true});
  await dialog.getByLabel('Sender name',{exact:true}).fill('Fictional Sender');await dialog.getByLabel('Sender email',{exact:true}).fill('sender@example.test');await dialog.getByLabel('Subject',{exact:true}).fill('Recovered staff intake');await dialog.getByLabel('Original message',{exact:true}).fill('Fictional request awaiting staff assignment.');
  await dialog.getByRole('combobox',{name:'Incoming request file'}).click();await page.getByRole('option',{name:'Create a new transaction file',exact:true}).click();
  await dialog.getByLabel('Property address',{exact:true}).fill('300 Fictional Avenue');await dialog.getByLabel('Client / proposed buyer',{exact:true}).fill('Fictional buyer');
  await dialog.getByRole('button',{name:'Refresh staff',exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Capture request',exact:true}).isDisabled(),true);
  await page.evaluate(()=>{window.dailyDirectoryRecovered=true;});await dialog.getByRole('button',{name:'Refresh staff',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Intake production staff'}).click();await page.getByRole('option',{name:'reviewer@example.test',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
  assert.equal(await dialog.getByRole('button',{name:'Capture request',exact:true}).isEnabled(),true);await dialog.getByRole('button',{name:'Capture request',exact:true}).click();await dialog.waitFor({state:'detached'});
  const order=await page.evaluate(()=>window.dailyState().orders.find(row=>row.address==='300 Fictional Avenue'));assert.equal(order.assigneeId,otherId);assert.equal(order.owner,'reviewer@example.test');assert.equal(await page.evaluate(()=>window.dailyDirectoryCalls.length),2);
});
test('changing an intake company clears the reviewed new-order assignment',async()=>{
  await open('inbox');await page.getByRole('button',{name:'Capture request',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Capture incoming request',exact:true});
  await dialog.getByRole('combobox',{name:'Incoming request file'}).click();await page.getByRole('option',{name:'Create a new transaction file',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Intake production staff'}).click();await page.getByRole('option',{name:'reviewer@example.test',exact:true}).click();
  const otherCompany=await page.evaluate(()=>window.dailyState().companies[1].name);await dialog.getByRole('combobox',{name:'Incoming request company'}).click();await page.getByRole('option',{name:otherCompany,exact:true}).click();
  await dialog.getByRole('combobox',{name:'Incoming request file'}).click();await page.getByRole('option',{name:'Create a new transaction file',exact:true}).click();
  assert.match(await dialog.getByRole('combobox',{name:'Intake production staff'}).innerText(),/Choose production staff/);assert.equal(await dialog.getByRole('button',{name:'Capture request',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
});
test('a reviewed assistant suggestion records the current account ID and previews its email',async()=>{
  await open('assistant');await page.getByRole('button',{name:'Review as task',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Review as a task',exact:true});assert.match(await dialog.innerText(),/your account: operator@example.test/);
  await dialog.getByRole('button',{name:'Create reviewed task',exact:true}).click();await dialog.waitFor({state:'detached'});const task=await page.evaluate(()=>window.dailyState().tasks[0]);assert.equal(task.assigneeId,userId);assert.equal(task.owner,'operator@example.test');assert.equal(task.title,'Review fictional formation evidence');assert.equal(await page.evaluate(()=>window.dailyAssistantCalls.length),2);
});
for(const role of ['viewer','partner'])test(`${role} assistant suggestions have no task creation action`,async()=>{
  await open('assistant',`role=${role}`);await page.getByText('Fictional review complete',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Review as task',exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>window.dailyUpdates),[]);
});
