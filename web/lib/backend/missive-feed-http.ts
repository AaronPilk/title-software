import { ApiError, canCompany, type Access } from "./workspace";
import type { Workspace } from "../title/model";
import { credentialStatus, workspaceMissiveConfig } from "./missive-credentials";
import { missiveReadTransport, type MissiveConfig } from "./missive";
import { missiveRouting } from "./missive-routing";
import { missiveFeedRoutes, listMissiveFeedConversations, listMissiveFeedMessages, readMissiveFeedMessage } from "./missive-feed";

type Credential = { exists: boolean; configured: boolean; revision: number; verifiedAt: string | null; token?: string | null };
export type MissiveFeedContext = {
  workspaceId: string; access: Access; state: Workspace;
  integration: { status: string; config: unknown } | null;
  fallback: MissiveConfig;
  credential: (routeId: string | null, revision: number | null, decrypt: boolean) => Promise<Credential>;
  fetcher?: typeof fetch;
};

export async function missiveFeedRequest(path: string, method: string, input: Record<string, unknown>, ctx: MissiveFeedContext) {
  const routes = missiveFeedRoutes(missiveRouting(ctx.integration?.config), ctx.access,
    ctx.state.companies.filter(c => canCompany(ctx.access, c.id)).map(c => c.id));
  const setup = path === "/missive-feed" && method === "GET";
  if (!setup && (method !== "POST" || !["/missive-feed/conversations", "/missive-feed/messages", "/missive-feed/message"].includes(path)))
    throw new ApiError("This email connection supports read-only browsing.", 405);
  const status = await ctx.credential(null, null, false);
  const connected = credentialStatus(status, ctx.fallback, ctx.workspaceId).configured;
  const connectionState = !connected ? "token_required" : !routes.routes.length ? "routing_required"
    : !["configured", "healthy", "error"].includes(ctx.integration?.status || "") ? "paused" : "ready";
  if (setup) return { ...routes, status: connectionState, readOnly: true, checkedAt: new Date().toISOString() };
  if (connectionState !== "ready") throw new ApiError(connectionState === "token_required"
    ? "An administrator must connect Missive first." : "No approved email inbox is available. Ask an administrator to review company routing.", 409);
  const route = routes.routes.find(r => r.id === input.routeId);
  if (!route || input.revision !== routes.revision) throw new ApiError("Your inbox access or routing changed. Refresh the inbox list.", 409);
  const credential = await ctx.credential(route.id, routes.revision, true);
  const read = missiveReadTransport(workspaceMissiveConfig({ ...credential, token: credential.token ?? null }, ctx.fallback, ctx.workspaceId), ctx.workspaceId, ctx.fetcher);
  const companyIds = ctx.state.companies.filter(c => canCompany(ctx.access, c.id)).map(c => c.id);
  const routing = missiveRouting(ctx.integration?.config);
  const options = { routeId: route.id, revision: routes.revision, until: input.until as number | undefined, conversationId: input.conversationId as string, messageId: input.messageId as string };
  const result = path.endsWith("/conversations") ? await listMissiveFeedConversations(read, routing, ctx.access, companyIds, options)
    : path.endsWith("/messages") ? await listMissiveFeedMessages(read, routing, ctx.access, companyIds, options)
    : await readMissiveFeedMessage(read, routing, ctx.access, companyIds, options);
  // The provider call can outlast a revocation, route edit or credential change.
  // Recheck against current database state before any email reaches the browser.
  const current = await ctx.credential(route.id, routes.revision, false);
  if (current.revision !== credential.revision || !credentialStatus(current, ctx.fallback, ctx.workspaceId).configured)
    throw new ApiError("The email connection changed. Refresh before opening this message.", 409);
  return result;
}
