import { commandUuid, traceMutation } from "./command-log";
import type { Order, Workspace } from "./model";

/** A reviewed coordination ledger. Nothing in this module calls or writes SoftPro. */
export const orchestrationFields = ["address", "client", "seller", "lender", "loanAmount", "legalDescription", "county", "attorney", "attorneyEmail"] as const;
export type OrchestrationField = typeof orchestrationFields[number];
export type ChangeRisk = "Low" | "Medium" | "High";
export const readinessItems = [
  { key: "vendor-method", label: "SoftPro-approved integration method and access" },
  { key: "company-mappings", label: "Company, inbox and underwriter mappings" },
  { key: "field-mappings", label: "Verified external field identifiers and permissions" },
  { key: "samples", label: "Representative files and expected results" },
  { key: "approvals", label: "Named approvers and written approval rules" },
  { key: "templates", label: "Approved templates and SoftPro 360 channels" },
  { key: "storage", label: "Archive locations, retention and recovery rules" },
  { key: "support", label: "Business owner, support and escalation contacts" },
  { key: "acceptance", label: "Business acceptance and rollout sign-off" },
] as const;
type Stamp = { id: string; companyId: string; createdAt: string; createdBy: string };
export type CompanyProfileInput = { companyId: string; environmentId: string; externalCompanyId: string; externalCompanyName: string; underwriter: string; inboxAliases: string[]; templateRef: string; archiveRule: string; softPro360Channel: string; approvers: string[]; evidence: string };
export type CompanyProfile = Stamp & CompanyProfileInput & { version: number };
export type ExternalFieldMapInput = { companyId: string; localField: OrchestrationField; externalFieldId: string; canRead: boolean; canWrite: boolean; risk: ChangeRisk; evidence: string };
export type ExternalFieldMap = Stamp & ExternalFieldMapInput & { profileId: string; version: number };
export type ExternalOrderLinkInput = { orderId: string; externalFileId: string; externalFileNumber: string; missiveConversationId: string; evidence: string };
export type ExternalOrderLink = Stamp & ExternalOrderLinkInput & { profileId: string; environmentId: string; externalCompanyId: string; version: number };
export type OrchestrationControl = Stamp & { mode: "Observe" | "Propose"; paused: boolean; reason: string; version: number };
export type ReadinessAttestation = Stamp & { key: string; status: "Missing" | "Ready" | "Blocked"; evidence: string; version: number };
export type ProposalInput = { orderId: string; fieldMapId: string; beforeValue: string; afterValue: string; sourceDocumentId: string; sourcePage: string; sourceQuote: string; reason: string; matchStatus: "Confirmed" | "Ambiguous" | "Unknown"; externalReadEvidence: string };
export type ProposalReview = { decision: "Approved" | "Rejected"; note: string; by: string; at: string };
export type ExternalOutcome = { result: "Recorded in SoftPro" | "Not applied"; reference: string; note: string; by: string; at: string; kind: "Human attestation" };
export type ExternalChangeProposal = Stamp & ProposalInput & {
  profileId: string; linkId: string; controlId: string; localField: OrchestrationField; externalFieldId: string;
  sourceDocumentVersion: number; sourceFingerprint: string; orderFingerprint: string; risk: ChangeRisk;
  status: "Pending review" | "Exception" | "Approved" | "Rejected" | "Recorded";
  exceptions: string[]; review: ProposalReview | null; outcome: ExternalOutcome | null;
};
export type OrchestrationEvent = Stamp & { subjectId: string; action: string; note: string };
export type OrchestrationState = { version: 1; profiles: CompanyProfile[]; fieldMaps: ExternalFieldMap[]; links: ExternalOrderLink[]; controls: OrchestrationControl[]; readiness: ReadinessAttestation[]; proposals: ExternalChangeProposal[]; events: OrchestrationEvent[] };
type WithOrchestration = Workspace & { orchestration?: OrchestrationState };
const blank = (): OrchestrationState => ({ version: 1, profiles: [], fieldMaps: [], links: [], controls: [], readiness: [], proposals: [], events: [] });
const state = (s: Workspace) => (s as WithOrchestration).orchestration || blank();
export function orchestration(s: Workspace): OrchestrationState {
  return (s as WithOrchestration).orchestration ||= blank();
}
const norm = (s: string) => s.trim().toLowerCase();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const latest = <T>(rows: T[], match: (row: T) => boolean): T | undefined => [...rows].reverse().find(match);
export const currentProfile = (s: Workspace, companyId: string) => latest(state(s).profiles, r => r.companyId === companyId);
export function currentFieldMaps(s: Workspace, companyId: string) {
  return orchestrationFields.flatMap(localField => {
    const row = latest(state(s).fieldMaps, r => r.companyId === companyId && r.localField === localField);
    return row ? [row] : [];
  });
}
export const currentOrderLink = (s: Workspace, orderId: string) => latest(state(s).links, r => r.orderId === orderId);
export const currentControl = (s: Workspace, companyId: string): OrchestrationControl => latest(state(s).controls, r => r.companyId === companyId) || { id: "", companyId, mode: "Observe", paused: false, reason: "Default: preparation only", version: 0, createdAt: "", createdBy: "" };
export function currentReadiness(s: Workspace, companyId: string) {
  return readinessItems.flatMap(item => {
    const row = latest(state(s).readiness, r => r.companyId === companyId && r.key === item.key);
    return row ? [row] : [];
  });
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 20000;
const nonempty = (v: unknown): v is string => text(v) && !!v.trim();
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const iso = (v: unknown): v is string => text(v) && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const snapshot = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 2000000;
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const oneOf = (values: readonly string[]) => (v: unknown) => typeof v === "string" && values.includes(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(nonempty) && new Set(v.map(norm)).size === v.length;
type Shape = Record<string, (v: unknown) => boolean>;
function shape(v: unknown, fields: Shape): v is Record<string, unknown> {
  return record(v) && Object.keys(v).length === Object.keys(fields).length && Object.entries(fields).every(([key, check]) => Object.hasOwn(v, key) && check(v[key]));
}
function input(v: unknown, fields: Shape) {
  if (!shape(v, fields)) throw new Error("Use exactly the supported fields and valid values for this action.");
}
const baseShape = { id: nonempty, companyId: nonempty, createdAt: iso, createdBy: nonempty };
const profileInputShape = { companyId: nonempty, environmentId: nonempty, externalCompanyId: nonempty, externalCompanyName: nonempty, underwriter: text, inboxAliases: strings, templateRef: text, archiveRule: text, softPro360Channel: text, approvers: strings, evidence: nonempty };
const mapInputShape = { companyId: nonempty, localField: oneOf(orchestrationFields), externalFieldId: nonempty, canRead: bool, canWrite: bool, risk: oneOf(["Low", "Medium", "High"]), evidence: nonempty };
const linkInputShape = { orderId: nonempty, externalFileId: nonempty, externalFileNumber: nonempty, missiveConversationId: text, evidence: nonempty };
const controlInputShape = { companyId: nonempty, mode: oneOf(["Observe", "Propose"]), paused: bool, reason: nonempty };
const readinessInputShape = { companyId: nonempty, key: oneOf(readinessItems.map(r => r.key)), status: oneOf(["Missing", "Ready", "Blocked"]), evidence: nonempty };
const proposalInputShape = { orderId: nonempty, fieldMapId: nonempty, beforeValue: text, afterValue: nonempty, sourceDocumentId: nonempty, sourcePage: nonempty, sourceQuote: nonempty, reason: nonempty, matchStatus: oneOf(["Confirmed", "Ambiguous", "Unknown"]), externalReadEvidence: nonempty };
const reviewInputShape = { decision: oneOf(["Approved", "Rejected"]), note: nonempty };
const outcomeInputShape = { result: oneOf(["Recorded in SoftPro", "Not applied"]), reference: nonempty, note: nonempty };
const reviewShape = { ...reviewInputShape, by: nonempty, at: iso };
const outcomeShape = { ...outcomeInputShape, by: nonempty, at: iso, kind: oneOf(["Human attestation"]) };
const shapes = {
  profiles: { ...baseShape, ...profileInputShape, version: integer },
  fieldMaps: { ...baseShape, ...mapInputShape, profileId: nonempty, version: integer },
  links: { ...baseShape, ...linkInputShape, profileId: nonempty, environmentId: nonempty, externalCompanyId: nonempty, version: integer },
  controls: { ...baseShape, ...controlInputShape, version: integer },
  readiness: { ...baseShape, ...readinessInputShape, version: integer },
  proposals: { ...baseShape, ...proposalInputShape, profileId: nonempty, linkId: text, controlId: nonempty, localField: oneOf(orchestrationFields), externalFieldId: nonempty, sourceDocumentVersion: integer, sourceFingerprint: snapshot, orderFingerprint: snapshot, risk: oneOf(["Low", "Medium", "High"]), status: oneOf(["Pending review", "Exception", "Approved", "Rejected", "Recorded"]), exceptions: strings, review: (v: unknown) => v === null || shape(v, reviewShape), outcome: (v: unknown) => v === null || shape(v, outcomeShape) },
  events: { ...baseShape, subjectId: nonempty, action: nonempty, note: nonempty },
} satisfies Record<string, Shape>;
const collections = Object.keys(shapes) as (keyof typeof shapes)[];
export function isValidOrchestration(v: unknown): v is OrchestrationState | undefined {
  if (v === undefined) return true;
  if (!record(v) || v.version !== 1 || Object.keys(v).length !== collections.length + 1) return false;
  return collections.every(key => Array.isArray(v[key]) && (v[key] as unknown[]).every(row => shape(row, shapes[key])));
}
function actor(s: Workspace) {
  if (!nonempty(s.user)) throw new Error("Choose the operator recording this work.");
  return s.user.trim();
}
function stamp(s: Workspace, companyId: string, prefix: string): Stamp {
  if (!s.companies.some(c => c.id === companyId)) throw new Error("Choose a company on file.");
  return { id: `${prefix}-${commandUuid()}`, companyId, createdAt: new Date().toISOString(), createdBy: actor(s) };
}
const clean = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === "string" ? v.trim() : Array.isArray(v) ? v.map(item => typeof item === "string" ? item.trim() : item) : v])) as T;
function audit(s: Workspace, row: Stamp, action: string, note: string) {
  orchestration(s).events.push({ ...stamp(s, row.companyId, "ore"), subjectId: row.id, action, note });
}
function order(s: Workspace, orderId: string): Order {
  const result = s.orders.find(o => o.id === orderId);
  if (!result) throw new Error("Choose an order on file.");
  return result;
}
function profile(s: Workspace, companyId: string): CompanyProfile {
  const result = currentProfile(s, companyId);
  if (!result) throw new Error("Record this company's SoftPro profile first.");
  return result;
}
function enabled(s: Workspace, companyId: string) {
  const control = currentControl(s, companyId);
  if (control.paused) throw new Error("This company's proposal workflow is paused. Record a reason before resuming.");
  if (control.mode !== "Propose") throw new Error("Enable Propose mode before preparing or reviewing changes.");
  return control;
}
function effectiveRisk(field: OrchestrationField, configured: ChangeRisk): ChangeRisk {
  if (["address", "legalDescription", "client", "seller", "county"].includes(field)) return "High";
  return configured === "Low" ? "Medium" : configured;
}
function isPostClosing(s: Workspace, file: Order) {
  return ["Issued", "Ready for jacket"].includes(file.status) || !!file.outcomes?.some(o => o.kind === "Closing recorded") || !!s.business?.policies.some(p => p.orderId === file.id && ["Prepared", "Issued", "Delivered"].includes(p.status));
}
/** Exact snapshots avoid conflating a locally cached value with an external read. */
function orderFingerprint(s: Workspace, file: Order) { return JSON.stringify({ order: file, policies: s.business?.policies.filter(p => p.orderId === file.id) || [] }); }
function sourceFingerprint(doc: Workspace["documents"][number]) { return JSON.stringify(doc); }

