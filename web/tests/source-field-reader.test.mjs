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
  assert.equal(api.scanPageSelection("1-120").length, 120);
  for (const value of ["0", "121", "4-2", "1.5", "-2", "1,,2", "one", "1".repeat(501)])
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
  assert.equal((await pending).status, "cancelled");assert.equal(fixture().ocrCalls.length, 0);
});

test("cancelled PDF indexing preserves known page count and resumes the text pass before OCR", async () => {
  const abort = new AbortController(), blob = pdfBlob();
  fixture().pdf = async (_blob, options) => {
    options.onProgress(1, 30);abort.abort();
    return { pages: [], totalPages: 0, reason: "cancelled", message: "Cancelled" };
  };
  const paused = await api.readFieldSource(doc(), blob, { signal: abort.signal });
  assert.equal(paused.status, "cancelled");assert.equal(paused.totalPages, 30);assert.equal(paused.completedPages, 0);
  assert.deepEqual(paused.unreadPages, Array.from({ length: 30 }, (_, i) => i + 1));assert.deepEqual(paused.pages, []);assert.equal(fixture().ocrCalls.length, 0);
  fixture().pdf = emptyPdf(30);
  const resumed = await api.readFieldSource(doc(), blob, { priorResult: paused });
  assert.equal(fixture().pdfCalls.length, 2);assert.equal(resumed.status, "complete");assert.equal(resumed.completedPages, 30);
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), Array.from({ length: 30 }, (_, i) => i + 1));
});

test("cancelled PDF indexing records a known result count but rejects unbounded or unknown counts", async () => {
  for (const total of [12, 0, -1, 121, Infinity]) {
    fixture().pdf = async () => ({ pages: [], totalPages: total, reason: "cancelled", message: "Cancelled" });
    const paused = await api.readFieldSource(doc(), pdfBlob());assert.equal(paused.status, "cancelled");
    assert.equal(paused.totalPages, total === 12 ? 12 : 0);assert.equal(paused.unreadPages.length, total === 12 ? 12 : 0);
  }
});

test("late OCR completion is discarded after cancellation and the next run still works", async () => {
  const abort = new AbortController();let release;
  fixture().ocr = () => new Promise(done => { release = done; });
  const blob = new Blob(["fictional image"], { type: "image/png" });
  const pending = api.readFieldSource(doc("image/png"), blob, { signal: abort.signal });
  abort.abort();release({ text: "Cancelled result", confidence: 90 });const cancelled = await pending;assert.equal(cancelled.status, "cancelled");assert.deepEqual(cancelled.pages, []);
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

test("damaged PDF text-layer pages use OCR while healthy selectable pages remain and recovery is disclosed", async () => {
  fixture().pdf = { pages: [{ page: 1, text: "", status: "empty" }, { page: 2, text: "Healthy text", status: "text" }], totalPages: 2, failedPages: [1] };
  const result = await api.readFieldSource(doc(), pdfBlob());assert.equal(fixture().pdfCalls[0].options.continueOnPageError, true);
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), [1]);assert.equal(result.status, "complete");assert.match(result.notes[0], /physical page\(s\) 1.*OCR/);
  assert.deepEqual(result.pages.map(page => [page.page, page.method]), [[1, "ocr"], [2, "pdf-text"]]);
});

test("hybrid pages with selectable footers require full-page OCR and never fall back to the footer on failure", async () => {
  fixture().pdf = { pages: [{ page: 1, text: "Page 1", status: "text", requiresOcr: true }, { page: 2, text: "Loan amount: 260000", status: "text" }], totalPages: 2 };
  const blob = pdfBlob();fixture().ocr = async () => { throw Error("could not render scanned body"); };
  const result = await api.readFieldSource(doc(), blob);assert.equal(fixture().pdfCalls[0].options.detectRasterContent, true);
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), [1]);assert.equal(result.status, "partial");assert.equal(result.completedPages, 1);assert.deepEqual(result.unreadPages, [1]);
  assert.deepEqual(result.pages.map(page => [page.page, page.text]), [[2, "Loan amount: 260000"]]);assert.match(result.notes[0], /combine selectable text and images/);
  fixture().ocr = async () => ({ text: "Loan amount: 250000", confidence: 90 });
  const retried = await api.readFieldSource(doc(), blob, { priorResult: result });assert.equal(retried.status, "complete");assert.equal(retried.pages[0].method, "ocr");
  const [suggestion] = api.suggestSourceFields(amount, retried.pages);assert.equal(suggestion.status, "ambiguous");assert.deepEqual(suggestion.candidates.map(candidate => candidate.page), [1, 2]);
});

