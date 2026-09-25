// Real company UI and workspace mutations; fictional companies, no live providers.
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
    absWorkingDir: web, outfile: "company-operating-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {Companies,CompanyDetail,Onboarding} from './components/title/companies';
      function App(){const [detail,setDetail]=useState(new URLSearchParams(location.search).get('detail'));const legacy=new URLSearchParams(location.search).has('legacy');return <>{legacy?<Onboarding onNew={()=>{}} onOpen={setDetail}/>:<Companies onNew={()=>{}} onOpen={setDetail}/>}{detail&&<CompanyDetail id={detail} onClose={()=>setDetail(null)} onDoc={()=>{}} onUpload={()=>{}}/>}<span id="ready"/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fictional-company-operations", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/backend\/jv-intake-client$/ }, () => ({ path: "intake", namespace: "fixture-intake" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-intake" }, () => ({ loader: "ts", resolveDir: web, contents: `import {newJVApplication} from './lib/title/jv-application';window.privateRequests=[];export async function jvIntakeClientRequest(context,action){window.privateRequests.push({context,action});if(action!=='load')throw Error('Unexpected private write');return {companyId:context.companyId,version:0,payload:newJVApplication(),status:'Draft',reviewNote:'',updatedAt:null,updatedBy:null,reviewedAt:null,reviewedBy:null};}` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/jv-portal-client$/ }, () => ({ path: "portal", namespace: "fixture-portal" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-portal" }, () => ({ contents: `window.portalRequests=[];export async function jvPortalClientRequest(context,action){window.portalRequests.push({context,action});if(action!=='list')throw Error('Unexpected portal write or email');return {requests:[],mailConfigured:false};}export const jvPortalDownload=async()=>{throw Error('Unexpected download')};` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture-client" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-client" }, () => ({ contents: `export const activeWorkspace=()=>"fictional-workspace";export const backendRequest=async()=>{throw Error("Unexpected provider request")};` }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture-store" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-store" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';import {buildCompanyFromCandidate} from './lib/title/company-intake';
        const query=new URLSearchParams(location.search),listeners=new Set(),state=createSeed(),legacy=state.companies[0];
        const imported=(id,name)=>buildCompanyFromCandidate({organizationId:'fictional-org',organizationName:'Fictional Family',teamId:id,teamName:name},{id,importedAt:'2026-09-23T20:00:00.000Z',importedBy:'owner@example.test'});
        state.companies=[imported('cedar','Cedar Title'),imported('pine','Pine Title'),imported('qa','QA Practice Title — Test Only'),{...legacy,id:'parent',name:'Fictional Parent Title',stage:'Onboarding',steps:Array(7).fill(false),members:[]},{...legacy,id:'legacy',name:'Established Title',stage:'Active'}];
        state.tasks=[{id:'task',companyId:'cedar',title:'Complete company profile',owner:'owner@example.test',done:false}];state.documents=[];
        if(query.has('confirmed'))state.companies[0].operatingStatus={status:'Active',confirmedBy:'owner@example.test',confirmedAt:'2026-09-23T21:00:00.000Z',note:'Already operates; setup records are still needed.'};
        if(query.has('malformed'))state.companies[0].operatingStatus={status:'Active',confirmedBy:'',confirmedAt:'bad-date',note:''};
        const access=(role='owner',allCompanies=true,version=1)=>role==='demo'?undefined:{workspaceId:'fictional-workspace',revision:1,access:{userId:'owner-user',email:'owner@example.test',role,allCompanies,version,restricted:query.has('application'),companyIds:state.companies.map(c=>c.id)}};
        let snapshot={s:state,connection:access(query.get('role')||'owner',query.get('all')!=='false')};const emit=()=>listeners.forEach(fn=>fn());
        window.operatingUpdates=[];window.failOperatingSave=query.has('fail');window.readOperating=()=>structuredClone(snapshot.s);
        window.changeOperatingAccess=(role,all)=>{snapshot={...snapshot,connection:access(role,all,(snapshot.connection?.access.version||0)+1)};emit();};
        window.renameOperatingCompany=(id,name)=>{const next=structuredClone(snapshot.s);next.companies.find(c=>c.id===id).name=name;snapshot={...snapshot,s:next};emit();};
        export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(change,title,detail)=>{const next=structuredClone(snapshot.s);change(next);window.operatingUpdates.push({title,detail});if(window.failOperatingSave)return false;snapshot={...snapshot,s:next};emit();return true;}};}
        export const download=()=>{throw Error('Unexpected download')};export const getAsset=async()=>{throw Error('Unexpected asset read')};export const getAssetForDocument=getAsset;export const saveAsset=async()=>{throw Error('Unexpected asset write')};
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    if (req.url === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents); }
    else if (req.url === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".css"))?.contents || ""); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(query = "") {
  await context?.close(); errors = []; context = await browser.newContext();
  await context.route("**/*", route => { if (!route.request().url().startsWith(`${origin}/`)) { errors.push("External request"); return route.abort(); } return route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(4000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${origin}/?${query}`); await page.locator("#ready").waitFor({ state: "attached" });
}
const trigger = () => page.getByRole("button", { name: "Confirm active companies", exact: true });
const choose = name => page.getByRole("checkbox", { name: `Confirm ${name} is active`, exact: true });
const ack = () => page.getByRole("checkbox", { name: "I reviewed every selected company and confirm they already operate", exact: true });
const note = () => page.getByRole("textbox", { name: "Confirmation note", exact: true });
const stripped = company => { const copy = structuredClone(company); delete copy.operatingStatus; return copy; };

test("only owners and company-wide admins can confirm existing operations", async () => {
  for (const query of ["role=operations", "role=onboarding", "role=finance", "role=viewer", "role=partner", "role=admin&all=false", "role=demo"]) {
    await open(query); assert.equal(await trigger().count(), 0); assert.deepEqual(await page.evaluate(() => window.operatingUpdates), []);
  }
  for (const query of ["", "role=admin", "role=owner&all=false"]) { await open(query); assert.equal(await trigger().count(), 1); }
});

test("bulk confirmation requires review, never selects QA implicitly, and preserves every setup gap", async () => {
  await open(); const before = await page.evaluate(() => window.readOperating()); await trigger().click();
  assert.equal(await choose("Cedar Title").isChecked(), true); assert.equal(await choose("Pine Title").isChecked(), true);
  assert.equal(await choose("QA Practice Title — Test Only").isChecked(), false); assert.equal(await choose("Fictional Parent Title").isChecked(), false); assert.equal(await choose("Established Title").isChecked(), false);
  await choose("Fictional Parent Title").click();
  const submit = page.getByRole("button", { name: "Confirm 3 companies active", exact: true });
  assert.equal(await submit.isDisabled(), true); await ack().click(); assert.equal(await submit.isDisabled(), true);
  await note().fill("These companies already operate; their records are being collected."); await submit.click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  const after = await page.evaluate(() => window.readOperating());
  for (const id of ["cedar", "pine", "parent"]) { const company = after.companies.find(c => c.id === id); assert.equal(company.operatingStatus.status, "Active"); assert.equal(company.operatingStatus.confirmedBy, "owner@example.test"); assert.ok(Number.isFinite(Date.parse(company.operatingStatus.confirmedAt))); }
  assert.equal(after.companies.find(c => c.id === "qa").operatingStatus, undefined);
  assert.deepEqual(after.companies.map(stripped), before.companies); assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.documents, before.documents);
  assert.equal((await page.evaluate(() => window.operatingUpdates)).length, 1);
  await page.getByRole("tab", { name: "Active", exact: true }).click(); assert.equal(await page.locator(".company-card").count(), 4);
  await page.getByRole("tab", { name: "Onboarding", exact: true }).click(); assert.equal(await page.locator(".company-card").count(), 1); assert.match(await page.locator(".company-card").innerText(), /QA Practice/);
});

test("renaming a reviewed company or changing the selected set resets acknowledgement", async () => {
  await open(); await trigger().click(); await note().fill("Confirmed existing operations."); await ack().click();
  await page.evaluate(() => window.renameOperatingCompany("cedar", "Cedar Ridge Title")); assert.equal(await ack().isChecked(), false);
  assert.equal(await page.getByRole("button", { name: "Confirm 2 companies active", exact: true }).isDisabled(), true);
  await ack().click(); await choose("Pine Title").click(); assert.equal(await ack().isChecked(), false);
});

test("failed saves remain reviewable and do not optimistically mark companies Active", async () => {
  await open("fail"); const before = await page.evaluate(() => window.readOperating()); await trigger().click(); await note().fill("Confirmed existing operations."); await ack().click();
  await page.getByRole("button", { name: "Confirm 2 companies active", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "was not saved" }).waitFor(); assert.deepEqual(await page.evaluate(() => window.readOperating()), before);
  await page.evaluate(() => { window.failOperatingSave = false; }); await page.getByRole("button", { name: "Confirm 2 companies active", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "detached" });
});

test("access revocation removes an open confirmation and prevents a save", async () => {
  await open(); await trigger().click(); await note().fill("Confirmed existing operations."); await ack().click();
  await page.evaluate(() => window.changeOperatingAccess("operations", true)); await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await trigger().count(), 0); assert.deepEqual(await page.evaluate(() => window.operatingUpdates), []);
});

test("detail separates Active operations from missing profile and checklist evidence; confirmation can be cleared", async () => {
  await open("confirmed&detail=cedar"); const before = await page.evaluate(() => window.readOperating());
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByRole("heading", { name: "Workspace setup checklist", exact: true }).isVisible(), false);
  assert.equal(await dialog.getByRole("button", { name: "Company documents & logo", exact: true }).isVisible(), true);
  await dialog.getByText("Company details & Missive source", { exact: true }).click();
  await dialog.getByText("Formation and approval history", { exact: true }).click();
  assert.match(await dialog.innerText(), /Workspace setup checklist/); assert.match(await dialog.innerText(), /Company profile needs completion/); assert.match(await dialog.innerText(), /owner@example.test/);
  assert.deepEqual(await page.evaluate(() => window.readOperating()), before);
  assert.deepEqual(await page.evaluate(() => window.operatingUpdates), []);
  assert.equal(await dialog.getByRole("checkbox", { checked: false }).count(), 7);
  await page.getByRole("button", { name: "Clear operating confirmation", exact: true }).click();
  assert.match(await dialog.innerText(), /returns the displayed status to Onboarding/);
  await page.getByRole("button", { name: "Clear confirmation", exact: true }).click();
  await page.getByRole("heading", { name: "Onboarding checklist", exact: true }).waitFor();
  const after = await page.evaluate(() => window.readOperating()); assert.equal(after.companies[0].operatingStatus, null); assert.deepEqual(after.companies.map(stripped), before.companies.map(stripped)); assert.deepEqual(after.tasks, before.tasks);
});

test("staff can see saved operating context but cannot clear it", async () => {
  await open("confirmed&detail=cedar&role=operations"); await page.getByText("Formation and approval history", { exact: true }).click(); assert.match(await page.getByRole("dialog").innerText(), /Existing operations confirmed Active/);
  assert.equal(await page.getByRole("button", { name: "Clear operating confirmation", exact: true }).count(), 0);
});

test("legacy onboarding counts exclude confirmed operating companies from launch setup", async () => {
  await open("confirmed&legacy"); assert.match(await page.locator(".onboarding-summary").innerText(), /3 in progress[\s\S]*2 active/);
  const names = await page.locator(".kanban-card h3").allTextContents(); assert.deepEqual(names.sort(), ["Fictional Parent Title", "Pine Title", "QA Practice Title — Test Only"].sort());
});

test("malformed legacy metadata cannot claim Active operations or hide incomplete launch setup", async () => {
  await open("malformed&detail=cedar"); const dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByRole("heading", { name: "Onboarding checklist", exact: true }).isVisible(), false);
  await dialog.getByText("Formation and approval history", { exact: true }).click();
  assert.equal(await dialog.getByRole("heading", { name: "Onboarding checklist", exact: true }).isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.operatingUpdates), []);
  assert.doesNotMatch(await dialog.innerText(), /Existing operations confirmed Active|Workspace setup checklist|Invalid Date/);
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Active", exact: true }).click(); assert.equal(await page.locator(".company-card").count(), 1); assert.match(await page.locator(".company-card").innerText(), /Established Title/);
  await trigger().click(); assert.equal(await choose("Cedar Title").isChecked(), true); assert.doesNotMatch(await page.getByRole("dialog").innerText(), /Operations already confirmed/);
});


test("existing company upload shortcut opens its pinned private application dialog without creating records", async () => {
  await open("confirmed&detail=cedar&application");
  const before = await page.evaluate(() => window.readOperating());
  await page.getByRole("button", { name: "Upload completed application", exact: true }).click();
  const upload = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Upload completed application", exact: true }) }).last();
  await upload.getByLabel("Select completed application", { exact: true }).waitFor();
  assert.match(await upload.innerText(), /Cedar Title/);
  assert.match(await upload.innerText(), /Private company application · Restricted access/);
  assert.equal(await upload.getByRole("combobox").count(), 0);
  assert.equal(await upload.getByRole("button", { name: "Back", exact: true }).count(), 0);
  assert.equal(await upload.getByRole("button", { name: "Upload and read application", exact: true }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.privateRequests), [{context:{workspaceId:"fictional-workspace",userId:"owner-user",companyId:"cedar"},action:"load"}]);
  assert.deepEqual(await page.evaluate(() => window.portalRequests), []);
  await upload.getByRole("button", { name: "Cancel", exact: true }).click();
  await upload.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.readOperating()), before);
  assert.deepEqual(await page.evaluate(() => window.operatingUpdates), []);
});

test("new joint venture shortcut opens the private-link form without sending or preparing an invite", async () => {
  await open("detail=cedar&application");
  const before = await page.evaluate(() => window.readOperating());
  await page.getByRole("button", { name: "Send application link", exact: true }).click();
  await page.getByRole("textbox", { name: "Recipient name", exact: true }).waitFor();
  await page.getByText("Application email setup is needed before recipients can verify and open a link.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Private application links", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.portalRequests), [{context:{workspaceId:"fictional-workspace",userId:"owner-user",companyId:"cedar"},action:"list"}]);
  assert.deepEqual(await page.evaluate(() => window.privateRequests), []);
  assert.deepEqual(await page.evaluate(() => window.operatingUpdates), []);
  assert.deepEqual(await page.evaluate(() => window.readOperating()), before);
});
