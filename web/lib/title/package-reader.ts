import type { VaultDoc } from "./model";
import { extractPdfText } from "./pdf-text";
import { recognizeDocumentPage } from "./local-ocr";
import {
  PACKAGE_SCAN_LIMITS, packageLineCount, validatePackageScanBatch, validatePackageScanCheckpoint, validatePackageScanIdentity,
  type PackageScanBatch, type PackageScanCheckpoint, type PackageScanIdentity, type PackageScanIssue, type PackageScanPage,
} from "./package-scan";
export { PACKAGE_SCAN_LIMITS } from "./package-scan";
export type { PackageScanBatch, PackageScanCheckpoint, PackageScanIdentity, PackageScanIssue, PackageScanPage } from "./package-scan";

export type PackageScanInput = { document: VaultDoc; blob?: Blob; loadOriginal?: () => Promise<Blob> };
export type PackageScanProgress = {
  phase: "verifying" | "reading" | "saving"; documentId: string; documentIndex: number; totalDocuments: number;
  page: number; totalPages: number; completedPages: number; totalPackagePages: number; message: string;
};
export type PackageScanOptions = {
  accessIdentity: string; signal?: AbortSignal;
  /** Fetch from an authenticated server store, never localStorage or user-supplied JSON. */
  loadCheckpoint?: (identities: PackageScanIdentity[]) => Promise<unknown>;
  /** Persist pages and checkpoint atomically, rejecting changed current access or originals. Throw to stop. */
  onBatch: (batch: PackageScanBatch, checkpoint: PackageScanCheckpoint) => Promise<void>;
  onProgress?: (progress: PackageScanProgress) => void;
};
export type PackageScanResult = {
  checkpoint: PackageScanCheckpoint; status: PackageScanCheckpoint["status"]; totalPages: number; completedPages: number;
  unread: { documentId: string; pages: number[] }[];
};
const clone = <T,>(value: T): T => structuredClone(value);
const stopped = (signal?: AbortSignal) => signal?.aborted === true;
const changed = () => new Error("The original document or access scope changed. Start a new package scan.");
export async function packageSha256(value: Blob | string): Promise<string> {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function originalIdentity(document: VaultDoc, blob: Blob, sha256: string): PackageScanIdentity {
  return validatePackageScanIdentity({ documentId: document.id, assetId: document.assetId, version: document.version,
    name: document.name, mime: document.mime, companyId: document.companyId, visibility: document.visibility,
    ...(document.orderId !== undefined ? { orderId: document.orderId } : {}), ...(document.sourceRole !== undefined ? { sourceRole: document.sourceRole } : {}), sha256, bytes: blob.size });
}
async function original(input: PackageScanInput): Promise<Blob> {
  const blob = input.blob || await input.loadOriginal?.();
  if (!blob || !input.document.assetId) throw new Error("Every package source needs its uploaded original. Restore missing originals before scanning.");
  if (!blob.size || blob.size > PACKAGE_SCAN_LIMITS.documentBytes) throw new Error("Each package original must be nonempty and at most 25 MB.");
  if (blob.type !== input.document.mime || !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(blob.type))
    throw new Error("The original file type must match its PDF, PNG, JPEG or text document record.");
  if (blob.type === "text/plain" && blob.size > PACKAGE_SCAN_LIMITS.pageCharacters) throw new Error("Text originals support up to 50,000 bytes each.");
  return blob;
}
function summarize(checkpoint: PackageScanCheckpoint): PackageScanResult {
  return { checkpoint: clone(checkpoint), status: checkpoint.status,
    totalPages: checkpoint.sources.reduce((sum, source) => sum + source.totalPages, 0),
    completedPages: checkpoint.sources.reduce((sum, source) => sum + source.completed.length, 0),
    unread: checkpoint.sources.map(source => { const done = new Set(source.completed.map(page => page.page)); return {
      documentId: source.identity.documentId, pages: Array.from({ length: source.totalPages }, (_, i) => i + 1).filter(page => !done.has(page)),
    }; }),
  };
}
function readIssue(page: number, reason: PackageScanIssue["reason"]): PackageScanIssue {
  const messages = {
    empty: "No readable text was found. Review this physical page in the original.",
    failed: "This physical page could not be read reliably. Retry it or review the original.",
    timeout: "This page exceeded its reading time limit. Retry it or review the original.",
    text_limit: "This page exceeds the package text budget. Review it in the original or create a smaller package.",
  };
  return { page, reason, message: messages[reason] };
}

/**
 * Read at most 1,000 physical pages across originals. PDF objects and OCR rasters
 * are released between windows/pages. Only the current batch contains text here;
 * callers decide how authorized evidence is stored and reviewed. No browser
 * persistence or external OCR provider is used. A checkpoint is never approval.
 */
export async function readDocumentPackage(inputs: PackageScanInput[], options: PackageScanOptions): Promise<PackageScanResult> {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > PACKAGE_SCAN_LIMITS.documents) throw new Error("Choose between 1 and 100 original documents for one package.");
  if (!options || typeof options.onBatch !== "function" || typeof options.accessIdentity !== "string" || !options.accessIdentity.trim()) throw new Error("An authorized package checkpoint store is required.");
  if (stopped(options.signal)) throw new Error("Package scanning cancelled.");
  // Capture metadata before the first await; later mutations cannot rebind evidence.
  const sources = inputs.map(input => ({ ...input, document: clone(input.document) }))
    .sort((a, b) => a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0);
  let checkpoint: PackageScanCheckpoint = { version: 1, accessIdentity: options.accessIdentity, status: "reading", sources: [] };
  let packagePages = 0, packageBytes = 0;
  const report = (index: number, page: number, totalPages: number, phase: PackageScanProgress["phase"], message: string) => options.onProgress?.({
    phase, documentId: sources[index].document.id, documentIndex: index + 1, totalDocuments: sources.length, page, totalPages,
    completedPages: checkpoint.sources.reduce((sum, source) => sum + source.completed.length, 0), totalPackagePages: packagePages, message,
  });
  // Preflight one original at a time. Oversized packages stop before any read is
  // saved. Lazy loaders avoid holding all downloaded files in client memory.
  for (let index = 0; index < sources.length; index++) {
    if (stopped(options.signal)) throw new Error("Package scanning cancelled before its originals were verified. Start the scan again.");
    report(index, 0, 0, "verifying", `Verifying original ${index + 1} of ${sources.length}`);
    const blob = await original(sources[index]);
    const identity = originalIdentity(sources[index].document, blob, await packageSha256(blob));
    let totalPages = 1;
    if (blob.type === "application/pdf") {
      const read = await extractPdfText(blob, { signal: options.signal, pageWindow: { start: 1, count: 0 } });
      if (read.status !== "ready") throw new Error(read.message);
      totalPages = read.totalPages;
    }
    if (stopped(options.signal)) throw new Error("Package scanning cancelled before its originals were verified. Start the scan again.");
    packagePages += totalPages; packageBytes += blob.size;
    if (packagePages > PACKAGE_SCAN_LIMITS.pages) throw new Error("A package supports up to 1,000 physical pages across all originals. Create a second package for the remaining originals.");
    if (packageBytes > PACKAGE_SCAN_LIMITS.totalBytes) throw new Error("A package supports up to 500 MB of originals. Create a smaller package.");
    checkpoint.sources.push({ identity, totalPages, completed: [], issues: [] });
  }
  checkpoint = validatePackageScanCheckpoint(checkpoint);
  const loaded = await options.loadCheckpoint?.(checkpoint.sources.map(source => clone(source.identity)));
  if (loaded !== undefined && loaded !== null) {
    const saved = validatePackageScanCheckpoint(loaded);
    const byId = new Map(saved.sources.map(source => [source.identity.documentId, source]));
    if (saved.accessIdentity !== options.accessIdentity || saved.sources.length !== checkpoint.sources.length || checkpoint.sources.some(source => {
      const previous = byId.get(source.identity.documentId);
      return !previous || source.totalPages !== previous.totalPages || JSON.stringify(source.identity) !== JSON.stringify(previous.identity);
    })) throw changed();
    checkpoint = { ...saved, sources: checkpoint.sources.map(source => byId.get(source.identity.documentId)!) };
  }
  const commit = async (batch: PackageScanBatch, next: PackageScanCheckpoint) => {
    const checked = validatePackageScanCheckpoint(next), checkedBatch = validatePackageScanBatch(batch);
    await options.onBatch(clone(checkedBatch), clone(checked));
    checkpoint = checked;
  };
  // Establish the checked manifest even if cancellation happens before page 1.
  await commit({ source: checkpoint.sources[0].identity, attemptedPages: [], pages: [], issues: [] }, { ...checkpoint, status: "reading" });
  let totalCharacters = checkpoint.sources.reduce((sum, source) => sum + source.completed.reduce((count, page) => count + page.characters, 0), 0);
  let totalLines = checkpoint.sources.reduce((sum, source) => sum + source.completed.reduce((count, page) => count + page.lines, 0), 0);
  for (let index = 0; index < sources.length && !stopped(options.signal); index++) {
    const saved = checkpoint.sources[index], done = new Set(saved.completed.map(page => page.page));
    if (done.size === saved.totalPages) continue;
    const blob = await original(sources[index]);
    if (await packageSha256(blob) !== saved.identity.sha256 || JSON.stringify(originalIdentity(sources[index].document, blob, saved.identity.sha256)) !== JSON.stringify(saved.identity)) throw changed();
    // Ten full 50,000-character pages fit the 500,000-character batch budget.
    // The shared format accepts up to twenty smaller pages, never an unbounded batch.
    for (let start = 1; start <= saved.totalPages && !stopped(options.signal); start += 10) {
      const count = Math.min(10, saved.totalPages - start + 1);
      const pending = Array.from({ length: count }, (_, offset) => start + offset).filter(page => !done.has(page));
      if (!pending.length) continue;
      const batch: PackageScanBatch = { source: clone(saved.identity), attemptedPages: [], pages: [], issues: [] };
      const next = clone(checkpoint); next.status = "reading";
      const target = next.sources[index];
      const text = blob.type === "application/pdf" ? await extractPdfText(blob, {
        signal: options.signal, pageWindow: { start, count }, continueOnPageError: true, detectRasterContent: true,
        onProgress: page => report(index, page, saved.totalPages, "reading", `Reading ${saved.identity.name} · page ${page} of ${saved.totalPages}`),
      }) : undefined;
      for (const page of pending) {
        if (stopped(options.signal) || text?.reason === "cancelled") break;
        report(index, page, saved.totalPages, "reading", `Reading ${saved.identity.name} · page ${page} of ${saved.totalPages}`);
        let value: PackageScanPage | undefined, issue: PackageScanIssue | undefined;
        try {
          const selectable = text?.pages.find(candidate => candidate.page === page);
          if (blob.type === "text/plain") value = { page, text: await blob.text(), method: "source-text" };
          else if (selectable?.text.trim() && !selectable.requiresOcr) value = { page, text: selectable.text, method: "pdf-text" };
          else if (text?.reason === "password" || text?.reason === "page_limit" || text?.reason === "too_large") throw new Error("Original is unavailable for package OCR.");
          else {
            const ocr = await recognizeDocumentPage(blob, page, { signal: options.signal, packageMode: true,
              onProgress: progress => report(index, page, saved.totalPages, "reading", `${saved.identity.name} · page ${page} of ${saved.totalPages} · ${progress.phase} · ${Math.round(progress.progress * 100)}%`),
            });
            value = { page, text: ocr.text, method: "ocr", confidence: ocr.confidence, rotation: ocr.rotation || 0 };
          }
          if (stopped(options.signal)) break;
          if (!value.text.trim()) issue = readIssue(page, "empty");
          else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text) || (value.confidence !== undefined && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 100))) issue = readIssue(page, "failed");
          else if (value.text.length > PACKAGE_SCAN_LIMITS.pageCharacters || totalCharacters + value.text.length > PACKAGE_SCAN_LIMITS.totalCharacters ||
            packageLineCount(value.text) > PACKAGE_SCAN_LIMITS.pageLines || totalLines + packageLineCount(value.text) > PACKAGE_SCAN_LIMITS.totalLines) issue = readIssue(page, "text_limit");
        } catch (error) {
          if (stopped(options.signal)) break;
          issue = readIssue(page, error && typeof error === "object" && "code" in error && error.code === "timeout" ? "timeout" : "failed");
        }
        if (stopped(options.signal)) break;
        if (issue || !value) {
          batch.attemptedPages.push(page); target.issues = target.issues.filter(issue => issue.page !== page);
          const unread = issue || readIssue(page, "failed"); batch.issues.push(unread); target.issues.push(unread);
        } else {
          const textSha256 = await packageSha256(value.text);
          if (stopped(options.signal)) break;
          batch.attemptedPages.push(page); target.issues = target.issues.filter(issue => issue.page !== page);
          batch.pages.push(value); target.completed.push({ page, textSha256, method: value.method, characters: value.text.length, lines: packageLineCount(value.text),
            ...(value.confidence !== undefined ? { confidence: value.confidence } : {}), ...(value.rotation !== undefined ? { rotation: value.rotation } : {}) });
          totalCharacters += value.text.length; totalLines += packageLineCount(value.text); done.add(page);
        }
      }
      if (batch.attemptedPages.length) {
        report(index, batch.attemptedPages.at(-1)!, saved.totalPages, "saving", `Saving scanned page evidence for ${saved.identity.name}`);
        await commit(batch, next);
      }
      if (text?.reason === "cancelled") break;
    }
  }
  const status = stopped(options.signal) ? "cancelled" : checkpoint.sources.every(source => source.completed.length === source.totalPages) ? "complete" : "partial";
  await commit({ source: checkpoint.sources[0].identity, attemptedPages: [], pages: [], issues: [] }, { ...checkpoint, status });
  return summarize(checkpoint);
}
