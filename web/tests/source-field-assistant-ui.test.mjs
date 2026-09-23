// Real capture UI, deterministic parser and replaceSourceFields command.
// Only document reading, asset retrieval and workspace persistence use fictional fixtures.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser, server, context, page, origin;
let errors = [], externalRequests = [];
before(async () => {
  const result = await build({ absWorkingDir: root, write: false, bundle: true, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {FinalSources} from './components/title/final-intake'; import {useWorkspace} from '@/lib/title/store';
      function App(){const {s,error}=useWorkspace();return <><FinalSources order={s.orders[0]}/>{error&&<p role="alert">{error}</p>}<span id="ready"/></>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, plugins: [{ name: "source-suggestion-fixture", setup(build) {
      build.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
      build.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: root, contents: `
        import {useSyncExternalStore} from 'react'; import {createSeed} from './lib/title/model'; import {neededFields,titleFile} from './lib/title/production';
        const listeners=new Set();let snapshot={s:createSeed(),error:''};const emit=()=>listeners.forEach(fn=>fn());
        function change(state,kind){const o=state.orders[0],d=state.documents[0];if(kind==='document-version')d.version++;if(kind==='document-asset')d.assetId='replacement-asset';if(kind==='order-version')o.production={...titleFile(o),version:titleFile(o).version+1};if(kind==='remove-document')state.documents=[];}
        window.configureCaptureFixture=(config)=>{
          const state=createSeed(),o=state.orders[0];o.status='Needs review';o.client='Original recorded insured';o.fields=[];o.production={...titleFile(o),loanAmount:111111,version:7};state.inbox=[];
          const pdf=config.kind==='pdf',role=config.role||'Deed';
          state.documents=[{id:'original',companyId:o.companyId,orderId:o.id,sourceRole:role,name:pdf?'Fictional original.pdf':'Fictional excerpt.txt',text:'Fictional source text',version:1,category:'Policy documents',visibility:'Internal',date:'2026-09-23',size:'1 KB',...(pdf?{assetId:'fictional-asset',mime:'application/pdf'}:{mime:'text/plain'})}];
          window.captureDefs=neededFields(o).filter(f=>f.role===role);window.captureReadConfig=config;window.captureSaves=[];window.captureAttempts=0;window.captureError='';window.assetReads=[];window.readCalls=[];window.pendingReads=[];window.readSettled=0;window.beforeCaptureSave='';
          snapshot={s:state,error:'',connection:config.connected?{workspaceId:'workspace-a',access:{userId:'qa-actor',version:1,role:'owner',allCompanies:true,restricted:true}}:undefined};emit();
        };
        window.captureFixture=()=>structuredClone(snapshot.s);
        window.mutateCaptureFixture=(kind)=>{const next=structuredClone(snapshot.s);change(next,kind);snapshot={...snapshot,s:next};emit()};
        window.switchCaptureWorkspace=()=>{const next=structuredClone(snapshot.s);next.user='Second workspace staff';next.orders[0].client='Other workspace insured';next.orders[0].production.loanAmount=222222;next.orders[0].fields=[];snapshot={s:next,error:'',connection:{...snapshot.connection,workspaceId:'workspace-b'}};emit()};
        window.configureCaptureFixture({kind:'source-text',pages:[],totalPages:1,unreadPages:[],notes:[]});
        export function useWorkspace(){const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...value,update:async(fn,title)=>{
          window.captureAttempts++;try{const next=structuredClone(snapshot.s);if(window.beforeCaptureSave)change(next,window.beforeCaptureSave);fn(next);snapshot={...snapshot,s:next,error:''};window.captureSaves.push(title);emit();return true}catch(error){snapshot={...snapshot,error:error.message};window.captureError=error.message;emit();return false}
        }};}
        export const download=()=>{};
        export async function getAsset(id){window.assetReads.push(id);return new Blob(['%PDF-fictional-transport-only'],{type:'application/pdf'})}
      ` }));
      build.onResolve({ filter: /^@\/lib\/title\/source-field-reader$/ }, () => ({ path: "reader", namespace: "fixture" }));
      build.onLoad({ filter: /^reader$/, namespace: "fixture" }, () => ({ loader: "js", contents: `
        export async function readFieldSource(doc,blob,options){
          const config=structuredClone(window.captureReadConfig),result={pages:config.pages,totalPages:config.totalPages||config.pages.length,unreadPages:config.unreadPages||[],notes:config.notes||[]};
          const call={documentId:doc.id,version:doc.version,hasBlob:!!blob,blobType:blob?.type,scanPages:options.scanPages,rotation:options.rotation,signal:options.signal};window.readCalls.push(call);
          options.onProgress?.('Reading fictional source pages…');
          if(config.pending)await new Promise(resolve=>window.pendingReads.push(resolve));
          // Deliberately resolve even after abort to verify the UI discards late transport results.
          window.readSettled++;options.onProgress?.('Fictional source complete');return result;
        }
      ` }));
      build.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "worker", namespace: "child" }));
      build.onResolve({ filter: /^\.\/documents$/ }, () => ({ path: "documents", namespace: "child" }));
      build.onResolve({ filter: /^\.\/followups$/ }, () => ({ path: "followups", namespace: "child" }));
      build.onLoad({ filter: /.*/, namespace: "child" }, args => ({ contents: args.path === "worker" ? 'export default "/unused-worker.mjs";' : "export const UploadDocument=()=>null,DocumentPreview=()=>null,AttorneyFollowups=()=>null;" }));
    } }] });
  server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/app.mjs" ? "text/javascript" : "text/html");
    response.end(request.url === "/app.mjs" ? result.outputFiles[0].text : '<!doctype html><div id="root"></div><script type="module" src="/app.mjs"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); assert.deepEqual(externalRequests, [], "source analysis made an external request"); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });

const deedValues = { name: "Ada R. Example, an unmarried woman", deedDated: "September 13, 2026", date: "2026-09-14", time: "14:15:09", reference: "1234 / 567" };
const deedText = `Grantee: ${deedValues.name}\nDeed dated date: ${deedValues.deedDated}\nDeed recording date: ${deedValues.date}\nDeed recording time: ${deedValues.time}\nDeed book / page: ${deedValues.reference}`;
const source = (text, number = 1, method = "source-text", confidence) => ({ page: number, text, method, ...(confidence === undefined ? {} : { confidence }) });
const saveButton = () => page.getByRole("button", { name: "Save for field review", exact: true });
const acknowledgement = () => page.getByRole("checkbox", { name: "I compared every captured value with the original, including any unread pages.", exact: true });
const input = id => page.locator(`input[name="${id}"]`);
async function open(config = { kind: "source-text", pages: [source(deedText)] }) {
  errors = []; externalRequests = [];
  context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.route("**/*", async route => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    externalRequests.push(route.request().url()); await route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.locator("#ready").waitFor({ state: "attached" });
  await page.evaluate(value => window.configureCaptureFixture(value), config);
  await page.getByRole("button", { name: "Capture fields", exact: true }).click();
  await page.getByRole("dialog").waitFor();
}
async function analyze() {
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).click();
  await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).waitFor();
}
async function bulkFill() { await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).click(); }
async function snapshot() { return page.evaluate(() => window.captureFixture()); }
async function finishLateRead() {
  await page.evaluate(() => { const resolve = window.pendingReads.shift(); if (!resolve) throw new Error("No pending fixture read"); resolve(); });
  await page.waitForFunction(() => window.readSettled === 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("source-text suggestions retain quotes, require source reference and review, and save unapproved fields", async () => {
  await open(); const original = await snapshot(); await analyze();
  assert.equal(await input("name").inputValue(), "", "analysis itself must not fill fields");
  assert.ok((await page.locator("blockquote").allTextContents()).includes(`Grantee: ${deedValues.name}`));
  assert.equal((await snapshot()).orders[0].fields.length, 0);
  await bulkFill();
  for (const [id, value] of Object.entries(deedValues)) assert.equal(await input(id).inputValue(), value);
  assert.equal(await input("page").inputValue(), "", "an excerpt must not invent an original page");
  assert.equal(await saveButton().isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
  await acknowledgement().check(); assert.equal(await saveButton().isEnabled(), true);
  await saveButton().click(); assert.equal(await page.evaluate(() => window.captureAttempts), 0, "required original reference blocks submit");
  await input("page").fill("Original deed, page 2, recording stamp");
  assert.equal(await acknowledgement().isChecked(), false); assert.equal(await saveButton().isDisabled(), true);
  await acknowledgement().check(); await saveButton().click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  const saved = await snapshot(), order = saved.orders[0];
  assert.equal(order.status, "Needs review"); assert.equal(order.client, original.orders[0].client); assert.equal(order.production.loanAmount, original.orders[0].production.loanAmount);
  for (const field of order.fields) {
    assert.equal(field.sourceValue, deedValues[field.id]); assert.equal(field.proposed, deedValues[field.id]);
    assert.equal(field.reviewed, false); assert.equal(field.documentId, "original");
    assert.equal(field.sourcePage, "Original deed, page 2, recording stamp");
    assert.equal(field.captureEvidence.method, "source-text"); assert.equal(field.captureEvidence.documentVersion, 1);
    assert.equal(field.captureEvidence.suggestedValue, deedValues[field.id]); assert.equal(field.captureEvidence.corrected, false);
    assert.ok(deedText.includes(field.captureEvidence.quote));
  }
  assert.deepEqual(await page.evaluate(() => window.assetReads), []);
  assert.deepEqual(await page.evaluate(() => window.captureSaves), ["Source values captured"]);
});

test("PDF and OCR candidates preserve physical-page evidence while corrections reset acknowledgement", async () => {
  const pages = [source("Loan amount: $250,000.00\nDeed of trust dated date: September 12, 2026\nTrustee: Fictional Trustee Services, Inc.", 2, "pdf-text"), source("Deed of trust recording date: 2026-09-14\nDOT recording time: 14:15:09\nMortgage instrument number: 2026-001234", 3, "ocr", 91.4)];
  await open({ kind: "pdf", role: "Deed of trust", pages, totalPages: 4, unreadPages: [1, 4], notes: ["Fictional mixed-page reader result"] });
  const original = await snapshot(); await analyze();
  assert.match(await page.getByRole("region", { name: "Source field suggestions" }).textContent(), /Unread pages: 1, 4/);
  await bulkFill(); assert.equal(await input("loanAmount").inputValue(), "$250,000.00");
  assert.equal(await input("page").inputValue(), "PDF page 2; PDF page 3 · OCR 0°");
  assert.equal(await saveButton().isDisabled(), true);
  await acknowledgement().check(); await input("loanAmount").fill("$251,000.00");
  assert.equal(await acknowledgement().isChecked(), false); assert.equal(await saveButton().isDisabled(), true);
  await acknowledgement().check(); await input("page").fill("Pages 2–3; unread pages checked manually");
  assert.equal(await acknowledgement().isChecked(), false);
  await acknowledgement().check(); await saveButton().click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  const saved = (await snapshot()).orders[0], amount = saved.fields.find(field => field.id === "loanAmount"), date = saved.fields.find(field => field.id === "dotDate");
  assert.equal(amount.sourceValue, "$251,000.00"); assert.equal(amount.captureEvidence.suggestedValue, "$250,000.00"); assert.equal(amount.captureEvidence.corrected, true);
  assert.equal(amount.captureEvidence.quote, "Loan amount: $250,000.00"); assert.equal(amount.sourcePage, "PDF page 2");
  assert.equal(date.captureEvidence.method, "ocr"); assert.equal(date.captureEvidence.engineConfidence, 91.4); assert.equal(date.sourcePage, "PDF page 3 · OCR 0°");
  assert.ok(saved.fields.every(field => !field.reviewed)); assert.equal(saved.production.loanAmount, original.orders[0].production.loanAmount); assert.equal(saved.client, original.orders[0].client);
  assert.deepEqual(await page.evaluate(() => window.assetReads), ["fictional-asset"]);
  assert.deepEqual(await page.evaluate(() => window.readCalls.map(call => ({ hasBlob: call.hasBlob, blobType: call.blobType }))), [{ hasBlob: true, blobType: "application/pdf" }]);
});

test("ambiguous values need an explicit choice and missing fields remain required", async () => {
  const first = "Grantee: Ada Example\nDeed dated date: September 13, 2026\nDeed recording date: 2026-09-14\nDeed recording time: 14:15:09";
  await open({ kind: "pdf", pages: [source(first, 1, "pdf-text"), source("Grantee: Bea Example", 2, "pdf-text")] });
  await analyze(); await bulkFill();
  assert.equal(await input("name").inputValue(), ""); assert.equal(await input("reference").inputValue(), "");
  assert.equal(await input("date").inputValue(), "2026-09-14");
  await acknowledgement().check();
  await page.getByRole("button", { name: "Use Vesting / grantee name from page 2", exact: true }).click();
  assert.equal(await input("name").inputValue(), "Bea Example"); assert.equal(await acknowledgement().isChecked(), false);
  await acknowledgement().check(); await saveButton().click();
  assert.equal(await page.evaluate(() => window.captureAttempts), 0); assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
  assert.equal(await input("reference").evaluate(element => element.validity.valueMissing), true);
  await input("reference").fill("9876 / 543"); assert.equal(await acknowledgement().isChecked(), false);
  await acknowledgement().check(); await saveButton().click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  const fields = (await snapshot()).orders[0].fields, name = fields.find(field => field.id === "name"), reference = fields.find(field => field.id === "reference");
  assert.equal(name.captureEvidence.quote, "Grantee: Bea Example"); assert.equal(name.sourcePage, "PDF page 2"); assert.equal(name.captureEvidence.corrected, false);
  assert.equal(reference.captureEvidence, undefined); assert.equal(reference.reviewed, false);
});

for (const confidence of [undefined, 79]) test(`OCR confidence ${confidence === undefined ? "missing" : confidence} keeps the candidate out of bulk filling`, async () => {
  await open({ kind: "pdf", pages: [source(deedText.split("\n").slice(1).join("\n"), 1, "pdf-text"), source(`Grantee: ${deedValues.name}`, 2, "ocr", confidence)] });
  await analyze(); await bulkFill();
  assert.equal(await input("name").inputValue(), ""); assert.equal(await input("date").inputValue(), deedValues.date);
  assert.match(await page.getByRole("region", { name: "Source field suggestions" }).textContent(), /not eligible for automatic filling/);
  await page.getByRole("button", { name: "Use Vesting / grantee name from page 2", exact: true }).click();
  assert.equal(await input("name").inputValue(), deedValues.name); assert.equal(await acknowledgement().isChecked(), false); assert.equal(await saveButton().isDisabled(), true);
  assert.equal((await snapshot()).orders[0].fields.length, 0); assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
});

test("a document changed during analysis discards the old result and remounts empty capture", async () => {
  await open({ kind: "pdf", pages: [source(deedText, 1, "pdf-text")], pending: true });
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).click(); await page.waitForFunction(() => window.pendingReads.length === 1);
  await page.evaluate(() => window.mutateCaptureFixture("document-version"));
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).waitFor();
  await finishLateRead();
  assert.equal(await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).count(), 0);
  assert.equal(await input("name").inputValue(), ""); assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
  assert.equal(await page.evaluate(() => window.readCalls[0].signal.aborted), true);
  assert.equal((await snapshot()).orders[0].fields.length, 0);
});

