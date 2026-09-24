import { ApiError, canCompany, type Access } from "./workspace";
import type { Workspace } from "../title/model";
import { jvReadiness, newJVApplication } from "../title/jv-application";
import { validateRecipientPayload, JV_PORTAL_MAX_FILE_BYTES, type JVPortalPublicRecord, type JVPortalStaffRecord, type JVPortalAttachment } from "../title/jv-portal";
import { documentByteProblem } from "../shared/document-bytes";

export type JVPortalEmail = { kind: "invitation" | "challenge" | "submission"; to: string; recipientName: string; companyName: string; link?: string; code?: string; idempotencyKey: string };
export type JVPortalContext = {
  rpc: (name: "title_jv_portal_staff" | "title_jv_portal_public", args: Record<string, unknown>) => Promise<unknown>;
  sendEmail: (job: JVPortalEmail) => Promise<{ status: "sent" | "failed" | "unknown"; providerId?: string }>;
  storage: { upload: (path: string, bytes: Uint8Array, mime: string) => Promise<void>; download: (path: string) => Promise<Uint8Array>; remove: (path: string) => Promise<void> };
  portalUrl: string;
  mailConfigured?: boolean;
  trustedIp?: string;
};
export type JVPortalStaffContext = JVPortalContext & { workspaceId: string; access: Access; state: Workspace };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function fail(message = "The application request could not be accepted.", status = 400): never { throw new ApiError(message, status); }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const capability = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
function keys(input: unknown, allowed: string[], required = allowed): asserts input is Record<string, unknown> {
  if (!object(input) || Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) fail();
}
export async function jvPortalHash(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), byte => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function randomCode(): string { const a = new Uint32Array(1); do { crypto.getRandomValues(a); } while (a[0] >= 4294000000); return String(a[0] % 1000000).padStart(6, "0"); }
function attachments(raw: unknown): JVPortalAttachment[] {
  if (!Array.isArray(raw) || raw.length > 10) return fail("The application is unavailable.", 503);
  return raw.map(a => {
    if (!object(a) || !uuid(a.id) || typeof a.name !== "string" || a.name.length > 200 || typeof a.mime !== "string" || !Number.isSafeInteger(a.bytes) || (a.bytes as number) < 1 || (a.bytes as number) > JV_PORTAL_MAX_FILE_BYTES || typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256)) fail("The application is unavailable.", 503);
    return { id: a.id, name: a.name, mime: a.mime, bytes: a.bytes, sha256: a.sha256 } as JVPortalAttachment;
  });
}
function publicRecord(raw: unknown): JVPortalPublicRecord {
  if (!object(raw) || !uuid(raw.id) || !version(raw.version) || !["Draft", "Submitted", "Changes requested"].includes(String(raw.status)) || typeof raw.companyName !== "string" || typeof raw.recipientName !== "string" || typeof raw.expiresAt !== "string" || typeof raw.correctionNote !== "string" || raw.correctionNote.length > 2000 || raw.submittedAt !== null && typeof raw.submittedAt !== "string") fail("The application is unavailable.", 503);
  let payload; try { payload = validateRecipientPayload(raw.payload); } catch { return fail("The application is unavailable.", 503); }
  return { id: raw.id as string, version: raw.version as number, status: raw.status as JVPortalPublicRecord["status"], companyName: raw.companyName as string, recipientName: raw.recipientName as string, expiresAt: raw.expiresAt as string, correctionNote: raw.correctionNote as string, submittedAt: raw.submittedAt as string | null, payload, attachments: attachments(raw.attachments) };
}
function staffRecord(raw: unknown): JVPortalStaffRecord {
  if (!object(raw) || !uuid(raw.id) || !version(raw.version) || !["Draft", "Submitted", "Changes requested", "Revoked", "Expired"].includes(String(raw.status)) || typeof raw.recipientName !== "string" || typeof raw.email !== "string" || typeof raw.expiresAt !== "string" || raw.submittedAt !== null && typeof raw.submittedAt !== "string" || !["not_sent", "sending", "sent", "failed", "unknown"].includes(String(raw.deliveryStatus)) || raw.appliedVersion !== null && !version(raw.appliedVersion)) fail("The application is unavailable.", 503);
  return { id: raw.id as string, version: raw.version as number, status: raw.status as JVPortalStaffRecord["status"], recipientName: raw.recipientName as string, email: raw.email as string, expiresAt: raw.expiresAt as string, submittedAt: raw.submittedAt as string | null, deliveryStatus: raw.deliveryStatus as JVPortalStaffRecord["deliveryStatus"], appliedVersion: raw.appliedVersion as number | null, needsMerge: raw.needsMerge === true, notificationStatus: typeof raw.notificationStatus === "string" ? raw.notificationStatus : "not_sent" };
}
async function invoke(context: JVPortalContext, name: "title_jv_portal_staff" | "title_jv_portal_public", args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let raw: unknown;
  try { raw = await context.rpc(name, args); }
  catch (error) {
    const code = object(error) ? error.code : undefined;
    const status = object(error) ? error.status : undefined;
    if (code === "42501" || status === 403) fail("This application access is no longer available.", 403);
    if (code === "PT409" || code === "40001" || status === 409) fail("The application changed. Reload before continuing.", 409);
    if (code === "22023" || status === 400) fail();
    if (code === "PT429" || status === 429) fail("Please wait before trying again.", 429);
    return fail("The application is unavailable. Please try again.", 503);
  }
  if (!object(raw)) return fail("The application is unavailable.", 503);
  if (raw.errorCode === "forbidden") return fail("This application link or session is unavailable. Reopen your invitation to continue.", 403);
  if (raw.errorCode === "challenge_failed") return fail("That verification code did not match. Please try again.", 401);
  if (raw.errorCode === "conflict") return fail("The application changed. Reload before continuing.", 409);
  if (raw.errorCode === "invalid") return fail();
  if (raw.errorCode === "unavailable") return fail("The application is unavailable. Please try again.", 503);
  if (raw.errorCode === "rate_limit") return fail("Please wait before trying again.", 429);
  if (Object.hasOwn(raw, "errorCode")) return fail("The application is unavailable.", 503);
  return raw;
}
async function delivery(context: JVPortalContext, job: Record<string, unknown>, kind: JVPortalEmail["kind"], extra: { link?: string; code?: string } = {}) {
  if (typeof job.to !== "string" || typeof job.jobId !== "string") return { status: "failed" as const };
  if (context.mailConfigured === false) return { status: "failed" as const };
  try {
    const sent = await context.sendEmail({ kind, to: job.to, recipientName: String(job.recipientName ?? ""), companyName: String(job.companyName ?? ""), idempotencyKey: job.jobId, ...extra });
    return { status: ["sent", "failed", "unknown"].includes(sent.status) ? sent.status : "unknown", ...(typeof sent.providerId === "string" && sent.providerId.length <= 200 ? { providerId: sent.providerId } : {}) };
  } catch { return { status: "unknown" as const }; }
}
function link(context: JVPortalContext, token: string): string { const url = new URL(context.portalUrl); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail("The application portal is not configured.", 503); return `${url.toString().replace(/\/$/, "")}/#${token}`; }
export async function jvPortalStaffRequest(action: string, input: Record<string, unknown>, context: JVPortalStaffContext): Promise<unknown> {
  const base = ["workspaceId", "companyId"];
  const extra: Record<string, string[]> = { list: [], create: ["recipientName", "email", "requestId"], send: ["id", "expectedVersion"], revoke: ["id", "expectedVersion"], "request-changes": ["id", "expectedVersion", "note"], "load-submission": ["id"], "download-attachment": ["id", "attachmentId"], apply: ["id", "expectedVersion", "expectedApplicationVersion"] };
  if (!Object.hasOwn(extra, action)) fail(); keys(input, [...base, ...extra[action]]);
  if (input.workspaceId !== context.workspaceId || typeof input.companyId !== "string" || !/^[-A-Za-z0-9_ .:@]{1,180}$/.test(input.companyId)) fail();
  if (!["owner", "admin", "onboarding"].includes(context.access.role) || !context.access.restricted || !canCompany(context.access, input.companyId as string) || !context.state.companies.some(c => c.id === input.companyId)) fail("Your current access does not permit this application.", 403);
  if ("id" in input && !uuid(input.id) || "attachmentId" in input && !uuid(input.attachmentId) || "expectedVersion" in input && !version(input.expectedVersion) || "expectedApplicationVersion" in input && (!Number.isSafeInteger(input.expectedApplicationVersion) || (input.expectedApplicationVersion as number) < 0)) fail();
  const details: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([key]) => !base.includes(key)));
  let token: string | undefined;
  if (action === "create") {
    if (!uuid(input.requestId) || typeof input.recipientName !== "string" || !input.recipientName.trim() || input.recipientName.length > 200 || /[\x00-\x1f\x7f]/.test(input.recipientName) || typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) fail();
    details.recipientName = input.recipientName.trim(); details.email = input.email.toLowerCase().trim();
  }
  if (action === "request-changes" && (typeof input.note !== "string" || !input.note.trim() || input.note.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.note))) fail();
  if (["create", "send", "request-changes"].includes(action)) { token = randomToken(); link(context, token); details.tokenHash = await jvPortalHash(token); }
  if (action === "send" && context.mailConfigured === false) fail("Application email is not configured. Contact your administrator.", 503);
  const call = (operation: string, value: Record<string, unknown>) => invoke(context, "title_jv_portal_staff", { p_workspace: context.workspaceId, p_actor: context.access.userId, p_access_version: context.access.version, p_company: input.companyId, p_action: operation, p_input: value });
  let raw = await call(action, details);
  if (action === "list") { if (!Array.isArray(raw.requests)) fail("The application is unavailable.", 503); return { requests: (raw.requests as unknown[]).map(staffRecord), mailConfigured: context.mailConfigured !== false }; }
  if (action === "send" && object(raw.job)) {
    const sent = await delivery(context, raw.job, "invitation", { link: link(context, token!) });
    raw = await call("delivery-result", { id: input.id, jobId: raw.job.jobId, ...sent });
    return staffRecord(raw.request);
  }
  if (action === "download-attachment") {
    if (!object(raw.attachment) || typeof raw.objectPath !== "string") fail("The attachment is unavailable.", 403);
    const attachment = attachments([raw.attachment])[0];
    let bytes: Uint8Array; try { bytes = await context.storage.download(raw.objectPath as string); } catch { return fail("The attachment is unavailable.", 503); }
    await call(action, details);
    if (bytes.byteLength !== attachment.bytes || await jvPortalHash(bytes) !== attachment.sha256) fail("The attachment is unavailable.", 503);
    return { bytes, name: attachment.name, mime: attachment.mime };
  }
  const request = staffRecord(raw.request);
  if (action === "create" || action === "request-changes") return { request, ...(raw.tokenIssued === true ? { link: link(context, token!) } : {}), deliveryStatus: request.deliveryStatus };
  if (action === "load-submission") return { request, payload: validateRecipientPayload(raw.payload), attachments: attachments(raw.attachments) };
  return request;
}
export async function jvPortalPublicRequest(action: string, input: Record<string, unknown>, context: JVPortalContext): Promise<unknown> {
  const allowed: Record<string, string[]> = { start: ["token"], verify: ["token", "code"], load: ["session"], save: ["session", "expectedVersion", "payload"], submit: ["session", "expectedVersion", "payload"], download: ["session", "attachmentId"], "remove-attachment": ["session", "expectedVersion", "attachmentId"] };
  if (!Object.hasOwn(allowed, action)) fail(); keys(input, allowed[action]);
  if (!capability(action === "start" || action === "verify" ? input.token : input.session)) fail("This application link or session is unavailable.", 403);
  if ("expectedVersion" in input && !version(input.expectedVersion) || "attachmentId" in input && !uuid(input.attachmentId)) fail();
  if (action === "verify" && (typeof input.code !== "string" || !/^\d{6}$/.test(input.code))) fail("Enter the six-digit verification code.");
  if (!context.trustedIp || context.trustedIp.length > 200) fail("The application is unavailable.", 503);
  const ipHash = await jvPortalHash(context.trustedIp);
  const secret = (input.token ?? input.session) as string;
  const credential = await jvPortalHash(secret);
  const call = (operation: string, value: Record<string, unknown>) => invoke(context, "title_jv_portal_public", { p_action: operation, p_credential: credential, p_ip_hash: ipHash, p_input: value });
  if (action === "start") {
    if (context.mailConfigured === false) fail("Application email is not configured. Contact the sender.", 503);
    const code = randomCode(); const raw = await call(action, { codeHash: await jvPortalHash(`${secret}:${code}`) });
    if (object(raw.job)) { const sent = await delivery(context, raw.job, "challenge", { code }); await call("challenge-result", { jobId: raw.job.jobId, ...sent }); }
    return { message: "If this link is available, a verification code has been sent." };
  }
  if (action === "verify") {
    const session = randomToken(); const raw = await call(action, { codeHash: await jvPortalHash(`${secret}:${input.code}`), sessionHash: await jvPortalHash(session) });
    if (typeof raw.expiresAt !== "string") fail("The application is unavailable.", 503);
    return { session, expiresAt: raw.expiresAt, application: publicRecord(raw.application) };
  }
  const details: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "session"));
  if (action === "save" || action === "submit") {
    try { details.payload = validateRecipientPayload(input.payload); } catch { fail("The application contains invalid or unsupported fields."); }
    if (action === "submit" && jvReadiness({ ...newJVApplication(), ...details.payload as object }).length) fail("Complete the application requirements before submitting.");
  }
  const raw = await call(action, details);
  if (action === "download") {
    if (!object(raw.attachment) || typeof raw.objectPath !== "string") fail("The attachment is unavailable.", 403);
    const attachment = attachments([raw.attachment])[0];
    let bytes: Uint8Array; try { bytes = await context.storage.download(raw.objectPath as string); } catch { return fail("The attachment is unavailable.", 503); }
    // Reauthorize after storage I/O; revoked or submitted-cycle sessions cannot complete an in-flight read.
    await call("download", details);
    if (bytes.byteLength !== attachment.bytes || await jvPortalHash(bytes) !== attachment.sha256) fail("The attachment is unavailable.", 503);
    return { bytes, name: attachment.name, mime: attachment.mime };
  }
  if (action === "submit" && object(raw.notificationJob)) {
    const sent = await delivery(context, raw.notificationJob, "submission");
    try { await call("notification-result", { jobId: raw.notificationJob.jobId, ...sent }); } catch { /* A committed submission remains successful when email reporting fails. */ }
  }
  return publicRecord(raw.application);
}
export async function jvPortalUpload(session: string, file: { name: string; type: string; bytes: Uint8Array }, context: JVPortalContext): Promise<JVPortalPublicRecord> {
  if (!capability(session)) fail("This application session is unavailable.", 403);
  if (!file || typeof file.name !== "string" || !file.name.trim() || file.name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(file.name) || !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(file.type) || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength < 1 || file.bytes.byteLength > JV_PORTAL_MAX_FILE_BYTES || documentByteProblem(file.bytes, file.type)) fail("Choose a valid PDF, PNG, JPEG, or text file up to 10 MiB.");
  if (!context.trustedIp || context.trustedIp.length > 200) fail("The application is unavailable.", 503);
  const credential = await jvPortalHash(session), ipHash = await jvPortalHash(context.trustedIp);
  const call = (action: string, input: Record<string, unknown>) => invoke(context, "title_jv_portal_public", { p_action: action, p_credential: credential, p_ip_hash: ipHash, p_input: input });
  const reserved = await call("reserve-attachment", { name: file.name.trim(), mime: file.type, bytes: file.bytes.byteLength, sha256: await jvPortalHash(file.bytes) });
  if (!uuid(reserved.id) || typeof reserved.objectPath !== "string") fail("The attachment is unavailable.", 503);
  try { await context.storage.upload(reserved.objectPath as string, file.bytes, file.type); }
  catch { try { await call("cancel-attachment", { attachmentId: reserved.id }); } catch {} return fail("The attachment could not be uploaded. Please try again.", 503); }
  // Retain uncertain uploaded objects for reconciliation; never delete a possibly finalized/adopted original.
  const finalized = await call("finalize-attachment", { attachmentId: reserved.id });
  return publicRecord(finalized.application);
}
