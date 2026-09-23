import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
const evidence = resolve(web, ".local-test/pdf-preview");
let server, browser, context, page, origin;
const errors = [];

// A normal two-page fictional document with text and graphics; no client data.
function pdfFixture(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let i = 0; i < pages.length; i++) {
    const next = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${next + 1} 0 R >>`);
    const color = i ? "0.92 0.96 1" : "1 0.96 0.86";
    const stream = `${color} rg 45 450 522 300 re f 0.1 0.2 0.3 rg BT /F1 24 Tf 65 710 Td (FICTIONAL TITLE DOCUMENT) Tj 0 -50 Td /F1 18 Tf (${pages[i]}) Tj 0 -45 Td /F1 14 Tf (Normal PDF compatibility fixture. No client data.) Tj ET 0.1 0.2 0.3 RG 2 w 65 590 m 540 590 l S`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let source = "%PDF-1.7\n";
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return source;
}

before(async () => {
  await mkdir(evidence, { recursive: true });
  const bundle = await build({ absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", target: "es2022", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {PdfPreview} from './components/title/pdf-preview';
      const files=await Promise.all(['/two-pages.pdf','/one-page.pdf','/long-package.pdf'].map(async path=>new Blob([await(await fetch(path)).arrayBuffer()],{type:'application/pdf'})));
      function Fixture(){const query=new URLSearchParams(location.search);const [open,setOpen]=useState(true),[selected,setSelected]=useState(query.has('long')?2:0),[requested,setRequested]=useState(query.has('page')?Number(query.get('page')):undefined);window.selectCitedPage=page=>setRequested(page);return <main>
        <h1>Fictional PDF preview</h1><button onClick={()=>setOpen(v=>!v)}>{open?'Close preview':'Open preview'}</button><button onClick={()=>{setSelected(v=>v===0?1:0);setRequested(undefined)}}>Change fictional document</button>
        {open?<PdfPreview file={files[selected]} name={selected===2?'Long fixture.pdf':selected?'Replacement fixture.pdf':'Fictional fixture.pdf'} initialPage={requested}/>:<p>Preview closed</p>}
      </main>}; createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    plugins: [{ name: "local-pdf-worker", setup(builder) {
      builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "/pdf.worker.mjs", namespace: "worker-url" }));
      builder.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({ contents: 'export default "/pdf.worker.mjs";', loader: "js" }));
    } }],
  });
  const worker = await readFile(resolve(web, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"));
  const source = bundle.outputFiles[0].contents;
  const policies = (await readFile(resolve(web, "public/_headers"), "utf8")).split("\n")
    .filter(line => /^  [A-Za-z-]+: /.test(line)).map(line => { const colon=line.indexOf(":");return [line.slice(2,colon),line.slice(colon+2)]; });
  server = createServer((req, res) => {
    for (const [name,value] of policies) res.setHeader(name,value);
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/app.mjs" || pathname === "/pdf.worker.mjs") { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); res.end(pathname === "/app.mjs" ? source : worker); }
    else if (pathname.endsWith(".pdf")) { res.writeHead(200, { "content-type": "application/pdf" }); res.end(pdfFixture(pathname === "/long-package.pdf" ? Array.from({length:1000},(_,i)=>`Physical page ${i+1}: fictional title package`) : pathname === "/two-pages.pdf" ? ["Page one: company records", "Page two: review checklist"] : ["Replacement document: one page"])); }
    else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional PDF preview</title><style>*{box-sizing:border-box}body{margin:24px;font-family:Arial;color:#233549}main{max-width:780px;margin:auto}button{font:inherit;margin:4px;padding:9px 14px;border:1px solid #b7c7d8;border-radius:7px;background:#fff;cursor:pointer}button:disabled{opacity:.45;cursor:default}button svg{vertical-align:middle;width:16px;height:16px}h1{font-size:24px}button:focus-visible{outline:3px solid #1f5896}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});

afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); } });

async function open({ delayWorker = false, width = 1000, initialPage, long = false } = {}) {
  context = await browser.newContext({ viewport: { width, height: 1100 } });
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.previewWorkers = new Set();
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.previewWorkers.add(this); }
      terminate() { window.previewWorkers.delete(this); return super.terminate(); }
    };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.previewUrls = new Set();
    URL.createObjectURL = (blob) => { const url = create(blob); window.previewUrls.add(url); return url; };
    URL.revokeObjectURL = (url) => { window.previewUrls.delete(url); revoke(url); };
  });
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith(`${origin}/`)) { errors.push("Unexpected external request"); return route.abort(); }
    if (delayWorker && route.request().url().endsWith("/pdf.worker.mjs")) await new Promise((done) => setTimeout(done, 500));
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?${new URLSearchParams({...(initialPage!==undefined?{page:String(initialPage)}:{}),...(long?{long:'1'}:{})})}`);
  await page.getByRole("heading", { name: "Fictional PDF preview" }).waitFor();
}

async function waitForPage(number, name = "Fictional fixture.pdf", total = 2) {
  const image = page.getByRole("img", { name: `${name}, page ${number} of ${total}` });
  await image.waitFor();
  await image.evaluate((element) => element.decode());
  return image;
}

