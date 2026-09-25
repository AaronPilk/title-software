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
    absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", loader: { ".css": "empty", ".module.css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""', "process.env.NEXT_PUBLIC_TITLE_HOSTED_PILOT": '""' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {MissiveCompanyIntakeButton,CompanyIntakeProfile} from './components/title/company-intake';
      import {CompanyDetail} from './components/title/companies';
      import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace(),query=new URLSearchParams(location.search);return <><MissiveCompanyIntakeButton/>{query.has('capture')?<CompanyDetail id={s.companies[0].id} onClose={()=>{}} onDoc={()=>{}} onUpload={()=>{}}/>:query.has('profile')&&<CompanyIntakeProfile company={s.companies[0]}/>}<div id="ready"/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fictional-company-intake", setup(builder) {
      builder.onResolve({filter:/^\.\/package-review$/},()=>({path:'package',namespace:'package-fixture'}));
      builder.onLoad({filter:/.*/,namespace:'package-fixture'},()=>({loader:'tsx',resolveDir:web,contents:`
        import React from 'react';import {useWorkspace} from '@/lib/title/store';import {documentScanIdentity} from './components/title/use-document-scan';
        export function PackageReviewButton({documents,onCompanyCapture}){const {connection}=useWorkspace();return <button onClick={()=>onCompanyCapture({packageId:'fictional-review',packageVersion:4,values:{name:'Cedar Legal Title LLC',contact:'Reviewed Fictional Contact',email:'reviewed@example.test'},sourceIdentities:documents.map(doc=>({documentId:doc.id,identity:documentScanIdentity(doc,connection)}))})}>Fixture reviewed company details</button>;}
      `}));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onLoad({ filter: /^client$/, namespace: "fixture" }, () => ({ contents: `
        export const activeWorkspace=()=>"workspace-fictional";
        window.companyRequests=[];
        export async function backendRequest(path,data,method,timeout,workspaceId,userId){
          window.companyRequests.push({path,method,workspaceId,userId});
          if(path!=="/integrations/missive/company-candidates"||method!=="GET")throw Error("Unexpected provider operation");
          if(new URLSearchParams(location.search).has('delayed'))await new Promise(resolve=>window.releaseDirectory=resolve);
          return {fetchedAt:'2026-09-23T20:00:00.000Z',candidates:[
            {organizationId:'org-1',organizationName:'Fictional Family',teamId:'cedar',teamName:'Cedar Title'},
            {organizationId:'org-1',organizationName:'Fictional Family',teamId:'pine',teamName:'Pine Title'},
            {organizationId:'org-1',organizationName:'Fictional Family',teamId:'cedar-alias',teamName:'Cedar Title Final Policies'}]};
        }
      ` }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';import {buildCompanyFromCandidate} from './lib/title/company-intake';
        const query=new URLSearchParams(location.search),listeners=new Set();const state=createSeed();state.companies=[];state.tasks=[];
        if(query.has('profile'))state.companies=[buildCompanyFromCandidate({organizationId:'org-1',organizationName:'Fictional Family',teamId:'cedar',teamName:'Cedar Title'},{id:'draft-1',importedAt:'2026-09-23T20:00:00.000Z',importedBy:'owner@example.test'})];
        if(query.has('capture'))state.documents=[{id:'company-original',companyId:'draft-1',assetId:'original-1',name:'Fictional application.pdf',mime:'application/pdf',version:1,visibility:'Internal',category:'Applications',date:'2026-09-23',size:'1 KB'}];
        const access=(role='owner',allCompanies=true,version=1)=>({workspaceId:'workspace-fictional',revision:1,access:{role,allCompanies,version,userId:'owner-user',email:'owner@example.test',companyIds:state.companies.map(c=>c.id)}});
        let snapshot={s:state,connection:access(query.get('role')||'owner',query.get('all')!=='false')};const emit=()=>listeners.forEach(fn=>fn());
        window.companyRequests=[];window.companyMutations=[];window.readIntake=()=>structuredClone(snapshot.s);
        window.changeIntakeAccess=(role,allCompanies)=>{snapshot={...snapshot,connection:access(role,allCompanies,snapshot.connection.access.version+1)};emit();};
        window.addExistingCompany=name=>{const next=structuredClone(snapshot.s);next.companies.push({...createSeed().companies[0],id:'external-company',name});snapshot={...snapshot,s:next};emit();};
        window.changeProfileContact=contact=>{const next=structuredClone(snapshot.s);next.companies[0].contact=contact;snapshot={...snapshot,s:next};emit();};
        window.changeCompanyCaptureSource=kind=>{const next=structuredClone(snapshot.s);if(kind==='company')next.companies[0].email='newer@example.test';else if(kind==='asset')next.documents[0].assetId='changed-asset';else if(kind==='visibility')next.documents[0].visibility='Restricted';else next.documents[0].version++;snapshot={...snapshot,s:next};emit();};
        export const getAssetForDocument=async()=>{throw Error("No logo original in this fixture")}; export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(change,title,detail)=>{const next=structuredClone(snapshot.s);change(next);window.companyMutations.push({title,detail});snapshot={...snapshot,s:next};emit();return true;}};}
        export const download=()=>{};export const getAsset=async()=>{throw Error('Unexpected original read')};export const saveAsset=async()=>{throw Error('Unexpected original write')};
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    if (req.url === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0].contents); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
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
async function directory() { await page.getByRole("button", { name: "Import company names from Missive", exact: true }).click(); await page.getByRole("button", { name: "Load Missive names" }).click(); await page.getByRole("checkbox", { name: "Create company from Cedar Title", exact: true }).waitFor(); }
const select = name => page.getByRole("checkbox", { name: `Create company from ${name}`, exact: true }).click();
const ack = () => page.getByRole("checkbox", { name: "I reviewed the selected company names and existing matches" });

