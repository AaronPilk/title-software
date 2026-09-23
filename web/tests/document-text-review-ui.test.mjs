// Real document review component and citations; fictional workspace and controlled
// OCR completion only. The fixture cannot contact external document/OCR services.
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
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {DocumentTextReview} from './components/title/document-text-review';import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();return s.documents[0]?<DocumentTextReview doc={s.documents[0]}/>:null;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fictional-document-review", setup(builder) {
      builder.onResolve({ filter: /^(?:@\/lib\/title\/|\.\/)(store|local-ocr|pdf-text)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "review-fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "review-fixture" }, () => ({ loader: "js", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';
        const initial={id:'qa-review-doc',companyId:'qa-company',name:'Fictional deed.png',category:'Recorded document',visibility:'Internal',date:'2026-09-22',size:'1 KB',version:3,assetId:'qa-asset',mime:'image/png'};
        const listeners=new Set();let snapshot={s:{documents:[initial]},connection:{workspaceId:'workspace-a',access:{userId:'actor-a',version:1}}};
        const emit=()=>listeners.forEach(fn=>fn());
        window.configureDocumentReview=(config={})=>{window.reviewPageCount=config.pages||1;window.reviewAssetReads=0;snapshot={...snapshot,s:{documents:[{...initial,...config.doc}]}};emit()};
        window.changeDocumentReview=(kind)=>{const next=structuredClone(snapshot);if(kind==='account')next.connection.access.userId='actor-b';else if(kind==='access')next.connection.access.version++;else if(kind==='workspace')next.connection.workspaceId='workspace-b';else if(kind==='remove')next.s.documents=[];else next.s.documents[0]={...next.s.documents[0],...kind};snapshot=next;emit()};
        window.configureDocumentReview();
        export const useWorkspace=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);
        export async function getAsset(){window.reviewAssetReads++;return new Blob(['fictional scan'],{type:snapshot.s.documents[0].mime});}
      ` }));
      builder.onLoad({ filter: /^pdf-text$/, namespace: "review-fixture" }, () => ({ loader: "js", resolveDir: web, contents: `
        export {pdfPageCitation} from './lib/title/pdf-text';
        export async function extractPdfText(){return {totalPages:window.reviewPageCount,pages:Array.from({length:window.reviewPageCount},(_,i)=>({page:i+1,text:'',status:'empty'})),message:'Fixture PDF'};}
      ` }));
      builder.onLoad({ filter: /^local-ocr$/, namespace: "review-fixture" }, () => ({ loader: "js", resolveDir: web, contents: `
        export {OcrError,ocrCitation} from './lib/title/local-ocr-shared';
        window.ocrFixture={calls:[],pending:[]};
        export async function recognizeDocumentPage(file,page,options){
          window.ocrFixture.calls.push({page,rotation:options.rotation});
          options.onProgress?.({phase:'Recognizing fixture',progress:0.5});
          return new Promise((resolve,reject)=>window.ocrFixture.pending.push({resolve,reject,page,rotation:options.rotation}));
        }
      ` }));
      builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "/unused-pdf-worker.mjs", namespace: "worker-url" }));
      builder.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({ contents: 'export default "/unused-pdf-worker.mjs";' }));
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

const button = name => page.getByRole("button", { name, exact: true });
const confirmation = () => page.getByRole("checkbox", { name: "I compared this OCR result with the original document.", exact: true });
const recognized = () => page.getByRole("textbox", { name: "Recognized OCR page text", exact: true });
async function open(config) {
  errors = [];context = await browser.newContext();
  await context.addInitScript(() => {
    window.copiedExcerpts = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.copiedExcerpts.push(text); } } });
  });
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request");return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();page.setDefaultTimeout(4000);page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  if (config) await page.evaluate(config=>window.configureDocumentReview(config),config);
  else {await button("Read image with OCR").click();await complete("Fictional grantor: Alice Cedar");}
}
async function complete(text, waitForText = true) {
  await page.waitForFunction(() => window.ocrFixture?.pending.length > 0);
  await page.evaluate(text => {const task=window.ocrFixture.pending.shift();task.resolve({ text, confidence: 91, words: [], page: task.page, width: 800, height: 1000, rotation: task.rotation, language: "English", engine: "Tesseract.js 7.0.0" });}, text);
  if (waitForText) await page.waitForFunction(text => document.querySelector('textarea[aria-label="Recognized OCR page text"]')?.value === text, text);
}
async function selectRecognized() {
  await recognized().focus();await recognized().press("ControlOrMeta+A");
  assert.equal(await recognized().evaluate(text => text.selectionEnd - text.selectionStart), (await recognized().inputValue()).length);
}

test("rerunning OCR cannot carry confirmation of the previous result into replacement text", async () => {
  await open();await confirmation().check();
  await button("Run OCR again").click();await page.waitForFunction(() => window.ocrFixture.pending.length === 1);
  assert.equal(await confirmation().count(), 0, "old OCR target is removed before replacement reading");
  await complete("Fictional grantor: Bob Maple");
  assert.equal(await confirmation().isChecked(), false, "replacement OCR text needs a fresh review");
  assert.equal(await button("Copy reviewed OCR page with source").isDisabled(), true);
  await confirmation().check();await button("Copy reviewed OCR page with source").click();
  const copied = await page.evaluate(() => window.copiedExcerpts);
  assert.equal(copied.length, 1);assert.match(copied[0], /Bob Maple/);assert.doesNotMatch(copied[0], /Alice Cedar/);
  assert.match(copied[0], /Fictional deed\.png · version 3 · Image 1/);assert.match(copied[0], /Document: qa-review-doc/);
});

test("replacement OCR clears an excerpt selected from the previous text during processing", async () => {
  await open();await button("Run OCR again").click();await page.waitForFunction(() => window.ocrFixture.pending.length === 1);
  assert.equal(await recognized().count(),0);await complete("Fictional grantee: Willow Lake");await confirmation().check();
  assert.equal(await button("Copy reviewed OCR excerpt with source").isDisabled(), true, "an old selection is not an excerpt from the replacement result");
  assert.deepEqual(await page.evaluate(() => window.copiedExcerpts), []);
  await selectRecognized();await button("Copy reviewed OCR excerpt with source").click();
  const copied = await page.evaluate(() => window.copiedExcerpts);
  assert.equal(copied.length, 1);assert.match(copied[0], /Willow Lake/);assert.doesNotMatch(copied[0], /Alice Cedar/);
});

test("cancelled OCR discards late replacement; unfinished target stays unread until retried", async () => {
  await open();await confirmation().check();await button("Run OCR again").click();
  await page.waitForFunction(() => window.ocrFixture.pending.length === 1);await button("Cancel").click();
  await complete("Cancelled replacement", false);
  await page.getByRole("alert").filter({hasText:"Reading cancelled"}).waitFor();
  assert.equal(await recognized().count(), 0);assert.equal(await confirmation().count(), 0);
  assert.deepEqual(await page.evaluate(()=>window.copiedExcerpts),[]);
  await button("Resume / retry unread pages").click();await complete("Recovered page");
  assert.equal(await confirmation().isChecked(),false);
  await confirmation().check();await button("Copy reviewed OCR page with source").click();
  assert.match((await page.evaluate(() => window.copiedExcerpts))[0], /Recovered page/);
});

test("whole PDF cancel retains completed pages; resume reads unfinished pages and preserves physical citation", async () => {
  await open({pages:3,doc:{name:'Fictional package.pdf',mime:'application/pdf'}});
  await button("Read whole document").click();await complete("Page one original",false);
  await page.waitForFunction(()=>window.ocrFixture.pending[0]?.page===2);
  await button("Cancel").click();await complete("Cancelled page two",false);
  assert.equal(await recognized().inputValue(),"Page one original");
  await button("Resume / retry unread pages").click();
  await page.waitForFunction(()=>window.ocrFixture.pending[0]?.page===2);
  await complete("Page two original",false);await complete("Page three original",false);
  await button("Read whole document").waitFor();
  assert.deepEqual(await page.evaluate(()=>window.ocrFixture.calls.map(c=>c.page)),[1,2,2,3]);
  assert.equal(await page.evaluate(()=>window.reviewAssetReads),1,"resume reuses exact original blob");
  await page.getByRole("combobox",{name:"PDF text page"}).selectOption('3');
  assert.equal(await recognized().inputValue(),"Page three original");await confirmation().check();await button("Copy reviewed OCR page with source").click();
  assert.match((await page.evaluate(()=>window.copiedExcerpts))[0],/PDF page 3/);
});

test("a failed middle page does not stop the package; retry and rotated reread retain other pages", async () => {
  await open({pages:3,doc:{name:'Fictional package.pdf',mime:'application/pdf'}});
  await button("Read whole document").click();await complete("Page one original",false);
  await page.waitForFunction(()=>window.ocrFixture.pending[0]?.page===2);
  await page.evaluate(()=>window.ocrFixture.pending.shift().reject(new Error('Fixture unreadable page')));
  await complete("Page three original",false);await button("Read whole document").waitFor();
  await page.getByText('Pages needing attention (1)',{exact:true}).waitFor();
  await button("Resume / retry unread pages").click();await complete("Page two recovered",false);await button("Read whole document").waitFor();
  await page.getByRole("combobox",{name:"PDF text page"}).selectOption('2');await confirmation().check();
  await page.getByRole("combobox",{name:"Page orientation for OCR"}).selectOption('90');assert.equal(await confirmation().isChecked(),false);
  await button("Run OCR again").click();await complete("Rotated page two");await confirmation().check();await button("Copy reviewed OCR page with source").click();
  assert.match((await page.evaluate(()=>window.copiedExcerpts))[0],/rotated 90°/);
  await page.getByRole("combobox",{name:"PDF text page"}).selectOption('1');assert.equal(await recognized().inputValue(),"Page one original");assert.equal(await confirmation().isChecked(),false);
  await page.getByRole("combobox",{name:"PDF text page"}).selectOption('3');assert.equal(await recognized().inputValue(),"Page three original");
  assert.deepEqual(await page.evaluate(()=>window.ocrFixture.calls.map(c=>c.page)),[1,2,3,2,2]);
});

for (const change of ['account','workspace','access',{companyId:'other-company'},{version:4},{assetId:'other-asset'}]) test(`changing ${JSON.stringify(change)} clears reviewed text and rejects a late old scan`, async()=>{
  await open();await confirmation().check();await button("Run OCR again").click();await page.waitForFunction(()=>window.ocrFixture.pending.length===1);
  await page.evaluate(change=>window.changeDocumentReview(change),change);await complete("Other identity must not see this",false);
  await button("Read image with OCR").waitFor();assert.equal(await recognized().count(),0);assert.equal(await confirmation().count(),0);
  assert.deepEqual(await page.evaluate(()=>window.copiedExcerpts),[]);
});
