// Real company drawer, material workflow and domain validation; fictional records only.
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
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {CompanyDetail} from './components/title/companies';
      function App(){const [company,setCompany]=useState('c1');window.switchCompany=setCompany;return <><CompanyDetail key={company} id={company} onClose={()=>{}} onDoc={doc=>window.documentPreviews.push(doc.id)} onUpload={id=>window.uploadCompanies.push(id)}/><span id="ready"/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fictional-company-documents", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture-client" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-client" }, () => ({ contents: `export const activeWorkspace=()=>"fictional-workspace";export const backendRequest=async()=>{throw Error("Unexpected provider request")};` }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture-store" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-store" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';
        import {createMaterial} from './lib/title/materials';import {validateBusinessMutation} from './lib/title/business';
        const listeners=new Set(),state=createSeed();state.user='Fictional reviewer';
        state.companies.find(c=>c.id==='c1').name='Cedar Fictional Title';state.companies.find(c=>c.id==='c2').name='Pine Fictional Title';
        for(const doc of state.documents){doc.name=(doc.companyId==='c1'?'Cedar ':doc.companyId==='c2'?'Pine ':'Other ')+doc.name;doc.assetId='asset-'+doc.id;doc.mime='text/plain';}
        createMaterial(state,{companyId:'c2',kind:'Business card',title:'Foreign stationery',owner:'Fictional Pine Contact',brief:'Company two only.'});
        let snapshot={s:state,connection:{workspaceId:'fictional-workspace',revision:1,access:{userId:'fictional-owner',email:'owner@example.test',role:'owner',allCompanies:true,restricted:true,version:1,companyIds:[]}}};
        const emit=()=>listeners.forEach(fn=>fn());window.documentPreviews=[];window.uploadCompanies=[];window.materialUpdates=[];
        window.readCompanyDocuments=()=>structuredClone(snapshot.s);
        export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(change,title,detail)=>{const next=structuredClone(snapshot.s);change(next);validateBusinessMutation(snapshot.s,next);window.materialUpdates.push({title,detail});snapshot={...snapshot,s:next};emit();return true;}};}
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
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
}
const requests = () => page.locator("summary").filter({ hasText: /^Requests and approvals$/ });
async function pick(label, name) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function requestMaterial() {
  await requests().click(); await page.getByRole("button", { name: "Request material", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Request company material", exact: true });
  await dialog.getByRole("textbox", { name: "Material title", exact: true }).fill("Cedar reviewed company overview");
  await dialog.getByRole("textbox", { name: "Responsible person", exact: true }).fill("Fictional Coordinator");
  await dialog.getByRole("textbox", { name: "Requested content and branding", exact: true }).fill("Confirm the Cedar name and branding against its uploaded file.");
  await dialog.getByRole("button", { name: "Create material request", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
}

test("one Documents tab keeps scoped files, preview, package review and one upload entry point", async () => {
  await open(); assert.equal(await page.getByRole("tab", { name: "Materials", exact: true }).count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Documents", exact: true }).count(), 1);
  const state = await page.evaluate(() => window.readCompanyDocuments());
  const companyFiles = state.documents.filter(doc => doc.companyId === "c1");
  const names = await page.locator(".doc-list-row strong").allTextContents(); assert.deepEqual(names, companyFiles.map(doc => doc.name));
  assert.ok(names.every(name => name.startsWith("Cedar ")));
  await page.locator(".doc-list-row").filter({ hasText: "Cedar Company overview.txt" }).click();
  assert.deepEqual(await page.evaluate(() => window.documentPreviews), ["d0-1"]);
  await page.getByRole("button", { name: "Upload", exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.uploadCompanies), ["c1"]);
  await page.getByRole("button", { name: "Read document package", exact: true }).click();
  const packageDialog = page.getByRole("dialog", { name: "Read and review a document package", exact: true });
  const included = await packageDialog.getByRole("checkbox").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  assert.deepEqual(included, companyFiles.filter(doc => !doc.orderId).map(doc => `Include ${doc.name}`));
  assert.ok(included.every(name => name.startsWith("Include Cedar "))); assert.ok(included.every(name => !name.includes("Recorded deed")));
  await page.keyboard.press("Escape"); await packageDialog.waitFor({ state: "detached" });
  await requests().click(); assert.equal(await page.getByRole("button", { name: /upload/i }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Upload company file", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.materialUpdates), []);
});

test("requests are collapsed by default and keyboard accessible without creating records", async () => {
  await open(); const details = requests().locator("..");
  assert.equal(await details.evaluate(node => node.open), false); assert.equal(await page.getByRole("button", { name: "Request material", exact: true }).isVisible(), false);
  await requests().focus(); await page.keyboard.press("Enter"); assert.equal(await details.evaluate(node => node.open), true);
  assert.equal(await page.getByRole("button", { name: "Request material", exact: true }).isVisible(), true);
  await requests().focus(); await page.keyboard.press("Space"); assert.equal(await details.evaluate(node => node.open), false);
  assert.deepEqual(await page.evaluate(() => window.materialUpdates), []);
});

test("Documents supports request, attach, review and exact-version approval without publishing", async () => {
  await open(); await requestMaterial();
  let state = await page.evaluate(() => window.readCompanyDocuments()); let item = state.materials.items.find(row => row.companyId === "c1");
  assert.equal(item.status, "Requested"); assert.equal(item.documentId, "");
  assert.equal(state.tasks.find(row => row.id === `task-${item.id}`).owner, "Fictional Coordinator");
  await page.getByRole("combobox", { name: "Working material document", exact: true }).click();
  const options = await page.getByRole("option").allTextContents();
  assert.deepEqual(options.sort(), ["No document attached", "Cedar Company overview.txt · v1", "Cedar Formation checklist.txt · v1"].sort());
  await page.getByRole("option", { name: "Cedar Company overview.txt · v1", exact: true }).click();
  await pick("Material preparation status", "Awaiting review"); await page.getByRole("button", { name: "Save preparation", exact: true }).click();
  const approve = page.getByRole("button", { name: "Approve material", exact: true }); assert.equal(await approve.isDisabled(), true);
  await page.getByRole("textbox", { name: "Material approval note", exact: true }).fill("Compared the saved Cedar wording, brand and document version.");
  assert.equal(await approve.isDisabled(), true); await page.getByRole("checkbox", { name: "I checked the saved material and attached document.", exact: true }).click();
  await approve.click(); await page.getByText(/Approved by Fictional reviewer/).waitFor();
  state = await page.evaluate(() => window.readCompanyDocuments()); item = state.materials.items.find(row => row.companyId === "c1");
  assert.equal(item.status, "Approved"); assert.equal(item.documentId, "d0-1"); assert.equal(item.revision, 2);
  const approval = item.history.find(event => event.approval).approval;
  assert.equal(approval.documentId, "d0-1"); assert.equal(approval.documentVersion, 1); assert.equal(approval.documentName, "Cedar Company overview.txt");
  assert.equal(state.tasks.find(row => row.id === `task-${item.id}`).done, true);
  assert.deepEqual(state.materials.publications, []); assert.equal(await page.getByRole("button", { name: "Prepare publication draft", exact: true }).count(), 1);
  assert.equal(state.materials.items.find(row => row.companyId === "c2").status, "Requested");
});

test("switching companies clears the open request area and keeps checklist creation scoped", async () => {
  await open(); await requestMaterial(); await page.evaluate(() => window.switchCompany("c2"));
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  assert.equal(await requests().locator("..").evaluate(node => node.open), false);
  assert.ok((await page.locator(".doc-list-row strong").allTextContents()).every(name => name.startsWith("Pine ")));
  await requests().click(); assert.match(await page.getByRole("combobox", { name: "Company material", exact: true }).innerText(), /Foreign stationery/);
  const before = await page.evaluate(() => window.readCompanyDocuments());
  await page.getByRole("button", { name: "Set up standard checklist", exact: true }).click();
  const after = await page.evaluate(() => window.readCompanyDocuments());
  assert.deepEqual(after.materials.items.filter(row => row.companyId === "c1"), before.materials.items.filter(row => row.companyId === "c1"));
  assert.equal(after.materials.items.filter(row => row.companyId === "c2").length, 4);
  await page.getByRole("combobox", { name: "Company material", exact: true }).click(); assert.ok((await page.getByRole("option").allTextContents()).every(name => !name.includes("Cedar")));
});
