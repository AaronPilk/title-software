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
function fakeEngine({ pages = [[{ str: "Synthetic text", hasEOL: true }]], count = pages.length, error, stall = false, onDestroy, onOptions } = {}) {
  const task = { destroyed: false, destroy: async () => { task.destroyed = true; onDestroy?.(); } };
  return { task, getDocument(options) {
    onOptions?.(options);
    task.promise = stall ? new Promise(() => {}) : error ? Promise.reject(error) : Promise.resolve({ numPages: count,
      getPage: async number => ({ getTextContent: async () => ({ items: pages[number - 1] }), cleanup() {} }) });
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
