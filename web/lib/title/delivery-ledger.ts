import { traceMutation, commandUuid } from "./command-log";
import type { VaultDoc, Workspace } from "./model";
import { sameDocumentFamily, currentOrderDocument } from "./production";

/**
 * A per-recipient, per-document-version record of a delivery that a person
 * actually made. Nothing here sends anything: exporting or downloading a
 * document is a separate action from recording that it reached someone.
 */

/** Suggested starting text. The recipient's name and email carry the real identity. */
export const recipientRoles = [
  "Buyer",
  "Seller",
  "Lender",
  "Closing attorney",
  "Underwriter",
  "Agent",
  "Other",
] as const;

export const deliveryMethods = [
  "Email",
  "Secure portal",
  "Provider system",
  "Mail or courier",
  "In person",
  "Other",
] as const;

export type DeliverySnapshot = {
  documentId: string;
  documentName: string;
  documentVersion: number;
  sourceRole: string;
  category: string;
  companyName: string;
  orderReference: string;
};

export type DocumentDelivery = {
  id: string;
  companyId: string;
  orderId: string;
  documentId: string;
  /** 1 for a first attempt; a retry after a failure increments it. */
  attempt: number;
  /** The failed record this retry follows, or "". */
  previousDeliveryId: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: string;
  method: string;
  reviewNote: string;
  preparedBy: string;
  preparedAt: string;
  snapshot: DeliverySnapshot;
  status: "Prepared" | "Recorded" | "Failed" | "Cancelled";
  deliveredOn: string;
  deliveryReference: string;
  deliveryNote: string;
  recordedBy: string;
  recordedAt: string;
  failureReason: string;
  failedOn: string;
  failedBy: string;
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
const dayNumber = (v: string) => Math.floor(Date.parse(`${v}T00:00:00Z`) / 86_400_000);
const today = (at: Date) => at.toISOString().slice(0, 10);

const actor = (s: Workspace) => {
  if (!s.user.trim()) throw new Error("Choose the operator recording this work.");
  return s.user;
};

export function deliveries(s: Workspace, filter: { companyId?: string; orderId?: string; documentId?: string } = {}) {
  return (s.deliveries || []).filter(
    (r) =>
      (filter.companyId === undefined || r.companyId === filter.companyId) &&
      (filter.orderId === undefined || r.orderId === filter.orderId) &&
      (filter.documentId === undefined || r.documentId === filter.documentId),
  );
}

function latestInFamily(s: Workspace, doc: VaultDoc) {
  return s.documents
    .filter((d) => sameDocumentFamily(d, doc))
    .sort((a, b) => b.version - a.version || b.id.localeCompare(a.id))[0];
}

/**
 * The document a new delivery for this family should be prepared from: the
 * current source on the order file. Null when the family has been superseded
 * or dropped by the dependency rules.
 */
function currentForFamily(s: Workspace, doc: VaultDoc) {
  const latest = latestInFamily(s, doc);
  return latest && currentOrderDocument(s, latest) ? latest : null;
}

/**
 * True while the delivered document is still the current version of its
 * family. A superseded document means the recipient holds an out-of-date
 * copy, so the record goes stale rather than silently staying valid.
 */
export function deliveryCurrent(s: Workspace, r: DocumentDelivery) {
  const doc = s.documents.find((d) => d.id === r.documentId);
  if (!doc) return false;
  if (doc.version !== r.snapshot.documentVersion || doc.name !== r.snapshot.documentName)
    return false;
  // Shares the production dependency rule: a child source whose parent has
  // been replaced is no longer current even though its own filename and
  // version have not moved.
  return currentOrderDocument(s, doc);
}

export function deliveryState(s: Workspace, r: DocumentDelivery) {
  if (r.status !== "Prepared") return r.status;
  return deliveryCurrent(s, r) ? "Prepared" : "Source changed";
}

function getDelivery(s: Workspace, id: string) {
  const r = (s.deliveries || []).find((x) => x.id === id);
  if (!r) throw new Error("That delivery record is no longer on file.");
  return r;
}

function snapshotOf(s: Workspace, doc: VaultDoc): DeliverySnapshot {
  const company = s.companies.find((c) => c.id === doc.companyId);
  const order = s.orders.find((o) => o.id === doc.orderId);
  return {
    documentId: doc.id,
    documentName: doc.name,
    documentVersion: doc.version,
    sourceRole: doc.sourceRole || doc.category || "Document",
    category: doc.category,
    companyName: company?.name || "",
    orderReference: order ? `${order.id} · ${order.address}` : "",
  };
}

export function prepareDelivery(
  s: Workspace,
  input: {
    documentId: string;
    recipientName: string;
    recipientEmail: string;
    recipientRole: string;
    method: string;
    reviewNote: string;
  },
) {
  return traceMutation(s, "prepareDelivery", [input], () => {
    const doc = s.documents.find((d) => d.id === input.documentId);
    if (!doc) throw new Error("That document is no longer on file.");
    if (!doc.orderId)
      throw new Error("Deliveries are recorded against a document on an order file.");
    if (!currentOrderDocument(s, doc)) {
      const latest = latestInFamily(s, doc);
      throw new Error(
        latest && latest.id !== doc.id
          ? "A newer version of this document exists. Prepare the delivery from the current version."
          : "This document is no longer a current source on the file. Review the evidence before delivering it.",
      );
    }
    const recipientName = input.recipientName.trim();
    const recipientEmail = input.recipientEmail.trim();
    const recipientRole = input.recipientRole.trim();
    const method = input.method.trim();
    if (!recipientName) throw new Error("Name the person receiving this document.");
    if (!emailValid(recipientEmail))
      throw new Error("Enter a valid email address for the recipient.");
    if (!recipientRoles.includes(recipientRole as (typeof recipientRoles)[number]))
      throw new Error("Choose how this recipient relates to the file.");
    if (!deliveryMethods.includes(method as (typeof deliveryMethods)[number]))
      throw new Error("Choose how this document is being delivered.");
    const open = deliveries(s, { documentId: doc.id }).find(
      (r) =>
        r.status === "Prepared" &&
        r.recipientEmail.toLowerCase() === recipientEmail.toLowerCase(),
    );
    if (open)
      throw new Error(
        "This document already has a delivery prepared for that recipient. Record or cancel it first.",
      );
    const preparedBy = actor(s);
    const record: DocumentDelivery = {
      id: `dlv-${commandUuid().slice(0, 8)}`,
      companyId: doc.companyId,
      orderId: doc.orderId,
      documentId: doc.id,
      attempt: 1,
      previousDeliveryId: "",
      recipientName,
      recipientEmail,
      recipientRole,
      method,
      reviewNote: input.reviewNote.trim(),
      preparedBy,
      preparedAt: now(),
      snapshot: snapshotOf(s, doc),
      status: "Prepared",
      deliveredOn: "",
      deliveryReference: "",
      deliveryNote: "",
      recordedBy: "",
      recordedAt: "",
      failureReason: "",
      failedOn: "",
      failedBy: "",
      cancelReason: "",
      cancelledBy: "",
      cancelledAt: "",
    };
    s.deliveries = [...(s.deliveries || []), record];
    return record;
  });
}

export function recordDelivery(
  s: Workspace,
  deliveryId: string,
  input: { deliveredOn: string; deliveryReference: string; deliveryNote: string },
  at = new Date(),
) {
  return traceMutation(s, "recordDelivery", [deliveryId, input], () => {
    const r = getDelivery(s, deliveryId);
    if (r.status !== "Prepared")
      throw new Error("Only a prepared delivery can be recorded as delivered.");
    if (!deliveryCurrent(s, r))
      throw new Error(
        "This document changed after the delivery was prepared. Prepare a new delivery from the current version.",
      );
    const deliveredOn = input.deliveredOn.trim();
    const reference = input.deliveryReference.trim();
    if (!dayValid(deliveredOn)) throw new Error("Enter the date this was delivered.");
    if (dayNumber(deliveredOn) < dayNumber(r.preparedAt.slice(0, 10)))
      throw new Error("A delivery cannot be dated before it was prepared.");
    if (dayNumber(deliveredOn) > dayNumber(today(at)))
      throw new Error("A delivery cannot be dated in the future.");
    if (!reference)
      throw new Error("Record the evidence reference for this delivery.");
    r.deliveredOn = deliveredOn;
    r.deliveryReference = reference;
    r.deliveryNote = input.deliveryNote.trim();
    r.recordedBy = actor(s);
    r.recordedAt = now();
    r.status = "Recorded";
    return r;
  });
}

export function recordDeliveryFailure(
  s: Workspace,
  deliveryId: string,
  input: { failedOn: string; failureReason: string },
  at = new Date(),
) {
  return traceMutation(s, "recordDeliveryFailure", [deliveryId, input], () => {
    const r = getDelivery(s, deliveryId);
    if (r.status !== "Prepared")
      throw new Error("Only a prepared delivery can be recorded as failed.");
    const failedOn = input.failedOn.trim();
    const reason = input.failureReason.trim();
    if (!dayValid(failedOn)) throw new Error("Enter the date this delivery failed.");
    if (dayNumber(failedOn) < dayNumber(r.preparedAt.slice(0, 10)))
      throw new Error("A failure cannot be dated before the delivery was prepared.");
    if (dayNumber(failedOn) > dayNumber(today(at)))
      throw new Error("A failure cannot be dated in the future.");
    if (!reason) throw new Error("Record why this delivery did not reach the recipient.");
    r.failedOn = failedOn;
    r.failureReason = reason;
    r.failedBy = actor(s);
    r.status = "Failed";
    return r;
  });
}

/**
 * A retry is a new attempt to the same recipient, linked to the failure it
 * follows, and bound to whatever version of the document is current now —
 * which may not be the version the failed attempt carried.
 */
export function retryDelivery(
  s: Workspace,
  deliveryId: string,
  input: { recipientEmail: string; method: string; reviewNote: string },
) {
  return traceMutation(s, "retryDelivery", [deliveryId, input], () => {
    const failed = getDelivery(s, deliveryId);
    if (failed.status !== "Failed")
      throw new Error("Only a failed delivery can be retried.");
    const doc = s.documents.find((d) => d.id === failed.documentId);
    if (!doc) throw new Error("That document is no longer on file.");
    const current = currentForFamily(s, doc);
    if (!current)
      throw new Error(
        "This document is no longer a current source on the file. Review the evidence before delivering it.",
      );
    // Only the newest unresolved failure in a chain may be retried. Retrying
    // an older one after a later attempt already succeeded, failed again or
    // was cancelled would misrepresent the attempt sequence.
    const successor = deliveries(s, { documentId: failed.documentId }).find(
      (r) => r.previousDeliveryId === failed.id,
    ) || (s.deliveries || []).find((r) => r.previousDeliveryId === failed.id);
    if (successor)
      throw new Error(
        "This attempt has already been retried. Continue from the latest attempt, or prepare a new delivery.",
      );
    const recipientEmail = input.recipientEmail.trim() || failed.recipientEmail;
    if (!emailValid(recipientEmail))
      throw new Error("Enter a valid email address for the recipient.");
    const method = input.method.trim() || failed.method;
    if (!deliveryMethods.includes(method as (typeof deliveryMethods)[number]))
      throw new Error("Choose how this document is being delivered.");
    if (
      deliveries(s, { documentId: current.id }).some(
        (r) =>
          r.status === "Prepared" &&
          r.recipientEmail.toLowerCase() === recipientEmail.toLowerCase(),
      )
    )
      throw new Error(
        "This document already has a delivery prepared for that recipient. Record or cancel it first.",
      );
    const preparedBy = actor(s);
    const record: DocumentDelivery = {
      ...failed,
      id: `dlv-${commandUuid().slice(0, 8)}`,
      documentId: current.id,
      attempt: failed.attempt + 1,
      previousDeliveryId: failed.id,
      recipientEmail,
      method,
      reviewNote: input.reviewNote.trim(),
      preparedBy,
      preparedAt: now(),
      snapshot: snapshotOf(s, current),
      status: "Prepared",
      deliveredOn: "",
      deliveryReference: "",
      deliveryNote: "",
      recordedBy: "",
      recordedAt: "",
      failureReason: "",
      failedOn: "",
      failedBy: "",
      cancelReason: "",
      cancelledBy: "",
      cancelledAt: "",
    };
    s.deliveries = [...(s.deliveries || []), record];
    return record;
  });
}

export function cancelDelivery(s: Workspace, deliveryId: string, reason: string) {
  return traceMutation(s, "cancelDelivery", [deliveryId, reason], () => {
    const r = getDelivery(s, deliveryId);
    if (r.status !== "Prepared")
      throw new Error("Only a prepared delivery can be cancelled.");
    const text = reason.trim();
    if (!text) throw new Error("Record why this delivery is being cancelled.");
    r.cancelReason = text;
    r.cancelledBy = actor(s);
    r.cancelledAt = now();
    r.status = "Cancelled";
    return r;
  });
}

/**
 * Has this failed attempt already been followed by another? Only the newest
 * unresolved failure in a chain offers a retry; earlier ones are history.
 */
export function deliveryRetried(s: Workspace, r: DocumentDelivery) {
  return (s.deliveries || []).some((x) => x.previousDeliveryId === r.id);
}

/** May this record be retried right now? */
export function canRetryDelivery(s: Workspace, r: DocumentDelivery) {
  return r.status === "Failed" && !deliveryRetried(s, r);
}

/** Who holds a current copy of this document, and who is still outstanding. */
export function deliveryCoverage(s: Workspace, documentId: string) {
  const rows = deliveries(s, { documentId });
  const recorded = rows.filter((r) => r.status === "Recorded");
  return {
    prepared: rows.filter((r) => deliveryState(s, r) === "Prepared").length,
    stale: rows.filter((r) => deliveryState(s, r) === "Source changed").length,
    recorded: recorded.length,
    failed: rows.filter((r) => r.status === "Failed").length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    recipients: [...new Set(recorded.map((r) => r.recipientEmail.toLowerCase()))].length,
  };
}

const snapshotShape = (v: unknown): v is DeliverySnapshot => {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.documentId === "string" &&
    typeof p.documentName === "string" &&
    typeof p.documentVersion === "number" &&
    typeof p.sourceRole === "string" &&
    typeof p.category === "string" &&
    typeof p.companyName === "string" &&
    typeof p.orderReference === "string"
  );
};

