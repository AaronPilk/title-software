// Real document vault with fictional workspace records. No asset or provider traffic.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [];
before(async () => {
  const bundle = await build({
    absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {Documents} from './components/title/documents';
      createRoot(document.getElementById('root')).render(<><Documents onDoc={doc=>window.previews.push(doc.id)} onUpload={(company,destination)=>window.uploadCompanies.push({company:company??null,destination:destination??null})}/><span id="ready"/></>);
    ` },
    plugins: [{ name: "fictional-document-vault", setup(builder) {
      builder.onResolve({ filter: /^\.\/document-upload$/ }, () => ({ path: "upload", namespace: "fixture-upload" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-upload" }, () => ({ contents: `export const UploadDocument=()=>{throw Error("Unexpected uploader render; this fixture verifies destination callbacks")};` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture-client" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-client" }, () => ({ contents: `export const activeWorkspace=()=>"fictional-workspace";export const backendRequest=async()=>{throw Error("Unexpected provider request")};` }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture-store" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-store" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {createSeed} from './lib/title/model';
        const state=createSeed();state.companies=state.companies.slice(0,2);
        state.companies[0].name='Cedar Fictional Title';state.companies[1].name='Pine Fictional Title';
        state.orders=[{...state.orders[0],id:'CEDAR-100',companyId:'c1',address:'10 Fictional Cedar Lane'},{...state.orders[0],id:'PINE-200',companyId:'c2',address:'20 Fictional Pine Lane'}];
        const doc=(id,companyId,name,category,visibility,orderId)=>({id,companyId,name,category,visibility,orderId,date:'2026-09-24',size:'1 KB',version:1,assetId:'asset-'+id,mime:'application/pdf'});
        state.documents=[
          doc('cedar-logo','c1','Cedar logo.pdf','Branding','Internal'),
          doc('cedar-application','c1','Cedar application.pdf','Applications','Restricted'),
          doc('cedar-deed','c1','Cedar deed.pdf','Policy documents','Internal','CEDAR-100'),
          doc('cedar-final','c1','Cedar final.pdf','Policy documents','Restricted','CEDAR-100'),
          doc('pine-agreement','c2','Pine agreement.pdf','Agreements','Internal'),
          doc('pine-policy','c2','Pine policy.pdf','Policy documents','Partner','PINE-200'),
        ];
        window.previews=[];window.uploadCompanies=[];window.readVault=()=>structuredClone(state);
        export const useWorkspace=()=>({s:state,connection:{workspaceId:'fictional-workspace',revision:1,access:{userId:'fictional-owner',email:'owner@example.test',role:'owner',allCompanies:true,restricted:true,version:1,companyIds:[]}},update:async()=>{throw Error('Unexpected record mutation')}});
        export const download=()=>{throw Error('Unexpected download')};export const getAsset=async()=>{throw Error('Unexpected asset read')};export const saveAsset=async()=>{throw Error('Unexpected asset write')};
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    if (req.url === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0].contents); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open() {
  await context?.close(); errors = []; context = await browser.newContext();
  await context.route("**/*", route => { if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); } return route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(4000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin); await page.locator("#ready").waitFor({ state: "attached" });
}
const names = () => page.locator(".document-name strong").allTextContents();
const filing = name => page.getByRole("tab", { name, exact: true });
const card = name => page.locator(".vault-category").filter({ has: page.getByText(name, { exact: true }) });
async function pick(label, name) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test("filing tabs separate company documents from property files while preserving every original", async () => {
  await open(); const before = await page.evaluate(() => window.readVault());
  assert.equal(await page.getByRole("columnheader", { name: "Filed under", exact: true }).count(), 1);
  assert.deepEqual(await names(), before.documents.map(doc => doc.name));
  await filing("Company documents").click();
  assert.deepEqual(await names(), ["Cedar logo.pdf", "Cedar application.pdf", "Pine agreement.pdf"]);
  for (const row of await page.locator("tbody tr").all()) assert.equal(await row.locator("td").nth(2).innerText(), "Company documents");
  await filing("Title-file documents").click();
  assert.deepEqual(await names(), ["Cedar deed.pdf", "Cedar final.pdf", "Pine policy.pdf"]);
  for (const doc of before.documents.filter(doc => doc.orderId)) {
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: doc.name, exact: true }) });
    assert.ok((await row.innerText()).includes(doc.orderId));
    assert.ok((await row.innerText()).includes(before.orders.find(order => order.id === doc.orderId).address));
  }
  await filing("All documents").click(); assert.equal((await names()).length, 6);
  assert.deepEqual(await page.evaluate(() => window.readVault()), before);
});

test("company, access and filing filters intersect and folder counts follow the selected company", async () => {
  await open(); await pick("Document company", "Cedar Fictional Title");
  assert.match(await card("Company documents").innerText(), /2 files/);
  assert.match(await card("Title-file documents").innerText(), /2 files/);
  await filing("Title-file documents").click(); await pick("Document access filter", "Restricted");
  assert.deepEqual(await names(), ["Cedar final.pdf"]);
  await filing("Company documents").click(); assert.deepEqual(await names(), ["Cedar application.pdf"]);
  await pick("Document company", "Pine Fictional Title"); assert.deepEqual(await names(), []);
  assert.match(await card("Company documents").innerText(), /1 files/);
  assert.match(await card("Title-file documents").innerText(), /1 files/);
  await pick("Document access filter", "All access levels"); assert.deepEqual(await names(), ["Pine agreement.pdf"]);
  await filing("Title-file documents").click(); await pick("Document access filter", "Partner"); assert.deepEqual(await names(), ["Pine policy.pdf"]);
});

test("folder shortcuts toggle filing only and preserve search, access and company filters", async () => {
  await open(); await pick("Document company", "Cedar Fictional Title");
  await pick("Document access filter", "Internal"); await page.getByRole("textbox", { name: "Search documents…", exact: true }).fill("Cedar");
  await card("Company documents").click(); assert.equal(await card("Company documents").getAttribute("aria-pressed"), "true");
  assert.deepEqual(await names(), ["Cedar logo.pdf"]);
  await card("Title-file documents").click(); assert.deepEqual(await names(), ["Cedar deed.pdf"]);
  await card("Title-file documents").click(); assert.deepEqual(await names(), ["Cedar logo.pdf", "Cedar deed.pdf"]);
  assert.equal(await page.getByRole("textbox", { name: "Search documents…", exact: true }).inputValue(), "Cedar");
  assert.equal(await filing("All documents").getAttribute("data-state"), "active");
});

test("upload inherits company and filing filters without silently choosing the first company", async () => {
  await open(); const before = await page.evaluate(() => window.readVault());
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await pick("Document company", "Pine Fictional Title"); await filing("Title-file documents").click();
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await pick("Document company", "All companies"); await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await filing("Company documents").click(); await pick("Document company", "Cedar Fictional Title");
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.uploadCompanies), [
    { company: null, destination: "company" },
    { company: "c2", destination: "title" },
    { company: null, destination: "title" },
    { company: "c1", destination: "company" },
  ]);
  assert.deepEqual(await page.evaluate(() => window.readVault()), before);
});

test("preview actions retain the exact company and title-file original after filtering", async () => {
  await open(); const before = await page.evaluate(() => window.readVault());
  await pick("Document company", "Cedar Fictional Title"); await filing("Company documents").click();
  await page.getByRole("button", { name: "Cedar application.pdf", exact: true }).click();
  await filing("Title-file documents").click(); await page.getByRole("button", { name: "Preview Cedar deed.pdf Cedar Fictional Title", exact: true }).click();
  await pick("Document company", "Pine Fictional Title");
  await page.getByRole("button", { name: "Pine policy.pdf", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.previews), ["cedar-application", "cedar-deed", "pine-policy"]);
  assert.deepEqual(await page.evaluate(() => window.readVault()), before);
});
