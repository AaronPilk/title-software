// Actual PolicyWorkbench, final workspace, source capture, reader and policy editor. Only workspace/storage transport uses fictional fixtures.
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
  const bundle = await build({ absWorkingDir: web, outfile: "final-preparation-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {PolicyWorkbench} from './components/title/policies';
      import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();const [selected,setSelected]=React.useState(s.orders[0].id);return <PolicyWorkbench selectedId={selected} onSelect={id=>{window.finalActions.push(id);setSelected(id)}}/>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "synthetic-final-preparation", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /^workspace$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';
        import {addPolicy,products,savePolicy} from './lib/title/business';import {reviewCommitment,finalReadiness,neededFields} from './lib/title/production';
        import {emptyFinalPreparation,finalPreparationSourceSnapshot,finalPreparationProblems,saveFinalPreparation,reviewFinalPreparation,prepareFinalHandoff} from './lib/title/final-preparation';
        const q=new URLSearchParams(location.search),s=createSeed(),o=s.orders[0];
        o.underwriter='WFG';o.production.requirements.forEach(r=>{r.status=r.kind==='Requirement'?'Satisfied':'Retained';r.evidence='Reviewed synthetic original';r.note='Reviewed disposition'});o.fields.forEach(f=>{f.reviewed=true});
        s.documents.filter(d=>d.orderId===o.id).forEach((d,index)=>{d.name='Synthetic '+(d.sourceRole||'source')+' '+index+'.txt';d.assetId='synthetic-asset-'+index;d.mime='text/plain';delete d.providerSource});
        const other=s.orders.find(row=>row.companyId!==o.companyId);other.status='Needs review';other.exception='';s.documents.push({...structuredClone(s.documents.find(d=>d.orderId===o.id&&d.sourceRole==='Final opinion')),id:'second-final-opinion',orderId:other.id,companyId:other.companyId,assetId:'second-original'});window.secondFinal={id:other.id,companyId:other.companyId,companyName:s.companies.find(c=>c.id===other.companyId).name};window.firstFinal={id:o.id,companyId:o.companyId};window.deedFields=neededFields(o).filter(def=>def.role==='Deed');
        const policy=addPolicy(s,o.id,'Owner');policy.insured='Fictional owner';policy.form='Fictional approved form v1';policy.exceptions=o.production.requirements.filter(r=>r.kind==='Exception').map(r=>({itemId:r.id,disposition:'Retain',wording:r.text,reason:'Reviewed synthetic final exception instruction'}));
        reviewCommitment(s,o,'Current commitment and synthetic originals reviewed.');
        if(!finalReadiness(s,o).ready)throw new Error('Synthetic fixture is not ready');
        if(q.has('no-products'))s.business.policies=s.business.policies.filter(p=>p.orderId!==o.id);
        if(!q.has('no-products')){
          const input=emptyFinalPreparation(s,o);input.eligibility={companyEvidence:'Synthetic appointment reviewed',attorneyEvidence:'Synthetic attorney approval reviewed',note:'Company, state, attorney and WFG match this transaction.'};
          for(const row of input.products){row.variant='Standard';row.form=products(s,o.id).find(p=>p.id===row.policyId).form;row.reviewNote='Form and variant reviewed against synthetic instructions';row.endorsementReviewNote='No endorsements apply under reviewed synthetic instructions'}
          input.fees[0]={id:'binder',kind:'Binder',label:'Binder fee',decision:'Not applicable',amount:null,reference:'Synthetic fee instruction',rationale:'No charge on this synthetic file'};
          input.feeReviewNote='Fee applicability reviewed';input.reply={to:'attorney@example.test',subject:'Synthetic handoff',body:'Local draft for manual review only.'};
          if(finalPreparationProblems(s,o,input).length)throw new Error('Synthetic worksheet is incomplete');
          saveFinalPreparation(s,o.id,input,0,finalPreparationSourceSnapshot(s,o));reviewFinalPreparation(s,o.id,1,finalPreparationSourceSnapshot(s,o),'Synthetic evidence checked.');prepareFinalHandoff(s,o.id,1,finalPreparationSourceSnapshot(s,o));
        }
        if(q.has('legacy-review')){const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value;o.production.commitmentReview.snapshot=JSON.stringify(reverseKeys(JSON.parse(o.production.commitmentReview.snapshot)))}
        let snapshot={s,connection:{workspaceId:'synthetic-workspace',revision:1,access:{role:q.get('role')||'operations',userId:'synthetic-user',allCompanies:true,companyIds:[o.companyId],version:1,restricted:false}}};
        const listeners=new Set(),emit=()=>listeners.forEach(listener=>listener());
        window.finalActions=[];window.finalDialogs=[];window.confirm=message=>{window.finalDialogs.push(message);return window.acceptNavigation===true};window.finalSaves=[];window.finalDownloads=[];window.finalAssetReads=[];window.finalControl={failSave:false,failAsset:false,holdAsset:false};
        window.finalState=()=>structuredClone(snapshot.s);window.finalBaseline=structuredClone({business:s.business,documents:s.documents,replyDrafts:s.replyDrafts,status:o.status,delivered:o.delivered});
        window.changeFinal=kind=>{
          if(kind==='access'){snapshot={...snapshot,connection:{...snapshot.connection,access:{...snapshot.connection.access,allCompanies:false,companyIds:[],version:2}}};emit();return}
          const next=structuredClone(snapshot.s),order=next.orders[0];
          if(kind==='source')next.documents.find(d=>d.orderId===order.id&&d.sourceRole==='Deed').version++;
          else if(kind==='file-details'){order.production.version++;order.production.county='Fictional county saved by another reviewer'}
          else if(kind==='policy'){const policy=structuredClone(products(next,order.id)[0]);policy.form='Fictional form saved by another reviewer';savePolicy(next,policy)}
          else if(kind==='worksheet'){const input=structuredClone(order.finalPreparation.input);input.note='Remote worksheet change';saveFinalPreparation(next,order.id,input,order.finalPreparation.version,finalPreparationSourceSnapshot(next,order))}
          snapshot={...snapshot,s:next,connection:{...snapshot.connection,revision:snapshot.connection.revision+1}};emit();
        };
        async function update(fn,title,orderId,revision){
          window.finalSaves.push({title,orderId,revision});if(window.finalControl.holdSave)await new Promise(resolve=>{window.releaseFinalSave=resolve});if(window.finalControl.failSave)return false;
          const next=structuredClone(snapshot.s);fn(next);snapshot={...snapshot,s:next,connection:{...snapshot.connection,revision:snapshot.connection.revision+1}};emit();return true;
        }
        export function useWorkspace(){const value=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>snapshot);return {...value,update}}
        export const exportCsv=()=>{};export async function saveAsset(){throw new Error("Unexpected upload in workbench regression")};export async function getAsset(id){return new Blob(['Fictional original source bytes for '+id+'\\nPage 1. Recorded evidence.'],{type:'text/plain'})};
        export async function getAssetForDocument(document,options){
          window.finalAssetReads.push({id:document.id,options});window.finalAssetSettled=false;
          if(window.finalControl.holdAsset)await new Promise(resolve=>{window.releaseFinalAsset=resolve});
          try{if(window.finalControl.failAsset)throw new Error('Synthetic original unavailable');return new Blob(['Synthetic original bytes for '+document.id+'\\n'],{type:'text/plain'})}finally{window.finalAssetSettled=true}
        }
        export function download(name,value,mime){
          const record={name,mime:typeof value==='string'?mime:value.type,bytes:null};window.finalDownloads.push(record);
          if(typeof value==='string')record.bytes=Array.from(new TextEncoder().encode(value));else value.arrayBuffer().then(bytes=>{record.bytes=Array.from(new Uint8Array(bytes))});
        }
      ` }));
      builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "worker", namespace: "worker" }));
      builder.onLoad({ filter: /.*/, namespace: "worker" }, () => ({ contents: 'export default "/unused-worker.mjs";' }));
    } }],
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs" || path === "/app.css") {
      res.writeHead(200, { "content-type": path.endsWith(".mjs") ? "text/javascript" : "text/css" });
      res.end(bundle.outputFiles.find(file => file.path.endsWith(path.slice(4))).contents);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>.workbench{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px}.queue-filters,.work-queue{display:grid;gap:12px;align-content:start}.review-space{min-width:0}.queue-item{text-align:left;display:grid;gap:6px}.queue-item.selected{border:2px solid #377cb0}.segment-list{display:flex;flex-wrap:wrap;gap:6px;margin:15px 0}.source-document,.field-diff{padding:14px;margin:8px 0;border:1px solid #ccd8e5}.source-title,.source-actions{display:flex;gap:8px;flex-wrap:wrap}.form-stack,.field-label{display:grid;gap:8px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#23354955;z-index:40}[data-slot=dialog-content]{position:fixed;left:10%;top:8%;width:80%;max-height:85vh;overflow:auto;background:#fff;z-index:50;padding:24px}[data-slot=select-content]{position:relative;background:#fff;z-index:60;padding:15px}[data-slot=select-item]{padding:8px}*{box-sizing:border-box}body{margin:28px;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;background:#edf3fa;color:#29475f}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button[data-slot=button]{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 12px;background:#f9fbff;border:1px solid #d1deed;border-radius:11px;font-size:11px}button:disabled{opacity:.5;cursor:default}.status{font-size:11px;white-space:nowrap}.empty-state{padding:28px;text-align:center}.empty-state>svg{width:28px}.empty-state h3{font-size:15px}.empty-state p{font-size:12px;line-height:1.7}:root{--glass-edge:#d2deeb;--glass-shadow:0 8px 32px #17375b12}@media(max-width:700px){body{margin:12px}}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });

async function open(query = "", viewport = { width: 1320, height: 1000 }) {
  errors = []; context = await browser.newContext({ viewport }); page = await context.newPage(); page.setDefaultTimeout(4000);
  await context.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : (errors.push("Unexpected external request"), route.abort()));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/?${query}`); try { await page.getByRole("region", { name: "WFG final preparation", exact: true }).waitFor(); } catch (error) { throw new Error(`${error.message} Browser errors: ${JSON.stringify(errors)}; body: ${await page.locator("body").innerText()}`); }
}
const button = name => page.getByRole("button", { name, exact: true });
const tab = name => page.getByRole("tab", { name, exact: true });
const step = name => page.getByRole("navigation", { name: "Final preparation steps" }).getByRole("button", { name: new RegExp(name) });
const finalRegion = () => page.getByRole("region", { name: "WFG final preparation", exact: true });
async function choose(label, name) { await page.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name, exact: true }).click(); }
async function assertDraftKept() {
  assert.equal(await tab("Prepare final").getAttribute("aria-selected"), "true");
  assert.equal(await page.getByLabel("Preparation notes").inputValue(), "Unsaved integrated worksheet");
  assert.deepEqual(await page.evaluate(() => window.finalActions), []);
}
async function assertStale() {
  await tab("Prepare final").click();
  await finalRegion().getByRole("alert").filter({ hasText: "Review the current file" }).waitFor();
  await step("Review & export").click();
  assert.equal(await button("Prepare handoff").isDisabled(), true);
  assert.equal(await button("Download readable handoff").isDisabled(), true);
  assert.equal(await button("Download handoff + selected originals").isDisabled(), true);
}

