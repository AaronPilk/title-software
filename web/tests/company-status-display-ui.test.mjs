// Actual status consumers with fictional company records. No state or provider writes.
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
  const bundle = await build({ absWorkingDir: web, outfile: "company-status-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {Overview} from './components/title/overview';import {OnboardingHub} from './components/title/onboarding-suite';import {PartnerPortal} from './components/title/workspace';
      const view=new URLSearchParams(location.search).get('view');
      createRoot(document.getElementById('root')).render(view==='setup'?<OnboardingHub onOpen={(id,tab)=>window.statusOpens.push({id,tab})} onNew={()=>{}}/>:view==='partner'?<PartnerPortal/>:<Overview navigate={()=>{}} newOrder={()=>{}} openOrder={()=>{}} openCompany={()=>{}}/>);
    ` },
    plugins: [{ name: "company-status-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "private-client", namespace: "fixture" }));
      builder.onLoad({ filter: /^private-client$/, namespace: "fixture" }, () => ({ contents: "export const activeWorkspace=()=>'';export const backendRequest=async()=>{throw Error('Unexpected private application request');};" }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {createSeed} from './lib/title/model';
        const q=new URLSearchParams(location.search),s=createSeed(),base=s.companies[0];
        const confirmation={status:'Active',confirmedBy:'owner@example.test',confirmedAt:'2026-09-23T12:00:00.000Z',note:'PRIVATE owner confirmation note'};
        s.companies=[{...base,id:'existing',name:'Existing Title',stage:'Onboarding',steps:Array(7).fill(false),operatingStatus:confirmation},
          {...base,id:'new',name:'New Title',stage:'Onboarding',steps:Array(7).fill(false)},
          {...base,id:'legacy',name:'Legacy Title',stage:'Active',steps:Array(7).fill(false)}];
        if(q.has('malformed'))s.companies[0].operatingStatus={status:'Active'};
        s.orders=[];s.documents=[];s.tasks=[];s.inbox=[];s.activity=[];
        s.business={onboarding:[],credentials:[],closes:[],handoffs:[],policies:[],commitments:[],cpls:[],followups:[],corrections:[]};
        s.partnerSummary={asOfDate:'2026-09-23',rows:[]};
        const connection={access:{role:q.has('partner')?'partner':'operations',allCompanies:false,restricted:!q.has('limited'),companyIds:s.companies.map(c=>c.id),userId:'operator',email:'operator@example.test',version:1},revision:1};
        window.statusState=()=>structuredClone(s);window.statusWrites=[];window.statusOpens=[];
        export const useWorkspace=()=>({s,connection,update:async()=>{window.statusWrites.push('unexpected update');throw Error('Unexpected state write');}});
        export const download=()=>{throw Error('Unexpected download');};export const exportCsv=download,exportFullBackup=download,parseBackupFile=download;
        export const getAsset=async()=>{throw Error('Unexpected private asset read');};export const saveAsset=async()=>{throw Error('Unexpected asset write');};
      ` }));
      builder.onResolve({ filter: /^\.\/(backend-settings|partner-documents|close-suite|staff-assignment-picker)$/ }, () => ({ path: "unused-children", namespace: "fixture-child" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-child" }, () => ({ contents: "export const BackendSettings=()=>null,PartnerDocuments=()=>null,PartnerStatements=()=>null,StaffAssignmentPicker=()=>null;" }));
    } }],
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents); }
    else if (path === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".css"))?.contents || ""); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });
