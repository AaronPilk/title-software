// Real financial and close components with synthetic records and in-memory transport only.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let browser, server, context, page, origin;
let errors = [];

before(async () => {
  const bundle = await build({
    absWorkingDir: web, outfile: "financial-review-fixture.mjs", write: false,
    bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Financials} from './components/title/financials';
      import {CloseWorkspace} from './components/title/close-suite';
      const standalone=new URLSearchParams(location.search).has('standalone');
      createRoot(document.getElementById('root')).render(standalone?<CloseWorkspace/>:<Financials/>);
    ` },
    plugins: [{ name: "synthetic-financial-workspace", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: web, contents: args.path === "client" ? `
        export const activeWorkspace=()=> 'synthetic-financial-workspace';
        export async function backendRequest(){throw Error('Unexpected synthetic API request');}
      ` : `
        import {useSyncExternalStore} from 'react';
        import {createSeed} from './lib/title/model';
        const listeners=new Set();
        const state=createSeed();
        state.user='finance@example.test';
        state.companies=[{...state.companies[0],name:'Synthetic Review Title',members:[{name:'Synthetic Member',share:100}]}];
        state.orders=[
          {...state.orders[0],id:'issued-current',companyId:state.companies[0].id,status:'Issued',month:'2027-01',premium:1000,rate:0.2,underwriter:'Synthetic Underwriter'},
          {...state.orders[0],id:'issued-prior',companyId:state.companies[0].id,status:'Issued',month:'2026-08',premium:800,rate:0.2,underwriter:'Synthetic Underwriter'}
        ];
        state.business.policies=[];state.business.closes=[];state.ownershipHistory=[];
        state.expenses={};state.approvedReports=[];state.tasks=[];
        let snapshot={s:state,connection:{access:{role:'finance',userId:'synthetic-finance-user',email:'finance@example.test',allCompanies:true,restricted:true},revision:1}};
        const emit=()=>listeners.forEach(fn=>fn());
        window.financialUpdates=[];window.financialDownloads=[];
        window.financialState=()=>structuredClone(snapshot.s);
        window.changeFinancialSource=kind=>{
          const next=structuredClone(snapshot.s);
          if(kind==='premium')next.orders[0].premium+=100;
          else if(kind==='expenses')next.expenses['2027-01:'+next.companies[0].id]=50;
          else if(kind==='ownership')next.companies[0].members=[{name:'Synthetic Member',share:60},{name:'Second Synthetic Member',share:40}];
          else next.tasks.push({id:'unrelated',title:'Unrelated synthetic task'});
          snapshot={...snapshot,s:next};emit();
        };
        export function useWorkspace(){
          const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);
          return {...current,update:async(fn,title,detail)=>{
            const next=structuredClone(snapshot.s);fn(next);snapshot={...snapshot,s:next};
            window.financialUpdates.push({title,detail});emit();return true;
          }};
        }
        export const download=(name,value)=>window.financialDownloads.push({name,value});
        export const exportCsv=download;
      ` }));
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
  errors = []; context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(4000);
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    return route.continue();
  });
  await page.clock.setFixedTime(new Date("2027-02-01T02:30:00Z"));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);
  await page.getByLabel(query ? "Close reporting month" : "Reporting month", { exact: true }).waitFor();
}
const button = name => page.getByRole("button", { name, exact: true });
const tab = name => page.getByRole("tab", { name, exact: true });
const reviewedChecks = () => page.locator(".close-card").getByRole("checkbox");
async function checkAll() {
  for (const checkbox of await reviewedChecks().all()) await checkbox.check();
}

test("choosing a prior reporting month carries through to the created company close", async () => {
  await open();
  await page.getByLabel("Reporting month", { exact: true }).fill("2026-08");
  await tab("Company closes").click();
  assert.equal(await page.getByLabel("Close reporting month", { exact: true }).inputValue(), "2026-08");
  await button("New close revision").click();
  await page.waitForFunction(() => window.financialState().business.closes.length === 1);
  const [close] = await page.evaluate(() => window.financialState().business.closes);
  assert.equal(close.month, "2026-08");
  assert.deepEqual(close.rows.map(row => [row.id, row.premium]), [["issued-prior", 800]]);
});

test("changing either financial month selector keeps close creation and report export on the same period", async () => {
  await open(); await tab("Company closes").click();
  await page.getByLabel("Close reporting month", { exact: true }).fill("2026-08");
  assert.equal(await page.getByLabel("Reporting month", { exact: true }).inputValue(), "2026-08");
  await button("Export report").click();
  assert.equal((await page.evaluate(() => window.financialDownloads))[0].name, "titleos-2026-08-draft-report.csv");
  await page.getByLabel("Reporting month", { exact: true }).fill("2027-01");
  assert.equal(await page.getByLabel("Close reporting month", { exact: true }).inputValue(), "2027-01");
  await tab("Overview").click(); await tab("Company closes").click();
  assert.equal(await page.getByLabel("Close reporting month", { exact: true }).inputValue(), "2027-01");
  await button("New close revision").click();
  await page.waitForFunction(() => window.financialState().business.closes.length === 1);
  assert.equal((await page.evaluate(() => window.financialState().business.closes))[0].month, "2027-01");
});

for (const source of ["premium", "expenses", "ownership"]) test(`${source} changes require fresh month-end checks before the changed report can be confirmed`, async () => {
  await open(); await checkAll(); await button("Confirm month-end review").click();
  await button("Month-end review confirmed").waitFor();
  await page.evaluate(kind => window.changeFinancialSource(kind), source);
  await button("Confirm month-end review").waitFor();
  assert.equal(await button("Confirm month-end review").isDisabled(), true);
  for (const checkbox of await reviewedChecks().all()) assert.equal(await checkbox.isChecked(), false);
  assert.equal((await page.evaluate(() => window.financialState().approvedReports)).length, 1);
  await checkAll(); await button("Confirm month-end review").click();
  await button("Month-end review confirmed").waitFor();
  assert.equal((await page.evaluate(() => window.financialState().approvedReports)).length, 2);
});

test("unrelated workspace updates retain checks, while a new month requires its own review", async () => {
  await open(); await checkAll();
  await page.evaluate(() => window.changeFinancialSource("task"));
  for (const checkbox of await reviewedChecks().all()) assert.equal(await checkbox.isChecked(), true);
  assert.equal(await button("Confirm month-end review").isEnabled(), true);
  await page.getByLabel("Reporting month", { exact: true }).fill("2026-08");
  for (const checkbox of await reviewedChecks().all()) assert.equal(await checkbox.isChecked(), false);
  assert.equal(await button("Confirm month-end review").isDisabled(), true);
});

test("a standalone close keeps its Eastern reporting month and accepts a prior period", async () => {
  await open("standalone=1");
  assert.equal(await page.getByLabel("Close reporting month", { exact: true }).inputValue(), "2027-01");
  await page.getByLabel("Close reporting month", { exact: true }).fill("2026-08");
  await button("New close revision").click();
  await page.waitForFunction(() => window.financialState().business.closes.length === 1);
  assert.equal((await page.evaluate(() => window.financialState().business.closes))[0].month, "2026-08");
});