test("actual workbench guards tab, search, company, assignee, readiness and file navigation while a worksheet is dirty", async () => {
  await open(); await step("WFG worksheet").click(); await page.getByLabel("Preparation notes").fill("Unsaved integrated worksheet");
  await tab("Source package").click(); await assertDraftKept();
  await page.getByLabel("Find a final file…", { exact: true }).fill("will not match");
  assert.equal(await page.getByLabel("Find a final file…", { exact: true }).inputValue(), ""); await assertDraftKept();
  const other = await page.evaluate(() => window.secondFinal);
  await choose("Finals company", other.companyName); assert.equal(await page.getByRole("combobox", { name: "Finals company", exact: true }).innerText(), "All companies"); await assertDraftKept();
  await page.getByRole("combobox", { name: "Finals assignee", exact: true }).click(); await page.getByRole("option").nth(1).click(); await assertDraftKept();
  await choose("Finals readiness", "Waiting"); await assertDraftKept();
  await page.locator(".queue-item").filter({ hasText: other.id }).click(); await assertDraftKept();
  const prompts = await page.evaluate(() => window.finalDialogs);
  assert.ok(prompts.length >= 6); assert.ok(prompts.every(text => /Discard unsaved changes/.test(text)));
  await button("Save worksheet").click(); await page.getByRole("status").filter({ hasText: "Worksheet saved as a draft" }).waitFor();
  await tab("Source package").click(); await page.getByRole("heading", { name: "Final opinion & recorded documents", exact: true }).waitFor();
  await tab("Prepare final").click(); await step("WFG worksheet").click();
  assert.equal(await page.getByLabel("Preparation notes").inputValue(), "Unsaved integrated worksheet");
  assert.equal(await page.evaluate(() => window.finalDialogs.length), prompts.length, "Saved worksheet allows navigation without a discard prompt");
});

