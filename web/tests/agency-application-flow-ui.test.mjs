// Actual upload -> PDF.js -> labeled application extraction -> reviewed fill ->
// private save. Only workspace storage and private API transports are fictional.
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

const firstApplicant = [
  "Applicant 1", "Name: Avery Example", "Email: avery@example.test", "Phone: 7045550101",
  "DOB: 1988-02-20", "SSN: 123-45-6789", "Driver's License #: EX123456",
  "Current Address: 100 Fictional Lane", "Ownership: Business", "Owner business name: Fictional Owner LLC",
  "Owner business status: Existing", "Formation reference: Fictional filing reference",
  "Residence History", "Address | From | To", "100 Fictional Lane | 2020-01-01 | Present",
  "Employment History", "Employer | Role | Address | From | To",
  "Fictional Employer | Analyst | 100 Test Road | 2020-01-01 | Present",
];
const secondApplicant = [
  "Applicant 2", "Name: Jordan Example", "Email: jordan@example.test", "Ownership: Individual",
  "Logo preferences: Navy and white wordmark", "Additional notes: Fictional application for an existing company",
];

function applicationPdf(pages = [firstApplicant, secondApplicant]) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`];
  for (const [index, lines] of pages.entries()) {
    const id = 3 + index * 3;
    const content = typeof lines[0] === "object" ? lines.map(({text,x,y}) => `BT /F1 12 Tf ${x} ${y} Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n") : `BT /F1 12 Tf 35 760 Td ${Math.min(19, Math.floor(680 / lines.length))} TL\n` + lines.map((line, i) => `${i ? "T* " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n") + "\nET";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let output = "%PDF-1.7\n";
  const offsets = objects.map((object, i) => { const offset = Buffer.byteLength(output); output += `${i + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: "Fictional completed application.pdf", mimeType: "application/pdf", buffer: Buffer.from(output) };
}

before(async () => {
  const globalStyles = process.env.AGENCY_UI_GLOBAL_CSS ? await readFile(process.env.AGENCY_UI_GLOBAL_CSS) : null;
  const entry = await build({ absWorkingDir: web, outfile: "app.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", target: "es2022", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {JVApplicationPanel} from './components/title/jv-application';import {DocumentPreview} from './components/title/documents';import {useWorkspace} from '@/lib/title/store';import {useWorkspaceView} from './components/title/use-workspace-view';
      function App(){const {s}=useWorkspace();const [key,setKey]=useState(0);const [sourceId,setSourceId]=useState('');const [preview,setPreview]=useState(true);window.reopenApplication=()=>setKey(v=>v+1);const q=new URLSearchParams(location.search);const route=useWorkspaceView({userId:'fictional-owner',email:'owner@example.test',role:'owner',workspaceId:'fictional-workspace'},'Fictional');window.navigationResults||=[];if(q.has('stored')&&!sourceId)return <main>{s.documents[0]&&preview?<DocumentPreview doc={s.documents[0]} onClose={()=>setPreview(false)} onFillApplication={doc=>{setSourceId(doc.id);setPreview(false)}}/>:<p>Waiting for stored original</p>}</main>;return <main>{q.has('navigation')&&<nav aria-label="Fixture workspace navigation"><button onClick={()=>window.navigationResults.push(route.navigate('Settings'))}>Open settings</button><button onClick={()=>window.navigationResults.push(route.switchView('production'))}>Switch to Production</button><button onClick={()=>window.navigationResults.push(route.navigate('Onboarding'))}>Return to applications</button><output aria-label="Current workspace route">{route.view+'/'+route.page}</output></nav>}{!q.has('navigation')||route.page==='Onboarding'?<JVApplicationPanel key={key} sourceDocumentId={sourceId} company={s.companies[0]} existingCompany={!q.has('new')} initiallyOpen onDocuments={()=>window.documentNavigations++}/>:<h2>Another workspace page</h2>}</main>;}createRoot(document.getElementById('root')).render(<App/>);
    ` }, plugins: [{ name: "fictional-agency-application-transport", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';import {validateBusinessMutation} from './lib/title/business';
        const q=new URLSearchParams(location.search),listeners=new Set(),assets=new Map();const s=createSeed();s.companies=s.companies.slice(0,2);s.companies[0].name='Fictional Existing Title';s.companies[1].name='Other Fictional Title';s.documents=[];s.orders=[];
        let snapshot={s,connection:q.has('local')?undefined:{workspaceId:'fictional-workspace',revision:1,access:{userId:'fictional-owner',email:'owner@example.test',role:q.get('role')||'owner',version:1,allCompanies:!q.has('outofscope'),companyIds:[],restricted:!q.has('unrestricted')}}};
        window.applicationUploads=[];window.applicationWorkspaceWrites=[];window.documentNavigations=0;window.applicationPending=[];window.assetReads=0;
        window.applicationWorkspace=()=>structuredClone(snapshot);
        window.installApplicationOriginal=(bytes,overrides={})=>{const file=new Blob([new Uint8Array(bytes)],{type:'application/pdf'});assets.set('stored-asset',file);snapshot={...snapshot,s:{...snapshot.s,documents:[{id:'stored-app',companyId:'c1',name:'Fictional saved application.pdf',category:'Applications',visibility:'Restricted',assetId:'stored-asset',mime:'application/pdf',date:'2026-09-25',size:'1 KB',version:1,...overrides}]}};listeners.forEach(fn=>fn());};
        window.changeApplicationAccess=()=>{snapshot={...snapshot,connection:{...snapshot.connection,access:{...snapshot.connection.access,restricted:false,version:2}}};listeners.forEach(fn=>fn());};
        export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,update:async(fn,title,detail)=>{if(window.applicationSaveFailure)return false;const next=structuredClone(snapshot.s);fn(next);validateBusinessMutation(snapshot.s,next);snapshot={...snapshot,s:next,connection:{...snapshot.connection,revision:snapshot.connection.revision+1}};window.applicationWorkspaceWrites.push({title,detail});listeners.forEach(fn=>fn());return true;}};}
        export async function saveAsset(id,file,binding){window.applicationUploads.push({id,binding,name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});if(window.holdApplicationUpload)await new Promise(resolve=>window.applicationPending.push(resolve));assets.set(id,file);}
        export async function getAsset(id){window.assetReads++;return assets.get(id);}
        export const download=()=>{throw Error('No downloads expected in this flow');};
      ` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/jv-intake-client$/ }, () => ({ path: "intake", namespace: "fixture" }));
      builder.onLoad({ filter: /^intake$/, namespace: "fixture" }, () => ({ loader: "ts", resolveDir: web, contents: `
        import {newJVApplication,validateJVApplication,jvIntakeFingerprint} from '@/lib/title/jv-application';
        const q=new URLSearchParams(location.search),payload=newJVApplication();if(q.has('existingdetails')){Object.assign(payload.applicants[0],{name:'Previously Saved Applicant',email:'saved@example.test',residenceHistory:[{id:'old-residence',address:'Old Fictional Address',from:'2020-01-01',to:''}]});payload.notes='Keep this saved note';}if(q.has('existingglobal')){payload.logoPreferences='Blue lettering';payload.notes='Existing fictional note';}
        let record={companyId:'c1',version:q.has('existingdetails')?1:0,payload,status:'Draft',reviewNote:'',updatedAt:null,updatedBy:null,reviewedAt:null,reviewedBy:null};window.privateApplicationRequests=[];window.privateApplicationPending=[];if(q.has('holdload'))window.holdPrivateApplicationRequest='load';window.readPrivateApplication=()=>structuredClone(record);
        export async function jvIntakeClientRequest(context,action,data){window.privateApplicationRequests.push({context,action,data:structuredClone(data)});const access=window.applicationWorkspace().connection?.access;if(!access||!access.restricted||!['owner','admin','onboarding'].includes(access.role)||(!access.allCompanies&&!access.companyIds.includes(context.companyId)))throw Object.assign(Error('fictional access denied'),{status:403});if(window.holdPrivateApplicationRequest===action){window.holdPrivateApplicationRequest='';await new Promise(resolve=>window.privateApplicationPending.push(resolve));}if(window.privateApplicationFailure)throw Object.assign(Error('DO NOT SHOW private server details'),{status:window.privateApplicationFailure});if(action==='load')return structuredClone(record);if(data.expectedVersion!==record.version)throw Object.assign(Error('conflict'),{status:409});const payload=data.payload?validateJVApplication(data.payload):record.payload;const changed=jvIntakeFingerprint(payload)!==jvIntakeFingerprint(record.payload);record={...record,version:record.version+1,payload,status:changed?'Draft':record.status};return structuredClone(record);}
      ` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/jv-portal-client$/ }, () => ({ path: "portal", namespace: "fixture" }));
      builder.onLoad({ filter: /^portal$/, namespace: "fixture" }, () => ({ contents: `window.applicationPortalRequests=[];export async function jvPortalClientRequest(context,action){window.applicationPortalRequests.push({context,action});if(action!=='list')throw Error('No links or emails may be sent by this fixture');return {requests:[],mailConfigured:true};}export async function jvPortalDownload(){throw Error('No portal downloads expected');}` }));
      builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "/pdf.worker.mjs", namespace: "worker-url" }));
      builder.onResolve({ filter: /local-ocr\.worker\.ts\?worker&url$/ }, () => ({ path: "/unused-ocr.worker.js", namespace: "worker-url" }));
      builder.onLoad({ filter: /.*/, namespace: "worker-url" }, args => ({ contents: `export default ${JSON.stringify(args.path)};` }));
    } }] });
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") { res.writeHead(200, { "content-type": "text/html" });res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + (globalStyles ? '<link rel="stylesheet" href="/global.css">' : '<style>*{box-sizing:border-box}body{margin:0;background:#eef4fa;font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:#123451}button,input,select,textarea{font:inherit}button{cursor:pointer}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px;border:1px solid #c8d7e5;border-radius:22px;z-index:10}.form-note{color:#52677d;font-size:13px;line-height:1.6}.field-label{display:flex;flex-direction:column;gap:6px;min-width:0}.form-stack{display:flex;flex-direction:column;gap:16px}</style>') + '<link rel="stylesheet" href="/app.css"><style>main{max-width:960px;margin:20px auto;padding:16px}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');return; }
    if (path === "/global.css" && globalStyles) { res.writeHead(200, { "content-type": "text/css" });res.end(globalStyles);return; }
    if (["inter-400-700.woff2", "source-serif-pro-400.woff2", "source-serif-pro-600.woff2", "source-serif-pro-700.woff2"].some(name => path === `/brand/fonts/${name}`)) { res.writeHead(200, { "content-type": "font/woff2" });res.end(await readFile(resolve(web, "public", path.slice(1))));return; }
    if (path === "/app.mjs" || path === "/app.css") { res.writeHead(200, { "content-type": path.endsWith("css") ? "text/css" : "text/javascript" });res.end(entry.outputFiles.find(file => file.path.endsWith(path)).contents);return; }
    if (path === "/pdf.worker.mjs") { res.writeHead(200, { "content-type": "text/javascript" });res.end(await readFile(resolve(web, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")));return; }
    res.writeHead(404);res.end();
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { await context?.close();assert.deepEqual(errors, []); });
after(async () => { await browser?.close();if (server) { server.closeAllConnections();await new Promise(done => server.close(done)); } });

async function open(query = "", mobile = false) {
  errors = [];requests = [];
  context = await browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1200, height: 1100 } });
  await context.route("**/*", route => { const url = route.request().url();requests.push(url);if (!url.startsWith(`${origin}/`)) { errors.push("Unexpected external request");return route.abort(); }return route.continue(); });
  page = await context.newPage();page.setDefaultTimeout(6000);page.on("pageerror", error => errors.push(error.message));await page.goto(`${origin}/?${query}${query.includes("navigation=1") ? "#agency/onboarding" : ""}`);
  await page.waitForFunction(() => !!window.privateApplicationRequests);
  await page.locator("main").waitFor({ state: "attached" });
}
async function upload(file = applicationPdf()) {
  await page.getByRole("button", { name: "Upload completed application", exact: true }).click();
  assert.equal(await page.getByLabel("Upload company", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Document category", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Document visibility", { exact: true }).count(), 0);
  await page.getByText("Private company application · Restricted access", { exact: true }).waitFor();
  await page.getByLabel("Select completed application", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "Upload and read application", exact: true }).click();
  await page.getByText("application suggestions for", { exact: false }).waitFor({ timeout: 15000 });
  return file;
}
async function reviewClear() {
  await page.getByRole("checkbox", { name: "I checked all clear suggestions against the original. Conflicting answers still need a separate choice.", exact: true }).check();
}
async function applyAndSave() {
  await page.getByRole("button", { name: "Apply reviewed application", exact: true }).click();
  await page.getByRole("button", { name: "Save application details", exact: true }).click();
  await page.getByText("Private application saved.", { exact: true }).waitFor();
  return page.evaluate(() => window.readPrivateApplication());
}

test("existing companies start with the completed application and keep the manual launch checklist out of the way", async () => {
  await open();await page.getByRole("button", { name: "Upload completed application", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/title-agency-application-start-desktop.png", fullPage: true });
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("navigation", { name: "Application sections", exact: true }).count(), 0);
  assert.equal(await page.locator(".jv-checklist-row:visible").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.applicationUploads), []);
  assert.deepEqual(await page.evaluate(() => window.applicationPortalRequests), []);
});

test("a real two-page PDF uploads to restricted applications, fills both people after review, and survives reopening", async () => {
  await open();const before = await page.evaluate(() => window.applicationWorkspace().s.companies[0]);
  const original = await upload();
  await page.screenshot({ path: "/tmp/title-agency-application-review-desktop.png", fullPage: true });
  const uploaded = await page.evaluate(() => ({ uploads: window.applicationUploads, workspace: window.applicationWorkspace().s, saved: window.readPrivateApplication() }));
  assert.equal(uploaded.uploads.length, 1);assert.equal(uploaded.uploads[0].binding.companyId, "c1");assert.deepEqual(uploaded.uploads[0].bytes, Array.from(original.buffer));
  assert.equal(uploaded.workspace.documents.length, 1);
  const doc = uploaded.workspace.documents[0];assert.equal(doc.companyId, "c1");assert.equal(doc.category, "Applications");assert.equal(doc.visibility, "Restricted");assert.equal(doc.orderId, undefined);
  assert.equal(uploaded.saved.payload.applicants[0].name, "");
  assert.equal(await page.getByRole("button", { name: "Apply reviewed application", exact: true }).isDisabled(), true);
  assert.ok(requests.some(url => url.endsWith("/pdf.worker.mjs")), "the actual PDF.js worker must read the uploaded bytes");
  await reviewClear();const saved = await applyAndSave();
  assert.equal(saved.payload.applicants.length, 2);assert.equal(saved.payload.applicants[0].name, "Avery Example");assert.equal(saved.payload.applicants[1].name, "Jordan Example");
  assert.equal(saved.payload.applicants[0].email, "avery@example.test");assert.equal(saved.payload.applicants[1].email, "jordan@example.test");
  assert.equal(saved.payload.applicants[0].businessName, "Fictional Owner LLC");assert.equal(saved.payload.applicants[0].residenceHistory[0].address, "100 Fictional Lane");
  assert.equal(saved.payload.applicants[0].employmentHistory[0].employer, "Fictional Employer");assert.equal(saved.payload.logoPreferences, "Navy and white wordmark");
  assert.deepEqual(saved.payload.sourceDocumentIds, [doc.id]);assert.equal(saved.status, "Draft");assert.ok(saved.payload.steps.every(step => step.status === "Not started"));
  assert.deepEqual(await page.evaluate(() => window.applicationWorkspace().s.companies[0]), before, "importing an existing company's application does not restart its operating/launch status");
  await page.evaluate(() => window.reopenApplication());await page.getByText("Avery Example · Jordan Example", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.readPrivateApplication()), saved);
  assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
  assert.deepEqual(await page.evaluate(() => window.applicationPortalRequests), []);
});

test("the supplied application's split labels and instructions fill a returned PDF without copying prompts into company records", async () => {
  await open();const company = await page.evaluate(() => window.applicationWorkspace().s.companies[0]);
  await upload(applicationPdf([[
    "JOINT VENTURE", "APPLI CATI ON", "NAME:", "Avery Fictional", "EMAIL:", "avery@example.test",
    "PHONE NUMBER:", "7045550101", "DATE OF BIRTH:", "1988-02-20", "SOCIAL SECURITY #", "123-45-6789",
    "DRIVERS LICENSE #:", "EX123456", "CURRENT ADDRESS:", "100 Fictional Lane, Example NC 28000",
    "WILL OWNERSHIP BE INDIVIDUAL OR BUSINESS?", "Individual", "RESIDENCE LAST 5 YEARS:",
    "Address | From | To", "100 Fictional Lane | 2020-01-01 | Present", "EMPLOYMENT HISTORY", "LAST 5YEARS:",
    "Employer | From | To", "Fictional Employer | 2020-01-01 | Present",
    "LOGO: PLEASE LET US KNOW IF YOU HAVE A PREFERENCE OR SUGGESTOINS FOR LOGO.",
    "COLORS, DESIGN ETC. IF YOU HAVE A CURRENT LOGO YOU WOULD LIKE US TO RECREATE,", "PLEASE LET US KNOW.",
    "Navy and silver, use a simple wordmark.", "ANY OTHER INFORMATION YOU THINK WE SHOULD KNOW OR SUGGESTIONS?",
    "Call after 3 pm.", "WWW.BALLANTYNETITLE.COM",
  ]]));
  await reviewClear();const saved = await applyAndSave();const person = saved.payload.applicants[0];
  assert.equal(person.name, "Avery Fictional");assert.equal(person.email, "avery@example.test");assert.equal(person.ssn, "123456789");assert.equal(person.ownershipType, "individual");
  assert.equal(person.residenceHistory.length, 1);assert.equal(person.employmentHistory.length, 1);
  assert.equal(saved.payload.logoPreferences, "Navy and silver, use a simple wordmark.");assert.equal(saved.payload.notes, "Call after 3 pm.");
  assert.deepEqual(await page.evaluate(() => window.applicationWorkspace().s.companies[0]), company);
});

test("new ventures offer their private recipient link without uploading a file or sending an email", async () => {
  await open("new=1");await page.getByText("Start with an application", { exact: true }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Joint venture application", exact: true }).getByRole("button").first().innerText(), "Send application link");
  await page.getByRole("button", { name: "Send application link", exact: true }).click();
  await page.getByLabel("Recipient name", { exact: true }).waitFor();
  await page.waitForFunction(() => window.applicationPortalRequests.length === 1);
  assert.equal(await page.getByRole("button", { name: "Prepare private link", exact: true }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.applicationPortalRequests), [{ context: { workspaceId: "fictional-workspace", userId: "fictional-owner", companyId: "c1" }, action: "list" }]);
  assert.deepEqual(await page.evaluate(() => window.applicationUploads), []);
});

for (const query of ["local=1", "role=operations", "role=partner", "unrestricted=1", "outofscope=1"]) test(`${query} cannot collect or load private application data`, async () => {
  await open(query);assert.equal(await page.getByRole("button", { name: "Upload completed application", exact: true }).count(), 0);
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.privateApplicationRequests), []);assert.deepEqual(await page.evaluate(() => window.applicationUploads), []);
});

test("existing private values remain saved until explicit review; replacing history requires its own confirmation", async () => {
  await open("existingdetails=1");const before = await page.evaluate(() => window.readPrivateApplication());await upload();
  assert.deepEqual(await page.evaluate(() => window.readPrivateApplication()), before);
  const personId = before.payload.applicants[0].id;
  assert.equal(await page.getByRole("combobox", { name: "Source applicant 1 destination", exact: true }).inputValue(), "");
  await page.getByRole("combobox", { name: "Source applicant 1 destination", exact: true }).selectOption(personId);
  await reviewClear();const apply = page.getByRole("button", { name: "Apply reviewed application", exact: true });assert.equal(await apply.isDisabled(), true);
  await page.getByRole("checkbox", { name: /Replace [0-9]+ existing details? with the reviewed values/ }).check();
  await page.getByRole("checkbox", { name: /Replace existing source applicant 1 residence history/ }).check();
  await apply.click();assert.deepEqual(await page.evaluate(() => window.readPrivateApplication()), before, "reviewed fill is still a draft until Save");
  await page.getByRole("button", { name: "Save application details", exact: true }).click();await page.getByText("Private application saved.", { exact: true }).waitFor();
  const after = await page.evaluate(() => window.readPrivateApplication());assert.equal(after.payload.applicants[0].name, "Avery Example");assert.equal(after.payload.applicants[0].id, before.payload.applicants[0].id);
  assert.equal(after.payload.applicants[0].residenceHistory[0].address, "100 Fictional Lane");
});

test("conflicting values cannot be included by clear-suggestion review", async () => {
  await open();await upload(applicationPdf([["Applicant 1", "Name: Avery Example", "Email: first@example.test", "Email: second@example.test"]]));
  await reviewClear();const saved = await applyAndSave();assert.equal(saved.payload.applicants[0].name, "Avery Example");assert.equal(saved.payload.applicants[0].email, "");
});

test("checked but unapplied suggestions require confirmation before closing or changing the original", async () => {
  await open();await upload();await reviewClear();
  assert.equal(await page.getByRole("button", { name: "Apply reviewed application", exact: true }).isDisabled(), false);
  const selected = await page.getByRole("combobox", { name: "Application original", exact: true }).inputValue();
  let sourcePrompt = "";page.once("dialog", dialog => { sourcePrompt = dialog.message();return dialog.dismiss(); });await page.getByRole("combobox", { name: "Application original", exact: true }).selectOption("");
  assert.match(sourcePrompt, /Discard the current document review/);
  assert.equal(await page.getByRole("combobox", { name: "Application original", exact: true }).inputValue(), selected);
  page.once("dialog", dialog => dialog.dismiss());await page.getByRole("button", { name: "Close application", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Apply reviewed application", exact: true }).isDisabled(), false);
  page.once("dialog", dialog => dialog.accept());await page.getByRole("button", { name: "Close application", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Apply reviewed application", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.readPrivateApplication().version), 0);
});

test("replacing application notes and logo preferences needs an acknowledgement tied to the current draft", async () => {
  await open("existingglobal=1");await upload(applicationPdf([["Logo preferences: Navy wordmark", "Additional notes: New fictional application note"]]));await reviewClear();
  const apply = page.getByRole("button", { name: "Apply reviewed application", exact: true });
  const acknowledge = page.getByRole("checkbox", { name: /Replace 2 existing details with the reviewed values/ });
  assert.equal(await apply.isDisabled(), true);await acknowledge.check();assert.equal(await apply.isDisabled(), false);
  await page.getByRole("button", { name: "Edit application details", exact: true }).click();
  await page.getByRole("button", { name: "3. Branding & documents", exact: true }).click();
  await page.getByRole("textbox", { name: "Other application information", exact: true }).fill("Changed the current fictional note during review");
  assert.equal(await acknowledge.isChecked(), false);assert.equal(await apply.isDisabled(), true);
  await acknowledge.check();const saved = await applyAndSave();assert.equal(saved.payload.logoPreferences, "Navy wordmark");assert.equal(saved.payload.notes, "New fictional application note");
});

test("matching application notes and logo values do not require a replacement acknowledgement", async () => {
  await open("existingglobal=1");await upload(applicationPdf([["Logo preferences: Blue lettering", "Additional notes: Existing fictional note"]]));await reviewClear();
  assert.equal(await page.getByRole("checkbox", { name: /Replace [0-9]+ existing details? with the reviewed values/ }).count(), 0);
  const saved = await applyAndSave();assert.equal(saved.payload.logoPreferences, "Blue lettering");assert.equal(saved.payload.notes, "Existing fictional note");
});

test("an authorization failure while saving extracted answers clears private suggestions and does not publish server details", async () => {
  await open();await upload();await reviewClear();await page.getByRole("button", { name: "Apply reviewed application", exact: true }).click();
  await page.evaluate(() => window.privateApplicationFailure = 403);
  await page.getByRole("button", { name: "Save application details", exact: true }).click();
  await page.getByRole("alert").waitFor();assert.doesNotMatch(await page.locator("body").innerText(), /Avery Example|Jordan Example|DO NOT SHOW/);
  assert.equal(await page.evaluate(() => window.readPrivateApplication().version), 0);
});

test("revoking restricted access during original upload cannot allocate documents or save private answers", async () => {
  await open();await page.getByRole("button", { name: "Upload completed application", exact: true }).click();
  await page.getByLabel("Select completed application", { exact: true }).setInputFiles(applicationPdf());await page.evaluate(() => window.holdApplicationUpload = true);
  await page.getByRole("button", { name: "Upload and read application", exact: true }).click();await page.waitForFunction(() => window.applicationPending.length === 1);
  await page.evaluate(() => window.changeApplicationAccess());await page.evaluate(() => window.applicationPending.shift()());
  assert.equal(await page.getByRole("button", { name: "Upload completed application", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.applicationWorkspace().s.documents), []);
  assert.deepEqual(await page.evaluate(() => window.applicationWorkspaceWrites), []);
  assert.equal(await page.evaluate(() => window.readPrivateApplication().version), 0);
});

test("phone-width upload and review fit the viewport and keep the primary action reachable", async () => {
  await open("", true);await page.getByRole("button", { name: "Upload completed application", exact: true }).waitFor();await page.screenshot({ path: "/tmp/title-agency-application-start-mobile.png", fullPage: true });await upload();
  const dimensions = await page.locator("main").evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.left >= 0 && dimensions.right <= 375);assert.ok(dimensions.scroll <= dimensions.client + 1);
  await page.screenshot({ path: "/tmp/title-agency-application-review-mobile.png", fullPage: true });
  await reviewClear();await page.getByRole("button", { name: "Apply reviewed application", exact: true }).scrollIntoViewIfNeeded();await applyAndSave();
});

test("actual sidebar and workspace-view navigation preserve a cancelled application draft and discard only after acceptance", async () => {
  await open("navigation=1");await page.getByRole("button", { name: "Enter details manually", exact: true }).click();
  await page.getByRole("textbox", { name: "Applicant name", exact: true }).fill("Unsaved Fictional Applicant");
  const prompts = [];
  page.once("dialog", dialog => { prompts.push(dialog.message());return dialog.dismiss(); });await page.getByRole("button", { name: "Open settings", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Applicant name", exact: true }).inputValue(), "Unsaved Fictional Applicant");assert.match(page.url(), /#agency\/onboarding$/);
  page.once("dialog", dialog => { prompts.push(dialog.message());return dialog.dismiss(); });await page.getByRole("button", { name: "Switch to Production", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Applicant name", exact: true }).inputValue(), "Unsaved Fictional Applicant");assert.deepEqual(await page.evaluate(() => window.navigationResults), [false, false]);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  page.once("dialog", dialog => { prompts.push(dialog.message());return dialog.accept(); });await page.getByRole("button", { name: "Switch to Production", exact: true }).click();
  await page.getByRole("heading", { name: "Another workspace page", exact: true }).waitFor();assert.match(page.url(), /#production\/overview$/);assert.equal(prompts.length, 3);
  assert.equal(await page.getByRole("textbox", { name: "Applicant name", exact: true }).count(), 0);assert.equal(await page.evaluate(() => window.readPrivateApplication().version), 0);
  await page.getByRole("button", { name: "Return to applications", exact: true }).click();await page.getByRole("button", { name: "Enter details manually", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Applicant name", exact: true }).inputValue(), "");
});

test("loading and saving a real application block global navigation without a discard prompt", async () => {
  await open("navigation=1&holdload=1");await page.waitForFunction(() => window.privateApplicationPending.length === 1);
  const prompts = [];page.on("dialog", dialog => { prompts.push(dialog.message());return dialog.dismiss(); });
  await page.getByRole("button", { name: "Open settings", exact: true }).click();assert.match(page.url(), /#agency\/onboarding$/);assert.deepEqual(await page.evaluate(() => window.navigationResults), [false]);
  await page.evaluate(() => window.privateApplicationPending.shift()());await page.getByRole("button", { name: "Enter details manually", exact: true }).click();
  await page.getByRole("textbox", { name: "Applicant name", exact: true }).fill("Saved Fictional Applicant");await page.evaluate(() => window.holdPrivateApplicationRequest = "save");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();await page.waitForFunction(() => window.privateApplicationPending.length === 1);
  await page.getByRole("button", { name: "Switch to Production", exact: true }).click();assert.match(page.url(), /#agency\/onboarding$/);assert.deepEqual(await page.evaluate(() => window.navigationResults), [false, false]);assert.deepEqual(prompts, []);
  await page.evaluate(() => window.privateApplicationPending.shift()());await page.getByText("Private application saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();await page.getByRole("heading", { name: "Another workspace page", exact: true }).waitFor();assert.deepEqual(prompts, []);
  assert.equal(await page.evaluate(() => window.readPrivateApplication().payload.applicants[0].name), "Saved Fictional Applicant");
});


test("a saved application opens autofill directly from its document without uploading again", async () => {
  await open("stored=1");
  await page.evaluate(bytes=>window.installApplicationOriginal(bytes),Array.from(applicationPdf().buffer));
  await page.getByRole("button",{name:"Fill application from this document",exact:true}).click();
  await page.getByText("application suggestions for",{exact:false}).waitFor({timeout:15000});
  assert.equal(await page.getByLabel("Application original",{exact:true}).inputValue(),"stored-app");
  assert.deepEqual(await page.evaluate(()=>window.applicationUploads),[]);
  await reviewClear();const saved=await applyAndSave();
  assert.equal(saved.payload.applicants[0].name,"Avery Example");
  assert.equal(saved.payload.applicants[1].email,"jordan@example.test");
  assert.deepEqual(saved.payload.sourceDocumentIds,["stored-app"]);
  await page.evaluate(()=>window.reopenApplication());
  await page.getByText("Avery Example · Jordan Example",{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.readPrivateApplication()),saved);
});

for(const [label,query,doc] of [["local","local=1",{}],["operations","role=operations",{}],["no restricted grant","unrestricted=1",{}],["different company scope","outofscope=1",{}],["title file","",{orderId:"fictional-order"}],["ordinary record","",{category:"Company records"}]]){
 test(`document autofill is unavailable for ${label}`,async()=>{
  await open(`stored=1&${query}`);await page.evaluate(({bytes,doc})=>window.installApplicationOriginal(bytes,doc),{bytes:Array.from(applicationPdf().buffer),doc});
  await page.getByRole("dialog").waitFor();assert.equal(await page.getByRole("button",{name:"Fill application from this document",exact:true}).count(),0);
  assert.deepEqual(await page.evaluate(()=>window.privateApplicationRequests),[]);
 });
}


test("flattened answers painted after questions fill the saved private application in visual order", async()=>{
  const rows=[['NAME:','Avery Fictional'],['EMAIL:','avery@example.test'],['PHONE NUMBER:','7045550101'],['DATE OF BIRTH:','03/04/1988'],['SOCIAL SECURITY #','123456789'],['DRIVERS LICENSE #:','EX123456'],['CURRENT ADDRESS:','100 Fictional Lane, Example NC 28000']];
  const positioned=[...rows.map(([text],i)=>({text,x:40,y:700-i*35})),...rows.map(([,text],i)=>({text,x:230,y:700-i*35})).reverse(),{text:'RESIDENCE LAST 5 YEARS:',x:40,y:390},{text:'100 Fictional Lane - since 2017',x:230,y:394},{text:'EMPLOYMENT HISTORY',x:40,y:300},{text:'Fictional Employer - Analyst',x:230,y:304},{text:'Since January 2019',x:230,y:284},{text:'LAST 5YEARS:',x:40,y:280}];
  const original=applicationPdf([['Welcome to the fictional application'],positioned,['Additional notes: Fictional notes for the company','Continuation of the same answer']]);
  await open('stored=1');await page.evaluate(bytes=>window.installApplicationOriginal(bytes),Array.from(original.buffer));
  await page.getByRole('button',{name:'Fill application from this document',exact:true}).click();
  await page.getByText('application suggestions for',{exact:false}).waitFor({timeout:15000});
  await page.getByLabel('Application date format',{exact:true}).selectOption('mdy');
  const histories=page.locator('.jv-guided-candidate').filter({hasText:'History as written'}).locator('input[type=checkbox]');await histories.nth(0).check();await histories.nth(1).check();assert.equal(await histories.nth(0).isChecked(),true);
  await reviewClear();const saved=await applyAndSave();const person=saved.payload.applicants[0];
  assert.equal(person.name,'Avery Fictional');assert.equal(person.email,'avery@example.test');assert.equal(person.phone,'7045550101');assert.equal(person.dob,'1988-03-04');assert.equal(person.ssn,'123456789');assert.equal(person.driverLicense,'EX123456');assert.equal(person.currentAddress,'100 Fictional Lane, Example NC 28000');
  assert.match(saved.payload.notes,/100 Fictional Lane - since 2017/);assert.match(saved.payload.notes,/Fictional Employer - Analyst/);assert.match(saved.payload.notes,/Since January 2019/);assert.match(saved.payload.notes,/Continuation of the same answer/);
  assert.deepEqual(person.residenceHistory,[]);assert.deepEqual(person.employmentHistory,[]);assert.equal(person.ownershipType,'undecided');assert.equal(saved.status,'Draft');assert.deepEqual(await page.evaluate(()=>window.applicationUploads),[]);
});
