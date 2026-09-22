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
      function App(){const {s}=useWorkspace();return <DocumentTextReview doc={s.documents[0]}/>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fictional-document-review", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/(store|local-ocr)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "review-fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "review-fixture" }, () => ({ loader: "js", contents: `
        const doc={id:'qa-review-doc',companyId:'qa-company',name:'Fictional deed.png',category:'Recorded document',visibility:'Internal',date:'2026-09-22',size:'1 KB',version:3,assetId:'qa-asset',mime:'image/png'};
        export const useWorkspace=()=>({s:{documents:[doc]}});
        export async function getAsset(){return new Blob(['fictional scan'],{type:'image/png'});}
      ` }));
      builder.onLoad({ filter: /^local-ocr$/, namespace: "review-fixture" }, () => ({ loader: "js", resolveDir: web, contents: `
        export {OcrError,ocrCitation} from './lib/title/local-ocr-shared';
        window.ocrFixture={calls:[],pending:[]};
        export async function recognizeDocumentPage(file,page,options){
          window.ocrFixture.calls.push({page,rotation:options.rotation});
          options.onProgress?.({phase:'Recognizing fixture',progress:0.5});
          return new Promise((resolve,reject)=>window.ocrFixture.pending.push({resolve,reject}));
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
async function open() {
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
  await page.goto(origin);await button("Read image with OCR").click();await complete("Fictional grantor: Alice Cedar");
}
async function complete(text) {
  await page.waitForFunction(() => window.ocrFixture?.pending.length > 0);
  await page.evaluate(text => window.ocrFixture.pending.shift().resolve({ text, confidence: 91, words: [], page: 1, width: 800, height: 1000, rotation: 0, language: "English", engine: "Fixture OCR" }), text);
  await page.waitForFunction(text => document.querySelector('textarea[aria-label="Recognized OCR page text"]')?.value === text, text);
}
async function selectRecognized() {
  await recognized().focus();await recognized().press("ControlOrMeta+A");
  assert.equal(await recognized().evaluate(text => text.selectionEnd - text.selectionStart), (await recognized().inputValue()).length);
}

test("rerunning OCR cannot carry confirmation of the previous result into replacement text", async () => {
  await open();await confirmation().check();
  await button("Run OCR again").click();await page.waitForFunction(() => window.ocrFixture.pending.length === 1);
  const confirmationWasDisabled = await confirmation().isDisabled();
  // Before the fix an operator could confirm the old, still visible result here.
  if (!confirmationWasDisabled) await confirmation().check();
  await complete("Fictional grantor: Bob Maple");
  assert.equal(await confirmation().isChecked(), false, "replacement OCR text needs a fresh review");
  assert.equal(confirmationWasDisabled, true, "previous OCR result cannot be confirmed while processing");
  assert.equal(await button("Copy reviewed OCR page with source").isDisabled(), true);
  await confirmation().check();await button("Copy reviewed OCR page with source").click();
  const copied = await page.evaluate(() => window.copiedExcerpts);
  assert.equal(copied.length, 1);assert.match(copied[0], /Bob Maple/);assert.doesNotMatch(copied[0], /Alice Cedar/);
  assert.match(copied[0], /Fictional deed\.png · version 3 · Image 1/);assert.match(copied[0], /Document: qa-review-doc/);
});

test("replacement OCR clears an excerpt selected from the previous text during processing", async () => {
  await open();await button("Run OCR again").click();await page.waitForFunction(() => window.ocrFixture.pending.length === 1);
  await selectRecognized();await complete("Fictional grantee: Willow Lake");await confirmation().check();
  assert.equal(await button("Copy reviewed OCR excerpt with source").isDisabled(), true, "an old selection is not an excerpt from the replacement result");
  assert.deepEqual(await page.evaluate(() => window.copiedExcerpts), []);
  await selectRecognized();await button("Copy reviewed OCR excerpt with source").click();
  const copied = await page.evaluate(() => window.copiedExcerpts);
  assert.equal(copied.length, 1);assert.match(copied[0], /Willow Lake/);assert.doesNotMatch(copied[0], /Alice Cedar/);
});

test("cancelled OCR ignores a late replacement and requires review before copying the retained result", async () => {
  await open();await confirmation().check();await button("Run OCR again").click();
  await page.waitForFunction(() => window.ocrFixture.pending.length === 1);await button("Cancel").click();
  await page.evaluate(() => window.ocrFixture.pending.shift().resolve({ text: "Cancelled replacement", confidence: 90, words: [], page: 1, width: 800, height: 1000, rotation: 0 }));
  await page.getByText("Document text review was cancelled.", { exact: true }).waitFor();
  assert.equal(await recognized().inputValue(), "Fictional grantor: Alice Cedar");assert.equal(await confirmation().isChecked(), false);
  assert.equal(await button("Copy reviewed OCR page with source").isDisabled(), true);
  await confirmation().check();await button("Copy reviewed OCR page with source").click();
  assert.match((await page.evaluate(() => window.copiedExcerpts))[0], /Alice Cedar/);
});
