// The real Production directory against synthetic records, with all network
// traffic kept on this local fixture and no workspace/provider mutations.
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
  const bundle = await build({
    absWorkingDir: web, outfile: "production-company-fixture.mjs", write: false,
    bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {ProductionCompanyDirectory} from './components/title/production-company-directory';
      const q=new URLSearchParams(location.search);
      const company=(id,name)=>({id,name,initials:name.slice(0,2).toUpperCase(),color:'blue',contact:'Test Coordinator',email:'contact@example.test',location:'Charlotte',jurisdiction:'NC',stage:'Onboarding',steps:Array(7).fill(true),members:[{name:'PRIVATE BENEFICIAL OWNER',share:100}],intake:{subject:'PRIVATE APPLICATION'},authorizations:[{reference:'PRIVATE LICENSE'}],operatingStatus:{status:'Active',note:'PRIVATE CONFIRMATION'}});
      const order=(id,companyId,status)=>({id,companyId,status,address:id==='cedar-review'?'110 Cedar Lane':id==='oak-issued'?'220 Oak Street':'Property '+id,client:'Synthetic client',jurisdiction:'NC'});
      const companies=[company('cedar','Cedar Title'),company('oak','Oak Title'),company('birch','Birch Title')];
      if(q.has('scoped'))companies.push(company('unavailable','OUT OF SCOPE COMPANY'));
      if(q.has('withheld'))companies.forEach(c=>{c.contact='';c.email='';});
      const s={companies:q.has('empty')?[]:companies,orders:[
        order('cedar-new','cedar','New'),order('cedar-review','cedar','Needs review'),order('cedar-working','cedar','In progress'),order('cedar-issued','cedar','Issued'),order('cedar-rejected','cedar','Rejected'),
        order('oak-issued','oak','Issued'),order('OUT OF SCOPE FILE','unavailable','Needs review'),order('ORPHAN FILE','missing','New')],
        documents:[{name:'PRIVATE AGENCY DOCUMENT',companyId:'cedar'}],business:{onboarding:[{legalName:'PRIVATE LEGAL NAME'}]},user:'Tyler'};
      const access={role:q.get('role')||'owner',allCompanies:!q.has('scoped'),companyIds:q.has('empty-scope')?[]:['cedar','oak'],userId:'synthetic-user',email:'operator@example.test'};
      if(q.has('empty-scope'))access.allCompanies=false;
      window.productionFixture={s,connection:q.has('demo')?undefined:{access}};
      window.productionActions=[];
      createRoot(document.getElementById('root')).render(<ProductionCompanyDirectory
        initialCompanyId={q.get('company')||''}
        openOrder={id=>window.productionActions.push({order:id})}
        navigate={page=>window.productionActions.push({page})}
      />);
    ` },
    plugins: [{ name: "synthetic-production-workspace", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: web, contents: `
        import {useState} from 'react';
        export function useWorkspace(){
          const [fixture,setFixture]=useState(window.productionFixture);
          window.setProductionScope=companyIds=>setFixture(previous=>({...previous,connection:{access:{...previous.connection.access,allCompanies:false,companyIds}}}));
          return fixture;
        }
      ` }));
    } }],
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents); }
    else if (path === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(bundle.outputFiles.find(file => file.path.endsWith(".css")).contents); }
    else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>
        *{box-sizing:border-box}body{margin:28px;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;background:linear-gradient(125deg,#e6eff9,#f1f4fc);color:#263e58}button,input{font:inherit;color:inherit}button{border:0;cursor:pointer}svg{vertical-align:middle}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:25px}.page-heading h1{font-size:29px;letter-spacing:-.7px;margin:0 0 7px}.page-heading p{font-size:13px;color:#52677c;margin:0}.page-heading button,[data-slot=button]{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 13px;background:#f8fbff;border:1px solid #cbd8e8;border-radius:12px;font-size:12px}.company-avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#dce9f8;color:#326086;font-size:12px;font-weight:600}.company-avatar.large{width:52px;height:52px;border-radius:16px;font-size:16px}.search-box{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#f9fbfe;border:1px solid #cfdbeb;border-radius:12px}.search-box input{border:0;outline:0;width:100%;background:transparent;font-size:11px}.search-box button{background:transparent;padding:0}.status{font-size:10px;border-radius:7px;background:#e7edf4;padding:5px 8px;white-space:nowrap}.status.blue{background:#dfebfa;color:#2e638e}.status.green{background:#e0efe8;color:#3a6b57}.segment-list{display:flex;align-items:center;background:#e5edf7;padding:3px;border-radius:12px}.segment-list button{border:0;border-radius:9px;background:transparent;white-space:nowrap}.segment-list button[data-state=active]{background:#fff;box-shadow:0 1px 3px #29415815}.empty-state{text-align:center;padding:45px 20px;color:#62768c}.empty-state h3{font-size:14px;margin:13px 0 8px}.empty-state p{font-size:12px;line-height:1.65;max-width:45ch;margin:0 auto 16px}.empty-state>svg{color:#7e98b2}:root{--glass-surface:rgba(248,251,255,.76);--glass-edge:rgba(255,255,255,.9);--glass-filter:blur(22px) saturate(1.35);--glass-shadow:0 8px 32px #17375b12,inset 0 1px 0 #fff}@media(max-width:700px){body{margin:16px}.page-heading{align-items:flex-start}.page-heading h1{font-size:25px}.page-heading p{max-width:22ch;line-height:1.6}.page-heading button{white-space:nowrap}}
      </style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>`);
    }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});

afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });

async function open(query = "", viewport = { width: 1320, height: 950 }) {
  errors = [];
  context = await browser.newContext({ viewport });
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/?${query}`);
  await page.getByRole("heading", { name: "Companies", exact: true }).waitFor();
}
const directory = () => page.getByRole("complementary", { name: "Production companies", exact: true });
const files = name => page.getByRole("region", { name: `${name} title files`, exact: true });
const selectedTotals = () => page.getByLabel("Selected company file totals");
const forbiddenAgencyContent = /Add company|Import company|application|onboarding|ownership|members|licensing|PRIVATE/i;

for (const role of ["owner", "operations"]) {
  test(`${role} sees operational company data and file actions without agency fields or controls`, async () => {
    await open(`role=${role}`);
    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, forbiddenAgencyContent);
    assert.match(text, /Test Coordinator/);
    assert.equal(await page.getByRole("textbox").count(), 1);
    assert.deepEqual(await selectedTotals().locator("dd").allTextContents(), ["3", "1", "5"]);
    assert.equal(await files("Cedar Title").getByRole("button").filter({ hasText: "Cedar Lane" }).count(), 1);
    await files("Cedar Title").getByRole("button").filter({ hasText: "110 Cedar Lane" }).click();
    await page.getByRole("button", { name: "All orders", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.productionActions), [{ order: "cedar-review" }, { page: "Orders" }]);
    if (role === "owner" && process.env.PRODUCTION_DIRECTORY_SCREENSHOT) await page.screenshot({ path: process.env.PRODUCTION_DIRECTORY_SCREENSHOT, fullPage: true });
  });
}

test("assigned-company totals exclude stale unavailable companies and orphaned files", async () => {
  await open("scoped=1&role=operations&company=unavailable");
  assert.equal(await directory().getByRole("button").count(), 2);
  const totals = await page.getByLabel("Production company totals").innerText();
  assert.match(totals, /2 companies available/);
  assert.match(totals, /3 open files/);
  assert.match(totals, /Showing your assigned companies/);
  assert.doesNotMatch(await page.locator("body").innerText(), /OUT OF SCOPE|ORPHAN/);
  await page.getByRole("tab", { name: "All files", exact: true }).click();
  assert.equal(await files("Cedar Title").getByRole("button").count(), 5);
  assert.doesNotMatch(await files("Cedar Title").innerText(), /oak-issued|OUT OF SCOPE|ORPHAN/);
  assert.deepEqual(await page.evaluate(() => window.productionActions), []);
});

test("company selection stays inside Production and shows completed files when requested", async () => {
  await open("company=oak");
  await files("Oak Title").getByRole("heading", { name: "No open title files", exact: true }).waitFor();
  assert.deepEqual(await selectedTotals().locator("dd").allTextContents(), ["0", "0", "1"]);
  await page.getByRole("button", { name: "View all files", exact: true }).click();
  await files("Oak Title").getByRole("button").filter({ hasText: "220 Oak Street" }).click();
  await directory().getByRole("button").filter({ hasText: "Birch Title" }).click();
  await files("Birch Title").getByRole("heading", { name: "No title files yet", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.productionActions), [{ order: "oak-issued" }]);
  assert.doesNotMatch(await page.locator("body").innerText(), forbiddenAgencyContent);
});

test("a scope change immediately removes the prior selected company and its files", async () => {
  await open("company=cedar");
  await page.evaluate(() => window.setProductionScope(["oak"]));
  await files("Oak Title").waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /Cedar|cedar-review|Birch/);
  assert.match(await page.getByLabel("Production company totals").innerText(), /1 company available/);
  await page.evaluate(() => window.setProductionScope([]));
  await page.getByRole("heading", { name: "No companies available", exact: true }).waitFor();
  assert.equal(await page.getByRole("complementary").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.productionActions), []);
});

test("search handles no matches and restores company selection without opening a company form", async () => {
  await open();
  await page.getByRole("textbox").fill("Not a company");
  await page.getByRole("heading", { name: "No matching companies", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Selected company file totals").count(), 0);
  await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
  await files("Cedar Title").waitFor();
  await page.getByRole("textbox").fill("oak");
  await files("Oak Title").waitFor();
  assert.equal(await directory().getByRole("button").filter({ hasText: "Cedar Title" }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.productionActions), []);
});

test("withheld contact fields and an empty company scope have truthful read-only states", async () => {
  await open("withheld=1&role=operations");
  assert.doesNotMatch(await page.locator("body").innerText(), /Primary contact|Contact email|Not provided|PRIVATE/);
  assert.equal(await page.getByRole("link").count(), 0);
  await page.goto(`${origin}/?empty-scope=1&role=operations`);
  await page.getByRole("heading", { name: "No companies available", exact: true }).waitFor();
  assert.match(await page.getByLabel("Production company totals").innerText(), /0 companies available/);
  assert.doesNotMatch(await page.locator("body").innerText(), /Cedar|Oak|Birch|Add company/);
});

test("company and title-file rows remain usable on a narrow screen", async () => {
  await open("scoped=1", { width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await directory().getByRole("button").filter({ hasText: "Oak Title" }).click();
  await page.getByRole("button", { name: "View all files", exact: true }).click();
  await files("Oak Title").getByRole("button").filter({ hasText: "220 Oak Street" }).click();
  assert.deepEqual(await page.evaluate(() => window.productionActions), [{ order: "oak-issued" }]);
});
