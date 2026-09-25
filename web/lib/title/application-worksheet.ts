import { type CompanyRecords, type ApplicationWorksheet } from "./company-records";
import type { Company } from "./model";

/** A local preparation sheet; never signs, submits, or claims an official form. */
export function prepareApplicationWorksheet(company: Company, records: CompanyRecords, template: ApplicationWorksheet, ownerId: string, representativeId: string) {
  const owner = records.owners.find(o => o.id === ownerId), member = company.members.find(m => m.id === owner?.memberId);
  const representative = owner?.representatives.find(r => r.id === representativeId);
  if (!template.title.trim() || !template.version.trim() || !template.fields.length || template.fields.some(f => !f.label.trim()) || !owner || !member || !representative)
    throw new Error("Choose a saved worksheet, owner and representative first.");
  const values: Record<string, string> = {
    "company.name": company.name, "company.states": (company.operatingStates || [company.jurisdiction]).filter(Boolean).join(", "), "company.ein": records.companyEin,
    "owner.name": owner.legalName, "owner.ein": owner.ein, "owner.share": String(member.share), "contact.name": representative.name, "contact.email": representative.email, "contact.phone": representative.phone,
    "owner.formationState": owner.formationState, "owner.formationReference": owner.formationReference,
  };
  const rows = template.fields.map(f => ({ label: f.label, value: values[f.source] || "", source: f.source }));
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(template.title)} — preparation draft</title><style>body{font:16px system-ui,sans-serif;max-width:850px;margin:40px auto;padding:24px;color:#172c42}h1{font-size:28px}p{line-height:1.6}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:12px;overflow-wrap:anywhere}.missing{color:#92400e}@media print{body{margin:0;padding:0}}</style><h1>${escape(template.title)}</h1><p>Preparation draft · template ${escape(template.version)}<br>${escape(company.name)} · ${escape(owner.legalName || member.name)}</p><p>Compare these values with the current official application before entering or submitting it. This worksheet is unsigned and is not an official completed form.</p><table><thead><tr><th>Application field</th><th>Saved source value</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escape(r.label)}</td><td${r.value ? "" : ' class="missing"'}>${escape(r.value || "Missing — review required")}</td></tr>`).join("")}</tbody></table></html>`;
  return { html, missing: rows.filter(r => !r.value).map(r => r.label), rows };
}
