import type { VaultDoc } from "./model";
import { safeDocumentMime } from "./backup-assets";
import { documentByteProblem } from "../shared/document-bytes";

export const MAX_FINAL_BUNDLE_BYTES = 64 * 1024 * 1024;
export const MAX_FINAL_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_FINAL_BUNDLE_SOURCES = 50;
const encoder = new TextEncoder();

export function finalDownloadName(value: string) {
  const safe = value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, "-")
    .replace(/\s+/g, " ").replace(/^\.+|[. ]+$/g, "").trim().slice(0, 140);
  return !safe || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `document-${safe || "original"}` : safe;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** A self-contained, printable handoff; all case content remains escaped text. */
export function finalHandoffHtml(report: string, title: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#edf2f7;color:#233a50;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:900px;margin:40px auto;padding:42px;background:#fff;border:1px solid #d6e1eb;border-radius:18px}h1{font-size:27px;line-height:1.3;margin:0 0 12px}.note{padding:14px 17px;background:#f0f5fa;border-radius:10px;color:#516b83;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:28px 0 0}@media(max-width:700px){main{margin:0;border:0;border-radius:0;padding:24px}}@media print{body{background:white}main{max-width:none;margin:0;border:0;padding:0}.note{border:1px solid #ccd7e2}pre{font-size:11pt}}</style></head><body><main><h1>${escapeHtml(title)}</h1><p class="note">Preparation handoff for a human review. This is not an issued policy or underwriter jacket, and downloading it does not send email or record delivery.</p><pre>${escapeHtml(report)}</pre></main></body></html>`;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Standard ZIP "store" records preserve source bytes without recompression. */
function zip(files: { name: string; bytes: Uint8Array }[]) {
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, centralLength = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(12, 33, true); view.setUint32(14, crc, true); view.setUint32(18, file.bytes.length, true); view.setUint32(22, file.bytes.length, true); view.setUint16(26, name.length, true); local.set(name, 30);
    const directory = new Uint8Array(46 + name.length), entry = new DataView(directory.buffer);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(14, 33, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, file.bytes.length, true); entry.setUint32(24, file.bytes.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true); directory.set(name, 46);
    locals.push(local, file.bytes); central.push(directory); offset += local.length + file.bytes.length; centralLength += directory.length;
  }
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true); endView.setUint32(12, centralLength, true); endView.setUint32(16, offset, true);
  return new Blob([...locals, ...central, end].map(bytes => new Uint8Array(bytes).buffer), { type: "application/zip" });
}

export async function createFinalSourceBundle(input: {
  workspaceId: string; orderId: string; companyId: string; worksheetVersion: number;
  report: string; replyText: string; documents: VaultDoc[];
  readOriginal: (document: VaultDoc) => Promise<Blob>;
  assertCurrent: () => void;
}) {
  const { documents, assertCurrent } = input;
  assertCurrent();
  if (!documents.length || documents.length > MAX_FINAL_BUNDLE_SOURCES || new Set(documents.map(document => document.id)).size !== documents.length)
    throw new Error("Select between 1 and 50 distinct original source files.");
  if (documents.some(document => !document.assetId || document.companyId !== input.companyId || document.orderId !== input.orderId))
    throw new Error("Every selected original must belong to this company and title file.");
  const sources: { documentId: string; assetId: string; version: number; originalName: string; path: string; mime: string; bytes: number; sha256: string }[] = [];
  const files: { name: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const [index, document] of documents.entries()) {
    assertCurrent();
    const blob = await input.readOriginal(document);
    assertCurrent();
    if (blob.size > MAX_FINAL_SOURCE_BYTES || total + blob.size > MAX_FINAL_BUNDLE_BYTES)
      throw new Error("Select a smaller bundle: up to 25 MB per original and 64 MB total.");
    if (blob.size === 0) throw new Error(`The original ${document.name} is empty. Recover it before exporting.`);
    const mime = document.mime || "application/octet-stream";
    if (!safeDocumentMime(mime) || (blob.type || "application/octet-stream") !== mime)
      throw new Error(`The original ${document.name} does not match its recorded file type.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assertCurrent();
    const byteProblem = documentByteProblem(bytes, mime);
    if (byteProblem) throw new Error(`The original ${document.name} cannot be exported: ${byteProblem}`);
    const hash = await sha256(bytes);
    assertCurrent();
    if (document.providerSource?.sha256 && hash !== document.providerSource.sha256)
      throw new Error(`The original ${document.name} does not match its recorded checksum.`);
    const path = `originals/${String(index + 1).padStart(3, "0")}-${finalDownloadName(document.name)}`;
    files.push({ name: path, bytes }); total += bytes.length;
    sources.push({ documentId: document.id, assetId: document.assetId!, version: document.version, originalName: document.name, path, mime, bytes: bytes.length, sha256: hash });
  }
  const manifest = { format: "titleos-final-handoff", version: 1, notAPolicy: true, selection: "Selected originals only; all referenced sources are listed in the handoff.", workspaceId: input.workspaceId || "local", orderId: input.orderId, companyId: input.companyId, worksheetVersion: input.worksheetVersion, exportedAt: new Date().toISOString(), sourceBytes: total, sources };
  const report = encoder.encode(input.report), html = encoder.encode(finalHandoffHtml(input.report, `Final preparation · ${input.orderId}`));
  const reply = encoder.encode(input.replyText), metadata = encoder.encode(JSON.stringify(manifest, null, 2));
  if (report.length + html.length + reply.length + metadata.length > 4 * 1024 * 1024) throw new Error("The handoff text exceeds the export limit. Shorten the worksheet notes before exporting.");
  files.unshift({ name: "handoff.html", bytes: html }, { name: "handoff.txt", bytes: report }, { name: "local-reply.txt", bytes: reply }, { name: "manifest.json", bytes: metadata });
  assertCurrent();
  const archive = zip(files);
  assertCurrent();
  return { archive, manifest };
}
