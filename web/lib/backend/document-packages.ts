import type { Workspace } from "../title/model";
import { ApiError, projectWorkspace, type Access } from "./workspace";
import { PACKAGE_SCAN_LIMITS, packageLineCount, validatePackageScanBatch, validatePackageScanCheckpoint, validatePackageScanIdentity, type PackageScanCheckpoint, type PackageScanIdentity, type PackageScanPage } from "../title/package-scan";
import { analyzeTitleDocuments, recordCandidateReviews, type IntelligenceDocument } from "../title/document-intelligence";

type Asset = { id: string; document_id: string; company_id: string; sha256: string; byte_size: number; mime: string };
type Saved = { id: string; version: number; sources: PackageScanIdentity[]; checkpoint: PackageScanCheckpoint | null; pages: Record<string, PackageScanPage & { documentId: string }>; decisions: unknown[] };
export type PackageContext = { workspaceId: string; access: Access; state: Workspace; revision: number; assets: Asset[]; rpc: (args: Record<string, unknown>) => Promise<unknown> };
function bad(message: string, status = 400): never { throw new ApiError(message, status); }
// PostgreSQL jsonb does not preserve object key order. Arrays retain their order.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const equal = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
const pageKey = (documentId: string, page: number) => `${documentId}:${page}`;
const accessIdentity = (context: PackageContext) => `${context.workspaceId}:${context.access.userId}:${context.access.version}`;
function sourcesFor(ids: unknown, context: PackageContext): PackageScanIdentity[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > PACKAGE_SCAN_LIMITS.documents || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) bad("Choose 1–100 uploaded originals.");
  const docs = projectWorkspace(context.state, context.access).documents;
  const result = [...ids].sort().map(id => {
    const doc = docs.find(doc => doc.id === id);
    const asset = context.assets.find(asset => asset.id === doc?.assetId && asset.document_id === doc?.id && asset.company_id === doc?.companyId);
    if (!doc || !asset) bad("An original is unavailable or outside your current access.", 403);
    return validatePackageScanIdentity({ documentId: doc.id, assetId: asset.id, version: doc.version, name: doc.name,
      mime: asset.mime, companyId: doc.companyId, ...(doc.orderId ? { orderId: doc.orderId } : {}), visibility: doc.visibility,
      ...(doc.sourceRole ? { sourceRole: doc.sourceRole } : {}), sha256: asset.sha256, bytes: asset.byte_size });
  });
  if (new Set(result.map(source => source.companyId)).size !== 1) bad("Review one company's originals at a time.");
  if (result.reduce((sum, source) => sum + source.bytes, 0) > PACKAGE_SCAN_LIMITS.totalBytes) bad("This package exceeds 500 MB.");
  return result;
}
function verifySources(saved: Saved, context: PackageContext) {
  const current = sourcesFor(saved.sources.map(source => source.documentId), context);
  if (!equal(saved.sources, current)) bad("Originals or their permissions changed. Start a new review.", 409);
  return current;
}
/** A checkpoint can advance only over the exact text saved in this transaction. */
export async function verifyPackageTransition(saved: Pick<Saved, "sources" | "checkpoint" | "pages">, rawBatch: unknown, rawCheckpoint: unknown, expectedAccess: string) {
  const batch = validatePackageScanBatch(rawBatch), checkpoint = validatePackageScanCheckpoint(rawCheckpoint);
  const sourceIdentities = checkpoint.sources.map(source => source.identity).sort((a,b) => a.documentId.localeCompare(b.documentId));
  if (checkpoint.accessIdentity !== expectedAccess || !equal(sourceIdentities, [...saved.sources].sort((a,b) => a.documentId.localeCompare(b.documentId))) || !saved.sources.some(source => equal(source, batch.source)))
    bad("The package no longer matches these originals or your access.", 409);
  const old = saved.checkpoint;
  if (old && (old.accessIdentity !== expectedAccess || !equal(old.sources.map(source => [source.identity.documentId, source.totalPages]).sort(), checkpoint.sources.map(source => [source.identity.documentId, source.totalPages]).sort())))
    bad("The original page manifest changed.", 409);
  const source = checkpoint.sources.find(source => source.identity.documentId === batch.source.documentId)!;
  if (batch.attemptedPages.some(page => page > source.totalPages)) bad("The batch includes a page outside its original.");
  const additions: Saved["pages"] = {};
  for (const page of batch.pages) {
    const key = pageKey(batch.source.documentId, page.page), existing = saved.pages[key];
    if (existing && !equal(existing, { ...page, documentId: batch.source.documentId })) bad("A completed page cannot be replaced in an existing review.", 409);
    additions[key] = { ...page, documentId: batch.source.documentId };
  }
  const pages = { ...saved.pages, ...additions };
  let receiptCount = 0;
  for (const entry of checkpoint.sources) {
    const previous = old?.sources.find(source => source.identity.documentId === entry.identity.documentId);
    for (const receipt of entry.completed) {
      const page = pages[pageKey(entry.identity.documentId, receipt.page)];
      if (!page || receipt.textSha256 !== await sha(page.text) || receipt.characters !== page.text.length || receipt.lines !== packageLineCount(page.text) || receipt.method !== page.method || receipt.rotation !== page.rotation || receipt.confidence !== page.confidence)
        bad("A saved page does not match its source receipt. Reopen the review.", 409);
      receiptCount++;
    }
    const expectedCompleted = new Set([...(previous?.completed.map(page => page.page) || []), ...(entry.identity.documentId === batch.source.documentId ? batch.pages.map(page => page.page) : [])]);
    if (expectedCompleted.size !== entry.completed.length || entry.completed.some(page => !expectedCompleted.has(page.page))) bad("Completed pages cannot be skipped or removed.");
    const expectedIssues = new Map((previous?.issues || []).map(issue => [issue.page, issue]));
    if (entry.identity.documentId === batch.source.documentId) {
      for (const attempted of batch.attemptedPages) expectedIssues.delete(attempted);
      for (const issue of batch.issues) expectedIssues.set(issue.page, issue);
    }
    if (!equal([...expectedIssues.values()].sort((a,b) => a.page-b.page), entry.issues)) bad("Unread pages must stay visible until successfully read.");
  }
  if (receiptCount !== Object.keys(pages).length) bad("The scan checkpoint omitted saved pages.");
  return { checkpoint, pages: additions };
}
export async function documentPackageRequest(action: string, input: Record<string, unknown>, context: PackageContext) {
  if (!["owner", "admin", "operations", "onboarding"].includes(context.access.role)) bad("Your account cannot read document packages.", 403);
  const invoke = (operation: string, details: unknown) => context.rpc({ p_workspace: context.workspaceId, p_actor: context.access.userId,
    p_access_version: context.access.version, p_state_revision: context.revision, p_action: operation, p_input: details });
  if (action === "open") {
    const sources = sourcesFor(input.documentIds, context);
    const saved = await invoke("open", { sources, sourcesHash: await sha(JSON.stringify(sources)) }) as Saved;
    const currentSources = verifySources(saved, context);
    const checkpoint = saved.checkpoint ? validatePackageScanCheckpoint(saved.checkpoint) : null;
    return { id: saved.id, version: saved.version, accessIdentity: accessIdentity(context), sources: currentSources,
      checkpoint, pages: Object.values(saved.pages), decisions: saved.decisions };
  }
  if (!["save", "review"].includes(action) || typeof input.id !== "string" || !/^[a-f\d-]{36}$/i.test(input.id) || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) bad("Invalid document review request.");
  const saved = await invoke("load", { id: input.id }) as Saved;
  verifySources(saved, context);
  if (saved.version !== input.expectedVersion) bad("Document review changed. Reopen it before continuing.", 409);
  if (action === "save") {
    const verified = await verifyPackageTransition(saved, input.batch, input.checkpoint, accessIdentity(context));
    return invoke("save", { id: saved.id, expectedVersion: saved.version, ...verified });
  }
  if (!Array.isArray(input.decisions) || !input.decisions.length || input.decisions.length > 1000) bad("Choose field suggestions to review.");
  const documents: IntelligenceDocument[] = saved.sources.map(source => ({ id: source.documentId, name: source.name, version: source.version,
    pages: Object.values(saved.pages).filter(page => page.documentId === source.documentId).sort((a,b) => a.page-b.page) })).filter(doc => doc.pages.length);
  const analysis = analyzeTitleDocuments(documents), seen = new Set<string>();
  const reviewInputs = input.decisions.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) bad("Invalid field review.");
    const row = value as Record<string, unknown>;
    if (typeof row.candidateId !== "string" || seen.has(row.candidateId) || !["accepted", "corrected", "rejected"].includes(String(row.action)) || (row.value !== undefined && (typeof row.value !== "string" || row.value.length > 4000)) || typeof row.note !== "string" || row.note.length > 1000) bad("Invalid field review.");
    seen.add(row.candidateId);
    return { candidateId: row.candidateId, disposition: row.action as "accepted" | "corrected" | "rejected",
      ...(typeof row.value === "string" ? { reviewedValue: row.value } : {}), note: row.note, reviewerId: context.access.userId, reviewedAt: new Date().toISOString() };
  });
  const updates = recordCandidateReviews(analysis, documents, reviewInputs);
  const currentDecisions = new Map(saved.decisions.map(value => {
    const row = value as { candidateId: string };
    return [row.candidateId, value];
  }));
  for (const decision of updates) currentDecisions.set(decision.candidateId, decision);
  const decisions = [...currentDecisions.values()];
  if (decisions.length > 1000) bad("This review has too many field decisions.");
  return invoke("review", { id: saved.id, expectedVersion: saved.version, decisions });
}