export function saveCompanyProfile(s: Workspace, value: CompanyProfileInput) {
  return traceMutation(s, "saveCompanyProfile", [value], () => {
    input(value, profileInputShape);
    const v = clean(value), prior = currentProfile(s, v.companyId);
    const others = s.companies.flatMap(c => c.id === v.companyId ? [] : currentProfile(s, c.id) || []);
    if (others.some(p => norm(p.environmentId) !== norm(v.environmentId))) throw new Error("All company profiles must use the same SoftPro environment.");
    if (others.some(p => norm(p.externalCompanyId) === norm(v.externalCompanyId))) throw new Error("That external company is already mapped to another company.");
    if (others.some(p => p.inboxAliases.some(alias => v.inboxAliases.some(a => norm(a) === norm(alias))))) throw new Error("An inbox alias can only map to one company. Resolve the ambiguity first.");
    const row: CompanyProfile = { ...v, ...stamp(s, v.companyId, "orp"), version: (prior?.version || 0) + 1 };
    orchestration(s).profiles.push(row);
    audit(s, row, "Company profile recorded", v.evidence);
    return row;
  });
}
export function saveExternalFieldMap(s: Workspace, value: ExternalFieldMapInput) {
  return traceMutation(s, "saveExternalFieldMap", [value], () => {
    input(value, mapInputShape);
    const v = clean(value), p = profile(s, v.companyId), existing = currentFieldMaps(s, v.companyId);
    if (!v.canRead && !v.canWrite) throw new Error("Choose a supported read or write direction.");
    if (existing.some(m => m.localField !== v.localField && norm(m.externalFieldId) === norm(v.externalFieldId))) throw new Error("That external field already maps to another local field.");
    const row: ExternalFieldMap = { ...v, risk: effectiveRisk(v.localField, v.risk), ...stamp(s, v.companyId, "orf"), profileId: p.id, version: (existing.find(m => m.localField === v.localField)?.version || 0) + 1 };
    orchestration(s).fieldMaps.push(row);
    audit(s, row, "Field mapping recorded", v.evidence);
    return row;
  });
}
export function verifyExternalOrderLink(s: Workspace, value: ExternalOrderLinkInput) {
  return traceMutation(s, "verifyExternalOrderLink", [value], () => {
    input(value, linkInputShape);
    const v = clean(value), file = order(s, v.orderId), p = profile(s, file.companyId);
    const others = s.orders.flatMap(o => o.id === file.id ? [] : currentOrderLink(s, o.id) || []);
    if (others.some(link => norm(link.environmentId) === norm(p.environmentId) && norm(link.externalCompanyId) === norm(p.externalCompanyId) && (norm(link.externalFileId) === norm(v.externalFileId) || norm(link.externalFileNumber) === norm(v.externalFileNumber)))) throw new Error("That SoftPro file is already linked to another local order.");
    if (v.missiveConversationId && others.some(link => link.companyId === file.companyId && link.missiveConversationId === v.missiveConversationId)) throw new Error("That conversation is already linked to another order in this company.");
    const row: ExternalOrderLink = { ...v, ...stamp(s, file.companyId, "orl"), profileId: p.id, environmentId: p.environmentId, externalCompanyId: p.externalCompanyId, version: (currentOrderLink(s, file.id)?.version || 0) + 1 };
    orchestration(s).links.push(row);
    audit(s, row, "SoftPro file link attested", v.evidence);
    return row;
  });
}
export function setOrchestrationControl(s: Workspace, value: { companyId: string; mode: "Observe" | "Propose"; paused: boolean; reason: string }) {
  return traceMutation(s, "setOrchestrationControl", [value], () => {
    input(value, controlInputShape);
    const v = clean(value), row: OrchestrationControl = { ...v, ...stamp(s, v.companyId, "orc"), version: currentControl(s, v.companyId).version + 1 };
    orchestration(s).controls.push(row);
    audit(s, row, v.paused ? "Proposal workflow paused" : "Proposal control recorded", v.reason);
    return row;
  });
}
export function attestReadiness(s: Workspace, value: { companyId: string; key: string; status: "Missing" | "Ready" | "Blocked"; evidence: string }) {
  return traceMutation(s, "attestReadiness", [value], () => {
    input(value, readinessInputShape);
    const v = clean(value), previous = currentReadiness(s, v.companyId).find(r => r.key === v.key);
    const row: ReadinessAttestation = { ...v, ...stamp(s, v.companyId, "orr"), version: (previous?.version || 0) + 1 };
    orchestration(s).readiness.push(row);
    audit(s, row, "Readiness attested", v.evidence);
    return row;
  });
}
export function proposeExternalChange(s: Workspace, value: ProposalInput) {
  return traceMutation(s, "proposeExternalChange", [value], () => {
    input(value, proposalInputShape);
    const v = clean(value), file = order(s, v.orderId), p = profile(s, file.companyId), control = enabled(s, file.companyId);
    const map = currentFieldMaps(s, file.companyId).find(m => m.id === v.fieldMapId);
    if (!map || map.profileId !== p.id) throw new Error("Choose a current field mapping verified for this company profile.");
    const doc = s.documents.find(d => d.id === v.sourceDocumentId && d.companyId === file.companyId && d.orderId === file.id);
    if (!doc) throw new Error("Choose source evidence attached to this same company and order.");
    if (v.beforeValue === v.afterValue) throw new Error("The proposed value must differ from the manually observed SoftPro value.");
    if (map.localField === "loanAmount" && (!/^\d+(\.\d{1,2})?$/.test(v.afterValue) || Number(v.afterValue) <= 0)) throw new Error("Enter a positive loan amount with up to two decimal places.");
    if (doc.text && !doc.text.replace(/\s+/g, " ").includes(v.sourceQuote.replace(/\s+/g, " "))) throw new Error("The source quotation must appear in the selected document's extracted text.");
    const observedLink = currentOrderLink(s, file.id), link = observedLink?.profileId === p.id ? observedLink : undefined, exceptions: string[] = [];
    if (v.matchStatus !== "Confirmed") exceptions.push("The source has not been matched to one confirmed file.");
    if (!link || link.profileId !== p.id) exceptions.push("A current SoftPro file link must be attested before review.");
    if (!map.canWrite) exceptions.push("This field mapping does not permit a write proposal.");
    if (map.localField === "loanAmount" && (s.business?.policies.filter(p => p.orderId === file.id && p.kind === "Loan" && p.status !== "Void").length || 0) > 1) exceptions.push("This order contains multiple active loans. Use a loan-specific revision and verified external field mapping before preparing the external change.");
    if (isPostClosing(s, file)) exceptions.push("This file has closing or issuance evidence. Use the attorney or policy correction workflow before preparing any external change.");
    const row: ExternalChangeProposal = { ...v, ...stamp(s, file.companyId, "orq"), profileId: p.id, linkId: link?.id || "", controlId: control.id, localField: map.localField, externalFieldId: map.externalFieldId, sourceDocumentVersion: doc.version, sourceFingerprint: sourceFingerprint(doc), orderFingerprint: orderFingerprint(s, file), risk: effectiveRisk(map.localField, map.risk), status: exceptions.length ? "Exception" : "Pending review", exceptions, review: null, outcome: null };
    orchestration(s).proposals.push(row);
    audit(s, row, "External change proposed", v.reason);
    return row;
  });
}

