import type { Company, Mail, Task, VaultDoc, Workspace } from "./model";
import { companyDisplayStage } from "./company-operating-status";

/** Account capability; choosing a workspace view never changes this boundary. */
export const productionOnlyRole = (role?: string) => role === "operations";

/** Only the business identity needed to route production work leaves the server. */
export function productionCompany(company: Company): Company {
  return {
    id: company.id,
    name: company.name,
    initials: company.initials,
    color: company.color,
    location: company.location,
    jurisdiction: company.jurisdiction,
    ...(company.operatingStates ? { operatingStates: [...company.operatingStates] } : {}),
    stage: companyDisplayStage(company),
    contact: "",
    email: "",
    steps: [],
    members: [],
  };
}

function productionFile(state: Workspace, record: { companyId?: string; orderId?: string }) {
  return !!record.orderId && state.orders.some(order => order.id === record.orderId &&
    (!record.companyId || order.companyId === record.companyId));
}

// Company records remain agency records even if an old upload linked them to a file.
const agencyDocumentCategories = new Set(["Applications", "Formation", "Company records", "Branding", "Agreements"]);
export function productionDocument(state: Workspace, document: VaultDoc) {
  return productionFile(state, document) && !agencyDocumentCategories.has(document.category);
}

export function productionMessage(state: Workspace, message: Mail) {
  return message.kind !== "Company" && productionFile(state, message);
}

export function productionTask(state: Workspace, task: Task) {
  if (task.scope === "agency") return false;
  // These identities are produced by file workflows; free-form titles and
  // assignments alone cannot establish that a legacy task is safe to disclose.
  if (task.id.startsWith("auto-rejected-")) return state.orders.some(order => order.companyId === task.companyId && task.id === `auto-rejected-${order.id}`);
  if (task.id.startsWith("task-followup-")) return !!state.business?.followups.some(followup => task.id === `task-${followup.id}` &&
    followup.companyId === task.companyId && productionFile(state, followup));
  return task.scope === "production";
}
