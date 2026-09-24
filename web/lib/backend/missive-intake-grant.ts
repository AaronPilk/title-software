import { ApiError, canCompany, projectWorkspace, type Access } from "./workspace";
import type { Workspace } from "../title/model";
import type { MissiveMapping } from "./missive-import";
import type { MissiveRouting } from "./missive-routing";

declare const intakeGrant: unique symbol;
export type MissiveIntakeGrant = { readonly [intakeGrant]: true };
const grants = new WeakMap<object, { actor: string; mapping: string; orderId: string }>();
const denied = (): never => { throw new ApiError("This Production email route is outside your current access.", 403); };
const actorKey = (a: Access) => JSON.stringify([a.userId, a.email, a.role, a.version, a.allCompanies, a.companyIds, a.restricted]);
const mappingKey = (m: MissiveMapping) => JSON.stringify([m.organizationId, m.teamId, m.companyId, m.version]);

/** Server-only capability. Request JSON cannot recreate a WeakMap entry. The HTTP
 * caller must additionally revalidate live membership/routing/credential at commit. */
export function createMissiveIntakeGrant(state: Workspace, access: Access, routing: MissiveRouting, routeId: string, orderId: string): MissiveIntakeGrant {
  const route = routing.mappings.find(r => r.id === routeId && r.enabled);
  if (!route || !["owner", "admin", "operations"].includes(access.role) ||
    !canCompany(access, route.companyId) || !state.companies.some(c => c.id === route.companyId) ||
    (access.role === "operations" && route.productionOnly !== true) ||
    routing.mappings.some(r => r.organizationId === route.organizationId && r.teamId === route.teamId && r.companyId !== route.companyId) ||
    !projectWorkspace(state, access).orders.some(o => o.id === orderId && o.companyId === route.companyId)) denied();
  const grant = Object.freeze({}) as MissiveIntakeGrant;
  grants.set(grant, { actor: actorKey(access), mapping: mappingKey(route!), orderId });
  return grant;
}
export function requireMissiveGrant(grant: MissiveIntakeGrant, state: Workspace, access: Access, mapping: MissiveMapping, orderId?: string) {
  const saved = grants.get(grant);
  if (!saved || saved.actor !== actorKey(access) || saved.mapping !== mappingKey(mapping) ||
      (orderId !== undefined && saved.orderId !== orderId) ||
      !state.orders.some(o => o.id === saved.orderId && o.companyId === mapping.companyId)) denied();
}
