import { ApiError, type Access } from "./workspace";

export const SECURITY_EVENT_TYPES = ["file.download", "workspace.export", "backup.created", "backup.restored", "authorization.denied", "security.events_exported", "access.reviewed", "document.scan_clean", "document.scan_blocked", "document.scan_unavailable"] as const;
export type SecurityEventType = typeof SECURITY_EVENT_TYPES[number];
export type SecurityRecordType = "asset" | "workspace" | "backup" | "access_review";
export type SecurityEventInput = {
  eventType: SecurityEventType;
  outcome: "success" | "denied" | "failure";
  companyId?: string | null;
  recordType?: SecurityRecordType | null;
  recordId?: string | null;
  count?: number | null;
};
export type SecurityEvent = {
  id: string; createdAt: string; actorId: string | null;
  eventType: SecurityEventType; outcome: SecurityEventInput["outcome"];
  companyId: string | null; recordType: SecurityRecordType | null; recordId: string | null; count: number | null;
};
export type SecurityCursor = { createdAt: string; id: string };
export type SecurityEventPage = { items: SecurityEvent[]; nextCursor: SecurityCursor | null };
export type AccessReviewMember = {
  userId: string; role: Access["role"]; companyIds: string[]; allCompanies: boolean;
  restricted: boolean; active: boolean; version: number; partnerAssignmentsDigest: string;
};
export type AccessReviewSnapshot = { companyIds: string[]; members: AccessReviewMember[] };
/** Display-only directory labels, deliberately outside persisted review/event types. */
export type SecurityMemberLabel = { userId: string; email: string | null };
export type SecurityCompanyLabel = { id: string; name: string };
export type AccessReview = {
  id: string; createdAt: string; actorId: string; snapshotDigest: string;
  memberCount: number; note: string; current: boolean;
};
export type SecurityCenterSummary = {
  checkedAt: string; snapshot: AccessReviewSnapshot; snapshotDigest: string;
  latestReview: AccessReview | null;
  evidence: { eventCount: number; lastEventAt: string | null; lastBackupAt: string | null; backupCount: number };
  documentScanning?: { configured: boolean; policy: "pending_setup" | "required_new_uploads"; legacyUnscannedCount: number };
};
export type AccessReviewInput = { workspaceId: string; snapshotDigest: string; note: string };
export type SecurityControl = { id: string; label: string; status: "observed" | "needs_review" | "external_verification"; detail: string };
export type SecurityAuditTransport = (name: "title_record_security_event", parameters: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export type SecurityAuditContext = { workspaceId: string; actorId: string | null; accessVersion?: number | null; workspaceRevision?: number | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export function canManageSecurityCenter(access: Pick<Access, "role" | "allCompanies">) {
  return access.role === "owner" || (access.role === "admin" && access.allCompanies === true);
}
export function requireSecurityCenterAccess(access: Pick<Access, "role" | "allCompanies">) {
  if (!canManageSecurityCenter(access)) throw new ApiError("Only the owner or a workspace-wide administrator can open the security center.", 403);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Expected a security request object.");
  return value as Record<string, unknown>;
}
function allowedKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ApiError("Unsupported security request field.");
}
export function securityUuid(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new ApiError("A valid record ID is required.");
  return value;
}
export function parseSecurityEvent(value: unknown): SecurityEventInput {
  const v = object(value);
  allowedKeys(v, ["eventType", "outcome", "companyId", "recordType", "recordId", "count"]);
  if (!SECURITY_EVENT_TYPES.includes(v.eventType as SecurityEventType) || !["success", "denied", "failure"].includes(String(v.outcome))) throw new ApiError("Choose an allowed security event.");
  for (const key of ["companyId", "recordId"]) if (v[key] != null && (typeof v[key] !== "string" || !recordId.test(v[key] as string))) throw new ApiError("A valid record ID is required.");
  if (v.recordType != null && !["asset", "workspace", "backup", "access_review"].includes(String(v.recordType))) throw new ApiError("Choose an allowed record type.");
  if ((v.recordId == null) !== (v.recordType == null)) throw new ApiError("Record type and ID must be supplied together.");
  if (v.recordType && v.recordType !== "asset") securityUuid(v.recordId);
  if (v.count != null && (!Number.isSafeInteger(v.count) || (v.count as number) < 0 || (v.count as number) > 1_000_000)) throw new ApiError("Choose a valid record count.");
  if ((v.eventType === "authorization.denied") !== (v.outcome === "denied")) throw new ApiError("Denied outcomes require the authorization-denied event.");
  const expected: Partial<Record<SecurityEventType, SecurityRecordType>> = { "file.download": "asset", "workspace.export": "workspace", "backup.created": "backup", "backup.restored": "backup", "access.reviewed": "access_review" };
  if (v.outcome === "success" && expected[v.eventType as SecurityEventType] && v.recordType !== expected[v.eventType as SecurityEventType]) throw new ApiError("This event requires its associated record ID.");
  return { eventType: v.eventType as SecurityEventType, outcome: v.outcome as SecurityEventInput["outcome"], companyId: v.companyId as string | null ?? null, recordType: v.recordType as SecurityRecordType | null ?? null, recordId: v.recordId as string | null ?? null, count: v.count as number | null ?? null };
}
/** Await this before releasing successful sensitive reads. Failure discloses no raw database error. */
export async function recordSecurityEvent(transport: SecurityAuditTransport, context: SecurityAuditContext, input: SecurityEventInput): Promise<string> {
  securityUuid(context.workspaceId); if (context.actorId !== null) securityUuid(context.actorId);
  const event = parseSecurityEvent(input);
  if (context.actorId !== null && event.eventType !== "authorization.denied" && (!Number.isSafeInteger(context.accessVersion) || (context.accessVersion ?? 0) < 1)) throw new ApiError("Current membership evidence is required.", 403);
  if (event.eventType === "file.download" && event.outcome === "success" && (!Number.isSafeInteger(context.workspaceRevision) || (context.workspaceRevision ?? -1) < 0)) throw new ApiError("Current document access evidence is required.", 403);
  try {
    const result = await transport("title_record_security_event", { p_workspace: context.workspaceId, p_actor: context.actorId, p_access_version: context.accessVersion ?? null, p_workspace_revision: context.workspaceRevision ?? null,
      p_event_type: event.eventType, p_outcome: event.outcome, p_company_id: event.companyId, p_record_type: event.recordType, p_record_id: event.recordId, p_count: event.count });
    if (result.error || typeof result.data !== "string" || !uuid.test(result.data)) throw new Error("audit unavailable");
    return result.data;
  } catch { throw new ApiError("Security evidence could not be recorded. Try again before continuing.", 503); }
}
export function parseSecurityPage(query: URLSearchParams) {
  for (const key of query.keys()) if (!["workspaceId", "before", "beforeId", "limit", "format"].includes(key) || query.getAll(key).length !== 1) throw new ApiError("Invalid security-event query.");
  const before = query.get("before"), beforeId = query.get("beforeId");
  if ((before === null) !== (beforeId === null)) throw new ApiError("Both pagination cursor fields are required.");
  if (before !== null && (!timestamp.test(before) || !Number.isFinite(Date.parse(before)))) throw new ApiError("Invalid security-event timestamp.");
  if (beforeId !== null) securityUuid(beforeId);
  const raw = query.get("limit") ?? "50";
  if (!/^[1-9]\d{0,2}$/.test(raw) || Number(raw) > 100) throw new ApiError("Choose a page size from 1 to 100.");
  const format = query.get("format") ?? "json";
  if (!["json", "csv"].includes(format)) throw new ApiError("Choose JSON or CSV.");
  return { before, beforeId, limit: Number(raw), format: format as "json" | "csv" };
}
export function parseAccessReview(value: unknown): AccessReviewInput {
  const v = object(value); allowedKeys(v, ["workspaceId", "snapshotDigest", "note"]);
  const workspaceId = securityUuid(v.workspaceId);
  if (typeof v.snapshotDigest !== "string" || !/^[a-f0-9]{32}$/.test(v.snapshotDigest)) throw new ApiError("Refresh the access snapshot before recording a review.");
  if (typeof v.note !== "string" || !v.note.trim() || v.note.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.note)) throw new ApiError("Enter a review note of 1–1,000 characters without control characters.");
  return { workspaceId, snapshotDigest: v.snapshotDigest, note: v.note.trim() };
}
// Copy only the fixed metadata contract. Never serialize arbitrary audit details.
export function redactSecurityEvent(value: SecurityEvent): SecurityEvent {
  const parsed = parseSecurityEvent({ eventType: value.eventType, outcome: value.outcome, companyId: value.companyId, recordType: value.recordType, recordId: value.recordId, count: value.count });
  securityUuid(value.id); if (value.actorId !== null) securityUuid(value.actorId);
  if (!timestamp.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new ApiError("Invalid security-event timestamp.");
  return { id: value.id, createdAt: value.createdAt, actorId: value.actorId, eventType: parsed.eventType, outcome: parsed.outcome, companyId: parsed.companyId ?? null, recordType: parsed.recordType ?? null, recordId: parsed.recordId ?? null, count: parsed.count ?? null };
}
export function securityEventsCsv(items: SecurityEvent[]): string {
  if (items.length > 100) throw new ApiError("Security exports are limited to 100 events per page.");
  const columns = ["id", "createdAt", "actorId", "eventType", "outcome", "companyId", "recordType", "recordId", "count"] as const;
  const cell = (v: unknown) => { const text = v == null ? "" : String(v); return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`; };
  return [columns.join(","), ...items.map(item => { const safe = redactSecurityEvent(item); return columns.map(key => cell(safe[key])).join(","); })].join("\r\n") + "\r\n";
}
export function securityReadiness(summary: SecurityCenterSummary): SecurityControl[] {
  return [
    { id: "access", label: "Access review", status: summary.latestReview?.current ? "observed" : "needs_review", detail: summary.latestReview?.current ? `Recorded ${summary.latestReview.createdAt}; current membership snapshot matches.` : summary.latestReview ? "Memberships or company scope changed since the last review." : "No access review has been recorded." },
    { id: "events", label: "Security event evidence", status: summary.evidence.eventCount ? "observed" : "needs_review", detail: `${summary.evidence.eventCount} retained events; latest ${summary.evidence.lastEventAt ?? "not recorded"}. Counts do not establish monitoring coverage.` },
    { id: "backup", label: "Workspace backup evidence", status: summary.evidence.backupCount ? "observed" : "needs_review", detail: `${summary.evidence.backupCount} stored workspace snapshots; latest ${summary.evidence.lastBackupAt ?? "not recorded"}. A snapshot does not prove original-file recovery.` },
    { id: "operations", label: "Operational and legal review", status: "external_verification", detail: "Assign an incident contact, verify recovery exercises and monitoring, and review agency/vendor obligations and contracts outside this screen." },
  ];
}
