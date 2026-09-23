import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [], external = [];
before(async () => {
  const result = await build({ absWorkingDir: root, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", outfile: "/vendors/app.mjs", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {VendorFixture} from './tests/fixtures/vendor-settings';createRoot(document.getElementById('root')).render(<VendorFixture/>);` },
    plugins: [{ name: "vendor-transport", setup(builder) { builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: `${root}tests/fixtures/vendor-settings.tsx` })); } }],
  });
  const js = result.outputFiles.find(file => file.path.endsWith(".mjs")), css = result.outputFiles.find(file => file.path.endsWith(".css"));
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("content-type", path === "/app.mjs" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    response.end(path === "/app.mjs" ? js.text : path === "/app.css" ? css.text : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0;font-family:system-ui"><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(mobile = false) {
  errors = []; external = [];
  context = await browser.newContext({ viewport: mobile ? { width: 375, height: 740 } : { width: 1200, height: 1000 } });
  await context.route("**/*", route => { if (route.request().url().startsWith(origin + "/")) return route.continue(); external.push(route.request().url()); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.getByRole("button", { name: "Load templates", exact: true }).waitFor();
}
const calls = operation => page.evaluate(value => window.vendorRequests.filter(request => request.path.endsWith("/" + value)), operation);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function form() {
  await page.getByRole("button", { name: "Load templates", exact: true }).click();
  await page.getByLabel("Signature template", { exact: true }).selectOption("10000000-0000-4000-8000-000000000001");
  await page.getByLabel("Envelope subject", { exact: true }).fill("Fictional company welcome");
  await page.getByLabel("Template role 1", { exact: true }).fill("Owner");
  await page.getByLabel("Recipient name 1", { exact: true }).fill("Fictional Owner");
  await page.getByLabel("Recipient email 1", { exact: true }).fill("fictional@example.test");
}

test("missing app credentials are explained without a fake connect button or secret input", async () => {
  await open(); await page.evaluate(() => { window.vendorAppConfigured = false; });
  await page.getByRole("button", { name: "Refresh connections", exact: true }).click();
  await page.getByRole("heading", { name: "DocuSign is ready for account setup", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Connect DocuSign|Reconnect DocuSign/ }).count(), 0);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.getByRole("heading", { name: "QuickBooks is ready for account setup", exact: true }).waitFor();
  assert.match(await page.getByRole("region", { name: "DocuSign and QuickBooks connections", exact: true }).innerText(), /app client ID and secret/);
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await page.getByText("No account connected for this company.", { exact: true }).waitFor();
  assert.equal((await calls("disconnect"))[0].data.provider, "quickbooks");
});

test("company reports use the observed revision, chosen basis, and captured actor/workspace", async () => {
  await open(); await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.getByLabel("Report start date", { exact: true }).fill("2026-09-01");
  await page.getByLabel("Report end date", { exact: true }).fill("2026-09-23");
  await page.getByLabel("Accounting basis", { exact: true }).selectOption("Cash");
  await page.getByRole("button", { name: "Load Profit and Loss", exact: true }).click();
  await page.getByText("Private report company-a", { exact: true }).waitFor();
  const sent = (await calls("report"))[0];
  assert.deepEqual(sent.data, { workspaceId: "workspace-one", provider: "quickbooks", companyId: "company-a", expectedRevision: 2, expectedGeneration: 1, startDate: "2026-09-01", endDate: "2026-09-23", accountingMethod: "Cash" });
  assert.equal(sent.method, "POST"); assert.equal(sent.workspaceId, "workspace-one"); assert.equal(sent.userId, "owner-one");
  await page.getByRole("button", { name: "Check connection", exact: true }).click();
  await page.getByText("QuickBooks connection verified for Fictional Acorn Title.", { exact: true }).waitFor();
  assert.equal((await calls("check"))[0].data.expectedRevision, 3);
  await page.getByLabel("Report end date", { exact: true }).fill("2026-09-22");
  assert.equal(await page.getByText("Private report company-a", { exact: true }).count(), 0);
});

test("switching company or identity discards late private reports and recipient drafts", async () => {
  await open(); await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.evaluate(() => { window.vendorHoldOperation = "report"; });
  await page.getByRole("button", { name: "Load Profit and Loss", exact: true }).click();
  await page.waitForFunction(() => window.vendorPending.length === 1);
  await page.getByLabel("Title company", { exact: true }).selectOption("company-b");
  await page.evaluate(() => window.vendorPending.shift()()); await settle();
  assert.equal(await page.getByText("Private report company-a", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Load Profit and Loss", exact: true }).click();
  await page.getByText("Private report company-b", { exact: true }).waitFor();
  await page.evaluate(() => window.setVendorContext({ userId: "owner-two", version: 2 }));
  await page.getByRole("button", { name: "Load templates", exact: true }).waitFor();
  assert.equal(await page.getByText("Private report company-b", { exact: true }).count(), 0);
  await form(); await page.getByLabel("Title company", { exact: true }).selectOption("company-b");
  assert.equal(await page.getByLabel("Recipient email 1", { exact: true }).count(), 0);
});

test("draft preparation requires review, clears review on edits, and never sends envelopes", async () => {
  await open(); await form();
  const prepare = page.getByRole("button", { name: "Prepare DocuSign draft", exact: true });
  assert.equal(await prepare.isDisabled(), true);
  await page.getByRole("checkbox").check();
  await page.getByLabel("Envelope subject", { exact: true }).fill("Revised fictional welcome");
  assert.equal(await page.getByRole("checkbox").isChecked(), false); assert.equal(await prepare.isDisabled(), true);
  await page.getByRole("checkbox").check(); await prepare.click();
  await page.getByRole("button", { name: "Draft prepared", exact: true }).waitFor();
  const sent = (await calls("draft"))[0];
  assert.equal(sent.data.reviewed, true); assert.equal(sent.data.expectedRevision, 2); assert.equal(sent.userId, "owner-one");
  assert.match(sent.data.requestId, /^[a-f\d-]{36}$/);
  assert.deepEqual(sent.data.roles, [{ roleName: "Owner", name: "Fictional Owner", email: "fictional@example.test" }]);
  assert.equal(sent.data.status, undefined); assert.equal((await calls("send")).length, 0);
  await page.getByText(/no email was sent here/).waitFor();
});

test("uncertain draft retry preserves the request UUID and explicit status recovery does not resend", async () => {
  await open(); await form(); await page.getByRole("checkbox").check();
  await page.evaluate(() => { window.vendorDraftFailures = 2; });
  await page.getByRole("button", { name: "Prepare DocuSign draft", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Prepare DocuSign draft", exact: true }).click();
  await page.waitForFunction(() => window.vendorRequests.filter(request => request.path.endsWith("/draft")).length === 2);
  const sent = await calls("draft"); assert.equal(sent[0].data.requestId, sent[1].data.requestId);
  assert.equal(await page.evaluate(() => window.vendorDrafts.length), 1);
  await page.getByRole("button", { name: "Check pending draft status", exact: true }).click();
  await page.getByRole("button", { name: "Draft prepared", exact: true }).waitFor();
  assert.equal((await calls("draft")).length, 2); assert.equal((await calls("draft-status")).length, 1);
  assert.equal(await page.getByRole("button", { name: "Check draft status", exact: true }).isDisabled(), true);
});

test("pending draft operation cannot duplicate on repeated clicks and service switch removes late results", async () => {
  await open(); await form(); await page.getByRole("checkbox").check();
  await page.evaluate(() => { window.vendorHoldOperation = "draft"; });
  await page.getByRole("button", { name: "Prepare DocuSign draft", exact: true }).click();
  await page.waitForFunction(() => window.vendorPending.length === 1);
  assert.equal(await page.getByRole("button", { name: "Prepare DocuSign draft", exact: true }).isDisabled(), true);
  await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.evaluate(() => window.vendorPending.shift()()); await settle();
  assert.equal(await page.getByRole("button", { name: "Draft prepared", exact: true }).count(), 0);
  assert.equal((await calls("draft")).length, 1);
});

test("a refresh before a lost draft response keeps generation and retry ID, then learns the new revision", async () => {
  await open(); await form(); await page.getByRole("checkbox").check();
  await page.evaluate(() => { window.vendorDraftFailures = 1; });
  await page.getByRole("button", { name: "Prepare DocuSign draft", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Prepare DocuSign draft", exact: true }).click();
  await page.getByRole("button", { name: "Draft prepared", exact: true }).waitFor();
  const sent = await calls("draft");
  assert.equal(sent.length, 2); assert.equal(sent[0].data.requestId, sent[1].data.requestId);
  assert.equal(sent[0].data.expectedGeneration, 1); assert.equal(sent[1].data.expectedGeneration, 1);
  assert.equal(sent[0].data.expectedRevision, 2); assert.equal(sent[1].data.expectedRevision, 2);
  assert.equal((await calls("drafts")).at(-1).data.expectedRevision, 3);
  assert.equal(await page.evaluate(() => window.vendorDrafts.length), 1);
});

test("OAuth handoff remembers the exact company and actor before controlled provider navigation", async () => {
  await open();
  await context.route("https://appcenter.intuit.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Synthetic Intuit consent</h1>" }));
  await page.getByLabel("Title company", { exact: true }).selectOption("company-b");
  await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.getByRole("button", { name: "Reconnect QuickBooks", exact: true }).click();
  await page.getByRole("heading", { name: "Synthetic Intuit consent", exact: true }).waitFor();
  await page.goto(origin);
  const intent = await page.evaluate(() => JSON.parse(sessionStorage.getItem("title-vendor-authorization-v1")));
  assert.equal(intent.companyId, "company-b"); assert.equal(intent.provider, "quickbooks");
  assert.equal(intent.userId, "owner-one"); assert.equal(intent.workspaceId, "workspace-one");
  assert.equal(intent.accountId, ""); assert.match(intent.state, /^tv1_[a-f\d]{64}$/); assert.ok(Date.parse(intent.expiresAt) > Date.now());
});

test("changing company during OAuth preparation cannot redirect using stale intent", async () => {
  await open(); await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.evaluate(() => { window.vendorHoldOperation = "start"; });
  await page.getByRole("button", { name: "Reconnect QuickBooks", exact: true }).click();
  await page.waitForFunction(() => window.vendorPending.length === 1);
  await page.getByLabel("Title company", { exact: true }).selectOption("company-b");
  await page.evaluate(() => window.vendorPending.shift()()); await settle();
  assert.equal(page.url(), origin + "/");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("title-vendor-authorization-v1")), null);
});

test("removing a connection requires an explicit confirmation and ordinary staff lose controls", async () => {
  await open(); await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  assert.equal((await calls("disconnect")).length, 0);
  await page.getByRole("button", { name: "Keep connection", exact: true }).click();
  assert.equal((await calls("disconnect")).length, 0);
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await page.getByRole("button", { name: "Connect DocuSign", exact: true }).waitFor();
  assert.equal((await calls("disconnect"))[0].data.companyId, "company-a");
  await page.evaluate(() => window.setVendorContext({ role: "operations", version: 2 }));
  await page.getByText("An organization administrator manages DocuSign and QuickBooks connections.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Connect DocuSign", exact: true }).count(), 0);
});

test("vendor forms and reports remain within a narrow viewport", async () => {
  await open(true); await form(); await page.getByRole("button", { name: "Add recipient", exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByLabel("Service", { exact: true }).selectOption("quickbooks");
  await page.getByRole("button", { name: "Load Profit and Loss", exact: true }).click();
  await page.getByText("Private report company-a", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
});