test("only company-wide owner/admin can load Missive company candidates", async () => {
  for (const query of ["role=operations", "role=onboarding", "role=viewer", "role=admin&all=false", "role=owner&all=false"]) {
    await open(query); assert.equal(await page.getByRole("button", { name: "Import company names from Missive" }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.companyRequests), []);
  }
});

test("reviewed import creates blank profiles and assigned completion tasks without Missive mutations", async () => {
  await open(); assert.deepEqual(await page.evaluate(() => window.companyRequests), []); await directory();
  await select("Cedar Title"); await select("Pine Title");
  const submit = page.getByRole("button", { name: "Create 2 company profiles" }); assert.equal(await submit.isDisabled(), true);
  await ack().click(); await submit.click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  const s = await page.evaluate(() => window.readIntake()); assert.equal(s.companies.length, 2); assert.equal(s.tasks.length, 2);
  for (const company of s.companies) { assert.equal(company.contact, ""); assert.equal(company.email, ""); assert.equal(company.jurisdiction, ""); assert.deepEqual(company.members, []); assert.equal(company.intake.nameUnverified, true); }
  for (const task of s.tasks) { assert.equal(task.assigneeId, "owner-user"); assert.equal(task.done, false); assert.match(task.title, /collect owners and documents/); }
  assert.deepEqual(await page.evaluate(() => window.companyRequests), [{ path: "/integrations/missive/company-candidates", method: "GET", workspaceId: "workspace-fictional", userId: "owner-user" }]);
  await directory(); assert.equal(await page.getByRole("checkbox", { name: "Create company from Cedar Title", exact: true }).isDisabled(), true);
});

test("new duplicate matches and changed display names clear the exact review acknowledgement", async () => {
  await open(); await directory(); await select("Cedar Title"); await ack().click();
  await page.evaluate(() => window.addExistingCompany("Cedar Title LLC"));
  assert.equal(await ack().isChecked(), false); assert.equal(await page.getByRole("button", { name: "Create 1 company profile", exact: true }).isDisabled(), true);
  assert.match(await page.getByRole("dialog").innerText(), /Review existing companies/);
  await ack().click(); await page.getByLabel("Company display name for Cedar Title", { exact: true }).fill("Cedar Ridge Title");
  assert.equal(await ack().isChecked(), false);
});

test("two inboxes with the same chosen company name cannot create two companies", async () => {
  await open(); await directory(); await select("Cedar Title"); await select("Pine Title");
  await page.getByLabel("Company display name for Pine Title", { exact: true }).fill("Cedar Title"); await ack().click();
  assert.equal(await page.getByRole("button", { name: "Create 2 company profiles" }).isDisabled(), true);
  assert.match(await page.getByRole("dialog").innerText(), /Two selected inboxes/);
});

test("revoked access discards a late directory response", async () => {
  await open("delayed=1"); await page.getByRole("button", { name: "Import company names from Missive" }).click(); await page.getByRole("button", { name: "Load Missive names" }).click();
  await page.evaluate(() => window.changeIntakeAccess("operations", false)); await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.evaluate(() => window.releaseDirectory());
  assert.equal(await page.getByRole("checkbox").count(), 0); assert.deepEqual(await page.evaluate(() => window.companyMutations), []);
});

