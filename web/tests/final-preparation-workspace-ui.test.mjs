// Real workspace, final-preparation commands and ZIP writer; storage uses synthetic bytes only.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [];

before(async () => {
  const bundle = await build({ absWorkingDir: web, outfile: "final-preparation-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {FinalPreparationWorkspace} from './components/title/final-preparation-workspace';
      import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();return <FinalPreparationWorkspace order={s.orders[0]} onReviewSources={()=>window.finalActions.push('sources')} onReviewFields={()=>window.finalActions.push('fields')} onReviewDetails={()=>window.finalActions.push('details')} onReviewProducts={()=>window.finalActions.push('products')}/>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "synthetic-final-preparation", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /^workspace$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';
        import {addPolicy,products} from './lib/title/business';import {reviewCommitment,finalReadiness} from './lib/title/production';
        import {emptyFinalPreparation,finalPreparationSourceSnapshot,finalPreparationProblems,saveFinalPreparation,reviewFinalPreparation,prepareFinalHandoff} from './lib/title/final-preparation';
        const q=new URLSearchParams(location.search),s=createSeed(),o=s.orders[0];
        o.underwriter='WFG';o.production.requirements.forEach(r=>{r.status=r.kind==='Requirement'?'Satisfied':'Retained';r.evidence='Reviewed synthetic original';r.note='Reviewed disposition'});o.fields.forEach(f=>{f.reviewed=true});
        s.documents.filter(d=>d.orderId===o.id).forEach((d,index)=>{d.name='Synthetic '+(d.sourceRole||'source')+' '+index+'.txt';d.assetId='synthetic-asset-'+index;d.mime='text/plain';delete d.providerSource});
        const policy=addPolicy(s,o.id,'Owner');policy.insured='Fictional owner';policy.form='Fictional approved form v1';policy.exceptions=o.production.requirements.filter(r=>r.kind==='Exception').map(r=>({itemId:r.id,disposition:'Retain',wording:r.text,reason:'Reviewed synthetic final exception instruction'}));
        reviewCommitment(s,o,'Current commitment and synthetic originals reviewed.');
        if(!finalReadiness(s,o).ready)throw new Error('Synthetic fixture is not ready');
        if(q.has('no-products'))s.business.policies=s.business.policies.filter(p=>p.orderId!==o.id);
        if(q.has('prepared')){
          const input=emptyFinalPreparation(s,o);input.eligibility={companyEvidence:'Synthetic appointment reviewed',attorneyEvidence:'Synthetic attorney approval reviewed',note:'Company, state, attorney and WFG match this transaction.'};
          for(const row of input.products){row.variant='Standard';row.form=products(s,o.id).find(p=>p.id===row.policyId).form;row.reviewNote='Form and variant reviewed against synthetic instructions';row.endorsementReviewNote='No endorsements apply under reviewed synthetic instructions'}
          input.fees[0]={id:'binder',kind:'Binder',label:'Binder fee',decision:'Not applicable',amount:null,reference:'Synthetic fee instruction',rationale:'No charge on this synthetic file'};
          input.feeReviewNote='Fee applicability reviewed';input.reply={to:'attorney@example.test',subject:'Synthetic handoff',body:'Local draft for manual review only.'};
          if(finalPreparationProblems(s,o,input).length)throw new Error('Synthetic worksheet is incomplete');
          saveFinalPreparation(s,o.id,input,0,finalPreparationSourceSnapshot(s,o));reviewFinalPreparation(s,o.id,1,finalPreparationSourceSnapshot(s,o),'Synthetic evidence checked.');prepareFinalHandoff(s,o.id,1,finalPreparationSourceSnapshot(s,o));
        }
        let snapshot={s,connection:{workspaceId:'synthetic-workspace',revision:1,access:{role:q.get('role')||'operations',userId:'synthetic-user',allCompanies:true,companyIds:[o.companyId],version:1,restricted:false}}};
        const listeners=new Set(),emit=()=>listeners.forEach(listener=>listener());
        window.finalActions=[];window.finalSaves=[];window.finalDownloads=[];window.finalAssetReads=[];window.finalControl={failSave:false,failAsset:false,holdAsset:false};
        window.finalState=()=>structuredClone(snapshot.s);window.finalBaseline=structuredClone({business:s.business,documents:s.documents,replyDrafts:s.replyDrafts,status:o.status,delivered:o.delivered});
        window.changeFinal=kind=>{
          if(kind==='access'){snapshot={...snapshot,connection:{...snapshot.connection,access:{...snapshot.connection.access,allCompanies:false,companyIds:[],version:2}}};emit();return}
          const next=structuredClone(snapshot.s),order=next.orders[0];
          if(kind==='source')next.documents.find(d=>d.orderId===order.id&&d.sourceRole==='Deed').version++;
          else if(kind==='worksheet'){const input=structuredClone(order.finalPreparation.input);input.note='Remote worksheet change';saveFinalPreparation(next,order.id,input,order.finalPreparation.version,finalPreparationSourceSnapshot(next,order))}
          snapshot={...snapshot,s:next,connection:{...snapshot.connection,revision:snapshot.connection.revision+1}};emit();
        };
        async function update(fn,title,orderId,revision){
          window.finalSaves.push({title,orderId,revision});if(window.finalControl.failSave)return false;
          const next=structuredClone(snapshot.s);fn(next);snapshot={...snapshot,s:next,connection:{...snapshot.connection,revision:snapshot.connection.revision+1}};emit();return true;
        }
        export function useWorkspace(){const value=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>snapshot);return {...value,update}}
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
    } }],
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs" || path === "/app.css") {
      res.writeHead(200, { "content-type": path.endsWith(".mjs") ? "text/javascript" : "text/css" });
      res.end(bundle.outputFiles.find(file => file.path.endsWith(path.slice(4))).contents);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:28px;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;background:#edf3fa;color:#29475f}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button[data-slot=button]{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 12px;background:#f9fbff;border:1px solid #d1deed;border-radius:11px;font-size:11px}button:disabled{opacity:.5;cursor:default}.status{font-size:11px;white-space:nowrap}.empty-state{padding:28px;text-align:center}.empty-state>svg{width:28px}.empty-state h3{font-size:15px}.empty-state p{font-size:12px;line-height:1.7}:root{--glass-edge:#d2deeb;--glass-shadow:0 8px 32px #17375b12}@media(max-width:700px){body{margin:12px}}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
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
  await page.goto(`${origin}/?${query}`); await page.getByRole("region", { name: "WFG final preparation", exact: true }).waitFor();
}
const button = name => page.getByRole("button", { name, exact: true });
const step = name => page.getByRole("navigation", { name: "Final preparation steps" }).getByRole("button", { name: new RegExp(name) });
const downloads = () => page.getByRole("region", { name: "Final handoff downloads", exact: true });
const acknowledgement = () => page.getByRole("checkbox", { name: /^I checked the current source facts/ });
const asText = download => Buffer.from(download.bytes).toString("utf8");

