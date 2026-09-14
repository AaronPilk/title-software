import { ApiError } from './workspace';
import type { MissiveMapping } from './missive-import';

export type MissiveRoute = MissiveMapping & { id: string; enabled: boolean };
export type MissiveRouting = { schemaVersion: 2; revision: number; mappings: MissiveRoute[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const validId = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
export const missiveRouteId = (m: Pick<MissiveMapping, 'organizationId' | 'teamId' | 'companyId'>) => `route:${m.organizationId}:${m.teamId}:${m.companyId}`;
const invalid = (): never => { throw new ApiError('Saved inbox routing is incomplete. Ask an administrator to review it.', 409); };
/** Read old single-inbox configuration without changing source identities or approval versions. */
export function missiveRouting(config: unknown): MissiveRouting {
  const c = object(config);
  if (c.schemaVersion !== undefined && c.schemaVersion !== 2) invalid();
  if (c.schemaVersion !== 2 && !c.mapping) return { schemaVersion: 2, revision: 0, mappings: [] };
  const legacy = c.schemaVersion !== 2;
  const revision = legacy ? object(c.mapping).version : c.revision;
  const values = legacy ? [c.mapping] : c.mappings;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0 || !Array.isArray(values) || values.length > 500) invalid();
  const mappings = (values as unknown[]).map(value => {
    const m = object(value);
    if (![m.organizationId, m.teamId, m.companyId].every(validId) || !Number.isSafeInteger(m.version) || Number(m.version) < 1 || Number(m.version) > Number(revision) ||
      typeof m.teamName !== 'string' || m.teamName.length > 500 || typeof m.approvedAt !== 'string' || !Number.isFinite(Date.parse(m.approvedAt)) ||
      typeof m.approvedBy !== 'string' || !m.approvedBy.trim() || m.approvedBy.length > 320 || (!legacy && typeof m.enabled !== 'boolean')) invalid();
    const mapping = m as MissiveMapping;
    const id = missiveRouteId(mapping);
    if (!legacy && m.id !== id) invalid();
    return { ...mapping, id, enabled: legacy || m.enabled === true } as MissiveRoute;
  });
  if (new Set(mappings.map(m => m.id)).size !== mappings.length) invalid();
  return { schemaVersion: 2, revision: Number(revision), mappings };
}
export function requireRoutingRevision(routing: MissiveRouting, expected: unknown) {
  if (!Number.isSafeInteger(expected) || expected !== routing.revision)
    throw new ApiError('Inbox routing changed. Refresh and review the company and file again.', 409);
}
export function selectMissiveRoute(routing: MissiveRouting, expected: unknown, routeId: unknown): MissiveRoute {
  requireRoutingRevision(routing, expected);
  const route = routing.mappings.find(m => m.enabled && m.id === routeId);
  if (!route) throw new ApiError('Choose an active inbox and destination company before reviewing this message.', 409);
  return route;
}
/** Configured companies remain part of an inbox's identity while a route is paused. */
export function missiveInboxRoutes(routing: MissiveRouting, scope: { organizationId?: unknown; teamId?: unknown }): MissiveRoute[] {
  return routing.mappings.filter(m => m.organizationId === scope.organizationId && m.teamId === scope.teamId);
}
export function missiveEventRoutes(routing: MissiveRouting, event: { organizationId?: unknown; teamId?: unknown; companyId?: unknown; candidateRoutes?: unknown }): MissiveRoute[] {
  // Events captured with one approved destination preserve that choice even if
  // the inbox later becomes shared. Only genuinely shared events have no company.
  const legacyCompany = typeof event.companyId === 'string' ? event.companyId : null;
  return missiveInboxRoutes(routing, event).filter(m => m.enabled && (!legacyCompany || m.companyId === legacyCompany));
}
