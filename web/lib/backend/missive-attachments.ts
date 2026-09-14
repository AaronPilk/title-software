import { ApiError, executeCommands, projectWorkspace, normalizeWorkspace, type Access } from "./workspace";
import { missiveReader, type MissiveConfig } from "./missive";
import { providerId, readMissiveMessage, requireMissiveDestination, type MissiveMapping } from "./missive-import";
import type { Workspace, VaultDoc } from "../title/model";

export type MissiveAttachmentConfig = MissiveConfig & { attachmentOrigins?: string[] };
export type MissiveAttachmentSource = {
  provider: "Missive"; organizationId: string; teamId: string; conversationId: string;
  messageId: string; attachmentId: string; sourceMailId: string; sourceDocumentId: string;
  mappingVersion: number; importedAt: string; importedBy: string; sha256: string;
  bytes: number; filename: string; mime: string;
};
export type MissiveAttachmentArtifact = {
  documentId: string; assetId: string; companyId: string; orderId: string;
  filename: string; mime: string; bytes: Uint8Array; sha256: string;
  providerSource: MissiveAttachmentSource;
};
export const MAX_MISSIVE_ATTACHMENT_BYTES = 52_428_800;
const extensions: Record<string, string[]> = {
  "application/pdf": ["pdf"], "text/plain": ["txt"], "text/csv": ["csv"],
  "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"], "image/gif": ["gif"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/msword": ["doc"], "application/vnd.ms-excel": ["xls"],
};
function fail(message: string, status = 400): never { throw new ApiError(message, status); }
function administrator(access: Access) {
  if (access.role !== "owner" && !(access.role === "admin" && access.allCompanies))
    fail("Organization-wide administrator access is required.", 403);
}
function origin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.origin !== value || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) return;
    return url.origin;
  } catch { return; }
}
export function missiveAttachmentsEnabled(config: MissiveAttachmentConfig): boolean {
  return Array.isArray(config.attachmentOrigins) && config.attachmentOrigins.length > 0 &&
    config.attachmentOrigins.length <= 20 && config.attachmentOrigins.every(value => !!origin(value));
}
function source(s: Workspace, access: Access, mapping: MissiveMapping, messageId: string, attachmentId: string) {
  administrator(access); providerId(messageId); providerId(attachmentId);
  const visible = projectWorkspace(s, access);
  const mail = visible.inbox.find(m => m.missive?.organizationId === mapping.organizationId && m.missive.messageId === messageId);
  if (!mail?.missive) fail("Import and review this message before saving an attachment.", 409);
  const saved = mail.missive;
  if (mail.companyId !== mapping.companyId || saved.companyId !== mapping.companyId ||
      saved.orderId !== mail.orderId || saved.teamId !== mapping.teamId)
    fail("The imported message belongs to a different destination. Its original routing is preserved.", 409);
  const snapshot = visible.documents.find(d => d.id === saved.sourceDocumentId && d.companyId === mapping.companyId && d.orderId === mail.orderId);
  if (!snapshot || snapshot.visibility === "Partner") fail("The original message source is unavailable to your account.", 403);
  const attachment = saved.attachments.find(a => a.id === attachmentId);
  if (!attachment) fail("Choose an attachment from the imported message manifest.", 409);
  return { mail, saved, snapshot, attachment };
}
export function existingMissiveAttachment(s: Workspace, access: Access, mapping: MissiveMapping, messageId: string, attachmentId: string): VaultDoc | undefined {
  const { mail } = source(s, access, mapping, messageId, attachmentId);
  const existing = s.documents.find(d => d.providerSource?.provider === "Missive" &&
    d.providerSource.organizationId === mapping.organizationId && d.providerSource.messageId === messageId &&
    d.providerSource.attachmentId === attachmentId);
  if (existing && (existing.companyId !== mapping.companyId || existing.orderId !== mail.orderId || existing.providerSource?.sourceMailId !== mail.id))
    fail("This attachment already belongs to another source or destination.", 409);
  if (existing && !projectWorkspace(s, access).documents.some(d => d.id === existing.id))
    fail("This attachment is outside your document access.", 403);
  return existing;
}
function checkMetadata(a: { name: string; mime: string; bytes: number }) {
  if (!a.name.trim() || a.name.length > 255 || /[\/\\\x00-\x1f\x7f]/.test(a.name) || a.name !== a.name.trim() ||
      !extensions[a.mime]?.includes(a.name.split(".").pop()!.toLowerCase()))
    fail("This attachment name or file type is not supported. Use a reviewed PDF, image, text, or Office document.", 409);
  if (!Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > MAX_MISSIVE_ATTACHMENT_BYTES)
    fail("Choose a nonempty attachment up to 50 MB.", 413);
}
function validateBytes(bytes: Uint8Array, mime: string) {
  const starts = (sequence: number[]) => sequence.every((b, i) => bytes[i] === b);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const valid = mime === "application/pdf" ? ascii(0, 5) === "%PDF-" :
    mime === "image/png" ? starts([137, 80, 78, 71, 13, 10, 26, 10]) :
    mime === "image/jpeg" ? starts([255, 216, 255]) :
    mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6)) :
    mime === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP" :
    mime.includes("openxmlformats") ? starts([80, 75, 3, 4]) :
    ["application/msword", "application/vnd.ms-excel"].includes(mime) ? starts([208, 207, 17, 224, 161, 177, 26, 225]) :
    !bytes.includes(0);
  if (!valid) fail("Attachment contents do not match the declared file type. The file was not imported.", 502);
  if (mime.startsWith("text/")) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { fail("Text attachments must use UTF-8 encoding.", 409); }
  }
}
async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** The only download URL comes from a fresh authorized Missive response, never browser input. */
export async function downloadMissiveAttachment(config: MissiveAttachmentConfig, workspaceId: string, access: Access,
  mapping: MissiveMapping, state: Workspace, messageId: string, attachmentId: string, fetcher: typeof fetch = fetch): Promise<MissiveAttachmentArtifact> {
  const { mail, saved, attachment } = source(state, access, mapping, messageId, attachmentId);
  requireMissiveDestination(state, mapping, mail.orderId);
  checkMetadata(attachment);
  if (!missiveAttachmentsEnabled(config))
    fail("Attachment download is not configured. An administrator must approve the Missive attachment storage origin on the server.", 409);
  const payload = await missiveReader(config, workspaceId, access, fetcher)(`/v1/messages/${providerId(messageId)}`);
  // Reuse the existing complete message validator against this same bounded response.
  const message = await readMissiveMessage(config, workspaceId, access, mapping, messageId,
    async () => new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }));
  const fresh = message.attachments.find(a => a.id === attachmentId);
  if (!fresh || fresh.name !== attachment.name || fresh.mime !== attachment.mime || fresh.bytes !== attachment.bytes ||
      message.conversationId !== saved.conversationId)
    fail("The attachment or conversation changed since the message was imported. Review the source in Missive before continuing.", 409);
  const raw = payload.messages as { attachments: { id: string; url?: unknown }[] };
  const value = raw.attachments.find(a => a.id === attachmentId)?.url;
  let url: URL;
  try { if (typeof value !== "string" || value.length > 16_384) throw new Error(); url = new URL(value); }
  catch { fail("Missive did not provide a valid attachment download URL.", 502); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !config.attachmentOrigins!.includes(url.origin))
    fail("Missive returned an attachment storage origin that has not been approved on this server.", 409);
  let response: Response;
  try {
    // Signed storage URLs do not receive Missive authorization headers, cookies or redirects.
    response = await fetcher(url.href, { method: "GET", headers: { Accept: attachment.mime },
      redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000) });
  } catch { fail("The attachment could not be downloaded. Try again later.", 502); }
  if (!response.ok || response.status !== 200 || response.redirected) {
    await response.body?.cancel(); fail("The attachment download was unavailable. Try again later.", 502);
  }
  const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  const declared = response.headers.get("Content-Length");
  if ((type && type !== attachment.mime && type !== "application/octet-stream") ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== attachment.bytes))) {
    await response.body?.cancel(); fail("The attachment response does not match its reviewed metadata.", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) fail("The attachment response is empty.", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value: part } = await reader.read(); if (done) break;
      size += part.byteLength;
      if (size > attachment.bytes || size > MAX_MISSIVE_ATTACHMENT_BYTES) {
        await reader.cancel(); fail("The attachment exceeds its reviewed size.", 413);
      }
      chunks.push(part);
    }
  } catch (reason) {
    if (reason instanceof ApiError) throw reason;
    fail("The attachment download was interrupted. Try again later.", 502);
  } finally { reader.releaseLock(); }
  if (size !== attachment.bytes) fail("The attachment download was incomplete. Try again later.", 502);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  validateBytes(bytes, attachment.mime);
  const hash = await sha256(bytes);
  const identity = await sha256(new TextEncoder().encode(`${saved.organizationId}:${messageId}:${attachmentId}`));
  return {
    documentId: `missive:attachment:${identity}`, assetId: `missive:asset:${identity}`,
    companyId: mapping.companyId, orderId: mail.orderId, filename: attachment.name, mime: attachment.mime, bytes, sha256: hash,
    providerSource: { provider: "Missive", organizationId: saved.organizationId, teamId: saved.teamId,
      conversationId: saved.conversationId, messageId, attachmentId, sourceMailId: mail.id, sourceDocumentId: saved.sourceDocumentId,
      mappingVersion: mapping.version, importedAt: new Date().toISOString(), importedBy: access.email,
      sha256: hash, bytes: bytes.length, filename: attachment.name, mime: attachment.mime },
  };
}