export function proposalStaleness(s: Workspace, proposal: ExternalChangeProposal): string[] {
  const reasons: string[] = [], p = currentProfile(s, proposal.companyId), file = s.orders.find(o => o.id === proposal.orderId && o.companyId === proposal.companyId);
  if (!file || orderFingerprint(s, file) !== proposal.orderFingerprint) reasons.push("The local order changed after capture.");
  if (file && isPostClosing(s, file)) reasons.push("Closing or policy preparation evidence requires specialist review.");
  if (!p || p.id !== proposal.profileId) reasons.push("The company profile changed after capture.");
  if (currentFieldMaps(s, proposal.companyId).find(m => m.localField === proposal.localField)?.id !== proposal.fieldMapId) reasons.push("The external field mapping changed after capture.");
  if ((currentOrderLink(s, proposal.orderId)?.id || "") !== proposal.linkId) reasons.push("The SoftPro file link changed after capture.");
  if (currentControl(s, proposal.companyId).id !== proposal.controlId) reasons.push("The proposal controls changed after capture.");
  const doc = s.documents.find(d => d.id === proposal.sourceDocumentId && d.companyId === proposal.companyId && d.orderId === proposal.orderId);
  if (!doc || sourceFingerprint(doc) !== proposal.sourceFingerprint) reasons.push("The source document changed after capture.");
  return reasons;
}
function findProposal(s: Workspace, proposalId: string) {
  const row = state(s).proposals.find(p => p.id === proposalId);
  if (!row) throw new Error("Choose a proposal on file.");
  return row;
}
function readyToApprove(s: Workspace, proposal: ExternalChangeProposal) {
  enabled(s, proposal.companyId);
  const reasons = proposalStaleness(s, proposal);
  if (reasons.length) throw new Error(`Capture a new proposal: ${reasons.join(" ")}`);
  if (proposal.exceptions.length || proposal.status === "Exception") throw new Error("Resolve the exception and capture a new proposal before approval.");
  if (!profile(s, proposal.companyId).approvers.some(a => norm(a) === norm(actor(s)))) throw new Error("Only a named approver in this company's profile can approve this proposal.");
}
export function reviewExternalProposal(s: Workspace, proposalId: string, value: { decision: "Approved" | "Rejected"; note: string }) {
  return traceMutation(s, "reviewExternalProposal", [proposalId, value], () => {
    input(value, reviewInputShape);
    const row = findProposal(s, proposalId), v = clean(value);
    if (!["Pending review", "Exception"].includes(row.status) || row.review) throw new Error("This proposal already has a final review. Capture a new proposal for another change.");
    if (v.decision === "Approved") readyToApprove(s, row);
    row.review = { ...v, by: actor(s), at: new Date().toISOString() };
    row.status = v.decision;
    audit(s, row, "External proposal reviewed", v.note);
    return row;
  });
}
export function recordExternalOutcome(s: Workspace, proposalId: string, value: { result: "Recorded in SoftPro" | "Not applied"; reference: string; note: string }) {
  return traceMutation(s, "recordExternalOutcome", [proposalId, value], () => {
    input(value, outcomeInputShape);
    const row = findProposal(s, proposalId), v = clean(value);
    if (row.status !== "Approved" || row.outcome || row.review?.decision !== "Approved") throw new Error("Approve the proposal before recording its external outcome.");
    if (v.result === "Recorded in SoftPro") {
      enabled(s, row.companyId);
      const reasons = proposalStaleness(s, row);
      if (reasons.length) throw new Error(`Capture a new proposal before recording this change: ${reasons.join(" ")}`);
    }
    row.outcome = { ...v, by: actor(s), at: new Date().toISOString(), kind: "Human attestation" };
    row.status = "Recorded";
    audit(s, row, "External outcome attested", `${v.result}: ${v.reference}. ${v.note}`);
    return row;
  });
}

