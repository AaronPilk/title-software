import type { Task, Workspace } from "./model";
import { commandUuid, traceMutation } from "./command-log";
import { businessDay, dayNumber } from "./business-date";
import { agencyDate, agencyDocumentIds, agencyId, agencyList, agencyObject, agencyRevision, agencyTaskDocumentProblem, agencyText, eligibleAgencyTaskDocuments } from "./agency-setup";
export const agencyMaintenanceKinds = ["Annual report", "Good standing", "Domain", "Email", "Website", "NC agency license", "SC agency license", "Agency E&O", "Agency credential"] as const;
export type AgencyMaintenanceKind = typeof agencyMaintenanceKinds[number];
export type AgencyMaintenanceRecord = {
  id: string; revision: number; scope: "company" | "entity" | "agency"; companyId: string; memberId: string;
  kind: AgencyMaintenanceKind; title: string; active: boolean; nextDueOn: string; intervalYears: number;
  schedule: "anniversary" | "nc-april" | "sc-even-january" | "september";
  source: string; verifiedOn: string; notes: string; owner: string; assigneeId?: string; documentIds: string[];
  standing: "Unknown" | "Current" | "Delinquent" | "Inactive" | "Dissolved" | "Suspended";
};
export type AgencyMaintenanceCompletion = { id: string; maintenanceId: string; taskId: string; cycleOn: string; completedOn: string; nextDueOn: string; notes: string; documentIds: string[]; actor: string };
export type AgencyMaintenanceState = { records: AgencyMaintenanceRecord[]; history: AgencyMaintenanceCompletion[]; notifications?: { enabled: boolean; recipient: string; leadDays: 14 } };
export const maintenanceState = (state: Workspace): AgencyMaintenanceState => state.agencyMaintenance || { records: [], history: [], notifications: { enabled: false, recipient: "", leadDays: 14 } };
export const defaultMaintenanceNotifications = () => ({ enabled: false, recipient: "", leadDays: 14 as const });
const recordKey = (record: Pick<AgencyMaintenanceRecord, "scope" | "companyId" | "memberId" | "kind">) => `${record.scope}:${record.companyId}:${record.memberId}:${record.kind}`;
export function validateAgencyMaintenanceRecord(value: unknown): AgencyMaintenanceRecord {
  const keys = ["id", "revision", "scope", "companyId", "memberId", "kind", "title", "active", "nextDueOn", "intervalYears", "schedule", "source", "verifiedOn", "notes", "owner", "assigneeId", "documentIds", "standing"];
  const r = agencyObject(value, keys, keys.filter(k => k !== "assigneeId"));
  if (!["company", "entity", "agency"].includes(String(r.scope)) || !agencyMaintenanceKinds.includes(r.kind as AgencyMaintenanceKind) || typeof r.active !== "boolean" || !Number.isSafeInteger(r.intervalYears) || Number(r.intervalYears) < 1 || Number(r.intervalYears) > 10 || !["anniversary", "nc-april", "sc-even-january", "september"].includes(String(r.schedule)) || !["Unknown", "Current", "Delinquent", "Inactive", "Dissolved", "Suspended"].includes(String(r.standing))) throw new Error("Check the maintenance type, schedule and status.");
  const record: AgencyMaintenanceRecord = { id: agencyId(r.id), revision: agencyRevision(r.revision), scope: r.scope as AgencyMaintenanceRecord["scope"], companyId: r.companyId === "" ? "" : agencyId(r.companyId), memberId: r.memberId === "" ? "" : agencyId(r.memberId), kind: r.kind as AgencyMaintenanceKind, title: agencyText(r.title, 220, false), active: r.active, nextDueOn: agencyDate(r.nextDueOn), intervalYears: Number(r.intervalYears), schedule: r.schedule as AgencyMaintenanceRecord["schedule"], source: agencyText(r.source, 1000), verifiedOn: agencyDate(r.verifiedOn), notes: agencyText(r.notes, 4000), owner: agencyText(r.owner, 200), documentIds: agencyDocumentIds(r.documentIds), standing: r.standing as AgencyMaintenanceRecord["standing"], ...(r.assigneeId ? { assigneeId: agencyId(r.assigneeId) } : {}) };
  if (record.scope === "agency" ? !!record.companyId || !!record.memberId || !["Agency E&O", "Agency credential"].includes(record.kind) : !record.companyId || ["Agency E&O", "Agency credential"].includes(record.kind) || (record.scope === "company" ? !!record.memberId : !record.memberId || !["Annual report", "Good standing"].includes(record.kind))) throw new Error("Keep agency, company and ownership entity schedules separate.");
  if (record.schedule === "nc-april" && (record.kind !== "NC agency license" || record.intervalYears !== 1 || record.nextDueOn && !record.nextDueOn.endsWith("-04-01")) || record.schedule === "sc-even-january" && (record.kind !== "SC agency license" || record.intervalYears !== 2 || record.nextDueOn && (!record.nextDueOn.endsWith("-01-01") || Number(record.nextDueOn.slice(0, 4)) % 2 !== 0)) || record.schedule === "september" && (record.kind !== "Agency E&O" || record.intervalYears !== 1 || record.nextDueOn && record.nextDueOn.slice(5, 7) !== "09")) throw new Error("The date must match its verified renewal schedule.");
  if (["NC agency license", "SC agency license"].includes(record.kind) && (!record.source || !record.verifiedOn)) throw new Error("Record the regulator or renewal notice source and verification date.");
  return record;
}
function references(state: Workspace, record: AgencyMaintenanceRecord) {
  if (record.scope !== "agency") { const company = state.companies.find(c => c.id === record.companyId); if (!company || record.scope === "entity" && !company.members.some(m => m.id === record.memberId)) throw new Error("Choose an existing company and ownership entity."); if (record.scope === "entity" && company.agencySetup?.owners.some(o => o.memberId === record.memberId && o.kind === "individual")) throw new Error("An individual owner does not need entity annual-report maintenance."); if (record.active && (record.kind === "NC agency license" && !(company.operatingStates || [company.jurisdiction]).includes("NC") || record.kind === "SC agency license" && !(company.operatingStates || [company.jurisdiction]).includes("SC"))) throw new Error("Pause this license schedule before removing its operating state."); }
  const eligible = eligibleAgencyTaskDocuments(state, { companyId: record.companyId }); if (record.documentIds.some(id => !eligible.some(d => d.id === id))) throw new Error("Choose current originals belonging to this maintenance record's company.");
}
export function nextMaintenanceDate(record: Pick<AgencyMaintenanceRecord, "nextDueOn" | "intervalYears" | "schedule">): string {
  const date = agencyDate(record.nextDueOn, false), year = Number(date.slice(0, 4)) + record.intervalYears;
  let candidate = `${year}${date.slice(4)}`;
  if (record.schedule === "nc-april") candidate = `${year}-04-01`;
  if (record.schedule === "sc-even-january") candidate = `${year + year % 2}-01-01`;
  const parsed = new Date(`${candidate}T00:00:00Z`); if (parsed.toISOString().slice(0, 10) !== candidate) candidate = `${year}-02-28`;
  return agencyDate(candidate, false);
}
export function upcomingMaintenance(state: Workspace, asOfDate = businessDay(), horizonDays = 14) {
  const day = agencyDate(asOfDate, false); if (!Number.isInteger(horizonDays) || horizonDays < 0 || horizonDays > 366) throw new Error("Choose a maintenance window up to one year.");
  return maintenanceState(state).records.filter(r => r.active && r.nextDueOn && dayNumber(r.nextDueOn) - dayNumber(day) <= horizonDays).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn)).map(record => ({ ...record, daysUntilDue: dayNumber(record.nextDueOn) - dayNumber(day), overdue: record.nextDueOn < day }));
}
export function saveAgencyMaintenance(state: Workspace, input: { expectedRevision: number; record: AgencyMaintenanceRecord }) {
  return traceMutation(state, "saveAgencyMaintenance", [input], () => {
    agencyObject(input, ["expectedRevision", "record"]); const expected = agencyRevision(input.expectedRevision, true), record = validateAgencyMaintenanceRecord(input.record), previous = maintenanceState(state).records.find(r => r.id === record.id);
    if ((previous?.revision || 0) !== expected || record.revision !== expected + 1) throw new Error("The maintenance record changed. Reload before saving.");
    if (previous && recordKey(previous) !== recordKey(record)) throw new Error("Keep the maintenance record's company, entity and type. Pause it and add a separate record if needed.");
    if (maintenanceState(state).records.some(r => r.id !== record.id && recordKey(r) === recordKey(record))) throw new Error("This renewal is already tracked. Edit its existing record.");
    if (record.active && record.nextDueOn && maintenanceState(state).history.some(h => h.maintenanceId === record.id && h.cycleOn === record.nextDueOn)) throw new Error("That renewal cycle is already complete. Choose the next outstanding renewal date.");
    if (!previous && maintenanceState(state).records.length >= 10000) throw new Error("The maintenance record limit has been reached.");
    references(state, record);
    const current = maintenanceState(state); state.agencyMaintenance = { ...current, records: [...current.records.filter(r => r.id !== record.id), record] };
    for (const task of state.tasks.filter(t => t.phaseOne?.maintenanceId === record.id && !t.done)) {
      const applicable = record.active && task.phaseOne!.cycleOn === record.nextDueOn;
      const changed = task.phaseOne!.applicable !== applicable || applicable && (task.title !== record.title || task.owner !== record.owner || task.assigneeId !== record.assigneeId);
      task.phaseOne!.applicable = applicable;
      if (applicable) { task.title = record.title; task.owner = record.owner; if (record.assigneeId) task.assigneeId = record.assigneeId; else delete task.assigneeId; }
      if (changed) task.phaseOne!.revision++;
    }
  });
}
export function saveAgencyMaintenanceNotifications(state: Workspace, input: { expected: { enabled: boolean; recipient: string; leadDays: 14 }; enabled: boolean; recipient: string }) {
  return traceMutation(state, "saveAgencyMaintenanceNotifications", [input], () => {
    agencyObject(input, ["expected", "enabled", "recipient"]); const current = maintenanceState(state), settings = current.notifications || defaultMaintenanceNotifications();
    if (JSON.stringify(input.expected) !== JSON.stringify(settings)) throw new Error("Reminder settings changed. Reload before saving.");
    const recipient = agencyText(input.recipient, 254); if (typeof input.enabled !== "boolean" || recipient && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || input.enabled && !recipient) throw new Error("Enter the shared reminder inbox before enabling delivery.");
    state.agencyMaintenance = { ...current, notifications: { enabled: input.enabled, recipient: recipient.toLowerCase(), leadDays: 14 } };
  });
}
export function syncAgencyMaintenance(state: Workspace, asOfDate = businessDay(), companyId = "") {
  return traceMutation(state, "syncAgencyMaintenance", [asOfDate, companyId], () => {
    if (companyId && !state.companies.some(c => c.id === agencyId(companyId))) throw new Error("Choose an available company.");
    const day = agencyDate(asOfDate, false); const current = maintenanceState(state);
    for (const record of upcomingMaintenance(state, day).filter(r => !companyId || r.companyId === companyId)) {
      const key = `maintenance:${record.id}:${record.nextDueOn}`;
      if (state.tasks.some(t => t.phaseOne?.key === key) || current.history.some(h => h.maintenanceId === record.id && h.cycleOn === record.nextDueOn)) continue;
      references(state, record);
      const requiredOriginal = record.scope === "entity" && record.kind === "Good standing" || ["NC agency license", "SC agency license"].includes(record.kind);
      const task: Task = { id: `task-${commandUuid()}`, title: record.title, companyId: record.companyId, owner: record.owner, ...(record.assigneeId ? { assigneeId: record.assigneeId } : {}), scope: "agency", due: record.nextDueOn, done: false, status: "Not Started", completedOn: "", notes: "", documentIds: [], priority: "Normal", createdAt: day,
        phaseOne: { kind: "maintenance", key, maintenanceId: record.id, cycleOn: record.nextDueOn, required: true, applicable: true, revision: 1, ...(requiredOriginal ? { documentRequirement: { categories: record.scope === "entity" ? ["Formation", "Company records", "Partner entities"] : ["Licensing"], minimum: 1, restricted: record.scope === "entity" } } : {}) } };
      state.tasks.push(task);
    }
  });
}
export function completeAgencyMaintenance(state: Workspace, input: { maintenanceId: string; expectedRevision: number; cycleOn: string; completedOn: string; notes: string; documentIds: string[]; nextDueOn: string }) {
  return traceMutation(state, "completeAgencyMaintenance", [input], () => {
    agencyObject(input, ["maintenanceId", "expectedRevision", "cycleOn", "completedOn", "notes", "documentIds", "nextDueOn"]);
    const current = maintenanceState(state), record = current.records.find(r => r.id === agencyId(input.maintenanceId));
    if (!record || !record.active || record.revision !== agencyRevision(input.expectedRevision) || record.nextDueOn !== agencyDate(input.cycleOn, false)) throw new Error("This renewal cycle changed. Reload before recording completion.");
    const completedOn = agencyDate(input.completedOn, false), nextDueOn = agencyDate(input.nextDueOn, false), notes = agencyText(input.notes, 4000), documentIds = agencyDocumentIds(input.documentIds);
    if (completedOn > businessDay() || nextDueOn <= record.nextDueOn || nextDueOn <= completedOn) throw new Error("Use a completion date through today and a next renewal after this cycle and completion.");
    validateAgencyMaintenanceRecord({ ...record, nextDueOn });
    if (current.history.some(h => h.maintenanceId === record.id && h.cycleOn === record.nextDueOn)) throw new Error("This renewal cycle is already complete.");
    const task = state.tasks.find(t => t.phaseOne?.maintenanceId === record.id && t.phaseOne.cycleOn === record.nextDueOn && t.phaseOne.applicable);
    if (!task) throw new Error("Create the due maintenance task before recording completion.");
    const problem = agencyTaskDocumentProblem(state, task, documentIds); if (problem) throw new Error(problem);
    task.done = true; task.status = "Complete"; task.completedOn = completedOn; task.notes = notes; task.documentIds = documentIds; task.phaseOne!.revision++;
    const history: AgencyMaintenanceCompletion = { id: `renewal-${commandUuid()}`, maintenanceId: record.id, taskId: task.id, cycleOn: record.nextDueOn, completedOn, nextDueOn, notes, documentIds, actor: agencyText(state.user, 200) };
    record.nextDueOn = nextDueOn; record.documentIds = documentIds; record.revision++; if (["Good standing", "Annual report"].includes(record.kind)) record.standing = "Current";
    state.agencyMaintenance = { ...current, history: [...current.history, history] };
  });
}
const nextAnnual = (day: string, monthDay: string, even = false) => { let year = Number(day.slice(0, 4)); if (even && year % 2) year++; if (`${year}-${monthDay}` < day) year += even ? 2 : 1; return `${year}-${monthDay}`; };
export function suggestedAgencyMaintenance(state: Workspace, companyId?: string, asOfDate = businessDay()): AgencyMaintenanceRecord[] {
  const day = agencyDate(asOfDate, false), suggestions: AgencyMaintenanceRecord[] = [];
  const add = (scope: AgencyMaintenanceRecord["scope"], company: string, member: string, kind: AgencyMaintenanceKind, title: string, values: Partial<AgencyMaintenanceRecord> = {}) => { const record: AgencyMaintenanceRecord = { id: `maintenance-${commandUuid()}`, revision: 1, scope, companyId: company, memberId: member, kind, title, active: true, nextDueOn: "", intervalYears: 1, schedule: "anniversary", source: "", verifiedOn: "", notes: "", owner: "", documentIds: [], standing: "Unknown", ...values }; if (!maintenanceState(state).records.some(r => recordKey(r) === recordKey(record))) suggestions.push(record); };
  for (const company of state.companies.filter(c => !companyId || c.id === companyId)) {
    add("company", company.id, "", "Annual report", `${company.name}: annual report`);
    add("company", company.id, "", "Good standing", `${company.name}: SOS status / good standing`);
    for (const service of ["Domain", "Email", "Website"] as const) { if (service === "Website" && company.desk?.websiteNotNeeded) continue; const existing = company.desk?.renewals.find(r => r.service === service); add("company", company.id, "", service, `${company.name}: ${service.toLowerCase()} renewal`, { nextDueOn: existing?.renewalOn || "", intervalYears: existing?.renewalYears || 1, source: existing?.reference || "" }); }
    if ((company.operatingStates || [company.jurisdiction]).includes("NC")) add("company", company.id, "", "NC agency license", `${company.name}: NC agency license renewal`, { nextDueOn: nextAnnual(day, "04-01"), schedule: "nc-april", source: "https://www.ncdoi.gov/licensees/insurance-business-entity-licensing/licensing-applications-and-forms-business-entities-and-agencies", verifiedOn: "2026-10-05" });
    if ((company.operatingStates || [company.jurisdiction]).includes("SC")) add("company", company.id, "", "SC agency license", `${company.name}: SC agency license renewal`, { nextDueOn: nextAnnual(day, "01-01", true), intervalYears: 2, schedule: "sc-even-january", source: "https://www.doi.sc.gov/364/Agency", verifiedOn: "2026-10-05", notes: "Renewal occurs in January of even-numbered years. January 1 opens the renewal month; confirm the notice deadline and correct the date if needed." });
    for (const owner of company.agencySetup?.owners.filter(o => o.kind !== "individual") || []) { const name = company.members.find(m => m.id === owner.memberId)?.name || "Ownership entity"; add("entity", company.id, owner.memberId, "Annual report", `${name}: annual report (verify jurisdiction applicability)`); add("entity", company.id, owner.memberId, "Good standing", `${name}: SOS status and evidence`); }
  }
  if (!companyId) { add("agency", "", "", "Agency E&O", "Ballantyne agency: September E&O renewal", { nextDueOn: nextAnnual(day, "09-01"), schedule: "september", notes: "Confirm the policy's exact September renewal date." }); add("agency", "", "", "Agency credential", "John: agency credential renewal", { notes: "Confirm the credential type and official renewal notice. This credential is tracked once for the agency." }); }
  return suggestions;
}
export function validateAgencyMaintenance(state: Workspace) {
  if (!state.agencyMaintenance) return;
  const source = agencyObject(state.agencyMaintenance, ["records", "history", "notifications"], ["records", "history"]);
  const records = agencyList(source.records, 10000, validateAgencyMaintenanceRecord);
  if (new Set(records.map(r => r.id)).size !== records.length || new Set(records.map(recordKey)).size !== records.length) throw new Error("Duplicate maintenance schedule.");
  records.forEach(r => references(state, r));
  const history = agencyList(source.history, 50000, value => { const r = agencyObject(value, ["id", "maintenanceId", "taskId", "cycleOn", "completedOn", "nextDueOn", "notes", "documentIds", "actor"]); const maintenanceId = agencyId(r.maintenanceId), taskId = agencyId(r.taskId), cycleOn = agencyDate(r.cycleOn, false), completedOn = agencyDate(r.completedOn, false), nextDueOn = agencyDate(r.nextDueOn, false); if (!records.some(x => x.id === maintenanceId) || !state.tasks.some(t => t.id === taskId && t.phaseOne?.maintenanceId === maintenanceId && t.phaseOne.cycleOn === cycleOn && t.done) || nextDueOn <= cycleOn || nextDueOn <= completedOn) throw new Error("Invalid maintenance completion history."); agencyId(r.id); agencyText(r.notes, 4000); agencyText(r.actor, 200); agencyDocumentIds(r.documentIds); return { id: r.id, key: `${maintenanceId}:${cycleOn}` }; });
  if (new Set(history.map(h => h.id)).size !== history.length || new Set(history.map(h => h.key)).size !== history.length) throw new Error("Duplicate maintenance completion.");
  if (source.notifications !== undefined) { const r = agencyObject(source.notifications, ["enabled", "recipient", "leadDays"]), recipient = agencyText(r.recipient, 254); if (typeof r.enabled !== "boolean" || r.leadDays !== 14 || recipient && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || r.enabled && !recipient) throw new Error("Invalid maintenance reminder settings."); }
  for (const task of state.tasks.filter(t => t.phaseOne?.kind === "maintenance")) { const r = records.find(r => r.id === task.phaseOne!.maintenanceId); if (!r || task.companyId !== r.companyId || task.phaseOne!.key !== `maintenance:${r.id}:${task.phaseOne!.cycleOn}` || !agencyDate(task.phaseOne!.cycleOn, false) || task.phaseOne!.itemId !== undefined || task.phaseOne!.templateVersion !== undefined) throw new Error("Invalid maintenance task references."); }
}