test("an explicitly accepted discard changes the actual file and clears its previous private draft", async () => {
  await open(); await step("WFG worksheet").click(); await page.getByLabel("Preparation notes").fill("Private unsaved first-file notes");
  const other = await page.evaluate(() => window.secondFinal);
  await page.evaluate(() => { window.acceptNavigation = true; });
  await page.locator(".queue-item").filter({ hasText: other.id }).click();
  await step("WFG worksheet").click(); assert.equal(await page.getByLabel("Preparation notes").inputValue(), "");
  assert.deepEqual(await page.evaluate(() => window.finalActions), [other.id]);
  assert.equal(await page.evaluate(() => window.finalState().orders[0].finalPreparation.input.note), "");
});

test("source callback opens the actual original reader and capture form; returning exposes the stale handoff gate", async () => {
  await open(); await button("Open source package").click();
  assert.equal(await tab("Source package").getAttribute("aria-selected"), "true");
  const deed = page.locator(".source-document").filter({ hasText: /Synthetic Deed \d/ });
  await deed.getByRole("button", { name: /Synthetic Deed / }).click();
  await page.getByRole("dialog").getByText(/Fictional original source bytes/).waitFor();
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
  await deed.getByRole("button", { name: "Capture fields", exact: true }).click();
  const defs = await page.evaluate(() => window.deedFields);
  await page.getByLabel("Page or section reference", { exact: true }).fill("Page 1, reviewed recording stamp");
  const originalValue = await page.locator(`input[name="${defs[0].id}"]`).inputValue();
  await page.locator(`input[name="${defs[0].id}"]`).fill(`${originalValue} corrected from original`);
  await button("Save for field review").click(); await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.ok((await page.evaluate(() => window.finalSaves)).some(row => row.title === "Source values captured"));
  const captured = await page.evaluate(id => window.finalState().orders[0].fields.find(field => field.id === id), defs[0].id);
  assert.equal(captured.reviewed, false); assert.equal(captured.sourcePage, "Page 1, reviewed recording stamp");
  await assertStale();
  await step("Sources & facts").click(); await button("Review captured facts").click();
  assert.equal(await tab("Document review").getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("checkbox", { name: `Reviewed ${defs[0].label}`, exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel(defs[0].label, { exact: true }).inputValue(), captured.proposed);
});

test("captured fact correction saves through the real workbench and requires a fresh final review", async () => {
  await open(); await button("Review captured facts").click();
  const field = await page.evaluate(() => window.finalState().orders[0].fields[0]);
  const input = page.getByLabel(field.label, { exact: true });
  await input.fill(`${field.proposed} corrected`); await input.press("Tab");
  await page.waitForFunction(id => window.finalState().orders[0].fields.find(field => field.id === id).reviewed === false, field.id);
  const changed = await page.evaluate(id => window.finalState().orders[0].fields.find(field => field.id === id), field.id);
  assert.equal(changed.sourceValue, field.sourceValue); assert.equal(changed.proposed, `${field.proposed} corrected`);
  await page.getByRole("checkbox", { name: `Reviewed ${field.label}`, exact: true }).check();
  await button("Continue to final preparation").click();
  assert.equal(await tab("Prepare final").getAttribute("aria-selected"), "true");
  await assertStale();
});

test("policy product callback edits the actual approved form and reconnects with the worksheet mismatch blocker", async () => {
  await open(); await button("Manage policy products").click();
  assert.equal(await tab("Policy products").getAttribute("aria-selected"), "true");
  await page.getByLabel("Approved form / version reference", { exact: true }).fill("Fictional revised approved form v2");
  await button("Save policy details").click();
  await page.waitForFunction(() => window.finalState().business.policies.some(policy => policy.orderId === window.firstFinal.id && policy.form === "Fictional revised approved form v2"));
  await assertStale(); assert.match(await page.locator("details").innerText(), /form.*match|exact.*form/i);
  await step("Sources & facts").click(); await button("Review file details").click();
  assert.equal(await tab("File details").getAttribute("aria-selected"), "true");
  await page.getByRole("heading", { name: "Transaction & commitment context" }).first().waitFor();
});

test("a file without products can add an Owner product through the existing policy editor and return to a new worksheet row", async () => {
  await open("no-products=1"); await button("Manage policy products").click();
  await page.getByRole("heading", { name: "Choose the coverage products", exact: true }).waitFor();
  await button("Owner").click(); await page.getByRole("heading", { name: "Owner policy", exact: true }).waitFor();
  await tab("Prepare final").click(); await step("WFG worksheet").click();
  assert.equal(await page.getByLabel("Policy variant").inputValue(), "Needs review");
  assert.equal((await page.evaluate(() => window.finalState().business.policies.filter(policy => policy.orderId === window.firstFinal.id))).length, 1);
});

for (const editor of [
  { tab: "Policy products", label: "Approved form / version reference", save: "Save policy details", draft: "Fictional unsaved policy revision" },
  { tab: "File details", label: "County", save: "Save details", draft: "Fictional unsaved county correction" },
]) test(`${editor.tab} preserves its draft through refused navigation, failed saves and in-flight saves`, async () => {
  await open(); await tab(editor.tab).click(); await page.getByLabel(editor.label, { exact: true }).fill(editor.draft);
  await tab("Prepare final").click();
  assert.equal(await tab(editor.tab).getAttribute("aria-selected"), "true", "Unsaved editor navigation must require a deliberate discard");
  assert.equal(await page.getByLabel(editor.label, { exact: true }).inputValue(), editor.draft);
  await page.evaluate(() => { window.finalControl.failSave = true; }); await button(editor.save).click();
  await page.waitForFunction(() => window.finalSaves.length > 0);
  assert.equal(await button(editor.save).isEnabled(), true, "A rejected save must preserve the pending draft");
  await page.getByRole("alert").filter({ hasText: /not (saved|confirmed)/ }).waitFor();
  await tab("Prepare final").click(); assert.equal(await tab(editor.tab).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByLabel(editor.label, { exact: true }).inputValue(), editor.draft);
  await page.evaluate(() => { window.finalControl.failSave = false; window.finalControl.holdSave = true; });
  await button(editor.save).click(); await page.waitForFunction(() => typeof window.releaseFinalSave === "function");
  const prompts = await page.evaluate(() => window.finalDialogs.length);
  await tab("Prepare final").click(); assert.equal(await tab(editor.tab).getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => window.finalDialogs.length), prompts, "A pending save cannot be discarded");
  await page.evaluate(() => { window.finalControl.holdSave = false; window.releaseFinalSave(); });
  await page.waitForFunction(({ tab, draft }) => { const s=window.finalState();return tab==="File details" ? s.orders[0].production.county===draft : s.business.policies.some(policy=>policy.orderId===window.firstFinal.id&&policy.form===draft); }, editor);
  await assertStale();
});

test("a pending worksheet save blocks workbench tabs, filters and file switching without offering to discard the write", async () => {
  await open(); await step("WFG worksheet").click(); await page.getByLabel("Preparation notes").fill("Unsaved integrated worksheet");
  await page.evaluate(() => { window.finalControl.holdSave = true; }); await button("Save worksheet").click();
  await page.waitForFunction(() => typeof window.releaseFinalSave === "function");
  await tab("Source package").click(); await assertDraftKept();
  await page.getByLabel("Find a final file…", { exact: true }).fill("will not match"); await assertDraftKept();
  const other = await page.evaluate(() => window.secondFinal);
  await choose("Finals company", other.companyName); await assertDraftKept();
  await page.locator(".queue-item").filter({ hasText: other.id }).click(); await assertDraftKept();
  assert.deepEqual(await page.evaluate(() => window.finalDialogs), []);
  await page.evaluate(() => { window.finalControl.holdSave = false; window.releaseFinalSave(); });
  await page.getByRole("status").filter({ hasText: "Worksheet saved as a draft" }).waitFor();
  await tab("Source package").click(); await page.getByRole("heading", { name: "Final opinion & recorded documents", exact: true }).waitFor();
});

test("the policy editor's direct final-review callback honors the same draft guard", async () => {
  await open(); await page.evaluate(() => window.changeFinal("source")); await button("Manage policy products").click();
  await page.getByLabel("Approved form / version reference", { exact: true }).fill("Unsaved callback form");
  await button("Open final review").click(); assert.equal(await tab("Policy products").getAttribute("aria-selected"), "true");
  assert.equal(await page.getByLabel("Approved form / version reference", { exact: true }).inputValue(), "Unsaved callback form");
  assert.ok((await page.evaluate(() => window.finalDialogs)).length > 0);
  await page.evaluate(() => { window.acceptNavigation = true; }); await button("Open final review").click();
  assert.equal(await tab("Document review").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id).form), "Fictional approved form v1");
});

