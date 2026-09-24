// Real Production overview with synthetic workspace records and navigation spies.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [];
before(async () => {
  const bundle = await build({ absWorkingDir: web, outfile: "production-overview-fixture.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {Overview} from './components/title/overview';
      window.overviewActions=[];
      createRoot(document.getElementById('root')).render(<Overview title="Production overview" navigate={page=>window.overviewActions.push({page})} newOrder={()=>window.overviewActions.push({newOrder:true})} openOrder={id=>window.overviewActions.push({order:id})} openCompany={id=>window.overviewActions.push({company:id})}/>);
    ` },
    plugins: [{ name: "production-overview-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {createSeed} from './lib/title/model';
        const q=new URLSearchParams(location.search),s=createSeed(),role=q.get('role')||'operations';
        s.companies=q.has('empty')?[]:s.companies.slice(0,1).map(company=>({...company,id:'cedar',name:'Cedar Title',stage:'Active',contact:role==='operations'?'':'Test Contact',jurisdiction:'NC'}));
        s.orders=q.has('file')&&!q.has('empty')?[{...s.orders[0],id:'cedar-file',companyId:'cedar',address:'110 Cedar Lane',status:'Needs review'}]:[];
        s.tasks=[];s.activity=[];s.inbox=[];s.documents=[];
        s.business={onboarding:[],credentials:[],closes:[],handoffs:[],policies:[],commitments:[],cpls:[],followups:[],corrections:[]};
        const connection={workspaceId:'fictional-workspace',access:{role,userId:'fictional-user',allCompanies:!q.has('scoped'),companyIds:s.companies.map(company=>company.id),version:1,restricted:false},revision:1};
        export const useWorkspace=()=>({s,connection});
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents); }
    else if (path === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".css")).contents); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:24px;font:14px Arial}button{font:inherit;cursor:pointer}button:disabled{cursor:default}button svg{width:16px}.panel{border:1px solid #ddd;border-radius:14px;margin-bottom:20px;padding:20px}.section-heading{display:flex;justify-content:space-between}.metrics{display:flex;gap:24px}.metric strong,.metric small{display:block}.company-line{display:flex;gap:12px}.company-line .grow{display:grid;gap:6px}.page-heading{margin-bottom:24px}.page-heading h1{font-size:28px}.page-heading button{padding:8px}.empty-state{padding:20px;color:#61748a}.status{padding:4px 8px;font-size:11px}.activity-list{min-height:30px}:root{--muted-foreground:#60748b;--brand-accent:#396b97}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });
async function open(query = "") {
  errors = []; context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(3000);
  await context.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : (errors.push("Unexpected external request"), route.abort()));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/?${query}`); await page.getByRole("heading", { name: "Production overview", exact: true }).waitFor();
}
const setup = () => page.getByRole("region", { name: "Start your first title file", exact: true });
const forbiddenSetup = /onboarding|application|add (a )?company|assign team access|confirm team access|sign-in instructions/i;

for (const role of ["owner", "operations"]) {
  test(`${role} starts with company, request and title-file actions without agency or team setup`, async () => {
    await open(`role=${role}`);
    assert.deepEqual(await setup().getByRole("heading", { level: 3 }).allTextContents(), ["Choose a company", "Read the request", "Create the title file"]);
    assert.doesNotMatch(await setup().innerText(), forbiddenSetup);
    assert.equal(await setup().getByRole("button", { name: /settings|account|team/i }).count(), 0);
    await setup().getByRole("button", { name: "Company directory", exact: true }).click();
    await setup().getByRole("button", { name: "Open inbox", exact: true }).click();
    await setup().getByRole("button", { name: "New order", exact: true }).click();
    await page.getByRole("button").filter({ hasText: "Cedar Title" }).click();
    assert.deepEqual(await page.evaluate(() => window.overviewActions), [{ page: "Companies" }, { page: "Inbox" }, { newOrder: true }, { company: "cedar" }]);
    if (role === "operations") {
      assert.equal(await page.getByRole("button", { name: "View all", exact: true }).count(), 0);
      assert.equal(await page.locator(".company-line small").innerText(), "NC");
    } else {
      await page.getByRole("button", { name: "View all", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.overviewActions.at(-1)), { page: "Settings" });
    }
  });
}

for (const role of ["owner", "operations"]) {
  test(`${role} with no companies gets an access state without company creation or usable file actions`, async () => {
    await open(`role=${role}&empty=1`);
    const empty = page.getByRole("region", { name: "Company access needed", exact: true });
    await empty.waitFor(); assert.doesNotMatch(await page.locator("body").innerText(), /Add (a )?company|onboarding evidence|Assign team access/i);
    for (const name of ["Company directory", "Open inbox", "New order"]) assert.equal(await empty.getByRole("button", { name, exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.overviewActions), []);
  });
}

test("read-only staff retain request navigation without title creation or staff settings actions", async () => {
  await open("role=viewer");
  assert.equal(await page.getByRole("button", { name: "New order", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "View all", exact: true }).count(), 0);
  await setup().getByRole("button", { name: "Open inbox", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.overviewActions), [{ page: "Inbox" }]);
});

test("an existing title file removes the first-run panel and still opens the review file directly", async () => {
  await open("file=1");
  assert.equal(await setup().count(), 0);
  await page.getByRole("button").filter({ hasText: "110 Cedar Lane" }).click();
  assert.deepEqual(await page.evaluate(() => window.overviewActions), [{ order: "cedar-file" }]);
});
