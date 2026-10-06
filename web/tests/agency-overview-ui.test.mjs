// Real Agency overview and domain selectors, rendered against synthetic workspace data.
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
  const bundle = await build({
    absWorkingDir: web, outfile: "agency-fixture.mjs", write: false, bundle: true,
    platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AgencyOverview} from './components/title/agency-overview';
      const q=new URLSearchParams(location.search);
      const company=(id,name)=>({id,name,initials:'QT',color:'blue',contact:'Test contact',email:'qa@example.test',location:'Charlotte',jurisdiction:'NC',stage:'Active',steps:Array(7).fill(true),members:[]});
      const task=(id,companyId,title,due)=>({id,companyId,title,due,owner:'John',done:false,priority:'Normal'});
      const s={companies:q.has('empty')?[]:[company('A','Agency Test Title'),company('B','Review Test Title')],
        documents:[],orders:[],tasks:[task('late','A','Collect company materials','2026-09-20'),task('first','B','Review formation records','2026-09-10'),task('hidden','unavailable','Unavailable company task','2026-09-01')],
        business:{onboarding:[],credentials:[{companyId:'unavailable',status:'Needs review'}],closes:[],handoffs:[],policies:[],commitments:[],cpls:[],followups:[],corrections:[]},
        user:'John',activity:[],inbox:[],rules:[],revisions:[],fieldRevisions:[],replyDrafts:[],importTemplates:[],approvedReports:[],expenses:{},expansionStates:[],version:1};
      if(q.has('new'))s.companies.forEach(company=>company.stage='Onboarding');
      if(q.has('original'))s.documents.push({id:'application-original',companyId:'A',name:'Application.pdf',version:1,category:'Applications',visibility:'Restricted',assetId:'stored-original'});
      if(q.has('evidence')) {
        s.business.onboarding.push({companyId:'A',legalName:'Agency Test Title',mailingAddress:'Test address',contactEmail:'qa@example.test',secureApplicationReference:'test-app',signatureReference:'test-signature',applicationStatus:'Reviewed',applicationNote:'Reviewed fixture',requiredUnderwriters:['WFG'],evidence:[0,1,2].map(step=>({step,reference:'test-ref',note:'Fixture reviewed',reviewer:'Test reviewer',reviewedAt:'2026-09-14',documentId:step===1?'doc-v1':''})),launchedAt:''});
        s.documents.push({id:'doc-v1',companyId:'A',name:'Formation.pdf',version:1});
        if(q.has('stale'))s.documents.push({id:'doc-v2',companyId:'A',name:'Formation.pdf',version:2});
      }
      if(q.has('limited'))s.business.credentials.push({companyId:'A',status:'Needs review'});
      if(q.has('confirmed')) {
        s.companies.forEach(company=>{company.stage='Onboarding';company.steps=Array(7).fill(false);});
        s.companies[0].operatingStatus={status:'Active',confirmedBy:'owner@example.test',confirmedAt:'2026-09-23T12:00:00.000Z',note:'Confirmed existing operating business.'};
      }
      window.agencyFixture={s,connection:q.has('demo')?undefined:{access:{role:q.get('role')||'operations',allCompanies:q.has('all'),restricted:!q.has('limited'),email:'staff@example.test'}}};
      window.agencyActions=[];
      createRoot(document.getElementById('root')).render(<AgencyOverview navigate={page=>window.agencyActions.push({page})} newCompany={()=>window.agencyActions.push({newCompany:true})} openCompany={(id,tab)=>window.agencyActions.push({company:id,...(tab?{tab}:{})})}/>);
    ` },
    plugins: [{ name: "synthetic-agency-workspace", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/title\/store$/ }, () => ({ path: "workspace", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useWorkspace=()=>window.agencyFixture; export async function getAssetForDocument(){throw Error('No original requested in this fixture');}" }));
    } }],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".mjs")).contents;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).contents;
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(js); }
    else if (path === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(css); }
    else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:20px;font-family:Arial}button{background:white;border:0;color:inherit;font:inherit}h1,h2,p{margin-top:0}.panel{border:1px solid #ddd;border-radius:13px;overflow:hidden}.section-heading{display:flex;align-items:center;justify-content:space-between;padding:20px 23px}.section-heading h2{font-size:14px}.section-heading button{display:flex;align-items:center;gap:6px;font-size:11px}.section-heading button svg{width:16px}.company-avatar{flex-shrink:0;width:36px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.metric strong,.metric small{display:block}.metric svg{display:none}.status{white-space:nowrap;font-size:11px}.page-heading{margin-bottom:20px}.page-heading button svg{width:16px}:root{--brand-primary:#00305b;--brand-primary-50:#e8eef5;--brand-accent:#2f6db0}@media(max-width:600px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } });
async function open(query = "", viewport = { width: 1360, height: 1000 }) {
  context = await browser.newContext({ viewport });
  await context.route("**/*", (route) => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);
  await page.getByRole("heading", { name: "Agency overview", exact: true }).waitFor();
}
const section = (name) => page.getByRole("region", { name });
test("legacy ticks do not manufacture Phase One setup completion", async () => {
  await open("new=1");
  const setup = await page.locator('[aria-labelledby="agency-next-steps"]').innerText();
  assert.match(setup, /Choose the setup steps that apply/);
  assert.doesNotMatch(setup, /Ready for activation|7 of 7|steps complete/);
});
test("existing active companies are a portfolio, not incomplete new applications", async () => {
  await open("role=owner&all=1");
  assert.match(await page.locator('[aria-labelledby="agency-next-steps"]').innerText(), /No new companies in setup/);
  assert.equal(await page.locator('.metric').filter({hasText:'Active companies'}).locator('strong').innerText(), '2');
  assert.equal(await section('Company portfolio records').getByRole('button').filter({hasText:'Agency Test Title'}).count(), 1);
  assert.doesNotMatch(await page.locator('body').innerText(), /Next: Review application|Upload completed application/);
});
test("company access filters follow-ups and a display name does not grant permissions", async () => {
  await open();
  assert.equal(await page.getByRole('button',{name:'Add company',exact:true}).count(),0);
  const rows=await section('Company team follow-ups').getByRole('button').allTextContents();
  assert.match(rows[1],/Review formation records/);assert.match(rows[2],/Collect company materials/);
  assert.doesNotMatch(await page.locator('body').innerText(),/Unavailable company task/);
  assert.equal(await page.locator('.metric').filter({hasText:'Open company tasks'}).locator('strong').innerText(),'2');
});
test("limited evidence access does not claim an incomplete or complete application", async () => {
  await open('limited=1&new=1');
  const text=await page.locator('[aria-labelledby="agency-next-steps"]').innerText();
  assert.match(text,/setup available to your account/);
  assert.doesNotMatch(text,/steps complete|Ready for activation|Review application|Choose the setup steps/);
});
test("owner actions open company setup, document cabinet and renewal management", async () => {
  await open('role=owner&all=1&new=1');
  await page.getByRole('button',{name:'Add company',exact:true}).click();
  await page.locator('[aria-labelledby="agency-next-steps"]').getByRole('button').filter({hasText:'Agency Test Title'}).click();
  await page.getByRole('button',{name:/Company documents Applications/}).click();
  await page.getByRole('button',{name:/Manage maintenance schedules/}).click();
  assert.deepEqual(await page.evaluate(()=>window.agencyActions),[{newCompany:true},{company:'A',tab:'Setup'},{page:'Documents'},{page:'Tasks'}]);
});
test("scoped admin cannot create companies and empty portfolio stays usable",async()=>{
  await open('role=admin');assert.equal(await page.getByRole('button',{name:'Add company',exact:true}).count(),0);
  await page.goto(`${origin}/?empty=1&demo=1`);
  await page.getByRole('heading',{name:'No companies available',exact:true}).waitFor();
  await page.getByRole('button',{name:'Add company',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.agencyActions),[{newCompany:true}]);
});
test("agency rows fit a phone viewport and company navigation stays available",async()=>{
  await open('role=owner&all=1',{width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await section('Company portfolio records').getByRole('button').filter({hasText:'Review Test Title'}).click();
  assert.deepEqual(await page.evaluate(()=>window.agencyActions),[{company:'B',tab:'Overview'}]);
});
test("confirmed existing operating status is preserved without rewriting incomplete historical evidence",async()=>{
  await open('confirmed=1&role=owner&all=1');
  assert.equal(await page.locator('.metric').filter({hasText:'Active companies'}).locator('strong').innerText(),'1');
  assert.equal(await page.locator('.metric').filter({hasText:'Companies in setup'}).locator('strong').innerText(),'1');
  assert.equal(await page.locator('[aria-labelledby="agency-next-steps"]').getByRole('button').filter({hasText:'Agency Test Title'}).count(),0);
  const state=await page.evaluate(()=>window.agencyFixture.s);assert.equal(state.companies[0].stage,'Onboarding');assert.deepEqual(state.business.onboarding,[]);
});
