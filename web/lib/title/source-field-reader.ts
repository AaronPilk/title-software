import type { VaultDoc } from "./model";
import type { SourceFieldPage } from "./field-extraction";
import { extractPdfText } from "./pdf-text";
import { recognizeDocumentPage } from "./local-ocr";

export const SOURCE_SCAN_LIMIT = 6;
export type SourceReadResult = { pages: SourceFieldPage[]; totalPages: number; unreadPages: number[]; notes: string[] };
type Options = { signal?: AbortSignal; scanPages?: string; rotation?: 0 | 90 | 180 | 270; onProgress?: (message: string) => void };

export function scanPageSelection(value: string): number[] {
  if (!value.trim()) return [];
  if (value.length > 100) throw new Error("Choose up to six scanned pages, such as 1, 3-5.");
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
    if (!match) throw new Error("Use page numbers or ranges, such as 1, 3-5.");
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > 120 || end - start >= SOURCE_SCAN_LIMIT)
      throw new Error("Choose up to six scanned pages between 1 and 120.");
    for (let p = start; p <= end; p++) pages.add(p);
    if (pages.size > SOURCE_SCAN_LIMIT) throw new Error("Read up to six scanned pages per run.");
  }
  return [...pages].sort((a, b) => a - b);
}

/** Bounded local reading only. Returned text is evidence for suggestions, never approval. */
export async function readFieldSource(doc: VaultDoc, blob: Blob | undefined, options: Options = {}): Promise<SourceReadResult> {
  const check = () => { if (options.signal?.aborted) throw new Error("Reading cancelled."); };
  check();
  const requested = scanPageSelection(options.scanPages || "");
  if (!blob) {
    if (doc.assetId) throw new Error("The original attachment is unavailable. Restore or download it before reading.");
    if (!doc.text?.trim() || doc.text.length > 50_000) throw new Error("Choose a source excerpt with at most 50,000 characters.");
    if (requested.length) throw new Error("Page selection is only available for original PDFs.");
    return { pages: [{ page: 1, text: doc.text, method: "source-text" }], totalPages: 1, unreadPages: [], notes: ["This is a saved source excerpt. Confirm its original page reference before saving fields."] };
  }
  if (!blob.size || blob.size > 26_214_400) throw new Error("Choose a nonempty original up to 25 MB.");
  if ((blob.type || "application/octet-stream") !== doc.mime) throw new Error("The original's file type does not match its document record.");
  if (doc.mime === "text/plain") {
    if (requested.length) throw new Error("Page selection is only available for original PDFs.");
    if (blob.size > 50_000) throw new Error("Text source review supports up to 50,000 bytes.");
    const text = await blob.text(); check();
    return { pages: [{ page: 1, text, method: "source-text" }], totalPages: 1, unreadPages: [], notes: ["Text file: confirm any original page references manually."] };
  }
  if (!["application/pdf", "image/png", "image/jpeg"].includes(doc.mime || "")) throw new Error("Read a PDF, PNG, JPEG or plain text original.");
  if (doc.mime !== "application/pdf") {
    if (requested.some(p => p !== 1)) throw new Error("An image contains one page.");
    const result = await recognizeDocumentPage(blob, 1, { signal: options.signal, rotation: options.rotation, onProgress: p => options.onProgress?.(`${p.phase} · ${Math.round(p.progress * 100)}%`) }); check();
    return { pages: [{ page: 1, text: result.text, method: "ocr", confidence: result.confidence }], totalPages: 1, unreadPages: result.text.trim() ? [] : [1], notes: [] };
  }
  options.onProgress?.("Reading selectable PDF text…");
  const read = await extractPdfText(blob, { signal: options.signal, onProgress: (p, n) => options.onProgress?.(`Reading PDF page ${p} of ${n}`) }); check();
  if (!read.pages.length) throw new Error(read.message);
  if (requested.some(p => p > read.totalPages)) throw new Error(`This PDF has ${read.totalPages} pages. Choose pages from this document.`);
  const pages: SourceFieldPage[] = read.pages.filter(p => p.text.trim()).map(p => ({ page: p.page, text: p.text, method: "pdf-text" }));
  const empty = read.pages.filter(p => !p.text.trim()).map(p => p.page);
  const scans = requested.length ? requested : empty.slice(0, SOURCE_SCAN_LIMIT);
  const notes: string[] = [];
  for (const page of scans) {
    check();
    options.onProgress?.(`Reading scanned page ${page} (${scans.indexOf(page) + 1} of ${scans.length})…`);
    const result = await recognizeDocumentPage(blob, page, { signal: options.signal, rotation: options.rotation, onProgress: p => options.onProgress?.(`Page ${page}: ${p.phase} · ${Math.round(p.progress * 100)}%`) }); check();
    const prior = pages.findIndex(p => p.page === page);
    if (prior >= 0) pages.splice(prior, 1);
    if (result.text.trim()) pages.push({ page, text: result.text, method: "ocr", confidence: result.confidence });
  }
  const unreadPages = read.pages.filter(p => !pages.some(r => r.page === p.page)).map(p => p.page);
  if (unreadPages.length) notes.push(`${unreadPages.length} page(s) remain unread. Choose their page numbers for another run or review them manually.`);
  return { pages: pages.sort((a, b) => a.page - b.page), totalPages: read.totalPages, unreadPages, notes };
}
