/** Deliberate attachments only; no screen capture or company-document storage. */
export const MAX_FEEDBACK_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_FEEDBACK_SCREENSHOT_BODY = 5_610_000;
export type FeedbackScreenshotUpload = { fileName: string; mime: "image/png" | "image/jpeg"; base64: string };
const invalid = (): never => { throw new Error("Choose a valid PNG or JPEG screenshot up to 4 MB and 32 million pixels."); };
export function feedbackScreenshotBytes(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > MAX_FEEDBACK_SCREENSHOT_BYTES) return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === "image/png") {
    if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) || view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12,16)) !== "IHDR") return invalid();
    width = view.getUint32(16); height = view.getUint32(20);
    let offset = 8, imageData = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (length > bytes.length - offset - 12 || kind === "acTL") return invalid();
      if (kind === "IDAT") imageData = true;
      offset += length + 12;
      if (kind === "IEND") { if (length || offset !== bytes.length) return invalid(); ended = true; break; }
    }
    if (!imageData || !ended) return invalid();
  } else if (mime === "image/jpeg") {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return invalid();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) return invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker >= 208 && marker <= 215 || marker === 1) continue;
      if (offset + 2 > bytes.length) return invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return invalid();
      if ([192,193,194].includes(marker)) { if (length < 8 || width) return invalid(); height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); }
      offset += length;
    }
  } else return invalid();
  if (!width || !height || width > 12_000 || height > 12_000 || width * height > 32_000_000) return invalid();
  return { width, height };
}
export function encodeFeedbackScreenshot(bytes: Uint8Array) {
  let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function parseFeedbackScreenshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3 || !["fileName", "mime", "base64"].every(k => Object.hasOwn(value, k))) return invalid();
  const raw = value as FeedbackScreenshotUpload;
  if (typeof raw.fileName !== "string" || !raw.fileName.trim() || raw.fileName.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(raw.fileName) || !["image/png", "image/jpeg"].includes(raw.mime) || typeof raw.base64 !== "string" || raw.base64.length > Math.ceil(MAX_FEEDBACK_SCREENSHOT_BYTES / 3) * 4 || (raw.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.base64))) return invalid();
  const bytes = Uint8Array.from(atob(raw.base64), c => c.charCodeAt(0));
  if (encodeFeedbackScreenshot(bytes) !== raw.base64) return invalid();
  return { bytes, mime: raw.mime, fileName: raw.fileName.trim(), ...feedbackScreenshotBytes(bytes, raw.mime) };
}
