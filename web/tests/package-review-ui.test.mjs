// Real React -> package reader -> text/hash receipts -> backend transition/review validation.
// Only account, asset transport and atomic database storage are fictional.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin, persisted;
let errors = [];
before(async () => {
  const bundle = await build({ absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {PackageReviewButton} from './components/title/package-review';import {useWorkspace} from '@/lib/title/store';
      function App(){const {s}=useWorkspace();return <><PackageReviewButton documents={s.documents} onOpenOriginal={doc=>window.openedOriginals.push(doc.id)} captureFields={Object.fromEntries(s.documents.map(d=>[d.id,['name','loanAmount']]))} onCapture={(doc,values)=>window.captured.push({documentId:doc.id,values})}/><div id="ready"/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fictional-package-service", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';import {createSeed} from './lib/title/model';import {emptyWorkspace} from './lib/backend/workspace';
        const query=new URLSearchParams(location.search),listeners=new Set();const state=emptyWorkspace();state.companies=createSeed().companies.slice(0,1);
        window.openedOriginals=[];window.captured=[];window.assetReads=[];
        const texts={deed:'GENERAL WARRANTY DEED\\nGrantee: Morgan Fictional, an unmarried person\\nDeed recording date: September 21, 2026',security:'DEED OF TRUST\\nLoan amount: $250,000.00'+(query.has('conflict')?'\\nLoan amount: $275,000.00':'')};
        for(const [id,text] of Object.entries(texts))state.documents.push({id,assetId:'asset-'+id,companyId:state.companies[0].id,sourceRole:id==='deed'?'Deed':'Deed of trust',name:id+'.txt',mime:'text/plain',version:1,visibility:'Internal',category:'Policy documents',date:'2026-09-23',size:'1 KB'});
        const access={userId:'fictional-owner',email:'owner@example.test',role:query.get('role')||'owner',allCompanies:true,companyIds:[],restricted:true,version:1,partnerMembers:[]};
        let snapshot={s:state,connection:{workspaceId:'fictional-workspace',revision:1,access}};
        window.getPackageContext=()=>({state:snapshot.s,access:snapshot.connection.access,workspaceId:'fictional-workspace',revision:1});
        window.changePackageAccess=role=>{snapshot={...snapshot,connection:{...snapshot.connection,access:{...snapshot.connection.access,role,version:2}}};listeners.forEach(fn=>fn());};
        window.packageOriginals=Object.fromEntries(Object.entries(texts).map(([id,text])=>['asset-'+id,new Blob([text],{type:'text/plain'})]));
        export function useWorkspace(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);}
        export async function getAsset(id){window.assetReads.push(id);return window.packageOriginals[id];}
      ` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onLoad({ filter: /^client$/, namespace: "fixture" }, () => ({ resolveDir: web, loader: "ts", contents: `
        import {documentPackageRequest} from './lib/backend/document-packages';
        const query=new URLSearchParams(location.search);let store=JSON.parse(document.getElementById('fixture-checkpoint').textContent);window.packageRequests=[];
        export const activeWorkspace=()=>"fictional-workspace";
        async function persist(){await fetch('/checkpoint',{method:'POST',body:JSON.stringify(store)});}
        export async function backendRequest(path,input,method,timeout,workspaceId,userId){
          window.packageRequests.push({path,method,workspaceId,userId});if(!path.startsWith('/document-packages/')||method!=='POST'||workspaceId!=='fictional-workspace'||userId!=='fictional-owner')throw Error('Unexpected package request');
          const ctx=window.getPackageContext();const assets=await Promise.all(ctx.state.documents.map(async doc=>{const blob=window.packageOriginals[doc.assetId];const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');return {id:doc.assetId,document_id:doc.id,company_id:doc.companyId,sha256:hash,byte_size:blob.size,mime:blob.type};}));
          return documentPackageRequest(path.split('/').pop(),input,{...ctx,assets,rpc:async({p_action,p_input})=>{
            if(p_action==='open'){if(!store||store.sourcesHash!==p_input.sourcesHash)store={id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',version:1,sources:p_input.sources,sourcesHash:p_input.sourcesHash,pages:{},checkpoint:null,decisions:[]};await persist();return structuredClone(store);}
            if(p_action==='load')return structuredClone(store);
            if(p_input.expectedVersion!==store.version)throw Error('Document review changed. Reopen it before continuing.');
            if(p_action==='save'){
              if(query.has('delay')&&!window.delayReleased&&Object.keys(p_input.pages).length){window.saveWaiting=true;await new Promise(resolve=>window.releasePackageSave=()=>{window.delayReleased=true;resolve();});}
              if(query.has('failSave')&&Object.keys(p_input.pages).length)throw Error('Synthetic save failed. Reopen the package to recover saved pages.');
              store.checkpoint=p_input.checkpoint;Object.assign(store.pages,p_input.pages);if(Object.keys(p_input.pages).length)store.decisions=[];store.version++;await persist();return {version:store.version};
            }
            if(p_action==='review'){const decisions=new Map(store.decisions.map(d=>[d.candidateId,d]));for(const d of p_input.decisions)decisions.set(d.candidateId,d);store.decisions=[...decisions.values()];store.version++;await persist();return {version:store.version,decisions:structuredClone(store.decisions)};}
            throw Error('Unexpected storage mutation');
          }});
        }
      ` }));
      builder.onResolve({ filter: /^\.\/pdf-text$/ }, args => args.importer.endsWith("package-reader.ts") ? { path: "pdf", namespace: "no-pdf" } : undefined);
      builder.onResolve({ filter: /^\.\/local-ocr$/ }, args => args.importer.endsWith("package-reader.ts") ? { path: "ocr", namespace: "no-pdf" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "no-pdf" }, () => ({ contents: "export async function extractPdfText(){throw Error('Text fixture unexpectedly called PDF reader')}export async function recognizeDocumentPage(){throw Error('Text fixture unexpectedly called OCR')}" }));
    } }],
  });
  const globalFile = new URL("../app/globals.css", import.meta.url);
  const compiled = await postcss([tailwindcss({ base: web })]).process(await readFile(globalFile, "utf8"), { from: fileURLToPath(globalFile) });
  server = createServer(async (req, res) => {
    if (req.url === "/checkpoint" && req.method === "POST") { const chunks = []; for await (const chunk of req) chunks.push(chunk); persisted = JSON.parse(Buffer.concat(chunks).toString()); res.writeHead(200); res.end("ok"); }
    else if (req.url === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(compiled.css); }
    else if (req.url.startsWith("/brand/fonts/")) { try { const bytes = await readFile(new URL("../public" + req.url, import.meta.url)); res.writeHead(200, { "content-type": "font/woff2" }); res.end(bytes); } catch { res.writeHead(404); res.end(); } }
    else if (req.url === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0].contents); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="application/json" id="fixture-checkpoint">${JSON.stringify(persisted || null).replace(/</g, "\\u003c")}</script><script type="module" src="/app.mjs"></script></body></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(query = "") { await context?.close(); persisted = null; errors = []; context = await browser.newContext(); await context.route("**/*", route => { if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); } return route.continue(); }); page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto(`${origin}/?${query}`); await page.locator("#ready").waitFor({ state: "attached" }); }
async function review() { await page.getByRole("button", { name: "Read document package", exact: true }).click(); await page.getByRole("button", { name: "Open saved package review", exact: true }).click(); try { await page.getByRole("button", { name: /Scan every page|Resume \/ retry unread pages/ }).waitFor(); } catch (reason) { throw new Error(`${reason.message}\n${await page.locator('body').innerText()}`); } }
async function scan() { await page.getByRole("button", { name: /Scan every page|Resume \/ retry unread pages/ }).click(); await page.getByText("All 2 pages read and saved.", { exact: false }).waitFor(); }
const amount = () => page.getByRole("article").filter({ has: page.getByText("$250,000.00", { exact: true }) }).first();
async function acceptAmount(value = "$250,000.00") { const article = amount(); await article.getByRole("textbox").first().fill(value); await article.getByRole("textbox").nth(1).fill("Compared to the fictional original recording."); await article.getByRole("checkbox").click(); await article.getByRole("button", { name: /Accept reviewed value|Save corrected value/ }).click(); await article.getByText(/Saved decision:/).waitFor(); }

test("real package read saves bytes-bound page receipts and correct field citations without browser storage", async () => {
  await open(); await review(); await scan(); assert.equal(Object.keys(persisted.pages).length, 2); assert.equal(persisted.checkpoint.status, "complete");
  assert.match(await amount().innerText(), /security.txt · version 1 · page 1 · source text/); assert.match(await amount().innerText(), /Loan amount: \$250,000.00/);
  await amount().getByRole("button", { name: "Compare page 1 with original" }).click(); assert.deepEqual(await page.evaluate(() => window.openedOriginals), ["security"]);
  assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
  assert.deepEqual(await page.evaluate(() => window.captured), []);
});

test("acceptance requires explicit comparison and persists across actual page reload without rescanning", async () => {
  await open(); await review(); await scan(); assert.equal(await amount().getByRole("button", { name: "Accept reviewed value" }).isDisabled(), true);
  await acceptAmount(); assert.equal(persisted.decisions.length, 1); assert.equal(persisted.decisions[0].reviewerId, "fictional-owner");
  await page.reload(); await page.locator("#ready").waitFor({ state: "attached" }); await review(); await amount().getByText(/Saved decision: accepted/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.assetReads), []); assert.equal(Object.keys(persisted.pages).length, 2);
});

test("corrected values seed existing source capture with original suggestions and exact evidence", async () => {
  await open(); await review(); await scan(); await acceptAmount("$250,500.00"); await page.getByRole("button", { name: "Capture reviewed fields from security.txt" }).click();
  const [capture] = await page.evaluate(() => window.captured); assert.equal(capture.documentId, "security"); assert.equal(capture.values[0].id, "loanAmount"); assert.equal(capture.values[0].value, "$250,500.00"); assert.equal(capture.values[0].evidence.suggestedValue, "$250,000.00"); assert.equal(capture.values[0].evidence.page, "Text page 1"); assert.match(capture.values[0].evidence.quote, /Loan amount/);
});

test("conflicting accepted amounts cannot populate a source until an inapplicable candidate is rejected", async () => {
  await open("conflict=1"); await review(); await scan(); await acceptAmount();
  const second = page.getByRole("article").filter({ has: page.getByText("$275,000.00", { exact: true }) }).first(); await second.getByRole("textbox").nth(1).fill("Reviewed second fictional amount."); await second.getByRole("checkbox").click(); await second.getByRole("button", { name: "Accept reviewed value" }).click(); await second.getByText(/Saved decision/).waitFor();
  await page.getByRole("button", { name: "Capture reviewed fields from security.txt" }).click(); assert.match(await page.getByRole("alert").innerText(), /Resolve the accepted Loan amount values/); assert.deepEqual(await page.evaluate(() => window.captured), []);
  await second.getByRole("textbox").nth(1).fill("This amount belongs to an unrelated earlier instrument."); await second.getByRole("button", { name: "Reject suggestion" }).click(); await second.getByText(/Saved decision: rejected/).waitFor(); await page.getByRole("button", { name: "Capture reviewed fields from security.txt" }).click(); assert.equal((await page.evaluate(() => window.captured))[0].values[0].value, "$250,000.00");
});

test("pause checkpoints acknowledged pages and reload resumes only unfinished originals", async () => {
  await open("delay=1"); await review(); await page.getByRole("button", { name: "Scan every page" }).click(); await page.waitForFunction(() => window.saveWaiting); await page.getByRole("button", { name: "Pause scanning" }).click(); await page.evaluate(() => window.releasePackageSave());
  await page.getByText("1 of 2 pages saved.", { exact: false }).waitFor(); assert.equal(persisted.checkpoint.status, "cancelled"); assert.equal(Object.keys(persisted.pages).length, 1);
  await page.reload(); await page.locator("#ready").waitFor({ state: "attached" }); await review(); await page.evaluate(() => { window.delayReleased = true; }); await scan(); assert.equal(persisted.checkpoint.status, "complete"); assert.equal(Object.keys(persisted.pages).length, 2);
});

test("a failed atomic save does not claim pages were saved or offer unchecked capture", async () => {
  await open("failSave=1"); await review(); await page.getByRole("button", { name: "Scan every page" }).click(); await page.getByRole("alert").waitFor(); assert.match(await page.getByRole("alert").innerText(), /save failed/); assert.equal(Object.keys(persisted.pages).length, 0); assert.equal(await page.getByRole("article").count(), 0); assert.deepEqual(await page.evaluate(() => window.captured), []);
});

test("viewer cannot open package scans and access revocation removes the open review", async () => {
  await open("role=viewer"); assert.equal(await page.getByRole("button", { name: "Read document package" }).count(), 0);
  await open(); await review(); await scan(); await page.evaluate(() => window.changePackageAccess("viewer")); await page.getByRole("dialog").waitFor({ state: "detached" }); assert.equal(await page.getByRole("article").count(), 0);
});

test("package review fits a 390px phone through scanning, correction, and capture", async () => {
  await open(); await page.setViewportSize({ width: 390, height: 844 }); await review(); await scan();
  const dialog = page.getByRole("dialog");
  const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "dialog stays inside phone viewport");
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "review content must not require sideways scrolling");
  assert.equal(await amount().getByRole("textbox").first().evaluate(element => getComputedStyle(element).fontSize), "16px");
  await acceptAmount("$250,500.00");
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "reviewed values must still fit");
  await page.getByRole("button", { name: "Capture reviewed fields from security.txt" }).click();
  assert.equal((await page.evaluate(() => window.captured))[0].values[0].value, "$250,500.00");
});

test("package dialog supports keyboard-only opening, focus containment and Escape", async () => {
  await open(); const trigger = page.getByRole("button", { name: "Read document package", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter"); await page.getByRole("dialog").waitFor();
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); assert.equal(await page.getByRole("dialog").evaluate(element => element.contains(document.activeElement)), true); }
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Read document package", undefined, { timeout: 1500 });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true, "closing restores keyboard focus to the package button");
});
