import type { VaultDoc } from "./model";
import { decodeBackupAssets, MAX_ASSETS, MAX_ASSET_BYTES, MAX_BACKUP_FILE_BYTES, MAX_DECODED_BYTES, safeDocumentMime } from "./backup-assets";

export type OriginalReference = Pick<VaultDoc, "id" | "companyId" | "orderId" | "name" | "version"> & { assetId: string; mime: string };
type OriginalBytes = { reference: OriginalReference; bytes: number; sha256: string; data: string };
export type OriginalsArchive = {
  format: "titleos-originals"; version: 1; workspaceId: string; revision: number; exportedAt: string;
  originals: OriginalBytes[]; missing: OriginalReference[]; manifestSha256: string;
};
const abortIfNeeded = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error("Originals archive cancelled. The workspace may have changed; start again from its current records."); };
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};
const validText = (value: unknown, max = 255): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const manifestDigest = (archive: OriginalsArchive) => digest(new TextEncoder().encode(JSON.stringify({
  format: archive.format, version: archive.version, workspaceId: archive.workspaceId, revision: archive.revision, exportedAt: archive.exportedAt,
  originals: archive.originals.map(({ reference, bytes, sha256 }) => ({ reference, bytes, sha256 })), missing: archive.missing,
})).buffer);
function validReference(value: unknown): value is OriginalReference {
  return record(value) && validText(value.id) && validText(value.assetId) && validText(value.companyId) &&
    (value.orderId === undefined || validText(value.orderId)) && validText(value.name, 1000) &&
    Number.isSafeInteger(value.version) && Number(value.version) > 0 && typeof value.mime === "string" && safeDocumentMime(value.mime);
}
function validateManifest(value: unknown): asserts value is OriginalsArchive {
  if (!record(value) || value.format !== "titleos-originals" || value.version !== 1 || !validText(value.workspaceId) ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !validText(value.exportedAt, 100) ||
      !Number.isFinite(Date.parse(value.exportedAt)) || !Array.isArray(value.originals) || !Array.isArray(value.missing) ||
      typeof value.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.manifestSha256) ||
      value.originals.length + value.missing.length > MAX_ASSETS)
    throw new Error("Choose a valid TitleOS originals archive with up to 2,000 file references.");
  const documents = new Set<string>(), assets = new Set<string>();
  let total = 0;
  for (const entry of value.originals) {
    if (!record(entry) || !validReference(entry.reference) || !Number.isSafeInteger(entry.bytes) || Number(entry.bytes) < 0 ||
        Number(entry.bytes) > MAX_ASSET_BYTES || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.data !== "string" || entry.data.length !== 4 * Math.ceil(Number(entry.bytes) / 3))
      throw new Error("This originals archive has invalid file sizes, checksums, or references.");
    total += Number(entry.bytes);
    if (total > MAX_DECODED_BYTES) throw new Error("An originals archive supports up to 64 MB of file bytes.");
  }
  for (const ref of [...value.originals.map(entry => entry.reference), ...value.missing]) {
    if (!validReference(ref) || documents.has(ref.id) || assets.has(ref.assetId))
      throw new Error("This originals archive has invalid or duplicate document references.");
    documents.add(ref.id); assets.add(ref.assetId);
  }
}

/** Read only the supplied authorized document snapshot. No workspace or file writes. */
export async function createOriginalsArchive(
  snapshot: { workspaceId: string; revision: number; documents: VaultDoc[] },
  readAsset: (id: string) => Promise<Blob>, signal?: AbortSignal,
): Promise<OriginalsArchive> {
  const refs = structuredClone(snapshot.documents.filter(doc => doc.assetId)).map(doc => ({
    id: doc.id, assetId: doc.assetId!, companyId: doc.companyId, orderId: doc.orderId,
    name: doc.name, version: doc.version, mime: doc.mime || "application/octet-stream",
  }));
  const archive: OriginalsArchive = { format: "titleos-originals", version: 1, workspaceId: snapshot.workspaceId,
    revision: snapshot.revision, exportedAt: new Date().toISOString(), originals: [], missing: refs, manifestSha256: "0".repeat(64) };
  validateManifest(archive);
  archive.missing = [];
  let total = 0;
  for (const reference of refs) {
    abortIfNeeded(signal);
    let file: Blob;
    try { file = await readAsset(reference.assetId); }
    catch { abortIfNeeded(signal); archive.missing.push(reference); continue; }
    abortIfNeeded(signal);
    total += file.size;
    if (file.size > MAX_ASSET_BYTES || total > MAX_DECODED_BYTES)
      throw new Error("Export a smaller collection: originals archives support 64 MB total and 50 MB per file.");
    if (file.type && file.type !== reference.mime)
      throw new Error(`The stored file type does not match ${reference.name}. Resolve it before exporting.`);
    const bytes = await file.arrayBuffer();
    abortIfNeeded(signal);
    const entry = { reference, bytes: file.size, sha256: await digest(bytes), data: base64(new Uint8Array(bytes)) };
    decodeBackupAssets([{ id: reference.assetId, name: reference.name, mime: reference.mime, data: entry.data }]);
    archive.originals.push(entry);
  }
  abortIfNeeded(signal);
  validateManifest(archive);
  archive.manifestSha256 = await manifestDigest(archive);
  abortIfNeeded(signal);
  if (new Blob([JSON.stringify(archive)]).size > MAX_BACKUP_FILE_BYTES)
    throw new Error("This originals archive exceeds the 96 MB archive limit.");
  return archive;
}

/** Validate the whole manifest and byte budget before decoding any original. */
export async function verifyOriginalsArchive(raw: string, signal?: AbortSignal): Promise<OriginalsArchive> {
  abortIfNeeded(signal);
  if (new Blob([raw]).size > MAX_BACKUP_FILE_BYTES) throw new Error("Choose an originals archive up to 96 MB.");
  let archive: unknown;
  try { archive = JSON.parse(raw); } catch { throw new Error("This originals archive is not valid JSON."); }
  validateManifest(archive);
  if (await manifestDigest(archive) !== archive.manifestSha256)
    throw new Error("This archive's document manifest failed checksum verification. Use an unchanged archive.");
  for (const entry of archive.originals) {
    abortIfNeeded(signal);
    const [decoded] = decodeBackupAssets([{ id: entry.reference.assetId, name: entry.reference.name, mime: entry.reference.mime, data: entry.data }]);
    if (decoded.file.size !== entry.bytes || await digest(await decoded.file.arrayBuffer()) !== entry.sha256)
      throw new Error(`Checksum verification failed for ${entry.reference.name}. Use an unchanged archive.`);
  }
  abortIfNeeded(signal);
  return archive;
}

/** Recover one original locally without overwriting hosted bytes or references. */
export async function recoverArchivedOriginal(archive: OriginalsArchive, documentId: string): Promise<File> {
  validateManifest(archive);
  if (await manifestDigest(archive) !== archive.manifestSha256)
    throw new Error("This archive's document manifest failed checksum verification.");
  const entry = archive.originals.find(item => item.reference.id === documentId);
  if (!entry) throw new Error("This archive does not contain bytes for that document.");
  const [decoded] = decodeBackupAssets([{ id: entry.reference.assetId, name: entry.reference.name, mime: entry.reference.mime, data: entry.data }]);
  if (decoded.file.size !== entry.bytes || await digest(await decoded.file.arrayBuffer()) !== entry.sha256)
    throw new Error("The recovered original failed checksum verification.");
  return decoded.file;
}