test("file details recognizes a semantically current legacy commitment review after database key reordering", async () => {
  await open("legacy-review=1"); await button("Review file details").click();
  assert.equal(await page.getByRole("checkbox", { name: /I reviewed the commitment requirements and exceptions/ }).isChecked(), true);
  assert.deepEqual(await page.evaluate(() => window.finalSaves), [], "Opening the review does not rewrite its audit stamp");
});

test("a remote title-file version change cannot silently overwrite the opened editor draft or the newer record", async () => {
  await open(); await button("Review file details").click();
  await page.getByLabel("County", { exact: true }).fill("Unsaved county from this editor");
  const openedVersion = await page.evaluate(() => window.finalState().orders[0].production.version);
  await page.evaluate(() => window.changeFinal("file-details"));
  assert.equal(await page.getByLabel("County", { exact: true }).inputValue(), "Unsaved county from this editor", "Remote updates must preserve the open draft until it is deliberately discarded");
  await button("Save details").click(); await page.getByRole("alert").filter({ hasText: "This file changed" }).waitFor();
  const production = await page.evaluate(() => window.finalState().orders[0].production);
  assert.equal(production.version, openedVersion + 1); assert.equal(production.county, "Fictional county saved by another reviewer");
  assert.equal(await page.getByLabel("County", { exact: true }).inputValue(), "Unsaved county from this editor");
  assert.equal(await button("Save details").isEnabled(), true);
});

