import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = "tv1_" + "a".repeat(64);
const syntheticCode = "SYNTHETIC-AUTHORIZATION-CODE";
const accountId = "11111111-1111-4111-8111-111111111111";
let server, browser, context, page, origin;
let errors = [], external = [];
before(async () => {
  const result = await build({ absWorkingDir: root, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", outfile: "/oauth-return/app.mjs",
    // Development StrictMode runs mount effects twice. This catches consumed-code replays.
    define: { "process.env.NODE_ENV": '"development"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {VendorOAuthReturnFixture} from './tests/fixtures/vendor-oauth-return';createRoot(document.getElementById('root')).render(<React.StrictMode><VendorOAuthReturnFixture/></React.StrictMode>);` },
    plugins: [{ name: "oauth-return-transport", setup(builder) { builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: `${root}tests/fixtures/vendor-oauth-return.tsx` })); } }],
  });
  const script = result.outputFiles.find(file => file.path.endsWith(".mjs"));
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("content-type", path === "/app.mjs" ? "text/javascript" : "text/html");
    response.end(path === "/app.mjs" ? script.text : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:system-ui"><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
function intent(patch = {}) { return { state, provider: "docusign", companyId: "fictional-company-a", workspaceId: "workspace-one", userId: "owner-one", accountId, expiresAt: new Date(Date.now() + 600000).toISOString(), ...patch }; }
async function open({ stored = JSON.stringify(intent()), query = `state=${state}&code=${syntheticCode}`, hold = false, error, identity } = {}) {
  errors = []; external = [];
  context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.route("**/*", route => { if (route.request().url().startsWith(origin + "/")) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(seed => { window.oauthReturnSeed = seed; }, { intent: stored, hold, error, context: identity });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", reason => errors.push(reason.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/?keep=ordinary&${query}#agency/settings`);
  await page.getByTestId("current-account").waitFor();
}
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const requests = () => page.evaluate(() => window.oauthReturnRequests);
const snapshot = () => page.evaluate(() => window.oauthReturnSnapshot());
async function mismatch() {
  await page.getByText(/does not match your signed-in account or has expired/).waitFor();
  assert.deepEqual(await requests(), []); assert.equal((await snapshot()).pending, null);
}

test("a valid callback submits once under development StrictMode with the captured account and workspace", async () => {
  await open(); await page.getByText(/Account connected\. Open Settings/).waitFor();
  const sent = await requests(); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { path: "/integrations/vendors/complete", data: { workspaceId: "workspace-one", provider: "docusign", companyId: "fictional-company-a", accountId,
    code: syntheticCode, state, realmId: "", denied: false }, method: "POST", timeout: 90000, workspaceId: "workspace-one", userId: "owner-one" });
  const current = await snapshot(); assert.equal(current.pending, null); assert.equal(current.stored, null);
  const url = new URL(current.href); assert.equal(url.searchParams.get("keep"), "ordinary"); assert.equal(url.searchParams.has("code"), false); assert.equal(url.searchParams.has("state"), false); assert.equal(url.hash, "#agency/settings");
  await page.getByRole("button", { name: "Close", exact: true }).click(); assert.equal(await page.getByRole("status").count(), 0);
  await page.evaluate(() => window.oauthReturnContext({ mount: 2 })); await settle();
  assert.equal((await requests()).length, 1); assert.equal(await page.getByRole("status").count(), 0);
});

test("valid QuickBooks callback passes its realm without placing credentials into session storage", async () => {
  await open({ stored: JSON.stringify(intent({ provider: "quickbooks", accountId: "" })), query: `state=${state}&code=${syntheticCode}&realmId=9341456789012345` });
  await page.getByText(/Account connected\. Open Settings/).waitFor();
  const [sent] = await requests(); assert.equal(sent.data.provider, "quickbooks"); assert.equal(sent.data.realmId, "9341456789012345");
  assert.equal((await snapshot()).stored, null); assert.equal((await snapshot()).pending, null);
});

test("provider denial reaches completion once with denied=true and no authorization code", async () => {
  await open({ query: `state=${state}&error=access_denied&error_description=Private+provider+details&error_uri=https%3A%2F%2Fexample.test`, error: "Account connection was cancelled. You can try again from Settings." });
  await page.getByText("Account connection was cancelled. You can try again from Settings.", { exact: true }).waitFor();
  const [sent] = await requests(); assert.equal(sent.data.denied, true); assert.equal(sent.data.code, ""); assert.equal((await requests()).length, 1);
  const current = await snapshot(); assert.equal(current.pending, null); assert.equal(current.stored, null);
  for (const key of ["error", "error_description", "error_uri", "state"]) assert.equal(new URL(current.href).searchParams.has(key), false);
  assert.ok(!(await page.locator("body").innerText()).includes("Private provider details"));
});

for (const [name, patch] of [
  ["another account", { userId: "owner-two" }], ["another workspace", { workspaceId: "workspace-two" }],
  ["expired intent", { expiresAt: "2020-01-01T00:00:00Z" }], ["invalid expiry", { expiresAt: "tomorrow" }],
  ["unsupported vendor", { provider: "evil" }], ["missing company", { companyId: "" }], ["unmatched state", { state: "tv1_" + "b".repeat(64) }],
]) test(`${name} rejects the callback before making a completion request`, async () => {
  await open({ stored: JSON.stringify(intent(patch)) }); await mismatch();
});

for (const [name, stored] of [["missing", null], ["malformed JSON", "{"], ["primitive", '"bad"']])
  test(`${name} stored intent cannot complete a connection`, async () => { await open({ stored }); await mismatch(); });

for (const [name, query] of [
  ["missing authorization code", `state=${state}`], ["empty authorization code", `state=${state}&code=`],
  ["invalid state", "state=tv1_invalid&code=test"], ["duplicate state", `state=${state}&state=${state}&code=test`],
  ["duplicate authorization code", `state=${state}&code=first&code=second`], ["oversized authorization code", `state=${state}&code=${"x".repeat(4097)}`],
  ["duplicate realm", `state=${state}&code=test&realmId=1&realmId=2`], ["duplicate denial", `state=${state}&error=a&error=b`],
]) test(`${name} is recognized as malformed without a backend call`, async () => {
  await open({ query }); await mismatch(); assert.equal(new URL((await snapshot()).href).searchParams.has("code"), false);
});

test("an ordinary page or unrelated OAuth callback does not appear as a vendor connection", async () => {
  await open({ query: "code=unrelated&state=unrelated-state", stored: null }); await settle();
  assert.equal(await page.getByRole("status").count(), 0); assert.deepEqual(await requests(), []);
  // Another auth flow owns this code. Vendor code must not erase it.
  assert.equal(new URL((await snapshot()).href).searchParams.get("code"), "unrelated");
});

test("pending completion consumes local intent immediately and shows success only after its real promise resolves", async () => {
  await open({ hold: true }); await page.getByText("Finishing your account connection…", { exact: true }).waitFor();
  assert.equal((await requests()).length, 1); assert.equal((await snapshot()).stored, null); assert.equal((await snapshot()).pending, null);
  assert.equal(await page.getByRole("button", { name: "Close", exact: true }).count(), 0);
  assert.equal(await page.getByText(/Account connected\. Open Settings/).count(), 0);
  await page.evaluate(() => window.oauthReturnComplete()); await page.getByText(/Account connected\. Open Settings/).waitFor();
});

test("a failed completion shows its backend error and neither rerender nor remount retries the consumed code", async () => {
  await open({ hold: true }); await page.getByText("Finishing your account connection…", { exact: true }).waitFor();
  await page.evaluate(() => window.oauthReturnComplete("Connection approval expired. Start again from Settings."));
  await page.getByText("Connection approval expired. Start again from Settings.", { exact: true }).waitFor();
  await page.evaluate(() => window.oauthReturnContext({})); await settle(); assert.equal((await requests()).length, 1);
  await page.evaluate(() => window.oauthReturnContext({ mount: 2 })); await settle(); assert.equal((await requests()).length, 1);
  assert.equal(await page.getByRole("status").count(), 0);
});

for (const outcome of ["success", "error"]) test(`an identity switch discards late ${outcome} from the previous account`, async () => {
  await open({ hold: true }); await page.getByText("Finishing your account connection…", { exact: true }).waitFor();
  await page.evaluate(() => window.oauthReturnContext({ userId: "owner-two", version: 2 }));
  await page.getByTestId("current-account").filter({ hasText: "owner-two" }).waitFor();
  assert.equal(await page.getByRole("status").count(), 0);
  await page.evaluate(value => window.oauthReturnComplete(value === "error" ? "Private previous-account error" : undefined), outcome); await settle();
  assert.equal(await page.getByRole("status").count(), 0); assert.equal((await requests()).length, 1);
  assert.ok(!(await page.locator("body").innerText()).includes("Private previous-account error"));
});
