import { ApiError, canCompany, type Access } from "./workspace";
import { missiveRouting, requireRoutingRevision, type MissiveRoute } from "./missive-routing";
import { htmlPlainText } from "../shared/html-text";

/** Supplied only by the server after resolving the workspace's approved connection.
 * The implementation must be a bounded, fixed-origin GET reader such as missiveReader.
 * Keeping this dependency separate does not grant staff access to connection settings.
 */
export type MissiveFeedReader = (path: string) => Promise<Record<string, unknown>>;
export type MissiveFeedRoute = Pick<MissiveRoute, "id" | "organizationId" | "teamId" | "teamName" | "companyId">;
export type MissiveFeedSelection = { routeId: unknown; revision: unknown; until?: unknown };
export type MissiveFeedConversationSelection = MissiveFeedSelection & { conversationId: unknown };
export type MissiveFeedMessageSelection = MissiveFeedConversationSelection & { messageId: unknown };
export type MissiveFeedConversation = { id: string; subject: string; at: number };
export type MissiveFeedAttachment = { id: string; name: string; mime: string; bytes: number; status: "not_downloaded" };
export type MissiveFeedAddress = { name: string; address: string };
export type MissiveFeedMessageSummary = {
  id: string; subject: string; from: string; email: string; receivedAt: string;
  preview: string; attachments: MissiveFeedAttachment[];
};
export type MissiveFeedMessage = Omit<MissiveFeedMessageSummary, "preview"> & {
  body: string; to: MissiveFeedAddress[]; cc: MissiveFeedAddress[];
};
export type MissiveFeedPage<T> = {
  revision: number; route: MissiveFeedRoute; rows: T[]; until: number | null; skipped: number;
};

const CONVERSATION_LIMIT = 50;
const MESSAGE_LIMIT = 10;
// Missive includes every timestamp tie, sometimes exceeding the requested limit.
// Reject excess instead of truncating rows and silently skipping messages.
const MAX_PAGE_ROWS = 500;
const invalid = (): never => { throw new ApiError("Missive returned incomplete inbox data. Refresh and try again.", 502); };
const changed = (): never => { throw new ApiError("This conversation no longer belongs to the selected inbox. Refresh the inbox.", 409); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : invalid();
const text = (value: unknown, max = 2000): string => typeof value === "string" && value.length <= max ? value : invalid();
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const id = (value: unknown): string => isId(value) ? value : invalid();
const requestId = (value: unknown): string => {
  if (!isId(value)) throw new ApiError("Choose a valid Missive conversation or message.", 400);
  return value;
};
const timestamp = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 253402300799
  ? value : invalid();
function requestUntil(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 253402300799)
    throw new ApiError("Refresh the inbox before loading another page.", 400);
  return value;
}
const queryUntil = (until: number | undefined) => until === undefined ? "" : `&until=${until}`;
function records(value: unknown, max = MAX_PAGE_ROWS): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value.map(object);
}
function staff(access: Access) {
  if (!["owner", "admin", "operations"].includes(access.role))
    throw new ApiError("Production staff access is required to read incoming email.", 403);
}
function routeSummary(route: MissiveRoute): MissiveFeedRoute {
  return { id: route.id, organizationId: route.organizationId, teamId: route.teamId, teamName: route.teamName, companyId: route.companyId };
}

/** The caller supplies server-projected company IDs, never IDs from the request.
 * Every configured company remains part of the inbox identity, including paused
 * routes and deleted companies. A shared inbox cannot be attributed to one company.
 */
