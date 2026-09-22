import type { Workspace } from "./model";
import { documentByteProblem } from "../shared/document-bytes";

// Local JSON backups are bounded; shared originals live in private Storage.
export const MAX_BACKUP_FILE_BYTES = 96 * 1024 * 1024;
export const MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const MAX_ASSETS = 2000;
const allowedMimes = new Set([
  "application/pdf", "text/plain", "text/csv",
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword", "application/vnd.ms-excel", "application/octet-stream",
]);
export type BackupAsset = { id: string; name: string; mime: string; data: string };
export const safeDocumentMime = (mime: string | undefined) =>
  allowedMimes.has(mime || "application/octet-stream");

/** Validate every byte before opening a write transaction. */
export function decodeBackupAssets(assets: BackupAsset[]) {
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS)
    throw new Error("This backup contains too many files.");
  const ids = new Set<string>();
  let total = 0;
  return assets.map(asset => {
    if (!asset || typeof asset.id !== "string" || !asset.id || asset.id.length > 255 ||
        typeof asset.name !== "string" || !asset.name || asset.name.length > 1000 ||
        typeof asset.mime !== "string" || !safeDocumentMime(asset.mime) ||
        typeof asset.data !== "string" || ids.has(asset.id))
      throw new Error("This backup contains an invalid file type or duplicate file reference.");
    ids.add(asset.id);
    const encoded = asset.data;
    const estimated = encoded.length / 4 * 3 -
      (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    total += estimated;
    if (estimated > MAX_ASSET_BYTES || total > MAX_DECODED_BYTES)
      throw new Error("This backup exceeds the local restore limit of 64 MB of files.");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      throw new Error("This backup contains invalid file bytes.");
    let binary: string;
    try { binary = atob(encoded); }
    catch { throw new Error("This backup contains invalid file bytes."); }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const problem = documentByteProblem(bytes, asset.mime || "application/octet-stream");
    if (problem) throw new Error(problem);
    return { id: asset.id, file: new File([bytes], asset.name, { type: asset.mime || "application/octet-stream" }) };
  });
}

export function validateBackupReferences(
  workspace: Workspace, assets: BackupAsset[], missing: { id: string; name: string }[],
) {
  if (workspace.documents.length > 10000 || missing.length > MAX_ASSETS)
    throw new Error("This backup contains too many document references.");
  const docs = new Map<string, Workspace["documents"][number]>();
  const documentIds = new Set<string>();
  for (const doc of workspace.documents) {
    if (!doc || typeof doc.id !== "string" || documentIds.has(doc.id))
      throw new Error("This backup contains invalid document references.");
    documentIds.add(doc.id);
    if (!doc.assetId) continue;
    if (typeof doc.assetId !== "string" || docs.has(doc.assetId) || !safeDocumentMime(doc.mime))
      throw new Error("This backup contains invalid document file references.");
    docs.set(doc.assetId, doc);
  }
  const referenced = new Set<string>();
  for (const asset of assets) {
    const doc = docs.get(asset.id);
    if (!doc || (doc.mime || "application/octet-stream") !== (asset.mime || "application/octet-stream"))
      throw new Error("A backup file does not match its document type or reference.");
    referenced.add(asset.id);
  }
  for (const asset of missing) {
    if (!docs.has(asset.id) || referenced.has(asset.id))
      throw new Error("This backup contains invalid missing-file references.");
    referenced.add(asset.id);
  }
  // Older exports omitted missingAssets; preserve the fact that bytes are absent.
  for (const [id, doc] of docs)
    if (!referenced.has(id)) missing.push({ id, name: doc.name });
}
