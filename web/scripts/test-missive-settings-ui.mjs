// Actual Settings/React/client code, synthetic Auth/API transport and workspace
// provider. No vendor traffic, live credentials, shared build files or fixed port.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "title-missive-settings-ui-"));
const apiOrigin = "https://missive-ui-fixture.supabase.co";
const email = "owner@example.test";
const ids = { A: "11111111-1111-4111-8111-111111111111", B: "22222222-2222-4222-8222-222222222222" };
const token = "missive_pat-SYNTHETIC_BROWSER_FIXTURE_ONLY";
const access = { userId: "33333333-3333-4333-8333-333333333333", email, role: "owner", allCompanies: true, companyIds: [], restricted: false, version: 1, partnerMembers: [] };
const user = { id: access.userId, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const jwt = [{ alg: "HS256", typ: "JWT" }, { sub: user.id, email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }, "synthetic-signature"].map(v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url")).join(".");
const session = { access_token: jwt, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
const routeFor = company => ({ id: `route-${company}`, organizationId: `org-${company}`, teamId: `team-${company}`, teamName: `Inbox ${company}`, companyId: company, version: 1, enabled: true, approvedAt: "2026-09-14T12:00:00Z", approvedBy: email });
function workspace(company) {
  return { workspaceId: ids[company], name: `Fixture ${company}`, revision: 1, access, state: {
    version: 1, companies: [{ id: company, name: `Company ${company}`, members: [], steps: [] }],
    orders: [{ id: `file-${company}`, companyId: company, address: `100 Original ${company} Road`, status: "New", fields: [] }],
    documents: [], inbox: [], tasks: [], activity: [], rules: [], approvedReports: [],
  } };
}
const previewFor = company => ({ id: `message-${company}`, subject: `Private fixture message ${company}`, from: "Fixture sender", email: "sender@example.test", receivedAt: "2026-09-14T12:00:00Z", body: `Original body ${company}`, fingerprint: `fingerprint-${company}`, attachments: [], headers: { to: [{ address: `inbox-${company}@example.test` }] } });
const prefix = "/functions/v1/title-api";
const endpoint = suffix => `${prefix}/integrations/missive${suffix}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BackendSettings} from './components/title/backend-settings'; import {FixtureProvider} from 'fixture-workspace';
    createRoot(document.getElementById('app')).render(<FixtureProvider initial={window.__initial}><BackendSettings section="Connections" /></FixtureProvider>);`, loader: "tsx", resolveDir: web },
  absWorkingDir: web, outfile: join(directory, "app.js"), bundle: true, platform: "browser", format: "esm", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(apiOrigin), "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"synthetic-publishable-key"', "process.env.NEXT_PUBLIC_TITLE_HOSTED_PILOT": '"true"' },
  plugins: [{ name: "synthetic-workspace", setup(builder) {
    builder.onResolve({ filter: /^(fixture-workspace|@\/lib\/title\/store)$/ }, () => ({ path: "workspace", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
      import React,{createContext,useContext,useState,useEffect} from 'react';
      import {backendRequest,setActiveWorkspace} from './lib/backend/client';
      const Context=createContext(null); export const useWorkspace=()=>useContext(Context);
      export function download() {};
      export function FixtureProvider({initial,children}) {
        const [remote,setRemote]=useState(initial); setActiveWorkspace(remote.workspaceId);
        useEffect(()=>{ window.setFixture=next=>{setActiveWorkspace(next.workspaceId);setRemote(next);}; },[]);
        async function refresh(){try {setRemote(await backendRequest('/state'));return true;}catch{return false;}}
        return <Context.Provider value={{s:remote.state,connection:{access:remote.access,revision:remote.revision,refresh,saving:false}}}>{children}</Context.Provider>;
      }` }));
  } }],
});

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/app.js" || req.url === "/app.css") {
      res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(await readFile(join(directory, req.url.slice(1))));
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>');
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.TITLE_TEST_BROWSER_CHANNEL || "chrome", headless: true });
const passed = [];

async function scenario(name, test) {
  const context = await browser.newContext();
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = [], requests = [], holds = new Map(), failures = new Map();
  const workspaces = { A: workspace("A"), B: workspace("B") };
  const credentials = Object.fromEntries(["A", "B"].map(c => [c, { configured: true, revision: 1, verifiedAt: "2026-09-14T12:00:00Z", source: "workspace" }]));
  const routings = Object.fromEntries(["A", "B"].map(c => [c, { schemaVersion: 2, revision: 1, mappings: [routeFor(c)] }]));
  const events = { A: [], B: [] };
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(({ initial, session }) => { window.__initial = initial; localStorage.setItem("sb-missive-ui-fixture-auth-token", JSON.stringify(session)); }, { initial: workspaces.A, session });
  function hold(path, method = "POST") {
    const started = deferred(), completed = deferred(), release = deferred();
    const item = { started, completed, release }; holds.set(`${method} ${path}`, item);
    return { started: started.promise, completed: completed.promise, release: () => release.resolve() };
  }
  function fail(path, method = "GET", status = 500) { failures.set(`${method} ${path}`, status); }
  await context.route("**/*", async handler => {
    const req = handler.request(), url = new URL(req.url());
    if (url.origin === origin) return handler.continue();
    if (url.origin !== apiOrigin) { errors.push(`Unexpected external request: ${url.origin}`); return handler.abort(); }
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "content-type": "application/json" };
    if (req.method() === "OPTIONS") return handler.fulfill({ status: 204, headers, body: "" });
    const key = `${req.method()} ${url.pathname}`, input = req.method() === "POST" ? req.postDataJSON() : Object.fromEntries(url.searchParams);
    const company = input.workspaceId === ids.B ? "B" : "A";
    const current = workspaces[company], statusRecord = credentials[company];
    requests.push({ path: url.pathname, method: req.method(), input });
    let body, status = failures.get(key) || 200; failures.delete(key);
    try {
      assert.equal(req.headers().authorization, `Bearer ${jwt}`);
      if (status !== 200) body = { error: "Synthetic temporary failure" };
      else if (url.pathname === "/auth/v1/user") body = user;
      else if (url.pathname === `${prefix}/state`) body = current;
      else if (url.pathname === endpoint("/credential")) {
        if (req.method() === "POST") {
          if (input.expectedRevision !== statusRecord.revision) { status = 409; body = { error: "Missive connection changed. Refresh before saving." }; }
          else {
            assert(input.token === null || input.token === token);
            statusRecord.revision++; statusRecord.configured = input.token !== null;
            statusRecord.verifiedAt = input.token ? "2026-09-14T14:00:00Z" : null;
            routings[company].revision++; routings[company].mappings.forEach(m => { m.enabled = false; });
          }
        }
        body ??= statusRecord;
      } else if (url.pathname === endpoint("")) body = { status: statusRecord.configured ? "ready" : "token_required", importEnabled: statusRecord.configured, routing: routings[company], attachmentDownloadEnabled: statusRecord.configured };
      else if (url.pathname === endpoint("/check")) body = { status: "verified", checkedAt: "2026-09-14T12:00:00Z", importEnabled: true, organizations: [{ id: `org-${company}`, name: `Organization ${company}` }], teamInboxes: [{ id: `team-${company}`, name: `Inbox ${company}`, organizationId: `org-${company}` }], moreOrganizations: false, moreTeams: false };
      else if (url.pathname === endpoint("/conversations")) body = { rows: [{ id: `conversation-${company}`, subject: `Conversation ${company}`, at: 1789387200 }], until: null };
      else if (url.pathname === endpoint("/messages")) body = { rows: [{ id: `message-${company}`, subject: `Message ${company}`, at: 1789387200 }], until: null };
      else if (url.pathname === endpoint("/preview")) body = previewFor(company);
      else if (url.pathname === endpoint("/events")) body = { events: events[company], nextOffset: null, webhookConfigured: true };
      else if (url.pathname === endpoint("/import")) {
        assert.equal(input.expectedRevision, current.revision); assert.equal(input.orderId, `file-${company}`);
        assert.notEqual(current.state.orders[0].status, "Issued"); current.revision++; body = { imported: true };
      } else if (url.pathname === endpoint("/attachments/import")) {
        assert.equal(input.expectedRevision, current.revision); current.revision++; body = { imported: true };
      } else throw Error(`Unexpected fixture endpoint: ${url.pathname}`);
      // Capture the response before delaying it, like an older request in flight.
      body = JSON.stringify(body);
      const pending = holds.get(key); holds.delete(key);
      if (pending) { pending.started.resolve(); await pending.release.promise; }
      await handler.fulfill({ status, headers, body });
      pending?.completed.resolve();
    } catch (error) {
      errors.push(error.message); await handler.fulfill({ status: 500, headers, body: JSON.stringify({ error: "Fixture assertion failed" }) });
    }
  });
  const button = name => page.getByRole("button", { name, exact: true });
  const reviewBox = () => page.getByRole("checkbox", { name: "I reviewed this message and its company, file, and request type.", exact: true });
  async function ready() { await page.goto(origin); await button("Replace token").waitFor(); }
  async function preview() {
    await button("Browse inbox queue").click();
    await page.getByLabel("Missive conversation", { exact: true }).selectOption("conversation-A");
    await page.getByLabel("Missive message", { exact: true }).selectOption("message-A");
    await page.getByText("Private fixture message A", { exact: true }).waitFor();
  }
  async function acknowledge() {
    await page.getByLabel("Missive title file", { exact: true }).selectOption("file-A");
    await page.getByLabel("Missive request type", { exact: true }).selectOption("Revision"); await reviewBox().check();
  }
  async function settle(pending) {
    pending.release(); await pending.completed;
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  try {
    await test({ page, button, reviewBox, ready, preview, acknowledge, hold, settle, fail, credentials, routings, workspaces, events, requests });
    assert.deepEqual(errors, []); passed.push(name); console.log(`PASS ${name}`);
  } finally { for (const item of holds.values()) item.release.resolve(); await context.close(); }
}

try {
  await scenario("Initial credential metadata failure can be retried without remounting", async ({ page, button, fail, requests }) => {
    fail(endpoint("/credential")); await page.goto(origin);
    await page.getByText("Connection settings unavailable", { exact: true }).waitFor();
    assert(await button("Connect Missive").isDisabled());
    await button("Refresh connection settings").click(); await button("Replace token").waitFor();
    assert(await button("Replace token").isEnabled());
    assert.equal(requests.filter(r => r.path === endpoint("/credential")).length, 2);
  });
  await scenario("Disconnect blocks workflow and ignores a late successful connection check", async ({ page, button, ready, hold, settle }) => {
    await ready(); const check = hold(endpoint("/check")); await button("Check Missive connection").click(); await check.started;
    await button("Disconnect account").click(); const saving = hold(endpoint("/credential")); await button("Confirm disconnect").click(); await saving.started;
    assert(await button("Working…").isDisabled()); await settle(saving);
    await page.getByText("Connection disconnected.", { exact: false }).waitFor(); await settle(check);
    assert.equal(await page.getByText("Connection verified.", { exact: true }).count(), 0);
    assert.equal(await button("Browse inbox queue").count(), 0);
  });
  await scenario("An old initial setup cannot restore enabled routes after disconnect", async ({ page, button, hold, settle }) => {
    const initial = hold(endpoint(""), "GET"); await page.goto(origin); await initial.started; await button("Replace token").waitFor();
    await button("Disconnect account").click(); await button("Confirm disconnect").click();
    await page.getByText("Connection disconnected.", { exact: false }).waitFor(); await settle(initial);
    assert.equal(await button("Browse inbox queue").count(), 0);
    await page.getByText("Connect a working Missive API token above to review your inboxes.", { exact: true }).waitFor();
  });
  await scenario("Late message preview is discarded when a token is replaced", async ({ page, button, ready, hold, settle }) => {
    await ready(); await button("Browse inbox queue").click(); await page.getByLabel("Missive conversation", { exact: true }).selectOption("conversation-A");
    const pending = hold(endpoint("/preview")); await page.getByLabel("Missive message", { exact: true }).selectOption("message-A"); await pending.started;
    await button("Replace token").click(); await page.getByLabel("Complete Missive API token", { exact: true }).fill(token);
    await button("Verify and save connection").click(); await page.getByText("Connection verified and saved.", { exact: false }).waitFor(); await settle(pending);
    assert.equal(await page.getByText("Private fixture message A", { exact: true }).count(), 0);
    assert.equal(await button("Import reviewed message text").count(), 0);
  });
  await scenario("Credential conflicts reload metadata, clear secrets and require deliberate retry", async ({ page, button, ready, credentials, requests }) => {
    await ready(); await button("Replace token").click(); await page.getByLabel("Complete Missive API token", { exact: true }).fill(token);
    credentials.A.revision = 2; await button("Verify and save connection").click();
    await page.getByText("The connection changed elsewhere. Latest settings are loaded.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Complete Missive API token", { exact: true }).count(), 0);
    await button("Replace token").click(); assert.equal(await page.getByLabel("Complete Missive API token", { exact: true }).inputValue(), "");
    await page.getByLabel("Complete Missive API token", { exact: true }).fill(token); await button("Verify and save connection").click();
    await page.getByText("Connection verified and saved.", { exact: false }).waitFor();
    credentials.A.revision = 4; await button("Disconnect account").click(); await button("Confirm disconnect").click();
    await page.getByText("The connection changed elsewhere. Latest settings are loaded.", { exact: false }).waitFor();
    assert.equal(await button("Confirm disconnect").count(), 0);
    const changes = requests.filter(r => r.path === endpoint("/credential") && r.method === "POST");
    assert.deepEqual(changes.map(r => r.input.expectedRevision), [1, 2, 3]);
    await button("Disconnect account").click(); await button("Confirm disconnect").click();
    await page.getByText("Connection disconnected.", { exact: false }).waitFor(); assert.equal(credentials.A.revision, 5);
  });
  await scenario("Workspace refresh invalidates file acknowledgement and sends only reviewed revision", async ({ page, button, reviewBox, ready, preview, acknowledge, workspaces, requests }) => {
    await ready(); await preview(); await acknowledge(); assert(await button("Import reviewed message text").isEnabled());
    workspaces.A.revision = 2; workspaces.A.state.orders[0].address = "200 Changed Road"; await button("Refresh").click();
    await page.getByText("Workspace records changed after your review.", { exact: false }).waitFor();
    assert.equal(await reviewBox().isChecked(), false); assert(await button("Import reviewed message text").isDisabled());
    await reviewBox().check(); await button("Import reviewed message text").click();
    await page.getByText("Message and original source saved.", { exact: false }).waitFor();
    assert.equal(requests.find(r => r.path === endpoint("/import")).input.expectedRevision, 2);
  });
  await scenario("A closed selected file clears the visible choice and disables import", async ({ page, button, reviewBox, ready, preview, acknowledge, workspaces, requests }) => {
    await ready(); await preview(); await acknowledge(); workspaces.A.revision++; workspaces.A.state.orders[0].status = "Issued";
    await button("Refresh").click(); await page.getByText("The selected file is no longer open in this company.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Missive title file", { exact: true }).inputValue(), "");
    assert.equal(await reviewBox().isChecked(), false); assert(await reviewBox().isDisabled()); assert(await button("Import reviewed message text").isDisabled());
    assert.equal(requests.filter(r => r.path === endpoint("/import")).length, 0);
  });
  await scenario("Committed message import retains success when workspace refresh fails", async ({ page, button, ready, preview, acknowledge, fail, requests }) => {
    await ready(); await preview(); await acknowledge(); fail(`${prefix}/state`); await button("Import reviewed message text").click();
    await page.getByText("The message is saved, but this view could not refresh.", { exact: false }).waitFor();
    assert.equal(await button("Import reviewed message text").count(), 0);
    await page.getByText("Message and original source saved.", { exact: false }).waitFor();
    assert.equal(requests.filter(r => r.path === endpoint("/import")).length, 1);
  });
  await scenario("Committed attachment import reports failed refresh without repeating save", async ({ page, button, ready, workspaces, fail, requests }) => {
    await ready(); workspaces.A.state.inbox.push({ id: "source-A", companyId: "A", orderId: "file-A", subject: "Saved source", missive: { organizationId: "org-A", teamId: "team-A", messageId: "message-A", attachments: [{ id: "attachment-A", name: "fixture.pdf", bytes: 100 }] } });
    await button("Refresh").click(); await page.getByLabel("Imported Missive message", { exact: true }).selectOption("source-A");
    fail(`${prefix}/state`); await button("Save fixture.pdf to documents").click();
    await page.getByText("The attachment is saved, but this view could not refresh.", { exact: false }).waitFor();
    await page.getByText("fixture.pdf saved to Documents.", { exact: false }).waitFor();
    assert.equal(requests.filter(r => r.path === endpoint("/attachments/import")).length, 1);
  });
  await scenario("Actual Settings workspace keys remove old secrets and late previews", async ({ page, button, ready, hold, settle, workspaces }) => {
    await ready(); await button("Browse inbox queue").click(); await page.getByLabel("Missive conversation", { exact: true }).selectOption("conversation-A");
    const pending = hold(endpoint("/preview")); await page.getByLabel("Missive message", { exact: true }).selectOption("message-A"); await pending.started;
    await button("Replace token").click(); await page.getByLabel("Complete Missive API token", { exact: true }).fill(token);
    await page.evaluate(next => window.setFixture(next), workspaces.B); await button("Replace token").waitFor(); await settle(pending);
    assert.equal(await page.getByText("Private fixture message A", { exact: true }).count(), 0);
    await button("Replace token").click(); assert.equal(await page.getByLabel("Complete Missive API token", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("Active Missive company route", { exact: true }).inputValue(), "route-B");
  });
  await scenario("Saved event queue survives disconnect and preserves shared origin with one remaining route", async ({ page, button, ready, events }) => {
    await ready(); events.A.push({ id: "event-A", messageId: "message-A", conversationId: "conversation-A", subject: "Previously shared incoming event", receivedAt: "2026-09-14T12:00:00Z", status: "queued", companyId: null, organizationId: "org-A", teamId: "team-A", candidateRouteIds: ["route-A"], originallyShared: true });
    await button("Refresh incoming events").click();
    await page.getByText("Shared inbox: choose the destination company above before reviewing. No company has been assigned automatically.", { exact: true }).waitFor();
    await button("Disconnect account").click(); await button("Confirm disconnect").click();
    await page.getByText("Connection disconnected.", { exact: false }).waitFor(); events.A[0].candidateRouteIds = [];
    assert(await button("Refresh incoming events").isEnabled()); await button("Refresh incoming events").click();
    await page.getByText("Previously shared incoming event", { exact: true }).waitFor();
    assert(await button("Review incoming email").isDisabled());
    await page.getByText("This event has no active route", { exact: false }).waitFor();
  });
  console.log(JSON.stringify({ passed: passed.length, scope: "Actual React Settings components and authenticated backend client; synthetic workspace/Auth/API only; no live provider requests" }));
} finally {
  await browser.close(); await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true });
}
