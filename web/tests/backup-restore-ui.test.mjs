// Real React store, IndexedDB transactions and preview. Only backend transport is disabled.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, origin, context, page;
before(async () => {
  const result = await build({
    absWorkingDir: root, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: [
      "import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';",
      "import {WorkspaceProvider,useWorkspace,parseBackupFile,restoreAssets,getAsset,saveAsset,createFullBackup} from './lib/title/store';",
      "import {createSeed} from './lib/title/model';import {DocumentPreview} from './components/title/documents';",
      "function App(){const {s,ready,restore}=useWorkspace();const [open,setOpen]=useState(false);const d=s.documents.find(d=>d.id==='QA-DOC');",
      "window.seedFixture=()=>createSeed();window.currentFixture=()=>structuredClone(s);",
      "window.parseOnly=raw=>{try{return {accepted:true,backup:parseBackupFile(raw)}}catch(e){return {accepted:false,message:e.message}}};",
      "window.restoreSynthetic=async raw=>{const b=parseBackupFile(raw);await restore(b.workspace,b.assets);setOpen(true)};",
      "window.writeAssets=restoreAssets;window.readAsset=async id=>(await getAsset(id)).text();",
      "window.buildBackup=createFullBackup;window.saveFile=saveAsset;",
      "window.replacePreview=async (mime,text)=>{setOpen(false);await saveAsset('QA-ASSET',new File([text],'test',{type:mime}));setTimeout(()=>setOpen(true),0)};",
      "return <>{open&&d&&<DocumentPreview doc={d} onClose={()=>setOpen(false)}/>}<Toaster/>{ready&&<span id='ready'/>}</>}",
      "createRoot(document.getElementById('root')).render(<WorkspaceProvider><App/></WorkspaceProvider>);",
    ].join("\n") },
    plugins: [{ name: "local-backup-fixture", setup(b) {
      b.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "worker", namespace: "pdf-url" }));
      b.onLoad({ filter: /.*/, namespace: "pdf-url" }, () => ({ contents: 'export default "/pdf.worker.mjs";' }));
      b.onResolve({ filter: /^(?:\.\.\/backend\/client|@\/lib\/backend\/client)$/ }, () => ({ path: "client", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const backendConfigured=false,hostedPilot=false,supabase=null;export const activeWorkspace=()=>'';export const backendRequest=()=>{throw Error('No network')};export const uploadRemoteAsset=()=>{throw Error('No network')};export const downloadRemoteAsset=()=>{throw Error('No network')};export const setActiveWorkspace=()=>{};" }));
      b.onResolve({ filter: /^\.\/(document-text-review|publications|deliveries)$/ }, args => ({ path: args.path, namespace: "child" }));
      b.onLoad({ filter: /.*/, namespace: "child" }, args => ({ contents: "export const " + (args.path.includes("document-text") ? "DocumentTextReview" : args.path.includes("publications") ? "PublicationManager" : "DeliveryManager") + "=()=>null;" }));
      b.onResolve({ filter: /^@\/components\/title\/backend-access$/ }, () => ({ path: "access", namespace: "access" }));
      b.onLoad({ filter: /.*/, namespace: "access" }, () => ({ contents: "export const BackendAccess=()=>null;" }));
    } }],
  });
  const worker = await readFile(root + "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  server = createServer((req,res) => {
    res.setHeader("content-type", req.url === "/" ? "text/html" : "text/javascript");
    res.end(req.url === "/app.mjs" ? result.outputFiles[0].text : req.url === "/pdf.worker.mjs" ? worker : '<html><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve)); origin="http://127.0.0.1:"+server.address().port;
  try { browser=await chromium.launch({headless:true}); } catch { browser=await chromium.launch({channel:"chrome",headless:true}); }
});
afterEach(async()=>{await context?.close()});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}});
async function open() {
  context=await browser.newContext();
  await context.route("**/*",r=>r.request().url().startsWith(origin+"/")?r.continue():r.abort());
  page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(origin);await page.locator("#ready").waitFor({state:"attached"});
}
async function backup({mime="text/plain",assetMime=mime,body="Synthetic original",name="Fictional original.txt"}={}) {
  const workspace=await page.evaluate(()=>window.seedFixture());
  workspace.documents=[{id:"QA-DOC",companyId:workspace.companies[0].id,name,category:"Company records",visibility:"Internal",date:"2026-09-22",size:"1 KB",version:1,assetId:"QA-ASSET",mime}];
  return {backup:true,version:1,exportedAt:"2026-09-22",workspace,assets:[{id:"QA-ASSET",name,mime:assetMime,data:Buffer.from(body).toString("base64")}],missingAssets:[]};
}
const restore=b=>page.evaluate(raw=>window.restoreSynthetic(raw),JSON.stringify(b));
const read=()=>page.evaluate(()=>window.readAsset("QA-ASSET"));
const current=()=>page.evaluate(()=>window.currentFixture());
const rejected=async b=>assert.equal((await page.evaluate(raw=>window.parseOnly(raw),JSON.stringify(b))).accepted,false);
test("active or mismatched backup MIME is rejected before storing or previewing",async()=>{
  await open();
  for(const assetMime of ["text/html","image/svg+xml","text/plain"])await rejected(await backup({mime:"application/pdf",assetMime,body:"<html>Fictional specimen</html>"}));
});
test("all malformed or duplicate asset entries reject before an earlier original can change",async()=>{
  await open();await restore(await backup());const before=await current();
  for(const mutation of ["base64","duplicate","unbound","missing-overlap"]){
    const b=await backup({body:"Replacement"});
    if(mutation==="base64"){b.assets[0].data="!!invalid!!"}
    if(mutation==="duplicate"){b.assets.push({...b.assets[0]})}
    if(mutation==="unbound"){b.assets.push({...b.assets[0],id:"UNBOUND"})}
    if(mutation==="missing-overlap"){b.missingAssets=[{id:"QA-ASSET",name:"Missing"}]}
    await rejected(b);assert.equal(await read(),"Synthetic original");assert.deepEqual(await current(),before);
  }
});
test("an invalid later asset cannot partially overwrite originals through the restore helper",async()=>{
  await open();await restore(await backup());const b=await backup({body:"Replacement"});
  b.assets.push({id:"BROKEN",name:"Broken.txt",mime:"text/plain",data:"!!invalid!!"});
  const error=await page.evaluate(async assets=>{try{await window.writeAssets(assets);return ""}catch(e){return e.message}},b.assets);
  assert.match(error,/invalid/i);assert.equal(await read(),"Synthetic original");
});
test("IndexedDB write failure aborts every file in the batch",async()=>{
  await open();await restore(await backup());const b=await backup({body:"Replacement"});b.assets.push({...b.assets[0],id:"SECOND"});
  const error=await page.evaluate(async assets=>{
    const put=IDBObjectStore.prototype.put;let writes=0;
    IDBObjectStore.prototype.put=function(...args){if(++writes===2)throw new DOMException("Synthetic quota","QuotaExceededError");return put.apply(this,args)};
    try{await window.writeAssets(assets);return ""}catch(e){return e.message}finally{IDBObjectStore.prototype.put=put}
  },b.assets);
  assert.ok(error);assert.equal(await read(),"Synthetic original");
});
test("metadata quota failure preserves current records and their original bytes",async()=>{
  await open();await restore(await backup());const before=await current();const b=await backup({body:"Replacement"});
  const error=await page.evaluate(async raw=>{
    const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==="titleos.workspace.v1")throw new DOMException("Synthetic quota","QuotaExceededError");return set.call(this,k,v)};
    try{await window.restoreSynthetic(raw);return ""}catch(e){return e.message}finally{Storage.prototype.setItem=set}
  },JSON.stringify(b));
  assert.match(error,/quota/i);assert.deepEqual(await current(),before);assert.equal(await read(),"Synthetic original");
});
test("successful restore preserves logical references, survives reload and keeps Undo originals",async()=>{
  await open();await restore(await backup());const first=await current();
  await restore(await backup({body:"Second original"}));const second=await current();
  assert.equal(second.documents[0].assetId,first.documents[0].assetId);
  assert.notEqual(second.localAssetNamespace,first.localAssetNamespace);assert.equal(await read(),"Second original");
  await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"detached"});
  await page.locator("[data-sonner-toast][data-front=true]").getByRole("button",{name:"Undo",exact:true}).click();
  await page.waitForFunction(n=>window.currentFixture().localAssetNamespace===n,first.localAssetNamespace);
  assert.equal(await read(),"Synthetic original");await page.reload();await page.locator("#ready").waitFor({state:"attached"});
  assert.equal(await read(),"Synthetic original");
});
test("missing backup bytes cannot silently reuse an older file with the same ID",async()=>{
  await open();await restore(await backup());const b=await backup();b.assets=[];delete b.missingAssets;
  const parsed=await page.evaluate(raw=>window.parseOnly(raw),JSON.stringify(b));assert.equal(parsed.accepted,true);assert.equal(parsed.backup.missingAssets.length,1);
  await restore(b);assert.match(await page.evaluate(async()=>{try{await window.readAsset("QA-ASSET");return ""}catch(e){return e.message}}),/no longer available/);
});
test("ordinary text and document names render as text without executing markup",async()=>{
  await open();const text='<img src=x onerror="window.__qa=1"><script>window.__qa=1</script>';
  await restore(await backup({body:text,name:text+".txt"}));await page.locator(".text-preview").waitFor();
  assert.equal(await page.locator(".text-preview").innerText(),text);assert.equal(await page.evaluate(()=>window.__qa),undefined);
});
test("preview rejects a stored Blob whose actual type disagrees with its document",async()=>{
  await open();await restore(await backup());await page.locator(".text-preview").waitFor();
  await page.evaluate(()=>window.replacePreview("text/html","<script>parent.__qa=1</script>"));
  await page.getByText("File unavailable",{exact:true}).waitFor();
  assert.equal(await page.locator("iframe").count(),0);assert.equal(await page.evaluate(()=>window.__qa),undefined);
});
test("excessive asset counts are rejected before allocating file bytes",async()=>{
  await open();const b=await backup();b.assets=Array.from({length:2001},(_,i)=>({...b.assets[0],id:"file-"+i}));
  await rejected(b);
});