test("automatic scanning reads a whole 30-page document in sequence, retaining exact late-page evidence", async () => {
  fixture().pdf = emptyPdf(30);let active = 0, peak = 0;const progress = [], snapshots = [];
  fixture().ocr = async (_blob, page) => { active++;peak = Math.max(peak, active);await Promise.resolve();active--;return { text: page === 30 ? "Loan amount: 876543" : `Fictional cover ${page}`, confidence: 90 }; };
  const result = await api.readFieldSource(doc(), pdfBlob(), { onProgress: message => progress.push(message), onSnapshot: value => snapshots.push(value) });
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), Array.from({ length: 30 }, (_, i) => i + 1));assert.equal(peak, 1);
  assert.deepEqual(result.unreadPages, []);assert.equal(result.completedPages, 30);assert.equal(result.status, "complete");assert.equal(result.totalPages, 30);
  assert.equal(snapshots[1].completedPages, 1);assert.equal(snapshots.at(-1).status, "complete");assert.ok(progress.some(message => /page 30 of 30/.test(message)));
  const [suggestion] = api.suggestSourceFields(amount, result.pages);assert.equal(suggestion.candidates[0].page, 30);assert.equal(suggestion.candidates[0].rawValue, "876543");
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
  const failed = await api.readFieldSource(doc(), pdfBlob());assert.equal(failed.status, "partial");assert.equal(failed.issues[0].reason, "failed");assert.equal(failed.completedPages, 0);
  assert.ok(!failed.issues[0].message.includes("Fictional"));
});


test("per-page errors and timeouts preserve earlier text and continue through later pages; retry skips successes", async () => {
  fixture().pdf = emptyPdf(5);const blob = pdfBlob();
  fixture().ocr = async (_blob, page) => { if (page === 2) throw Object.assign(new Error("private engine detail"), { code: "timeout" });if (page === 4) throw new Error("private detail");return { text: `Page ${page}`, confidence: 80 }; };
  const result = await api.readFieldSource(doc(), blob, { sourceIdentity: "scope-A" });
  assert.deepEqual(result.pages.map(page => page.page), [1, 3, 5]);assert.deepEqual(result.issues.map(issue => [issue.page, issue.reason]), [[2, "timeout"], [4, "failed"]]);
  assert.equal(result.status, "partial");assert.deepEqual(result.unreadPages, [2, 4]);assert.ok(!JSON.stringify(result).includes("private"));
  fixture().ocrCalls = [];fixture().ocr = async (_blob, page) => ({ text: `Recovered page ${page}`, confidence: 90 });
  const retried = await api.readFieldSource(doc(), blob, { priorResult: result, sourceIdentity: "scope-A" });
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), [2, 4]);assert.equal(fixture().pdfCalls.length, 1);assert.equal(retried.status, "complete");assert.equal(retried.issues.length, 0);assert.equal(retried.pages[0].text, "Page 1");
});

test("pause snapshots preserve finished pages, discard a late result, and resume only unfinished pages", async () => {
  const abort = new AbortController(), blob = pdfBlob();fixture().pdf = emptyPdf(8);
  fixture().ocr = async (_blob, page) => { if (page === 4) abort.abort();return { text: `Fictional page ${page}`, confidence: 80 }; };
  const result = await api.readFieldSource(doc(), blob, { signal: abort.signal });
  assert.equal(result.status, "cancelled");assert.deepEqual(result.pages.map(page => page.page), [1, 2, 3]);assert.deepEqual(result.unreadPages, [4, 5, 6, 7, 8]);
  fixture().ocrCalls = [];fixture().ocr = async (_blob, page) => ({ text: `Resumed page ${page}`, confidence: 90 });
  const resumed = await api.readFieldSource(doc(), blob, { priorResult: result });assert.equal(resumed.status, "complete");
  assert.deepEqual(fixture().ocrCalls.map(call => call.page), [4, 5, 6, 7, 8]);assert.equal(resumed.pages[0].text, "Fictional page 1");
});

test("explicit orientation reread retains other pages and removes stale text from selected failed pages immediately", async () => {
  fixture().pdf = emptyPdf(3);const blob = pdfBlob(), first = await api.readFieldSource(doc(), blob), snapshots = [];
  fixture().ocrCalls = [];fixture().ocr = async (_blob, page, options) => { assert.equal(options.rotation, 180);if (page === 1) throw Error("failure");return { text: "Corrected page 3", confidence: 95 }; };
  const result = await api.readFieldSource(doc(), blob, { priorResult: first, scanPages: "1,3", rotation: 180, onSnapshot: value => snapshots.push(value) });
  assert.deepEqual(snapshots[0].pages.map(page => page.page), [2]);assert.deepEqual(result.pages.map(page => page.page), [2, 3]);
  assert.equal(result.pages[0].text, first.pages[1].text);assert.equal(result.pages[1].text, "Corrected page 3");assert.equal(result.pages[1].rotation, 180);
  assert.deepEqual(result.unreadPages, [1]);assert.deepEqual(fixture().ocrCalls.map(call => call.page), [1, 3]);
});

