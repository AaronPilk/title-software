import type { Order, Workspace } from "./model";
import { finalReadiness, neededFields, orderSources, productionLocked, referencedSourceProblems } from "./production";

export type FinalsStage = "Ready" | "Needs review" | "Waiting" | "Partially issued";
export type FinalsQueueItem = {
  order: Order;
  stage: FinalsStage;
  receivedAt: string | null;
  ageDays: number | null;
  requestCount: number;
  missingSourceCount: number;
  pendingFieldCount: number;
  waitingReasons: string[];
};
export type FinalsFilters = { company?: string; owner?: string; stage?: string; query?: string };

function receiptDate(value: string | undefined, now: Date): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const time = Date.parse(value);
  const calendar = value.slice(0, 10);
  if (!Number.isFinite(time) || time > now.getTime() ||
    new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) return null;
  return new Date(time).toISOString();
}

export function finalsQueue(s: Workspace, now = new Date()): FinalsQueueItem[] {
  return s.orders.flatMap(order => {
    if (["Issued", "Rejected"].includes(order.status)) return [];
    const requests = s.inbox.filter(m => m.kind === "Finals" && m.orderId === order.id &&
      (!m.companyId || m.companyId === order.companyId));
    const hasFinalOpinion = orderSources(s, order.id).some(d => d.sourceRole === "Final opinion");
    const hasFinalCapture = order.fields.some(f => f.documentId && neededFields(order).some(def => def.id === f.id));
    if (!requests.length && !hasFinalOpinion && !hasFinalCapture && order.status !== "Ready for jacket") return [];
    const dates = requests.map(m => receiptDate(m.missive?.receivedAt || m.time, now));
    // The initial order date and document upload date do not establish final receipt.
    // One undated request can precede every dated request, so its age stays unknown.
    const receivedAt = dates.length && dates.every(Boolean) ? (dates as string[]).sort()[0] : null;
    const check = finalReadiness(s, order);
    const followups = (s.business?.followups || []).filter(r =>
      r.orderId === order.id && !["Resolved", "Cancelled"].includes(r.status));
    const references = referencedSourceProblems(s, order);
    const waitingReasons = [
      ...check.missingSources.map(role => `Missing ${role.toLowerCase()}`),
      ...(followups.length ? [`${followups.length} outstanding attorney follow-up${followups.length === 1 ? "" : "s"}`] : []),
      ...(references.length ? [`${references.length} required source reference${references.length === 1 ? "" : "s"} unresolved`] : []),
      ...(order.exception ? [order.exception] : []),
    ];
    const stage: FinalsStage = productionLocked(s, order) ? "Partially issued" :
      waitingReasons.length ? "Waiting" : check.ready ? "Ready" : "Needs review";
    return [{ order, stage, receivedAt,
      ageDays: receivedAt ? Math.floor((now.getTime() - Date.parse(receivedAt)) / 86_400_000) : null,
      requestCount: requests.length, missingSourceCount: check.missingSources.length,
      pendingFieldCount: check.pendingFields.length, waitingReasons }];
  }).sort((a, b) =>
    a.receivedAt && b.receivedAt ? a.receivedAt.localeCompare(b.receivedAt) || a.order.id.localeCompare(b.order.id) :
      a.receivedAt ? -1 : b.receivedAt ? 1 : a.order.id.localeCompare(b.order.id));
}

export function filterFinalsQueue(s: Workspace, rows: FinalsQueueItem[], filters: FinalsFilters) {
  const query = filters.query?.trim().toLowerCase() || "";
  return rows.filter(({ order, stage }) =>
    (!filters.company || filters.company === "all" || order.companyId === filters.company) &&
    (!filters.owner || filters.owner === "all" || order.owner === (filters.owner === "__unassigned" ? "" : filters.owner)) &&
    (!filters.stage || filters.stage === "All finals" || stage === filters.stage) &&
    `${order.id} ${order.address} ${order.client} ${order.owner} ${s.companies.find(c => c.id === order.companyId)?.name || ""}`.toLowerCase().includes(query));
}

export function nextReadyFinal(rows: FinalsQueueItem[], currentId: string) {
  const current = rows.findIndex(r => r.order.id === currentId);
  const ordered = current < 0 ? rows : [...rows.slice(current + 1), ...rows.slice(0, current)];
  return ordered.find(r => r.stage === "Ready")?.order.id;
}
