import type { Field, Workspace } from "./model";
import { commandUuid } from "./command-log";

export type FieldReviewEvent = {
  id: string; kind: "Capture" | "Correction" | "Review";
  fieldId: string; label: string; before: string; value: string;
  documentId: string; documentVersion: number; sourcePage: string;
  suggestedValue: string; quote: string; method: "manual" | "pdf-text" | "ocr" | "source-text";
  by: string; at: string;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
export function fieldReviewHistoryShapeValid(value: unknown): value is FieldReviewEvent[] | undefined {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length <= 10000 && new Set(value.map(row => row?.id)).size === value.length && value.every(row =>
    row && typeof row === "object" && !Array.isArray(row) &&
    Object.keys(row).every(key => ["id", "kind", "fieldId", "label", "before", "value", "documentId", "documentVersion", "sourcePage", "suggestedValue", "quote", "method", "by", "at"].includes(key)) &&
    typeof row.id === "string" && /^[a-f\d-]{36}$/i.test(row.id) && ["Capture", "Correction", "Review"].includes(row.kind) &&
    text(row.fieldId, 100) && !!row.fieldId && text(row.label, 1000) && text(row.before, 20000) && text(row.value, 20000) &&
    text(row.documentId, 180) && !!row.documentId && Number.isSafeInteger(row.documentVersion) && row.documentVersion > 0 &&
    text(row.sourcePage, 1000) && text(row.suggestedValue, 500) && text(row.quote, 2000) && ["manual", "pdf-text", "ocr", "source-text"].includes(row.method) &&
    text(row.by, 320) && !!row.by.trim() && text(row.at, 50) && Number.isFinite(Date.parse(row.at)));
}

function captureIdentity(field?: Field) {
  return field && [field.documentId, field.sourcePage, field.sourceValue, field.captureEvidence];
}

/** Called by the trusted mutation boundary, never populated from submitted audit fields.
 * A recorded review is a human action, not a verified training label or accuracy claim.
 */
export function recordFieldReviewChanges(before: Workspace, after: Workspace, actor: string, at = new Date().toISOString()) {
  for (const order of after.orders) {
    const previous = before.orders.find(row => row.id === order.id);
    if (!same(previous?.fieldReviewHistory, order.fieldReviewHistory)) throw new Error("Source review history is recorded by the system and cannot be edited.");
    if (!previous) continue;
    const events: FieldReviewEvent[] = [];
    for (const field of order.fields) {
      const original = after.documents.find(doc => doc.id === field.documentId && doc.companyId === order.companyId && doc.orderId === order.id);
      if (!original) continue;
      const old = previous.fields.find(row => row.id === field.id);
      let kind: FieldReviewEvent["kind"] | undefined;
      if (!same(captureIdentity(old), captureIdentity(field))) kind = "Capture";
      else if (old?.proposed !== field.proposed) kind = "Correction";
      const reviewed = !old?.reviewed && field.reviewed;
      if (!kind && !reviewed) continue;
      const kinds: FieldReviewEvent["kind"][] = [...(kind ? [kind] : []), ...(reviewed ? ["Review" as const] : [])];
      for (const eventKind of kinds) events.push({ id: commandUuid(), kind: eventKind, fieldId: field.id, label: field.label, before: old?.proposed || "", value: field.proposed,
        documentId: original.id, documentVersion: original.version, sourcePage: field.sourcePage || "",
        suggestedValue: field.captureEvidence?.suggestedValue || "", quote: field.captureEvidence?.quote || "",
        method: field.captureEvidence?.method || "manual", by: actor, at });
    }
    if (events.length) {
      const history = [...(previous.fieldReviewHistory || []), ...events];
      if (!fieldReviewHistoryShapeValid(history)) throw new Error("Source review history exceeds its limits or contains invalid evidence. Preserve the file and ask an administrator for review.");
      order.fieldReviewHistory = history;
    }
  }
}
