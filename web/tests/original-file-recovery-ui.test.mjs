// Actual Recovery UI and archive code; fictional remote storage only. Never writes hosted state.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6RXsAAAAASUVORK5CYII=", "base64");
let server, browser, context, page, origin, errors;
before(async () => {
  const bundle = await build({ absWorkingDir: web, write: false, bundle: true, format: "esm", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {BackendSettings} from './components/title/backend-settings';
      import {verifyOriginalsArchive,recoverArchivedOriginal} from './lib/title/originals-archive';
      window.verifyArchive=verifyOriginalsArchive;window.recoverArchive=recoverArchivedOriginal;
      createRoot(document.getElementById('root')).render(<BackendSettings section="Recovery"/>);
    ` },
    plugins: [{ name: "fictional-originals", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';
        const listeners=new Set(),query=new URLSearchParams(location.search);
        let snapshot={s:{companies:[{id:'company-A',name:'Fictional Cedar Title'}],documents:[
          {id:'doc-A',assetId:'asset-A',companyId:'company-A',orderId:'file-A',name:query.has('long')?'Recorded deed — 100 Fictional Magnolia Lane.png':'Fictional original.png',version:3,mime:'image/png'},
          ...(query.has('missing')?[{id:'doc-missing',assetId:'asset-missing',companyId:'company-A',orderId:'file-A',name:'Unavailable original.pdf',version:1,mime:'application/pdf'}]:[])
        ]},connection:{revision:7,access:{userId:'operator-A',role:'admin',allCompanies:!query.has('scoped'),companyIds:['company-A'],version:1},refresh:async()=>true}};
        window.fixtureSnapshot=()=>structuredClone(snapshot.s);window.changeWorkspaceRevision=()=>{snapshot={...snapshot,connection:{...snapshot.connection,revision:8}};listeners.forEach(fn=>fn())};
        export const useWorkspace=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);
        export function download(name,content,type){const blob=content instanceof Blob?content:new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
      ` }));
      builder.onLoad({ filter: /^client$/, namespace: "fixture" }, () => ({ loader: "js", contents: `
        export const activeWorkspace=()=> 'workspace-A';export const supabase={auth:{signOut:async()=>{throw Error('Unexpected sign-out')}}};
        window.remoteReads=[];window.remoteWrites=[];window.securityAudit=[];window.auditFails=false;window.originalsAvailable=true;window.holdOriginal=false;
        export async function backendRequest(path,data){if(path==='/security/workspace-export'){if(window.auditFails)throw Error('Security evidence unavailable');window.securityAudit.push({path,data});return {recorded:true}}if(data){window.remoteWrites.push({path,data});throw Error('Unexpected hosted write')}if(path==='/backups')return {backups:[]};throw Error('Unexpected endpoint')}
        export async function downloadRemoteAsset(id){window.remoteReads.push(id);if(window.holdOriginal)await new Promise(done=>window.releaseOriginal=done);if(!window.originalsAvailable||id!=='asset-A')throw Error('Fictional hosted file unavailable');return new Blob([new Uint8Array(${JSON.stringify([...png])})],{type:'image/png'})}
      ` }));
      builder.onResolve({ filter: /^\.\/(missive-settings|team-access|vendor-settings|security-center)$/ }, () => ({ path: "unused", namespace: "child" }));
      builder.onLoad({ filter: /.*/, namespace: "child" }, () => ({ contents: "export const MissiveSettings=()=>null,TeamAccess=()=>null,VendorSettings=()=>null,SecurityCenter=()=>null;" }));
    } }],
  });
  server = createServer((req, res) => {
    const js = req.url === "/app.mjs";
    res.writeHead(200, { "content-type": js ? "text/javascript" : "text/html" });
    res.end(js ? bundle.outputFiles[0].contents : '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close();assert.deepEqual(errors, []); });
after(async () => { await browser?.close();if (server) { server.closeAllConnections();await new Promise(done => server.close(done)); } });
const button = name => page.getByRole("button", { name, exact: true });
async function open(query = "") {
  errors = [];context = await browser.newContext({ acceptDownloads: true });
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request");return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();page.setDefaultTimeout(5000);page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);await page.getByRole("heading", { name: "Recovery", exact: true }).waitFor();
}
async function exportArchive() {
  const pending = page.waitForEvent("download");await button("Export original files archive").click();
  const downloaded = await pending;
  return JSON.parse(await readFile(await downloaded.path(), "utf8"));
}
async function importArchive(archive) {
  await page.getByLabel("Original files archive", { exact: true }).setInputFiles({ name: "fictional-originals.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(archive)) });
}

test("exported bytes recover independently after fictional hosted storage becomes unavailable", async () => {
  await open();const before = await page.evaluate(() => window.fixtureSnapshot());const archive = await exportArchive();
  assert.equal(archive.workspaceId, "workspace-A");assert.equal(archive.revision, 7);assert.equal(archive.originals.length, 1);assert.deepEqual(archive.missing, []);
  const entry = archive.originals[0];assert.deepEqual(entry.reference, { id: "doc-A", assetId: "asset-A", companyId: "company-A", orderId: "file-A", name: "Fictional original.png", version: 3, mime: "image/png" });
  assert.equal(entry.sha256, createHash("sha256").update(png).digest("hex"));assert.deepEqual(Buffer.from(entry.data, "base64"), png);
  await page.evaluate(() => { window.originalsAvailable = false; });
  await importArchive(archive);await page.getByText("Checksums verified for 1 originals.", { exact: false }).waitFor();
  await page.getByLabel("Original to recover", { exact: true }).selectOption("doc-A");
  const pending = page.waitForEvent("download");await button("Download recovered original").click();const recovered = await pending;
  assert.equal(recovered.suggestedFilename(), "Fictional original.png");assert.deepEqual(await readFile(await recovered.path()), png);
  const readable = await page.evaluate(async archive => {
    const file = await window.recoverArchive(archive, "doc-A");const url = URL.createObjectURL(file);
    try { const image = new Image();image.src = url;await image.decode();return [image.naturalWidth, image.naturalHeight]; } finally { URL.revokeObjectURL(url); }
  }, archive);
  assert.deepEqual(readable, [1, 1]);
  assert.deepEqual(await page.evaluate(() => window.remoteReads), ["asset-A"]);assert.deepEqual(await page.evaluate(() => window.remoteWrites), []);
  assert.deepEqual(await page.evaluate(() => window.fixtureSnapshot()), before);
  await page.getByText("Hosted records were unchanged.", { exact: false }).waitFor();
});

test("missing originals remain explicit and cannot be recovered from a metadata reference", async () => {
  await open("missing=1");const archive = await exportArchive();assert.equal(archive.missing[0].id, "doc-missing");
  await page.getByText("This archive is incomplete", { exact: false }).waitFor();await importArchive(archive);
  await page.getByText("Missing originals: Unavailable original.pdf", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Original to recover", { exact: true }).getByRole("option", { name: /Unavailable original/ }).count(), 0);
  const error = await page.evaluate(async archive => { try { await window.recoverArchive(archive, "doc-missing");return ""; } catch (error) { return error.message; } }, archive);
  assert.match(error, /does not contain bytes/);assert.deepEqual(await page.evaluate(() => window.remoteWrites), []);
});

test("a selected document/version can be exported independently of the rest of the collection", async () => {
  await open("missing=1");await page.getByLabel("Original files export scope", { exact: true }).selectOption("doc-A");
  const archive = await exportArchive();assert.equal(archive.originals.length, 1);assert.equal(archive.originals[0].reference.id, "doc-A");assert.deepEqual(archive.missing, []);
  assert.deepEqual(await page.evaluate(() => window.remoteReads), ["asset-A"]);
});

test("changed bytes and document/company manifest bindings fail verification before recovery", async () => {
  await open();const original = await exportArchive();
  for (const change of [archive => { archive.originals[0].data = archive.originals[0].data.slice(0, 24) + "AAAA" + archive.originals[0].data.slice(28); }, archive => { archive.originals[0].reference.companyId = "wrong-company"; }]) {
    const archive = structuredClone(original);change(archive);await importArchive(archive);
    await page.getByRole("alert").filter({ hasText: /checksum verification/i }).waitFor();
    assert.equal(await button("Download recovered original").count(), 0);
  }
  assert.deepEqual(await page.evaluate(() => window.remoteWrites), []);
});

test("oversized or duplicate manifests fail before base64 decoding", async () => {
  await open();const original = await exportArchive();
  const failures = await page.evaluate(async original => {
    let decodes = 0;const native = window.atob;window.atob = value => { decodes++;return native(value); };
    try {
      const invalid = [structuredClone(original), structuredClone(original)];invalid[0].originals[0].bytes = 70 * 1024 * 1024;invalid[1].originals.push(structuredClone(invalid[1].originals[0]));
      const messages = [];for (const archive of invalid) { try { await window.verifyArchive(JSON.stringify(archive));messages.push("accepted"); } catch (error) { messages.push(error.message); } }
      return { messages, decodes };
    } finally { window.atob = native; }
  }, original);
  assert.equal(failures.decodes, 0);assert.ok(failures.messages.every(message => /invalid|duplicate/.test(message)));
});

test("a workspace revision change cancels an export in flight without downloading mixed records", async () => {
  await open();let downloads = 0;page.on("download", () => { downloads++; });
  await page.evaluate(() => { window.holdOriginal = true; });await button("Export original files archive").click();
  await page.waitForFunction(() => typeof window.releaseOriginal === "function");await page.evaluate(() => window.changeWorkspaceRevision());
  await page.evaluate(() => window.releaseOriginal());await page.getByRole("alert").filter({ hasText: "workspace changed" }).waitFor();
  assert.equal(downloads, 0);assert.deepEqual(await page.evaluate(() => window.remoteWrites), []);
  await page.evaluate(() => { window.holdOriginal = false; });const retry = await exportArchive();assert.equal(retry.revision, 8);
});

test("a scoped administrator cannot export an organization-wide archive through Recovery", async () => {
  await open("scoped=1");assert.equal(await button("Export original files archive").count(), 0);
  await page.getByText("An organization-wide administrator manages recovery points.", { exact: false }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.remoteReads), []);assert.deepEqual(await page.evaluate(() => window.remoteWrites), []);
});

test("production CSS keeps recovery controls and missing-file guidance inside a 390px viewport", async () => {
  // This layout regression intentionally requires an existing production build;
  // it reads its CSS without rebuilding or mutating the running app's output.
  const directory = resolve(web, "dist/client/_next/static/css");
  const filenames = (await readdir(directory)).filter(name => name.endsWith(".css"));
  assert.ok(filenames.length, "Build the app before checking the production recovery layout.");
  const css = (await Promise.all(filenames.map(name => readFile(resolve(directory, name), "utf8")))).join("\n");
  await open("missing=1&long=1");await page.setViewportSize({ width: 390, height: 1000 });await page.addStyleTag({ content: css });
  const archive = await exportArchive();await importArchive(archive);
  await page.getByText("Checksums verified for 1 originals.", { exact: false }).waitFor();
  await page.getByLabel("Original to recover", { exact: true }).selectOption("doc-A");
  const dimensions = await page.evaluate(() => {
    const panel = document.querySelector(".backend-settings"), recovery = document.querySelector('[aria-label="Original file recovery"]');
    return { viewport: innerWidth, panelWidth: panel.clientWidth, panelScroll: panel.scrollWidth,
      recoveryWidth: recovery.clientWidth, recoveryScroll: recovery.scrollWidth,
      clipped: [...recovery.querySelectorAll("button,select,input,p,label")].filter(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.right > innerWidth + 1 || bounds.left < -1 || element.scrollWidth > element.clientWidth + 2;
      }).map(element => element.getAttribute("aria-label") || element.textContent.slice(0, 100)) };
  });
  assert.ok(dimensions.panelScroll <= dimensions.panelWidth + 2, JSON.stringify(dimensions));
  assert.ok(dimensions.recoveryScroll <= dimensions.recoveryWidth + 2, JSON.stringify(dimensions));
  assert.deepEqual(dimensions.clipped, []);
  assert.equal(await button("Download recovered original").isEnabled(), true);
  await page.getByText("Missing originals: Unavailable original.pdf", { exact: false }).waitFor();
  if (process.env.TITLE_RECOVERY_SCREENSHOT) await page.screenshot({ path: process.env.TITLE_RECOVERY_SCREENSHOT, fullPage: true });
});

test("originals export requires audit evidence before creating a download",async()=>{await open();await page.evaluate(()=>{window.auditFails=true});let downloads=0;page.on("download",()=>downloads++);await button("Export original files archive").click();await page.getByText("Security evidence unavailable",{exact:true}).waitFor();assert.equal(downloads,0);assert.equal((await page.evaluate(()=>window.remoteWrites)).length,0)});