export type MatchCandidate = { orderId: string; linkId: string; companyId: string; address: string; externalFileNumber: string; strength: "Exact" | "Address" | "Name only"; reasons: string[] };
export type MatchResult = { status: "Candidate" | "Ambiguous" | "Unknown"; candidates: MatchCandidate[]; requiresHumanConfirmation: true };
const addressKey = (v: string) => norm(v).replace(/[^a-z0-9]+/g, " ").trim().replace(/\b(street|road|avenue|boulevard|drive|lane|court|north|south|east|west)\b/g, part => ({ street: "st", road: "rd", avenue: "ave", boulevard: "blvd", drive: "dr", lane: "ln", court: "ct", north: "n", south: "s", east: "e", west: "w" })[part] || part).replace(/\s+/g, " ");
/** Candidate lookup only. Even a unique exact identifier still needs human confirmation. */
export function matchExternalOrder(s: Workspace, companyId: string, query: { externalFileNumber?: string; missiveConversationId?: string; address?: string; client?: string }): MatchResult {
  const p = currentProfile(s, companyId);
  const candidates: MatchCandidate[] = s.orders.filter(o => o.companyId === companyId).flatMap(file => {
    const link = currentOrderLink(s, file.id);
    if (!link || !p || link.profileId !== p.id) return [];
    const reasons: string[] = [];
    if (query.externalFileNumber?.trim() && norm(link.externalFileNumber) === norm(query.externalFileNumber)) reasons.push("Exact SoftPro file number");
    if (query.missiveConversationId?.trim() && link.missiveConversationId === query.missiveConversationId.trim()) reasons.push("Exact Missive conversation");
    const exact = reasons.length > 0;
    if (query.address?.trim() && addressKey(query.address) === addressKey(file.address)) reasons.push("Matching address");
    const address = reasons.includes("Matching address");
    if (query.client?.trim() && norm(query.client) === norm(file.client)) reasons.push("Matching name only");
    return reasons.length ? [{ orderId: file.id, linkId: link.id, companyId, address: file.address, externalFileNumber: link.externalFileNumber, strength: exact ? "Exact" as const : address ? "Address" as const : "Name only" as const, reasons }] : [];
  });
  const exact = candidates.filter(c => c.strength === "Exact"), address = candidates.filter(c => c.strength === "Address");
  const conflicts = exact.some(c => (query.externalFileNumber?.trim() && norm(c.externalFileNumber) !== norm(query.externalFileNumber)) || (query.missiveConversationId?.trim() && !c.reasons.includes("Exact Missive conversation")) || (query.address?.trim() && addressKey(c.address) !== addressKey(query.address)));
  const ranked = exact.length ? [...exact, ...(conflicts ? address : [])] : address.length ? address : candidates;
  if (conflicts) for (const candidate of exact) candidate.reasons.push("Supplied file, conversation or address evidence conflicts; review the identity manually");
  return { status: !ranked.length ? "Unknown" : !conflicts && ranked.length === 1 && ranked[0].strength !== "Name only" ? "Candidate" : "Ambiguous", candidates: ranked, requiresHumanConfirmation: true };
}

