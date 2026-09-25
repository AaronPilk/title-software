import { applicationVisualText, applicationWidgetsNeedOcr } from "./pdf-visual-text";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";

export const PDF_TEXT_LIMITS = { bytes: 26_214_400, pages: 120, characters: 500_000, pageCharacters: 50_000, milliseconds: 20_000 } as const;
/** Package mode opens only this bounded window, never all 1,000 pages. */
export const PDF_PACKAGE_LIMITS = { pages: 1_000, windowPages: 20 } as const;
export type PdfTextPage = { page: number; text: string; status: "text" | "empty"; requiresOcr?: boolean };
export type PdfTextReview = {
  status: "ready" | "partial" | "needs_review";
  reason?: "empty" | "password" | "unreadable" | "too_large" | "page_limit" | "text_limit" | "timeout" | "cancelled";
  pages: PdfTextPage[]; totalPages: number; message: string; failedPages?: number[];
};
type Engine = { getDocument: (options: Record<string, unknown>) => PDFDocumentLoadingTask; imagePaintOps?: ReadonlySet<number> };
type Options = { layout?: "application"; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void; engine?: Engine; timeoutMs?: number; continueOnPageError?: boolean; detectRasterContent?: boolean;
  /** count=0 reads the page count without loading page content. Other windows contain at most 20 pages. */
  pageWindow?: { start: number; count: number } };
