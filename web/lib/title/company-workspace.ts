import type { Company, Workspace } from "./model";

export type CompanyFolder = { id: string; name: string };
export type ServiceRenewal = { service: "Domain" | "Email" | "Website"; renewalOn: string; provider: string; reference: string };
export type CompanyDesk = { logoDocumentId: string; folders: CompanyFolder[]; renewals: ServiceRenewal[] };
export const emptyCompanyDesk = (): CompanyDesk => ({ logoDocumentId: "", folders: [], renewals: [] });
export const companyDesk = (company: Company): CompanyDesk => company.desk || emptyCompanyDesk();
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = (v: unknown) => text(v, 150) && /^[\w-]+$/.test(v as string);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const validRenewalDate = (v: string) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000") && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function validateCompanyDesk(value: unknown): CompanyDesk {
  if (!object(value) || !exact(value, ["logoDocumentId", "folders", "renewals"]) || !text(value.logoDocumentId, 180) ||
      !Array.isArray(value.folders) || value.folders.length > 100 || !Array.isArray(value.renewals) || value.renewals.length > 3)
    throw new Error("Check the company logo, folders and renewal details.");
  for (const folder of value.folders) if (!object(folder) || !exact(folder, ["id", "name"]) || !id(folder.id) || !text(folder.name, 100) || !(folder.name as string).trim())
    throw new Error("Give each folder a name of up to 100 characters.");
  if (new Set(value.folders.map(f => f.id)).size !== value.folders.length || new Set(value.folders.map(f => f.name.trim().toLowerCase())).size !== value.folders.length)
    throw new Error("Use a different name for each company folder.");
  for (const r of value.renewals) if (!object(r) || !exact(r, ["service", "renewalOn", "provider", "reference"]) ||
      !["Domain", "Email", "Website"].includes(r.service as string) || !text(r.renewalOn, 10) || !validRenewalDate(r.renewalOn as string) || !text(r.provider, 200) || !text(r.reference, 500))
    throw new Error("Check each service and its renewal date.");
  if (new Set(value.renewals.map(r => r.service)).size !== value.renewals.length) throw new Error("Record one renewal for each service.");
  return structuredClone(value) as CompanyDesk;
}
/** Also used on restore: extensions cannot bypass document/company boundaries. */
export function validateCompanyWorkspace(state: Workspace) {
  for (const c of state.companies) {
    const desk = c.desk === undefined ? emptyCompanyDesk() : validateCompanyDesk(c.desk);
    const memberIds = c.members.flatMap(m => m.id === undefined ? [] : [m.id]);
    if (memberIds.some(v => !id(v)) || new Set(memberIds).size !== memberIds.length) throw new Error("Invalid member identity.");
    if (desk.logoDocumentId) {
      const doc = state.documents.find(d => d.id === desk.logoDocumentId);
      if (!doc || doc.companyId !== c.id || doc.orderId || doc.category !== "Branding" || doc.visibility !== "Internal" || !doc.assetId || !["image/png", "image/jpeg"].includes(doc.mime || ""))
        throw new Error("Choose an internal PNG or JPG logo from this company’s documents.");
    }
  }
  for (const doc of state.documents) if (doc.folderId !== undefined && doc.folderId !== "") {
    const c = state.companies.find(c => c.id === doc.companyId);
    if (!id(doc.folderId) || doc.orderId || !c || !companyDesk(c).folders.some(f => f.id === doc.folderId))
      throw new Error("Choose a document folder belonging to this company.");
  }
}
export function companyWorkspaceShapeValid(state: Workspace) { try { validateCompanyWorkspace(state); return true; } catch { return false; } }
export function nextServiceRenewal(company: Company) {
  return companyDesk(company).renewals.filter(r => r.renewalOn).sort((a, b) => a.renewalOn.localeCompare(b.renewalOn))[0];
}

export function validateMemberIdentityMutation(before: Workspace, after: Workspace) {
  for (const prior of before.companies) {
    const next = after.companies.find(c => c.id === prior.id); if (!next) continue;
    for (const member of prior.members) {
      const sameName = next.members.find(m => m.name === member.name);
      const sameId = member.id ? next.members.find(m => m.id === member.id) : undefined;
      if (member.id && sameName && sameName.id !== member.id || sameId && sameId.name !== member.name)
        throw new Error("Keep the existing member identity and ledger name. Update legal owner details separately.");
      if (!member.id && !sameName && next.members.some(m => m.id && !prior.members.some(p => p.name === m.name)))
        throw new Error("Save member identities before changing legacy names. Keep the existing ledger name for its history.");
    }
  }
}
