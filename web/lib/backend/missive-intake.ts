import { ApiError, canCompany, projectWorkspace, type Access } from "./workspace";
import type { Mail, Workspace } from "../title/model";
import { productionLocked } from "../title/production";
import { missiveReadTransport } from "./missive";
import { credentialStatus, workspaceMissiveConfig } from "./missive-credentials";
import { missiveRouting, selectMissiveRoute } from "./missive-routing";
import { missiveFeedRoutes, readMissiveFeedMessage } from "./missive-feed";
import type { MissiveFeedContext } from "./missive-feed-http";
import { createMissiveIntakeGrant } from "./missive-intake-grant";
import { existingMissiveImport, importMissiveText, parseMissiveMessage, previewMissiveMessage, providerId, requireMissiveDestination, type MissivePreview } from "./missive-import";
import { attachMissiveAttachment, downloadMissiveAttachment, existingMissiveAttachment, missiveAttachmentsEnabled, type MissiveAttachmentArtifact } from "./missive-attachments";

export type MissiveIntakeFile = { id: string; address: string; client: string; suggested: boolean };
export type MissiveIntakePreview = { message: MissivePreview; files: MissiveIntakeFile[]; revision: number; routingRevision: number; companyId: string; attachmentDownloadEnabled: boolean; existingOrderId: string | null };
export type MissiveIntakeCommit = { requestId: string; hash: string; expectedRevision: number; credentialRevision: number; routingRevision: number; routeId: string; mappingVersion: number; companyId: string; orderId: string; messageId: string; action: "source" | "attachment" };
export type MissiveIntakeContext = MissiveFeedContext & {
  revision: number; attachmentOrigins: string[];
  receipt: (requestId: string, hash: string) => Promise<boolean>;
  persistAsset: (artifact: MissiveAttachmentArtifact) => Promise<void>;
  commit: (state: Workspace, details: MissiveIntakeCommit) => Promise<{ revision: number }>;
};
const fail = (message: string, status = 409): never => { throw new ApiError(message, status); };
const sha = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map(b => b.toString(16).padStart(2, "0")).join("");
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Suggestions only; even one match is never selected or saved automatically. */
export function missiveIntakeFiles(state: Workspace, access: Access, companyId: string, text: string): MissiveIntakeFile[] {
  const haystack = ` ${normalized(text)} `;
  return projectWorkspace(state, access).orders.filter(o => o.companyId === companyId && canCompany(access, companyId) && !productionLocked(state, o))
    .map(o => ({ id: o.id, address: o.address, client: o.client, suggested: [o.id, o.address].some(value => {
      const needle = normalized(value); return needle.length >= 6 && haystack.includes(` ${needle} `);
    }) })).sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.id.localeCompare(b.id));
}

/** All Missive traffic remains GET-only. Writes are local, explicit source or
 * individual attachment commits, each with its own fresh authorization and CAS. */