async function fillWorksheet() {
  await step("WFG worksheet").click();
  await page.getByLabel("Company WFG authority evidence").fill("Synthetic appointment evidence reviewed for this file and state.");
  await page.getByLabel("Attorney WFG eligibility evidence").fill("Synthetic attorney eligibility reference checked.");
  await page.getByLabel("Compatibility review outcome").fill("Company, state, attorney and WFG match this transaction.");
  await page.getByLabel("Policy variant").selectOption("Standard");
  await page.getByLabel("Exact form and version").fill("Fictional approved form v1");
  await page.getByLabel("Variant, form and jacket review").fill("Variant and form match reviewed commitment and synthetic instructions.");
  await page.getByLabel("Endorsement review summary").fill("No endorsement applies under reviewed synthetic instructions.");
  await page.getByLabel("Fee applicability").selectOption("Not applicable");
  await page.getByLabel("Approved fee source").fill("Synthetic reviewed fee instruction");
  await page.getByLabel("Fee rationale").fill("Not charged on this synthetic file.");
  await page.getByLabel("Fee review summary").fill("Fee applicability reviewed against supplied synthetic instruction.");
  await button("Continue to local reply").click();
  await page.getByLabel("Reply recipient").fill("attorney@example.test");
  await page.getByLabel("Reply subject").fill("Synthetic final preparation review");
  await button("Prepare local reply").click();
  await button("Continue to review & export").click();
}

