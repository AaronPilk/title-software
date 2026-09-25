/** Encrypted company/owner records. Never copy these into Workspace or audit text. */
export type OwnerRepresentative = { id: string; name: string; email: string; phone: string };
export type OwnerEntity = {
  id: string; memberId: string; kind: "individual" | "llc" | "other"; legalName: string; ein: string;
  representatives: OwnerRepresentative[];
  formationStatus: "Unknown" | "Being formed" | "Formed" | "Not applicable";
  formationBy: "Not confirmed" | "Agency" | "Owner / outside professional";
  formationState: string; formationReference: string; documentIds: string[];
};
export type AgreementTerm = { memberId: string; label: string; percentage: string };
export type CompanyAgreement = { id: string; title: string; effectiveOn: string; reference: string; documentIds: string[]; terms: AgreementTerm[]; notes: string };
export type ApplicationFieldSource = "company.name" | "company.states" | "company.ein" | "owner.name" | "owner.ein" | "owner.share" | "contact.name" | "contact.email" | "contact.phone" | "owner.formationState" | "owner.formationReference";
export const applicationFieldSources: { value: ApplicationFieldSource; label: string }[] = [
  { value: "company.name", label: "Title company name" }, { value: "company.states", label: "Operating states" }, { value: "company.ein", label: "Title company EIN" },
  { value: "owner.name", label: "Legal owner name" }, { value: "owner.ein", label: "Owner LLC EIN" }, { value: "owner.share", label: "Ownership percentage" },
  { value: "contact.name", label: "Representative name" }, { value: "contact.email", label: "Representative email" }, { value: "contact.phone", label: "Representative phone" },
  { value: "owner.formationState", label: "Owner formation state" }, { value: "owner.formationReference", label: "Owner formation reference" },
];
export type ApplicationWorksheet = { id: string; title: string; version: string; documentId: string; fields: { id: string; label: string; source: ApplicationFieldSource }[] };
export type CompanyRecords = { companyEin: string; owners: OwnerEntity[]; agreements: CompanyAgreement[]; worksheets: ApplicationWorksheet[] };
export const emptyCompanyRecords = (): CompanyRecords => ({ companyEin: "", owners: [], agreements: [], worksheets: [] });
const invalid = (): never => { throw new Error("Check the private owner and company record fields."); };
function obj(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return invalid();
  if (Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k) || !Object.getOwnPropertyDescriptor(v, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k)!, "value"))) return invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 500, multiline = false): string {
  if (typeof v !== "string" || v.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(v)) return invalid();
  return v.trim();
}
function id(v: unknown) { const s = text(v, 150); return /^[\w-]{1,150}$/.test(s) ? s : invalid(); }
function list<T>(v: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max || Object.keys(v).length !== v.length) return invalid();
  return v.map(parse);
}
function unique<T extends { id: string }>(items: T[]) { if (new Set(items.map(i => i.id)).size !== items.length) return invalid(); return items; }
function documentId(v: unknown) { const s = text(v, 180); return /^[-A-Za-z0-9_ .:@]{1,180}$/.test(s) ? s : invalid(); }
function documents(v: unknown) { const result = list(v, 20, documentId); if (new Set(result).size !== result.length) return invalid(); return result; }
function choice<T extends string>(v: unknown, values: readonly T[]): T { return values.includes(v as T) ? v as T : invalid(); }
export function normalizedEin(v: unknown) { const s = text(v, 10); return !s || /^(\d{9}|\d{2}-\d{7})$/.test(s) ? s.replace("-", "") : invalid(); }
function date(v: unknown) { const s = text(v, 10); return !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && !s.startsWith("0000") && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : invalid(); }
function owner(v: unknown): OwnerEntity {
  const r = obj(v, ["id", "memberId", "kind", "legalName", "ein", "representatives", "formationStatus", "formationBy", "formationState", "formationReference", "documentIds"]);
  const kind = choice(r.kind, ["individual", "llc", "other"] as const), ein = normalizedEin(r.ein);
  if (kind === "individual" && (ein || r.formationState !== "" || r.formationReference !== "" || r.formationBy !== "Not confirmed" || !["Unknown", "Not applicable"].includes(String(r.formationStatus)) || !Array.isArray(r.documentIds) || r.documentIds.length)) return invalid();
  const formationState = text(r.formationState, 2); if (formationState && !/^[A-Z]{2}$/.test(formationState)) return invalid();
  return { id: id(r.id), memberId: id(r.memberId), kind, legalName: text(r.legalName, 200), ein,
    representatives: unique(list(r.representatives, 10, v => { const r = obj(v, ["id", "name", "email", "phone"]); const email = text(r.email, 254); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid(); return { id: id(r.id), name: text(r.name, 150), email, phone: text(r.phone, 60) }; })),
    formationStatus: choice(r.formationStatus, ["Unknown", "Being formed", "Formed", "Not applicable"] as const),
    formationBy: choice(r.formationBy, ["Not confirmed", "Agency", "Owner / outside professional"] as const), formationState,
    formationReference: text(r.formationReference, 1000), documentIds: documents(r.documentIds) };
}
export function validateCompanyRecords(value: unknown): CompanyRecords {
  const r = obj(value, ["companyEin", "owners", "agreements", "worksheets"]);
  const owners = unique(list(r.owners, 40, owner));
  if (new Set(owners.map(o => o.memberId)).size !== owners.length) return invalid();
  const agreements = unique(list(r.agreements, 40, v => {
    const r = obj(v, ["id", "title", "effectiveOn", "reference", "documentIds", "terms", "notes"]);
    return { id: id(r.id), title: text(r.title, 200), effectiveOn: date(r.effectiveOn), reference: text(r.reference, 1000), documentIds: documents(r.documentIds), notes: text(r.notes, 4000, true),
      terms: list(r.terms, 80, v => { const t = obj(v, ["memberId", "label", "percentage"]), percentage = text(t.percentage, 7); if (percentage && (!/^\d{1,3}(\.\d{1,3})?$/.test(percentage) || Number(percentage) > 100)) return invalid(); return { memberId: id(t.memberId), label: text(t.label, 150), percentage }; }) };
  }));
  const worksheets = unique(list(r.worksheets, 30, v => {
    const r = obj(v, ["id", "title", "version", "documentId", "fields"]), originalId = text(r.documentId, 180);
    if (originalId) documentId(originalId);
    return { id: id(r.id), title: text(r.title, 200), version: text(r.version, 80), documentId: originalId,
      fields: unique(list(r.fields, 100, v => { const f = obj(v, ["id", "label", "source"]); return { id: id(f.id), label: text(f.label, 200), source: choice(f.source, applicationFieldSources.map(f => f.value)) }; })) };
  }));
  return { companyEin: normalizedEin(r.companyEin), owners, agreements, worksheets };
}
export function companyRecordSources(records?: CompanyRecords) {
  return records ? [
    ...records.owners.flatMap(o => o.documentIds.map(id => ({ id, categories: ["Formation", "Company records"] }))),
    ...records.agreements.flatMap(a => a.documentIds.map(id => ({ id, categories: ["Agreements"] }))),
    ...records.worksheets.filter(w => w.documentId).map(w => ({ id: w.documentId, categories: ["Applications", "Agreements", "Disclosures", "Company records"] })),
  ] : [];
}
