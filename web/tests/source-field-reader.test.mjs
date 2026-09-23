// Exercise the actual source-reader/extraction pipeline; controlled engine timing
// plus a real browser PDF.js + Tesseract drill served only from local packages.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
const controlled = await build({ absWorkingDir: web, write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  stdin: { resolveDir: web, contents: 'export * from "./lib/title/source-field-reader";export * from "./lib/title/field-extraction";' },
  plugins: [{ name: "controlled-reader-engines", setup(builder) {
    builder.onResolve({ filter: /^\.\/(pdf-text|local-ocr)$/ }, args => args.importer.endsWith("source-field-reader.ts") ? { path: args.path, namespace: "controlled" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "controlled" }, args => ({ contents: args.path === "./pdf-text" ? `
      export async function extractPdfText(blob,options){const fixture=globalThis.__sourceReaderFixture;fixture.pdfCalls.push({blob,options});return typeof fixture.pdf==='function'?fixture.pdf(blob,options):fixture.pdf;}
    ` : `
      export async function recognizeDocumentPage(blob,page,options){const fixture=globalThis.__sourceReaderFixture;fixture.ocrCalls.push({blob,page,options});return fixture.ocr(blob,page,options);}
    ` }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(controlled.outputFiles[0].contents).toString("base64")}`);
const doc = (mime = "application/pdf") => ({ id: "source-A", assetId: "asset-A", companyId: "company-A", orderId: "file-A", version: 2, name: "Fictional source", mime, text: "Loan amount: 999999" });
const pdfBlob = () => new Blob(["%PDF-fictional controlled bytes"], { type: "application/pdf" });
const emptyPdf = count => ({ pages: Array.from({ length: count }, (_, i) => ({ page: i + 1, text: "", status: "empty" })), totalPages: count, message: "No selectable text." });
const fixture = () => globalThis.__sourceReaderFixture;
const amount = [{ id: "loanAmount", label: "Confirmed loan amount" }];
beforeEach(() => {
  globalThis.__sourceReaderFixture = { pdfCalls: [], ocrCalls: [], pdf: emptyPdf(1),
    ocr: async (_blob, page) => ({ page, text: "Loan amount: 250000", confidence: 87 }) };
});

test("scan-page selection deduplicates physical pages and bounds malformed ranges before reading", () => {
  assert.deepEqual(api.scanPageSelection(" 5, 1, 3-5 "), [1, 3, 4, 5]);assert.deepEqual(api.scanPageSelection(""), []);
  assert.deepEqual(api.scanPageSelection("115-120"), [115, 116, 117, 118, 119, 120]);
  for (const value of ["0", "121", "4-2", "1-7", "1,3,5,7,9,11,13", "1.5", "-2", "1,,2", "one", "1".repeat(101)])
    assert.throws(() => api.scanPageSelection(value), /page|range|six/i, value);
});

test("missing original bytes never fall back to a document's saved excerpt", async () => {
  await assert.rejects(api.readFieldSource(doc(), undefined), /original attachment is unavailable/);
  assert.equal(fixture().pdfCalls.length + fixture().ocrCalls.length, 0);
  const excerpt = { ...doc(), assetId: undefined };const result = await api.readFieldSource(excerpt, undefined);
  assert.equal(result.pages[0].text, excerpt.text);assert.equal(result.pages[0].method, "source-text");assert.match(result.notes[0], /source excerpt.*original page/i);
  await assert.rejects(api.readFieldSource(excerpt, undefined, { scanPages: "2" }), /only available for original PDFs/);
});

test("MIME mismatch, empty and oversized originals stop before any engine is invoked", async () => {
  for (const [blob, pattern] of [[new Blob(["wrong"], { type: "image/png" }), /file type/], [new Blob([], { type: "application/pdf" }), /nonempty/], [{ size: 26_214_401, type: "application/pdf" }, /25 MB/]])
    await assert.rejects(api.readFieldSource(doc(), blob), pattern);
  assert.equal(fixture().pdfCalls.length + fixture().ocrCalls.length, 0);
});

test("plain text is read from original bytes with a manual-page-reference caveat", async () => {
  const result = await api.readFieldSource(doc("text/plain"), new Blob(["Loan amount: 250000"], { type: "text/plain" }));
  const [suggestion] = api.suggestSourceFields(amount, result.pages);
  assert.equal(suggestion.candidates[0].rawValue, "250000");assert.match(result.notes[0], /page references manually/);
  assert.equal(fixture().pdfCalls.length + fixture().ocrCalls.length, 0);
});

test("pre-cancellation and a late PDF result cannot publish pages", async () => {
  const abort = new AbortController();abort.abort();await assert.rejects(api.readFieldSource(doc(), pdfBlob(), { signal: abort.signal }), /cancelled/);
  assert.equal(fixture().pdfCalls.length, 0);
  const late = new AbortController();let release;
  fixture().pdf = () => new Promise(done => { release = done; });
  const pending = api.readFieldSource(doc(), pdfBlob(), { signal: late.signal });
  late.abort();release({ pages: [{ page: 1, text: "Loan amount: 123456", status: "text" }], totalPages: 1 });
  await assert.rejects(pending, /cancelled/);assert.equal(fixture().ocrCalls.length, 0);
});

test("late OCR completion is discarded after cancellation and the next run still works", async () => {
  const abort = new AbortController();let release;
  fixture().ocr = () => new Promise(done => { release = done; });
  const blob = new Blob(["fictional image"], { type: "image/png" });
  const pending = api.readFieldSource(doc("image/png"), blob, { signal: abort.signal });
  abort.abort();release({ text: "Cancelled result", confidence: 90 });await assert.rejects(pending, /cancelled/);
  fixture().ocr = async () => ({ text: "Loan amount: 260000", confidence: 90 });
  assert.equal((await api.readFieldSource(doc("image/png"), blob)).pages[0].text, "Loan amount: 260000");
});

test("selectable PDF pages retain exact evidence and only empty pages use OCR", async () => {
  fixture().pdf = { pages: [{ page: 1, text: "Loan amount: 240000", status: "text" }, { page: 2, text: "", status: "empty" }], totalPages: 2 };
  const result = await api.readFieldSource(doc(), pdfBlob());assert.deepEqual(fixture().ocrCalls.map(call => call.page), [2]);
  assert.deepEqual(result.pages.map(page => [page.page, page.method]), [[1, "pdf-text"], [2, "ocr"]]);
  const [suggestion] = api.suggestSourceFields(amount, result.pages);
  assert.equal(suggestion.status, "ambiguous");assert.deepEqual(suggestion.candidates.map(candidate => candidate.rawValue), ["240000", "250000"]);
  assert.equal(suggestion.candidates[1].confidence, 87);assert.ok(suggestion.candidates[1].warnings.some(note => /not field accuracy/.test(note)));
});

test("automatic scanning stops at six pages and explicitly reports remaining unread pages", async () => {
  fixture().pdf = emptyPdf(8);const result = await api.readFieldSource(doc(), pdfBlob());
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), [1, 2, 3, 4, 5, 6]);assert.deepEqual(result.unreadPages, [7, 8]);
  assert.match(result.notes[0], /2 page\(s\) remain unread/);assert.equal(result.totalPages, 8);
});

test("explicit physical pages, orientation and progress reach OCR; bounds fail before OCR", async () => {
  fixture().pdf = emptyPdf(8);const progress = [];const result = await api.readFieldSource(doc(), pdfBlob(), { scanPages: "8, 2", rotation: 270, onProgress: message => progress.push(message) });
  assert.deepEqual(fixture().ocrCalls.map(call => [call.page, call.options.rotation]), [[2, 270], [8, 270]]);
  assert.deepEqual(result.pages.map(page => page.page), [2, 8]);assert.deepEqual(result.unreadPages, [1, 3, 4, 5, 6, 7]);assert.ok(progress.some(message => /scanned page 8/.test(message)));
  fixture().ocrCalls = [];await assert.rejects(api.readFieldSource(doc(), pdfBlob(), { scanPages: "9" }), /8 pages/);assert.equal(fixture().ocrCalls.length, 0);
  await assert.rejects(api.readFieldSource(doc("image/png"), new Blob(["image"], { type: "image/png" }), { scanPages: "2" }), /image contains one page/);
});

test("failed or empty OCR never claims a scanned page was read", async () => {
  fixture().ocr = async () => ({ text: "   ", confidence: 0 });const result = await api.readFieldSource(doc(), pdfBlob());
  assert.deepEqual(result.pages, []);assert.deepEqual(result.unreadPages, [1]);assert.match(result.notes[0], /remain unread/);
  fixture().ocr = async () => { throw new Error("Fictional local engine failure"); };
  await assert.rejects(api.readFieldSource(doc(), pdfBlob()), /local engine failure/);
});

let server, browser, context, page, origin;
const errors = [], requests = [];
before(async () => {
  const workerUrls = { name: "local-worker-urls", setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "/pdf.worker.mjs", namespace: "local-url" }));
    builder.onResolve({ filter: /local-ocr\.worker\.ts\?worker&url$/ }, () => ({ path: "/local-ocr.worker.js", namespace: "local-url" }));
    builder.onLoad({ filter: /.*/, namespace: "local-url" }, args => ({ contents: `export default ${JSON.stringify(args.path)};` }));
  } };
  const [entry, worker] = await Promise.all([
    build({ absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", target: "es2022", logLevel: "silent", plugins: [workerUrls],
      stdin: { resolveDir: web, contents: 'import * as reader from "./lib/title/source-field-reader";import * as extraction from "./lib/title/field-extraction";window.sourcePipeline={...reader,...extraction};' } }),
    build({ absWorkingDir: web, entryPoints: ["lib/title/local-ocr.worker.ts"], write: false, bundle: true, platform: "browser", format: "iife", target: "es2022", logLevel: "silent" }),
  ]);
  const assets = new Map([
    ["/pdf.worker.mjs", "pdfjs-dist/legacy/build/pdf.worker.min.mjs"],
    ["/ocr/v7-eng1/worker.min.js", "tesseract.js/dist/worker.min.js"],
    ["/ocr/v7-eng1/eng.traineddata.gz", "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"],
    ...["", "-simd", "-relaxedsimd", "-lstm", "-simd-lstm", "-relaxedsimd-lstm"].map(variant => [`/ocr/v7-eng1/tesseract-core${variant}.wasm.js`, `tesseract.js-core/tesseract-core${variant}.wasm.js`]),
  ]);
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/") { res.writeHead(200, { "content-type": "text/html" });res.end('<!doctype html><html><body><script type="module" src="/pipeline.mjs"></script></body></html>');return; }
      const bytes = path === "/pipeline.mjs" ? entry.outputFiles[0].contents : path === "/local-ocr.worker.js" ? worker.outputFiles[0].contents : assets.has(path) ? await readFile(resolve(web, "node_modules", assets.get(path))) : null;
      if (!bytes) { res.writeHead(404);res.end();return; }
      res.writeHead(200, { "content-type": /\.(mjs|js)$/.test(path) ? "text/javascript" : "application/octet-stream", "cache-control": "no-store" });res.end(bytes);
    } catch { res.writeHead(500);res.end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
  context = await browser.newContext();await context.route("**/*", route => {
    const url = route.request().url();requests.push(url);
    if (!url.startsWith(`${origin}/`)) { errors.push(`Unexpected external request: ${new URL(url).origin}`);return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();page.on("pageerror", error => errors.push(error.message));await page.goto(origin);await page.waitForFunction(() => !!window.sourcePipeline);
});
after(async () => { await context?.close();await browser?.close();if (server) { server.closeAllConnections();await new Promise(done => server.close(done)); }delete globalThis.__sourceReaderFixture; });

test("real image and scanned PDF flow through local OCR into exact field suggestions without provider traffic", { timeout: 120000 }, async () => {
  const results = await page.evaluate(async () => {
    const pipeline = window.sourcePipeline;
    const scan = async (text, type = "image/png") => {
      const canvas = document.createElement("canvas");canvas.width = 1600;canvas.height = 360;const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";ctx.fillRect(0, 0, canvas.width, canvas.height);ctx.fillStyle = "black";ctx.font = "bold 66px Arial";ctx.fillText(text, 70, 130);ctx.font = "32px Arial";ctx.fillText("FICTIONAL TITLE SOURCE", 70, 230);
      return await new Promise(done => canvas.toBlob(done, type, 0.98));
    };
    const jpgs = await Promise.all(["FICTIONAL COVER PAGE", "LOAN AMOUNT: 250000"].map(async text => new Uint8Array(await (await scan(text, "image/jpeg")).arrayBuffer())));
    const encoder = new TextEncoder(), chunks = [], offsets = [], objects = [["<< /Type /Catalog /Pages 2 0 R >>"], ["<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>"]];let length = 0;
    const append = value => { const bytes = typeof value === "string" ? encoder.encode(value) : value;chunks.push(bytes);length += bytes.length; };
    jpgs.forEach((jpg, index) => {
      const id = 3 + index * 3, content = "q 800 0 0 180 0 0 cm /Im0 Do Q";
      objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 180] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`],
        [`<< /Type /XObject /Subtype /Image /Width 1600 /Height 360 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"],
        [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    });
    append("%PDF-1.7\n");objects.forEach((parts, i) => { offsets.push(length);append(`${i + 1} 0 obj\n`);parts.forEach(append);append("\nendobj\n"); });const xref = length;
    append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const originals = [await scan("LOAN AMOUNT: 250000"), new Blob(chunks, { type: "application/pdf" })], results = [];
    for (const original of originals) {
      const before = [...new Uint8Array(await original.arrayBuffer())];
      const read = await pipeline.readFieldSource({ id: "fictional-scan", assetId: "original", name: "Fictional source", mime: original.type }, original, original.type === "application/pdf" ? { scanPages: "2" } : {});
      const after = new Uint8Array(await original.arrayBuffer());
      results.push({ read, suggestions: pipeline.suggestSourceFields([{ id: "loanAmount", label: "Confirmed loan amount" }], read.pages), unchanged: before.length === after.length && before.every((byte, index) => byte === after[index]) });
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.unchanged, true);assert.equal(result.suggestions[0].status, "suggested");
    assert.equal(result.suggestions[0].candidates[0].rawValue, "250000");assert.equal(result.suggestions[0].candidates[0].method, "ocr");assert.ok(result.suggestions[0].candidates[0].confidence > 0);
  }
  assert.deepEqual(results[1].read.unreadPages, [1]);assert.equal(results[1].suggestions[0].candidates[0].page, 2);assert.match(results[1].read.notes[0], /remain unread/);
  assert.ok(requests.some(url => url.includes("eng.traineddata.gz")));assert.ok(requests.some(url => url.includes("tesseract-core")));assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: await indexedDB.databases() })), { local: [], session: [], databases: [] });
});