export function missiveFeedRoutes(config: unknown, access: Access, visibleCompanyIds: readonly string[]) {
  staff(access);
  const routing = missiveRouting(config);
  const visible = new Set(visibleCompanyIds);
  const groups = new Map<string, MissiveRoute[]>();
  for (const route of routing.mappings) {
    const key = `${route.organizationId}:${route.teamId}`;
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  const routes: MissiveFeedRoute[] = [];
  let blockedSharedInboxes = false;
  for (const candidates of groups.values()) {
    const allowed = candidates.filter(route => route.enabled && visible.has(route.companyId) && canCompany(access, route.companyId) &&
      (access.role !== "operations" || route.productionOnly === true));
    if (!allowed.length) continue;
    if (new Set(candidates.map(route => route.companyId)).size !== 1) {
      blockedSharedInboxes = true;
      continue;
    }
    routes.push(routeSummary(allowed[0]));
  }
  return { revision: routing.revision, routes, blockedSharedInboxes };
}
function selection(config: unknown, access: Access, visibleCompanyIds: readonly string[], input: MissiveFeedSelection) {
  staff(access);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("Choose an inbox to read.", 400);
  const routing = missiveRouting(config);
  requireRoutingRevision(routing, input.revision);
  const route = missiveFeedRoutes(routing, access, visibleCompanyIds).routes.find(candidate => candidate.id === input.routeId);
  if (!route) throw new ApiError("This inbox is not available for your assigned companies. Refresh the inbox.", 403);
  return { revision: routing.revision, route, until: requestUntil(input.until) };
}
function scopedConversation(value: unknown, route: MissiveFeedRoute, expectedId?: string): Record<string, unknown> {
  const conversation = object(value);
  const organization = object(conversation.organization), team = object(conversation.team);
  if (organization.id !== route.organizationId || team.id !== route.teamId ||
    (team.organization !== undefined && team.organization !== route.organizationId)) changed();
  if (expectedId !== undefined && conversation.id !== expectedId) changed();
  id(conversation.id);
  return conversation;
}
function conversationSummary(value: Record<string, unknown>): MissiveFeedConversation {
  return { id: id(value.id), subject: text(value.subject ?? value.latest_message_subject ?? "") || "(No subject)", at: timestamp(value.last_activity_at) };
}
function pageCursor(values: Record<string, unknown>[], field: string, limit: number, requestedUntil?: number) {
  const times = values.map(value => timestamp(value[field]));
  const ids = values.map(value => id(value.id));
  if (new Set(ids).size !== ids.length || times.some((at, index) =>
    (index > 0 && at > times[index - 1]) || (requestedUntil !== undefined && at > requestedUntil))) invalid();
  const until = values.length < limit || new Set(times).size < 2 ? null : Math.min(...times);
  if (until !== null && requestedUntil !== undefined && until >= requestedUntil) invalid();
  return until;
}
async function readConversation(read: MissiveFeedReader, route: MissiveFeedRoute, conversationId: string) {
  const values = records((await read(`/v1/conversations/${conversationId}`)).conversations, 1);
  if (values.length !== 1) invalid();
  return scopedConversation(values[0], route, conversationId);
}

// Endpoint and cursor semantics: https://missiveapp.com/docs/developers/rest-api/endpoints
// All paths below are constructed from validated identifiers and issue GET reads only.
export async function listMissiveFeedConversations(read: MissiveFeedReader, config: unknown, access: Access,
  visibleCompanyIds: readonly string[], input: MissiveFeedSelection): Promise<MissiveFeedPage<MissiveFeedConversation>> {
  const { revision, route, until } = selection(config, access, visibleCompanyIds, input);
  const values = records((await read(`/v1/conversations?team_inbox=${route.teamId}&limit=${CONVERSATION_LIMIT}${queryUntil(until)}`)).conversations);
  const next = pageCursor(values, "last_activity_at", CONVERSATION_LIMIT, until);
  const rows = values.filter(value => value.organization != null && value.team != null)
    .map(value => conversationSummary(scopedConversation(value, route)));
  return { revision, route, rows, until: next, skipped: values.length - rows.length };
}
function incoming(value: Record<string, unknown>) {
  text(value.type, 100);
  if (value.draft !== undefined && typeof value.draft !== "boolean") invalid();
  return value.type === "email" && value.draft !== true && value.author == null;
}
function addresses(value: unknown): MissiveFeedAddress[] {
  return records(value).map(address => ({ name: text(address.name ?? "", 1000), address: email(address.address) }));
}
function email(value: unknown) {
  const address = text(value, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) invalid();
  return address;
}
function attachments(value: unknown): MissiveFeedAttachment[] {
  const values = records(value);
  const result = values.map(attachment => {
    const bytes = typeof attachment.size === "number" && Number.isSafeInteger(attachment.size) && attachment.size >= 0 ? attachment.size : invalid();
    return { id: id(attachment.id), name: text(attachment.filename, 1000),
      mime: `${text(attachment.media_type, 100)}/${text(attachment.sub_type, 100)}`,
      bytes, status: "not_downloaded" as const };
  });
  if (new Set(result.map(attachment => attachment.id)).size !== result.length) invalid();
  return result;
}
function messageMetadata(value: Record<string, unknown>): Omit<MissiveFeedMessageSummary, "preview"> {
  const sender = object(value.from_field), address = email(sender.address);
  return { id: id(value.id), subject: text(value.subject ?? "") || "(No subject)",
    from: text(sender.name ?? "", 1000) || address, email: address,
    receivedAt: new Date(timestamp(value.delivered_at) * 1000).toISOString(),
    attachments: attachments(value.attachments) };
}
function messageSummary(value: Record<string, unknown>): MissiveFeedMessageSummary {
  // Preview may be redacted by Missive. Metadata can still be shown; full body
  // reads below reject a missing body instead of claiming the email was empty.
  return { ...messageMetadata(value), preview: htmlPlainText(text(value.preview ?? "", 20_000)) };
}
export async function listMissiveFeedMessages(read: MissiveFeedReader, config: unknown, access: Access,
  visibleCompanyIds: readonly string[], input: MissiveFeedConversationSelection): Promise<MissiveFeedPage<MissiveFeedMessageSummary> & { conversation: MissiveFeedConversation }> {
  const { revision, route, until } = selection(config, access, visibleCompanyIds, input);
  const conversationId = requestId(input.conversationId);
  await readConversation(read, route, conversationId);
  const values = records((await read(`/v1/conversations/${conversationId}/messages?limit=${MESSAGE_LIMIT}${queryUntil(until)}`)).messages);
  const next = pageCursor(values, "delivered_at", MESSAGE_LIMIT, until);
  const rows = values.filter(incoming).map(value => {
    // This endpoint normally omits conversation, but reject conflicting scope if
    // the provider includes it. The conversation request above always verifies it.
    if (value.conversation !== undefined) scopedConversation(value.conversation, route, conversationId);
    return messageSummary(value);
  });
  // Message list rows normally omit their conversation. Recheck the parent after
  // fetching them so a concurrent team move cannot expose another inbox's email.
  const conversation = conversationSummary(await readConversation(read, route, conversationId));
  return { revision, route, conversation, rows, until: next, skipped: values.length - rows.length };
}
export async function readMissiveFeedMessage(read: MissiveFeedReader, config: unknown, access: Access,
  visibleCompanyIds: readonly string[], input: MissiveFeedMessageSelection): Promise<{
    revision: number; route: MissiveFeedRoute; conversation: MissiveFeedConversation; message: MissiveFeedMessage;
  }> {
  const { revision, route } = selection(config, access, visibleCompanyIds, input);
  const conversationId = requestId(input.conversationId), messageId = requestId(input.messageId);
  await readConversation(read, route, conversationId);
  const value = object((await read(`/v1/messages/${messageId}`)).messages);
  if (value.id !== messageId || !incoming(value))
    throw new ApiError("Only received email can be read here. Refresh the inbox.", 409);
  scopedConversation(value.conversation, route, conversationId);
  const summary = messageMetadata(value);
  const message = { ...summary, body: htmlPlainText(text(value.body, 500_000)),
    to: addresses(value.to_fields), cc: addresses(value.cc_fields ?? []) };
  const conversation = conversationSummary(await readConversation(read, route, conversationId));
  return { revision, route, conversation, message };
}