test("successful file-detail saves advance only the editor's own confirmed version", async () => {
  await open(); await button("Review file details").click();
  const openedVersion = await page.evaluate(() => window.finalState().orders[0].production.version);
  for (const [index, county] of ["Fictional county first saved change", "Fictional county second saved change"].entries()) {
    await page.getByLabel("County", { exact: true }).fill(county);
    await page.getByLabel("Commitment review note").fill(`Reviewed ${county}`);
    await page.getByRole("checkbox", { name: /I reviewed the commitment requirements and exceptions/ }).check();
    await button("Save details").click();
    await page.waitForFunction(expected => window.finalState().orders[0].production.county === expected, county);
    assert.equal(await page.evaluate(() => window.finalState().orders[0].production.version), openedVersion + index + 1);
    assert.equal(await button("Save details").isDisabled(), true);
    const review = await page.evaluate(() => window.finalState().orders[0].production.commitmentReview);
    assert.equal(review.note, `Reviewed ${county}`); assert.equal(JSON.parse(review.snapshot).county, county);
    assert.equal(await page.getByRole("checkbox", { name: /I reviewed the commitment requirements and exceptions/ }).isChecked(), true);
  }
});

test("a remote policy version change preserves the open draft and rejects its stale save", async () => {
  await open(); await button("Manage policy products").click();
  await page.getByLabel("Approved form / version reference", { exact: true }).fill("Unsaved form from this editor");
  const openedVersion = await page.evaluate(() => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id).version);
  await page.evaluate(() => window.changeFinal("policy"));
  assert.equal(await page.getByLabel("Approved form / version reference", { exact: true }).inputValue(), "Unsaved form from this editor");
  await button("Save policy details").click(); await page.getByRole("alert").filter({ hasText: "This policy cannot be edited" }).waitFor();
  const policy = await page.evaluate(() => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id));
  assert.equal(policy.version, openedVersion + 1); assert.equal(policy.form, "Fictional form saved by another reviewer");
  assert.equal(await page.getByLabel("Approved form / version reference", { exact: true }).inputValue(), "Unsaved form from this editor");
});

test("repeated own policy saves synchronize the saved version and display the prepared lifecycle controls", async () => {
  await open(); await button("Manage policy products").click();
  const openedVersion = await page.evaluate(() => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id).version);
  for (const [index, form] of ["Fictional own form v2", "Fictional own form v3"].entries()) {
    await page.getByLabel("Approved form / version reference", { exact: true }).fill(form);
    await page.getByLabel("Policy preparation review").fill("Reviewed the fictional policy and original evidence.");
    await button("Save policy details").click();
    await page.waitForFunction(expected => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id).form === expected, form);
    assert.equal(await page.evaluate(() => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id).version), openedVersion + index + 1);
    assert.equal(await button("Save policy details").isDisabled(), true);
  }
  await button("Prepare policy handoff").click();
  await page.waitForFunction(() => window.finalState().business.policies.find(policy => policy.orderId === window.firstFinal.id).status === "Prepared");
  await page.getByLabel("Policy number", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Approved form / version reference", { exact: true }).inputValue(), "Fictional own form v3");
});
