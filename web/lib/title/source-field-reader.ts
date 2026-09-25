import type { VaultDoc } from "./model";
import type { SourceFieldPage } from "./field-extraction";
import { extractPdfText } from "./pdf-text";
import { recognizeDocumentPage, type OcrResult } from "./local-ocr";

export const SOURCE_READ_LIMITS = { bytes: 26_214_400, pages: 120, characters: 500_000, pageCharacters: 50_000, lines: 12_000, retainedWordsPerPage: 200 } as const;
/** Maximum physical pages in one document, processed one at a time. */
export const SOURCE_SCAN_LIMIT = SOURCE_READ_LIMITS.pages;
export type SourceReadPage = SourceFieldPage & { rotation?: 0 | 90 | 180 | 270; ocr?: OcrResult; ocrWordCount?: number };
export type SourceReadIssue = { page: number; reason: "empty" | "failed" | "timeout" | "text_limit"; message: string };
export type SourceReadResult = {
  pages: SourceReadPage[]; totalPages: number; unreadPages: number[]; notes: string[];
  status: "reading" | "complete" | "partial" | "cancelled";
  /** Pages with usable text; blank, failed and pending pages are never counted as read. */
  completedPages: number; issues: SourceReadIssue[];
};
export type SourceReadOptions = {
  pdfLayout?: "application"; signal?: AbortSignal; scanPages?: string; rotation?: 0 | 90 | 180 | 270; onProgress?: (message: string) => void;
  priorResult?: SourceReadResult; sourceIdentity?: string; onSnapshot?: (result: SourceReadResult) => void;
};
type RetainedRead = {
  blob: Blob | undefined; fingerprint: string; sourceIdentity: string | undefined; indexed: boolean;
  pages: SourceReadPage[]; totalPages: number; issues: SourceReadIssue[]; notes: string[];
};
// Resume capabilities are private, memory-only and bound to the exact immutable
// original Blob and access scope. Copying/altering a displayed result cannot inject
// evidence into the next run. Closing the reader releases these weak references.
const retained = new WeakMap<SourceReadResult, RetainedRead>();
function copyPage(page: SourceReadPage): SourceReadPage {
  return { ...page, ...(page.ocr ? { ocr: { ...page.ocr, words: page.ocr.words.map(word => ({ ...word, box: { ...word.box } })) } } : {}) };
}
function lineCount(text: string): number {
  return text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(text) ? 1 : 0);
}
function fingerprint(doc: VaultDoc): string {
  return JSON.stringify([doc.id, doc.assetId, doc.version, doc.companyId, doc.orderId, doc.mime, doc.name, doc.assetId ? null : doc.text]);
}

