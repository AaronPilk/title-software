// Real Team access component and select controls. Only workspace/API transport
// is synthetic; no live account, invitation, email or external request is used.
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
      import {BackendSettings} from './components/title/backend-settings'; import {FixtureProvider} from 'invitation-workspace';
      window.invitationRequests=[]; window.invitationResult={status:'Access invitation prepared; no email sent'};
      createRoot(document.getElementById('root')).render(<FixtureProvider><BackendSettings section="Team & access"/><Toaster/></FixtureProvider>);
    ` },
    plugins: [{ name: "synthetic-invitation-context", setup(builder) {
      builder.onResolve({ filter: /^(invitation-workspace|@\/lib\/title\/store)$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onResolve({ filter: /(?:^|\/)backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/missive-settings$/ }, () => ({ path: "missive", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        if (path === "missive") return { contents: "export const MissiveSettings = () => null;" };
        if (path === "client") return { contents: `
          export const activeWorkspace=()=> '11111111-1111-4111-8111-111111111111';
          export const supabase={auth:{signOut:async()=>{}}};
          export async function backendRequest(path,input) {
            window.invitationRequests.push({path,input});
            if(path==='/members') return {members:[],invitations:window.pendingInvitations||[]};
            if(path!=='/members/invite') throw Error('Unexpected fixture request');
            if(window.invitationError) throw Error(window.invitationError);
            return window.invitationResult;
          }
        ` };
        return { loader: "tsx", resolveDir: web, contents: `
          import React,{createContext,useContext,useState} from 'react';
          const Context=createContext(null); export const useWorkspace=()=>useContext(Context);
          export function FixtureProvider({children}) {
            const query=new URLSearchParams(location.search), [role,setRole]=useState(query.get('role')||'owner');
            window.setInvitationRole=setRole;
            const companies=query.has('empty')?[]:['A','B'].map(id=>({id,name:'Company '+id,members:[{name:'Member One',share:100}]}));
            const access={userId:'owner-fixture',email:'owner@example.test',role,allCompanies:true,restricted:true};
            return <Context.Provider value={{s:{companies},connection:{access,revision:1,refresh:async()=>true}}}>{children}</Context.Provider>;
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
after(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
async function open(query = "") {
  context = await browser.newContext();
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);
  await page.getByLabel("Invitation email", { exact: true }).fill("staff@example.test");
}
const submit = () => page.getByRole("button", { name: "Prepare access invitation", exact: true });
async function choose(label, name) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
const sent = () => page.evaluate(() => window.invitationRequests.filter(r => r.path === "/members/invite"));

test("the exact-retry toast displays the returned already-prepared status and no email claim", async () => {
  await open();
  await page.evaluate(() => { window.invitationResult={status:'Access invitation already prepared; no email sent'}; });
  await submit().click();
  await page.getByText("Access invitation already prepared; no email sent. Share account setup and sign-in instructions separately.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Invitation email", { exact: true }).inputValue(), "");
  const [request] = await sent(); assert.equal(request.input.allCompanies, true); assert.equal(request.input.restricted, false);
});
test("a conflicting pending invitation displays the server error and preserves the entered email", async () => {
  await open();
  const message = "A pending invitation already has a different role or company access. It was not changed. Review the existing invitation before preparing different access.";
  await page.evaluate(value => { window.invitationError=value; }, message);
  await submit().click(); await page.getByText(message, { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Invitation email", { exact: true }).inputValue(), "staff@example.test");
  assert.equal(await page.getByText(/Access invitation prepared; no email sent/).count(), 0);
});
test("pending invitation scope and restricted evidence are visible for review", async () => {
  await open();
  await page.evaluate(() => { window.pendingInvitations = [
    {id:'one',email:'onboarding@example.test',role:'onboarding',company_ids:['A','B'],all_companies:false,restricted_access:true,accepted_at:null,revoked_at:null},
    {id:'two',email:'all@example.test',role:'viewer',company_ids:[],all_companies:true,restricted_access:false,accepted_at:null,revoked_at:null},
  ]; });
  // A successful exact retry reloads the invitation list using the same path as
  // a normal submit; inspect the real pending-list rendering afterwards.
  await submit().click();
  const scoped = page.getByText(/onboarding@example.test · onboarding · awaiting verified sign-in/);
  await scoped.waitFor(); assert.match(await scoped.innerText(), /Company A, Company B · Restricted evidence access enabled/);
  const all = page.getByText(/all@example.test · viewer · awaiting verified sign-in/);
  assert.match(await all.innerText(), /All companies/); assert.doesNotMatch(await all.innerText(), /Restricted evidence/);
});
test("admin controls require a company and offer only grants the admin can prepare", async () => {
  await open("role=admin"); assert.equal(await submit().isDisabled(), true);
  await page.getByRole("combobox", { name: "Invitation role", exact: true }).click();
  assert.deepEqual(await page.getByRole("option").allTextContents(), ["operations", "finance", "viewer", "partner"]);
  await page.getByRole("option", { name: "operations", exact: true }).click();
  await page.getByRole("combobox", { name: "Invitation company", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: "All companies (staff only)", exact: true }).count(), 0);
  await page.getByRole("option", { name: "Company A", exact: true }).click();
  assert.equal(await submit().isEnabled(), true); await submit().click();
  await page.getByText("Access invitation prepared; no email sent. Share account setup and sign-in instructions separately.", { exact: true }).waitFor();
  const [request] = await sent(); assert.deepEqual(request.input.companyIds, ["A"]);
  assert.equal(request.input.allCompanies, false); assert.equal(request.input.restricted, false); assert.equal(request.input.role, "operations");
});
test("admin with no companies has no enabled invitation submission", async () => {
  await open("role=admin&empty=1"); assert.equal(await submit().isDisabled(), true); assert.deepEqual(await sent(), []);
});
test("owner can still prepare onboarding access and partner access requires an explicit company/member", async () => {
  await open(); await choose("Invitation role", "onboarding"); await choose("Invitation company", "Company A");
  await submit().click(); await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  let [request] = await sent(); assert.equal(request.input.restricted, true); assert.equal(request.input.role, "onboarding");
  await page.reload(); await page.getByLabel("Invitation email", { exact: true }).fill("partner@example.test");
  await choose("Invitation role", "partner"); assert.equal(await submit().isDisabled(), true);
  await choose("Invitation company", "Company B"); assert.equal(await submit().isDisabled(), true);
  await choose("Partner member identity", "Member One"); await submit().click();
  await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  [request] = await sent(); assert.equal(request.input.allCompanies, false); assert.equal(request.input.restricted, false);
  assert.deepEqual(request.input.partnerMembers, [{ companyId: "B", memberName: "Member One" }]);
});
test("an owner-to-admin access refresh cannot leave an elevated form grant active", async () => {
  await open(); await choose("Invitation role", "onboarding");
  await page.evaluate(() => window.setInvitationRole("admin"));
  await page.waitForFunction(() => document.querySelector('[aria-label="Invitation role"]').textContent.includes('operations'));
  assert.equal(await submit().isDisabled(), true);
  await choose("Invitation company", "Company A"); await submit().click();
  await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  const [request] = await sent(); assert.equal(request.input.role, "operations"); assert.equal(request.input.restricted, false); assert.equal(request.input.allCompanies, false);
});