async function open(query = "") {
  errors = []; context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(3000);
  await context.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/?${query}`); await page.getByRole("heading", { level: 1 }).waitFor();
}
const metric = label => page.locator(".metric").filter({ has: page.getByText(label, { exact: true }) });
test("Production counts confirmed and legacy active businesses while keeping new-company setup separate", async () => {
  await open(); assert.equal(await metric("Active companies").locator("strong").innerText(), "2");
  assert.match(await metric("Active companies").innerText(), /1 new company in setup/);
  assert.equal(await page.getByRole("button").filter({ hasText: "Existing Title" }).locator(".status").innerText(), "Active");
  assert.equal(await page.getByRole("button").filter({ hasText: "New Title" }).locator(".status").innerText(), "Onboarding");
  assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE owner confirmation note/);
  assert.deepEqual(await page.evaluate(() => window.statusWrites), []);
});
test("setup starts with the selected company documents while keeping missing approval evidence reviewable", async () => {
  await open("view=setup"); await page.getByRole("heading", { name: "Company setup and reviews", exact: true }).waitFor();
  assert.equal(await metric("New companies").locator("strong").innerText(), "1");
  assert.equal(await metric("Incomplete workspace evidence").locator("strong").innerText(), "3");
  const queue = page.locator(".business-queue"); assert.equal(await queue.getByRole("button").filter({ hasText: "Existing Title" }).locator(".status").innerText(), "Active");
  assert.match(await queue.locator("button.selected").innerText(), /Existing Title/);
  const before = await page.evaluate(() => window.statusState());
  assert.equal(await page.getByLabel("Legal company name", { exact: true }).isVisible(), false);
  await page.getByRole("button", { name: "Open company documents", exact: true }).click();
  await page.getByRole("button", { name: "Company details", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.statusOpens), [{ id: "existing", tab: "Documents" }, { id: "existing", tab: "Overview" }]);
  assert.deepEqual(await page.evaluate(() => window.statusState()), before);
  assert.deepEqual(await page.evaluate(() => window.statusWrites), []);
  await page.getByText("Application and approval review", { exact: true }).click();
  await page.getByText("Workspace evidence checks still open", { exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), /0 \/ 7 reviewed|Evidence required/);
  const state = await page.evaluate(() => window.statusState()); assert.equal(state.companies[0].stage, "Onboarding"); assert.ok(state.companies[0].steps.every(step => step === false)); assert.deepEqual(state.business.onboarding, []);
  assert.deepEqual(await page.evaluate(() => window.statusWrites), []);
  await queue.getByRole("button").filter({ hasText: "New Title" }).click();
  assert.equal(await page.getByLabel("Legal company name", { exact: true }).isVisible(), true);
  await queue.getByRole("button").filter({ hasText: "Existing Title" }).click();
  assert.equal(await page.getByLabel("Legal company name", { exact: true }).isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.statusState()), before);
  assert.deepEqual(await page.evaluate(() => window.statusWrites), []);
});
test("withheld setup evidence stays unavailable rather than claiming an active company's records are complete or missing", async () => {
  await open("view=setup&limited=1"); assert.equal(await metric("Incomplete workspace evidence").locator("strong").innerText(), "Access needed");
  assert.equal(await metric("New companies").locator("strong").innerText(), "1");
  assert.equal(await page.locator(".business-queue").getByRole("button").filter({ hasText: "Existing Title" }).locator(".status").innerText(), "Active");
  assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE|0 \/ 7 reviewed|Workspace application: Not started/);
  assert.equal(await page.getByRole("heading", { name: "Application evidence requires additional access", exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Legal company name", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Record reviewed evidence", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.statusWrites), []);
});
test("partner company badge reflects operating status without exposing private confirmation metadata", async () => {
  await open("view=partner&partner=1"); assert.equal(await page.locator(".partner-welcome .status").innerText(), "Active");
  assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE|owner@example\.test/);
});
test("malformed confirmation cannot manufacture an active count or company badge", async () => {
  await open("malformed=1"); assert.equal(await metric("Active companies").locator("strong").innerText(), "1");
  assert.equal(await page.getByRole("button").filter({ hasText: "Existing Title" }).locator(".status").innerText(), "Onboarding");
  assert.match(await metric("Active companies").innerText(), /2 new companies in setup/);
});