test("real PDF.js raster preview displays both ordinary pages and keyboard navigation returns to page one", async () => {
  await open();
  let image = await waitForPage(1);
  const painted = await image.evaluate((element) => {
    const canvas = document.createElement("canvas"); canvas.width = 612; canvas.height = 792;
    const ctx = canvas.getContext("2d"); ctx.drawImage(element, 0, 0, 612, 792);
    const pixels = ctx.getImageData(0, 0, 612, 792).data;
    let dark = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 90 && pixels[i + 1] < 90 && pixels[i + 2] < 100) dark++;
    return { width: element.naturalWidth, height: element.naturalHeight, dark };
  });
  assert.ok(painted.width > 1000 && painted.height > 1000); assert.ok(painted.dark > 1000, JSON.stringify(painted));
  assert.equal(await page.getByRole("button", { name: "Previous PDF page" }).isDisabled(), true);
  await page.screenshot({ path: resolve(evidence, "raster-page-1.png") });
  const originalUrl = await image.getAttribute("src");
  await image.evaluate((element) => { element.parentElement.scrollTop = 400; });
  await page.getByRole("button", { name: "Next PDF page" }).focus();
  await page.keyboard.press("Enter");
  image = await waitForPage(2);
  assert.equal(await image.evaluate((element) => element.parentElement.scrollTop), 0);
  assert.notEqual(await image.getAttribute("src"), originalUrl);
  assert.equal(await page.getByRole("button", { name: "Next PDF page" }).isDisabled(), true);
  assert.equal(await page.evaluate((url) => window.previewUrls.has(url), originalUrl), false);
  await page.screenshot({ path: resolve(evidence, "raster-page-2.png") });
  await page.getByRole("button", { name: "Previous PDF page" }).click();
  await waitForPage(1);
  assert.equal(await page.locator("iframe,object,embed").count(), 0);
});

test("closing removes preview URLs and workers; reopening starts at the first page", async () => {
  await open(); await waitForPage(1);
  await page.getByRole("button", { name: "Next PDF page" }).click(); await waitForPage(2);
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.waitForFunction(() => window.previewUrls.size === 0 && window.previewWorkers.size === 0);
  assert.equal(await page.getByRole("img").count(), 0);
  await page.getByRole("button", { name: "Open preview", exact: true }).click(); await waitForPage(1);
});

test("replacing the Blob clears the prior page image and restarts at page one", async () => {
  await open(); await waitForPage(1);
  await page.getByRole("button", { name: "Next PDF page" }).click();
  const old = await (await waitForPage(2)).getAttribute("src");
  await page.getByRole("button", { name: "Change fictional document" }).click();
  await waitForPage(1, "Replacement fixture.pdf", 1);
  assert.equal(await page.evaluate((url) => window.previewUrls.has(url), old), false);
  assert.equal(await page.getByRole("button", { name: "Next PDF page" }).isDisabled(), true);
});

test("closing during worker startup aborts the pending render without leaving images or workers", async () => {
  await open({ delayWorker: true });
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.waitForFunction(() => window.previewUrls.size === 0 && window.previewWorkers.size === 0);
  await page.waitForTimeout(650);
  assert.equal(await page.getByRole("img").count(), 0);
  assert.equal(await page.evaluate(() => window.previewUrls.size + window.previewWorkers.size), 0);
});

test("normal page preview and navigation fit a phone-sized viewport", async () => {
  await open({ width: 390 }); await waitForPage(1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("button", { name: "Next PDF page" }).click(); await waitForPage(2);
});

test("a cited physical page opens directly and a 1,000-page original supports bounded keyboard page jumps", async () => {
  await open({long:true,initialPage:30});await waitForPage(30,'Long fixture.pdf',1000);
  const input=page.getByRole('spinbutton',{name:'PDF page number'}),go=page.getByRole('button',{name:'Go',exact:true});
  assert.equal(await input.inputValue(),'30');await input.fill('750');await input.press('Enter');await waitForPage(750,'Long fixture.pdf',1000);
  for(const invalid of ['0','1001','1.5','-1']){await input.fill(invalid);assert.equal(await go.isDisabled(),true);assert.equal(await input.getAttribute('aria-invalid'),'true');}
  await input.fill('1000');await go.click();await waitForPage(1000,'Long fixture.pdf',1000);assert.equal(await page.getByRole('button',{name:'Next PDF page'}).isDisabled(),true);
  await page.getByRole('button',{name:'Previous PDF page'}).click();await waitForPage(999,'Long fixture.pdf',1000);
  assert.equal(await page.evaluate(()=>window.previewUrls.size),1);assert.equal(await page.locator('iframe,object,embed').count(),0);
});

test("a new citation changes the target on the same original and ordinary document replacement starts at one", async () => {
  await open({long:true,initialPage:30});const old=await(await waitForPage(30,'Long fixture.pdf',1000)).getAttribute('src');
  await page.evaluate(()=>window.selectCitedPage(750));await waitForPage(750,'Long fixture.pdf',1000);assert.equal(await page.evaluate(url=>window.previewUrls.has(url),old),false);
  await page.getByRole('button',{name:'Change fictional document'}).click();await waitForPage(1);assert.equal(await page.getByRole('spinbutton',{name:'PDF page number'}).inputValue(),'1');
});

test("invalid initial page requests use page one; valid but unavailable pages show a recoverable error", async () => {
  await open({initialPage:1001});await waitForPage(1);await page.evaluate(()=>window.selectCitedPage(3));await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/physical page is unavailable/);
  await page.getByRole('spinbutton',{name:'PDF page number'}).fill('2');await page.getByRole('button',{name:'Go',exact:true}).click();await waitForPage(2);
});
