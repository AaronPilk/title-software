// Real React/Radix help widget and bundled help catalog. Transport and identity
// are fictional; browser traffic outside this fixture is denied.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [], external = [];
const fixture = `
import React,{useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './components/ui/dialog';
import {HelpUIContext} from './lib/assistant/help-ui-context';
import {helpGuides} from './lib/assistant/help-guides';
import {HelpAgent} from './components/title/help-agent';
const initial={userId:'user-one',email:'one@example.test',role:'owner',version:1,workspaceId:'workspace-one',page:'Companies',view:'agency',connected:true,surface:'page'};
let state={...initial};
window.helpRequests=[];window.helpPending=[];window.helpThreads={};window.helpSources=null;window.helpFail='';window.helpFailSend='';window.helpHold=false;window.helpCommitThenFail=false;window.helpProviderFail=false;window.helpNavigation=[];
window.changeHelp=value=>{state={...state,...value};window.dispatchEvent(new Event('help-context'))};
export function useWorkspace(){const[value,setValue]=useState(state);useEffect(()=>{const handler=()=>setValue({...state});window.addEventListener('help-context',handler);return()=>window.removeEventListener('help-context',handler)},[]);return {s:{companies:[],orders:[]},connection:value.connected?{workspaceId:value.workspaceId,access:{userId:value.userId,email:value.email,role:value.role,version:value.version}}:undefined};}
export class AssistantClientError extends Error {constructor(message,status=0){super(message);this.status=status;}}
const key=value=>value.workspaceId+':'+value.userId+':'+value.version;
function response(value){return {threads:structuredClone(window.helpThreads[key(value)]||[]),context:{userId:value.userId,workspaceId:value.workspaceId,companyId:'',orderId:'',accessVersion:value.version,revision:1,companyName:'Product help',role:value.role,sources:window.helpSources||helpGuides(value.role).map(g=>({id:g.id,label:g.title,page:g.page,facts:{}})),readableSourceIds:[],truncated:false},model:'test-guide',remaining:20};}
export async function assistantRequest(input,scope,signal){const actor={...state};const request={input:structuredClone(input),scope:structuredClone(scope),actor,aborted:false};window.helpRequests.push(request);signal.addEventListener('abort',()=>request.aborted=true,{once:true});
  if(window.helpFail)throw new AssistantClientError(window.helpFail,window.helpFailStatus||503);
  if(input.action==='send'){
    const threads=window.helpThreads[key(actor)]||=[];let thread=threads.find(t=>t.id===input.threadId)||threads.find(t=>t.turns.some(turn=>turn.id===input.requestId));
    if(!thread){thread={id:'thread-'+input.requestId,title:input.question,companyId:'',orderId:'',accessVersion:actor.version,sourceIds:['help:company-profile'],turns:[]};threads.unshift(thread);}
    if(!thread.turns.some(turn=>turn.id===input.requestId))thread.turns.push({id:input.requestId,question:input.question,createdAt:'2026-09-23T12:00:00Z',revision:1,forks:[{id:'guide-'+input.requestId,specialist:'Product guide',status:window.helpRunning?'Running':window.helpProviderFail?'Failed':'Complete',error:window.helpProviderFail?'Guide temporarily unavailable.':undefined,result:window.helpProviderFail?undefined:{summary:window.helpSummary||'Start in Companies and choose your company.',findings:[{text:'Open the company profile and review the original records.',sourceIds:window.helpFindingIds||['help:company-profile']}],nextStep:'Choose Documents in the company.'}}]});
    if(window.helpCommitThenFail)throw new DOMException('The reply was lost.','TimeoutError');
    if(window.helpFailSend)throw new AssistantClientError(window.helpFailSend,503);
  }
  if(input.action==='delete')window.helpThreads[key(actor)]=(window.helpThreads[key(actor)]||[]).filter(t=>t.id!==input.threadId);
  const result=response(actor);if(window.helpHold){window.helpHold=false;return new Promise(resolve=>window.helpPending.push(()=>resolve(result)));}return result;
}
export function Fixture(){const[value,setValue]=useState(state);const[open,setOpen]=useState(false);const[modal,setModal]=useState(false);useEffect(()=>{const handler=()=>{setValue({...state});setOpen(false)};window.addEventListener('help-context',handler);return()=>window.removeEventListener('help-context',handler)},[]);return <HelpUIContext.Provider value={()=>setOpen(true)}><button onClick={()=>setModal(true)}>Open company form</button><Dialog open={modal} onOpenChange={setModal}><DialogContent style={{position:'fixed',inset:'15% 10%',zIndex:50,background:'white'}}><DialogHeader><DialogTitle>Company form</DialogTitle><DialogDescription>Fictional company edit</DialogDescription></DialogHeader><label>Company draft<input aria-label='Company draft' defaultValue='Unfinished edits'/></label></DialogContent></Dialog><HelpAgent screen={{page:value.page,view:value.view,surface:modal?'company':value.surface}} open={open} onOpenChange={setOpen} hideLauncher={modal} navigate={page=>window.helpNavigation.push(page)}/></HelpUIContext.Provider>;}
`;
before(async () => {
  if (process.env.HELP_UI_SCREENSHOT_DIR) await mkdir(process.env.HELP_UI_SCREENSHOT_DIR, { recursive: true });
  const result = await build({ absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", outfile: "/help/app.mjs", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    stdin: { resolveDir: root, loader: "tsx", contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {Fixture} from 'help-fixture';createRoot(document.getElementById('root')).render(<Fixture/>);" },
    plugins: [{ name: "help-transport", setup(builder) {
      builder.onResolve({ filter: /^(help-fixture|@\/lib\/title\/store|@\/lib\/assistant\/client)$/ }, () => ({ path: "help-fixture", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: fixture, loader: "tsx", resolveDir: root }));
    }}] });
  const js = result.outputFiles.find(f => f.path.endsWith(".mjs")), css = result.outputFiles.find(f => f.path.endsWith(".css"));
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("content-type", path === "/app.mjs" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    response.end(path === "/app.mjs" ? js.text : path === "/app.css" ? css.text : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(options = {}) {
  errors = []; external = []; context = await browser.newContext({ viewport: options.mobile ? { width: 320, height: 568 } : { width: 1200, height: 900 } });
  await context.route("**/*", route => { if (route.request().url().startsWith(origin + "/")) return route.continue(); external.push(route.request().url()); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message)); await page.goto(origin);
  if (options.identity) await page.evaluate(value => window.changeHelp(value), options.identity);
  if (options.before) await page.evaluate(options.before);
  await page.getByRole("button", { name: "Ask for help", exact: true }).click();
  if (options.identity?.connected !== false) await page.waitForFunction(() => window.helpRequests.length > 0);
}
const question = () => page.getByLabel("Your question", { exact: true });
const ask = () => page.getByRole("button", { name: "Ask guide", exact: true });
const sends = () => page.evaluate(() => window.helpRequests.filter(item => item.input.action === "send"));
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test("works without any companies and sends only guide purpose, screen and authenticated identity", async () => {
  await open({ before: () => { window.helpSources = [{ id: "help:company-profile", page: "https://evil.example/", label: "Forged page", facts: {} }]; } }); await question().fill("How do I upload company documents?"); await ask().click(); await page.getByText("Start in Companies and choose your company.", { exact: true }).waitFor();
  const requests = await sends(); assert.equal(requests.length, 1); assert.equal(requests[0].input.purpose, "help"); assert.deepEqual(requests[0].input.specialists, ["Product guide"]);
  assert.deepEqual(requests[0].input.screen, { page: "Companies", view: "agency", surface: "page" });
  assert.deepEqual(requests[0].scope, { companyId: "", orderId: "", userId: "user-one", workspaceId: "workspace-one", accessVersion: 1 });
  await page.getByRole("button", { name: "Complete an imported company profile", exact: true }).last().click();
  assert.deepEqual(await page.evaluate(() => window.helpNavigation), ["Companies"]);
});

test("local workspace has complete quick guides without calling the AI service", async () => {
  await open({ identity: { connected: false } });
  await page.getByRole("button", { name: "Complete an imported company profile", exact: true }).click();
  await page.getByRole("article", { name: "Complete an imported company profile" }).waitFor();
  assert.match(await page.getByRole("article").innerText(), /Save company profile/); assert.equal(await question().count(), 0); assert.equal(await page.evaluate(() => window.helpRequests.length), 0);
});

test("lost send response retains text and retries the identical request without duplicate history", async () => {
  await open({ before: () => { window.helpCommitThenFail = true; } }); await question().fill("My document question"); await ask().click(); await page.getByRole("alert").waitFor();
  assert.equal(await question().inputValue(), "My document question");
  await page.evaluate(() => { window.helpCommitThenFail = false; }); await page.getByRole("button", { name: "Retry same question" }).click();
  await page.getByText("Start in Companies and choose your company.", { exact: true }).waitFor(); const requests = await sends(); assert.equal(requests[0].input.requestId, requests[1].input.requestId);
  assert.equal(await page.evaluate(() => Object.values(window.helpThreads)[0][0].turns.length), 1); assert.equal(await question().inputValue(), "");
});

test("provider failure is truthful and quick guide steps remain usable", async () => {
  await open({ before: () => { window.helpProviderFail = true; } }); await question().fill("How do I upload?"); await ask().click();
  await page.getByText(/Guide temporarily unavailable/).waitFor(); assert.equal(await page.getByText("Start in Companies and choose your company.").count(), 0);
  await page.getByRole("button", { name: "Complete an imported company profile", exact: true }).click(); await page.getByRole("article", { name: "Complete an imported company profile" }).waitFor();
  await page.getByRole("button", { name: "Try this question again" }).click(); assert.equal(await question().inputValue(), "How do I upload?");
});

test("closed help preserves a draft and nested help leaves company edits intact with restored focus", async () => {
  await open(); await question().fill("Keep my unsent question"); await page.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "Ask for help", exact: true }).click(); assert.equal(await question().inputValue(), "Keep my unsent question");
  await page.getByRole("button", { name: "Close help" }).click(); await page.getByRole("button", { name: "Open company form" }).click();
  await page.getByLabel("Company draft").fill("Draft that must survive"); await page.getByRole("button", { name: "Ask for help", exact: true }).click();
  await question().waitFor(); await page.keyboard.press("Escape"); await page.getByLabel("Company draft").waitFor(); assert.equal(await page.getByLabel("Company draft").inputValue(), "Draft that must survive");
  await page.waitForFunction(() => document.activeElement?.textContent === 'Ask for help');
});

test("account, workspace, access version and screen changes abort stale responses", async () => {
  await open();
  for (const change of [{ userId: "user-two" }, { workspaceId: "workspace-two" }, { version: 2 }, { page: "Documents" }]) {
    await question().fill("Old actor question " + JSON.stringify(change)); await page.evaluate(() => { window.helpHold = true; }); await ask().click(); await page.waitForFunction(() => window.helpPending.length === 1);
    await page.evaluate(value => window.changeHelp(value), change);
    await page.waitForFunction(() => window.helpRequests.filter(item => item.input.action === "send").at(-1).aborted);
    await page.getByRole("button", { name: "Ask for help", exact: true }).click(); await question().fill("Current actor draft");
    await page.evaluate(() => window.helpPending.shift()()); await settle(); assert.equal(await question().inputValue(), "Current actor draft");
  }
});

test("source links use the role-filtered catalog and never model URLs or unknown IDs", async () => {
  await open({ identity: { role: "partner", page: "Partner portal", view: "partner" }, before: () => {
    window.helpSources = [{ id: 'help:company-profile', page: 'Companies', label: 'Stolen company context', facts:{} }, {id:'attacker',page:'https://evil.example/',label:'Unsafe destination',facts:{}}];
    window.helpFindingIds = ['help:company-profile', 'attacker']; window.helpSummary = '<img src=x onerror="window.helpXss=true">';
  }});
  await question().fill("Help me get started"); await ask().click(); await page.getByText('<img src=x onerror="window.helpXss=true">', { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Stolen company context|Unsafe destination|Complete an imported company profile/ }).count(), 0);
  assert.equal(await page.locator("img,script:not([type=module])").count(), 0); assert.deepEqual(await page.evaluate(() => window.helpNavigation), []);
  assert.equal(await page.getByRole("button", { name: "Open Companies" }).count(), 0);
});