test("resume rejects changed originals, versions, company/order/access scope and untrusted snapshots", async () => {
  const blob = pdfBlob(), result = await api.readFieldSource(doc(), blob, { sourceIdentity: "workspace/user/access-v1" });
  const cases = [
    [doc(), pdfBlob(), { sourceIdentity: "workspace/user/access-v1" }],
    [{ ...doc(), version: 3 }, blob, { sourceIdentity: "workspace/user/access-v1" }],
    [{ ...doc(), assetId: "asset-B" }, blob, { sourceIdentity: "workspace/user/access-v1" }],
    [{ ...doc(), companyId: "company-B" }, blob, { sourceIdentity: "workspace/user/access-v1" }],
    [{ ...doc(), orderId: "file-B" }, blob, { sourceIdentity: "workspace/user/access-v1" }],
    [doc(), blob, { sourceIdentity: "workspace/user/access-v2" }],
  ];
  for (const [record, original, options] of cases) await assert.rejects(api.readFieldSource(record, original, { ...options, priorResult: result }), /original document or access scope changed/);
  await assert.rejects(api.readFieldSource(doc(), blob, { priorResult: { ...result }, sourceIdentity: "workspace/user/access-v1" }), /changed/);
  result.pages[0].text = "INJECTED";result.totalPages = 99;
  const unchanged = await api.readFieldSource(doc(), blob, { priorResult: result, sourceIdentity: "workspace/user/access-v1" });
  assert.equal(unchanged.totalPages, 1);assert.notEqual(unchanged.pages[0].text, "INJECTED");
});

test("aggregate and individual text limits reject whole oversized pages without corrupting later evidence", async () => {
  fixture().pdf = emptyPdf(15);fixture().ocr = async (_blob, page) => ({ text: "x".repeat(page === 15 ? 50_001 : page === 14 ? 1000 : 40_000), confidence: 80 });
  const result = await api.readFieldSource(doc(), pdfBlob());
  assert.deepEqual(result.issues.map(issue => [issue.page, issue.reason]), [[13, "text_limit"], [15, "text_limit"]]);
  assert.equal(result.pages.reduce((sum, page) => sum + page.text.length, 0), 481_000);assert.ok(result.pages.some(page => page.page === 14));assert.equal(result.status, "partial");
});

test("line budgets and malformed text isolate bad pages instead of breaking all field suggestions", async () => {
  fixture().pdf = emptyPdf(5);fixture().ocr = async (_blob, page) => ({ text: page === 1 ? "cover\n".repeat(6000) : page === 2 ? "x\n".repeat(6001) : page === 3 ? "Loan amount: 260000" : page === 4 ? "control\u0000text" : "Loan amount: 999999", confidence: page === 5 ? NaN : 90 });
  const result = await api.readFieldSource(doc(), pdfBlob());assert.deepEqual(result.pages.map(page => page.page), [1, 3]);
  assert.deepEqual(result.issues.map(issue => [issue.page, issue.reason]), [[2, "text_limit"], [4, "failed"], [5, "failed"]]);
  const [suggestion] = api.suggestSourceFields(amount, result.pages);assert.equal(suggestion.candidates[0].rawValue, "260000");assert.equal(suggestion.candidates[0].page, 3);
});

test("120-page documents read through their final page; larger documents stop before OCR", async () => {
  fixture().pdf = emptyPdf(120);const result = await api.readFieldSource(doc(), pdfBlob());assert.equal(result.completedPages, 120);assert.equal(result.pages.at(-1).page, 120);
  fixture().pdf = emptyPdf(121);fixture().ocrCalls = [];await assert.rejects(api.readFieldSource(doc(), pdfBlob()), /120 pages/);assert.equal(fixture().ocrCalls.length, 0);
  fixture().pdf = { pages: [], totalPages: 121, reason: "page_limit", message: "Local text review supports up to 120 pages." };
  await assert.rejects(api.readFieldSource(doc(), pdfBlob()), /120 pages/);
});