async function readyDownloads() { await step("Review & export").click(); assert.equal(await button("Download readable handoff").isEnabled(), true); }
async function selectOriginal() { await downloads().getByRole("checkbox").first().check(); }

function zipEntries(bytes) {
  const archive = Buffer.from(bytes), result = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 8), 0, "Source bytes must be stored intact");
    const length = archive.readUInt32LE(offset + 18), nameLength = archive.readUInt16LE(offset + 26), extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"), start = offset + 30 + nameLength + extraLength;
    result.set(name, archive.subarray(start, start + length)); offset = start + length;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50, "ZIP has a central directory");
  return result;
}

test("reviewed worksheet downloads readable handoff, text, local reply and byte-verified selected originals", async () => {
  await open();
  await step("WFG worksheet").click();
  assert.equal(await page.getByLabel("Company WFG authority evidence").inputValue(), "");
  assert.equal(await page.getByLabel("Policy variant").inputValue(), "Needs review");
  assert.equal(await page.getByLabel("Fee amount ($)").inputValue(), "");
  await fillWorksheet();
  assert.equal(await acknowledgement().isDisabled(), true);
  assert.equal(await button("Prepare handoff").isDisabled(), true);
  await button("Save worksheet").click();
  await page.getByRole("status").filter({ hasText: "Worksheet saved as a draft" }).waitFor();
  assert.equal(await button("Confirm worksheet review").isDisabled(), true);
  await page.getByLabel("Final review note").fill("Compared this worksheet with the current synthetic originals and approved instructions.");
  await acknowledgement().check(); await button("Confirm worksheet review").click();
  await page.getByRole("status").filter({ hasText: "Current worksheet reviewed" }).waitFor();
  assert.equal(await button("Confirm worksheet review").isDisabled(), true, "A current review cannot be recorded repeatedly");
  await button("Prepare handoff").click();
  await page.getByRole("status").filter({ hasText: "Reviewed handoff prepared" }).waitFor();
  assert.equal(await button("Confirm worksheet review").isDisabled(), true, "Export remains prepared until worksheet changes are explicitly saved");
  assert.match(await page.getByLabel("Final review note").inputValue(), /Compared this worksheet/);
  for (const name of ["Download readable handoff", "Download handoff text", "Download local reply"]) await button(name).click();
  await selectOriginal(); await button("Download handoff + selected originals").click();
  await page.waitForFunction(() => window.finalDownloads.length === 4 && window.finalDownloads.every(file => file.bytes));
  const files = await page.evaluate(() => window.finalDownloads), zip = zipEntries(files[3].bytes), manifest = JSON.parse(zip.get("manifest.json").toString());
  assert.match(asText(files[0]), /<!doctype html>/); assert.match(asText(files[0]), /NOT AN OFFICIAL POLICY OR JACKET/);
  assert.match(asText(files[1]), /Standard/); assert.match(asText(files[1]), /attorney@example.test/);
  assert.match(asText(files[2]), /LOCAL REPLY DRAFT — NOT SENT/);
  assert.deepEqual([...zip.keys()].slice(0, 4), ["handoff.html", "handoff.txt", "local-reply.txt", "manifest.json"]);
  assert.equal(manifest.sources.length, 1); assert.equal(zip.size, 5); assert.equal(manifest.notAPolicy, true);
  const original = zip.get(manifest.sources[0].path);
  assert.equal(original.toString(), `Synthetic original bytes for ${manifest.sources[0].documentId}\n`);
  assert.equal(manifest.sources[0].sha256, createHash("sha256").update(original).digest("hex"));
  assert.match(zip.get("handoff.txt").toString(), /BUNDLE SELECTION/);
  assert.deepEqual(await page.evaluate(() => window.finalAssetReads[0].options), { expectedWorkspaceId: "synthetic-workspace", expectedUserId: "synthetic-user" });
  const unchanged = await page.evaluate(() => { const s = window.finalState(), o = s.orders[0]; return { business: s.business, documents: s.documents, replyDrafts: s.replyDrafts, status: o.status, delivered: o.delivered }; });
  assert.deepEqual(unchanged, await page.evaluate(() => window.finalBaseline));
  assert.equal((await page.evaluate(() => window.finalState())).orders[0].finalPreparation.status, "Prepared");
  assert.deepEqual((await page.evaluate(() => window.finalSaves)).map(row => row.title), ["Final preparation worksheet saved", "Final preparation reviewed", "Final handoff prepared"]);
  if (process.env.FINAL_PREPARATION_SCREENSHOT) await page.screenshot({ path: process.env.FINAL_PREPARATION_SCREENSHOT, fullPage: true });
});