const deliveryShape = (v: unknown): v is DocumentDelivery => {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const strings = [
    "id",
    "companyId",
    "orderId",
    "documentId",
    "previousDeliveryId",
    "recipientName",
    "recipientEmail",
    "recipientRole",
    "method",
    "reviewNote",
    "preparedBy",
    "preparedAt",
    "deliveredOn",
    "deliveryReference",
    "deliveryNote",
    "recordedBy",
    "recordedAt",
    "failureReason",
    "failedOn",
    "failedBy",
    "cancelReason",
    "cancelledBy",
    "cancelledAt",
  ];
  return (
    strings.every((k) => typeof p[k] === "string") &&
    typeof p.attempt === "number" &&
    ["Prepared", "Recorded", "Failed", "Cancelled"].includes(p.status as string) &&
    snapshotShape(p.snapshot)
  );
};

const deliveryUsable = (r: DocumentDelivery) =>
  Number.isInteger(r.attempt) &&
  r.attempt >= 1 &&
  (r.status !== "Recorded" || (!!r.deliveredOn && !!r.deliveryReference.trim())) &&
  (r.status !== "Failed" || (!!r.failedOn && !!r.failureReason.trim())) &&
  (r.status !== "Cancelled" || !!r.cancelReason.trim());

/**
 * What hydration and backup restore must agree is usable. Shape alone was not
 * enough: a backup carrying attempt 0 was accepted, and then an unrelated edit
 * elsewhere in the workspace failed the global mutation validator, leaving the
 * operator stuck with no way to see why.
 */
