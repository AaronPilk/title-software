// Actual final-source forms and domain commands; only storage/transport is synthetic.
import test, {before, after, afterEach} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../",import.meta.url));
let browser,server,context,page,origin;let errors=[];
before(async()=>{
  const result=await build({absWorkingDir:root,write:false,bundle:true,format:"esm",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},
    stdin:{resolveDir:root,loader:"tsx",contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {FinalSources} from './components/title/final-intake';import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();return <><FinalSources order={s.orders[0]}/><span id='ready'/></>};createRoot(document.getElementById('root')).render(<App/>);
    `},plugins:[{name:"final-source-fixture",setup(b){
      b.onResolve({filter:/^@\/lib\/title\/store$/},()=>({path:"store",namespace:"fixture"}));
      b.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"tsx",resolveDir:root,contents:`
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';import {neededFields} from './lib/title/production';
        const state=createSeed(),o=state.orders[0];o.status='Needs review';state.inbox=[];
        const docs=['A','B'].map(id=>({id,companyId:o.companyId,orderId:o.id,sourceRole:'Deed',name:'Fictional source '+id+'.txt',text:'Fictional source',version:1,category:'Policy documents',visibility:'Internal',date:'2026-09-22',size:'1 KB'}));
        state.documents=docs;const defs=neededFields(o).filter(f=>f.role==='Deed');
        o.fields=defs.map(f=>({id:f.id,label:f.label,current:'Recorded current',proposed:'Prior '+f.id,sourceValue:'Prior '+f.id,source:'Fictional source A',documentId:'A',sourcePage:'1',reviewed:true,confidence:'Human captured'}));
        let snapshot={s:state,error:'',connection:{workspaceId:'fictional-workspace',access:{role:'owner',allCompanies:true,userId:'fictional-owner',email:'owner@example.test',version:1}}};const listeners=new Set();const emit=()=>listeners.forEach(fn=>fn());window.captureFixture=()=>structuredClone(snapshot.s);window.captureDefs=defs;window.captureSaves=[];
        window.removeSource=id=>{snapshot={...snapshot,s:{...snapshot.s,documents:snapshot.s.documents.filter(d=>d.id!==id)}};emit()};
        window.changeCapturedSource=(kind)=>{const next=structuredClone(snapshot.s);if(kind==='access')snapshot={...snapshot,connection:{...snapshot.connection,access:{...snapshot.connection.access,version:2}}};else{const d=next.documents.find(d=>d.id==='B');if(kind==='version')d.version=2;else if(kind==='asset')d.assetId='new-asset';else d.visibility='Restricted';snapshot={...snapshot,s:next}}emit()};
        export function useWorkspace(){const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...value,update:async(fn,title)=>{try{const next=structuredClone(snapshot.s);fn(next);snapshot={...snapshot,s:next,error:''};window.captureSaves.push(title);emit();return true}catch(e){snapshot={...snapshot,error:e.message};window.captureError=e.message;emit();return false}}};}
        export const download=()=>{};export async function getAsset(){throw new Error("No original asset in this manual capture fixture")};
      `}));
      b.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},()=>({path:"worker",namespace:"worker"}));
      b.onLoad({filter:/.*/,namespace:"worker"},()=>({contents:'export default "/unused-worker.mjs";'}));
      b.onResolve({filter:/^\.\/documents$/},()=>({path:"documents",namespace:"child"}));
      b.onResolve({filter:/^\.\/followups$/},()=>({path:"followups",namespace:"child"}));
      b.onLoad({filter:/.*/,namespace:"child"},()=>({loader:'tsx',resolveDir:root,contents:"import React from 'react';export const UploadDocument=()=>null,AttorneyFollowups=()=>null;export const DocumentPreview=({initialPage=1,onClose})=><div><output aria-label='Fixture preview physical page'>{initialPage}</output><button onClick={onClose}>Close fixture original</button></div>;"}));
      b.onResolve({filter:/^\.\/package-review$/},()=>({path:"package",namespace:"package-fixture"}));
      b.onLoad({filter:/.*/,namespace:"package-fixture"},()=>({loader:'tsx',resolveDir:root,contents:"import React from 'react';export function PackageReviewButton({documents,onCapture,captureFields,onOpenOriginal}){return <><button onClick={()=>{const d=documents.find(d=>d.id==='B');onCapture(d,captureFields[d.id].map(id=>({id,value:'Package '+id,evidence:{page:'Text page 1',method:'source-text',quote:'Exact source Package '+id,suggestedValue:'Package '+id}})));}}>Fixture reviewed package capture</button><button onClick={()=>onOpenOriginal(documents.find(d=>d.id==='B'),30)}>Fixture compare physical page 30</button></>}"}));
    }}]});
  server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.mjs"?"text/javascript":"text/html");res.end(req.url==="/app.mjs"?result.outputFiles[0].text:'<!doctype html><div id="root"></div><script type="module" src="/app.mjs"></script>')});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));origin="http://127.0.0.1:"+server.address().port;
  try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({headless:true,channel:"chrome"})}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[])});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}});
async function open(){errors=[];context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(5000);await page.clock.setFixedTime(new Date("2027-01-02T02:30:00Z"));page.on("pageerror",e=>errors.push(e.message));await page.goto(origin);await page.locator("#ready").waitFor({state:"attached"});}
const row=id=>page.locator(".source-document").filter({hasText:"Fictional source "+id+".txt"});
test("a replacement source never inherits another attachment's captured values",async()=>{
  await open();await row("B").getByRole("button",{name:"Capture fields",exact:true}).click();
  const defs=await page.evaluate(()=>window.captureDefs);
  for(const f of defs)assert.equal(await page.locator(`input[name="${f.id}"]`).inputValue(),"");
  await page.getByLabel("Page or section reference",{exact:true}).fill("Page 2");
  await page.getByRole("button",{name:"Save for field review"}).click();assert.deepEqual(await page.evaluate(()=>window.captureSaves),[]);
  for(const f of defs)await page.locator(`input[name="${f.id}"]`).fill("New source "+f.id);
  await page.getByRole("button",{name:"Save for field review"}).click();await page.getByRole("dialog").waitFor({state:"detached"});
  const fields=await page.evaluate(()=>window.captureFixture().orders[0].fields);
  assert.ok(fields.every(f=>f.documentId==="B"&&f.sourceValue==="New source "+f.id&&!f.reviewed));
});
test("recapturing the same source keeps that source's values available",async()=>{
  await open();await row("A").getByRole("button",{name:"Capture fields",exact:true}).click();
  for(const f of await page.evaluate(()=>window.captureDefs))assert.equal(await page.locator(`input[name="${f.id}"]`).inputValue(),"Prior "+f.id);
});
async function sourceForm(){await page.getByRole("button",{name:"Add source / section reference"}).click();await page.getByLabel("Reference name",{exact:true}).fill("Fictional excerpt");await page.getByLabel("Exact excerpt and page references",{exact:true}).fill("Fictional wording, page 2.");}
test("a removed parent cannot silently turn a source reference into a standalone excerpt",async()=>{
  await open();await sourceForm();await page.getByRole("combobox",{name:"Parent attachment",exact:true}).click();await page.getByRole("option",{name:"Fictional source A.txt",exact:true}).click();
  await page.evaluate(()=>window.removeSource("A"));await page.getByRole("button",{name:"Save source reference",exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.captureSaves),[]);assert.match(await page.evaluate(()=>window.captureError),/parent.*(available|again)/i);assert.equal(await page.getByRole("dialog").count(),1);
});
test("source references use the business date across midnight UTC",async()=>{
  await open();await sourceForm();await page.getByRole("button",{name:"Save source reference",exact:true}).click();await page.getByRole("dialog").waitFor({state:"detached"});
  assert.equal(await page.evaluate(()=>window.captureFixture().documents[0].date),"2027-01-01");
});
for(const kind of ['version','asset','visibility','access'])test(`package-prefilled values cannot be rebound after source ${kind} changes`,async()=>{
  await open();await page.getByRole('button',{name:'Fixture reviewed package capture'}).click();
  for(const f of await page.evaluate(()=>window.captureDefs))assert.equal(await page.locator(`input[name="${f.id}"]`).inputValue(),'Package '+f.id);
  await page.evaluate(kind=>window.changeCapturedSource(kind),kind);
  for(const f of await page.evaluate(()=>window.captureDefs))assert.equal(await page.locator(`input[name="${f.id}"]`).inputValue(),'');
  assert.equal(await page.getByLabel('Page or section reference',{exact:true}).inputValue(),'');assert.deepEqual(await page.evaluate(()=>window.captureSaves),[]);
});
test('package page comparison opens the cited physical page; a normal open restarts at one',async()=>{
  await open();await page.getByRole('button',{name:'Fixture compare physical page 30'}).click();assert.equal(await page.getByLabel('Fixture preview physical page').innerText(),'30');
  await page.getByRole('button',{name:'Close fixture original'}).click();await row('B').getByRole('button',{name:'Fictional source B.txt'}).click();assert.equal(await page.getByLabel('Fixture preview physical page').innerText(),'1');
});
for(const kind of ['version','asset','visibility','access'])test(`a package preview target clears after source ${kind} changes`,async()=>{
  await open();await page.getByRole('button',{name:'Fixture compare physical page 30'}).click();assert.equal(await page.getByLabel('Fixture preview physical page').innerText(),'30');await page.evaluate(kind=>window.changeCapturedSource(kind),kind);assert.equal(await page.getByLabel('Fixture preview physical page').innerText(),'1');
});