for (const kind of ["source", "worksheet"]) test(`a remote ${kind} change blocks stale saves and exports while preserving local edits until reload`, async () => {
  await open("prepared=1"); await step("WFG worksheet").click();
  await page.getByLabel("Preparation notes").fill("Unsaved local work must stay visible.");
  await page.evaluate(kind => window.changeFinal(kind), kind);
  await button("Reload current worksheet").waitFor();
  assert.equal(await page.getByLabel("Preparation notes").inputValue(), "Unsaved local work must stay visible.");
  assert.equal(await button("Save worksheet").isDisabled(), true);
  await step("Review & export").click();
  for (const name of ["Confirm worksheet review", "Prepare handoff", "Download readable handoff", "Download handoff text", "Download local reply"]) assert.equal(await button(name).isDisabled(), true);
  await button("Reload current worksheet").click(); await step("WFG worksheet").click();
  assert.equal(await page.getByLabel("Preparation notes").inputValue(), kind === "worksheet" ? "Remote worksheet change" : "");
  assert.equal(await page.getByLabel("Company WFG authority evidence").isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => window.finalDownloads), []);
});

test("a failed mutation keeps the draft and prevents review until a successful retry", async () => {
  await open(); await fillWorksheet();
  await page.evaluate(() => { window.finalControl.failSave = true; });
  await button("Save worksheet").click(); await page.getByRole("alert").filter({ hasText: "worksheet save was not confirmed" }).waitFor();
  assert.equal(await page.evaluate(() => window.finalState().orders[0].finalPreparation), undefined);
  assert.equal(await button("Confirm worksheet review").isDisabled(), true);
  await step("Local reply").click(); assert.match(await page.getByLabel("Local reply text").inputValue(), /Please review the WFG final preparation handoff/);
  assert.equal(await page.getByLabel("Reply recipient").inputValue(), "attorney@example.test");
  await page.evaluate(() => { window.finalControl.failSave = false; }); await button("Save worksheet").click();
  await page.getByRole("status").filter({ hasText: "Worksheet saved as a draft" }).waitFor();
  await step("Review & export").click(); await page.getByLabel("Final review note").fill("Current synthetic evidence checked."); await acknowledgement().check();
  await page.evaluate(() => { window.finalControl.failSave = true; }); await button("Confirm worksheet review").click();
  await page.getByRole("alert").filter({ hasText: "review save was not confirmed" }).waitFor();
  assert.equal(await page.getByLabel("Final review note").inputValue(), "Current synthetic evidence checked.");
  assert.equal(await page.evaluate(() => window.finalState().orders[0].finalPreparation.status), "Draft");
  assert.equal(await button("Prepare handoff").isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.finalDownloads), []);
});