/** Called only after private asset storage succeeds; the route commits this state with a revision/access/mapping CAS. */
export async function attachMissiveAttachment(state: Workspace, access: Access, mapping: MissiveMapping,
  artifact: MissiveAttachmentArtifact, requestId: string): Promise<Workspace> {
  const p = artifact.providerSource;
  const prior = existingMissiveAttachment(state, access, mapping, p.messageId, p.attachmentId);
  if (prior) {
    if (prior.providerSource?.sha256 !== artifact.sha256) fail("The saved attachment contents are immutable.", 409);
    return structuredClone(state);
  }
  const { mail, saved, attachment, snapshot } = source(state, access, mapping, p.messageId, p.attachmentId);
  requireMissiveDestination(state, mapping, mail.orderId); checkMetadata(attachment);
  const identity = await sha256(new TextEncoder().encode(`${saved.organizationId}:${p.messageId}:${p.attachmentId}`));
  if (artifact.documentId !== `missive:attachment:${identity}` || artifact.assetId !== `missive:asset:${identity}` ||
      artifact.companyId !== mapping.companyId || artifact.orderId !== mail.orderId ||
      artifact.filename !== attachment.name || artifact.mime !== attachment.mime || artifact.bytes.length !== attachment.bytes ||
      p.provider !== "Missive" || p.organizationId !== saved.organizationId || p.teamId !== saved.teamId ||
      p.conversationId !== saved.conversationId || p.sourceMailId !== mail.id || p.sourceDocumentId !== saved.sourceDocumentId ||
      p.mappingVersion !== mapping.version || p.importedBy !== access.email || !Number.isFinite(Date.parse(p.importedAt)) ||
      p.filename !== attachment.name || p.mime !== attachment.mime || p.bytes !== attachment.bytes ||
      p.sha256 !== artifact.sha256 || await sha256(artifact.bytes) !== artifact.sha256)
    fail("Attachment artifact does not match its reviewed source.", 409);
  validateBytes(artifact.bytes, artifact.mime);
  if (state.documents.some(d => d.id === artifact.documentId || d.assetId === artifact.assetId))
    fail("This attachment identity is already in use.", 409);
  const tempId = crypto.randomUUID();
  const next = executeCommands(state, [{ id: requestId, name: "editDraft", args: [[{ table: "documents", id: tempId, insert: true,
    value: { id: tempId, companyId: artifact.companyId, orderId: artifact.orderId, name: artifact.filename,
      category: "Email attachment", visibility: snapshot.visibility, assetId: artifact.assetId, mime: artifact.mime, size: `${artifact.bytes.length} B` },
  }]] }], access);
  const doc = next.documents.find(d => d.id === tempId)!;
  doc.id = artifact.documentId; doc.providerSource = structuredClone(p);
  return normalizeWorkspace(next);
}