/** Structural, relational and immutable-history validation also applies on backup import. */
export function validateOrchestrationMutation(before: Workspace, after: Workspace) {
  const raw = (after as WithOrchestration).orchestration;
  if (!isValidOrchestration(raw)) throw new Error("The orchestration ledger has invalid or unsupported fields.");
  const next = state(after), previous = state(before), allIds = new Set<string>();
  for (const key of collections) {
    for (const row of next[key]) {
      if (allIds.has(row.id)) throw new Error("Orchestration record IDs must be unique.");
      allIds.add(row.id);
      if (!after.companies.some(c => c.id === row.companyId)) throw new Error("An orchestration record references a missing company.");
    }
    if (key !== "proposals" && (next[key].length < previous[key].length || !previous[key].every((row, index) => same(row, next[key][index])))) throw new Error("Orchestration history is immutable. Record a new revision instead.");
  }
  const sequence = <T extends Stamp & { version: number }>(rows: T[], key: (row: T) => string) => {
    const versions = new Map<string, number>();
    for (const row of rows) {
      const expected = (versions.get(key(row)) || 0) + 1;
      if (row.version !== expected) throw new Error("Orchestration revisions must remain sequential.");
      versions.set(key(row), row.version);
    }
  };
  sequence(next.profiles, r => r.companyId); sequence(next.fieldMaps, r => `${r.companyId}:${r.localField}`); sequence(next.links, r => r.orderId); sequence(next.controls, r => r.companyId); sequence(next.readiness, r => `${r.companyId}:${r.key}`);
  const profiles = after.companies.flatMap(c => currentProfile(after, c.id) || []);
  if (new Set(profiles.map(p => norm(p.environmentId))).size > 1 || new Set(profiles.map(p => norm(p.externalCompanyId))).size !== profiles.length) throw new Error("Use one SoftPro environment and a unique external company mapping for each company.");
  const aliases = profiles.flatMap(p => p.inboxAliases.map(norm));
  if (new Set(aliases).size !== aliases.length) throw new Error("An inbox alias cannot map to more than one company.");
  const profileById = (id: string, companyId: string) => {
    const row = next.profiles.find(p => p.id === id && p.companyId === companyId);
    if (!row) throw new Error("The historical company profile reference is invalid.");
    return row;
  };
  for (const m of next.fieldMaps) {
    profileById(m.profileId, m.companyId);
    if ((!m.canRead && !m.canWrite) || m.risk !== effectiveRisk(m.localField, m.risk)) throw new Error("The field mapping's permissions or risk classification are invalid.");
  }
  for (const c of after.companies) {
    const fields = currentFieldMaps(after, c.id).map(m => norm(m.externalFieldId));
    if (new Set(fields).size !== fields.length) throw new Error("An external field can only map to one local field.");
  }
  for (const l of next.links) {
    const p = profileById(l.profileId, l.companyId), file = order(after, l.orderId);
    if (file.companyId !== l.companyId || l.environmentId !== p.environmentId || l.externalCompanyId !== p.externalCompanyId) throw new Error("The external file link crosses company or environment boundaries.");
  }
  const links = after.orders.flatMap(o => currentOrderLink(after, o.id) || []), fileIds = new Set<string>(), numbers = new Set<string>(), threads = new Set<string>();
  for (const l of links) {
    const scope = `${norm(l.environmentId)}\u0000${norm(l.externalCompanyId)}\u0000`, id = scope + norm(l.externalFileId), number = scope + norm(l.externalFileNumber), thread = `${l.companyId}\u0000${l.missiveConversationId}`;
    if (fileIds.has(id) || numbers.has(number) || (l.missiveConversationId && threads.has(thread))) throw new Error("An external file or conversation is linked to multiple local orders.");
    fileIds.add(id); numbers.add(number); if (l.missiveConversationId) threads.add(thread);
  }
  for (const row of next.proposals) {
    const p = profileById(row.profileId, row.companyId), file = order(after, row.orderId), m = next.fieldMaps.find(r => r.id === row.fieldMapId && r.companyId === row.companyId), l = row.linkId ? next.links.find(r => r.id === row.linkId && r.companyId === row.companyId && r.orderId === row.orderId) : null, doc = after.documents.find(d => d.id === row.sourceDocumentId && d.companyId === row.companyId && d.orderId === row.orderId), control = next.controls.find(c => c.id === row.controlId && c.companyId === row.companyId);
    if (file.companyId !== row.companyId || !m || m.profileId !== p.id || m.localField !== row.localField || m.externalFieldId !== row.externalFieldId || row.risk !== effectiveRisk(m.localField, m.risk) || (row.linkId && !l) || (l && l.profileId !== p.id) || !doc || !control || control.paused || control.mode !== "Propose") throw new Error("A proposal has invalid company, mapping, source or control references.");
    let capturedOrder: { order: Order; policies: NonNullable<Workspace["business"]>["policies"] }, capturedSource: Workspace["documents"][number];
    try {
      capturedOrder = JSON.parse(row.orderFingerprint);
      capturedSource = JSON.parse(row.sourceFingerprint);
      if (!record(capturedOrder) || !record(capturedOrder.order) || capturedOrder.order.id !== row.orderId || capturedOrder.order.companyId !== row.companyId || !Array.isArray(capturedOrder.policies) || !capturedOrder.policies.every(r => record(r) && r.orderId === row.orderId) || !record(capturedSource) || capturedSource.id !== row.sourceDocumentId || capturedSource.companyId !== row.companyId || capturedSource.orderId !== row.orderId || capturedSource.version !== row.sourceDocumentVersion) throw new Error("Invalid capture");
      if (capturedOrder.order.outcomes !== undefined && (!Array.isArray(capturedOrder.order.outcomes) || !capturedOrder.order.outcomes.every(o => record(o) && typeof o.kind === "string"))) throw new Error("Invalid closing evidence");
      if (capturedSource.text && (typeof capturedSource.text !== "string" || !capturedSource.text.replace(/\s+/g, " ").includes(row.sourceQuote.replace(/\s+/g, " ")))) throw new Error("Invalid quotation");
    } catch { throw new Error("The proposal's captured order or source evidence is invalid."); }
    const capturedClosed = ["Issued", "Ready for jacket"].includes(capturedOrder.order.status) || !!capturedOrder.order.outcomes?.some(o => o.kind === "Closing recorded") || capturedOrder.policies.some(p => ["Prepared", "Issued", "Delivered"].includes(p.status));
    const capturedMultiLoan = row.localField === "loanAmount" && capturedOrder.policies.filter(p => p.kind === "Loan" && p.status !== "Void").length > 1;
    const requiredExceptions = row.matchStatus !== "Confirmed" || !l || !m.canWrite || capturedClosed || capturedMultiLoan;
    if ((requiredExceptions && !row.exceptions.length) || (row.status === "Pending review" && row.exceptions.length) || (row.status === "Exception" && !row.exceptions.length) || row.beforeValue === row.afterValue) throw new Error("A proposal's exception state does not match its captured evidence.");
    if (row.localField === "loanAmount" && (!/^\d+(\.\d{1,2})?$/.test(row.afterValue) || Number(row.afterValue) <= 0)) throw new Error("A loan amount proposal must contain a positive amount with up to two decimal places.");
    if (row.review && (Date.parse(row.review.at) < Date.parse(row.createdAt) || (row.review.decision === "Approved" && (!p.approvers.some(a => norm(a) === norm(row.review!.by)) || row.exceptions.length)))) throw new Error("The proposal review lacks valid approval authority or timing.");
    if ((["Approved", "Rejected", "Recorded"].includes(row.status) !== !!row.review) || (row.review && row.status !== "Recorded" && row.status !== row.review.decision) || (row.status === "Recorded") !== !!row.outcome || (row.outcome && (row.review?.decision !== "Approved" || Date.parse(row.outcome.at) < Date.parse(row.review.at)))) throw new Error("A proposal review or outcome has an invalid lifecycle.");
  }
  for (const row of previous.proposals) {
    const candidate = next.proposals.find(p => p.id === row.id);
    if (!candidate) throw new Error("Proposals cannot be deleted.");
    const capturedEvidence = (proposal: ExternalChangeProposal) => Object.fromEntries(
      Object.entries(proposal).filter(([key]) => !["status", "review", "outcome"].includes(key)),
    );
    const original = capturedEvidence(row), changed = capturedEvidence(candidate);
    if (!same(original, changed) || (row.review && !same(row.review, candidate.review)) || (row.outcome && !same(row.outcome, candidate.outcome))) throw new Error("Captured evidence, reviews and outcomes are immutable.");
    if (row.status !== candidate.status) {
      if (["Pending review", "Exception"].includes(row.status) && ["Approved", "Rejected"].includes(candidate.status)) {
        if (candidate.status === "Approved") readyToApprove(after, row);
      } else if (row.status === "Approved" && candidate.status === "Recorded") {
        if (candidate.outcome?.result === "Recorded in SoftPro" && (currentControl(after, row.companyId).paused || currentControl(after, row.companyId).mode !== "Propose" || proposalStaleness(after, row).length)) throw new Error("A stale or paused proposal cannot be recorded as an external change.");
      } else throw new Error("This proposal status transition is not supported.");
    }
  }
  for (const event of next.events) {
    if (!collections.filter(k => k !== "events").some(k => next[k].some(row => row.id === event.subjectId && row.companyId === event.companyId))) throw new Error("An orchestration audit event references a missing or different-company record.");
  }
  for (const key of collections.filter(k => k !== "events")) for (const row of next[key]) {
    if (!next.events.some(e => e.subjectId === row.id && e.companyId === row.companyId && e.createdBy === row.createdBy && Date.parse(e.createdAt) >= Date.parse(row.createdAt))) throw new Error("Every orchestration record needs its original audit event.");
  }
  for (const row of next.proposals) {
    if (row.review && !next.events.some(e => e.subjectId === row.id && e.action === "External proposal reviewed" && e.createdBy === row.review!.by && Date.parse(e.createdAt) >= Date.parse(row.review!.at))) throw new Error("A proposal review is missing its audit event.");
    if (row.outcome && !next.events.some(e => e.subjectId === row.id && e.action === "External outcome attested" && e.createdBy === row.outcome!.by && Date.parse(e.createdAt) >= Date.parse(row.outcome!.at))) throw new Error("An external outcome is missing its audit event.");
  }
}

/** Root dispatch uses this finite list; helper functions are never remote commands. */
export const orchestrationActionNames = ["saveCompanyProfile", "saveExternalFieldMap", "verifyExternalOrderLink", "setOrchestrationControl", "attestReadiness", "proposeExternalChange", "reviewExternalProposal", "recordExternalOutcome"] as const;