export function isValidDeliveries(v: unknown) {
  return (
    v === undefined ||
    (Array.isArray(v) && v.every(deliveryShape) && v.every(deliveryUsable))
  );
}

/**
 * Shape only. The mutation validator uses this so its own rules can report
 * precisely which one a record breaks, rather than collapsing every problem
 * into one unhelpful message.
 */
export function isValidDeliveryShapes(v: unknown) {
  return v === undefined || (Array.isArray(v) && v.every(deliveryShape));
}

/**
 * Cross-cutting invariants. A delivery is evidence that something left the
 * office: once recorded, failed or cancelled it is history, and the document
 * identity it names is frozen at preparation.
 */
export function validateDeliveryMutation(before: Workspace, after: Workspace) {
  if (!isValidDeliveryShapes(after.deliveries))
    throw new Error("That delivery record is not in a shape this workspace can store.");
  const rows = after.deliveries || [];
  for (const r of rows) {
    if (r.attempt < 1 || !Number.isInteger(r.attempt))
      throw new Error("A delivery attempt must be a whole number from one.");
    if (r.status === "Recorded" && (!r.deliveredOn || !r.deliveryReference.trim()))
      throw new Error("A recorded delivery must carry its date and evidence reference.");
    if (r.status === "Failed" && (!r.failedOn || !r.failureReason.trim()))
      throw new Error("A failed delivery must record why it did not arrive.");
    if (r.status === "Cancelled" && !r.cancelReason.trim())
      throw new Error("A cancelled delivery must record why.");
    if (r.previousDeliveryId) {
      const prior = rows.find((x) => x.id === r.previousDeliveryId);
      if (!prior)
        throw new Error("A retry must stay linked to the delivery it follows.");
      if (prior.attempt >= r.attempt)
        throw new Error("A retry must follow its earlier attempt.");
    }
  }
  const open = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "Prepared") continue;
    const key = `${r.documentId}::${r.recipientEmail.toLowerCase()}`;
    open.set(key, (open.get(key) || 0) + 1);
  }
  for (const count of open.values())
    if (count > 1)
      throw new Error(
        "A document can only have one delivery prepared for a recipient at a time.",
      );
  for (const prior of before.deliveries || []) {
    const current = rows.find((x) => x.id === prior.id);
    if (!current)
      throw new Error("Delivery history is kept; cancel a delivery instead of removing it.");
    if (
      current.documentId !== prior.documentId ||
      JSON.stringify(current.snapshot) !== JSON.stringify(prior.snapshot) ||
      current.attempt !== prior.attempt ||
      current.previousDeliveryId !== prior.previousDeliveryId ||
      current.preparedBy !== prior.preparedBy ||
      current.preparedAt !== prior.preparedAt
    )
      throw new Error("A prepared delivery keeps the document version it was prepared for.");
    if (prior.status !== "Prepared" && current.status !== prior.status)
      throw new Error("A recorded, failed or cancelled delivery stays as it is.");
    if (
      current.recipientName !== prior.recipientName ||
      current.recipientEmail !== prior.recipientEmail ||
      current.recipientRole !== prior.recipientRole ||
      current.method !== prior.method ||
      current.reviewNote !== prior.reviewNote
    )
      throw new Error("A prepared delivery keeps the recipient it was prepared for.");
    if (
      prior.status !== "Prepared" &&
      (current.deliveredOn !== prior.deliveredOn ||
        current.deliveryReference !== prior.deliveryReference ||
        current.deliveryNote !== prior.deliveryNote ||
        current.recordedBy !== prior.recordedBy ||
        current.recordedAt !== prior.recordedAt ||
        current.failureReason !== prior.failureReason ||
        current.failedOn !== prior.failedOn ||
        current.failedBy !== prior.failedBy ||
        current.cancelReason !== prior.cancelReason ||
        current.cancelledBy !== prior.cancelledBy ||
        current.cancelledAt !== prior.cancelledAt)
    )
      throw new Error("Recorded delivery evidence cannot be rewritten.");
  }
}
