// Actual React controls -> reader -> PDF.js -> Tesseract -> suggestions/citations.
// Only workspace storage is fictional; every PDF below is generated in this test.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let browser, server, context, page, origin;
let errors = [], requests = [];
before(async () => {
  const plugin = { name: "whole-document-fixture", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
    builder.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
      import {useSyncExternalStore} from 'react';
      const listeners=new Set();let snapshot={s:{documents:[]},connection:{workspaceId:'fictional-workspace',access:{userId:'fictional-owner',version:1}}};
      window.fills=[];window.assetReads=0;
      window.installDocument=(blob)=>{window.original=blob;snapshot={...snapshot,s:{documents:[{id:'fictional-package',companyId:'fictional-company',orderId:'fictional-order',assetId:'fictional-asset',name:'Fictional 30-page package.pdf',version:1,mime:'application/pdf',sourceRole:'Deed of trust'}]}};listeners.forEach(fn=>fn());};
      export const useWorkspace=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);
      export async function getAsset(){window.assetReads++;return window.original;}
    ` }));
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "/pdf.worker.mjs", namespace: "worker-url" }));
    builder.onResolve({ filter: /local-ocr\.worker\.ts\?worker&url$/ }, () => ({ path: "/local-ocr.worker.js", namespace: "worker-url" }));
    builder.onLoad({ filter: /.*/, namespace: "worker-url" }, args => ({ contents: `export default ${JSON.stringify(args.path)};` }));
  } };
  const [entry, worker] = await Promise.all([
    build({ absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", target: "es2022", logLevel: "silent", loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], stdin: { resolveDir: web, loader: "tsx", contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {SourceFieldAssistant} from './components/title/source-field-assistant';
        import {DocumentTextReview} from './components/title/document-text-review';
        import {useWorkspace} from '@/lib/title/store';
        const defs=[{id:'loanAmount',label:'Confirmed loan amount'}];
        function App(){const {s}=useWorkspace();return s.documents[0] ? (location.hash==='#text' ? <DocumentTextReview doc={s.documents[0]}/> : <SourceFieldAssistant doc={s.documents[0]} defs={defs} onFill={values=>window.fills.push(values)}/>) : <p>Choose fictional document</p>;}
        createRoot(document.getElementById('root')).render(<App/>);
      ` } }),
    build({ absWorkingDir: web, entryPoints: ["lib/title/local-ocr.worker.ts"], write: false, bundle: true, platform: "browser", format: "iife", target: "es2022", logLevel: "silent" }),
  ]);
  const assets = new Map([
    ["/pdf.worker.mjs", "pdfjs-dist/legacy/build/pdf.worker.min.mjs"],
    ["/ocr/v7-eng1/worker.min.js", "tesseract.js/dist/worker.min.js"],
    ["/ocr/v7-eng1/eng.traineddata.gz", "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"],
    ...["", "-simd", "-relaxedsimd", "-lstm", "-simd-lstm", "-relaxedsimd-lstm"].map(variant => [`/ocr/v7-eng1/tesseract-core${variant}.wasm.js`, `tesseract.js-core/tesseract-core${variant}.wasm.js`]),
  ]);
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/") { res.writeHead(200, { "content-type": "text/html" });res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');return; }
      const bytes = path === "/app.mjs" ? entry.outputFiles[0].contents : path === "/local-ocr.worker.js" ? worker.outputFiles[0].contents : assets.has(path) ? await readFile(resolve(web, "node_modules", assets.get(path))) : null;
      if (!bytes) { res.writeHead(404);res.end();return; }
      res.writeHead(200, { "content-type": /\.(mjs|js)$/.test(path) ? "text/javascript" : "application/octet-stream", "cache-control": "no-store" });res.end(bytes);
    } catch { res.writeHead(500);res.end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close();assert.deepEqual(errors, []); });
after(async () => { await browser?.close();if (server) { server.closeAllConnections();await new Promise(done => server.close(done)); } });