test("retained OCR word evidence is bounded, includes orientation and cannot be modified across resume", async () => {
  const blob = pdfBlob();fixture().ocr = async () => ({ text: "Loan amount: 250000", confidence: 90, page: 1, rotation: 90, language: "English", engine: "Tesseract.js 7.0.0", width: 500, height: 100,
    words: Array.from({ length: 250 }, (_, i) => ({ text: `word-${i}`, confidence: 100 - i / 5, box: { x0: i, y0: 0, x1: i + 1, y1: 10 } })) });
  const result = await api.readFieldSource(doc(), blob, { rotation: 90 });assert.equal(result.pages[0].ocrWordCount, 250);assert.equal(result.pages[0].ocr.words.length, 200);
  assert.equal(result.pages[0].ocr.words[0].text, "word-249");result.pages[0].ocr.words[0].box.x0 = 999;
  const resumed = await api.readFieldSource(doc(), blob, { priorResult: result });assert.equal(resumed.pages[0].ocr.words[0].box.x0, 249);assert.equal(resumed.pages[0].ocr.rotation, 90);
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

test("real image, 30-page scanned, mixed and selectable-footer hybrid PDFs reach late-page fields without provider traffic", { timeout: 120000 }, async () => {
  const results = await page.evaluate(async () => {
    const pipeline = window.sourcePipeline;
    const scan = async (text, type = "image/png") => {
      const canvas = document.createElement("canvas");canvas.width = 1600;canvas.height = 360;const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";ctx.fillRect(0, 0, canvas.width, canvas.height);ctx.fillStyle = "black";ctx.font = "bold 66px Arial";ctx.fillText(text, 70, 130);ctx.font = "32px Arial";ctx.fillText("FICTIONAL TITLE SOURCE", 70, 230);
      return await new Promise(done => canvas.toBlob(done, type, 0.98));
    };
    const [cover, final] = await Promise.all(["FICTIONAL COVER PAGE", "LOAN AMOUNT: 250000"].map(async text => new Uint8Array(await (await scan(text, "image/jpeg")).arrayBuffer())));
    const makePdf = (mixed, footer = false) => {
      const jpgs = Array.from({ length: 30 }, (_, i) => i === 29 ? final : cover);
      const encoder = new TextEncoder(), chunks = [], offsets = [], objects = [["<< /Type /Catalog /Pages 2 0 R >>"], [`<< /Type /Pages /Kids [${jpgs.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count 30 >>`]];let length = 0;
      const append = value => { const bytes = typeof value === "string" ? encoder.encode(value) : value;chunks.push(bytes);length += bytes.length; };
      jpgs.forEach((jpg, index) => {
        const id = 3 + index * 3, selectable = mixed && index < 29 && index % 2 === 0;
        const content = selectable ? "BT /F1 18 Tf 50 100 Td (FICTIONAL SELECTABLE PAGE) Tj ET" : "q 800 0 0 180 0 0 cm /Im0 Do Q" + (footer ? ` BT /F1 12 Tf 700 8 Td (Page ${index + 1}) Tj ET` : "");
        objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 180] /Resources << /XObject << /Im0 ${id + 1} 0 R >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${id + 2} 0 R >>`],
          [`<< /Type /XObject /Subtype /Image /Width 1600 /Height 360 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"],
          [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
      });
      append("%PDF-1.7\n");objects.forEach((parts, i) => { offsets.push(length);append(`${i + 1} 0 obj\n`);parts.forEach(append);append("\nendobj\n"); });const xref = length;
      append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(chunks, { type: "application/pdf" });
    };
    const originals = [await scan("LOAN AMOUNT: 250000"), makePdf(false), makePdf(true), makePdf(false, true)], results = [];
    for (const original of originals) {
      const before = [...new Uint8Array(await original.arrayBuffer())];
      const read = await pipeline.readFieldSource({ id: "fictional-scan", assetId: "original", name: "Fictional source", mime: original.type }, original);
      const after = new Uint8Array(await original.arrayBuffer());
      results.push({ read, suggestions: pipeline.suggestSourceFields([{ id: "loanAmount", label: "Confirmed loan amount" }], read.pages), unchanged: before.length === after.length && before.every((byte, index) => byte === after[index]) });
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.unchanged, true);assert.equal(result.read.status, "complete");assert.deepEqual(result.read.unreadPages, []);assert.equal(result.suggestions[0].status, "suggested");
    assert.equal(result.suggestions[0].candidates[0].rawValue, "250000");assert.equal(result.suggestions[0].candidates[0].method, "ocr");assert.ok(result.suggestions[0].candidates[0].confidence > 0);
  }
  for (const result of results.slice(1)) { assert.equal(result.read.pages.length, 30);assert.equal(result.suggestions[0].candidates[0].page, 30);assert.equal(result.read.totalPages, 30); }
  assert.equal(results[1].read.pages.filter(p => p.method === "ocr").length, 30);
  assert.equal(results[2].read.pages.filter(p => p.method === "ocr").length, 15);assert.equal(results[2].read.pages.filter(p => p.method === "pdf-text").length, 15);
  assert.equal(results[3].read.pages.filter(p => p.method === "ocr").length, 30);assert.match(results[3].read.notes[0], /combine selectable text and images/);
  assert.ok(requests.some(url => url.includes("eng.traineddata.gz")));assert.ok(requests.some(url => url.includes("tesseract-core")));assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: await indexedDB.databases() })), { local: [], session: [], databases: [] });
});
