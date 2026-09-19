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
    loader: { ".css": "empty", ".module.css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {Toaster} from 'sonner';
      import {BackendSettings} from './components/title/backend-settings'; import {FixtureProvider} from 'invitation-workspace';
      window.workspaceId='11111111-1111-4111-8111-111111111111'; window.invitationRequests=[]; window.invitationResult={status:'Access invitation prepared; no email sent'};
      createRoot(document.getElementById('root')).render(<FixtureProvider><BackendSettings section="Team & access"/><Toaster/></FixtureProvider>);
    ` },
    plugins: [{ name: "synthetic-invitation-context", setup(builder) {
      builder.onResolve({ filter: /^(invitation-workspace|@\/lib\/title\/store)$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onResolve({ filter: /(?:^|\/)backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/missive-settings$/ }, () => ({ path: "missive", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        if (path === "missive") return { contents: "export const MissiveSettings = () => null;" };
        if (path === "client") return { contents: `
          export const activeWorkspace=()=> window.workspaceId;
          export const supabase={auth:{signOut:async()=>{}}};
          export async function backendRequest(path,input) {
            window.invitationRequests.push({path,input});
            if(path==='/members') {
              if(window.directoryError) throw Error(window.directoryError);
              const data={members:[],invitations:structuredClone(window.pendingInvitations||[]),emailDeliveryEnabled:window.emailDeliveryEnabled===true};
              if(window.holdNextDirectory) { window.holdNextDirectory=false; return new Promise(resolve=>window.releaseDirectory=()=>resolve(data)); }
              return data;
            }
            if(window.invitationError) throw Object.assign(Error(window.invitationError),{status:window.invitationErrorStatus});
            if(window.holdNextMutation) { window.holdNextMutation=false; await new Promise(resolve=>window.releaseMutation=resolve); }
            if(window.failRefresh) window.directoryError='Directory unavailable';
            const invitation=window.pendingInvitations?.find(i=>i.id===input.invitationId);
            if(path==='/members/invitations/send') {
              const result=window.deliveryResult||{id:input.invitationId,status:'sent',recorded:true,message:'Email accepted by the provider. Inbox delivery is not confirmed.'};
              invitation.delivery_status=result.recorded?result.status:'sending';
              invitation.delivery_at=new Date().toISOString();
              return result;
            }
            if(path==='/members/invitations/cancel') { invitation.revoked_at=new Date().toISOString(); invitation.version++; }
            else if(path==='/members/invitations/reissue') { invitation.revoked_at=null; invitation.expires_at=new Date(Date.now()+7*86400000).toISOString(); invitation.version++; }
            else if(path==='/members/invite' && invitation) { Object.assign(invitation,{role:input.role,company_ids:input.companyIds,all_companies:input.allCompanies,restricted_access:input.restricted,partner_members:input.partnerMembers,version:invitation.version+1}); }
            else if(path!=='/members/invite') throw Error('Unexpected fixture request');
            return window.invitationResult;
          }
        ` };
        return { loader: "tsx", resolveDir: web, contents: `
          import React,{createContext,useContext,useState} from 'react';
          const Context=createContext(null); export const useWorkspace=()=>useContext(Context);
          export function FixtureProvider({children}) {
            const query=new URLSearchParams(location.search), [role,setRole]=useState(query.get('role')||'owner'), [identity,setIdentity]=useState('owner-fixture');
            window.setInvitationRole=setRole; window.setInvitationIdentity=setIdentity;
            window.changeInvitationWorkspace=id=>{window.workspaceId=id;setIdentity(id);};
            const companies=query.has('empty')?[]:['A','B'].map(id=>({id,name:'Company '+id,members:[{name:'Member One',share:100}]}));
            const access={userId:identity,email:identity+'@example.test',role,allCompanies:true,restricted:true,version:1,companyIds:[]};
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
  await page.getByText("Loading team access…", { exact: true }).waitFor({state:"hidden"});
}
const submit = () => page.getByRole("button", { name: "Prepare access invitation", exact: true });
async function choose(label, name) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
const sent = () => page.evaluate(() => window.invitationRequests.filter(r => r.path === "/members/invite"));

const company = name => page.getByRole("checkbox", { name: `Company access: Company ${name}`, exact: true });
const allCompanies = () => page.getByRole("checkbox", { name: "All companies, including companies added later", exact: true });
const restricted = () => page.getByRole("checkbox", { name: "Allow restricted evidence access", exact: true });
const inviteRow = email => page.getByRole("article", { name: `Invitation for ${email}`, exact: true });
const pending = overrides => ({ id: "one", email: "onboarding@example.test", role: "onboarding", company_ids: ["A", "B"], all_companies: false, restricted_access: true, partner_members: [], accepted_at: null, revoked_at: null, version: 4, expires_at: new Date(Date.now()+7*86400000).toISOString(), ...overrides });
async function showInvitations(rows) {
  await page.evaluate(value => { window.pendingInvitations=value; }, rows);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  for (const row of rows) await inviteRow(row.email).waitFor();
}

test("the exact-retry toast displays the returned already-prepared status and no email claim", async () => {
  await open(); assert.equal(await submit().isDisabled(), true); await allCompanies().check();
  await page.evaluate(() => { window.invitationResult={status:'Access invitation already prepared; no email sent'}; });
  await submit().click();
  await page.getByText("Access invitation already prepared; no email sent. Share account setup and sign-in instructions separately.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Invitation email", { exact: true }).inputValue(), "");
  const [request] = await sent(); assert.equal(request.input.allCompanies, true); assert.equal(request.input.restricted, false);
  assert.match(request.input.requestId, /^[a-f0-9-]{36}$/);
});
test("a conflicting pending invitation displays the server error and preserves the entered email", async () => {
  await open(); await company("A").check();
  const message = "A pending invitation already has a different role or company access. It was not changed. Review the existing invitation before preparing different access.";
  await page.evaluate(value => { window.invitationError=value; }, message);
  await submit().click(); await page.getByText(message, { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Invitation email", { exact: true }).inputValue(), "staff@example.test");
  assert.equal(await page.getByText(/Access invitation prepared; no email sent/).count(), 0);
});
test("all invitation states show current scope, evidence access and expiration", async () => {
  await open();
  await showInvitations([
    pending(),
    pending({id:'two',email:'all@example.test',role:'viewer',company_ids:[],all_companies:true,restricted_access:false}),
    pending({id:'old',email:'expired@example.test',expires_at:'2020-01-01T00:00:00Z'}),
    pending({id:'canceled',email:'canceled@example.test',revoked_at:'2026-09-01T00:00:00Z'}),
    pending({id:'accepted',email:'accepted@example.test',accepted_at:'2026-09-01T00:00:00Z'}),
  ]);
  const scoped = inviteRow("onboarding@example.test");
  assert.match(await scoped.innerText(), /Awaiting verified sign-in/); assert.match(await scoped.innerText(), /Company A, Company B · Restricted evidence access enabled/);
  const all = inviteRow("all@example.test"); assert.match(await all.innerText(), /All companies/); assert.doesNotMatch(await all.innerText(), /Restricted evidence/);
  assert.match(await inviteRow("expired@example.test").innerText(), /Expired/);
  assert.equal(await inviteRow("expired@example.test").getByRole("button", {name:"Edit invitation"}).count(), 0);
  assert.match(await inviteRow("canceled@example.test").innerText(), /Canceled/);
  assert.equal(await inviteRow("canceled@example.test").getByRole("button", {name:"Cancel invitation"}).count(), 0);
  assert.match(await inviteRow("accepted@example.test").innerText(), /Accepted/);
  assert.equal(await inviteRow("accepted@example.test").getByRole("button").count(), 0);
});
test("admin controls support several companies and only grants the admin can prepare", async () => {
  await open("role=admin"); assert.equal(await submit().isDisabled(), true);
  await page.getByRole("combobox", { name: "Invitation role", exact: true }).click();
  assert.deepEqual(await page.getByRole("option").allTextContents(), ["operations", "finance", "viewer", "partner"]);
  await page.getByRole("option", { name: "operations", exact: true }).click();
  assert.equal(await allCompanies().count(), 0); assert.equal(await restricted().count(), 0);
  await company("A").check(); await company("B").check();
  assert.equal(await submit().isEnabled(), true); await submit().click();
  await page.getByText("Access invitation prepared; no email sent. Share account setup and sign-in instructions separately.", { exact: true }).waitFor();
  const [request] = await sent(); assert.deepEqual(request.input.companyIds, ["A","B"]);
  assert.equal(request.input.allCompanies, false); assert.equal(request.input.restricted, false); assert.equal(request.input.role, "operations");
});
test("admin with no companies has no enabled invitation submission", async () => {
  await open("role=admin&empty=1"); assert.equal(await submit().isDisabled(), true); assert.deepEqual(await sent(), []);
});
test("onboarding does not silently grant restricted evidence; the owner chooses it explicitly", async () => {
  await open(); await choose("Invitation role", "onboarding"); await company("A").check();
  assert.equal(await restricted().isChecked(),false); await restricted().check();
  await submit().click(); await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  const [request] = await sent(); assert.equal(request.input.restricted, true); assert.equal(request.input.role, "onboarding");
});
test("multi-company partner access requires an explicit member identity for every company", async () => {
  await open(); await choose("Invitation role", "partner"); assert.equal(await submit().isDisabled(), true);
  await company("A").check(); await company("B").check(); assert.equal(await submit().isDisabled(), true);
  await choose("Partner member identity: Company A", "Member One"); assert.equal(await submit().isDisabled(), true);
  await choose("Partner member identity: Company B", "Member One"); await submit().click();
  await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  const [request] = await sent(); assert.equal(request.input.allCompanies, false); assert.equal(request.input.restricted, false);
  assert.deepEqual(request.input.partnerMembers, [{ companyId: "A", memberName: "Member One" },{ companyId: "B", memberName: "Member One" }]);
});
test("deselecting and reselecting a partner company requires reviewing its identity again", async () => {
  await open(); await choose("Invitation role", "partner"); await company("A").check();
  await choose("Partner member identity: Company A", "Member One"); assert.equal(await submit().isEnabled(),true);
  await company("A").uncheck(); await company("A").check(); assert.equal(await submit().isDisabled(), true);
});
test("an owner-to-admin access refresh discards the previous elevated form", async () => {
  await open(); await choose("Invitation role", "onboarding"); await restricted().check(); await allCompanies().check();
  await page.evaluate(() => window.setInvitationRole("admin"));
  await page.waitForFunction(() => document.querySelector('[aria-label="Invitation role"]').textContent.includes('operations'));
  assert.equal(await page.getByLabel("Invitation email", { exact: true }).inputValue(), "");
  assert.equal(await submit().isDisabled(), true);
  await page.getByLabel("Invitation email", { exact: true }).fill("staff@example.test"); await company("A").check(); await submit().click();
  await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  const [request] = await sent(); assert.equal(request.input.role, "operations"); assert.equal(request.input.restricted, false); assert.equal(request.input.allCompanies, false);
});
test("editing preserves the immutable address and submits the observed version with updated company scope", async () => {
  await open(); await showInvitations([pending()]); await inviteRow("onboarding@example.test").getByRole("button", {name:"Edit invitation"}).click();
  assert.equal(await page.getByLabel("Invitation email", {exact:true}).isDisabled(),true);
  assert.equal(await company("A").isChecked(),true); assert.equal(await company("B").isChecked(),true);
  await company("B").uncheck(); await restricted().uncheck(); await page.getByRole("button", {name:"Save invitation changes"}).click();
  await page.waitForFunction(() => window.invitationRequests.some(r => r.path === '/members/invite'));
  const [request] = await sent(); assert.equal(request.input.invitationId,"one"); assert.equal(request.input.expectedVersion,4);
  assert.deepEqual(request.input.companyIds,["A"]); assert.equal(request.input.email,"onboarding@example.test"); assert.equal(request.input.restricted,false); assert.equal(request.input.requestId,undefined);
});
test("cancel and renew submit fresh observed versions and never claim an email was sent", async () => {
  await open(); await showInvitations([pending()]); const row=inviteRow("onboarding@example.test");
  await row.getByRole("button", {name:"Cancel invitation"}).click(); await row.getByText(/Canceled/).first().waitFor();
  await row.getByRole("button", {name:"Renew invitation"}).click(); await row.getByText(/Awaiting verified sign-in/).waitFor();
  const requests=await page.evaluate(()=>window.invitationRequests.filter(r=>r.path.startsWith('/members/invitations/')));
  assert.deepEqual(requests.map(r=>[r.path,r.input.expectedVersion]),[["/members/invitations/cancel",4],["/members/invitations/reissue",5]]);
  await page.getByText(/No email sent/).waitFor();
});
test("an admin cannot edit, cancel or renew an elevated owner-prepared invitation", async () => {
  await open("role=admin"); await showInvitations([pending()]);
  assert.equal(await inviteRow("onboarding@example.test").getByRole("button").count(),0);
});
test("a successful change followed by failed refresh is reported as saved and prevents another mutation", async () => {
  await open(); await company("A").check(); await page.evaluate(()=>{window.failRefresh=true;});
  await submit().click(); await page.getByText(/Change saved; refresh failed/).waitFor();
  assert.equal(await page.getByLabel("Invitation email",{exact:true}).inputValue(),"");
  assert.equal(await submit().isDisabled(),true); assert.equal((await sent()).length,1);
  await page.evaluate(()=>{window.failRefresh=false;window.directoryError=null;});
  await page.getByRole("button",{name:"Refresh",exact:true}).click();
  await page.getByRole("alert").waitFor({state:"hidden"});
});
test("an unchanged transport retry reuses its request ID; changed access gets a new request ID", async () => {
  await open(); await company("A").check(); await page.evaluate(()=>{window.invitationError='Connection interrupted';});
  await submit().click(); await page.getByText('Connection interrupted',{exact:true}).waitFor();
  await submit().click(); await page.waitForFunction(()=>window.invitationRequests.filter(r=>r.path==='/members/invite').length===2);
  let requests=await sent(); assert.equal(requests[0].input.requestId,requests[1].input.requestId);
  await company("B").check(); await submit().click(); await page.waitForFunction(()=>window.invitationRequests.filter(r=>r.path==='/members/invite').length===3);
  requests=await sent(); assert.notEqual(requests[2].input.requestId,requests[1].input.requestId);
});
test("switching accounts discards the form and ignores a late directory response", async () => {
  await open(); await company("A").check();
  await page.evaluate(value=>{window.pendingInvitations=[value];window.holdNextDirectory=true;},pending());
  await page.getByRole("button",{name:"Refresh",exact:true}).click(); await page.waitForFunction(()=>!!window.releaseDirectory);
  await page.evaluate(()=>{window.pendingInvitations=[];window.setInvitationIdentity('different-account');});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Invitation email"]').value==='');
  await page.getByText("No access invitations prepared.",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("Invitation email",{exact:true}).inputValue(),"");
  await page.evaluate(()=>window.releaseDirectory()); await page.waitForFunction(()=>!document.body.textContent.includes('onboarding@example.test'));
  assert.equal(await company("A").isChecked(),false);
});
test("switching workspaces while saving suppresses the old success and does not clear the new form", async () => {
  await open(); await company("A").check(); await page.evaluate(()=>{window.holdNextMutation=true;});
  await submit().click(); await page.waitForFunction(()=>!!window.releaseMutation);
  await page.evaluate(()=>window.changeInvitationWorkspace('22222222-2222-4222-8222-222222222222'));
  await page.getByLabel("Invitation email",{exact:true}).fill("new-workspace@example.test");
  await page.evaluate(()=>window.releaseMutation());
  assert.equal(await page.getByLabel("Invitation email",{exact:true}).inputValue(),"new-workspace@example.test");
  assert.equal(await page.getByText(/Access invitation prepared; no email sent/).count(),0);
});
test("a stale invitation edit keeps the reviewed draft and shows the conflict instead of claiming success", async () => {
  await open(); await showInvitations([pending()]);
  await inviteRow("onboarding@example.test").getByRole("button",{name:"Edit invitation"}).click();
  await company("B").uncheck();
  await page.evaluate(()=>{window.invitationError='This invitation changed. Refresh before trying again.';});
  await page.getByRole("button",{name:"Save invitation changes"}).click();
  await page.getByText('This invitation changed. Refresh before trying again.',{exact:true}).waitFor();
  assert.equal(await company("B").isChecked(),false);
  assert.equal(await page.getByLabel("Invitation email",{exact:true}).inputValue(),"onboarding@example.test");
  assert.equal(await page.getByRole("button",{name:"Save invitation changes"}).count(),1);
});
test("an unknown expiration does not pretend access is pending and cannot be edited", async () => {
  await open(); await showInvitations([pending({expires_at:"invalid"})]);
  const row=inviteRow("onboarding@example.test");
  assert.match(await row.innerText(),/Expiration unavailable/);
  assert.equal(await row.getByRole("button",{name:"Edit invitation"}).count(),0);
});
const emailRequests = () => page.evaluate(()=>window.invitationRequests.filter(r=>r.path==='/members/invitations/send'));
async function readyToSend(overrides={}) {
  await open(); await page.evaluate(()=>{window.emailDeliveryEnabled=true;});
  await showInvitations([pending({delivery_status:'not_sent',...overrides})]);
  return inviteRow("onboarding@example.test");
}
test("delivery remains disabled until owner configuration; preparing access does not send", async () => {
  await open(); await showInvitations([pending()]);
  await page.getByText('Email delivery needs owner setup; access preparation still works.',{exact:true}).waitFor();
  assert.equal(await inviteRow("onboarding@example.test").getByRole("button",{name:"Send setup email"}).isDisabled(),true);
  await company("A").check(); await submit().click();
  await page.getByText("Access invitation prepared; no email sent. Share account setup and sign-in instructions separately.",{exact:true}).waitFor();
  assert.equal((await emailRequests()).length,0);
});
test("explicit setup email send uses invitation version and reports provider acceptance without claiming inbox delivery", async () => {
  const row=await readyToSend(); await row.getByRole("button",{name:"Send setup email"}).click();
  await row.getByText('Email accepted by the provider. Delivery to the inbox is not confirmed.',{exact:false}).waitFor();
  const [request]=await emailRequests(); assert.equal(request.input.invitationId,'one'); assert.equal(request.input.expectedVersion,4); assert.match(request.input.requestId,/^[a-f0-9-]{36}$/);
  assert.equal(await row.getByRole("button",{name:"Send setup email"}).count(),0);
});
test("email transport uncertainty reuses the same attempt when checking delivery", async () => {
  const row=await readyToSend(); await page.evaluate(()=>{window.invitationError='Connection interrupted';});
  await row.getByRole("button",{name:"Send setup email"}).click();
  await row.getByText(/The previous email request could not be confirmed/).waitFor();
  await page.evaluate(()=>{window.invitationError=null;});
  await row.getByRole("button",{name:"Retry previous email request"}).click();
  await row.getByText('Email accepted by the provider. Delivery to the inbox is not confirmed.',{exact:false}).waitFor();
  const requests=await emailRequests(); assert.equal(requests.length,2); assert.equal(requests[0].input.requestId,requests[1].input.requestId);
});
test("an unrecorded provider outcome warns and checks the same attempt even while the ledger says sending", async () => {
  const row=await readyToSend();
  await page.evaluate(()=>{window.deliveryResult={id:'one',status:'sent',recorded:false,message:'Provider accepted the email, but the delivery record could not be saved.'};});
  await row.getByRole("button",{name:"Send setup email"}).click();
  await row.getByText(/The delivery record has not been confirmed/).waitFor();
  assert.equal(await row.getByRole("button",{name:"Retry previous email request"}).isEnabled(),true);
  await page.evaluate(()=>{window.deliveryResult=null;});
  await row.getByRole("button",{name:"Retry previous email request"}).click();
  await row.getByText('Email accepted by the provider. Delivery to the inbox is not confirmed.',{exact:false}).waitFor();
  const requests=await emailRequests(); assert.equal(requests[0].input.requestId,requests[1].input.requestId);
});
test("a confirmed failed send requires a deliberate retry with a new request ID", async () => {
  const row=await readyToSend(); await page.evaluate(()=>{window.deliveryResult={id:'one',status:'failed',recorded:true,message:'Provider rejected this email.'};});
  await row.getByRole("button",{name:"Send setup email"}).click(); await row.getByText('Setup email failed.',{exact:false}).waitFor();
  await page.evaluate(()=>{window.deliveryResult=null;});
  await row.getByRole("button",{name:"Retry setup email"}).click();
  await row.getByText('Email accepted by the provider. Delivery to the inbox is not confirmed.',{exact:false}).waitFor();
  const requests=await emailRequests(); assert.notEqual(requests[0].input.requestId,requests[1].input.requestId);
});
test("a confirmed unknown outcome warns that a retry could duplicate the email", async () => {
  const row=await readyToSend(); await page.evaluate(()=>{window.deliveryResult={id:'one',status:'unknown',recorded:true,message:'Provider outcome is unknown.'};});
  await row.getByRole("button",{name:"Send setup email"}).click();
  await row.getByText(/a retry may send another email/).waitFor();
  assert.equal(await row.getByRole("button",{name:"Retry setup email"}).isEnabled(),true);
});
test("a sending record without a local attempt cannot trigger another delivery", async () => {
  const row=await readyToSend({delivery_status:'sending'});
  await row.getByText(/Email delivery is pending/).waitFor();
  assert.equal(await row.getByRole("button",{name:"Send setup email"}).isDisabled(),true);
  assert.equal((await emailRequests()).length,0);
});
test("provider response followed by directory failure does not imply an email send failed", async () => {
  const row=await readyToSend(); await page.evaluate(()=>{window.failRefresh=true;});
  await row.getByRole("button",{name:"Send setup email"}).click();
  await page.getByText(/Email response received; refresh failed/).waitFor();
  await row.getByText('Email accepted by the provider. Inbox delivery is not confirmed.',{exact:true}).waitFor();
  assert.equal((await emailRequests()).length,1);
});
test("an HTTP cooldown rejection never becomes a misleading status-check action", async () => {
  const row=await readyToSend({delivery_status:'failed'});
  await page.evaluate(()=>{window.invitationError='A setup email was recently requested. Refresh its status before retrying';window.invitationErrorStatus=409;});
  await row.getByRole("button",{name:"Retry setup email",exact:true}).click();
  await page.getByText('A setup email was recently requested. Refresh its status before retrying',{exact:true}).waitFor();
  assert.equal(await row.getByRole("button",{name:"Retry previous email request",exact:true}).count(),0);
  assert.equal(await row.getByText(/could not be confirmed/).count(),0);
  await page.evaluate(()=>{window.invitationError=null;window.invitationErrorStatus=null;});
  await row.getByRole("button",{name:"Retry setup email",exact:true}).click();
  await row.getByText('Email accepted by the provider. Delivery to the inbox is not confirmed.',{exact:false}).waitFor();
  const requests=await emailRequests(); assert.equal(requests.length,2); assert.notEqual(requests[0].input.requestId,requests[1].input.requestId);
});
test("an explicit email configuration rejection retains its actual error and disables delivery after refresh", async () => {
  const row=await readyToSend();
  await page.evaluate(()=>{window.invitationError='Email delivery needs owner setup. The access invitation can still be prepared.';window.invitationErrorStatus=503;window.emailDeliveryEnabled=false;});
  await row.getByRole("button",{name:"Send setup email",exact:true}).click();
  await page.getByText('Email delivery needs owner setup. The access invitation can still be prepared.',{exact:true}).waitFor();
  await page.getByText('Email delivery needs owner setup; access preparation still works.',{exact:true}).waitFor();
  assert.equal(await row.getByRole("button",{name:"Send setup email",exact:true}).isDisabled(),true);
  assert.equal(await row.getByRole("button",{name:"Retry previous email request",exact:true}).count(),0);
});

test("a revised invitation without a current send does not erase the possibility of older mail", async () => {
  const row=await readyToSend({version:5,delivery_status:'not_sent'});
  await row.getByText('No setup email sent since this invitation was last updated.',{exact:true}).waitFor();
  assert.equal(await row.getByText('No setup email sent from this app.',{exact:true}).count(),0);
});
