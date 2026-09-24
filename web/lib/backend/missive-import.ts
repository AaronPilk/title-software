import { ApiError, executeCommands, type Access } from "./workspace";
import { requireMissiveGrant, type MissiveIntakeGrant } from "./missive-intake-grant";
import { missiveReader, type MissiveConfig } from "./missive";
import type { Workspace, Mail } from "../title/model";
import { productionLocked } from "../title/production";
import { htmlPlainText } from "../shared/html-text";

export type MissiveMapping = {
  version: number; organizationId: string; teamId: string; teamName: string;
  companyId: string; approvedAt: string; approvedBy: string;
};
export type MissivePage = { rows: { id: string; subject: string; at: number }[]; until: number | null; skipped?: number };
export type MissiveMessage = {
  id: string; conversationId: string; organizationId: string; teamId: string;
  subject: string; from: string; email: string; receivedAt: string; html: string;
  headers: {
    subject: string | null; messageId: string | null; updatedAt: number; createdAt: number;
    to: { name: string; address: string }[]; cc: { name: string; address: string }[];
    bcc: { name: string; address: string }[]; replyTo: { name: string; address: string }[];
    references: string[]; inReplyTo: string[];
  };
  attachments: { id: string; name: string; mime: string; bytes: number; status: "not_downloaded" }[];
};
export type MissivePreview = Omit<MissiveMessage, "html"> & { body: string; fingerprint: string };
const fail = (message = "Missive returned incomplete message data.", status = 502): never => { throw new ApiError(message, status); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) && v.length <= 500 ? v.map(obj) : fail("This Missive page is too large or incomplete. Narrow the team inbox before trying again.");
export const providerId = (v: unknown): string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : fail("Invalid Missive identifier.", 400);
const str = (v: unknown, max = 2000): string => typeof v === "string" && v.length <= max ? v : fail();
const timestamp = (v: unknown): number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 253402300799 ? v : fail();
function scope(conversation: unknown, mapping: MissiveMapping) {
  const c = obj(conversation);
  if (obj(c.organization).id !== mapping.organizationId || obj(c.team).id !== mapping.teamId)
    fail("The conversation no longer belongs to the approved Missive team. Review the mapping.", 409);
  return providerId(c.id);
}
export function requireMissiveDestination(s: Workspace, mapping: MissiveMapping, orderId?: string) {
  if (!s.companies.some(c => c.id === mapping.companyId)) fail("The mapped company is no longer available.", 409);
  if (orderId !== undefined) {
    const order = s.orders.find(o => o.id === orderId && o.companyId === mapping.companyId);
    if (!order || productionLocked(s, order)) fail("Choose an open title file belonging to the mapped company.", 409);
  }
}
const queryUntil = (until: unknown) => until === undefined || until === null ? "" : `&until=${timestamp(until)}`;
function page(values: Record<string, unknown>[], field: string, limit: number): MissivePage {
  const times = values.map(r => timestamp(r[field]));
  return {
    rows: values.map((r, i) => ({ id: providerId(r.id), subject: str(r.subject ?? r.latest_message_subject ?? "(No subject)"), at: times[i] })),
    // Missive includes all timestamp ties, even when that exceeds the requested
    // limit. Preserve every row before allowing the cursor to advance.
    until: values.length < limit || new Set(times).size < 2 ? null : Math.min(...times),
  };
}
export async function listMissiveConversations(config: MissiveConfig, workspaceId: string, access: Access, mapping: MissiveMapping, until?: number, fetcher: typeof fetch = fetch): Promise<MissivePage> {
  const read = missiveReader(config, workspaceId, access, fetcher);
  const values = rows((await read(`/v1/conversations?team_inbox=${providerId(mapping.teamId)}&limit=50${queryUntil(until)}`)).conversations);
  const result = page(values, "last_activity_at", 50);
  result.rows = result.rows.filter((_, i) => {
    const c = values[i];
    if (!c.organization || !c.team) return false;
    scope(c, mapping); return true;
  });
  result.skipped = values.length - result.rows.length;
  return result;
}
export async function listMissiveMessages(config: MissiveConfig, workspaceId: string, access: Access, mapping: MissiveMapping, conversationId: string, until?: number, fetcher: typeof fetch = fetch): Promise<MissivePage> {
  const read = missiveReader(config, workspaceId, access, fetcher);
  const conversation = rows((await read(`/v1/conversations/${providerId(conversationId)}`)).conversations);
  if (conversation.length !== 1) fail();
  const canonical = scope(conversation[0], mapping);
  const values = rows((await read(`/v1/conversations/${canonical}/messages?limit=10${queryUntil(until)}`)).messages);
  const result = page(values, "delivered_at", 10);
  // Pagination uses all records, including channels unsupported by this importer.
  result.rows = result.rows.filter((_, i) => values[i].type === "email" && values[i].draft !== true && values[i].author == null);
  return result;
}
export async function readMissiveMessage(config: MissiveConfig, workspaceId: string, access: Access, mapping: MissiveMapping, messageId: string, fetcher: typeof fetch = fetch): Promise<MissiveMessage> {
  const read = missiveReader(config, workspaceId, access, fetcher);
  return parseMissiveMessage(await read(`/v1/messages/${providerId(messageId)}`), mapping, messageId);
}
export function parseMissiveMessage(payload: Record<string, unknown>, mapping: MissiveMapping, messageId: string): MissiveMessage {
  const m = obj(payload.messages);
  if (m.id !== messageId || m.type !== "email" || m.draft === true || m.author != null) fail("Only received email records can be reviewed here.", 409);
  const conversationId = scope(m.conversation, mapping);
  const sender = obj(m.from_field), email = str(sender.address, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail();
  const addresses = (v: unknown) => rows(v).map(a => ({ name: str(a.name ?? "", 1000), address: str(a.address, 320) }));
  const references = (v: unknown) => Array.isArray(v) && v.length <= 500 ? v.map(value => str(value, 2000)) : fail();
  const attachments = rows(m.attachments).map(a => {
    const size = typeof a.size === "number" && Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : fail();
    return { id: providerId(a.id), name: str(a.filename, 1000), mime: `${str(a.media_type, 100)}/${str(a.sub_type, 100)}`, bytes: size, status: "not_downloaded" as const };
  });
  if (new Set(attachments.map(a => a.id)).size !== attachments.length) fail();
  return {
    id: providerId(m.id), conversationId, organizationId: mapping.organizationId, teamId: mapping.teamId,
    subject: str(m.subject ?? "") || "(No subject)", from: str(sender.name ?? "", 1000) || email, email,
    receivedAt: new Date(timestamp(m.delivered_at) * 1000).toISOString(),
    // Missing/redacted body is an error; an explicitly empty body is valid.
    html: str(m.body, 500_000), attachments,
    headers: {
      subject: m.subject == null ? null : str(m.subject), messageId: m.email_message_id == null ? null : str(m.email_message_id),
      updatedAt: timestamp(m.updated_at), createdAt: timestamp(m.created_at),
      to: addresses(m.to_fields), cc: addresses(m.cc_fields ?? []), bcc: addresses(m.bcc_fields ?? []),
      replyTo: addresses(m.reply_to_fields ?? []), references: references(m.references ?? []), inReplyTo: references(m.in_reply_to ?? []),
    },
  };
}
export function missivePlainText(html: string): string {
  // Display only. The exact HTML is preserved in the immutable source snapshot.
  // No HTML is ever inserted into the DOM or used to load links/images.
  return htmlPlainText(html);
}
export async function previewMissiveMessage(m: MissiveMessage): Promise<MissivePreview> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(m)));
  const fingerprint = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  const { html, ...metadata } = m;
  return { ...metadata, body: missivePlainText(html), fingerprint };
}
export function existingMissiveImport(s: Workspace, organizationId: string, messageId: string, companyId: string, orderId: string): Mail | undefined {
  const existing = s.inbox.find(m => m.missive?.organizationId === organizationId && m.missive?.messageId === messageId);
  if (existing && (existing.companyId !== companyId || existing.orderId !== orderId))
    fail("This Missive message was already imported to another destination. Its original routing is preserved.", 409);
  return existing;
}
export async function importMissiveText(before: Workspace, access: Access, mapping: MissiveMapping, message: MissiveMessage, orderId: string, kind: Mail["kind"], fingerprint: string, requestId: string, grant?: MissiveIntakeGrant): Promise<Workspace> {
  if (grant) requireMissiveGrant(grant, before, access, mapping, orderId);
  else if (access.role !== "owner" && !(access.role === "admin" && access.allCompanies)) fail("Organization-wide administrator access is required.", 403);
  if (!["Revision", "Finals", "Commitment"].includes(kind || "")) fail("Choose the request type.", 400);
  if (message.organizationId !== mapping.organizationId || message.teamId !== mapping.teamId) fail("Message scope changed.", 409);
  const preview = await previewMissiveMessage(message);
  if (preview.fingerprint !== fingerprint) fail("The source changed after preview. Open it again before importing.", 409);
  if (existingMissiveImport(before, mapping.organizationId, message.id, mapping.companyId, orderId)) return structuredClone(before);
  requireMissiveDestination(before, mapping, orderId);
  const identity = `${providerId(mapping.organizationId)}:${providerId(message.id)}`;
  const suffix = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)))).map(b => b.toString(16).padStart(2, "0")).join("");
  const mailId = `missive:mail:${suffix}`, docId = `missive:source:${suffix}`;
  if (before.inbox.some(m => m.id === mailId) || before.documents.some(d => d.id === docId)) fail("The source identity is already in use.", 409);
  const source = JSON.stringify({ provider: "Missive", ...message }, null, 2);
  const display = preview.body || "(Message body is empty.)";
  const tempMail = crypto.randomUUID(), tempDoc = crypto.randomUUID();
  const next = executeCommands(before, [{ id: requestId, name: "editDraft", args: [[
    { table: "documents", id: tempDoc, insert: true, value: { id: tempDoc, companyId: mapping.companyId, orderId,
      name: `Missive source ${suffix}.json`, category: "Email source", visibility: "Internal",
      text: source, mime: "application/json", size: `${new TextEncoder().encode(source).length} B` } },
    { table: "inbox", id: tempMail, insert: true, value: { id: tempMail, companyId: mapping.companyId, orderId, kind,
      from: message.from, email: message.email, subject: message.subject,
      body: display.length > 19000 ? display.slice(0, 19000) + "\n\n[Full message retained in the source snapshot.]" : display,
      time: message.receivedAt, attachments: [], documentIds: [], status: "New" } },
  ]] }], access);
  next.documents.find(d => d.id === tempDoc)!.id = docId;
  const mail = next.inbox.find(m => m.id === tempMail)!;
  mail.id = mailId;
  mail.sourceReference = `Missive · ${message.id}`;
  mail.missive = {
    organizationId: message.organizationId, teamId: message.teamId, conversationId: message.conversationId,
    messageId: message.id, companyId: mapping.companyId, orderId, mappingVersion: mapping.version,
    receivedAt: message.receivedAt, importedAt: new Date().toISOString(), importedBy: access.email,
    fingerprint, sourceDocumentId: docId, attachments: message.attachments,
  };
  return next;
}
