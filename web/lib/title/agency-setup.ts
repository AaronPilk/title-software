import type { Company, Task, VaultDoc, Workspace } from "./model";
import { commandUuid, traceMutation } from "./command-log";
import { businessDay, isCalendarDay } from "./business-date";
import { companyEmails } from "./company-workspace";

export type AgencyTaskStatus = "Not Started" | "In Progress" | "Complete";
export type AgencyOwnerChoice = { memberId: string; kind: "individual" | "existing" | "new" };
export type AgencySetupConfiguration = { version: number; templateVersion: number; owners: AgencyOwnerChoice[]; agreementCount: 1 | 2; eoCovered: boolean };
export type AgencyDocumentRequirement = { categories: string[]; minimum: number; restricted: boolean };
export type AgencyTaskMetadata = {
  kind: "setup" | "maintenance"; key: string; revision: number; required: boolean; applicable: boolean;
  templateVersion?: number; itemId?: string; subject?: string;
  maintenanceId?: string; cycleOn?: string;
  documentRequirement?: AgencyDocumentRequirement;
};
export type AgencySetupCondition = "always" | "state" | "underwriter" | "individual" | "existing" | "new" | "website";
export type AgencySetupItem = { id: string; title: string; group: string; condition: AgencySetupCondition; required: boolean; documentRequirement?: AgencyDocumentRequirement };
export type AgencySetupTemplate = { version: number; name: string; createdAt: string; items: AgencySetupItem[] };
const categories = ["Applications", "Agreements", "Formation", "Company records", "Licensing", "Underwriters", "Insurance", "Banking", "Branding", "Disclosures", "Partner entities", "Other"];
const conditions: AgencySetupCondition[] = ["always", "state", "underwriter", "individual", "existing", "new", "website"];
export const agencyTaskStatuses: AgencyTaskStatus[] = ["Not Started", "In Progress", "Complete"];
function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameRecord(value, b[index]));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameRecord((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
export function agencyText(value: unknown, max: number, blank = true): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (!blank && !value.trim())) throw new Error("Check the text fields and their lengths.");
  return value.trim();
}
export function agencyId(value: unknown): string { const result = agencyText(value, 180, false); if (!/^[-A-Za-z0-9_ .:@]+$/.test(result)) throw new Error("Invalid record identity."); return result; }
export function agencyDate(value: unknown, blank = true): string { const result = agencyText(value, 10, blank); if (result && (result.startsWith("0000") || !isCalendarDay(result))) throw new Error("Choose a valid calendar date."); return result; }
export function agencyObject(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid agency record.");
  const row = value as Record<string, unknown>;
  if (Reflect.ownKeys(row).some(k => typeof k !== "string" || !allowed.includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(row, k)!, "value")) || required.some(k => !Object.hasOwn(row, k))) throw new Error("Invalid agency record fields.");
  return row;
}
export function agencyList<T>(value: unknown, max: number, parse: (v: unknown) => T): T[] { if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) throw new Error("Too many or invalid agency records."); return value.map(parse); }
export function agencyDocumentIds(value: unknown) { const ids = agencyList(value, 30, agencyId); if (new Set(ids).size !== ids.length) throw new Error("Link each document only once."); return ids; }
export function agencyRevision(value: unknown, zero = false): number { if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1) || Number(value) > 1000000) throw new Error("Invalid record version."); return Number(value); }
function documentRequirement(value: unknown): AgencyDocumentRequirement {
  const row = agencyObject(value, ["categories", "minimum", "restricted"]);
  const names = agencyList(row.categories, 12, v => { const n = agencyText(v, 80, false); if (!categories.includes(n)) throw new Error("Choose a supported document category."); return n; });
  if (!names.length || new Set(names).size !== names.length || !Number.isSafeInteger(row.minimum) || Number(row.minimum) < 1 || Number(row.minimum) > 10 || typeof row.restricted !== "boolean") throw new Error("Check the required original documents.");
  return { categories: names, minimum: Number(row.minimum), restricted: row.restricted };
}
function item(id: string, title: string, group: string, condition: AgencySetupCondition = "always", required = true, documentCategories?: string[], restricted = false): AgencySetupItem {
  return { id, title, group, condition, required, ...(documentCategories ? { documentRequirement: { categories: documentCategories, minimum: 1, restricted } } : {}) };
}
export const defaultAgencySetupTemplate = (): AgencySetupTemplate => ({ version: 1, name: "Phase One agency setup", createdAt: "2026-10-06T00:00:00.000Z", items: [
  item("welcome-sent", "Welcome letter and JV application sent", "Application & agreements"),
  item("application-original", "Completed welcome letter and JV application uploaded", "Application & agreements", "always", true, ["Applications"], true),
  item("agreements-sent", "JV / operating agreement(s) prepared and sent", "Application & agreements"),
  item("agreements-original", "Executed governing agreement(s) uploaded", "Application & agreements", "always", true, ["Agreements"], true),
  item("owner-private", "Required owner information saved privately", "Ownership entities", "individual"),
  item("owner-status", "Existing ownership entity status verified", "Ownership entities", "existing"),
  item("owner-formation", "Existing ownership entity SOS original uploaded", "Ownership entities", "existing", true, ["Formation", "Company records", "Partner entities"], true),
  item("owner-tax", "Existing entity Tax ID stored privately", "Ownership entities", "existing"),
  item("owner-llc-authorization", "Authorization to form owner LLC uploaded", "Ownership entities", "new", true, ["Formation", "Company records", "Partner entities"], true),
  item("owner-ein-authorization", "Authorization to obtain owner EIN uploaded", "Ownership entities", "new", true, ["Formation", "Company records", "Partner entities"], true),
  item("owner-new-formation", "Owner LLC SOS filing original uploaded", "Ownership entities", "new", true, ["Formation", "Company records", "Partner entities"], true),
  item("owner-new-tax", "Owner LLC EIN obtained and stored privately", "Ownership entities", "new"),
  item("formation", "Title company SOS filing original uploaded", "Company formation", "always", true, ["Formation"], true),
  item("ein", "Title company EIN stored privately and IRS confirmation uploaded", "Company formation", "always", true, ["Formation", "Company records", "Partner entities"], true),
  item("domain", "Domain purchased and entered", "Brand, website & email"),
  item("email-purchased", "Business email accounts purchased", "Brand, website & email"),
  item("missive", "Business email configured in Missive", "Brand, website & email"),
  item("primary-email", "Primary company email entered and active", "Brand, website & email"),
  item("additional-email", "Additional email addresses entered, if applicable", "Brand, website & email", "always", false),
  item("logo", "Primary logo completed and uploaded", "Brand, website & email", "always", true, ["Branding"]),
  item("marketing", "Additional marketing files stored, if needed", "Brand, website & email", "always", false),
  item("signature", "Email signature graphics uploaded", "Brand, website & email", "always", true, ["Branding"]),
  item("cards", "Business cards uploaded, if needed", "Brand, website & email", "always", false, ["Branding"]),
  item("website", "Website completed and URL entered", "Brand, website & email", "website"),
  item("aba", "Affiliated Business Arrangement Disclosure uploaded", "Disclosures & forms", "always", true, ["Disclosures"]),
  item("buyer", "Buyer Title Preference Form uploaded", "Disclosures & forms", "always", true, ["Disclosures"]),
  item("license-submitted", "DOI / NIPR application submitted externally", "Licensing", "state"),
  item("license-approved", "Agency license approved and effective date recorded", "Licensing", "state"),
  item("license-original", "Agency license original uploaded", "Licensing", "state", true, ["Licensing"]),
  item("license-renewal", "Agency license renewal schedule verified", "Licensing", "state"),
  item("eo-coverage", "Company added to agency E&O policy", "E&O insurance"),
  item("eo-original", "E&O confirmation uploaded, if available", "E&O insurance", "always", false, ["Insurance", "Company records"]),
  item("underwriter-submitted", "Agency application submitted externally", "Underwriter approvals", "underwriter"),
  item("underwriter-approved", "Agency approval received", "Underwriter approvals", "underwriter"),
  item("underwriter-original", "Agency approval original uploaded", "Underwriter approvals", "underwriter", true, ["Underwriters", "Licensing", "Agreements"]),
  item("bank", "Business bank account established; confirmation recorded", "Banking & accounting"),
  item("payment", "Company payment method established", "Banking & accounting"),
  item("softpro", "SoftPro company buildout completed", "Banking & accounting"),
  item("quickbooks", "QuickBooks setup (may be deferred until revenue)", "Banking & accounting", "always", false),
] });
export function agencySetupTemplates(state: Workspace) { return state.agencySetupTemplates?.length ? state.agencySetupTemplates : [defaultAgencySetupTemplate()]; }
export function latestAgencySetupTemplate(state: Workspace) { return agencySetupTemplates(state).at(-1)!; }
export function validateAgencySetupTemplate(value: unknown): AgencySetupTemplate {
  const row = agencyObject(value, ["version", "name", "createdAt", "items"]);
  const parsed = agencyList(row.items, 150, v => { const r = agencyObject(v, ["id", "title", "group", "condition", "required", "documentRequirement"], ["id", "title", "group", "condition", "required"]); if (!conditions.includes(r.condition as AgencySetupCondition) || typeof r.required !== "boolean") throw new Error("Check the task condition and requirement."); return { id: agencyId(r.id), title: agencyText(r.title, 220, false), group: agencyText(r.group, 80, false), condition: r.condition as AgencySetupCondition, required: r.required, ...(r.documentRequirement ? { documentRequirement: documentRequirement(r.documentRequirement) } : {}) }; });
  if (!parsed.length || new Set(parsed.map(i => i.id)).size !== parsed.length) throw new Error("Give each template task a unique identity.");
  const createdAt = agencyText(row.createdAt, 24, false); if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw new Error("Invalid template date.");
  return { version: agencyRevision(row.version), name: agencyText(row.name, 120, false), createdAt, items: parsed };
}
export function validateAgencySetupConfiguration(value: unknown): AgencySetupConfiguration {
  const row = agencyObject(value, ["version", "templateVersion", "owners", "agreementCount", "eoCovered"]);
  const owners = agencyList(row.owners, 40, value => { const v = agencyObject(value, ["memberId", "kind"]); if (!["individual", "existing", "new"].includes(String(v.kind))) throw new Error("Choose individual, existing entity or new entity."); return { memberId: agencyId(v.memberId), kind: v.kind as AgencyOwnerChoice["kind"] }; });
  if (new Set(owners.map(o => o.memberId)).size !== owners.length || ![1, 2].includes(Number(row.agreementCount)) || typeof row.agreementCount !== "number" || typeof row.eoCovered !== "boolean") throw new Error("Check ownership choices and governing agreements.");
  return { version: agencyRevision(row.version), templateVersion: agencyRevision(row.templateVersion), owners, agreementCount: row.agreementCount as 1 | 2, eoCovered: row.eoCovered };
}
export function eligibleAgencyTaskDocuments(state: Workspace, task: Pick<Task, "companyId" | "phaseOne">): VaultDoc[] {
  const requirement = task.phaseOne?.documentRequirement;
  return state.documents.filter(d => (!task.companyId || d.companyId === task.companyId) && !d.orderId && !!d.assetId && !d.archivedAt && d.visibility !== "Partner" && (!requirement || requirement.categories.includes(d.category) && (!requirement.restricted || d.visibility === "Restricted")));
}
/** Only this generated task follows application uploads automatically. Other document links retain their history. */
export function isAutomaticApplicationTask(task: Task, companyId: string): boolean {
  const meta = task.phaseOne, requirement = meta?.documentRequirement;
  return task.companyId === companyId && task.scope === "agency" && meta?.kind === "setup" && meta.applicable && meta.itemId === "application-original" && meta.key === `setup:${companyId}:application-original:` && meta.subject === "" && requirement?.minimum === 1 && requirement.restricted && requirement.categories.length === 1 && requirement.categories[0] === "Applications";
}
export function agencyTaskDocumentProblem(state: Workspace, task: Task, ids = task.documentIds || []): string {
  const eligible = eligibleAgencyTaskDocuments(state, task);
  if (ids.some(id => !eligible.some(d => d.id === id))) return "Choose available originals belonging to this company and the required category/access level.";
  const required = task.phaseOne?.documentRequirement?.minimum || 0;
  return ids.length < required ? `Link ${required} required original document${required === 1 ? "" : "s"} before completing this task.` : "";
}
export function agencyTaskCompletionProblem(state: Workspace, task: Task): string {
  const problem = agencyTaskDocumentProblem(state, task); if (problem) return problem;
  const company = state.companies.find(c => c.id === task.companyId);
  if (task.phaseOne?.itemId === "domain" && (!company?.desk?.domain || company.desk.domain.length > 300 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(company.desk.domain))) return "Save a valid company domain in Overview before completing this task.";
  if (task.phaseOne?.itemId === "primary-email") {
    const primary = company ? companyEmails(company).filter(email => email.primary) : [];
    if (primary.length !== 1 || primary[0].address.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(primary[0].address)) return "Save one valid primary company email in Overview before completing this task.";
  }
  if (task.phaseOne?.itemId === "website") {
    try { const url = new URL(company?.desk?.website || ""); if ((company?.desk?.website?.length || 0) > 300 || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { return "Save a full company website URL in Overview, or mark a website as not needed and refresh the checklist."; }
  }
  if (task.phaseOne?.itemId === "eo-coverage" && !state.companies.find(c => c.id === task.companyId)?.agencySetup?.eoCovered) return "Confirm company E&O coverage in setup choices first.";
  if (task.phaseOne?.itemId === "license-approved" && !task.effectiveOn) return "Enter the license approval / effective date.";
  if (task.phaseOne?.itemId === "license-renewal" && !state.agencyMaintenance?.records.some(r => r.companyId === task.companyId && r.kind === `${task.phaseOne!.subject} agency license` && r.active && r.nextDueOn && r.source && r.verifiedOn)) return "Save and verify the applicable license renewal in Recurring maintenance first.";
  return "";
}
function setupCompany(state: Workspace, companyId: string) { agencyId(companyId); const c = state.companies.find(c => c.id === companyId); if (!c) throw new Error("The company is unavailable."); return c; }
function subjects(state: Workspace, company: Company, definition: AgencySetupItem): string[] {
  if (definition.condition === "state") return (company.operatingStates || [company.jurisdiction]).filter(s => ["NC", "SC"].includes(s));
  if (definition.condition === "underwriter") return state.business?.onboarding.find(c => c.companyId === company.id)?.requiredUnderwriters || [];
  if (["individual", "existing", "new"].includes(definition.condition)) return company.agencySetup?.owners.filter(o => o.kind === definition.condition).map(o => o.memberId) || [];
  if (definition.condition === "website" && company.desk?.websiteNotNeeded) return [];
  return [""];
}
export type ConfigureAgencySetupInput = { companyId: string; expectedVersion: number; templateVersion: number; owners: AgencyOwnerChoice[]; agreementCount: 1 | 2; eoCovered: boolean };
export function configureAgencySetup(state: Workspace, input: ConfigureAgencySetupInput) {
  return traceMutation(state, "configureAgencySetup", [input], () => {
    agencyObject(input, ["companyId", "expectedVersion", "templateVersion", "owners", "agreementCount", "eoCovered"]);
    const company = setupCompany(state, input.companyId);
    if ((company.agencySetup?.version || 0) !== agencyRevision(input.expectedVersion, true)) throw new Error("Setup choices changed. Reopen the editor.");
    const config = validateAgencySetupConfiguration({ version: input.expectedVersion + 1, templateVersion: input.templateVersion, owners: input.owners, agreementCount: input.agreementCount, eoCovered: input.eoCovered });
    if (!agencySetupTemplates(state).some(t => t.version === config.templateVersion) || config.owners.some(o => !company.members.some(m => m.id === o.memberId))) throw new Error("Choose current company members and an available setup template.");
    company.agencySetup = config; syncAgencySetup(state, company.id);
  });
}
export function saveAgencySetupTemplate(state: Workspace, input: { expectedVersion: number; name: string; items: AgencySetupItem[] }) {
  return traceMutation(state, "saveAgencySetupTemplate", [input], () => {
    agencyObject(input, ["expectedVersion", "name", "items"]);
    if (latestAgencySetupTemplate(state).version !== agencyRevision(input.expectedVersion)) throw new Error("The template changed. Reload before editing it.");
    const next = validateAgencySetupTemplate({ version: input.expectedVersion + 1, name: input.name, createdAt: new Date().toISOString(), items: input.items });
    if (agencySetupTemplates(state).length >= 100) throw new Error("The setup template history has reached its limit.");
    state.agencySetupTemplates = [...agencySetupTemplates(state), next];
  });
}
export function syncAgencySetup(state: Workspace, companyId: string) {
  return traceMutation(state, "syncAgencySetup", [companyId], () => {
    const company = setupCompany(state, companyId), config = company.agencySetup; if (!config) return;
    const template = agencySetupTemplates(state).find(t => t.version === config.templateVersion); if (!template) throw new Error("The configured setup template is unavailable.");
    const active = new Set<string>();
    for (const definition of template.items) for (const subject of subjects(state, company, definition)) {
      const key = `setup:${company.id}:${definition.id}:${subject}`; active.add(key);
      let task = state.tasks.find(t => t.phaseOne?.key === key);
      if (!task && definition.id === "application-original") task = state.tasks.find(t => t.companyId === company.id && !t.phaseOne && t.scope !== "production" && /^Collect onboarding application$/i.test(t.title));
      const title = subject ? `${company.members.find(m => m.id === subject)?.name || subject}: ${definition.title}` : definition.title;
      const requirement = definition.documentRequirement ? { ...structuredClone(definition.documentRequirement), minimum: definition.id === "agreements-original" ? config.agreementCount : definition.documentRequirement.minimum } : undefined;
      const meta: AgencyTaskMetadata = { kind: "setup", key, revision: task?.phaseOne?.revision || 1, required: definition.required, applicable: true, templateVersion: template.version, itemId: definition.id, subject, ...(requirement ? { documentRequirement: requirement } : {}) };
      if (!task) { task = { id: `task-${commandUuid()}`, title, companyId, scope: "agency", owner: "", due: "", done: false, status: "Not Started", completedOn: "", notes: "", documentIds: [], priority: "Normal", createdAt: businessDay(), phaseOne: meta }; state.tasks.push(task); }
      else { const changed = task.title !== title || !sameRecord(task.phaseOne, meta); if (changed) meta.revision++; task.title = title; task.scope = "agency"; task.phaseOne = meta; task.status ||= task.done ? "Complete" : "Not Started"; task.completedOn ||= ""; task.notes ||= ""; task.documentIds ||= []; }
      if (definition.id === "application-original") {
        const originals = eligibleAgencyTaskDocuments(state, task);
        if (originals.length) { const nextIds = originals.map(d => d.id).slice(0, 30); if (!task.done || JSON.stringify(task.documentIds) !== JSON.stringify(nextIds)) task.phaseOne!.revision++; task.documentIds = nextIds; task.done = true; task.status = "Complete"; task.completedOn ||= originals.map(d => d.date).find(d => isCalendarDay(d)) || businessDay(); }
        else if (isAutomaticApplicationTask(task, companyId) && (task.documentIds?.length || task.done)) { task.documentIds = []; task.done = false; task.status = "Not Started"; task.completedOn = ""; task.phaseOne!.revision++; }
      }
      if (task.done && agencyTaskCompletionProblem(state, task)) { task.done = false; task.status = "In Progress"; task.completedOn = ""; task.phaseOne!.revision++; }
    }
    for (const task of state.tasks.filter(t => t.companyId === companyId && t.phaseOne?.kind === "setup")) if (task.phaseOne!.applicable !== active.has(task.phaseOne!.key)) { task.phaseOne!.applicable = active.has(task.phaseOne!.key); task.phaseOne!.revision++; }
  });
}
export type UpdateAgencyTaskInput = { taskId: string; expectedRevision: number; status: AgencyTaskStatus; due: string; completedOn: string; effectiveOn?: string; notes: string; documentIds: string[]; owner: string; assigneeId?: string };
export function updateAgencyTask(state: Workspace, input: UpdateAgencyTaskInput) {
  return traceMutation(state, "updateAgencyTask", [input], () => {
    agencyObject(input, ["taskId", "expectedRevision", "status", "due", "completedOn", "effectiveOn", "notes", "documentIds", "owner", "assigneeId"], ["taskId", "expectedRevision", "status", "due", "completedOn", "notes", "documentIds", "owner"]);
    const task = state.tasks.find(t => t.id === agencyId(input.taskId));
    if (!task?.phaseOne || !task.phaseOne.applicable || task.phaseOne.revision !== agencyRevision(input.expectedRevision)) throw new Error("This task changed or no longer applies. Reload before saving.");
    const maintenanceRecord = task.phaseOne.kind === "maintenance" ? state.agencyMaintenance?.records.find(r => r.id === task.phaseOne!.maintenanceId) : undefined;
    if (task.phaseOne.kind === "maintenance" && (!maintenanceRecord || !maintenanceRecord.active || maintenanceRecord.nextDueOn !== task.phaseOne.cycleOn)) throw new Error("The renewal cycle changed. Reload before saving.");
    if (task.phaseOne.kind === "maintenance" && (input.status === "Complete" || task.done || input.due !== task.due)) throw new Error("Use the maintenance record to complete or reschedule this recurring task.");
    if (!agencyTaskStatuses.includes(input.status)) throw new Error("Choose a valid task status.");
    const due = agencyDate(input.due), completedOn = agencyDate(input.completedOn), notes = agencyText(input.notes, 4000), documentIds = agencyDocumentIds(input.documentIds), owner = agencyText(input.owner, 200), assigneeId = input.assigneeId ? agencyId(input.assigneeId) : undefined;
    if (input.status === "Complete" && (!completedOn || completedOn > businessDay())) throw new Error("Record a completion date through today.");
    if (input.status !== "Complete" && completedOn) throw new Error("A completion date belongs only to a completed task.");
    const problem = agencyTaskDocumentProblem(state, task, documentIds); if (documentIds.some(id => !eligibleAgencyTaskDocuments(state, task).some(d => d.id === id)) || input.status === "Complete" && problem) throw new Error(problem);
    const effectiveOn = agencyDate(input.effectiveOn === undefined ? task.effectiveOn || "" : input.effectiveOn);
    const completionProblem = agencyTaskCompletionProblem(state, { ...task, documentIds, effectiveOn });
    if (input.status === "Complete" && completionProblem) throw new Error(completionProblem);
    Object.assign(task, { status: input.status, done: input.status === "Complete", due, completedOn, notes, documentIds, owner }); if (assigneeId) task.assigneeId = assigneeId; else delete task.assigneeId; task.phaseOne!.revision++;
    if (input.effectiveOn !== undefined || task.effectiveOn !== undefined) task.effectiveOn = effectiveOn;
    if (maintenanceRecord) { maintenanceRecord.revision++; maintenanceRecord.owner = owner; if (assigneeId) maintenanceRecord.assigneeId = assigneeId; else delete maintenanceRecord.assigneeId; }
  });
}
export function agencySetupReadiness(state: Workspace, companyId: string) {
  const company = state.companies.find(c => c.id === companyId), config = company?.agencySetup;
  const tasks = state.tasks.filter(t => t.companyId === companyId && t.phaseOne?.kind === "setup" && t.phaseOne.applicable);
  const missing = tasks.filter(t => t.phaseOne!.required && (!t.done || !!agencyTaskCompletionProblem(state, t)));
  const configurationProblems: string[] = [];
  if (!config) configurationProblems.push("Configure the applicable setup checklist.");
  if (company && (!company.members.length || Math.abs(company.members.reduce((total, member) => total + member.share, 0) - 100) > 0.001)) configurationProblems.push("Record the owners with ownership percentages totaling 100%.");
  if (company && config) {
    const template = agencySetupTemplates(state).find(t => t.version === config.templateVersion);
    const expectedKeys = template?.items.flatMap(i => subjects(state, company, i).map(subject => `setup:${company.id}:${i.id}:${subject}`)) || [];
    if (!expectedKeys.length || tasks.length !== expectedKeys.length || expectedKeys.some(key => !tasks.some(t => t.phaseOne?.key === key))) configurationProblems.push("Refresh applicable tasks after changing company selections.");
  }
  if (company && config && company.members.some(m => !m.id || !config.owners.some(o => o.memberId === m.id))) configurationProblems.push("Choose individual, existing entity or new entity for each owner.");
  if (company && !(company.operatingStates || [company.jurisdiction]).some(s => ["NC", "SC"].includes(s))) configurationProblems.push("Select the company's operating state(s).");
  if (!(state.business?.onboarding.find(c => c.companyId === companyId)?.requiredUnderwriters || []).length) configurationProblems.push("Select the company's underwriter(s).");
  return { tasks, missing, configurationProblems, ready: !!config && tasks.length > 0 && !missing.length && !configurationProblems.length };
}
const activationCommands = new WeakMap<Workspace, Set<string>>();
/** Only the explicit activation transition can authorize the separate Agency readiness path. */
export function agencyActivationAuthorized(state: Workspace, companyId: string) {
  return !!activationCommands.get(state)?.has(companyId) && agencySetupReadiness(state, companyId).ready;
}
export function activateAgencyCompany(state: Workspace, input: { companyId: string; expectedVersion: number }) {
  return traceMutation(state, "activateAgencyCompany", [input], () => {
    agencyObject(input, ["companyId", "expectedVersion"]); const company = setupCompany(state, input.companyId);
    if (company.agencySetup?.version !== agencyRevision(input.expectedVersion)) throw new Error("Setup choices changed. Reload before activating.");
    syncAgencySetup(state, company.id); if (!agencySetupReadiness(state, company.id).ready) throw new Error("Complete the applicable required setup tasks and originals before activating.");
    company.stage = "Active";
    const authorized = activationCommands.get(state) || new Set<string>(); authorized.add(company.id); activationCommands.set(state, authorized);
  });
}
export function validateAgencySetup(state: Workspace) {
  const templates = agencyList(agencySetupTemplates(state), 100, validateAgencySetupTemplate);
  if (new Set(templates.map(t => t.version)).size !== templates.length || templates.some((t, i) => i > 0 && t.version <= templates[i - 1].version)) throw new Error("Keep the setup template version history in order.");
  for (const company of state.companies) if (company.agencySetup) { const config = validateAgencySetupConfiguration(company.agencySetup); if (!templates.some(t => t.version === config.templateVersion) || config.owners.some(o => !company.members.some(m => m.id === o.memberId))) throw new Error("Setup refers to an unavailable owner or template."); }
  const keys = new Set<string>();
  for (const task of state.tasks) if (task.phaseOne) {
    const r = agencyObject(task.phaseOne, ["kind", "key", "revision", "required", "applicable", "templateVersion", "itemId", "subject", "maintenanceId", "cycleOn", "documentRequirement"], ["kind", "key", "revision", "required", "applicable"]);
    if (!["setup", "maintenance"].includes(String(r.kind)) || typeof r.required !== "boolean" || typeof r.applicable !== "boolean" || task.scope !== "agency") throw new Error("Invalid agency task scope.");
    const key = agencyText(r.key, 600, false); if (keys.has(key)) throw new Error("Duplicate agency task identity."); keys.add(key); agencyRevision(r.revision);
    if (r.documentRequirement) documentRequirement(r.documentRequirement);
    if (!agencyTaskStatuses.includes(task.status!) || task.done !== (task.status === "Complete")) throw new Error("Keep task status and completion in agreement.");
    agencyDate(task.due); agencyDate(task.completedOn || ""); agencyDate(task.effectiveOn || ""); agencyText(task.notes || "", 4000); agencyDocumentIds(task.documentIds || []);
    if (task.status !== "Complete" && task.completedOn) throw new Error("Only completed tasks can have a completion date.");
    if (task.phaseOne.kind === "setup") {
      const company = state.companies.find(c => c.id === task.companyId), template = templates.find(t => t.version === task.phaseOne!.templateVersion), definition = template?.items.find(i => i.id === task.phaseOne!.itemId);
      if (!company || !definition || key !== `setup:${company.id}:${definition.id}:${task.phaseOne.subject || ""}` || r.maintenanceId !== undefined || r.cycleOn !== undefined) throw new Error("Invalid setup task references.");
      const expectedRequirement = definition.documentRequirement ? { ...definition.documentRequirement, minimum: definition.id === "agreements-original" && task.phaseOne.applicable ? company.agencySetup?.agreementCount || 1 : definition.documentRequirement.minimum } : undefined;
      if (task.phaseOne.required !== definition.required || task.phaseOne.applicable && (company.agencySetup?.templateVersion !== task.phaseOne.templateVersion || !subjects(state, company, definition).includes(task.phaseOne.subject || "") || !sameRecord(task.phaseOne.documentRequirement, expectedRequirement))) throw new Error("Setup task requirements must match the selected template and company choices.");
    }
    if ((task.documentIds || []).some(id => !eligibleAgencyTaskDocuments(state, task).some(d => d.id === id))) throw new Error("Agency task documents must be available originals in the same company.");
    if (task.phaseOne.applicable && task.done && agencyTaskDocumentProblem(state, task)) throw new Error("Completed agency tasks require their linked originals.");
  }
}
