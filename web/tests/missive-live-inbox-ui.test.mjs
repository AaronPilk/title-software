// Real UI with an intercepted fictional API. No real Missive/provider calls.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin, requests, errors, control;
const routes = [
  { id: "cedar-inbox", companyId: "cedar", teamName: "Cedar Production", organizationId: "fictional-org", teamId: "cedar-team", productionOnly: true },
  { id: "oak-inbox", companyId: "oak", teamName: "Oak Production", organizationId: "fictional-org", teamId: "oak-team", productionOnly: true },
];
const conversation = (id, subject, at) => ({ id, subject, at });
const attachment = { id: "file-a", name: "Closing package.pdf", mime: "application/pdf", bytes: 400, status: "not_downloaded" };
const summary = (id, company) => ({ id, subject: `${company} closing request`, from: "Synthetic Sender", email: "sender@example.test", receivedAt: "2026-09-24T12:00:00.000Z", preview: "Please review the property details.", attachments: [attachment] });

before(async () => {
  const bundle = await build({ absWorkingDir: web, outfile: "live-inbox-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {MissiveLiveInbox} from './components/title/missive-live-inbox';
      const q=new URLSearchParams(location.search),role=q.get('role')||'operations';
      window.fixtureWorkspace='fictional-workspace';window.settingsOpens=0;
      window.liveFixture={s:{companies:[{id:'cedar',name:'Cedar Title'},{id:'oak',name:'Oak Title'}]},connection:q.has('demo')?undefined:{workspaceId:'fictional-workspace',access:{userId:'fictional-user',role,version:1,allCompanies:!q.has('scoped'),companyIds:['cedar','oak'],restricted:false}}};
      createRoot(document.getElementById('root')).render(<MissiveLiveInbox onSettings={()=>window.settingsOpens++}/>);
    ` },
    plugins: [{ name: "fictional-live-inbox", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /^workspace$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `import {useState} from 'react';export function useWorkspace(){const [state,setState]=useState(window.liveFixture);window.changeLiveAccess=patch=>setState(current=>({...current,connection:{...current.connection,access:{...current.connection.access,...patch}}}));return state;}` }));
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onLoad({ filter: /^client$/, namespace: "fixture" }, () => ({ contents: `export const activeWorkspace=()=>window.fixtureWorkspace;export async function backendRequest(path,data,method,timeout,workspace,user,pinned){const response=await fetch('/synthetic-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,data,method,timeout,workspace,user,pinned})});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error),{status:response.status});return value;}` }));
      builder.onResolve({ filter: /^\.\/missive-route-setup$/ }, () => ({ path: "route-setup", namespace: "fixture" }));
      builder.onLoad({ filter: /^route-setup$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `export function MissiveRouteSetup({onConnected}){return <button onClick={onConnected}>Review approved company inboxes</button>;}` }));
    } }],
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents); }
    else if (path === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".css")).contents); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:28px;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;background:linear-gradient(125deg,#e7f0fa,#f0f4fb);color:#29475f}button,select{font:inherit;color:inherit}button{border:0;cursor:pointer}button[data-slot=button]{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 12px;background:#f9fbff;border:1px solid #d1deed;border-radius:11px;font-size:11px}button:disabled{opacity:.5}h1,h2,h3,h4,h5{margin-top:0}.empty-state{text-align:center;padding:40px 20px;color:#60778d}.empty-state>svg{color:#7793ad}.empty-state h3{font-size:14px;margin:13px 0 9px}.empty-state p{font-size:12px;line-height:1.65;max-width:46ch;margin:0 auto 16px}:root{--glass-surface:rgba(248,251,255,.76);--glass-edge:rgba(255,255,255,.9);--glass-filter:blur(22px) saturate(1.35);--glass-shadow:0 8px 32px #17375b12,inset 0 1px 0 #fff}@media(max-width:700px){body{margin:16px}}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>`); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { control?.release?.(); await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });

async function open(query = "", options = {}) {
  requests = []; errors = []; control = { status: "ready", failConversations: false, holdBody: false, ...options };
  context = await browser.newContext({ viewport: options.viewport || { width: 1320, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(3000);
  if (options.clock) await page.clock.install();
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (!url.startsWith(`${origin}/`)) { errors.push("Unexpected provider request"); return route.abort(); }
    if (!url.endsWith("/synthetic-api")) return route.continue();
    const request = route.request().postDataJSON(); requests.push(request);
    const input = request.data || {};
    const selected = routes.find(item => item.id === input.routeId) || routes[0];
    const prefix = selected.companyId;
    const base = { revision: 7, route: selected, skipped: 0 };
    let result;
    if (request.path === "/missive-feed") result = { status: control.status, revision: 7, routes: control.status === "routing_required" ? [] : routes, blockedSharedInboxes: false, readOnly: true };
    else if (request.path === "/missive-feed/conversations") {
      if (control.failConversations) { control.expected403 = true; return route.fulfill({ status: 403, json: { error: "Your inbox access changed." } }); }
      result = { ...base, rows: input.until ? [conversation(`${prefix}-first`, `${prefix} property update`, 200), conversation(`${prefix}-old`, `${prefix} older closing`, 100)] : [conversation(`${prefix}-first`, `${prefix} property update`, control.activityAt || 200)], until: input.until ? null : 200 };
    } else if (request.path === "/missive-feed/messages") result = { ...base, conversation: conversation(input.conversationId, `${prefix} property update`, 200), rows: input.until ? [summary(`${prefix}-message`, prefix), summary(`${prefix}-older-message`, `${prefix} older`)] : [summary(`${prefix}-message`, prefix)], until: input.until ? null : 1700000000 };
    else if (request.path === "/missive-feed/message") {
      if (control.failBody) { control.expected403 = true; return route.fulfill({ status: 403, json: { error: "This email is no longer available." } }); }
      if (control.holdBody) await new Promise(resolve => { control.release = resolve; });
      result = { ...base, conversation: conversation(input.conversationId, `${prefix} property update`, 200), message: { ...summary(input.messageId, prefix), body: `${prefix.toUpperCase()} PRIVATE EMAIL TEXT\nLiteral <img src="https://provider.invalid/tracker" onerror="alert(1)">\nPlease review.`, to: [{ name: "Test Recipient", address: "recipient@example.test" }], cc: [] } };
    } else { errors.push(`Unexpected API operation ${request.path}`); return route.fulfill({ status: 400, json: { error: "Unexpected operation" } }); }
    return route.fulfill({ json: result });
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !(control.expected403 && message.text().includes("403 (Forbidden)"))) errors.push(message.text()); });
  await page.goto(`${origin}/?${query}`);
}
const incoming = () => page.getByRole("region", { name: "Incoming email", exact: true });
const messageButton = () => incoming().getByRole("button").filter({ hasText: "Synthetic Sender" }).first();
async function ready() { await messageButton().waitFor(); }

test("live email uses pinned read-only endpoints and loads plain text only after selection", async () => {
  await open(); await ready();
  assert.equal(requests.some(request => request.path === "/missive-feed/message"), false);
  await messageButton().click();
  await page.getByText(/CEDAR PRIVATE EMAIL TEXT/).waitFor();
  assert.equal(await page.locator("img").count(), 0);
  assert.equal(await page.getByRole("link").count(), 0);
  assert.match(await page.getByRole("article").innerText(), /Closing package\.pdf/);
  assert.doesNotMatch((await page.getByRole("button").allTextContents()).join("\n"), /\b(send|archive|download|import)\b|mark.*read/i);
  for (const request of requests) {
    assert.equal(request.workspace, "fictional-workspace"); assert.equal(request.user, "fictional-user"); assert.equal(request.pinned, true);
    assert.equal(request.method, request.path === "/missive-feed" ? "GET" : "POST");
    if (request.method === "POST") { assert.equal(request.data.workspaceId, "fictional-workspace"); assert.equal(request.data.routeId, "cedar-inbox"); assert.equal(request.data.revision, 7); }
  }
  if (process.env.MISSIVE_LIVE_SCREENSHOT) await page.screenshot({ path: process.env.MISSIVE_LIVE_SCREENSHOT, fullPage: true });
});

test("older pages append without duplicates and refresh preserves the loaded older queue", async () => {
  await open(); await ready();
  await page.getByRole("button", { name: "Load older conversations", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "cedar older closing" }).waitFor();
  assert.equal(await page.getByRole("complementary").getByRole("button").count(), 2);
  await page.getByRole("button", { name: "Load older messages", exact: true }).click();
  await incoming().getByText("cedar older closing request", { exact: true }).waitFor();
  assert.equal(await incoming().getByRole("button").filter({ hasText: "Synthetic Sender" }).count(), 2);
  control.activityAt = 300;
  await page.getByRole("button", { name: "Refresh email", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[disabled]'));
  await ready();
  assert.equal(await page.getByRole("complementary").getByRole("button").count(), 2);
  assert.equal(requests.filter(request => request.path.endsWith("/messages") && request.data.until === undefined).length, 2);
  assert.deepEqual(requests.filter(request => request.path.endsWith("/conversations")).map(request => request.data.until ?? null), [null, 200, null]);
});

test("switching company discards a delayed body and loads only the selected inbox", async () => {
  await open("", { holdBody: true }); await ready(); await messageButton().click();
  await page.waitForFunction(() => document.body.innerText.includes("Loading email text"));
  await page.getByLabel("Live email company", { exact: true }).selectOption("oak");
  await incoming().getByText("oak closing request", { exact: true }).waitFor();
  control.holdBody = false; control.release();
  await page.getByRole("button", { name: "Refresh email", exact: true }).click();
  await messageButton().click(); await page.getByText(/OAK PRIVATE EMAIL TEXT/).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /CEDAR PRIVATE EMAIL TEXT/);
  assert.equal(await page.getByLabel("Live email inbox").inputValue(), "oak-inbox");
});

test("account or company-scope changes immediately clear private email and ignore late replies", async () => {
  await open("", { holdBody: true }); await ready(); await messageButton().click();
  await page.waitForFunction(() => document.body.innerText.includes("Loading email text"));
  await page.evaluate(() => window.changeLiveAccess({ companyIds: ["oak"], allCompanies: false, version: 2, userId: "new-user" }));
  await incoming().getByText("oak closing request", { exact: true }).waitFor();
  control.holdBody = false; control.release();
  await messageButton().click(); await page.getByText(/OAK PRIVATE EMAIL TEXT/).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /CEDAR PRIVATE EMAIL TEXT|Cedar Title/);
  assert.equal(requests.at(-1).user, "new-user");
  await page.evaluate(() => window.changeLiveAccess({ role: "viewer", version: 3 }));
  await page.getByRole("heading", { name: "Production access needed", exact: true }).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE EMAIL TEXT/);
});

