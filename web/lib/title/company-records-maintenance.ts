import type { Workspace } from "./model";
import type { CompanyRecords, EntityCompliance } from "./company-records";
import { commandUuid } from "./command-log";
import { maintenanceState, nextMaintenanceDate, saveAgencyMaintenance, type AgencyMaintenanceRecord } from "./agency-maintenance";
const fields = (value?: EntityCompliance) => value ? JSON.stringify([value.status, value.statusCheckedOn, value.annualReportFiledOn, value.annualReportDueOn]) : "";
/** Only dated, non-sensitive filing facts leave the encrypted records envelope.
 * Maintenance owns future schedules. Unchanged private snapshots never rewind it. */
export function companyRecordMaintenanceChanged(before: CompanyRecords, after: CompanyRecords) {
  return fields(before.companyCompliance) !== fields(after.companyCompliance) || after.owners.some(owner => fields(before.owners.find(o => o.memberId === owner.memberId)?.compliance) !== fields(owner.compliance));
}
export function syncCompanyRecordMaintenance(state: Workspace, companyId: string, before: CompanyRecords, after: CompanyRecords) {
  const company = state.companies.find(c => c.id === companyId); if (!company) throw new Error("Company changed. Reopen Maintenance.");
  const subjects = [{ memberId: "", previous: before.companyCompliance, compliance: after.companyCompliance }, ...after.owners.filter(o => o.kind !== "individual").map(o => ({ memberId: o.memberId, previous: before.owners.find(p => p.memberId === o.memberId)?.compliance, compliance: o.compliance }))];
  for (const subject of subjects) {
    const c = subject.compliance; if (!c || fields(c) === fields(subject.previous)) continue;
    const scope = subject.memberId ? "entity" as const : "company" as const;
    const displayName = subject.memberId ? company.members.find(m => m.id === subject.memberId)?.name : company.name;
    if (!displayName) throw new Error("Ownership member changed. Reopen Maintenance.");
    for (const kind of ["Annual report", "Good standing"] as const) {
      const previous = maintenanceState(state).records.find(r => r.scope === scope && r.companyId === companyId && r.memberId === subject.memberId && r.kind === kind);
      const dateChanged = kind === "Annual report" ? c.annualReportDueOn !== subject.previous?.annualReportDueOn : c.statusCheckedOn !== subject.previous?.statusCheckedOn;
      const enteredDue = kind === "Annual report" ? c.annualReportDueOn : c.statusCheckedOn ? nextMaintenanceDate({ nextDueOn: c.statusCheckedOn, intervalYears: 1, schedule: "anniversary" }) : "";
      // Clearing historical dates does not erase an existing active schedule.
      const nextDueOn = dateChanged && enteredDue ? enteredDue : previous?.nextDueOn || enteredDue;
      if (!nextDueOn) continue;
      const record: AgencyMaintenanceRecord = { id: previous?.id || `maintenance-${commandUuid()}`, revision: (previous?.revision || 0) + 1, scope, companyId, memberId: subject.memberId, kind, title: previous?.title || `${displayName}: ${kind === "Annual report" ? "annual report" : "SOS status / good standing"}`, active: previous?.active ?? true, nextDueOn, intervalYears: previous?.intervalYears || 1, schedule: previous?.schedule || "anniversary", source: previous?.source || "Dated private company records", verifiedOn: c.statusCheckedOn !== subject.previous?.statusCheckedOn ? c.statusCheckedOn || previous?.verifiedOn || "" : previous?.verifiedOn || c.statusCheckedOn, notes: previous?.notes || "", owner: previous?.owner || "", documentIds: previous?.documentIds || [], standing: !previous || c.status !== subject.previous?.status || c.statusCheckedOn !== subject.previous?.statusCheckedOn ? c.status : previous.standing, ...(previous?.assigneeId ? { assigneeId: previous.assigneeId } : {}) };
      saveAgencyMaintenance(state, { expectedRevision: previous?.revision || 0, record });
    }
  }
}
