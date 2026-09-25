import type { Access } from "../backend/workspace";
import type { Workspace, VaultDoc } from "./model";

/** Navigation affordance only; private intake and original reads enforce access again. */
export function canFillCompanyApplication(state: Pick<Workspace, "documents" | "companies">, doc: VaultDoc, connection?: { access: Access } | null): boolean {
  const access = connection?.access;
  return !!access && ["owner", "admin", "onboarding"].includes(access.role) && access.restricted &&
    (access.allCompanies || access.companyIds.includes(doc.companyId)) &&
    state.companies.some(company => company.id === doc.companyId) &&
    state.documents.some(current => current.id === doc.id && current.version === doc.version && current.assetId === doc.assetId && current.companyId === doc.companyId && current.category === doc.category && current.visibility === doc.visibility && current.orderId === doc.orderId && current.mime === doc.mime) &&
    !doc.orderId && doc.category === "Applications" && doc.visibility === "Restricted" && !!doc.assetId &&
    ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(doc.mime || "");
}