test("320px dialog is bounded and keyboard focus returns to launcher", async () => {
  await open({ mobile: true }); await question().fill("A short question");
  const geometry = await page.getByRole("dialog", { name: "How can I help?" }).evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, bottom: element.getBoundingClientRect().bottom, overflow: element.scrollWidth > element.clientWidth }));
  assert.ok(geometry.left >= 0 && geometry.right <= 320 && geometry.bottom <= 568); assert.equal(geometry.overflow, false);
  if (process.env.HELP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.HELP_UI_SCREENSHOT_DIR}/help-mobile.png` });
  await page.keyboard.press("Escape"); await page.waitForFunction(() => document.activeElement?.textContent === 'Ask for help');
});

test("history transport denial clears previous private answer while leaving help available", async () => {
  await open(); await question().fill("Initial question"); await ask().click(); await page.getByText("Start in Companies and choose your company.", { exact: true }).waitFor();
  await page.evaluate(() => { window.helpFail = "Access changed. Refresh your workspace."; window.helpFailStatus = 403; });
  await page.getByRole("button", { name: "Refresh help history" }).click(); await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("Start in Companies and choose your company.", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Complete an imported company profile", exact: true }).click(); await page.getByRole("article", { name: "Complete an imported company profile" }).waitFor();
});

test("deleting a conversation requires confirmation and refresh can recover an uncertain send", async () => {
  await open({ before: () => { window.helpCommitThenFail = true; } }); await question().fill("Recover this question"); await ask().click(); await page.getByRole("alert").waitFor();
  await page.evaluate(() => { window.helpCommitThenFail = false; }); await page.getByRole("button", { name: "Refresh help history" }).click(); await page.getByText("Start in Companies and choose your company.", { exact: true }).waitFor();
  assert.equal(await question().inputValue(), ""); assert.equal(await page.getByRole("button", { name: "Retry same question" }).count(), 0);
  await page.getByRole("button", { name: "Delete help conversation" }).click(); assert.equal(await page.evaluate(() => window.helpRequests.filter(item => item.input.action === 'delete').length), 0);
  await page.getByRole("button", { name: "Delete conversation", exact: true }).click(); await page.getByText("Conversation deleted.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Start in Companies and choose your company.", { exact: true }).count(), 0);
});


test("running help polls saved answers and blocks duplicate sends until it completes", async () => {
  await open({ before: () => { window.helpRunning = true; } }); await question().fill("Read the saved help"); await ask().click();
  await page.getByText("Finding the steps in the help guides…", { exact: true }).waitFor(); await question().fill("Follow-up question"); assert.equal(await ask().isDisabled(), true);
  await page.evaluate(() => { Object.values(window.helpThreads)[0][0].turns[0].forks[0].status = "Complete"; });
  await page.getByText("Start in Companies and choose your company.", { exact: true }).waitFor(); assert.equal(await ask().isDisabled(), false);
  assert.equal((await sends()).length, 1); assert.equal(await question().inputValue(), "Follow-up question");
});