export function scanPageSelection(value: string): number[] {
  if (!value.trim()) return [];
  if (value.length > 500) throw new Error("Choose physical pages between 1 and 120, such as 1, 3-5.");
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
    if (!match) throw new Error("Use page numbers or ranges, such as 1, 3-5.");
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > SOURCE_READ_LIMITS.pages)
      throw new Error("Choose physical pages between 1 and 120.");
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Bounded local reading only. Returned text is evidence for suggestions, never approval. */
export async function readFieldSource(doc: VaultDoc, blob: Blob | undefined, options: SourceReadOptions = {}): Promise<SourceReadResult> {
  if (options.signal?.aborted) throw new Error("Reading cancelled.");
  const requested = scanPageSelection(options.scanPages || "");
  if (options.rotation !== undefined && ![0, 90, 180, 270].includes(options.rotation)) throw new Error("Choose one of the available page orientations.");
  const sourceFingerprint = JSON.stringify([fingerprint(doc), options.pdfLayout]), prior = options.priorResult ? retained.get(options.priorResult) : undefined;
  if (options.priorResult && (!prior || prior.blob !== blob || prior.fingerprint !== sourceFingerprint || prior.sourceIdentity !== options.sourceIdentity))
    throw new Error("The original document or access scope changed. Start a new document scan.");
  const pages = new Map<number, SourceReadPage>(prior?.pages.map(page => [page.page, copyPage(page)]));
  const issues = new Map<number, SourceReadIssue>(prior?.issues.map(issue => [issue.page, { ...issue }]));
  const baseNotes = [...(prior?.notes || [])];
  let totalPages = prior?.totalPages || 0, indexed = prior?.indexed || false;
  const snapshot = (status: SourceReadResult["status"]): SourceReadResult => {
    const sorted = [...pages.values()].sort((a, b) => a.page - b.page).map(copyPage);
    const unreadPages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(page => !pages.has(page));
    const notes = [...baseNotes];
    if (status === "cancelled") notes.push("Scanning paused. Completed pages are retained while this document stays open. Resume to read unfinished pages.");
    if (unreadPages.length && status !== "reading") notes.push(`${unreadPages.length} page(s) remain unread. Retry unfinished pages or review them in the original.`);
    const result: SourceReadResult = { pages: sorted, totalPages, unreadPages, notes, status, completedPages: sorted.length,
      issues: [...issues.values()].sort((a, b) => a.page - b.page).map(issue => ({ ...issue })) };
    retained.set(result, { blob, fingerprint: sourceFingerprint, sourceIdentity: options.sourceIdentity, indexed, totalPages,
      pages: sorted.map(copyPage), issues: result.issues.map(issue => ({ ...issue })), notes: [...baseNotes] });
    options.onSnapshot?.(result);
    return result;
  };
  const finish = () => snapshot(pages.size === totalPages && totalPages > 0 ? "complete" : "partial");
  const accept = (page: SourceReadPage) => {
    // A failed reread must not leave earlier evidence available for that page.
    pages.delete(page.page); issues.delete(page.page);
    if (!page.text.trim()) { issues.set(page.page, { page: page.page, reason: "empty", message: "No readable text found. Review the original or try another orientation." }); return; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(page.text) || (page.confidence !== undefined && (!Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 100))) {
      issues.set(page.page, { page: page.page, reason: "failed", message: "This page contains text that could not be read reliably. Review the original or try a clearer copy." }); return;
    }
    const characters = [...pages.values()].reduce((sum, current) => sum + current.text.length, 0);
    const lines = [...pages.values()].reduce((sum, current) => sum + lineCount(current.text), 0);
    if (page.text.length > SOURCE_READ_LIMITS.pageCharacters || characters + page.text.length > SOURCE_READ_LIMITS.characters || lines + lineCount(page.text) > SOURCE_READ_LIMITS.lines) {
      issues.set(page.page, { page: page.page, reason: "text_limit", message: "This page would exceed the document text limit. Review it in the original or scan a smaller copy." }); return;
    }
    pages.set(page.page, page);
  };
  if (!blob) {
    if (doc.assetId) throw new Error("The original attachment is unavailable. Restore or download it before reading.");
    if (!doc.text?.trim() || doc.text.length > SOURCE_READ_LIMITS.pageCharacters) throw new Error("Choose a source excerpt with at most 50,000 characters.");
    if (requested.length) throw new Error("Page selection is only available for original PDFs.");
    totalPages = 1; indexed = true;
    if (!baseNotes.length) baseNotes.push("This is a saved source excerpt. Confirm its original page reference before saving fields.");
    accept({ page: 1, text: doc.text, method: "source-text" }); return finish();
  }
  if (!blob.size || blob.size > SOURCE_READ_LIMITS.bytes) throw new Error("Choose a nonempty original up to 25 MB.");
  if ((blob.type || "application/octet-stream") !== doc.mime) throw new Error("The original's file type does not match its document record.");
  if (doc.mime === "text/plain") {
    if (requested.length) throw new Error("Page selection is only available for original PDFs.");
    if (blob.size > SOURCE_READ_LIMITS.pageCharacters) throw new Error("Text source review supports up to 50,000 bytes.");
    const text = await blob.text();
    if (options.signal?.aborted) return snapshot("cancelled");
    totalPages = 1; indexed = true;
    if (!baseNotes.length) baseNotes.push("Text file: confirm any original page references manually.");
    accept({ page: 1, text, method: "source-text" }); return finish();
  }
  if (!["application/pdf", "image/png", "image/jpeg"].includes(doc.mime || "")) throw new Error("Read a PDF, PNG, JPEG or plain text original.");
  if (doc.mime !== "application/pdf") {
    if (requested.some(page => page !== 1)) throw new Error("An image contains one page.");
    totalPages = 1; indexed = true;
  } else if (!indexed) {
    options.onProgress?.("Reading selectable PDF text…");
    const rememberTotal = (total: number) => {
      if (Number.isSafeInteger(total) && total >= 1 && total <= SOURCE_READ_LIMITS.pages) totalPages = total;
    };
    const read = await extractPdfText(blob, { layout: options.pdfLayout, signal: options.signal, continueOnPageError: true, detectRasterContent: true, onProgress: (page, total) => {
      rememberTotal(total);
      if (!options.signal?.aborted) options.onProgress?.(`Reading PDF page ${page} of ${total}`);
    } });
    // Interrupted indexing discards partial text, but its known page count still
    // belongs in the paused snapshot. Keep indexed=false so resume retries the
    // text pass instead of treating those pages as an already indexed document.
    rememberTotal(read.totalPages);
    if (options.signal?.aborted || read.reason === "cancelled") return snapshot("cancelled");
    if (!read.pages.length) throw new Error(read.message);
    if (!Number.isSafeInteger(read.totalPages) || read.totalPages < 1 || read.totalPages > SOURCE_READ_LIMITS.pages)
      throw new Error("Document scanning supports up to 120 pages. Split a copy into smaller documents.");
    totalPages = read.totalPages; indexed = true;
    if (read.failedPages?.length) baseNotes.push(`Selectable text could not be read on physical page(s) ${read.failedPages.join(", ")}. Compare any OCR results for these pages against the original.`);
    const hybrid = read.pages.filter(page => page.requiresOcr);
    if (hybrid.length) baseNotes.push(`Physical page(s) ${hybrid.map(page => page.page).join(", ")} combine selectable text and images. Full-page OCR is required before counting these pages as read; even a logo can trigger this check.`);
    for (const page of read.pages) if (page.text.trim() && !page.requiresOcr) accept({ page: page.page, text: page.text, method: "pdf-text" });
  }
  if (requested.some(page => page > totalPages)) throw new Error(`This PDF has ${totalPages} pages. Choose pages from this document.`);
  const scans = requested.length ? requested : Array.from({ length: totalPages }, (_, i) => i + 1).filter(page => !pages.has(page));
  for (const page of scans) { pages.delete(page); issues.delete(page); }
  snapshot("reading");
  for (let index = 0; index < scans.length; index++) {
    const page = scans[index];
    if (options.signal?.aborted) return snapshot("cancelled");
    options.onProgress?.(`Reading scanned page ${page} of ${totalPages} · ${pages.size} pages read · scan ${index + 1} of ${scans.length}`);
    try {
      const result = await recognizeDocumentPage(blob, page, { signal: options.signal, rotation: options.rotation,
        onProgress: update => { if (!options.signal?.aborted) options.onProgress?.(`Page ${page} of ${totalPages} · ${pages.size} pages read · ${update.phase} · ${Math.round(update.progress * 100)}%`); } });
      if (options.signal?.aborted) return snapshot("cancelled");
      // Retain only the table's lowest-confidence 200 words per page. This
      // bounds long-document memory without losing text or citation metadata.
      const ocr = Array.isArray(result.words) ? { ...result, words: [...result.words].sort((a, b) => a.confidence - b.confidence).slice(0, SOURCE_READ_LIMITS.retainedWordsPerPage) } : undefined;
      accept({ page, text: result.text, method: "ocr", confidence: result.confidence, rotation: options.rotation || 0,
        ...(ocr ? { ocr, ocrWordCount: result.words.length } : {}) });
    } catch (error) {
      if (options.signal?.aborted) return snapshot("cancelled");
      const timedOut = error && typeof error === "object" && "code" in error && error.code === "timeout";
      issues.set(page, { page, reason: timedOut ? "timeout" : "failed", message: timedOut
        ? "This page exceeded the 90-second OCR limit. Retry it or review the original."
        : "This page could not be read. Retry it, change its orientation or review the original." });
    }
    snapshot("reading");
  }
  return finish();
}
