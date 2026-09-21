// Real upload/vault/preview components; fictional records and in-memory file transport only.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let browser, server, context, page, origin;
let errors = [];
before(async () => {
  const bundle = await build({
    absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';
      import {Documents,UploadDocument,DocumentPreview} from './components/title/documents';import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();const q=new URLSearchParams(location.search);const [upload,setUpload]=useState(false);const [preview,setPreview]=useState(q.has('preview')?s.documents[0]:undefined);
        return <><Documents onDoc={setPreview} onUpload={()=>setUpload(true)}/>{upload&&<UploadDocument companyId={s.companies[0].id} onClose={()=>setUpload(false)}/>}<Toaster/>
        {preview&&<DocumentPreview doc={preview} onClose={()=>setPreview(undefined)}/>}<span id="fixture-ready"/></>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "synthetic-document-storage", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "document-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "document-fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';
        const q=new URLSearchParams(location.search),listeners=new Set(),files=new Map();const state=createSeed();state.companies=state.companies.slice(0,1);state.companies[0].name='QA Cedar Title';state.orders=[];state.documents=[];
        if(q.has('preview'))state.documents.push({id:'qa-doc',companyId:state.companies[0].id,name:'QA source.txt',category:'Company records',visibility:'Internal',date:'2026-09-21',size:'1 KB',version:1,assetId:'qa-asset',mime:'text/plain'});
        let snapshot={s:state,connection:q.has('local')?undefined:{revision:1,access:{userId:'qa-user',email:'qa@example.test',role:'onboarding',allCompanies:true,companyIds:[],restricted:true}}};
        window.documentFixtureUpdates=[];window.documentFixtureUploads=[];window.documentFixtureState=()=>structuredClone(snapshot.s);
        export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(fn,title,detail)=>{const next=structuredClone(snapshot.s);fn(next);snapshot={...snapshot,s:next};window.documentFixtureUpdates.push({title,detail});listeners.forEach(fn=>fn());return true;}};}
        export async function saveAsset(id,file,binding){if(q.has('uploaderror'))throw Error('Synthetic upload failure');files.set(id,file);window.documentFixtureUploads.push({id,name:file.name,binding,text:await file.text()});}
        export async function getAsset(id){if(q.has('previewerror'))throw Error('Synthetic download failure');if(q.has('previewwait'))return new Promise(()=>{});return files.get(id)||new Blob(['Fictional company original'],{type:'text/plain'});}
        export const download=()=>{throw Error('Unexpected synthetic download');};
      ` }));
      builder.onResolve({ filter: /^\.\/(document-text-review|publications|deliveries)$/ }, args => ({ path: args.path, namespace: "document-child" }));
      builder.onLoad({ filter: /.*/, namespace: "document-child" }, args => ({ loader: "tsx", contents: `
        export const ${args.path.includes('document-text-review') ? 'DocumentTextReview' : args.path.includes('publications') ? 'PublicationManager' : 'DeliveryManager'}=()=>null;
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    if (new URL(req.url, "http://localhost").pathname === "/app.mjs") {
      res.writeHead(200, { "content-type": "text/javascript" });res.end(bundle.outputFiles[0].contents);
    } else {
      res.writeHead(200, { "content-type": "text/html" });res.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close();assert.deepEqual(errors, []); });
after(async () => { await browser?.close();if (server) { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); } });
async function open(query = "") {
  errors = [];context = await browser.newContext();
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request");return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();page.setDefaultTimeout(4000);page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);await page.locator("#fixture-ready").waitFor({ state: "attached" });
}
async function selectFile() {
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await page.getByLabel("Select documents", { exact: true }).setInputFiles({ name: "Fictional formation.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional company original") });
}
for (const local of [false, true]) {
  test(`${local ? "local demo" : "connected workspace"} explains its storage and accepts the original file unchanged`, async () => {
    await open(local ? "local=1" : "");
    const vault = await page.locator("body").innerText();
    assert.match(vault, local ? /Uploaded files stay in this browser/ : /Files are stored in your private workspace/);
    await selectFile();const copy = await page.getByRole("dialog").innerText();
    if (local) {
      assert.match(copy, /Use sample or redacted files in this local demo/);assert.match(copy, /not shared with your team/);
      assert.match(copy, /visibility labels do not grant team access/);assert.doesNotMatch(copy, /private workspace/);
    } else {
      assert.match(copy, /Upload original company and file documents you are authorized to use/);assert.match(copy, /company and document permissions apply/);
      assert.match(copy, /Saving does not email or publish these documents/);assert.doesNotMatch(copy, /sample or redacted|no production access controls|Nothing is sent to an external service|stay in this browser/);
    }
    await page.getByRole("button", { name: "Save documents", exact: true }).click();await page.getByRole("dialog").waitFor({ state: "detached" });
    const result = await page.evaluate(() => ({ updates: window.documentFixtureUpdates, uploads: window.documentFixtureUploads, state: window.documentFixtureState() }));
    assert.equal(result.updates[0].title, local ? "Documents saved locally" : "Documents saved to workspace");
    assert.equal(result.uploads.length, 1);assert.equal(result.uploads[0].text, "Fictional company original");assert.equal(result.uploads[0].binding.companyId, result.state.companies[0].id);
    assert.equal(result.state.documents[0].assetId, result.uploads[0].id);assert.equal(result.state.documents[0].visibility, "Internal");
  });
  test(`${local ? "local" : "connected"} upload failure reports the correct storage without claiming success`, async () => {
    await open(`${local ? "local=1&" : ""}uploaderror=1`);await selectFile();await page.getByRole("button", { name: "Save documents", exact: true }).click();
    await page.getByText(local ? "The file could not be stored in this browser. Try a smaller file." : "The upload could not be completed. Check your connection and company access, then try again.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1);assert.deepEqual(await page.evaluate(() => window.documentFixtureUpdates), []);
  });
  test(`${local ? "local" : "connected"} preview failure names the correct storage and recovery step`, async () => {
    await open(`${local ? "local=1&" : ""}preview=1&previewerror=1`);
    await page.getByText(local ? "This file is no longer available in this browser. Upload it again." : "This document could not be loaded from your workspace. Check your connection and document access, then reopen it.", { exact: true }).waitFor();
    if (!local) assert.doesNotMatch(await page.getByRole("dialog").innerText(), /in this browser|Upload it again/);
  });
}
test("connected preview loads without claiming the original is stored locally", async () => {
  await open("preview=1&previewwait=1");await page.getByText("Loading document…", { exact: true }).waitFor();
  assert.doesNotMatch(await page.getByRole("dialog").innerText(), /Loading local file/);
  assert.equal(await page.getByRole("combobox", { name: "Change document access" }).count(), 1);
});