test("an order changed during analysis cannot save its later suggestions", async () => {
  await open({ kind: "pdf", pages: [source(deedText, 1, "pdf-text")], pending: true });
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).click(); await page.waitForFunction(() => window.pendingReads.length === 1);
  await page.evaluate(() => window.mutateCaptureFixture("order-version")); await finishLateRead();
  await bulkFill(); await acknowledgement().check(); await saveButton().click();
  assert.match(await page.evaluate(() => window.captureError), /document or file changed/);
  assert.deepEqual(await page.evaluate(() => window.captureSaves), []); assert.equal((await snapshot()).orders[0].fields.length, 0);
  assert.equal(await page.getByRole("dialog").count(), 1);
});

for (const change of ["document-version", "document-asset", "order-version"]) test(`concurrent ${change} at save rejects the capture atomically`, async () => {
  await open({ kind: "pdf", pages: [source(deedText, 1, "pdf-text")] }); await analyze(); await bulkFill(); await acknowledgement().check();
  const original = await snapshot(); await page.evaluate(value => { window.beforeCaptureSave = value; }, change); await saveButton().click();
  assert.match(await page.evaluate(() => window.captureError), /document or file changed/);
  assert.deepEqual(await page.evaluate(() => window.captureSaves), []); assert.deepEqual(await snapshot(), original);
  assert.equal(await page.getByRole("dialog").count(), 1);
});