test("profile edits can save partial known facts with no default state or inferred owners", async () => {
  await open("profile=1"); await page.getByRole("button", { name: "Complete company profile", exact: true }).click();
  assert.equal(await page.getByLabel("Initial operating state", { exact: true }).inputValue(), "");
  await page.getByLabel("Primary contact", { exact: true }).fill("Fictional Contact"); await page.getByRole("button", { name: "Save company profile" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" }); const c = (await page.evaluate(() => window.readIntake())).companies[0];
  assert.equal(c.contact, "Fictional Contact"); assert.equal(c.intake.profileStatus, "incomplete"); assert.equal(c.intake.nameUnverified, true); assert.equal(c.jurisdiction, ""); assert.deepEqual(c.members, []);
});

test("confirmed profile completion fills basics but keeps onboarding and ownership unapproved", async () => {
  await open("profile=1"); await page.getByRole("button", { name: "Complete company profile", exact: true }).click();
  await page.getByLabel("Company name", { exact: true }).fill("Cedar Title LLC"); await page.getByRole("checkbox", { name: "I verified the legal company name against its documents" }).click();
  await page.getByLabel("Primary contact", { exact: true }).fill("Fictional Contact"); await page.getByLabel("Contact email", { exact: true }).fill("contact@example.test"); await page.getByLabel("City", { exact: true }).fill("Charlotte");
  await page.getByLabel("Initial operating state", { exact: true }).selectOption("NC"); await page.getByRole("button", { name: "Save company profile" }).click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  const c = (await page.evaluate(() => window.readIntake())).companies[0]; assert.equal(c.name, "Cedar Title LLC"); assert.equal(c.intake.profileStatus, "complete"); assert.equal(c.intake.nameUnverified, false); assert.deepEqual(c.operatingStates, ["NC"]); assert.deepEqual(c.steps, Array(7).fill(false)); assert.deepEqual(c.members, []);
});

test("an open profile form refuses to overwrite changes made while it was being edited", async () => {
  await open("profile=1"); await page.getByRole("button", { name: "Complete company profile", exact: true }).click();
  await page.getByLabel("Primary contact", { exact: true }).fill("Stale Contact"); await page.evaluate(() => window.changeProfileContact("Newer Contact"));
  await page.getByRole("button", { name: "Save company profile" }).click(); assert.match(await page.getByRole("alert").innerText(), /profile changed/);
  assert.equal((await page.evaluate(() => window.readIntake())).companies[0].contact, "Newer Contact");
});

async function companyCapture() { await open("profile=1&capture=1"); await page.getByRole("tab", {name:"Documents",exact:true}).click(); await page.getByRole("button", {name:"Fixture reviewed company details"}).click(); await page.getByRole("dialog", {name:"Complete company profile",exact:true}).waitFor(); }
test("reviewed company details prefill only legal name/contact/email and still need an explicit save",async()=>{
  await companyCapture();assert.equal(await page.getByLabel('Company name',{exact:true}).inputValue(),'Cedar Legal Title LLC');assert.equal(await page.getByLabel('Primary contact',{exact:true}).inputValue(),'Reviewed Fictional Contact');assert.equal(await page.getByLabel('Contact email',{exact:true}).inputValue(),'reviewed@example.test');
  assert.equal(await page.getByLabel('City',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Initial operating state',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('checkbox',{name:'I verified the legal company name against its documents'}).isChecked(),false);assert.deepEqual(await page.evaluate(()=>window.companyMutations),[]);
  await page.getByRole('button',{name:'Save company profile'}).click();const c=(await page.evaluate(()=>window.readIntake())).companies[0];assert.equal(c.name,'Cedar Legal Title LLC');assert.equal(c.intake.profileStatus,'incomplete');assert.deepEqual(c.members,[]);assert.match((await page.evaluate(()=>window.companyMutations))[0].detail,/fictional-review, version 4/);
});
for(const kind of ['version','asset','visibility','company','access'])test(`company prefill closes when its ${kind} identity changes`,async()=>{
  await companyCapture();if(kind==='access')await page.evaluate(()=>window.changeIntakeAccess('owner',true));else await page.evaluate(kind=>window.changeCompanyCaptureSource(kind),kind);
  await page.getByRole('dialog',{name:'Complete company profile',exact:true}).waitFor({state:'detached'});assert.match(await page.getByRole('alert').innerText(),/company, original documents or your access changed/);assert.deepEqual(await page.evaluate(()=>window.companyMutations),[]);
});
