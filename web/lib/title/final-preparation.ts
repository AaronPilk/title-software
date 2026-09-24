import type { Order, Workspace } from "./model";
import { productionDocument, productionMessage } from "./production-access";
import { traceMutation } from "./command-log";
import { products, policyProblems } from "./business";
import { finalReadiness, neededFields, orderSources, outputRoles, productionLocked, titleFile } from "./production";

/** A human-reviewed worksheet, never an underwriter decision, rate engine or policy. */
export type FinalEndorsement = {
  id: string; code: string; decision: "Needs review" | "Include" | "Exclude";
  rationale: string; fee: number | null;
};
export type FinalProductPreparation = {
  policyId: string; variant: "Needs review" | "Standard" | "Enhanced";
  form: string; endorsements: FinalEndorsement[]; endorsementReviewNote: string; reviewNote: string;
};
export type FinalFeeReview = {
  id: string; kind: "Binder" | "Other"; label: string;
  decision: "Needs review" | "Applies" | "Not applicable";
  amount: number | null; reference: string; rationale: string;
};
export type FinalPreparationInput = {
  issuingCompanyId: string; referringCompanyId: string;
  eligibility: { companyEvidence: string; attorneyEvidence: string; note: string };
  products: FinalProductPreparation[]; fees: FinalFeeReview[]; feeReviewNote: string;
  note: string; reply: { to: string; subject: string; body: string };
};
export type FinalPreparationEvent = { version: number; action: "Saved" | "Reviewed" | "Prepared"; by: string; at: string; note: string };
export type FinalPreparationWorksheet = {
  version: number; status: "Draft" | "Reviewed" | "Prepared"; input: FinalPreparationInput;
  review?: { snapshot: string; by: string; at: string; note: string };
  prepared?: { snapshot: string; by: string; at: string };
  history: FinalPreparationEvent[];
};
export type FinalHandoff = {
  notAPolicy: true; notSent: true; softProUpdated: false;
  orderId: string; companyId: string; companyName: string; underwriter: string;
  sourceSnapshot: string; worksheetVersion: number; preparedAt: string; preparedBy: string;
  worksheet: FinalPreparationInput;
  policyProducts: { id: string; kind: "Owner" | "Loan"; insured: string; coverageAmount: number; loanReference: string; loanAmount: number; premium: number; underwriterShare: number; form: string; exceptionDispositions: { itemId: string; disposition: "Retain" | "Revise" | "Omit"; wording: string; reason: string }[] }[];
  sources: { id: string; name: string; version: number; assetId: string; role: string }[];
  capturedFields: { label: string; value: string; sourceValue: string; documentId: string; page: string }[];
};