test("cancelled analysis ignores a late successful response and does not fill or save", async () => {
  await open({ kind: "pdf", pages: [source(deedText, 1, "pdf-text")], pending: true });
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).click(); await page.waitForFunction(() => window.pendingReads.length === 1);
  await page.getByRole("button", { name: "Cancel reading", exact: true }).click();
  assert.match(await page.getByRole("alert").textContent(), /Reading cancelled/);
  await finishLateRead();
  assert.equal(await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).count(), 0);
  assert.equal(await input("name").inputValue(), ""); assert.equal(await page.evaluate(() => window.readCalls[0].signal.aborted), true);
  assert.equal((await snapshot()).orders[0].fields.length, 0); assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
});

test("same-ID workspace switch clears filled suggestions, evidence and acknowledgement", async () => {
  await open({ kind: "pdf", pages: [source(deedText, 1, "pdf-text")], connected: true });
  await analyze(); await bulkFill(); await acknowledgement().check();
  assert.equal(await input("name").inputValue(), deedValues.name);
  await page.evaluate(() => window.switchCaptureWorkspace());
  assert.equal(await input("name").inputValue(), ""); assert.equal(await input("page").inputValue(), "");
  assert.equal(await acknowledgement().count(), 0);
  assert.equal(await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).count(), 0);
  await saveButton().click(); assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
  const order = (await snapshot()).orders[0];
  assert.equal(order.fields.length, 0); assert.equal(order.client, "Other workspace insured"); assert.equal(order.production.loanAmount, 222222);
});

test("same-ID workspace switch discards an in-flight read from the former workspace", async () => {
  await open({ kind: "pdf", pages: [source(deedText, 1, "pdf-text")], connected: true, pending: true });
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).click(); await page.waitForFunction(() => window.pendingReads.length === 1);
  await page.evaluate(() => window.switchCaptureWorkspace()); await finishLateRead();
  assert.equal(await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).count(), 0);
  assert.equal(await input("name").inputValue(), ""); assert.equal(await acknowledgement().count(), 0);
  assert.equal(await page.evaluate(() => window.readCalls[0].signal.aborted), true);
  assert.equal((await snapshot()).orders[0].fields.length, 0); assert.deepEqual(await page.evaluate(() => window.captureSaves), []);
});
