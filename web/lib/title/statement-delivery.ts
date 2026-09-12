import type { Workspace } from "./model";
import { moneyCents } from "./model";
import type { ClosePeriod } from "./business";

export type StatementSnapshot = {
  companyId: string;
  companyName: string;
  closeId: string;
  month: string;
  revision: number;
  memberName: string;
  share: number;
  amount: number;
  retained: number;
  expenses: number;
  adjustment: number;
  reserve: number;
  available: number;
  publishedAt: string;
  reviewedBy: string;
};
export type StatementDelivery = {
  id: string;
  companyId: string;
  closeId: string;
  memberName: string;
  recipientName: string;
  recipientEmail: string;
  reviewNote: string;
  preparedBy: string;
  preparedAt: string;
  snapshot: StatementSnapshot;
  status: "Prepared" | "Recorded" | "Cancelled";
  deliveredOn: string;
  deliveryReference: string;
  deliveryNote: string;
  recordedBy: string;
  recordedAt: string;
  cancelReason: string;
  cancelledBy: string;
  cancelledAt: string;
};
const now = () => new Date().toISOString();
const emailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const dayValid = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const actor = (s: Workspace) => {
  if (!s.user.trim())
    throw new Error("Choose the operator recording this work.");
  return s.user;
};
export function statementDeliveries(s: Workspace, companyId?: string) {
  return (s.statementDeliveries || []).filter(
    (r) => companyId === undefined || r.companyId === companyId,
  );
}
function capturedStatement(
  p: ClosePeriod,
  memberName: string,
): StatementSnapshot {
  const allocations = p.allocations.filter((a) => a.name === memberName);
  const members = p.members.filter((m) => m.name === memberName);
  // Existing closes identify members by name. Ambiguous names must never
  // silently select the first person's allocation.
  if (
    allocations.length !== 1 ||
    members.length !== 1 ||
    members[0].share !== allocations[0].share
  )
    throw new Error("Choose one unambiguous member captured in this close.");
  const a = allocations[0];
  return {
    companyId: p.companyId,
    companyName: p.companyName,
    closeId: p.id,
    month: p.month,
    revision: p.revision,
    memberName: a.name,
    share: a.share,
    amount: a.amount,
    retained: p.totals.retained,
    expenses: p.expenses,
    adjustment: p.adjustment,
    reserve: p.reserve,
    available: p.totals.available,
    publishedAt: p.publishedAt,
    reviewedBy: p.reviewedBy,
  };
}
export function statementDeliveryCurrent(s: Workspace, r: StatementDelivery) {
  const p = s.business?.closes.find(
    (p) => p.id === r.closeId && p.companyId === r.companyId,
  );
  if (!p || p.status !== "Published" || r.status === "Cancelled") return false;
  try {
    return (
      JSON.stringify(capturedStatement(p, r.memberName)) ===
      JSON.stringify(r.snapshot)
    );
  } catch {
    return false;
  }
}
export function prepareStatementDelivery(
  s: Workspace,
  input: {
    companyId: string;
    closeId: string;
    memberName: string;
    recipientName: string;
    recipientEmail: string;
    reviewNote: string;
    confirmed: boolean;
  },
): StatementDelivery {
  const p = s.business?.closes.find(
    (p) => p.id === input.closeId && p.companyId === input.companyId,
  );
  if (
    !p ||
    p.status !== "Published" ||
    !s.companies.some((c) => c.id === p.companyId)
  )
    throw new Error("Choose a published close for this company.");
  if (
    !input.confirmed ||
    !input.reviewNote.trim() ||
    !input.recipientName.trim() ||
    !emailValid(input.recipientEmail.trim())
  )
    throw new Error(
      "Review the statement, recipient name and email, and enter a review note.",
    );
  const snapshot = capturedStatement(p, input.memberName);
  const existing = statementDeliveries(s).find(
    (r) =>
      r.status === "Prepared" &&
      r.closeId === p.id &&
      r.memberName === input.memberName &&
      r.recipientName === input.recipientName.trim() &&
      r.recipientEmail.toLowerCase() ===
        input.recipientEmail.trim().toLowerCase() &&
      r.reviewNote === input.reviewNote.trim() &&
      r.preparedBy === s.user &&
      JSON.stringify(r.snapshot) === JSON.stringify(snapshot),
  );
  if (existing) return existing;
  const r: StatementDelivery = {
    id: `statement-delivery-${crypto.randomUUID()}`,
    companyId: p.companyId,
    closeId: p.id,
    memberName: input.memberName,
    recipientName: input.recipientName.trim(),
    recipientEmail: input.recipientEmail.trim(),
    reviewNote: input.reviewNote.trim(),
    preparedBy: actor(s),
    preparedAt: now(),
    snapshot,
    status: "Prepared",
    deliveredOn: "",
    deliveryReference: "",
    deliveryNote: "",
    recordedBy: "",
    recordedAt: "",
    cancelReason: "",
    cancelledBy: "",
    cancelledAt: "",
  };
  if (!isValidStatementDeliveries([r]))
    throw new Error(
      "The published statement contains incomplete or invalid values.",
    );
  s.statementDeliveries ??= [];
  s.statementDeliveries.unshift(r);
  return r;
}
function getDelivery(s: Workspace, deliveryId: string) {
  const r = s.statementDeliveries?.find((r) => r.id === deliveryId);
  if (!r) throw new Error("This statement preparation is no longer available.");
  return r;
}
const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, " ");
export function statementDeliveryText(s: Workspace, deliveryId: string) {
  const r = getDelivery(s, deliveryId);
  if (r.status !== "Recorded" && !statementDeliveryCurrent(s, r))
    throw new Error(
      "This preparation is cancelled or its published source changed. Prepare the current revision.",
    );
  const p = r.snapshot;
  return (
    [
      "LOCAL DEMO MEMBER STATEMENT — NOT PAYMENT INSTRUCTIONS",
      `Company: ${oneLine(p.companyName)}`,
      `Period: ${p.month} · Revision ${p.revision}`,
      `Statement preparation: ${r.id}`,
      `Member: ${oneLine(p.memberName)}`,
      `Recipient: ${oneLine(r.recipientName)} <${r.recipientEmail}>`,
      `Interest at close: ${p.share}%`,
      `Approved allocation: ${moneyCents(p.amount)}`,
      `Company retained revenue: ${moneyCents(p.retained)}`,
      `Operating expenses: ${moneyCents(p.expenses)}`,
      `Adjustments: ${moneyCents(p.adjustment)}`,
      `Reserve withheld: ${moneyCents(p.reserve)}`,
      `Company amount available: ${moneyCents(p.available)}`,
      `Published: ${p.publishedAt}`,
      `Reviewed by: ${oneLine(p.reviewedBy)}`,
      `Prepared by: ${oneLine(r.preparedBy)} · ${r.preparedAt}`,
      "Exporting this statement does not send it or confirm delivery.",
    ].join("\n") + "\n"
  );
}
type DeliveryOutcome = { deliveredOn: string; reference: string; note: string };
function deliveryDateValid(r: StatementDelivery, day: string) {
  return (
    dayValid(day) &&
    day >= r.preparedAt.slice(0, 10) &&
    day <= now().slice(0, 10)
  );
}
export function recordStatementDelivery(
  s: Workspace,
  deliveryId: string,
  input: DeliveryOutcome,
) {
  const r = getDelivery(s, deliveryId);
  if (r.status === "Recorded") {
    if (
      r.deliveredOn === input.deliveredOn &&
      r.deliveryReference === input.reference.trim() &&
      r.deliveryNote === input.note.trim()
    )
      return r;
    throw new Error(
      "This delivery is already recorded. Preserve the original evidence.",
    );
  }
  if (r.status !== "Prepared" || !statementDeliveryCurrent(s, r))
    throw new Error(
      "The published source changed or this preparation is closed. Prepare the current revision.",
    );
  if (
    !deliveryDateValid(r, input.deliveredOn) ||
    !input.reference.trim() ||
    !input.note.trim()
  )
    throw new Error(
      "Enter a delivery date from preparation through today, an evidence reference and a note.",
    );
  Object.assign(r, {
    status: "Recorded",
    deliveredOn: input.deliveredOn,
    deliveryReference: input.reference.trim(),
    deliveryNote: input.note.trim(),
    recordedBy: actor(s),
    recordedAt: now(),
  });
  return r;
}
export function cancelStatementDelivery(
  s: Workspace,
  deliveryId: string,
  reason: string,
) {
  const r = getDelivery(s, deliveryId);
  if (r.status === "Cancelled" && r.cancelReason === reason.trim()) return r;
  if (r.status !== "Prepared" || !reason.trim())
    throw new Error(
      "Only a prepared statement can be cancelled; record the reason.",
    );
  Object.assign(r, {
    status: "Cancelled",
    cancelReason: reason.trim(),
    cancelledBy: actor(s),
    cancelledAt: now(),
  });
  return r;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const filled = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const timestamp = (v: unknown) =>
  filled(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const recordStrings = [
  "id",
  "companyId",
  "closeId",
  "memberName",
  "recipientName",
  "recipientEmail",
  "reviewNote",
  "preparedBy",
  "preparedAt",
];
const outcomeKeys = [
  "deliveredOn",
  "deliveryReference",
  "deliveryNote",
  "recordedBy",
  "recordedAt",
];
const cancelKeys = ["cancelReason", "cancelledBy", "cancelledAt"];
export function isValidStatementDeliveries(
  value: unknown,
): value is StatementDelivery[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((r: unknown) => {
    if (
      !isObject(r) ||
      !recordStrings.every((k) => filled(r[k])) ||
      ![...outcomeKeys, ...cancelKeys].every((k) => typeof r[k] === "string") ||
      !emailValid(r.recipientEmail as string) ||
      !timestamp(r.preparedAt) ||
      ids.has(r.id as string) ||
      !isObject(r.snapshot)
    )
      return false;
    ids.add(r.id as string);
    const p = r.snapshot;
    if (
      ![
        "companyId",
        "companyName",
        "closeId",
        "month",
        "memberName",
        "publishedAt",
        "reviewedBy",
      ].every((k) => filled(p[k])) ||
      p.companyId !== r.companyId ||
      p.closeId !== r.closeId ||
      p.memberName !== r.memberName ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month as string) ||
      !timestamp(p.publishedAt) ||
      !Number.isInteger(p.revision) ||
      (p.revision as number) < 1 ||
      ![
        "share",
        "amount",
        "retained",
        "expenses",
        "adjustment",
        "reserve",
        "available",
      ].every((k) => typeof p[k] === "number" && Number.isFinite(p[k])) ||
      (p.share as number) < 0 ||
      (p.share as number) > 100 ||
      (p.amount as number) < 0
    )
      return false;
    if (
      (p.publishedAt as string) > (r.preparedAt as string) ||
      (r.preparedAt as string).slice(0, 10) > now().slice(0, 10)
    )
      return false;
    if (r.status === "Prepared")
      return [...outcomeKeys, ...cancelKeys].every((k) => r[k] === "");
    if (r.status === "Cancelled")
      return (
        cancelKeys.every((k) => filled(r[k])) &&
        timestamp(r.cancelledAt) &&
        (r.cancelledAt as string) >= (r.preparedAt as string) &&
        (r.cancelledAt as string).slice(0, 10) <= now().slice(0, 10) &&
        outcomeKeys.every((k) => r[k] === "")
      );
    return (
      r.status === "Recorded" &&
      outcomeKeys.every((k) => filled(r[k])) &&
      dayValid(r.deliveredOn as string) &&
      (r.deliveredOn as string) >= (r.preparedAt as string).slice(0, 10) &&
      timestamp(r.recordedAt) &&
      (r.recordedAt as string) >= (r.preparedAt as string) &&
      (r.recordedAt as string).slice(0, 10) <= now().slice(0, 10) &&
      (r.deliveredOn as string) <= (r.recordedAt as string).slice(0, 10) &&
      cancelKeys.every((k) => r[k] === "")
    );
  });
}
/** Restore checks both the entry shape and its frozen source relationship. */
export function isValidStatementDeliveryWorkspace(value: unknown): boolean {
  if (
    !isObject(value) ||
    !isValidStatementDeliveries(value.statementDeliveries)
  )
    return false;
  if (!value.statementDeliveries?.length) return true;
  if (!isObject(value.business) || !Array.isArray(value.business.closes))
    return false;
  const closes = value.business.closes;
  return value.statementDeliveries.every((r) => {
    const sources = closes.filter(
      (p) => isObject(p) && p.id === r.closeId && p.companyId === r.companyId,
    );
    if (
      sources.length !== 1 ||
      !["Published", "Superseded", "Withdrawn"].includes(sources[0].status)
    )
      return false;
    try {
      return (
        JSON.stringify(capturedStatement(sources[0], r.memberName)) ===
        JSON.stringify(r.snapshot)
      );
    } catch {
      return false;
    }
  });
}
function preparation(r: StatementDelivery) {
  return JSON.stringify({
    id: r.id,
    companyId: r.companyId,
    closeId: r.closeId,
    memberName: r.memberName,
    recipientName: r.recipientName,
    recipientEmail: r.recipientEmail,
    reviewNote: r.reviewNote,
    preparedBy: r.preparedBy,
    preparedAt: r.preparedAt,
    snapshot: r.snapshot,
  });
}
export function validateStatementDeliveryMutation(
  before: Workspace,
  after: Workspace,
) {
  if (!isValidStatementDeliveries(after.statementDeliveries))
    throw new Error(
      "The statement delivery register contains invalid evidence.",
    );
  for (const old of statementDeliveries(before)) {
    const r = after.statementDeliveries?.find((r) => r.id === old.id);
    if (!r || preparation(old) !== preparation(r))
      throw new Error(
        "Preserve the prepared statement and recipient. Cancel and prepare a new record.",
      );
    if (old.status !== "Prepared" && JSON.stringify(old) !== JSON.stringify(r))
      throw new Error(
        "Preserve recorded or cancelled statement delivery history.",
      );
    if (
      old.status === "Prepared" &&
      r.status === "Recorded" &&
      (!statementDeliveryCurrent(after, r) ||
        !deliveryDateValid(r, r.deliveredOn) ||
        r.recordedBy !== after.user)
    )
      throw new Error(
        "Record delivery only for a current published statement with its operator and date.",
      );
    if (
      old.status === "Prepared" &&
      r.status === "Cancelled" &&
      r.cancelledBy !== after.user
    )
      throw new Error("Record the operator cancelling this preparation.");
  }
  for (const r of statementDeliveries(after)) {
    if (
      !before.statementDeliveries?.some((x) => x.id === r.id) &&
      (r.status !== "Prepared" ||
        r.preparedBy !== after.user ||
        !statementDeliveryCurrent(after, r))
    )
      throw new Error(
        "Prepare and review the published statement before recording delivery.",
      );
  }
  if (!isValidStatementDeliveryWorkspace(after))
    throw new Error(
      "Preserve the close snapshot referenced by statement delivery history.",
    );
}