async function open(kind, allScanned) {
  errors = [];requests = [];
  context = await browser.newContext({ viewport: { width: 1100, height: 950 } });
  await context.addInitScript(() => {
    window.copiedExcerpts = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => window.copiedExcerpts.push(text) } });
  });
  await context.route("**/*", route => {
    const url = route.request().url();requests.push(url);
    if (!url.startsWith(`${origin}/`)) { errors.push(`Unexpected request to ${new URL(url).origin}`);return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/#${kind}`);await page.waitForFunction(() => !!window.installDocument);
  await page.evaluate(async allScanned => {
    const count = 30, encoder = new TextEncoder(), chunks = [], offsets = [];
    const objects = [["<< /Type /Catalog /Pages 2 0 R >>"], [`<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${count} >>`]];
    let length = 0;
    const append = value => { const bytes = typeof value === "string" ? encoder.encode(value) : value;chunks.push(bytes);length += bytes.length; };
    for (let i = 0; i < count; i++) {
      const id = 3 + i * 3, text = i === 0 ? "LOAN AMOUNT: 250000" : i === 29 ? "LOAN AMOUNT: 310000" : `FICTIONAL PACKAGE PAGE ${i + 1}`;
      let resources, content, data;
      if (allScanned || i === 29) {
        const canvas = document.createElement("canvas");canvas.width = 1600;canvas.height = 360;const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";ctx.fillRect(0, 0, canvas.width, canvas.height);ctx.fillStyle = "black";ctx.font = "bold 66px Arial";ctx.fillText(text, 70, 130);ctx.font = "32px Arial";ctx.fillText("FICTIONAL TITLE SOURCE", 70, 230);
        const jpeg = new Uint8Array(await (await new Promise(done => canvas.toBlob(done, "image/jpeg", 0.98))).arrayBuffer());
        resources = `<< /XObject << /Im0 ${id + 1} 0 R >> >>`;content = "q 800 0 0 180 0 0 cm /Im0 Do Q";
        if (!allScanned && i === 29) {
          // A selectable footer must not hide the raster body from whole-document OCR.
          resources = `<< /XObject << /Im0 ${id + 1} 0 R >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>`;
          content += " BT /F1 8 Tf 35 12 Td (Page 30) Tj ET";
        }
        data = [`<< /Type /XObject /Subtype /Image /Width 1600 /Height 360 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"];
      } else {
        resources = `<< /Font << /F1 ${id + 1} 0 R >> >>`;content = `BT /F1 22 Tf 35 90 Td (${text}) Tj ET`;
        data = ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
      }
      objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 180] /Resources ${resources} /Contents ${id + 2} 0 R >>`], data, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    }
    append("%PDF-1.7\n");objects.forEach((parts, i) => { offsets.push(length);append(`${i + 1} 0 obj\n`);parts.forEach(append);append("\nendobj\n"); });const xref = length;
    append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const original = new Blob(chunks, { type: "application/pdf" });
    window.originalHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await original.arrayBuffer()))].join(",");
    window.installDocument(original);
  }, allScanned);
}

async function verifyPrivacyAndOriginal() {
  assert.equal(await page.evaluate(async () => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await window.original.arrayBuffer()))].join(",") === window.originalHash), true);
  assert.ok(requests.some(url => url.includes("eng.traineddata.gz")), "the real OCR model must have run");
  assert.deepEqual(await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: await indexedDB.databases() })), { local: [], session: [], databases: [] });
}

test("30 actual scanned pages reach the field UI; a conflicting last-page amount prevents bulk fill", { timeout: 240000 }, async () => {
  await open("fields", true);
  await page.getByRole("button", { name: "Find field suggestions", exact: true }).click();
  await page.getByRole("button", { name: "Use Confirmed loan amount from page 30", exact: true }).waitFor({ timeout: 210000 });
  const section = page.getByRole("region", { name: "Source field suggestions" });
  assert.match(await section.textContent(), /30 of 30/);
  assert.match(await section.textContent(), /250000/);assert.match(await section.textContent(), /310000/);
  assert.equal(await page.getByRole("button", { name: "Fill unambiguous suggestions for review", exact: true }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.fills), []);
  await page.getByRole("button", { name: "Use Confirmed loan amount from page 30", exact: true }).click();
  const [fills] = await page.evaluate(() => window.fills);
  assert.equal(fills[0].value, "310000");assert.match(fills[0].evidence.page, /PDF page 30/);assert.match(fills[0].evidence.quote, /LOAN AMOUNT: 310000/);
  await verifyPrivacyAndOriginal();
});

test("mixed 30-page package with a selectable footer still reads the scanned body and requires review", { timeout: 90000 }, async () => {
  await open("text", false);
  await page.getByRole("button", { name: "Read whole document", exact: true }).click();
  await page.getByText(/30 of 30/).first().waitFor({ timeout: 60000 });
  await page.getByRole("combobox", { name: "PDF text page", exact: true }).selectOption("30");
  const recognized = page.getByRole("textbox", { name: "Recognized OCR page text", exact: true });
  assert.match(await recognized.inputValue(), /LOAN AMOUNT: 310000/);
  const copy = page.getByRole("button", { name: "Copy reviewed OCR page with source", exact: true });
  assert.equal(await copy.isDisabled(), true);
  await page.getByRole("checkbox", { name: "I compared this OCR result with the original document.", exact: true }).check();
  await copy.click();
  const [citation] = await page.evaluate(() => window.copiedExcerpts);
  assert.match(citation, /PDF page 30/);assert.match(citation, /version 1/);assert.match(citation, /310000/);
  await verifyPrivacyAndOriginal();
});
