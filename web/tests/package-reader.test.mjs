import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const web = fileURLToPath(new URL("../", import.meta.url));
async function api(controlledPdf) {
  const output = await build({ absWorkingDir: web, write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent",
    stdin: { resolveDir: web, contents: 'export * from "./lib/title/package-reader"; export * from "./lib/title/package-scan";' },
    plugins: [{ name: "package-engine-fixtures", setup(builder) {
      builder.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: pathToFileURL(resolve(web, "node_modules", args.path)).href, external: true }));
      builder.onResolve({ filter: /^\.\/local-ocr$/ }, args => args.importer.endsWith("package-reader.ts") ? { path: args.path, namespace: "fixture-ocr" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture-ocr" }, () => ({ contents: `export async function recognizeDocumentPage(blob,page,options){return globalThis.__packageOcr(blob,page,options);}` }));
      if (controlledPdf) {
        builder.onResolve({ filter: /^\.\/pdf-text$/ }, args => args.importer.endsWith("package-reader.ts") ? { path: args.path, namespace: "fixture-pdf" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "fixture-pdf" }, () => ({ contents: `export async function extractPdfText(blob,options){return globalThis.__packagePdf(blob,options);}` }));
      }
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`);
}
const real = await api(false), controlled = await api(true);
function pdfFixture(count, value = page => `Fictional source physical page ${page}`) {
  const objects = [], add = text => { objects.push(text); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let page = 1; page <= count; page++) {
    const id = objects.length + 1;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = `BT /F1 12 Tf 72 720 Td (${value(page).replace(/[\\()]/g, "\\$&")}) Tj ET`;
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.7\n"; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([body], { type: "application/pdf" });
}
const doc = (id = "source-A", mime = "application/pdf") => ({ id, assetId: `asset-${id}`, companyId: "company-A", orderId: "file-A", sourceRole: "Deed", visibility: "Internal", version: 3, name: `${id}.pdf`, mime });
function fixture(count = 25, value = () => "") {
  globalThis.__packagePdf = async (_blob, options) => ({ status: "ready", totalPages: count, pages: Array.from({ length: options.pageWindow.count }, (_, i) => {
    const page = options.pageWindow.start + i; return { page, text: value(page), status: value(page) ? "text" : "empty" };
  }).filter(page => page.page <= count), message: "Fictional package" });
  globalThis.__packageOcr = async (_blob, page, options) => { assert.equal(options.packageMode, true); return { text: `Fictional OCR ${page}`, confidence: 80, rotation: 0 }; };
  return new Blob(["%PDF-fictional controlled engine"], { type: "application/pdf" });
}
function store() {
  const writes = [], pages = new Map(); let checkpoint;
  return { writes, pages, get checkpoint() { return checkpoint; },
    loadCheckpoint: async () => checkpoint,
    onBatch: async (batch, next) => {
      writes.push(structuredClone(batch));
      for (const page of batch.pages) pages.set(`${batch.source.documentId}/${page.page}`, page);
      checkpoint = structuredClone(next);
    },
  };
}

test("real 500-page PDF is read in bounded windows with exact late-page evidence and immutable originals", async () => {
  const blob = pdfFixture(500, page => page === 500 ? "Original principal sum: $876,543.21" : `Fictional cover ${page}`), storage = store();
  const hash = await real.packageSha256(blob);
  globalThis.__packageOcr = async () => assert.fail("selectable-only package invoked OCR");
  const progress = [];
  const result = await real.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "workspace/user/access-v1", ...storage, onProgress: value => progress.push(value) });
  assert.equal(result.status, "complete"); assert.equal(result.totalPages, 500); assert.equal(result.completedPages, 500); assert.deepEqual(result.unread[0].pages, []);
  assert.equal(storage.pages.get("source-A/500").text, "Original principal sum: $876,543.21");
  assert.equal(storage.pages.get("source-A/500").method, "pdf-text");
  assert.equal(result.checkpoint.sources[0].completed[499].textSha256, await real.packageSha256("Original principal sum: $876,543.21"));
  assert.ok(storage.writes.every(batch => batch.attemptedPages.length <= 10)); assert.equal(storage.writes.filter(batch => batch.pages.length).length, 50);
  assert.equal(await real.packageSha256(blob), hash); assert.ok(progress.some(value => value.page === 500 && value.totalPackagePages === 500));
  assert.ok(!JSON.stringify(result.checkpoint).includes("876,543"));
});

test("split originals keep document, original hash and physical page identity through all 1,000 pages", async () => {
  const sources = [{ document: doc("deed-A"), blob: pdfFixture(500) }, { document: doc("security-B"), blob: pdfFixture(500, page => page === 500 ? "Final security instrument page" : `Second original ${page}`) }], storage = store();
  const result = await real.readDocumentPackage(sources, { accessIdentity: "scope-A", ...storage });
  assert.equal(result.completedPages, 1_000); assert.equal(result.checkpoint.sources.length, 2);
  assert.equal(storage.pages.get("deed-A/500").text, "Fictional source physical page 500");
  assert.equal(storage.pages.get("security-B/500").text, "Final security instrument page");
  assert.notEqual(result.checkpoint.sources[0].identity.sha256, result.checkpoint.sources[1].identity.sha256);
});

test("aggregate page and byte limits and missing originals reject before storing any page", async () => {
  const storage = store(), blob = fixture(501);
  await assert.rejects(controlled.readDocumentPackage([{ document: doc("A"), blob }, { document: doc("B"), blob }], { accessIdentity: "scope-A", ...storage }), /1,000 physical pages/);
  assert.equal(storage.writes.length, 0);
  await assert.rejects(controlled.readDocumentPackage([{ document: doc() }], { accessIdentity: "scope-A", ...storage }), /uploaded original/);
  await assert.rejects(controlled.readDocumentPackage([{ document: doc(), blob: { type: "application/pdf", size: 26_214_401 } }], { accessIdentity: "scope-A", ...storage }), /25 MB/);
  await assert.rejects(controlled.readDocumentPackage([{ document: doc(), blob }, { document: doc(), blob }], { accessIdentity: "scope-A", ...storage }), /1,000|invalid/);
  assert.equal(storage.writes.length, 0);
});

test("cancel preserves acknowledged pages and resume rebinds identical bytes before retrying only unread OCR pages", async () => {
  const blob = fixture(25), storage = store(), abort = new AbortController(), calls = [];
  globalThis.__packageOcr = async (_blob, page) => { calls.push(page); if (page === 4) abort.abort(); return { text: `Read ${page}`, confidence: 88 }; };
  const result = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage, signal: abort.signal });
  assert.equal(result.status, "cancelled"); assert.equal(result.completedPages, 3); assert.equal(storage.pages.size, 3);
  assert.deepEqual(result.checkpoint.sources[0].completed.map(page => page.page), [1, 2, 3]);
  calls.length = 0; globalThis.__packageOcr = async (_blob, page) => { calls.push(page); return { text: `Resumed ${page}`, confidence: 90 }; };
  const resumed = await controlled.readDocumentPackage([{ document: doc(), blob: blob.slice(0, blob.size, blob.type) }], { accessIdentity: "scope-A", ...storage });
  assert.equal(resumed.status, "complete"); assert.deepEqual(calls, Array.from({ length: 22 }, (_, i) => i + 4));
  assert.equal(storage.pages.get("source-A/1").text, "Read 1");
});

test("empty, failed and timed-out pages remain explicit and retry never skips them or redoes successes", async () => {
  const blob = fixture(5), storage = store();
  globalThis.__packageOcr = async (_blob, page) => {
    if (page === 2) throw Object.assign(Error("private OCR detail"), { code: "timeout" });
    if (page === 3) throw Error("private OCR detail");
    return { text: page === 4 ? " " : `Page ${page}`, confidence: 80 };
  };
  const result = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  assert.equal(result.status, "partial"); assert.deepEqual(result.unread[0].pages, [2, 3, 4]);
  assert.deepEqual(result.checkpoint.sources[0].issues.map(issue => [issue.page, issue.reason]), [[2, "timeout"], [3, "failed"], [4, "empty"]]);
  assert.ok(!JSON.stringify(result).includes("private"));
  const calls = []; globalThis.__packageOcr = async (_blob, page) => { calls.push(page); return { text: "Recovered", confidence: 91 }; };
  const resumed = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  assert.deepEqual(calls, [2, 3, 4]); assert.equal(resumed.status, "complete"); assert.deepEqual(resumed.checkpoint.sources[0].issues, []);
});

test("restored checkpoints reject changed originals, current access and every source identity binding", async () => {
  const blob = fixture(1), storage = store();
  await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  const originalWrites = storage.writes.length;
  const edits = [{ version: 4 }, { assetId: "replacement" }, { companyId: "company-B" }, { orderId: "file-B" }, { name: "Renamed.pdf" }, { visibility: "Restricted" }, { sourceRole: "Security Instrument" }];
  for (const edit of edits) await assert.rejects(controlled.readDocumentPackage([{ document: { ...doc(), ...edit }, blob }], { accessIdentity: "scope-A", ...storage }), /changed/);
  await assert.rejects(controlled.readDocumentPackage([{ document: doc(), blob: new Blob(["%PDF-different original"], { type: "application/pdf" }) }], { accessIdentity: "scope-A", ...storage }), /changed/);
  await assert.rejects(controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-B", ...storage }), /changed/);
  assert.equal(storage.writes.length, originalWrites);
});

test("malformed or overclaiming checkpoints never skip pages and unknown payload fields are rejected", async () => {
  const blob = fixture(2), storage = store(); await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  for (const corrupt of [
    value => value.sources[0].completed.push(value.sources[0].completed[0]),
    value => { value.sources[0].completed[0].page = 3; },
    value => { value.sources[0].completed[0].textSha256 = "bad"; },
    value => { value.sources[0].completed[0].text = "Injected evidence"; },
    value => { value.sources[0].completed[0].characters = 50_001; },
    value => { value.sources[0].completed[0].confidence = NaN; },
    value => { value.sources[0].completed.pop(); },
    value => { value.sources[0].issues.push({ page: 1, reason: "failed", message: "Contradiction" }); },
  ]) {
    const value = structuredClone(storage.checkpoint); corrupt(value);
    await assert.rejects(controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", onBatch: async () => assert.fail("wrote invalid checkpoint"), loadCheckpoint: async () => value }), /invalid/);
  }
});

test("checkpoint writes are awaited and failure stops later page windows instead of claiming unsaved progress", async () => {
  const blob = fixture(25, page => `Selectable ${page}`), seen = [], batches = [];
  const originalPdf = globalThis.__packagePdf; globalThis.__packagePdf = async (blob, options) => { seen.push(options.pageWindow.start); return originalPdf(blob, options); };
  await assert.rejects(controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", onBatch: async batch => {
    batches.push(batch); if (batch.pages.length) throw Error("Checkpoint storage unavailable");
  } }), /Checkpoint storage unavailable/);
  assert.deepEqual(seen, [1, 1]); assert.equal(batches.length, 2); assert.equal(batches[1].pages.length, 10);
});

test("lazy originals load sequentially and a replacement between preflight and reading is rejected", async () => {
  const blob = fixture(1), storage = store(); let calls = 0;
  await assert.rejects(controlled.readDocumentPackage([{ document: doc(), loadOriginal: async () => ++calls === 1 ? blob : new Blob(["%PDF-replacement"], { type: "application/pdf" }) }], { accessIdentity: "scope-A", ...storage }), /changed/);
  assert.equal(storage.pages.size, 0); assert.equal(storage.writes.length, 1);
  let active = 0, peak = 0; const history = [];
  const inputs = ["A", "B"].map(id => ({ document: doc(id), loadOriginal: async () => { active++; peak = Math.max(peak, active); history.push(id); await Promise.resolve(); active--; return blob; } }));
  await controlled.readDocumentPackage(inputs, { accessIdentity: "scope-A", ...store() });
  assert.equal(peak, 1); assert.deepEqual(history, ["A", "B", "A", "B"]);
});

test("hybrid footer pages require full-page OCR at physical page 500 and no failed footer is accepted", async () => {
  const blob = fixture(500, page => `Footer ${page}`), storage = store(), base = globalThis.__packagePdf, calls = [];
  globalThis.__packagePdf = async (...args) => { const result = await base(...args); result.pages.forEach(page => { if (page.page === 500) page.requiresOcr = true; }); return result; };
  globalThis.__packageOcr = async (_blob, page, options) => { assert.equal(options.packageMode, true); calls.push(page); throw Error("failed scanned body"); };
  const result = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  assert.deepEqual(calls, [500]); assert.equal(result.status, "partial"); assert.deepEqual(result.unread[0].pages, [500]); assert.equal(storage.pages.has("source-A/500"), false);
});

test("batch validation bounds attempts, page evidence, text and mismatched metadata before persistence", async () => {
  const blob = fixture(1), storage = store(); await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  const valid = storage.writes.find(batch => batch.pages.length);
  for (const corrupt of [
    batch => batch.attemptedPages.push(1), batch => { batch.pages[0].text = " "; }, batch => { batch.pages[0].text = "x".repeat(50_001); },
    batch => { batch.pages[0].page = 2; }, batch => { batch.pages[0].text += "\0"; }, batch => { batch.pages[0].method = "invented"; },
    batch => { batch.pages[0].rotation = 360; }, batch => { batch.pages[0].confidence = -1; },
  ]) { const batch = structuredClone(valid); corrupt(batch); assert.throws(() => controlled.validatePackageScanBatch(batch), /invalid/); }
});

test("package text budget flags oversized and exhausted pages without truncating or losing readable later evidence", async () => {
  const blob = fixture(110), storage = store();
  globalThis.__packageOcr = async (_blob, page) => ({ confidence: 90, text: page === 1 ? "x".repeat(50_001) : page <= 101 ? "x".repeat(49_999) : page === 102 ? "y".repeat(200) : "Late field" });
  const result = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", ...storage });
  assert.equal(result.status, "partial"); assert.deepEqual(result.unread[0].pages, [1, 102]);
  assert.ok(result.checkpoint.sources[0].issues.every(issue => issue.reason === "text_limit"));
  assert.equal(storage.pages.get("source-A/110").text, "Late field");
  assert.equal(result.checkpoint.sources[0].completed.reduce((sum, page) => sum + page.characters, 0), 4_999_980);
  assert.ok(storage.writes.every(batch => batch.pages.reduce((sum, page) => sum + page.text.length, 0) <= controlled.PACKAGE_SCAN_LIMITS.batchCharacters));
});

test("callback mutation cannot inject resume receipts or change another batch's document identity", async () => {
  const blob = fixture(12, page => `Evidence ${page}`), seen = [];
  const result = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", onBatch: async (batch, checkpoint) => {
    seen.push(structuredClone(batch));
    batch.source.documentId = "injected";
    checkpoint.accessIdentity = "other-user";
    checkpoint.sources[0].completed.length = 0;
  } });
  assert.equal(result.completedPages, 12); assert.equal(result.checkpoint.accessIdentity, "scope-A");
  assert.ok(seen.every(batch => batch.source.documentId === "source-A"));
});

test("cancellation during storage acknowledgement retains the saved batch and publishes no later pages", async () => {
  const blob = fixture(25, page => `Evidence ${page}`), storage = store(), abort = new AbortController();
  const result = await controlled.readDocumentPackage([{ document: doc(), blob }], { accessIdentity: "scope-A", signal: abort.signal, onBatch: async (batch, checkpoint) => {
    await storage.onBatch(batch, checkpoint); if (batch.pages.length) abort.abort();
  } });
  assert.equal(result.status, "cancelled"); assert.equal(result.completedPages, 10); assert.equal(storage.pages.size, 10);
  assert.deepEqual(result.unread[0].pages, Array.from({ length: 15 }, (_, i) => i + 11));
});

test("plain-text and image originals retain independent source identity and never invent PDF pages", async () => {
  fixture(1); const storage = store();
  const result = await controlled.readDocumentPackage([
    { document: doc("text", "text/plain"), blob: new Blob(["Recorded principal: $275,000"], { type: "text/plain" }) },
    { document: doc("scan", "image/png"), blob: new Blob(["controlled image"], { type: "image/png" }) },
  ], { accessIdentity: "scope-A", ...storage });
  assert.equal(result.status, "complete"); assert.equal(result.totalPages, 2);
  assert.equal(storage.pages.get("text/1").method, "source-text"); assert.equal(storage.pages.get("scan/1").method, "ocr");
  assert.ok(result.checkpoint.sources.every(source => source.totalPages === 1));
});
