import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
let server,browser,context,page,origin; let errors=[];
before(async()=>{
  const bundle=await build({absWorkingDir:root,write:false,bundle:true,platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:root,loader:'tsx',contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{SecurityCenter}from'./components/title/security-center';
  window.fixture={calls:[],deny:false,stale:false,hold:false};
  function App(){const[id,setId]=useState('workspace-one');window.switchAccount=()=>setId('workspace-two');return <SecurityCenter workspaceId={id} userId="actor" companies={[{id:"A",name:"Fixture agency"}]}/>}createRoot(document.getElementById('root')).render(<App/>);`},plugins:[{name:'transport',setup(b){b.onResolve({filter:/^@\/lib\/backend\/security-center-client$/},()=>({path:'fixture',namespace:'security'}));b.onLoad({filter:/.*/,namespace:'security'},()=>({contents:`
  const snapshot={companyIds:['A'],members:[{userId:'staff-id',role:'operations',companyIds:['A'],allCompanies:false,restricted:false,active:true,version:3,partnerAssignmentsDigest:'abc'}]};
  export async function loadSecurityCenter(workspaceId){window.fixture.calls.push(['load',workspaceId]);if(window.fixture.deny)throw Error('Only a workspace-wide administrator can open the security center.');if(window.fixture.hold)await new Promise(resolve=>{window.fixture.release=resolve});return{checkedAt:'2026-09-24T00:00:00Z',snapshot,snapshotDigest:'a'.repeat(32),latestReview:window.fixture.reviewed?{id:'review-id',createdAt:'2026-09-24T00:00:00Z',actorId:'actor',snapshotDigest:'a'.repeat(32),memberCount:1,note:'checked',current:!window.fixture.stale}:null,evidence:{eventCount:1,lastEventAt:'2026-09-24T00:00:00Z',backupCount:0,lastBackupAt:null},documentScanning:{policy:'pending_setup',configured:false,legacyUnscannedCount:7}}}
  export async function listSecurityEvents(workspaceId,userId,cursor){window.fixture.calls.push(['events',workspaceId,cursor]);return{items:cursor?[]:[{id:'event-id',createdAt:'2026-09-24T00:00:00Z',actorId:'actor',eventType:'file.download',outcome:'success',companyId:'A',recordType:'asset',recordId:'asset_fixture',count:1}],nextCursor:cursor?null:{createdAt:'2026-09-24T00:00:00Z',id:'event-id'}}}
  export async function loadSecurityMemberLabels(workspaceId){window.fixture.calls.push(['labels',workspaceId]);if(window.fixture.labelFailure)throw Object.assign(Error('Member labels are unavailable.'),{status:window.fixture.labelFailure});return window.fixture.labelMissing?[]:[{userId:'staff-id',email:window.fixture.currentEmail||'staff@example.test'}]}
  export async function recordAccessReview(input){window.fixture.calls.push(['review',input]);if(window.fixture.stale)throw Error('Memberships or company scope changed. Refresh and review again.');window.fixture.reviewed=true;return{id:'review-id'}}
  export async function exportSecurityEvents(){window.fixture.calls.push(['export']);return{items:[],nextCursor:null}}
  `}));}}]});
  server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.mjs'?'text/javascript':'text/html');res.end(req.url==='/app.mjs'?bundle.outputFiles[0].text:'<!doctype html><html><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'chrome'});}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[]);});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
async function open(){errors=[];context=await browser.newContext();await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);await page.goto(origin);await page.getByText('staff-id',{exact:true}).waitFor();}
const check=()=>page.getByRole('checkbox'); const review=()=>page.getByRole('button',{name:'Record access review',exact:true});
test('access review displays explicit grants and requires acknowledgement plus note; scanner setup remains visibly incomplete',async()=>{
  await open();assert.ok(await page.getByText('staff@example.test',{exact:true}).isVisible());assert.ok(await page.getByRole('cell',{name:/Fixture agency/}).isVisible());assert.equal(await page.getByRole('cell',{name:'Not allowed',exact:true}).count(),1);assert.equal(await review().isDisabled(),true);
  assert.ok(await page.getByText(/NOT ACTIVATED/).isVisible());assert.ok(await page.getByText(/Originals without scan evidence: 7/).isVisible());
  await page.getByLabel('Review note',{exact:true}).fill('Checked roles. Follow-up assigned.');assert.equal(await review().isDisabled(),true);await check().check();await review().click();
  await page.getByText(/Access review recorded/).waitFor();assert.equal(await check().isChecked(),false);assert.equal(await page.getByLabel('Review note',{exact:true}).inputValue(),'');
  const recorded=await page.evaluate(()=>window.fixture.calls.find(call=>call[0]==='review')[1]);assert.equal(recorded.snapshotDigest,'a'.repeat(32));assert.equal(recorded.note,'Checked roles. Follow-up assigned.');assert.deepEqual(Object.keys(recorded).sort(),['note','snapshotDigest','workspaceId']);assert.ok(!JSON.stringify(recorded).includes('staff@example.test'));
});
test('stale membership rejection clears acknowledgement and never claims review success',async()=>{
  await open();await page.getByLabel('Review note',{exact:true}).fill('Review');await check().check();await page.evaluate(()=>{window.fixture.stale=true;});await review().click();
  await page.getByRole('alert').filter({hasText:'Memberships or company scope changed'}).waitFor();assert.equal(await check().isChecked(),false);assert.equal(await page.getByText(/Access review recorded/).count(),0);
  await page.getByRole('button',{name:'Refresh security evidence'}).click();assert.equal(await check().isChecked(),false);
});
test('pagination replaces the page and loss of administrator access removes previous evidence',async()=>{
  await open();await page.getByRole('button',{name:'Older security events'}).click();await page.getByText('No security events have been recorded.').waitFor();
  await page.evaluate(()=>{window.fixture.deny=true;});await page.getByRole('button',{name:'Refresh security evidence'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByText('staff-id',{exact:true}).count(),0);assert.equal(await review().count(),0);
});
test('an account/workspace switch drops private draft state and hides stale evidence while the new request waits',async()=>{
  await open();await page.getByLabel('Review note',{exact:true}).fill('Old private draft');await check().check();await page.evaluate(()=>{window.fixture.hold=true;window.switchAccount();});
  await page.getByText('Loading security evidence…').waitFor();assert.equal(await page.getByText('staff-id',{exact:true}).count(),0);
  await page.evaluate(()=>{window.fixture.hold=false;window.fixture.release();});await page.getByText('staff-id',{exact:true}).waitFor();assert.equal(await page.getByLabel('Review note',{exact:true}).inputValue(),'');assert.equal(await check().isChecked(),false);
});

test('missing or unavailable labels explicitly fall back to account IDs and clear previously loaded email labels',async()=>{
  await open();await page.evaluate(()=>{window.fixture.labelFailure=503;});await page.getByRole('button',{name:'Refresh security evidence'}).click();
  await page.getByText('Email unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('staff@example.test',{exact:true}).count(),0);assert.ok(await page.getByText('staff-id',{exact:true}).isVisible());
  assert.ok(await page.getByText('Member labels are unavailable. Refresh to retry, or use the account IDs to check the staff directory.').isVisible());
  await page.evaluate(()=>{window.fixture.labelFailure=false;window.fixture.labelMissing=true;});await page.getByRole('button',{name:'Refresh security evidence'}).click();await page.getByText('Email unavailable',{exact:true}).waitFor();
  assert.equal(await page.getByText('staff@example.test',{exact:true}).count(),0);
});
test('label authorization failure clears the entire review instead of retaining prior account data',async()=>{
  await open();await page.evaluate(()=>{window.fixture.labelFailure=403;});await page.getByRole('button',{name:'Refresh security evidence'}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('staff-id',{exact:true}).count(),0);assert.equal(await page.getByText('staff@example.test',{exact:true}).count(),0);assert.equal(await review().count(),0);
});
test('current email changes remain display-only and do not alter the reviewed snapshot digest',async()=>{
  await open();await page.evaluate(()=>{window.fixture.currentEmail='renamed@example.test';});await page.getByRole('button',{name:'Refresh security evidence'}).click();await page.getByText('renamed@example.test',{exact:true}).waitFor();
  await page.getByLabel('Review note',{exact:true}).fill('Checked the displayed account.');await check().check();await review().click();await page.getByText(/Access review recorded/).waitFor();
  const input=await page.evaluate(()=>window.fixture.calls.find(call=>call[0]==='review')[1]);assert.equal(input.snapshotDigest,'a'.repeat(32));assert.deepEqual(Object.keys(input).sort(),['note','snapshotDigest','workspaceId']);
});
