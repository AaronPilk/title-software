export const OCR_ASSET_PATH = "/ocr/v7-eng1";
export const OCR_LIMITS = { bytes: 26_214_400, pages: 120, sourcePixels: 12_000_000, rasterPixels: 4_000_000, dimension: 10_000, milliseconds: 90_000, characters: 50_000, words: 10_000 } as const;
export type OcrWord = { text: string; confidence: number; box: { x0: number; y0: number; x1: number; y1: number } };
export type OcrResult = { text: string; confidence: number; words: OcrWord[]; page: number; language: "English"; engine: "Tesseract.js 7.0.0"; width: number; height: number };
export type OcrProgress = { phase: "Opening document" | "Rendering page" | "Loading OCR engine" | "Reading scanned text"; progress: number };
export class OcrError extends Error {
  constructor(public readonly code: "cancelled" | "timeout" | "unsupported" | "size" | "unreadable" | "password" | "page" | "engine", message: string) { super(message); this.name = "OcrError"; }
}
export function boundedRaster(width: number, height: number, scale = 1): { width: number; height: number; scale: number } {
  if (![width, height, scale].every(n => Number.isFinite(n) && n > 0) || width > OCR_LIMITS.dimension || height > OCR_LIMITS.dimension)
    throw new OcrError("size", "This page has unsupported dimensions. Use a smaller copy for OCR.");
  const factor = Math.min(scale, Math.sqrt(OCR_LIMITS.rasterPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), scale: factor };
}
export function ocrCitation(doc: { id: string; name: string; version: number; mime?: string }, result: OcrResult, text: string): string {
  if (!text.trim() || !result.text.includes(text) || !Number.isSafeInteger(result.page) || result.page < 1)
    throw new Error("Select an excerpt from this OCR result first.");
  return `${doc.name} · version ${doc.version} · ${doc.mime === "application/pdf" ? "PDF page" : "Image"} ${result.page}\nDocument: ${doc.id}\nOCR: ${result.engine} · ${result.language} · confidence ${Math.round(result.confidence)}/100 (engine estimate, not an accuracy guarantee)\nVerify against the original before use.\n\n${text.trim()}`;
}
export function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === "image/png" && bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n) && String.fromCharCode(...bytes.slice(12,16)) === "IHDR") {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new OcrError("unreadable", "This file is not a readable PNG or JPEG image.");
  if (width * height > OCR_LIMITS.sourcePixels || width > OCR_LIMITS.dimension || height > OCR_LIMITS.dimension)
    throw new OcrError("size", "Image OCR supports up to 12 megapixels and 10,000 pixels per side. Use a smaller copy.");
  return { width, height };
}
