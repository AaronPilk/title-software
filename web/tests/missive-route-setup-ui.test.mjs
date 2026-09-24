import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
const routePath = "/integrations/missive/company-routes";
let server, browser, context, page, origin;
let errors = [], external = [];

before(async () => {
  const bundle = await build({
    absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".css": "empty", ".module.css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {MissiveRouteSetup} from './components/title/missive-route-setup';
      import {MissiveLiveInbox} from './components/title/missive-live-inbox';
      import {useWorkspace} from '@/lib/title/store';
      function App() {
        useWorkspace();
        return <>{new URLSearchParams(location.search).has('parent')
          ? <MissiveLiveInbox/>
          : <MissiveRouteSetup onConnected={()=>window.routeConnectedCount++}/>}
          <div id="fixture-ready"/>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "synthetic-route-setup", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "store", namespace: "route-fixture" }));
      builder.onLoad({ filter: /^store$/, namespace: "route-fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useSyncExternalStore} from 'react';
        const query = new URLSearchParams(location.search), listeners = new Set();
        let snapshot = {s:{companies:[{id:'company-a',name:'Fictional Cedar Title'},{id:'company-b',name:'Fictional Pine Title'}]},
          connection:query.has('disconnected')?undefined:{workspaceId:'workspace-one',revision:4,
            access:{userId:'owner-one',email:'owner@example.test',role:query.get('role')||'owner',allCompanies:query.get('all')!=='false',companyIds:['company-a'],restricted:true,version:3}}};
        window.routeConnectedCount=0;
        window.routeIdentity=()=>structuredClone(snapshot.connection);
        window.changeRouteIdentity=change=>{
          const connection=snapshot.connection;
          snapshot={...snapshot,connection:{...connection,workspaceId:change.workspaceId||connection.workspaceId,
            access:{...connection.access,...change,version:change.version??connection.access.version+1}}};
          listeners.forEach(listener=>listener());
        };
        export function useWorkspace(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>snapshot);}
      ` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "route-fixture" }));
      builder.onLoad({ filter: /^client$/, namespace: "route-fixture" }, () => ({ contents: `
        window.routeRequests=[];window.routePending=[];window.routeNextErrors={};window.holdNextRoute='';
        window.routeProposal={revision:17,fingerprint:'reviewed-ids-fingerprint-17',skippedCount:1,proposals:[
          {companyId:'company-a',companyName:'Fictional Cedar Title',organizationId:'org-one',teamId:'team-cedar',teamName:'Cedar recorded originals'},
          {companyId:'company-b',companyName:'Fictional Pine Title',organizationId:'org-one',teamId:'team-pine',teamName:'Pine closing requests'}]};
        export const activeWorkspace=()=>window.routeIdentity()?.workspaceId||'';
        export async function backendRequest(path,data,method,timeout,workspaceId,userId,strictIdentity){
          window.routeRequests.push({path,data,method,timeout,workspaceId,userId,strictIdentity});
          if(path==='/missive-feed'&&method==='GET')return {status:'routing_required',revision:4,routes:[],blockedSharedInboxes:false,readOnly:true};
          if(path!=='/integrations/missive/company-routes'||!['GET','POST'].includes(method))throw Error('Unexpected synthetic route request '+method+' '+path);
          const result=method==='GET'?structuredClone(window.routeProposal):{revision:18};
          const failure=window.routeNextErrors[method];delete window.routeNextErrors[method];
          if(window.holdNextRoute===method){window.holdNextRoute='';await new Promise(resolve=>window.routePending.push(resolve));}
          if(failure)throw Error(failure);
          return result;
        }
      ` }));
    } }],
  });
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("content-type", path === "/app.mjs" ? "text/javascript" : "text/html");
    response.end(path === "/app.mjs" ? bundle.outputFiles[0].contents : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});

afterEach(async () => { await context?.close(); context = undefined; assert.deepEqual(errors, []); assert.deepEqual(external, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(query = "") {
  await context?.close(); errors = []; external = [];
  context = await browser.newContext({ viewport: { width: 1150, height: 900 } });
  await context.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`); await page.locator("#fixture-ready").waitFor({ state: "attached" });
}
const reviewButton = () => page.getByRole("button", { name: "Review company inboxes", exact: true });
const connectButton = () => page.getByRole("button", { name: "Connect 2 inboxes", exact: true });
const matches = () => page.getByRole("list", { name: "Reviewed company inbox matches", exact: true });
const requests = (method) => page.evaluate(({ path, method }) => window.routeRequests.filter(request => request.path === path && (!method || request.method === method)), { path: routePath, method });
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function review() { await reviewButton().click(); await matches().waitFor({ state: "attached" }); }

test("loading and reviewing exact inbox matches never saves until Connect is explicitly chosen", async () => {
  await open(); assert.deepEqual(await requests(), []);
  await review();
  const rows = await matches().getByRole("listitem").allTextContents();
  assert.deepEqual(rows, ["Fictional Cedar TitleMissive inbox: Cedar recorded originals", "Fictional Pine TitleMissive inbox: Pine closing requests"]);
  assert.match(await page.getByRole("region", { name: "Connect company inboxes" }).innerText(), /2 inboxes matched by their saved IDs\. 1 companies have no new, unambiguous inbox match\./);
  assert.equal((await requests("GET")).length, 1); assert.deepEqual(await requests("POST"), []);
  assert.equal(await page.evaluate(() => window.routeConnectedCount), 0);
  await connectButton().click(); await reviewButton().waitFor();
  assert.deepEqual(await requests("POST"), [{ path: routePath, method: "POST", timeout: 30000, workspaceId: "workspace-one", userId: "owner-one", strictIdentity: true,
    data: { workspaceId: "workspace-one", expectedRevision: 17, fingerprint: "reviewed-ids-fingerprint-17" } }]);
  assert.equal(await page.evaluate(() => window.routeConnectedCount), 1); assert.equal(await matches().count(), 0);
});

test("review requests pin the workspace and actor without posting company names or provider IDs", async () => {
  await open("role=admin"); await review();
  assert.deepEqual(await requests("GET"), [{ path: routePath, data: undefined, method: "GET", timeout: 30000, workspaceId: "workspace-one", userId: "owner-one", strictIdentity: true }]);
  await connectButton().click(); await reviewButton().waitFor();
  assert.deepEqual(Object.keys((await requests("POST"))[0].data).sort(), ["expectedRevision", "fingerprint", "workspaceId"]);
});

test("operations, scoped administrators and other unauthorized accounts have no route setup controls", async () => {
  for (const query of ["role=operations", "role=admin&all=false", "role=onboarding", "role=finance", "role=viewer", "role=partner", "disconnected=1"]) {
    await open(query);
    assert.equal(await page.getByRole("region", { name: "Connect company inboxes" }).count(), 0, query);
    assert.deepEqual(await requests(), [], query);
  }
});

test("cancel discards the reviewed proposal and requires a fresh read before saving", async () => {
  await open(); await review(); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await reviewButton().waitFor(); assert.equal(await matches().count(), 0); assert.deepEqual(await requests("POST"), []);
  await page.evaluate(() => { window.routeProposal.revision = 21; window.routeProposal.fingerprint = "fresh-review-21"; });
  await review(); await connectButton().click(); await reviewButton().waitFor();
  assert.equal((await requests("GET")).length, 2);
  assert.equal((await requests("POST"))[0].data.expectedRevision, 21);
  assert.equal((await requests("POST"))[0].data.fingerprint, "fresh-review-21");
});

test("an empty exact-match review explains skipped companies and cannot be connected", async () => {
  await open(); await page.evaluate(() => { window.routeProposal.proposals = []; window.routeProposal.skippedCount = 2; });
  await review(); assert.equal(await matches().getByRole("listitem").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Connect 0 inboxes", exact: true }).isDisabled(), true);
  assert.match(await page.getByRole("region", { name: "Connect company inboxes" }).innerText(), /2 companies have no new, unambiguous inbox match/);
  assert.deepEqual(await requests("POST"), []);
});

test("stale and failed saves discard their review before another attempt", async () => {
  for (const message of ["Company inbox matches changed. Review the list again.", "The save could not be confirmed. Review the list again."]) {
    await open(); await review(); await page.evaluate(message => { window.routeNextErrors.POST = message; }, message);
    await connectButton().click(); await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").innerText(), message);
    assert.equal(await matches().count(), 0); assert.equal(await connectButton().count(), 0);
    assert.equal(await page.evaluate(() => window.routeConnectedCount), 0);
    await page.evaluate(() => { window.routeProposal.revision = 22; window.routeProposal.fingerprint = "rechecked-22"; });
    await review(); assert.equal(await page.getByRole("alert").count(), 0);
    await connectButton().click(); await reviewButton().waitFor();
    const sent = await requests("POST"); assert.equal(sent.length, 2);
    assert.equal(sent[1].data.expectedRevision, 22); assert.equal(sent[1].data.fingerprint, "rechecked-22");
    assert.equal((await requests("GET")).length, 2); assert.equal(await page.evaluate(() => window.routeConnectedCount), 1);
  }
});

test("failed review leaves no connectable proposal and retry performs a new read", async () => {
  await open(); await page.evaluate(() => { window.routeNextErrors.GET = "Missive directory is temporarily unavailable."; });
  await reviewButton().click(); await page.getByRole("alert").waitFor();
  assert.equal(await matches().count(), 0); assert.equal(await connectButton().count(), 0);
  await review(); assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal((await requests("GET")).length, 2); assert.deepEqual(await requests("POST"), []);
});

test("pending review and save disable repeated actions and save completion fires once", async () => {
  await open(); await page.evaluate(() => { window.holdNextRoute = "GET"; });
  await reviewButton().click(); await page.waitForFunction(() => window.routePending.length === 1);
  assert.equal(await page.getByRole("button", { name: "Checking inboxes…", exact: true }).isDisabled(), true);
  assert.equal((await requests("GET")).length, 1);
  await page.evaluate(() => window.routePending.shift()()); await matches().waitFor();
  await page.evaluate(() => { window.holdNextRoute = "POST"; });
  await connectButton().click(); await page.waitForFunction(() => window.routePending.length === 1);
  assert.equal(await page.getByRole("button", { name: "Connecting…", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  assert.equal((await requests("POST")).length, 1);
  await page.evaluate(() => window.routePending.shift()()); await reviewButton().waitFor();
  assert.equal(await page.evaluate(() => window.routeConnectedCount), 1);
});

test("the real inbox parent discards late route reviews when account, workspace or access changes", async () => {
  for (const change of [{ userId: "owner-two" }, { workspaceId: "workspace-two" }, { version: 4 }, { role: "operations", allCompanies: false }, { role: "admin", allCompanies: false }]) {
    await open("parent=1"); await reviewButton().waitFor();
    await page.evaluate(() => { window.holdNextRoute = "GET"; }); await reviewButton().click();
    await page.waitForFunction(() => window.routePending.length === 1);
    await page.evaluate(change => window.changeRouteIdentity(change), change);
    await page.getByRole("heading", { name: "No approved inboxes available", exact: true }).waitFor();
    await page.evaluate(() => window.routePending.shift()()); await settle();
    assert.equal(await matches().count(), 0, JSON.stringify(change)); assert.deepEqual(await requests("POST"), []);
    if (change.role) assert.equal(await reviewButton().count(), 0);
    else {
      await review(); const sent = (await requests("GET")).at(-1);
      assert.equal(sent.userId, change.userId || "owner-one"); assert.equal(sent.workspaceId, change.workspaceId || "workspace-one");
      assert.equal(sent.strictIdentity, true);
    }
  }
});

test("identity change clears an already-reviewed proposal and late save cannot refresh the new account", async () => {
  await open("parent=1"); await reviewButton().waitFor(); await review();
  await page.evaluate(() => window.changeRouteIdentity({ userId: "owner-two" })); await reviewButton().waitFor();
  assert.equal(await matches().count(), 0); assert.deepEqual(await requests("POST"), []);
  await review(); await page.evaluate(() => { window.holdNextRoute = "POST"; });
  await connectButton().click(); await page.waitForFunction(() => window.routePending.length === 1);
  const sent = (await requests("POST"))[0]; assert.equal(sent.userId, "owner-two"); assert.equal(sent.workspaceId, "workspace-one");
  await page.evaluate(() => window.changeRouteIdentity({ workspaceId: "workspace-two", userId: "owner-three" }));
  await reviewButton().waitFor(); await settle();
  const setupReads = await page.evaluate(() => window.routeRequests.filter(request => request.path === "/missive-feed").length);
  await page.evaluate(() => window.routePending.shift()()); await settle();
  assert.equal(await page.evaluate(() => window.routeRequests.filter(request => request.path === "/missive-feed").length), setupReads);
  assert.equal(await matches().count(), 0); assert.equal((await requests("POST")).length, 1);
  await review(); const refreshed = (await requests("GET")).at(-1);
  assert.equal(refreshed.workspaceId, "workspace-two"); assert.equal(refreshed.userId, "owner-three");
});
