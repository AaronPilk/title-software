// Real company entry points and dialog; synthetic workspace only, no live services.
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
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {Toaster} from 'sonner';
      import {Companies, NewCompany, Onboarding} from './components/title/companies';
      import {OnboardingHub} from './components/title/onboarding-suite';
      function App() {
        const query=new URLSearchParams(location.search);
        const [open,setOpen]=useState(query.has('dialog'));
        const Component=query.get('view')==='hub'?OnboardingHub:query.get('view')==='legacy'?Onboarding:Companies;
        return <><Component onOpen={id=>window.openedCompany=id} onNew={()=>setOpen(true)}/>
          {open&&<NewCompany open onClose={()=>setOpen(false)}/>}<Toaster/><span id="fixture-ready"/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "synthetic-company-workspace", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "synthetic-client" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic-client" }, () => ({ contents: `
        export const activeWorkspace=()=>"synthetic-company-workspace";
        export async function backendRequest(path){if(path!=="/staff/assignable")throw Error("Unexpected synthetic API");return {staff:[],unavailable:0};}
      ` }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react'; import {createSeed} from './lib/title/model';
        const query=new URLSearchParams(location.search), listeners=new Set();
        const state=createSeed(); state.companies=state.companies.slice(0,1); state.companies[0].name='QA Cedar Company';
        state.companies[0].stage='Onboarding';
        const access=(role,all)=>role==='demo'?undefined:{access:{userId:'fixture-user',email:'staff@example.test',role,allCompanies:all,companyIds:[state.companies[0].id],restricted:false},revision:1};
        let snapshot={s:state,connection:access(query.get('role')||'operations',query.get('all')==='true')};
        const emit=()=>listeners.forEach(listener=>listener());
        window.companyUpdates=[];
        window.readFixtureCompanyState=()=>structuredClone(snapshot.s);
        window.setFixtureCompanyAccess=(role,all)=>{snapshot={...snapshot,connection:access(role,all)};emit();};
        export function useWorkspace(){
          const current=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>snapshot);
          return {...current,update:async(change,title,detail)=>{
            const next=structuredClone(snapshot.s);change(next);window.companyUpdates.push({title,detail});
            snapshot={...snapshot,s:next};emit();return true;
          }};
        }
        export const download=()=>{throw Error('Unexpected fixture download');};
        export const getAsset=()=>{throw Error('Unexpected fixture asset read');};
        export const saveAsset=()=>{throw Error('Unexpected fixture asset write');};
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    if (new URL(req.url, "http://localhost").pathname === "/app.mjs") {
      res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0].contents);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(role, all, view = "companies", dialog = false) {
  await context?.close(); errors = [];
  context = await browser.newContext();
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(4000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${new URLSearchParams({role,all:String(all),view,...(dialog?{dialog:"1"}:{})})}`);
  await page.locator("#fixture-ready").waitFor({state:"attached"});
}
const add = () => page.getByRole("button", { name: "Add company", exact: true });
for (const role of ["operations", "finance", "viewer", "partner"]) {
  test(`${role} sees company records without company-creation controls in any entry point`, async () => {
    for (const view of ["companies", "hub", "legacy"]) {
      await open(role, true, view);
      assert.match(await page.locator("body").innerText(), /QA Cedar Company/);
      assert.equal(await add().count(), 0);
      assert.equal(await page.locator(".add-company-card").count(), 0);
      assert.deepEqual(await page.evaluate(() => window.companyUpdates), []);
      assert.deepEqual(errors, []);
    }
  });
}
for (const role of ["owner", "admin", "onboarding"]) {
  test(`${role} requires all-company scope for company creation`, async () => {
    for (const view of ["companies", "hub", "legacy"]) {
      await open(role, false, view);
      assert.equal(await add().count(), 0);
      assert.equal(await page.locator(".add-company-card").count(), 0);
      assert.deepEqual(errors, []);
    }
  });
}
for (const role of ["demo", "owner", "admin", "onboarding"]) {
  test(`${role} preserves allowed creation entry points and opens the real dialog`, async () => {
    for (const view of ["companies", "hub", "legacy"]) {
      await open(role, true, view);
      assert.equal(await add().count(), 1);
      await add().click();
      await page.getByRole("dialog", {name:"Add a company", exact:true}).waitFor();
      await page.getByRole("button", {name:"Cancel", exact:true}).click();
      if (view === "companies") {
        await page.locator(".add-company-card").click();
        await page.getByRole("dialog", {name:"Add a company", exact:true}).waitFor();
      }
      assert.deepEqual(errors, []);
    }
  });
}
test("an operations session never renders the creation dialog even when its parent is open", async () => {
  await open("operations", false, "companies", true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.companyUpdates), []);
});
for (const [role, all] of [["onboarding", false], ["operations", true]]) {
  test(`changing access to ${role} / all companies ${all} dismisses an already open company form`, async () => {
    await open("onboarding", true);
    await add().click();
    await page.getByRole("dialog").waitFor();
    await page.getByLabel("Company name", {exact:true}).fill("Unsubmitted QA company");
    await page.evaluate(([nextRole, nextAll]) => window.setFixtureCompanyAccess(nextRole, nextAll), [role, all]);
    await page.getByRole("dialog").waitFor({state:"detached"});
    assert.equal(await add().count(), 0);
    assert.deepEqual(await page.evaluate(() => window.companyUpdates), []);
  });
}
test("an allowed company form still creates the company and onboarding task", async () => {
  await open("owner", true);
  await add().click();
  assert.match(await page.getByRole("dialog").innerText(), /Initial setup task assigned to you: staff@example.test/);
  await page.getByLabel("Company name", {exact:true}).fill("New Synthetic Title");
  await page.getByLabel("Primary contact", {exact:true}).fill("Test Contact");
  await page.getByLabel("Contact email", {exact:true}).fill("contact@example.test");
  await page.getByLabel("City", {exact:true}).fill("Charlotte");
  await page.getByRole("dialog").getByRole("button", {name:"Add company", exact:true}).click();
  await page.getByRole("dialog").waitFor({state:"detached"});
  await page.getByRole("heading", {name:"New Synthetic Title", exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.companyUpdates), [{title:"Company added",detail:"New Synthetic Title · onboarding started"}]);
  const state = await page.evaluate(() => window.readFixtureCompanyState());
  const company = state.companies.find(row => row.name === "New Synthetic Title");
  assert.equal(company.contact, "Test Contact");
  assert.equal(company.email, "contact@example.test");
  const tasks = state.tasks.filter(task => task.companyId === company.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Collect onboarding application");
  assert.equal(tasks[0].owner, "staff@example.test");
  assert.equal(tasks[0].assigneeId, "fixture-user");
});
test("local sample company creation preserves its illustrative setup owner", async () => {
  await open("demo", true);await add().click();
  await page.getByLabel("Company name", {exact:true}).fill("Fictional Demo Title");
  await page.getByLabel("Primary contact", {exact:true}).fill("Test Contact");
  await page.getByLabel("Contact email", {exact:true}).fill("demo@example.test");
  await page.getByLabel("City", {exact:true}).fill("Charlotte");
  await page.getByRole("dialog").getByRole("button", {name:"Add company",exact:true}).click();await page.getByRole("dialog").waitFor({state:"detached"});
  const state=await page.evaluate(()=>window.readFixtureCompanyState());const company=state.companies.find(row=>row.name==="Fictional Demo Title");const task=state.tasks.find(row=>row.companyId===company.id);
  assert.equal(task.owner,"Stephenie");assert.equal(task.assigneeId,undefined);
});