const clone = <T,>(value: T): T => structuredClone(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every(key => names.includes(key));
const text = (value: unknown, max = 4_000): value is string => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const id = (value: unknown): value is string => text(value, 300);
const money = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const oneOf = (value: unknown, values: string[]) => typeof value === "string" && values.includes(value);
const unique = (rows: { id: string }[]) => rows.every(row => row.id.trim()) && new Set(rows.map(row => row.id)).size === rows.length;
const stamp = (value: unknown, note: boolean) => record(value) && exact(value, ["snapshot", "by", "at", ...(note ? ["note"] : [])]) && text(value.snapshot, 2_000_000) && !!value.snapshot && text(value.by, 300) && !!value.by.trim() && text(value.at, 50) && Number.isFinite(Date.parse(value.at)) && (!note || text(value.note) && !!value.note.trim());

export function finalPreparationInputShapeValid(value: unknown): value is FinalPreparationInput {
  if (!record(value) || !exact(value, ["issuingCompanyId", "referringCompanyId", "eligibility", "products", "fees", "feeReviewNote", "note", "reply"]) || !id(value.issuingCompanyId) || !id(value.referringCompanyId) || !text(value.feeReviewNote) || !text(value.note)) return false;
  const eligibility = value.eligibility, reply = value.reply;
  if (!record(eligibility) || !exact(eligibility, ["companyEvidence", "attorneyEvidence", "note"]) || ![eligibility.companyEvidence, eligibility.attorneyEvidence, eligibility.note].every(v => text(v))) return false;
  if (!record(reply) || !exact(reply, ["to", "subject", "body"]) || !text(reply.to, 254) || !text(reply.subject, 500) || !text(reply.body, 20_000)) return false;
  if (!Array.isArray(value.products) || value.products.length > 20 || !value.products.every(p => record(p) && exact(p, ["policyId", "variant", "form", "endorsements", "endorsementReviewNote", "reviewNote"]) && id(p.policyId) && !!p.policyId.trim() && oneOf(p.variant, ["Needs review", "Standard", "Enhanced"]) && text(p.form, 1000) && text(p.endorsementReviewNote) && text(p.reviewNote) && Array.isArray(p.endorsements) && p.endorsements.length <= 30 && p.endorsements.every(e => record(e) && exact(e, ["id", "code", "decision", "rationale", "fee"]) && id(e.id) && text(e.code, 500) && oneOf(e.decision, ["Needs review", "Include", "Exclude"]) && text(e.rationale) && money(e.fee)) && unique(p.endorsements as FinalEndorsement[]))) return false;
  if (new Set(value.products.map(p => p.policyId)).size !== value.products.length) return false;
  return Array.isArray(value.fees) && value.fees.length <= 30 && value.fees.every(f => record(f) && exact(f, ["id", "kind", "label", "decision", "amount", "reference", "rationale"]) && id(f.id) && oneOf(f.kind, ["Binder", "Other"]) && text(f.label, 500) && oneOf(f.decision, ["Needs review", "Applies", "Not applicable"]) && money(f.amount) && text(f.reference) && text(f.rationale)) && unique(value.fees as FinalFeeReview[]);
}

export function finalPreparationShapeValid(value: unknown): value is FinalPreparationWorksheet {
  if (!record(value) || !exact(value, ["version", "status", "input", "review", "prepared", "history"]) || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || !oneOf(value.status, ["Draft", "Reviewed", "Prepared"]) || !finalPreparationInputShapeValid(value.input)) return false;
  if (value.status === "Draft" ? value.review !== undefined || value.prepared !== undefined : !stamp(value.review, true) || (value.status === "Prepared" ? !stamp(value.prepared, false) : value.prepared !== undefined)) return false;
  if (!Array.isArray(value.history) || value.history.length < 1 || value.history.length > 500 || !value.history.every(e => record(e) && exact(e, ["version", "action", "by", "at", "note"]) && Number.isSafeInteger(e.version) && (e.version as number) > 0 && (e.version as number) <= (value.version as number) && oneOf(e.action, ["Saved", "Reviewed", "Prepared"]) && text(e.by, 300) && !!e.by.trim() && text(e.at, 50) && Number.isFinite(Date.parse(e.at)) && text(e.note))) return false;
  const history = value.history as FinalPreparationEvent[];
  let version = 0, reviewed = false;
  for (const event of history) {
    if (event.action === "Saved") { if (event.version !== version + 1) return false; version++; reviewed = false; }
    else { if (!version || event.version !== version || !event.note.trim()) return false; if (event.action === "Reviewed") reviewed = true; else if (!reviewed) return false; }
  }
  const last = history.at(-1)!;
  if (version !== value.version || last.action !== ({ Draft: "Saved", Reviewed: "Reviewed", Prepared: "Prepared" }[value.status as string])) return false;
  if (value.status !== "Draft") {
    const review = value.review as FinalPreparationWorksheet["review"], event = history.slice().reverse().find(e => e.action === "Reviewed" && e.version === version);
    if (!event || event.by !== review!.by || event.at !== review!.at || event.note !== review!.note) return false;
    if (value.status === "Prepared") { const prepared = value.prepared as FinalPreparationWorksheet["prepared"]; if (last.by !== prepared!.by || last.at !== prepared!.at || prepared!.snapshot !== review!.snapshot) return false; }
  }
  return true;
}

export function emptyFinalPreparation(s: Workspace, order: Order): FinalPreparationInput {
  return {
    issuingCompanyId: order.companyId, referringCompanyId: order.companyId,
    eligibility: { companyEvidence: "", attorneyEvidence: "", note: "" },
    products: products(s, order.id).map(p => ({ policyId: p.id, variant: "Needs review", form: p.form, endorsements: [], endorsementReviewNote: "", reviewNote: "" })),
    fees: [{ id: "binder", kind: "Binder", label: "Binder fee", decision: "Needs review", amount: null, reference: "", rationale: "" }],
    feeReviewNote: "", note: "", reply: { to: titleFile(order).attorneyEmail, subject: `${order.id} — final policy preparation`, body: "" },
  };
}

// JSONB reorders object keys on persistence. Compare the content, while preserving
// array order and JSON's existing omission rules for optional properties.
const stableJson = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

/** Public title-file facts only: identical for owner and scoped Production projections. */
export function finalPreparationSourceSnapshot(s: Workspace, order: Order): string {
  const commitment = s.business?.commitments.find(c => c.orderId === order.id);
  return stableJson({
    order: [order.id, order.companyId, order.address, order.client, order.type, order.jurisdiction, order.underwriter, order.status === "Rejected", order.exception],
    company: s.companies.filter(c => c.id === order.companyId).map(c => [c.id, c.name, c.jurisdiction, c.operatingStates || []]),
    titleFile: titleFile(order), fields: order.fields,
    sources: orderSources(s, order.id).filter(d => !outputRoles.includes(d.sourceRole!)).map(d => [d.id, d.version, d.assetId || "", d.name, d.visibility, d.sourceRole, d.parentDocumentId || "", d.providerSource?.sha256 || ""]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    // A newly assigned original or received correction needs a fresh review even
    // before it has been classified as evidence. Bind only compact identities;
    // retain provider bodies in their immutable source documents, never here.
    unclassifiedOriginals: s.documents.filter(d => d.orderId === order.id && d.companyId === order.companyId && productionDocument(s, d) && !d.sourceRole && !d.policyId && !d.cplId && !d.correctionId && d.commitmentVersion === undefined)
      .map(d => [d.id, d.version, d.assetId || "", d.name, d.visibility, d.parentDocumentId || "", d.providerSource?.sha256 || ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    incomingMissive: s.inbox.filter(m => m.orderId === order.id && m.companyId === order.companyId && productionMessage(s, m) && m.missive)
      .map(m => [m.id, m.missive!.organizationId, m.missive!.messageId, m.missive!.fingerprint, m.missive!.sourceDocumentId])
      .sort((a, b) => a[0].localeCompare(b[0])),
    products: products(s, order.id).map(p => ({ id: p.id, version: p.version, kind: p.kind, insured: p.insured, amount: p.amount, premium: p.premium, rate: p.rate, form: p.form, endorsements: p.endorsements, loanReference: p.loanReference, loanAmount: p.loanAmount, securityDocumentId: p.securityDocumentId, securityPage: p.securityPage, loanReviewNote: p.loanReviewNote, exceptions: p.exceptions })).sort((a, b) => a.id.localeCompare(b.id)),
    commitment: commitment ? [commitment.version, commitment.ptoDocumentId, commitment.attorneyReference, commitment.priorReview, commitment.searchReview, commitment.premiumBasis, commitment.reviewNote] : null,
    readiness: finalReadiness(s, order),
  });
}

export function finalPreparationFingerprint(s: Workspace, order: Order): string {
  return stableJson([finalPreparationSourceSnapshot(s, order), order.finalPreparation?.version || 0, order.finalPreparation?.input || null]);
}

export function finalPreparationProblems(s: Workspace, order: Order, input = order.finalPreparation?.input): string[] {
  if (!input || !finalPreparationInputShapeValid(input)) return ["Save a valid final preparation worksheet."];
  const errors: string[] = [];
  if (!["wfg", "wfg national", "wfg national title insurance company"].includes(order.underwriter.trim().toLowerCase())) errors.push("This preparation workflow supports WFG only. Other underwriters need their own reviewed workflow.");
  if (order.status === "Rejected") errors.push("This file was rejected and is not available for preparation.");
  if (input.issuingCompanyId !== order.companyId || input.referringCompanyId !== order.companyId) errors.push("Cross-agency work needs an administrator's separate company, appointment and access review. This worksheet cannot reroute the title file.");
  if (!s.companies.some(c => c.id === order.companyId)) errors.push("The issuing company is not available.");
  if (!input.eligibility.companyEvidence.trim()) errors.push("Record the company's WFG authority evidence for this state and file.");
  if (!input.eligibility.attorneyEvidence.trim()) errors.push("Record the attorney's WFG eligibility evidence for this file.");
  if (!input.eligibility.note.trim()) errors.push("Record the compatibility review outcome. An evidence reference alone is not approval.");
  const current = products(s, order.id);
  if (!current.length) errors.push("Create the Owner and/or Loan policy products required for this file.");
  if (current.length !== input.products.length || current.some(p => !input.products.some(row => row.policyId === p.id))) errors.push("Review the exact current policy products; products were added, removed or replaced.");
  for (const row of input.products) {
    const p = current.find(p => p.id === row.policyId), prefix = p ? `${p.kind} policy ${p.id}` : `Policy ${row.policyId}`;
    if (!p) continue;
    if (row.variant === "Needs review") errors.push(`${prefix}: confirm Standard or Enhanced from the approved transaction instructions.`);
    if (!row.form.trim() || row.form.trim() !== p.form.trim()) errors.push(`${prefix}: the exact approved form/version must match the policy product.`);
    if (!row.reviewNote.trim()) errors.push(`${prefix}: record how the variant and form match the reviewed commitment and jacket instructions.`);
    if (!row.endorsementReviewNote.trim()) errors.push(`${prefix}: review all endorsement instructions, including when no endorsements apply.`);
    for (const e of row.endorsements) {
      if (!e.code.trim() || e.decision === "Needs review" || !e.rationale.trim()) errors.push(`${prefix}: each endorsement needs an exact code, include/exclude decision and reason.`);
      if (e.decision === "Include" && e.fee === null) errors.push(`${prefix}: confirm the included endorsement fee; enter zero only when verified.`);
      if (e.decision === "Exclude" && e.fee !== null && e.fee !== 0) errors.push(`${prefix}: an excluded endorsement cannot carry a charge.`);
    }
    if (new Set(row.endorsements.map(e => e.code.trim().toLowerCase())).size !== row.endorsements.length) errors.push(`${prefix}: duplicate endorsement codes need review.`);
    for (const problem of policyProblems(s, order, p)) errors.push(`${prefix}: ${problem}.`);
    if (p.kind === "Loan" && (!p.securityPage.trim() || !p.loanReviewNote.trim() || !orderSources(s, order.id).some(d => d.id === p.securityDocumentId && ["Mortgage", "Deed of trust"].includes(d.sourceRole!)))) errors.push(`${prefix}: review this loan principal against its current security instrument and source page.`);
    if (titleFile(order).requirements.filter(r => r.kind === "Exception").some(r => !p.exceptions.some(e => e.itemId === r.id && e.reason.trim() && (e.disposition === "Omit" || e.wording.trim())))) errors.push(`${prefix}: map every commitment exception with a reviewed disposition, reason and final wording.`);
  }
  if (input.fees.filter(f => f.kind === "Binder").length !== 1) errors.push("Record exactly one binder-fee applicability decision.");
  for (const fee of input.fees) {
    if (!fee.label.trim() || fee.decision === "Needs review" || !fee.reference.trim() || !fee.rationale.trim()) errors.push("Each fee needs a label, applicability decision, approved source and reason.");
    if (fee.decision === "Applies" && fee.amount === null) errors.push(`${fee.label || "Fee"}: confirm the amount; zero is not a default.`);
    if (fee.decision === "Not applicable" && fee.amount !== null && fee.amount !== 0) errors.push(`${fee.label || "Fee"}: a fee marked not applicable cannot carry a charge.`);
  }
  if (!input.feeReviewNote.trim()) errors.push("Record the fee review; this worksheet does not calculate an approved rate.");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.reply.to) || /[\r\n]/.test(input.reply.to) || !input.reply.subject.trim() || /[\r\n]/.test(input.reply.subject) || !input.reply.body.trim()) errors.push("Complete the local reply recipient, subject and body for review.");
  const ready = finalReadiness(s, order);
  errors.push(...ready.missingSources.map(role => `Missing ${role}.`), ...ready.pendingFields.map(field => `Review ${field.label} against the original.`), ...ready.missingContext.map(value => `Complete ${value}.`));
  if (ready.unresolved.length) errors.push("Resolve all commitment requirements and exceptions.");
  if (ready.loanMismatch) errors.push("The reviewed source principal must match the title file loan amount.");
  if (order.exception) errors.push("Resolve the title-file exception before preparing a handoff.");
  return [...new Set(errors)];
}

export function finalPreparationStatus(s: Workspace, order: Order): "Not started" | "Draft" | "Source changed" | "Reviewed" | "Prepared" {
  const worksheet = order.finalPreparation;
  if (!worksheet) return "Not started";
  if (worksheet.status === "Draft") return "Draft";
  return worksheet.review?.snapshot !== finalPreparationFingerprint(s, order) || (worksheet.prepared && worksheet.prepared.snapshot !== finalPreparationFingerprint(s, order)) || finalPreparationProblems(s, order).length ? "Source changed" : worksheet.status;
}

function mutableOrder(s: Workspace, orderId: string, expectedVersion: number, sourceSnapshot: string) {
  const order = s.orders.find(o => o.id === orderId);
  if (!order || productionLocked(s, order) || order.status === "Rejected") throw new Error("Choose an active, unissued title file.");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || (order.finalPreparation?.version || 0) !== expectedVersion || sourceSnapshot !== finalPreparationSourceSnapshot(s, order)) throw new Error("The file, sources or worksheet changed. Reload and review the current facts before saving.");
  if (!s.user.trim()) throw new Error("A current reviewer identity is required.");
  if ((order.finalPreparation?.history.length || 0) >= 500) throw new Error("Worksheet history is full. Preserve this record and ask an administrator for review.");
  return order;
}

export function saveFinalPreparation(s: Workspace, orderId: string, input: FinalPreparationInput, expectedVersion: number, sourceSnapshot: string) {
  return traceMutation(s, "saveFinalPreparation", [orderId, input, expectedVersion, sourceSnapshot], () => {
    const order = mutableOrder(s, orderId, expectedVersion, sourceSnapshot);
    if (!finalPreparationInputShapeValid(input)) throw new Error("The final preparation worksheet is invalid or exceeds its limits.");
    // Identifiers may reference only visible companies; choosing another never moves data.
    for (const companyId of [input.issuingCompanyId, input.referringCompanyId]) if (companyId && !s.companies.some(c => c.id === companyId)) throw new Error("Choose an available company for this worksheet.");
    const previous = order.finalPreparation, version = (previous?.version || 0) + 1;
    order.finalPreparation = { version, status: "Draft", input: clone(input), history: [...clone(previous?.history || []), { version, action: "Saved", by: s.user, at: new Date().toISOString(), note: input.note.trim() }] };
    return order.finalPreparation;
  });
}

export function reviewFinalPreparation(s: Workspace, orderId: string, expectedVersion: number, sourceSnapshot: string, reviewNote: string) {
  return traceMutation(s, "reviewFinalPreparation", [orderId, expectedVersion, sourceSnapshot, reviewNote], () => {
    const order = mutableOrder(s, orderId, expectedVersion, sourceSnapshot), worksheet = order.finalPreparation;
    if (!worksheet || !text(reviewNote) || !reviewNote.trim()) throw new Error("Save the worksheet and record a deliberate review note.");
    const errors = finalPreparationProblems(s, order);
    if (errors.length) throw new Error(errors.join(" "));
    const at = new Date().toISOString(), snapshot = finalPreparationFingerprint(s, order);
    worksheet.review = { snapshot, by: s.user, at, note: reviewNote.trim() }; delete worksheet.prepared; worksheet.status = "Reviewed";
    worksheet.history.push({ version: worksheet.version, action: "Reviewed", by: s.user, at, note: reviewNote.trim() });
    return worksheet;
  });
}

export function prepareFinalHandoff(s: Workspace, orderId: string, expectedVersion: number, sourceSnapshot: string): FinalHandoff {
  return traceMutation(s, "prepareFinalHandoff", [orderId, expectedVersion, sourceSnapshot], () => {
    const order = mutableOrder(s, orderId, expectedVersion, sourceSnapshot), worksheet = order.finalPreparation;
    if (!worksheet || !["Reviewed", "Prepared"].includes(finalPreparationStatus(s, order)) || finalPreparationProblems(s, order).length) throw new Error("Confirm the current worksheet and source evidence before preparing the handoff.");
    const at = new Date().toISOString();
    worksheet.status = "Prepared"; worksheet.prepared = { snapshot: finalPreparationFingerprint(s, order), by: s.user, at };
    worksheet.history.push({ version: worksheet.version, action: "Prepared", by: s.user, at, note: "Internal preparation only; no policy issued, provider changed or message sent." });
    return finalHandoffData(s, order);
  });
}

export function finalHandoffData(s: Workspace, order: Order): FinalHandoff {
  if (finalPreparationStatus(s, order) !== "Prepared" || !order.finalPreparation?.prepared) throw new Error("Prepare a current reviewed handoff before exporting it.");
  const worksheet = order.finalPreparation;
  return { notAPolicy: true, notSent: true, softProUpdated: false, orderId: order.id, companyId: order.companyId, companyName: s.companies.find(c => c.id === order.companyId)?.name || "", underwriter: order.underwriter,
    sourceSnapshot: finalPreparationSourceSnapshot(s, order), worksheetVersion: worksheet.version, preparedAt: worksheet.prepared!.at, preparedBy: worksheet.prepared!.by,
    worksheet: clone(worksheet.input),
    policyProducts: products(s, order.id).map(p => ({ id: p.id, kind: p.kind, insured: p.insured, coverageAmount: p.amount, loanReference: p.loanReference, loanAmount: p.loanAmount, premium: p.premium, underwriterShare: p.rate, form: p.form, exceptionDispositions: clone(p.exceptions) })),
    sources: orderSources(s, order.id).filter(d => !outputRoles.includes(d.sourceRole!)).map(d => ({ id: d.id, name: d.name, version: d.version, assetId: d.assetId || "", role: d.sourceRole || "Other" })),
    capturedFields: order.fields.filter(f => neededFields(order).some(def => def.id === f.id)).map(f => ({ label: f.label, value: f.proposed, sourceValue: f.sourceValue || "", documentId: f.documentId || "", page: f.sourcePage || "" })),
  };
}

export function finalHandoffText(s: Workspace, order: Order): string {
  const data = finalHandoffData(s, order), rows = data.worksheet;
  return ["WFG FINAL PREPARATION — INTERNAL REVIEWED HANDOFF", "NOT AN OFFICIAL POLICY OR JACKET. NO EMAIL SENT. SOFTPRO HAS NOT BEEN UPDATED.", "Complete issuance through the approved underwriter workflow and verify its returned documents.", "",
    `File: ${order.id}`, `Company: ${data.companyName}`, `Property: ${order.address}`, `Underwriter: ${order.underwriter}`, `Prepared: ${data.preparedAt} by ${data.preparedBy}`, `Worksheet version: ${data.worksheetVersion}`, "",
    "COMPATIBILITY REVIEW", `Company authority: ${rows.eligibility.companyEvidence}`, `Attorney eligibility: ${rows.eligibility.attorneyEvidence}`, rows.eligibility.note, "",
    "REVIEWED SOURCE FACTS", ...data.capturedFields.map(f => `${f.label}: ${f.value}\n  Source: ${f.documentId}, ${f.page}; captured value: ${f.sourceValue}`), "",
    "POLICY AND JACKET INSTRUCTIONS", ...rows.products.flatMap(p => { const product = data.policyProducts.find(row => row.id === p.policyId)!; return [`${product.kind} ${p.policyId}: ${p.variant}`, `Insured: ${product.insured}`, `Coverage: ${product.coverageAmount.toFixed(2)}; reviewed premium: ${product.premium.toFixed(2)}; underwriter share: ${(product.underwriterShare * 100).toFixed(2)}%`, ...(product.kind === "Loan" ? [`Loan: ${product.loanReference}; principal: ${product.loanAmount.toFixed(2)}`] : []), `Exact form/version: ${p.form}`, `Variant/form review: ${p.reviewNote}`, ...product.exceptionDispositions.map(e => `Exception ${e.itemId}: ${e.disposition}; wording: ${e.wording}; reason: ${e.reason}`), `Endorsement review: ${p.endorsementReviewNote}`, ...p.endorsements.map(e => `${e.decision}: ${e.code}; fee ${e.fee === null ? "not applicable" : e.fee.toFixed(2)}; reason: ${e.rationale}`), ""]; }),
    "FEE REVIEW — NOT AN AUTOMATIC RATE CALCULATION", ...rows.fees.map(f => `${f.label}: ${f.decision}; amount ${f.amount === null ? "not applicable" : f.amount.toFixed(2)}; source: ${f.reference}; reason: ${f.rationale}`), rows.feeReviewNote, "",
    "SOURCE ORIGINALS", ...data.sources.map(d => `${d.name} · ${d.role} · version ${d.version} · ${d.id}`), "",
    "LOCAL REPLY DRAFT — NOT SENT", `To: ${rows.reply.to}`, `Subject: ${rows.reply.subject}`, rows.reply.body, "", rows.note,
  ].join("\n");
}

/** Integrity guard; backend command allowlists must additionally prevent direct worksheet patches. */
export function validateFinalPreparationMutation(before: Workspace, after: Workspace) {
  for (const order of after.orders) {
    const oldOrder = before.orders.find(o => o.id === order.id), old = oldOrder?.finalPreparation, next = order.finalPreparation;
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    if (oldOrder && (productionLocked(before, oldOrder) || oldOrder.status === "Rejected")) throw new Error("A locked title file cannot change its final preparation history.");
    if (!next || !finalPreparationShapeValid(next)) throw new Error("Preserve the valid final preparation worksheet and its history.");
    if (old && (next.version < old.version || next.version > old.version + 1 || next.history.length !== old.history.length + 1 || JSON.stringify(next.history.slice(0, -1)) !== JSON.stringify(old.history))) throw new Error("Preserve final preparation review history and use the supported actions.");
    if (!old && (next.version !== 1 || next.status !== "Draft" || next.history.length !== 1 || next.history[0].action !== "Saved")) throw new Error("A new final preparation worksheet must begin as a draft.");
    if (next.status !== "Draft" && (next.review?.snapshot !== finalPreparationFingerprint(after, order) || next.status === "Prepared" && next.prepared?.snapshot !== finalPreparationFingerprint(after, order) || finalPreparationProblems(after, order).length)) throw new Error("The final preparation review is no longer current.");
    if (old && next.version === old.version && JSON.stringify(old.input) !== JSON.stringify(next.input)) throw new Error("Editing a worksheet must create a new draft version.");
  }
}
