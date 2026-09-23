import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfText, pdfPageCitation, PDF_TEXT_LIMITS } from "../.local-test/pdf-text/api.mjs";

// Construct a small, valid PDF in memory. No real client document enters these tests.
function pdfFixture(texts) {
  const objects = [];
  const add = text => { objects.push(text); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = texts.map((_, i) => 4 + i * 2);
  add(`<< /Type /Pages /Kids [${pageIds.map(n => `${n} 0 R`).join(" ")}] /Count ${texts.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const text of texts) {
    const pageId = objects.length + 1;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET` : "0.5 w 72 720 m 200 720 l S";
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let source = "%PDF-1.7\n", offsets = [0];
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([source], { type: "application/pdf" });
}
const file = pdfFixture(["Synthetic title evidence"]);
function fakeEngine({ pages = [[{ str: "Synthetic text", hasEOL: true }]], count = pages.length, error, stall = false, onDestroy, onOptions, pageErrors = {}, textErrors = {}, operators = {}, operatorError, onOperatorList, onPage, onCleanup } = {}) {
  const task = { destroyed: false, destroy: async () => { task.destroyed = true; onDestroy?.(); } };
  return { task, imagePaintOps: new Set([83, 84, 85, 86, 87, 88, 89, 90]), getDocument(options) {
    onOptions?.(options);
    task.promise = stall ? new Promise(() => {}) : error ? Promise.reject(error) : Promise.resolve({ numPages: count,
      getPage: async number => { onPage?.(number);if (pageErrors[number]) throw pageErrors[number];return { getTextContent: async () => { if (textErrors[number]) throw textErrors[number];return { items: pages[number - 1] }; }, getOperatorList: async () => { onOperatorList?.(number);if (operatorError) throw operatorError;return { fnArray: operators[number] || [] }; }, cleanup() { onCleanup?.(number); } }; } });
    return task;
  } };
}

test("real PDF.js extracts all physical pages from a valid synthetic PDF", async () => {
  const source = pdfFixture(["Owner: Example Buyer", "Loan amount: 250000"]);
  const original = new Uint8Array(await source.arrayBuffer()), progress = [];
  const result = await extractPdfText(source, { onProgress: (n, total) => progress.push([n, total]) });
  assert.equal(result.status, "ready"); assert.equal(result.totalPages, 2);
  assert.deepEqual(result.pages.map(p => p.page), [1, 2]);
  assert.match(result.pages[0].text, /Owner: Example Buyer/); assert.match(result.pages[1].text, /Loan amount: 250000/);
  assert.deepEqual(progress, [[1, 2], [2, 2]]); assert.deepEqual(new Uint8Array(await source.arrayBuffer()), original);
});
test("image/drawing-only PDFs return an explicit no-selectable-text review outcome", async () => {
  const result = await extractPdfText(pdfFixture([""]));
  assert.equal(result.status, "needs_review"); assert.equal(result.reason, "empty");
  assert.deepEqual(result.pages, [{ page: 1, text: "", status: "empty" }]); assert.match(result.message, /OCR/);
});
test("mixed PDFs preserve blank page numbers instead of claiming all pages were read as text", async () => {
  const result = await extractPdfText(pdfFixture(["First page text", "", "Third page text"]));
  assert.equal(result.status, "partial"); assert.equal(result.totalPages, 3);
  assert.equal(result.pages[1].status, "empty"); assert.equal(result.pages[2].page, 3); assert.match(result.message, /1 page has no selectable text/);
});
test("malformed and non-PDF files produce manual review without invented content", async () => {
  for (const blob of [new Blob(["%PDF-1.7\ninvalid"]), new Blob(["<html>not a PDF</html>"])]) {
    const result = await extractPdfText(blob); assert.equal(result.reason, "unreadable"); assert.deepEqual(result.pages, []);
  }
});
test("encrypted PDF errors are translated to a clear password-required outcome", async () => {
  const error = Object.assign(new Error("sensitive parser details"), { name: "PasswordException" });
  const engine = fakeEngine({ error }), result = await extractPdfText(file, { engine });
  assert.equal(result.reason, "password"); assert.match(result.message, /password protected/); assert.ok(!result.message.includes("sensitive")); assert.equal(engine.task.destroyed, true);
});
test("empty or oversized blobs are rejected before PDF.js is loaded", async () => {
  const engine = { getDocument: () => assert.fail("loaded parser") };
  assert.equal((await extractPdfText(new Blob([]), { engine })).reason, "too_large");
  assert.equal((await extractPdfText({ size: PDF_TEXT_LIMITS.bytes + 1 }, { engine })).reason, "too_large");
});
test("large page counts stop before any page is read and destroy the parser", async () => {
  const engine = fakeEngine({ count: PDF_TEXT_LIMITS.pages + 1 });
  const result = await extractPdfText(file, { engine }); assert.equal(result.reason, "page_limit"); assert.equal(result.totalPages, 121); assert.equal(engine.task.destroyed, true);
});
test("text volume limits fail visibly instead of silently truncating evidence", async () => {
  const page = [{ str: "x".repeat(PDF_TEXT_LIMITS.pageCharacters + 1) }];
  const engine = fakeEngine({ pages: [page] }), result = await extractPdfText(file, { engine });
  assert.equal(result.reason, "text_limit"); assert.deepEqual(result.pages, []); assert.equal(engine.task.destroyed, true);
  const many = fakeEngine({ pages: Array.from({ length: 11 }, () => [{ str: "x".repeat(49_999) }]) });
  assert.equal((await extractPdfText(file, { engine: many })).reason, "text_limit");
});
test("timeout and cancellation terminate pending worker work", async () => {
  const timeout = fakeEngine({ stall: true });
  assert.equal((await extractPdfText(file, { engine: timeout, timeoutMs: 10 })).reason, "timeout"); assert.equal(timeout.task.destroyed, true);
  const abort = new AbortController(), cancelled = fakeEngine({ stall: true });
  const promise = extractPdfText(file, { engine: cancelled, signal: abort.signal });
  setTimeout(() => abort.abort(), 5);
  assert.equal((await promise).reason, "cancelled"); assert.equal(cancelled.task.destroyed, true);
});
test("pre-cancelled extraction does not start a parser or return hidden content", async () => {
  const abort = new AbortController(); abort.abort();
  const result = await extractPdfText(file, { engine: { getDocument: () => assert.fail("started") }, signal: abort.signal });
  assert.equal(result.reason, "cancelled"); assert.deepEqual(result.pages, []);
});
test("parser configuration never asks PDF.js to load document URLs, external fonts, wasm or XFA", async () => {
  let options;
  await extractPdfText(file, { engine: fakeEngine({ onOptions: value => options = value }) });
  assert.ok(options.data instanceof Uint8Array); assert.equal(options.url, undefined);
  assert.equal(options.useWorkerFetch, false); assert.equal(options.useWasm, false); assert.equal(options.enableXfa, false);
  assert.equal(options.stopAtErrors, true); await assert.rejects(new options.BinaryDataFactory().fetch(), /additional font mapping/);
});
test("glyph runs and lines retain separators rather than joining adjacent values", async () => {
  const engine = fakeEngine({ pages: [[{ str: "250000", hasEOL: false }, { str: "300000", hasEOL: true }, { type: "beginMarkedContent" }, { str: "Second line", hasEOL: true }]] });
  const result = await extractPdfText(file, { engine }); assert.equal(result.pages[0].text, "250000 300000\nSecond line");
});
test("copied excerpts include a stable document/version and physical page reference", () => {
  const citation = pdfPageCitation({ id: "doc-original", name: "Deed.pdf", version: 3 }, 7, "  Reviewed wording  ");
  assert.equal(citation, "Deed.pdf · version 3 · PDF page 7\nDocument: doc-original\n\nReviewed wording");
  assert.throws(() => pdfPageCitation({ id: "d", name: "D", version: 1 }, 0, "wording"));
  assert.throws(() => pdfPageCitation({ id: "d", name: "D", version: 1 }, 1, " "));
});


test("opt-in page recovery retains exact later page numbers and reports text-index failures", async () => {
  const read = [], cleaned = [], progress = [], engine = fakeEngine({ pages: [[{ str: "First" }], [{ str: "Second" }], [{ str: "Third" }]],
    pageErrors: { 1: Error("private getPage details") }, textErrors: { 2: Error("private text details") }, onPage: number => read.push(number), onCleanup: number => cleaned.push(number) });
  const result = await extractPdfText(file, { engine, continueOnPageError: true, onProgress: (page, total) => progress.push([page, total]) });
  assert.equal(result.status, "partial");assert.deepEqual(result.failedPages, [1, 2]);assert.deepEqual(result.pages.map(page => [page.page, page.text]), [[1, ""], [2, ""], [3, "Third"]]);
  assert.deepEqual(read, [1, 2, 3]);assert.deepEqual(cleaned, [2, 3]);assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);assert.equal(engine.task.destroyed, true);assert.ok(!JSON.stringify(result).includes("private"));
});
test("ordinary PDF text reads retain fail-closed behavior on an individual page error", async () => {
  const pages = [], engine = fakeEngine({ count: 3, textErrors: { 1: Error("private") }, onPage: number => pages.push(number) });
  const result = await extractPdfText(file, { engine });assert.equal(result.reason, "unreadable");assert.deepEqual(result.pages, []);assert.deepEqual(pages, [1]);assert.equal(engine.task.destroyed, true);
});
test("opt-in page recovery does not bypass passwords, text limits, page limits or timeouts", async () => {
  const password = fakeEngine({ textErrors: { 1: Object.assign(Error("private"), { name: "PasswordException" }) } });
  assert.equal((await extractPdfText(file, { engine: password, continueOnPageError: true })).reason, "password");
  const huge = fakeEngine({ pages: [[{ str: "x".repeat(PDF_TEXT_LIMITS.pageCharacters + 1) }]] });
  const result = await extractPdfText(file, { engine: huge, continueOnPageError: true });assert.equal(result.reason, "text_limit");assert.deepEqual(result.pages, []);
  assert.equal((await extractPdfText(file, { engine: fakeEngine({ count: 121 }), continueOnPageError: true })).reason, "page_limit");
  assert.equal((await extractPdfText(file, { engine: fakeEngine({ stall: true }), timeoutMs: 1, continueOnPageError: true })).reason, "timeout");
});

test("full-reader raster inspection marks every image-paint kind without treating pure text as complete image content", async () => {
  for (const operation of [83, 84, 85, 86, 87, 88, 89, 90]) {
    const engine = fakeEngine({ pages: [[{ str: "Page 1" }], [{ str: "Pure text" }]], operators: { 1: [operation], 2: [31, 44] } });
    const result = await extractPdfText(file, { engine, detectRasterContent: true, continueOnPageError: true });
    assert.equal(result.status, "partial");assert.equal(result.pages[0].requiresOcr, true);assert.equal(result.pages[0].text, "Page 1");assert.equal(result.pages[1].requiresOcr, undefined);
  }
});
test("ordinary selectable-text reads do not inspect image operators", async () => {
  const engine = fakeEngine({ onOperatorList: () => assert.fail("unexpected image inspection"), operators: { 1: [85] } });
  const result = await extractPdfText(file, { engine });assert.equal(result.status, "ready");assert.equal(result.pages[0].requiresOcr, undefined);
});
test("image-inspection errors become unread page placeholders instead of trusting selectable footers", async () => {
  const engine = fakeEngine({ operatorError: Error("private image operator detail") });
  const result = await extractPdfText(file, { engine, detectRasterContent: true, continueOnPageError: true });
  assert.deepEqual(result.failedPages, [1]);assert.deepEqual(result.pages, [{ page: 1, text: "", status: "empty" }]);assert.equal(result.status, "needs_review");assert.ok(!JSON.stringify(result).includes("private"));
});

test("package preflight counts 1,000 physical pages without loading any page content", async () => {
  const engine = fakeEngine({ count: 1_000, onPage: () => assert.fail("preflight loaded a page") });
  const result = await extractPdfText(file, { engine, pageWindow: { start: 1, count: 0 } });
  assert.equal(result.status, "ready"); assert.equal(result.totalPages, 1_000); assert.deepEqual(result.pages, []); assert.equal(engine.task.destroyed, true);
});

test("package text windows read only the requested late physical pages and release the parser", async () => {
  const read = [], cleaned = [], pages = Array.from({ length: 500 }, (_, i) => [{ str: `Physical ${i + 1}` }]);
  const engine = fakeEngine({ pages, onPage: number => read.push(number), onCleanup: number => cleaned.push(number) });
  const result = await extractPdfText(file, { engine, pageWindow: { start: 499, count: 2 } });
  assert.equal(result.status, "ready"); assert.equal(result.totalPages, 500); assert.deepEqual(read, [499, 500]); assert.deepEqual(cleaned, [499, 500]);
  assert.deepEqual(result.pages.map(page => [page.page, page.text]), [[499, "Physical 499"], [500, "Physical 500"]]); assert.equal(engine.task.destroyed, true);
});

test("package windows cannot increase page, text, or time limits and ordinary review stays capped at 120", async () => {
  for (const pageWindow of [{ start: 0, count: 1 }, { start: 1, count: 21 }, { start: 1, count: -1 }, { start: 1.5, count: 1 }, { start: 999, count: 3 }, { start: 1001, count: 0 }]) {
    const result = await extractPdfText(file, { engine: { getDocument: () => assert.fail("invalid window loaded parser") }, pageWindow });
    assert.equal(result.reason, "page_limit");
  }
  assert.equal((await extractPdfText(file, { engine: fakeEngine({ count: 1_001 }), pageWindow: { start: 1, count: 0 } })).reason, "page_limit");
  assert.equal((await extractPdfText(file, { engine: fakeEngine({ count: 500 }) })).reason, "page_limit");
  assert.equal((await extractPdfText(file, { engine: fakeEngine({ pages: [[{ str: "x".repeat(50_001) }]] }), pageWindow: { start: 1, count: 1 } })).reason, "text_limit");
  assert.equal((await extractPdfText(file, { engine: fakeEngine({ stall: true }), pageWindow: { start: 1, count: 0 }, timeoutMs: 1 })).reason, "timeout");
});

test("mutating a page window after parsing starts cannot widen the checked read", async () => {
  const read = [], pageWindow = { start: 1, count: 1 }, engine = fakeEngine({ pages: [[{ str: "First" }], [{ str: "Second" }]], onOptions: () => { pageWindow.count = 1_000; }, onPage: number => read.push(number) });
  const result = await extractPdfText(file, { engine, pageWindow });
  assert.equal(result.status, "ready"); assert.deepEqual(read, [1]);
});
