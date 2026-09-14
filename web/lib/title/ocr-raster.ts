import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { boundedRaster, imageDimensions, OCR_LIMITS, OcrError } from "./local-ocr-shared";
export type OcrRaster = { image: Blob; width: number; height: number; page: number };
class NoExternalData { async fetch(): Promise<never> { throw Error("External PDF resources are unavailable."); } }
function check(signal: AbortSignal) { if (signal.aborted) throw new OcrError("cancelled", "OCR was cancelled."); }
function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new OcrError("unreadable", "The image could not be prepared for OCR.")), "image/png"));
}
/** Render exactly one selected physical page; all bytes remain in this browser. */
export async function prepareOcrRaster(file: Blob, pageNumber: number, signal: AbortSignal, onRendering?: () => void): Promise<OcrRaster> {
  check(signal);
  if (!file.size || file.size > OCR_LIMITS.bytes) throw new OcrError("size", "Choose a nonempty PDF, PNG or JPEG up to 25 MB.");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new OcrError("unsupported", "Local OCR supports PDF, PNG and JPEG files.");
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > OCR_LIMITS.pages || (file.type !== "application/pdf" && pageNumber !== 1))
    throw new OcrError("page", "Choose a valid physical page for OCR.");
  const bytes = new Uint8Array(await file.arrayBuffer()); check(signal);
  const canvas = document.createElement("canvas");
  let task: PDFDocumentLoadingTask | undefined, render: RenderTask | undefined, bitmap: ImageBitmap | undefined;
  const cancel = () => { render?.cancel(); void task?.destroy().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (file.type === "application/pdf") {
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new OcrError("unreadable", "This file is not a readable PDF.");
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      check(signal); pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useWasm: false, disableFontFace: true,
        useSystemFonts: false, stopAtErrors: true, enableXfa: false, isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false, maxImageSize: OCR_LIMITS.sourcePixels, BinaryDataFactory: NoExternalData, verbosity: 0 });
      const pdf = await task.promise; check(signal);
      if (pdf.numPages > OCR_LIMITS.pages || pageNumber > pdf.numPages) throw new OcrError("page", "Local OCR supports PDFs up to 120 pages. Choose an existing physical page.");
      const page = await pdf.getPage(pageNumber); check(signal);
      const size = page.getViewport({ scale: 1 });
      const target = boundedRaster(size.width, size.height, 200 / 72);
      canvas.width = target.width; canvas.height = target.height;
      onRendering?.();
      render = page.render({ canvas, viewport: page.getViewport({ scale: target.scale }), background: "white" });
      await render.promise; check(signal); page.cleanup();
    } else {
      imageDimensions(bytes, file.type); // Reject decompression bombs before browser image decoding.
      bitmap = await createImageBitmap(file); check(signal);
      if (bitmap.width * bitmap.height > OCR_LIMITS.sourcePixels) throw new OcrError("size", "This image is too large for local OCR.");
      const target = boundedRaster(bitmap.width, bitmap.height);
      canvas.width = target.width; canvas.height = target.height;
      const context = canvas.getContext("2d"); if (!context) throw Error("Canvas unavailable.");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); onRendering?.();
    }
    const image = await png(canvas); check(signal);
    return { image, width: canvas.width, height: canvas.height, page: pageNumber };
  } catch (error) {
    if (signal.aborted) throw new OcrError("cancelled", "OCR was cancelled.");
    if (error instanceof OcrError) throw error;
    if (error && typeof error === "object" && "name" in error && error.name === "PasswordException") throw new OcrError("password", "This PDF is password protected. Use an authorized unlocked copy.");
    throw new OcrError("unreadable", "This page could not be rendered reliably. Review the original or use a smaller, readable copy.");
  } finally {
    signal.removeEventListener("abort", cancel); bitmap?.close(); canvas.width = canvas.height = 0;
    if (task) await task.destroy().catch(() => undefined);
  }
}