test("legacy MIME metadata is normalized only in the export and round trips",async()=>{
  await open();await restore(await backup());
  const result=await page.evaluate(async()=>{
    const input=window.currentFixture();delete input.documents[0].mime;
    const exported=await window.buildBackup(input);
    return {unchanged:input.documents[0].mime===undefined,mime:exported.workspace.documents[0].mime,parsed:window.parseOnly(JSON.stringify(exported)).accepted};
  });
  assert.deepEqual(result,{unchanged:true,mime:"text/plain",parsed:true});
});
test("exports reject total file limits before allocating base64",async()=>{
  await open();await restore(await backup());
  const result=await page.evaluate(async()=>{
    const input=window.currentFixture();const doc=input.documents[0];doc.mime="application/octet-stream";
    input.documents.push({...doc,id:"SECOND",assetId:"SECOND"});
    for(const d of input.documents)await window.saveFile(d.assetId,new File([new Uint8Array(35*1024*1024)],d.name,{type:d.mime}));
    const original=FileReader.prototype.readAsDataURL;let reads=0;
    FileReader.prototype.readAsDataURL=function(...args){reads++;return original.apply(this,args)};
    try{await window.buildBackup(input);return {error:"",reads}}catch(e){return {error:e.message,reads}}finally{FileReader.prototype.readAsDataURL=original}
  });
  assert.match(result.error,/64 MB/);assert.equal(result.reads,0);
});
test("exports reject excessive document counts before reading storage",async()=>{
  await open();const result=await page.evaluate(async()=>{
    const input=window.seedFixture();input.documents=Array.from({length:2001},(_,i)=>({id:"doc-"+i,assetId:"file-"+i,name:"Fictional.txt",mime:"text/plain"}));
    try{await window.buildBackup(input);return ""}catch(e){return e.message}
  });assert.match(result,/2,000/);
});
test("an Undo namespace switch during export cannot mix generations",async()=>{
  await open();const old=await backup({body:"Old one"});
  old.workspace.documents.push({...old.workspace.documents[0],id:"SECOND",assetId:"SECOND"});
  old.assets.push({...old.assets[0],id:"SECOND",data:Buffer.from("Old two").toString("base64")});
  await restore(old);const original=await current();
  const next=structuredClone(old);next.assets[0].data=Buffer.from("New one").toString("base64");next.assets[1].data=Buffer.from("New two").toString("base64");
  await restore(next);
  const result=await page.evaluate(async previous=>{
    const input=window.currentFixture(),get=IDBObjectStore.prototype.get;let reads=0;
    IDBObjectStore.prototype.get=function(...args){if(++reads===1)localStorage.setItem("titleos.workspace.v1",JSON.stringify(previous));return get.apply(this,args)};
    try{return (await window.buildBackup(input)).assets.map(a=>atob(a.data))}finally{IDBObjectStore.prototype.get=get}
  },original);
  assert.deepEqual(result,["New one","New two"]);
});
