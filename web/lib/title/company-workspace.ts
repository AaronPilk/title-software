import type { Company, VaultDoc, Workspace } from "./model";

export type CompanyFolder = { id: string; name: string };
export type ServiceRenewal = { service: "Domain" | "Email" | "Website"; renewalOn: string; provider: string; reference: string; renewalYears?: number };
export type CompanyEmail = { id: string; label: string; address: string; primary: boolean };
export type CompanyPartnerContact = { id: string; name: string; email: string; phone: string };
export type CompanyDesk = { partnerContacts?: CompanyPartnerContact[]; logoDocumentId: string; folders: CompanyFolder[]; renewals: ServiceRenewal[]; emails?: CompanyEmail[]; address?: string; domain?: string; website?: string; websiteNotNeeded?: boolean };
const legacyCompanyFolders = (): CompanyFolder[] => [
  "Application & Agreements", "Company Formation & Tax", "Partner Ownership Entities", "Licensing & Underwriter Approvals",
  "Banking & Accounting", "Brand, Website & Email", "Disclosures & Forms", "SoftPro & Production Setup",
].map((name, index) => ({ id: `agency-folder-${index + 1}`, name: `${String(index + 1).padStart(2, "0")} – ${name}` }));
export const defaultCompanyFolders = (): CompanyFolder[] => [];
export const emptyCompanyDesk = (): CompanyDesk => ({ logoDocumentId: "", folders: defaultCompanyFolders(), renewals: [] });
export const companyDesk = (company: Company, documents: readonly VaultDoc[] = []): CompanyDesk => {
  const desk = company.desk || emptyCompanyDesk();
  // Older uploads could reference an implicit preset without saving it on the
  // company. Keep that folder reachable, including files retained in Trash.
  const used = new Set(documents.filter(doc => doc.companyId === company.id && !doc.orderId).map(doc => doc.folderId));
  return { ...desk, folders: [...desk.folders, ...legacyCompanyFolders().filter(seed => used.has(seed.id) && !desk.folders.some(folder => folder.id === seed.id))] };
};
/** Unused presets stay stored for compatibility; custom and occupied folders stay visible. */
export function visibleCompanyFolders(company: Company, documents: readonly VaultDoc[]): CompanyFolder[] {
  const used = new Set(documents.filter(doc => doc.companyId === company.id && !doc.orderId).map(doc => doc.folderId));
  const legacy = legacyCompanyFolders();
  return companyDesk(company, documents).folders.filter(folder => used.has(folder.id) || !legacy.some(seed => seed.id === folder.id && seed.name === folder.name));
}
export function companyEmails(company: Company): CompanyEmail[] {
  return company.desk?.emails || (company.email ? [{ id: "legacy-primary", label: "Primary company email", address: company.email, primary: true }] : []);
}
/** Partner contacts are independent of legal ownership percentages and dated accounting history. */
export function companyPartnerContacts(company: Company): CompanyPartnerContact[] {
  return company.desk?.partnerContacts || company.members.map((member, index) => ({ id: member.id || `legacy-partner-${index}`, name: member.name, email: member.email || "", phone: member.phone || "" }));
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = (v: unknown) => text(v, 150) && /^[\w-]+$/.test(v as string);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const validRenewalDate = (v: string) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000") && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function validateCompanyDesk(value: unknown): CompanyDesk {
  if (!object(value) || !["logoDocumentId", "folders", "renewals"].every(key => Object.hasOwn(value, key)) || Object.keys(value).some(key => !["logoDocumentId", "folders", "renewals", "emails", "address", "domain", "website", "websiteNotNeeded", "partnerContacts"].includes(key)) || !text(value.logoDocumentId, 180) ||
      !Array.isArray(value.folders) || value.folders.length > 100 || !Array.isArray(value.renewals) || value.renewals.length > 3)
    throw new Error("Check the company logo, folders and renewal details.");
  for (const folder of value.folders) if (!object(folder) || !exact(folder, ["id", "name"]) || !id(folder.id) || !text(folder.name, 100) || !(folder.name as string).trim())
    throw new Error("Give each folder a name of up to 100 characters.");
  if (new Set(value.folders.map(f => f.id)).size !== value.folders.length || new Set(value.folders.map(f => f.name.trim().toLowerCase())).size !== value.folders.length)
    throw new Error("Use a different name for each company folder.");
  for (const r of value.renewals) if (!object(r) || !["service", "renewalOn", "provider", "reference"].every(key => Object.hasOwn(r, key)) || Object.keys(r).some(key => !["service", "renewalOn", "provider", "reference", "renewalYears"].includes(key)) ||
      !["Domain", "Email", "Website"].includes(r.service as string) || !text(r.renewalOn, 10) || !validRenewalDate(r.renewalOn as string) || !text(r.provider, 200) || !text(r.reference, 500) || r.renewalYears !== undefined && (!Number.isInteger(r.renewalYears) || Number(r.renewalYears) < 1 || Number(r.renewalYears) > 10))
    throw new Error("Check each service and its renewal date.");
  if (new Set(value.renewals.map(r => r.service)).size !== value.renewals.length) throw new Error("Record one renewal for each service.");
  if (value.emails !== undefined) {
    if (!Array.isArray(value.emails) || value.emails.length > 20) throw new Error("Use up to 20 company email addresses.");
    for (const email of value.emails) if (!object(email) || !exact(email, ["id", "label", "address", "primary"]) || !id(email.id) || !text(email.label, 100) || !text(email.address, 254) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(email.address)) || typeof email.primary !== "boolean") throw new Error("Give each company email a valid address and label.");
    if (new Set(value.emails.map(e => e.id)).size !== value.emails.length || new Set(value.emails.map(e => e.address.trim().toLowerCase())).size !== value.emails.length || value.emails.filter(e => e.primary).length !== (value.emails.length ? 1 : 0)) throw new Error("Choose one primary email and remove duplicate addresses.");
  }
  if (value.partnerContacts !== undefined) {
    if (!Array.isArray(value.partnerContacts) || value.partnerContacts.length > 100) throw new Error("Use up to 100 partner contacts per company.");
    for (const contact of value.partnerContacts) {
      if (!object(contact) || !exact(contact, ["id", "name", "email", "phone"]) || !id(contact.id) || !text(contact.name, 200) || !String(contact.name).trim() || !text(contact.email, 254) || contact.email !== "" && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(contact.email)) || !text(contact.phone, 60)) throw new Error("Give each partner a name and check any email address or phone number.");
    }
    if (new Set(value.partnerContacts.map(contact => contact.id)).size !== value.partnerContacts.length) throw new Error("Keep a separate identity for each partner contact.");
  }
  for (const field of ["address", "domain", "website"]) if (value[field] !== undefined && !text(value[field], field === "address" ? 500 : 300)) throw new Error("Check the company address, domain and website.");
  if (value.domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(value.domain))) throw new Error("Enter a domain such as company.com without a path.");
  if (value.website) { try { const url = new URL(String(value.website)); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { throw new Error("Enter a full company website beginning with https://."); } }
  if (value.websiteNotNeeded !== undefined && typeof value.websiteNotNeeded !== "boolean") throw new Error("Choose whether a website is needed.");
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
      if (!doc || doc.companyId !== c.id || doc.orderId || doc.category !== "Branding" || doc.visibility !== "Internal" || doc.archivedAt || !doc.assetId || !["image/png", "image/jpeg"].includes(doc.mime || ""))
        throw new Error("Choose an internal PNG or JPG logo from this company’s documents.");
    }
  }
  for (const doc of state.documents) if (doc.folderId !== undefined && doc.folderId !== "") {
    const c = state.companies.find(c => c.id === doc.companyId);
    if (!id(doc.folderId) || doc.orderId || !c || !companyDesk(c, state.documents).folders.some(f => f.id === doc.folderId))
      throw new Error("Choose a document folder belonging to this company.");
  }
}
export function companyWorkspaceShapeValid(state: Workspace) { try { validateCompanyWorkspace(state); return true; } catch { return false; } }
/** Once tracked, the maintenance ledger is the source of renewal dates and terms. */
export function companyServiceRenewals(state: Pick<Workspace, "agencyMaintenance"> | undefined, company: Company): ServiceRenewal[] {
  const legacy = companyDesk(company).renewals;
  return (["Domain", "Email", "Website"] as const).flatMap(service => {
    const saved = legacy.find(row => row.service === service);
    const record = state?.agencyMaintenance?.records.find(row => row.scope === "company" && row.companyId === company.id && row.kind === service);
    return record ? [{ service, renewalOn: record.nextDueOn, renewalYears: record.intervalYears, provider: saved?.provider || "", reference: saved?.reference || record.source }] : saved ? [saved] : [];
  });
}
export function nextServiceRenewal(company: Company, state?: Pick<Workspace, "agencyMaintenance">) {
  return companyServiceRenewals(state, company).filter(r => r.renewalOn && !(r.service === "Website" && company.desk?.websiteNotNeeded) && !state?.agencyMaintenance?.records.some(record => record.scope === "company" && record.companyId === company.id && record.kind === r.service && !record.active)).sort((a, b) => a.renewalOn.localeCompare(b.renewalOn))[0];
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