export async function missiveIntakeRequest(path: string, method: string, input: Record<string, unknown>, ctx: MissiveIntakeContext) {
  if (method !== "POST" || !["/missive-intake/preview", "/missive-intake/save-source", "/missive-intake/save-attachment"].includes(path))
    fail("Choose a reviewed email intake action.", 405);
  if (Object.keys(input).some(k => !["workspaceId", "routeId", "revision", "conversationId", "messageId", "orderId", "kind", "fingerprint", "requestId", "expectedRevision", "attachmentId"].includes(k)))
    fail("The email intake request contains unsupported fields.", 400);
  // Retain the raw persisted shape. Legacy normalization in the validated
  // builders must not turn an intake into unrelated workspace changes.
  const originalState = structuredClone(ctx.state);
  const routing = missiveRouting(ctx.integration?.config);
  const visible = ctx.state.companies.filter(c => canCompany(ctx.access, c.id)).map(c => c.id);
  const routes = missiveFeedRoutes(routing, ctx.access, visible);
  if (input.revision !== routing.revision || !routes.routes.some(r => r.id === input.routeId)) fail("Your email access or company routing changed. Refresh the inbox.", 403);
  const route = selectMissiveRoute(routing, input.revision, input.routeId);
  if (!["configured", "healthy", "error"].includes(ctx.integration?.status || "")) fail("Incoming email is paused. Ask an administrator to review the connection.");
  const conversationId = providerId(input.conversationId), messageId = providerId(input.messageId);
  const credential = await ctx.credential(route.id, routing.revision, true);
  if (!credentialStatus(credential, ctx.fallback, ctx.workspaceId).configured) fail("The email connection is unavailable.");
  const config = { ...workspaceMissiveConfig({ ...credential, token: credential.token ?? null }, ctx.fallback, ctx.workspaceId), attachmentOrigins: ctx.attachmentOrigins };
  const revalidate = async () => {
    const current = await ctx.credential(route.id, routing.revision, false);
    if (current.revision !== credential.revision || !credentialStatus(current, ctx.fallback, ctx.workspaceId).configured) fail("The email connection changed. Review the message again.");
  };
  const read = missiveReadTransport(config, ctx.workspaceId, ctx.fetcher);
  const freshMessage = async () => {
    let payload: Record<string, unknown> | undefined;
    await readMissiveFeedMessage(async p => {
      const value = await read(p); if (p === `/v1/messages/${messageId}`) payload = value; return value;
    }, routing, ctx.access, visible, { routeId: route.id, revision: routing.revision, conversationId, messageId });
    if (!payload) fail("The email source is unavailable.", 502);
    return parseMissiveMessage(payload!, route, messageId);
  };
  const previewing = path.endsWith("/preview");
  if (previewing) {
    const message = await previewMissiveMessage(await freshMessage());
    const existing = ctx.state.inbox.find(m => m.missive?.organizationId === route.organizationId && m.missive.messageId === messageId);
    if (existing && existing.companyId !== route.companyId) fail("This source was already saved to another company.");
    if (existing && !projectWorkspace(ctx.state, ctx.access).inbox.some(m => m.id === existing.id)) fail("The saved source is outside your current access.", 403);
    await revalidate();
    return { message, files: missiveIntakeFiles(ctx.state, ctx.access, route.companyId, `${message.subject}\n${message.body}`),
      revision: ctx.revision, routingRevision: routing.revision, companyId: route.companyId,
      attachmentDownloadEnabled: missiveAttachmentsEnabled(config), existingOrderId: existing?.orderId ?? null } satisfies MissiveIntakePreview;
  }
  const orderId = typeof input.orderId === "string" && /^[a-zA-Z0-9_:-]{1,160}$/.test(input.orderId) ? input.orderId : fail("Choose an existing title file.", 400);
  requireMissiveDestination(ctx.state, route, orderId);
  const grant = createMissiveIntakeGrant(ctx.state, ctx.access, routing, route.id, orderId);
  const requestId = typeof input.requestId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId) ? input.requestId : fail("Use a valid save request.", 400);
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0 || typeof input.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.fingerprint)) fail("Review the email before saving.", 400);
  const action = path.endsWith("/save-source") ? "source" : "attachment";
  const hash = await sha({ action, routeId: route.id, revision: routing.revision, conversationId, messageId, orderId, kind: input.kind, fingerprint: input.fingerprint, expectedRevision: input.expectedRevision, attachmentId: input.attachmentId });
  const replayed = await ctx.receipt(requestId, hash);
  if (replayed) { await revalidate(); return { revision: ctx.revision, orderId, saved: true, replayed: true }; }
  const prior = existingMissiveImport(ctx.state, route.organizationId, messageId, route.companyId, orderId);
  if (prior && prior.missive?.fingerprint !== input.fingerprint) fail("The saved source is immutable. Review its original email snapshot.");
  const attachmentId = action === "attachment" ? providerId(input.attachmentId) : undefined;
  const already = action === "source" ? prior : existingMissiveAttachment(ctx.state, ctx.access, route, messageId, attachmentId!, grant);
  if (already) { await revalidate(); return { revision: ctx.revision, orderId, saved: true, alreadySaved: true }; }
  if (ctx.revision !== input.expectedRevision) fail("Someone saved a newer workspace version. Reopen the review before saving.");
  const message = await freshMessage();
  if ((await previewMissiveMessage(message)).fingerprint !== input.fingerprint) fail("The source changed after review. Reopen the email before saving.");
  await revalidate();
  let next: Workspace;
  if (action === "source") next = await importMissiveText(ctx.state, ctx.access, route, message, orderId, input.kind as Mail["kind"], input.fingerprint as string, requestId, grant);
  else {
    const artifact = await downloadMissiveAttachment(config, ctx.workspaceId, ctx.access, route, ctx.state, messageId, attachmentId!, ctx.fetcher, grant);
    // Downloads may outlast a route edit, a moved conversation, or access revocation.
    const after = await freshMessage();
    if ((await previewMissiveMessage(after)).fingerprint !== input.fingerprint) fail("The source changed while the attachment downloaded. Review it again.");
    await revalidate();
    next = await attachMissiveAttachment(ctx.state, ctx.access, route, artifact, requestId, grant);
    await ctx.persistAsset(artifact);
  }
  const addedDocuments = next.documents.filter(d => !originalState.documents.some(previous => previous.id === d.id));
  const addedMessages = next.inbox.filter(m => !originalState.inbox.some(previous => previous.id === m.id));
  if (addedDocuments.length !== 1 || addedMessages.length !== (action === "source" ? 1 : 0)) fail("The reviewed intake did not produce its expected source records.");
  next = { ...originalState, user: ctx.access.email,
    documents: [...addedDocuments, ...originalState.documents], inbox: [...addedMessages, ...originalState.inbox] };
  await revalidate();
  const result = await ctx.commit(next, { requestId, hash, expectedRevision: ctx.revision, credentialRevision: credential.revision, routingRevision: routing.revision,
    routeId: route.id, mappingVersion: route.version, companyId: route.companyId, orderId, messageId, action });
  return { revision: result.revision, orderId, saved: true };
}
