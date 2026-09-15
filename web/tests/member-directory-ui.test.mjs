// Real Team & access rendering and revoke action; synthetic workspace/API only.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
const errors = [];
before(async () => {
  const bundle = await build({ absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {Toaster} from 'sonner';
      import {BackendSettings} from './components/title/backend-settings';
      window.memberDirectoryRequests=[];
      window.memberDirectoryRows=[
        {user_id:'owner-fixture',email:'owner@example.test',role:'owner',company_ids:[],all_companies:true,active:true},
        {user_id:'staff-fixture',email:new URLSearchParams(location.search).has('missing')?null:'staff@example.test',role:'operations',company_ids:['A'],all_companies:false,active:true},
        {user_id:'revoked-fixture',email:'revoked@example.test',role:'viewer',company_ids:['A'],all_companies:false,active:false}
      ];
      createRoot(document.getElementById('root')).render(<><BackendSettings section="Team & access"/><Toaster/></>);
    ` },
    plugins: [{ name: "synthetic-member-directory", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onResolve({ filter: /(?:^|\/)backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/missive-settings$/ }, () => ({ path: "missive", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        if (path === "missive") return { contents: "export const MissiveSettings=()=>null;" };
        if (path === "workspace") return { contents: `
          const value={s:{companies:[{id:'A',name:'Company A',members:[]}]},connection:{access:{userId:'owner-fixture',email:'owner@example.test',role:'owner',allCompanies:true},revision:1,refresh:async()=>true}};
          export const useWorkspace=()=>value;
        ` };
        return { contents: `
          export const activeWorkspace=()=> '11111111-1111-4111-8111-111111111111';
          export const supabase={auth:{signOut:async()=>{}}};
          export async function backendRequest(path,input) {
            window.memberDirectoryRequests.push({path,input});
            if(path==='/members') return {members:structuredClone(window.memberDirectoryRows),invitations:[]};
            if(path==='/members/revoke') {window.memberDirectoryRows.find(m=>m.user_id===input.userId).active=false;return {revoked:true};}
            throw Error('Unexpected fixture request');
          }
        ` };
      });
    } }],
  });
  server = createServer((req, res) => {
    if (new URL(req.url, "http://localhost").pathname === "/app.mjs") {
      res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0].contents);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(query = "") {
  context = await browser.newContext();
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);
  await page.locator(".backend-access-list > div").filter({ hasText: "owner@example.test" }).waitFor();
}
const row = identity => page.locator(".backend-access-list > div").filter({ hasText: identity });
test("current account emails identify every resolved membership with role and company scope", async () => {
  await open();
  const text = await page.locator(".backend-access-list").innerText();
  assert.match(text, /owner@example.test/); assert.match(text, /staff@example.test/); assert.match(text, /revoked@example.test/);
  assert.doesNotMatch(text, /owner-fixture|staff-fixture|revoked-fixture|Email unavailable/);
  assert.match(await row("staff@example.test").innerText(), /operations · Active/);
  assert.match(await row("staff@example.test").innerText(), /Company A/);
  assert.equal(await row("owner@example.test").getByRole("button", { name: "Revoke access", exact: true }).count(), 0);
  assert.equal(await row("revoked@example.test").getByRole("button", { name: "Revoke access", exact: true }).count(), 0);
});
test("unavailable identity shows its account ID and refresh retries it without changing access", async () => {
  await open("missing=1");
  const missing = row("Account ID: staff-fixture");
  assert.match(await missing.innerText(), /Email unavailable/); assert.match(await missing.innerText(), /operations · Active/);
  await page.getByText("Some account emails are unavailable. Refresh to retry; account IDs are shown so you can distinguish these memberships.", { exact: true }).waitFor();
  await page.evaluate(() => { window.memberDirectoryRows[1].email='restored@example.test'; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await row("restored@example.test").waitFor();
  assert.equal(await page.getByText("Email unavailable", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.memberDirectoryRequests.filter(r => r.path === '/members').length), 2);
  assert.equal(await page.evaluate(() => window.memberDirectoryRequests.some(r => r.path === '/members/revoke')), false);
});
test("revoking an email-identified membership still submits its original account UUID", async () => {
  await open(); await row("staff@example.test").getByRole("button", { name: "Revoke access", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.backend-access-list').textContent.includes('operations · Revoked'));
  const requests = await page.evaluate(() => window.memberDirectoryRequests.filter(r => r.path === '/members/revoke'));
  assert.deepEqual(requests, [{ path: "/members/revoke", input: { workspaceId: "11111111-1111-4111-8111-111111111111", userId: "staff-fixture" } }]);
  assert.equal(await row("staff@example.test").getByRole("button", { name: "Revoke access", exact: true }).count(), 0);
});