class ReviewStop extends Error {
  constructor(public readonly reason: NonNullable<PdfTextReview["reason"]>, message: string) { super(message); }
}
// Font/CMap/wasm fetches are disabled: this operation reads only the supplied bytes.
// Documents needing external mapping data remain a manual-review case.
class LocalOnlyBinaryData {
  async fetch(): Promise<never> { throw new Error("This document requires additional font mapping data."); }
}
async function engine(): Promise<Engine> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return { getDocument: options => pdfjs.getDocument(options), imagePaintOps: new Set([
    pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup, pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintInlineImageXObjectGroup, pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintSolidColorImageMask,
  ]) };
}
/** Read selectable text only. Page numbers always refer to physical PDF pages (starting at one). */
export async function extractPdfText(file: Blob, options: Options = {}): Promise<PdfTextReview> {
  const pageWindow = options.pageWindow ? { ...options.pageWindow } : undefined;
  if (pageWindow && (!Number.isSafeInteger(pageWindow.start) || pageWindow.start < 1 || pageWindow.start > PDF_PACKAGE_LIMITS.pages ||
    !Number.isSafeInteger(pageWindow.count) || pageWindow.count < 0 || pageWindow.count > PDF_PACKAGE_LIMITS.windowPages ||
    pageWindow.start + Math.max(0, pageWindow.count - 1) > PDF_PACKAGE_LIMITS.pages))
    return { status: "needs_review", reason: "page_limit", pages: [], totalPages: 0, message: "Choose a package window of at most 20 physical pages between 1 and 1,000." };
  if (!file.size || file.size > PDF_TEXT_LIMITS.bytes)
    return { status: "needs_review", reason: "too_large", pages: [], totalPages: 0, message: "Choose a nonempty PDF up to 25 MB for local text review." };
  let task: PDFDocumentLoadingTask | undefined;
  let stopped = false;
  let totalPages = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let stop: ((reason: ReviewStop) => void) | undefined;
  const cancelled = () => stop?.(new ReviewStop("cancelled", "Document text review was cancelled."));
  const timeoutMs = Math.min(PDF_TEXT_LIMITS.milliseconds, Math.max(1, options.timeoutMs || PDF_TEXT_LIMITS.milliseconds));
  try {
    const interrupted = new Promise<never>((_, reject) => {
      stop = reject;
      timer = setTimeout(() => reject(new ReviewStop("timeout", "This PDF took too long to read. Review the original or use a smaller document.")), timeoutMs);
    });
    options.signal?.addEventListener("abort", cancelled, { once: true });
    if (options.signal?.aborted) cancelled();
    const read = async (): Promise<PdfTextReview> => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (stopped || options.signal?.aborted) throw new ReviewStop("cancelled", "Document text review was cancelled.");
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
        throw new ReviewStop("unreadable", "This file is not a readable PDF. Review its original contents.");
      const pdfjs = options.engine || await engine();
      if (stopped || options.signal?.aborted) throw new ReviewStop("cancelled", "Document text review was cancelled.");
      // A copy is transferred to PDF.js; the stored Blob and original document are never modified.
      task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useWasm: false, disableFontFace: true,
        useSystemFonts: false, stopAtErrors: true, enableXfa: false, isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false, BinaryDataFactory: LocalOnlyBinaryData, verbosity: 0 });
      const pdf = await task.promise;
      totalPages = pdf.numPages;
      const limit = pageWindow ? PDF_PACKAGE_LIMITS.pages : PDF_TEXT_LIMITS.pages;
      if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > limit)
        throw new ReviewStop("page_limit", pageWindow ? "Package review supports up to 1,000 physical pages across all originals." : "Local text review supports up to 120 pages. Split a copy into a smaller document or review the original.");
      if (pageWindow?.count === 0) return { status: "ready", pages: [], totalPages, message: "Package page count is ready. No page content has been read yet." };
      const first = pageWindow?.start || 1;
      if (first > totalPages) throw new ReviewStop("page_limit", "Choose physical pages that exist in this PDF.");
      const last = pageWindow ? Math.min(totalPages, first + pageWindow.count - 1) : totalPages;
      const pages: PdfTextPage[] = [], failedPages: number[] = []; let characters = 0;
      for (let pageNumber = first; pageNumber <= last; pageNumber++) {
        if (stopped || options.signal?.aborted) throw new ReviewStop("cancelled", "Document text review was cancelled.");
        let page: PDFPageProxy | undefined;
        try {
          page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
          let text = "";
          for (const item of content.items) {
            if (!("str" in item)) continue;
            // Preserve line breaks; separate adjacent glyph runs to avoid joining table values.
            text += item.str + (item.hasEOL ? "\n" : " ");
            if (text.length > PDF_TEXT_LIMITS.pageCharacters || characters + text.length > PDF_TEXT_LIMITS.characters)
              throw new ReviewStop("text_limit", "This PDF contains more text than local review can safely display. Review a smaller document or the original.");
          }
          let requiresOcr = false;
          if (options.layout === "application") {
            const widgets = await page.getAnnotations({ intent: "display" });
            text = applicationVisualText(content.items);
            requiresOcr = applicationWidgetsNeedOcr(widgets);
            if (text.length > PDF_TEXT_LIMITS.pageCharacters || characters + text.length > PDF_TEXT_LIMITS.characters)
              throw new ReviewStop("text_limit", "This form contains more text than application review can safely read.");
          }
          text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          if (text && options.detectRasterContent) {
            // A selectable footer or incomplete text layer cannot stand in for
            // a scanned body. Check actual paint operations (not merely image
            // resources, which may be unused). Logos also conservatively trigger
            // full-page OCR. All operator/image data stays in this local parser.
            if (!pdfjs.imagePaintOps?.size) throw new Error("Image-content inspection unavailable.");
            const operators = await page.getOperatorList();
            requiresOcr ||= operators.fnArray.some(operation => pdfjs.imagePaintOps!.has(operation));
          }
          characters += text.length;
          pages.push({ page: pageNumber, text, status: text ? "text" : "empty", ...(requiresOcr ? { requiresOcr } : {}) });
        } catch (error) {
          if (stopped || options.signal?.aborted) throw new ReviewStop("cancelled", "Document text review was cancelled.");
          const password = error && typeof error === "object" && "name" in error && error.name === "PasswordException";
          // Full-document OCR can recover an individual page whose text layer is
          // damaged. Global limits/password/cancellation still stop the document.
          if (!options.continueOnPageError || error instanceof ReviewStop || password) throw error;
          pages.push({ page: pageNumber, text: "", status: "empty" }); failedPages.push(pageNumber);
        } finally { page?.cleanup(); }
        options.onProgress?.(pageNumber, totalPages);
      }
      const empty = pages.filter(p => p.status === "empty").length;
      const failures = failedPages.length ? { failedPages } : {};
      if (empty === pages.length) return { status: "needs_review", reason: "empty", pages, totalPages, ...failures,
        message: "No selectable text was found. This PDF may be scanned; review the original or use OCR before capturing evidence." };
      const hybrid = pages.filter(page => page.requiresOcr).length;
      if (hybrid) return { status: "partial", pages, totalPages, ...failures,
        message: `${hybrid} page(s) contain images or filled form fields and require full-page OCR. Review all results against the original.` };
      return { status: empty ? "partial" : "ready", pages, totalPages, ...failures,
        message: empty ? `${empty} page${empty === 1 ? " has" : "s have"} no selectable text. Review those pages in the original or use OCR.` : "Selectable text is ready for page-by-page review." };
    };
    return await Promise.race([read(), interrupted]);
  } catch (reason) {
    if (reason instanceof ReviewStop) return { status: "needs_review", reason: reason.reason, pages: [], totalPages, message: reason.message };
    const password = reason && typeof reason === "object" && "name" in reason && reason.name === "PasswordException";
    return { status: "needs_review", reason: password ? "password" : "unreadable", pages: [], totalPages,
      message: password ? "This PDF is password protected. Open it in your approved document viewer or use an authorized unlocked copy." : "Text could not be read reliably from this PDF. Review the original document before capturing evidence." };
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancelled);
    // Terminate this task's worker even after timeouts; do not retain document bytes in memory.
    if (task) await task.destroy().catch(() => undefined);
  }
}

export function pdfPageCitation(document: { id: string; name: string; version: number }, page: number, text: string): string {
  if (!Number.isSafeInteger(page) || page < 1 || !text.trim()) throw new Error("Select text from a numbered page first.");
  return `${document.name} · version ${document.version} · PDF page ${page}\nDocument: ${document.id}\n\n${text.trim()}`;
}
