/** Shared package format. This module has no browser, OCR, or storage dependency. */
export const PACKAGE_SCAN_LIMITS = {
  documents: 100, pages: 1_000, documentBytes: 26_214_400, totalBytes: 524_288_000,
  windowPages: 20, pageCharacters: 50_000, batchCharacters: 500_000,
  totalCharacters: 5_000_000, pageLines: 12_000, totalLines: 120_000, checkpointBytes: 1_000_000,
} as const;
export type PackageScanMethod = "pdf-text" | "ocr" | "source-text";
export type PackageScanIdentity = {
  documentId: string; assetId: string; version: number; name: string; mime: string; companyId: string;
  orderId?: string; visibility: "Internal" | "Restricted" | "Partner"; sourceRole?: string;
  sha256: string; bytes: number;
};
export type PackageScanPage = { page: number; text: string; method: PackageScanMethod; confidence?: number; rotation?: 0 | 90 | 180 | 270 };
export type PackageScanIssue = { page: number; reason: "empty" | "failed" | "timeout" | "text_limit"; message: string };
export type PackageScanReceipt = Omit<PackageScanPage, "text"> & { textSha256: string; characters: number; lines: number };
export type PackageScanSource = { identity: PackageScanIdentity; totalPages: number; completed: PackageScanReceipt[]; issues: PackageScanIssue[] };
export type PackageScanCheckpoint = {
  version: 1; accessIdentity: string; sources: PackageScanSource[];
  status: "reading" | "complete" | "partial" | "cancelled";
};
export type PackageScanBatch = {
  source: PackageScanIdentity; attemptedPages: number[]; pages: PackageScanPage[]; issues: PackageScanIssue[];
};
const hashPattern = /^[a-f0-9]{64}$/;
function invalid(): never { throw new Error("The saved package scan is invalid. Start a new scan from the current originals."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function string(value: unknown, max = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}
function integer(value: unknown, min: number, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(); return value; }
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
function digest(value: unknown): string { if (typeof value !== "string" || !hashPattern.test(value)) invalid(); return value; }
export function packageLineCount(text: string): number { return text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(text) ? 1 : 0); }
export function validatePackageScanIdentity(value: unknown): PackageScanIdentity {
  const row = record(value);
  keys(row, ["documentId", "assetId", "version", "name", "mime", "companyId", "orderId", "visibility", "sourceRole", "sha256", "bytes"]);
  if (typeof row.mime !== "string" || !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(row.mime) || typeof row.visibility !== "string" || !["Internal", "Restricted", "Partner"].includes(row.visibility)) invalid();
  return {
    documentId: string(row.documentId), assetId: string(row.assetId), version: integer(row.version, 1, Number.MAX_SAFE_INTEGER), name: string(row.name, 500),
    mime: row.mime as string, companyId: string(row.companyId), ...(row.orderId !== undefined ? { orderId: string(row.orderId) } : {}),
    visibility: row.visibility as PackageScanIdentity["visibility"], ...(row.sourceRole !== undefined ? { sourceRole: string(row.sourceRole) } : {}),
    sha256: digest(row.sha256), bytes: integer(row.bytes, 1, PACKAGE_SCAN_LIMITS.documentBytes),
  };
}
function validateMethod(value: unknown): PackageScanMethod { if (typeof value !== "string" || !["pdf-text", "ocr", "source-text"].includes(value)) invalid(); return value as PackageScanMethod; }
function evidenceMetadata(row: Record<string, unknown>): Pick<PackageScanPage, "confidence" | "rotation"> {
  if (row.confidence !== undefined && (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 100)) invalid();
  if (row.rotation !== undefined && ![0, 90, 180, 270].includes(row.rotation as number)) invalid();
  if (row.method !== "ocr" && (row.confidence !== undefined || row.rotation !== undefined)) invalid();
  return { ...(row.confidence !== undefined ? { confidence: row.confidence as number } : {}), ...(row.rotation !== undefined ? { rotation: row.rotation as PackageScanPage["rotation"] } : {}) };
}
function issue(value: unknown, totalPages: number): PackageScanIssue {
  const row = record(value); keys(row, ["page", "reason", "message"]);
  if (typeof row.reason !== "string" || !["empty", "failed", "timeout", "text_limit"].includes(row.reason)) invalid();
  return { page: integer(row.page, 1, totalPages), reason: row.reason as PackageScanIssue["reason"], message: string(row.message, 500) };
}
/** Shape/budget validation is not authentication. Load checkpoints only from the authorized server store. */
export function validatePackageScanCheckpoint(value: unknown): PackageScanCheckpoint {
  const row = record(value); keys(row, ["version", "accessIdentity", "sources", "status"]);
  if (row.version !== 1 || typeof row.status !== "string" || !["reading", "complete", "partial", "cancelled"].includes(row.status)) invalid();
  const accessIdentity = string(row.accessIdentity, 4_000), ids = new Set<string>();
  let totalPages = 0, totalBytes = 0, totalCharacters = 0, totalLines = 0, completedPages = 0;
  const sources = array(row.sources, PACKAGE_SCAN_LIMITS.documents).map(value => {
    const source = record(value); keys(source, ["identity", "totalPages", "completed", "issues"]);
    const identity = validatePackageScanIdentity(source.identity), count = integer(source.totalPages, 1, PACKAGE_SCAN_LIMITS.pages);
    if (ids.has(identity.documentId) || (identity.mime !== "application/pdf" && count !== 1)) invalid();
    ids.add(identity.documentId); totalPages += count; totalBytes += identity.bytes;
    if (totalPages > PACKAGE_SCAN_LIMITS.pages || totalBytes > PACKAGE_SCAN_LIMITS.totalBytes) invalid();
    const read = new Set<number>(), failed = new Set<number>();
    const completed = array(source.completed, count).map(value => {
      const page = record(value); keys(page, ["page", "method", "textSha256", "characters", "lines", "confidence", "rotation"]);
      const number = integer(page.page, 1, count);
      if (read.has(number)) invalid(); read.add(number);
      const characters = integer(page.characters, 1, PACKAGE_SCAN_LIMITS.pageCharacters), lines = integer(page.lines, 1, Math.min(PACKAGE_SCAN_LIMITS.pageLines, characters));
      const method = validateMethod(page.method);
      if ((identity.mime === "text/plain" && method !== "source-text") || (identity.mime !== "text/plain" && method === "source-text") || (identity.mime.startsWith("image/") && method !== "ocr")) invalid();
      totalCharacters += characters; totalLines += lines; completedPages++;
      if (totalCharacters > PACKAGE_SCAN_LIMITS.totalCharacters || totalLines > PACKAGE_SCAN_LIMITS.totalLines) invalid();
      return { page: number, method, textSha256: digest(page.textSha256), characters, lines, ...evidenceMetadata(page) };
    }).sort((a, b) => a.page - b.page);
    const issues = array(source.issues, count).map(value => {
      const entry = issue(value, count); if (read.has(entry.page) || failed.has(entry.page)) invalid(); failed.add(entry.page); return entry;
    }).sort((a, b) => a.page - b.page);
    return { identity, totalPages: count, completed, issues };
  });
  if (!sources.length || totalPages > PACKAGE_SCAN_LIMITS.pages || totalBytes > PACKAGE_SCAN_LIMITS.totalBytes || totalCharacters > PACKAGE_SCAN_LIMITS.totalCharacters || totalLines > PACKAGE_SCAN_LIMITS.totalLines ||
    (row.status === "complete" && completedPages !== totalPages)) invalid();
  const result: PackageScanCheckpoint = { version: 1, accessIdentity, sources, status: row.status as PackageScanCheckpoint["status"] };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PACKAGE_SCAN_LIMITS.checkpointBytes) invalid();
  return result;
}
/** Validate a single bounded write before checking its hashes and current access on the server. */
export function validatePackageScanBatch(value: unknown): PackageScanBatch {
  const row = record(value); keys(row, ["source", "attemptedPages", "pages", "issues"]);
  const source = validatePackageScanIdentity(row.source), attempts = array(row.attemptedPages, PACKAGE_SCAN_LIMITS.windowPages).map(page => integer(page, 1, PACKAGE_SCAN_LIMITS.pages));
  if (new Set(attempts).size !== attempts.length) invalid();
  const seen = new Set<number>(); let characters = 0;
  const pages = array(row.pages, PACKAGE_SCAN_LIMITS.windowPages).map(value => {
    const page = record(value); keys(page, ["page", "text", "method", "confidence", "rotation"]);
    const number = integer(page.page, 1, PACKAGE_SCAN_LIMITS.pages);
    if (!attempts.includes(number) || seen.has(number)) invalid(); seen.add(number);
    if (typeof page.text !== "string" || !page.text.trim() || page.text.length > PACKAGE_SCAN_LIMITS.pageCharacters || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(page.text) || packageLineCount(page.text) > PACKAGE_SCAN_LIMITS.pageLines) invalid();
    characters += page.text.length;
    const method = validateMethod(page.method);
    if ((source.mime === "text/plain" && method !== "source-text") || (source.mime !== "text/plain" && method === "source-text") || (source.mime.startsWith("image/") && method !== "ocr")) invalid();
    return { page: number, text: page.text, method, ...evidenceMetadata(page) };
  });
  const issues = array(row.issues, PACKAGE_SCAN_LIMITS.windowPages).map(value => {
    const entry = issue(value, PACKAGE_SCAN_LIMITS.pages); if (!attempts.includes(entry.page) || seen.has(entry.page)) invalid(); seen.add(entry.page); return entry;
  });
  if (seen.size !== attempts.length || characters > PACKAGE_SCAN_LIMITS.batchCharacters) invalid();
  return { source, attemptedPages: attempts, pages, issues };
}