test("setup actions are limited to authorized administrators and operations get production approval guidance", async () => {
  await open("role=operations", { status: "routing_required" });
  await page.getByRole("heading", { name: "No approved inboxes available", exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), /inbox containing only production email/);
  assert.equal(await page.getByRole("button", { name: "Open connection settings", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Review approved company inboxes", exact: true }).count(), 0);
  await page.goto(`${origin}/?role=owner`);
  await page.getByRole("button", { name: "Review approved company inboxes", exact: true }).waitFor();
  control.status = "ready";
  await page.getByRole("button", { name: "Review approved company inboxes", exact: true }).click(); await ready();
  assert.equal(requests.some(request => !request.path.startsWith("/missive-feed")), false);
});

test("visible-tab polling is bounded and stops after an error until explicit retry", async () => {
  await open("", { clock: true }); await ready();
  const count = () => requests.filter(request => request.path === "/missive-feed/conversations").length;
  assert.equal(count(), 1);
  await page.clock.runFor(60_001);
  await page.getByRole("button", { name: "Refresh email", exact: true }).waitFor({ state: "visible" });
  assert.equal(count(), 2);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await page.clock.runFor(120_000); assert.equal(count(), 2);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
  control.failConversations = true;
  await page.clock.runFor(60_000);
  await page.getByRole("alert").filter({ hasText: "Automatic refresh is paused" }).waitFor();
  assert.equal(count(), 3);
  await page.clock.runFor(180_000); assert.equal(count(), 3);
  control.failConversations = false;
  await page.getByRole("button", { name: "Refresh email", exact: true }).click(); await ready();
  assert.equal(count(), 4);
});

test("local demo makes no email requests and phone layouts fit the viewport", async () => {
  await open("demo=1", { viewport: { width: 390, height: 844 } });
  await page.getByRole("heading", { name: "Connect a shared workspace", exact: true }).waitFor(); assert.deepEqual(requests, []);
  await page.goto(origin); await ready(); await messageButton().click(); await page.getByText(/CEDAR PRIVATE EMAIL TEXT/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});

test("a rejected detail read clears private summaries and pauses automatic refresh", async () => {
  await open("", { clock: true, failBody: true }); await ready(); await messageButton().click();
  await page.getByRole("alert").filter({ hasText: "This email is no longer available" }).waitFor();
  assert.equal(await incoming().count(), 0);
  const count = requests.length;
  await page.clock.runFor(180_000); assert.equal(requests.length, count);
  assert.doesNotMatch(await page.locator("body").innerText(), /Synthetic Sender|PRIVATE EMAIL TEXT/);
});

for (const [status, heading] of [["token_required", "Connect Missive to see incoming email"], ["paused", "Live email is paused"]]) {
  test(`${status} stops before reading messages and offers settings only to an administrator`, async () => {
    await open("role=owner", { status }); await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.deepEqual(requests.map(request => request.path), ["/missive-feed"]);
    await page.getByRole("button", { name: "Open connection settings", exact: true }).click();
    assert.equal(await page.evaluate(() => window.settingsOpens), 1);
    await page.goto(`${origin}/?role=admin&scoped=1`);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open connection settings", exact: true }).count(), 0);
  });
}