for (const kind of ["source", "access"]) test(`${kind === "access" ? "An" : "A"} ${kind} change during original retrieval prevents the ZIP download`, async () => {
  await open("prepared=1"); await readyDownloads(); await selectOriginal();
  await page.evaluate(() => { window.finalControl.holdAsset = true; }); await button("Download handoff + selected originals").click();
  await page.waitForFunction(() => typeof window.releaseFinalAsset === "function");
  await page.evaluate(kind => window.changeFinal(kind), kind);
  if (kind === "access") await page.getByRole("heading", { name: "Title file unavailable", exact: true }).waitFor();
  else await button("Reload current worksheet").waitFor();
  await page.evaluate(() => window.releaseFinalAsset()); await page.waitForFunction(() => window.finalAssetSettled);
  if (kind === "source") await page.getByRole("alert").filter({ hasText: "reviewed file or worksheet changed" }).waitFor();
  else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => window.finalDownloads), []);
  assert.equal(await page.evaluate(() => window.finalAssetReads.length), 1);
});

test("an unavailable original leaves the prepared handoff intact and allows a clean export retry", async () => {
  await open("prepared=1"); await readyDownloads(); await selectOriginal();
  await page.evaluate(() => { window.finalControl.failAsset = true; }); await button("Download handoff + selected originals").click();
  await page.getByRole("alert").filter({ hasText: "Synthetic original unavailable" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.finalDownloads), []);
  assert.equal(await page.evaluate(() => window.finalState().orders[0].finalPreparation.status), "Prepared");
  await page.evaluate(() => { window.finalControl.failAsset = false; }); await button("Download handoff + selected originals").click();
  await page.waitForFunction(() => window.finalDownloads.length === 1 && window.finalDownloads[0].bytes);
  assert.equal(await page.evaluate(() => window.finalAssetReads.length), 2);
});

test("read-only staff can open existing review pages but cannot edit or confirm the worksheet", async () => {
  await open("role=viewer");
  for (const name of ["Open source package", "Review captured facts", "Review file details", "Manage policy products"]) await button(name).click();
  assert.deepEqual(await page.evaluate(() => window.finalActions), ["sources", "fields", "details", "products"]);
  await step("WFG worksheet").click();
  for (const name of ["Company WFG authority evidence", "Attorney WFG eligibility evidence", "Policy variant", "Exact form and version", "Fee applicability"]) assert.equal(await page.getByLabel(name).isDisabled(), true);
  assert.equal(await button("Save worksheet").isDisabled(), true);
  await step("Review & export").click(); assert.equal(await acknowledgement().isDisabled(), true); assert.equal(await button("Confirm worksheet review").isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.finalSaves), []);
});

test("missing policy products expose the existing product action and keep preparation blocked", async () => {
  await open("no-products=1"); await step("WFG worksheet").click();
  await page.getByRole("heading", { name: "Add the required policy products", exact: true }).waitFor();
  await button("Manage policy products").click(); assert.deepEqual(await page.evaluate(() => window.finalActions), ["products"]);
  assert.equal(await page.getByLabel("Policy variant").count(), 0);
  await step("Review & export").click(); assert.match(await page.locator("details").innerText(), /policy product/i);
  assert.equal(await button("Prepare handoff").isDisabled(), true); assert.equal(await button("Download readable handoff").isDisabled(), true);
});

test("phone layout supports keyboard step navigation and protects unsaved edits before opening review pages", async () => {
  await open("", { width: 390, height: 844 });
  await page.keyboard.press("Tab"); assert.equal(await step("Sources & facts").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await page.getByLabel("Company WFG authority evidence").waitFor();
  assert.equal(await step("WFG worksheet").getAttribute("aria-current"), "step");
  await page.getByLabel("Company WFG authority evidence").fill("Unsaved phone draft");
  await step("Sources & facts").click(); await button("Open source package").click();
  await page.getByRole("alert").filter({ hasText: "Save your worksheet edits before opening another review step" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.finalActions), []);
  for (const name of ["Sources & facts", "WFG worksheet", "Local reply", "Review & export"]) {
    await step(name).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits the phone width`);
  }
  await step("WFG worksheet").click(); assert.equal(await page.getByLabel("Company WFG authority evidence").inputValue(), "Unsaved phone draft");
  if (process.env.FINAL_PREPARATION_PHONE_SCREENSHOT) await page.screenshot({ path: process.env.FINAL_PREPARATION_PHONE_SCREENSHOT, fullPage: true });
});
