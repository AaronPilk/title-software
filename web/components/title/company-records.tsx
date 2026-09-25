"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "./shared";
import { useWorkspace, download } from "@/lib/title/store";
import { uid, type Company, type VaultDoc } from "@/lib/title/model";
import { jvIntakeClientRequest, type JVIntakeContext } from "@/lib/backend/jv-intake-client";
import { validateJVApplication, type JVRecord, type JVApplication } from "@/lib/title/jv-application";
import { emptyCompanyRecords, applicationFieldSources, type CompanyRecords, type OwnerEntity, type CompanyAgreement, type ApplicationWorksheet } from "@/lib/title/company-records";
import { prepareApplicationWorksheet } from "@/lib/title/application-worksheet";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import styles from "./company-workspace.module.css";

type Props = { company: Company; onDirtyChange?: (v: boolean) => void; onBusyChange?: (v: boolean) => void };
export function CompanyRecordsPanel(props: Props) {
  const { connection } = useWorkspace();
  if (!connection) return <p className={styles.privateNotice}>Sign in to the shared workspace to keep private owner records.</p>;
  const { access, workspaceId } = connection;
  if (!["owner", "admin", "onboarding"].includes(access.role) || !access.restricted || !(access.allCompanies || access.companyIds.includes(props.company.id))) return null;
  const scope = JSON.stringify([workspaceId, access, props.company.id]);
  return <PrivateCompanyRecords key={scope} {...props} context={{ workspaceId, userId: access.userId, companyId: props.company.id }} />;
}
function PrivateCompanyRecords({ company, context, onDirtyChange, onBusyChange }: Props & { context: JVIntakeContext }) {
  const { s, update } = useWorkspace();
  const [record, setRecord] = useState<JVRecord | null>(null), [draft, setDraft] = useState<CompanyRecords | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false);
  const alive = useRef(true), working = useRef(false);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(record?.payload.companyRecords || emptyCompanyRecords());
  useWorkspaceNavigationGuard("company-detail", { dirty, busy });
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (working.current || dirty && !window.confirm("Discard unsaved owner details and reload?")) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (company.members.some(m => !m.id)) {
        const baseline = JSON.stringify(company.members);
        const ok = await update(state => { const c = state.companies.find(c => c.id === company.id); if (!c || JSON.stringify(c.members) !== baseline) throw new Error("Members changed. Reopen the company."); c.members = c.members.map(m => ({ ...m, id: m.id || uid("member") })); }, "Owner records enabled", company.name);
        if (!ok) throw new Error("Save the company members before opening owner records.");
      }
      const result = await jvIntakeClientRequest(context, "load");
      if (!alive.current) return;
      setRecord(result); setDraft(structuredClone(result.payload.companyRecords || emptyCompanyRecords())); setConflict(false); setNotice("");
    } catch (e) { if (alive.current) { const status = e && typeof e === "object" && "status" in e ? e.status : undefined; if (status === 401 || status === 403) { setRecord(null); setDraft(null); } setError("Owner records could not be loaded. Check your access and try again."); } }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (working.current || !draft || !record || conflict) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const payload = validateJVApplication({ ...record.payload, companyRecords: draft });
      const result = await jvIntakeClientRequest(context, "save", { expectedVersion: record.version, payload });
      if (!alive.current) return;
      setRecord(result); setDraft(structuredClone(result.payload.companyRecords!)); setNotice("Owner and company records saved.");
    } catch (e) {
      if (!alive.current) return;
      const status = e && typeof e === "object" && "status" in e ? e.status : undefined;
      if (status === 401 || status === 403) { setRecord(null); setDraft(null); }
      if (status === 409) setConflict(true);
      setError(status === 409 ? "The application or member records changed. Reload before saving again." : "Owner details could not be saved. Check the fields and document references, then try again.");
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function change(next: CompanyRecords) { if (!working.current) { setDraft(next); setNotice(""); setError(""); } }
  const originals = s.documents.filter(d => d.companyId === company.id && !d.orderId && d.visibility === "Restricted" && !!d.assetId);
  return <section aria-label="Private owner records" className={styles.owner}>
    <div className={styles.heading}><div><h3><LockKeyhole size={17} className="inline" /> Owner & LLC details</h3><p>Legal owners, representatives, formation records and tax IDs.</p></div><Button variant="outline" disabled={busy} onClick={() => void load()}>{draft ? "Reload saved records" : "Open owner details"}</Button></div>
    {error && <p role="alert" className="notice warning">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && !draft && <p role="status">Loading private records…</p>}
    {draft && record && <form autoComplete="off" className="form-stack" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy || conflict} className={styles.fieldset}>
      <EinField label="Title company EIN" value={draft.companyEin} onChange={value => change({ ...draft, companyEin: value })} />
      <p className={styles.privateNotice}>The company EIN belongs to {company.name}. Each owning LLC has its own EIN below. You can enter the number without uploading a document.</p>
      {company.members.map(member => { const owner = draft.owners.find(o => o.memberId === member.id); return <section key={member.id || member.name} className={styles.owner}>
        <div className={styles.heading}><div><h4>{owner?.legalName || member.name}</h4><p>{member.share}% ownership</p></div>{!owner && <Button type="button" variant="outline" disabled={!member.id || draft.owners.length >= 40} onClick={() => change({ ...draft, owners: [...draft.owners, { id: uid("owner"), memberId: member.id!, kind: "individual", legalName: member.name, ein: "", representatives: [{ id: uid("representative"), name: "", email: member.email || "", phone: member.phone || "" }], formationStatus: "Unknown", formationBy: "Not confirmed", formationState: "", formationReference: "", documentIds: [] }] })}>Add owner details</Button>}</div>
        {owner && <OwnerEditor owner={owner} applicants={record.payload.applicants} originals={originals} onChange={next => change({ ...draft, owners: draft.owners.map(o => o.id === owner.id ? next : o) })} />}
      </section>; })}
      {!company.members.length && <p>Add the company members and their interests above, then open their owner details here.</p>}
      {draft.owners.filter(o => !company.members.some(m => m.id === o.memberId)).map(o => <div role="alert" className="notice warning" key={o.id}><p>An owner record is linked to a member that is no longer present. Relink it or remove its private details before saving. The saved application and original files remain available.</p><select aria-label="Relink owner record" value="" onChange={e => change({ ...draft, owners: draft.owners.map(row => row.id === o.id ? { ...row, memberId: e.target.value } : row) })}><option value="">Choose member…</option>{company.members.filter(m => m.id && !draft.owners.some(o => o.memberId === m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><Button type="button" variant="outline" onClick={() => { if (window.confirm("Remove this former owner’s private details from the current company record?")) change({ ...draft, owners: draft.owners.filter(row => row.id !== o.id) }); }}>Remove former owner details</Button></div>)}
      <details className={styles.owner}><summary>Agreements & financial terms</summary><p className={styles.privateNotice}>Record the actual agreement terms separately from ownership interests. These entries do not change accounting calculations.</p>
        {draft.agreements.map(a => <section key={a.id}><AgreementEditor agreement={a} company={company} originals={originals} onChange={next => change({ ...draft, agreements: draft.agreements.map(row => row.id === a.id ? next : row) })} /><Button type="button" variant="ghost" onClick={() => { if (window.confirm("Remove this agreement entry? Its original documents will remain.")) change({ ...draft, agreements: draft.agreements.filter(row => row.id !== a.id) }); }}>Remove agreement entry</Button></section>)}
        <Button type="button" variant="outline" disabled={draft.agreements.length >= 40} onClick={() => change({ ...draft, agreements: [...draft.agreements, { id: uid("agreement"), title: "", effectiveOn: "", reference: "", documentIds: [], terms: [], notes: "" }] })}><Plus size={15} />Add agreement</Button>
      </details>
      <details className={styles.owner}><summary>Application preparation for John</summary><p className={styles.privateNotice}>Map the field labels from a current application to saved company details. Download a filled preparation sheet to check against the official form. The original application, signatures and submission stay separate.</p>
        {draft.worksheets.map(w => <section key={w.id}><WorksheetEditor worksheet={w} onChange={next => change({ ...draft, worksheets: draft.worksheets.map(row => row.id === w.id ? next : row) })} company={company} records={draft} originals={originals} saved={!dirty} /><Button type="button" variant="ghost" onClick={() => { if (window.confirm("Remove this application worksheet? Its original form will remain.")) change({ ...draft, worksheets: draft.worksheets.filter(row => row.id !== w.id) }); }}>Remove worksheet</Button></section>)}
        <Button type="button" variant="outline" disabled={draft.worksheets.length >= 30} onClick={() => change({ ...draft, worksheets: [...draft.worksheets, { id: uid("worksheet"), title: "", version: "1", documentId: "", fields: [] }] })}><Plus size={15} />Add application worksheet</Button>
      </details>
    </fieldset><Button type="submit" disabled={busy || conflict || !dirty}>{busy ? "Saving…" : "Save owner & company records"}</Button></form>}
  </section>;
}
function EinField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return <FieldLabel label={label}><div className="flex gap-2"><Input aria-label={label} type={shown ? "text" : "password"} inputMode="numeric" maxLength={10} autoComplete="off" value={value} onChange={e => onChange(e.target.value)} placeholder="XX-XXXXXXX (optional)" /><Button type="button" variant="outline" aria-label={`${shown ? "Hide" : "Show"} ${label}`} onClick={() => setShown(v => !v)}>{shown ? <EyeOff size={16} /> : <Eye size={16} />}</Button></div></FieldLabel>;
}
function DocumentLinks({ selected, originals, categories, onChange }: { selected: string[]; originals: VaultDoc[]; categories: string[]; onChange: (v: string[]) => void }) {
  const options = originals.filter(d => categories.includes(d.category));
  return <div className="form-stack"><p className={styles.privateNotice}>Link this company’s restricted originals, or save now and add them later.</p>{options.map(d => <label key={d.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(d.id)} onChange={e => onChange(e.target.checked ? [...selected, d.id] : selected.filter(id => id !== d.id))} /><span>{d.name}</span></label>)}{selected.filter(id => !options.some(d => d.id === id)).map(id => <div key={id} role="alert"><span>An original is unavailable or has a different category. </span><Button type="button" variant="ghost" onClick={() => onChange(selected.filter(v => v !== id))}>Remove unavailable reference</Button></div>)}</div>;
}
function OwnerEditor({ owner, applicants, originals, onChange }: { owner: OwnerEntity; applicants: JVApplication["applicants"]; originals: VaultDoc[]; onChange: (owner: OwnerEntity) => void }) {
  const patch = (v: Partial<OwnerEntity>) => onChange({ ...owner, ...v });
  return <div className="form-stack"><div className="form-grid"><FieldLabel label="Who owns this interest?"><select className="input" value={owner.kind} onChange={e => { const kind = e.target.value as OwnerEntity["kind"]; if (kind === "individual" && (owner.ein || owner.documentIds.length) && !window.confirm("Switch to an individual and clear this LLC's tax ID and formation-document links?")) return; patch({ kind, ...(kind === "individual" ? { ein: "", formationStatus: "Not applicable", formationState: "", formationReference: "", formationBy: "Not confirmed", documentIds: [] } : { formationStatus: "Unknown" }) }); }}><option value="individual">The person individually</option><option value="llc">Their LLC</option><option value="other">Another legal entity</option></select></FieldLabel><FieldLabel label="Legal owner name"><Input value={owner.legalName} maxLength={200} onChange={e => patch({ legalName: e.target.value })} /></FieldLabel></div>
    <div><p className={styles.privateNotice}>Correct the name above for this same owner. To record a different legal owner, clear the previous owner’s details first.</p><Button type="button" variant="ghost" onClick={() => { if (window.confirm("Start details for a different legal owner? This clears the current name, tax ID, formation links and representatives from this draft. Original documents and ownership percentages will not change.")) patch({ legalName: "", ein: "", formationStatus: owner.kind === "individual" ? "Not applicable" : "Unknown", formationState: "", formationReference: "", formationBy: "Not confirmed", documentIds: [], representatives: [] }); }}>Use a different legal owner</Button></div>
    {!!applicants.length && <FieldLabel label="Use saved application details"><select className="input" value="" onChange={e => { const a = applicants.find(a => a.id === e.target.value); if (!a || !window.confirm("Copy this applicant’s details? A changed legal owner clears the previous entity’s EIN and formation links. Ownership percentages stay the same.")) return;
      const known = a.ownershipType !== "undecided", kind = a.ownershipType === "business" ? "llc" as const : "individual" as const;
      const legalName = a.ownershipType === "business" ? a.businessName : a.name;
      const changedOwner = known && (kind !== owner.kind || legalName !== owner.legalName);
      patch({ ...(known ? { legalName, kind } : {}),
        ...(changedOwner ? { ein: "", documentIds: [], formationState: "", formationReference: "", formationBy: "Not confirmed", formationStatus: kind === "individual" ? "Not applicable" : "Unknown" } : {}),
        representatives: [{ id: uid("representative"), name: a.name, email: a.email, phone: a.phone }],
        ...(a.ownershipType === "business" ? { formationReference: a.businessReference, formationStatus: a.businessStatus === "existing" ? "Formed" : "Being formed" } : {}) }); }}><option value="">Choose an applicant to copy…</option>{applicants.filter(a => a.name).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></FieldLabel>}
    {owner.kind !== "individual" && <><EinField label="Owner LLC / entity EIN" value={owner.ein} onChange={value => patch({ ein: value })} /><div className="form-grid"><FieldLabel label="Formation status"><select className="input" value={owner.formationStatus} onChange={e => patch({ formationStatus: e.target.value as OwnerEntity["formationStatus"] })}>{["Unknown", "Being formed", "Formed"].map(v => <option key={v}>{v}</option>)}</select></FieldLabel><FieldLabel label="Who is forming it?"><select className="input" value={owner.formationBy} onChange={e => patch({ formationBy: e.target.value as OwnerEntity["formationBy"] })}>{["Not confirmed", "Agency", "Owner / outside professional"].map(v => <option key={v}>{v}</option>)}</select></FieldLabel><FieldLabel label="Owner entity formation state"><Input maxLength={2} value={owner.formationState} placeholder="NC / SC" onChange={e => patch({ formationState: e.target.value.toUpperCase() })} /></FieldLabel><FieldLabel label="Secretary of State / filing reference"><Input maxLength={1000} value={owner.formationReference} onChange={e => patch({ formationReference: e.target.value })} /></FieldLabel></div><DocumentLinks selected={owner.documentIds} originals={originals} categories={["Formation", "Company records"]} onChange={documentIds => patch({ documentIds })} />
      {(!owner.ein || owner.formationStatus !== "Formed" || !owner.formationReference) && <p className="notice">Still needed: {[!owner.ein && "tax ID", owner.formationStatus !== "Formed" && "formation confirmation", !owner.formationReference && "filing reference"].filter(Boolean).join(", ")}. You can save and finish later.</p>}</>}
    <h4>{owner.kind === "individual" ? "Person’s contact details" : "People representing this owner"}</h4>{owner.representatives.map((r, i) => <div className="form-grid" key={r.id}>{(["name", "email", "phone"] as const).map(key => <FieldLabel key={key} label={`Representative ${i + 1} ${key}`}><Input type={key === "email" ? "email" : "text"} maxLength={key === "email" ? 254 : key === "phone" ? 60 : 150} value={r[key]} onChange={e => patch({ representatives: owner.representatives.map(row => row.id === r.id ? { ...row, [key]: e.target.value } : row) })} /></FieldLabel>)}<Button type="button" variant="ghost" aria-label={`Remove representative ${i + 1}`} onClick={() => { if (window.confirm("Remove this representative from the owner record?")) patch({ representatives: owner.representatives.filter(row => row.id !== r.id) }); }}>Remove representative</Button></div>)}<Button type="button" variant="outline" disabled={owner.representatives.length >= 10} onClick={() => patch({ representatives: [...owner.representatives, { id: uid("representative"), name: "", email: "", phone: "" }] })}><Plus size={14} />Add representative</Button>
  </div>;
}
function AgreementEditor({ agreement: a, company, originals, onChange }: { agreement: CompanyAgreement; company: Company; originals: VaultDoc[]; onChange: (a: CompanyAgreement) => void }) {
  const patch = (v: Partial<CompanyAgreement>) => onChange({ ...a, ...v });
  return <div className={styles.owner}><div className="form-grid"><FieldLabel label="Agreement title"><Input value={a.title} maxLength={200} onChange={e => patch({ title: e.target.value })} /></FieldLabel><FieldLabel label="Agreement effective date"><Input type="date" value={a.effectiveOn} onChange={e => patch({ effectiveOn: e.target.value })} /></FieldLabel></div><FieldLabel label="Agreement reference / version"><Input value={a.reference} maxLength={1000} onChange={e => patch({ reference: e.target.value })} /></FieldLabel><DocumentLinks selected={a.documentIds} originals={originals} categories={["Agreements"]} onChange={documentIds => patch({ documentIds })} />
    {a.terms.map((t, i) => <div className={styles.term} key={i}><select className="input" aria-label={`Agreement member ${i + 1}`} value={t.memberId} onChange={e => patch({ terms: a.terms.map((row, j) => j === i ? { ...row, memberId: e.target.value } : row) })}>{!company.members.some(m => m.id === t.memberId) && <option value={t.memberId}>Member unavailable — choose another</option>}{company.members.filter(m => m.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><Input aria-label={`Term label ${i + 1}`} placeholder="Distribution / fee / voting" maxLength={150} value={t.label} onChange={e => patch({ terms: a.terms.map((row, j) => j === i ? { ...row, label: e.target.value } : row) })} /><Input aria-label={`Term percentage ${i + 1}`} type="number" min="0" max="100" step="0.001" placeholder="%" value={t.percentage} onChange={e => patch({ terms: a.terms.map((row, j) => j === i ? { ...row, percentage: e.target.value } : row) })} /><Button type="button" variant="ghost" aria-label={`Remove agreement term ${i + 1}`} onClick={() => patch({ terms: a.terms.filter((_, j) => j !== i) })}>Remove term</Button></div>)}
    <Button type="button" variant="outline" disabled={!company.members.some(m => m.id) || a.terms.length >= 80} onClick={() => patch({ terms: [...a.terms, { memberId: company.members.find(m => m.id)!.id!, label: "", percentage: "" }] })}>Add percentage term</Button><FieldLabel label="Other agreement terms"><Textarea rows={3} maxLength={4000} value={a.notes} onChange={e => patch({ notes: e.target.value })} /></FieldLabel>
  </div>;
}
function WorksheetEditor({ worksheet: w, onChange, company, records, originals, saved }: { worksheet: ApplicationWorksheet; onChange: (w: ApplicationWorksheet) => void; company: Company; records: CompanyRecords; originals: VaultDoc[]; saved: boolean }) {
  const [ownerId, setOwnerId] = useState(""), [representativeId, setRepresentativeId] = useState(""), [error, setError] = useState("");
  const owner = records.owners.find(o => o.id === ownerId);
  function exportSheet() { try { const draft = prepareApplicationWorksheet(company, records, w, ownerId, representativeId); download("application-preparation.html", draft.html, "text/html"); setError(draft.missing.length ? `${draft.missing.length} fields need completion. The draft marks them as missing.` : ""); } catch (e) { setError(e instanceof Error ? e.message : "Check the worksheet."); } }
  return <div className={styles.owner}><div className="form-grid"><FieldLabel label="Application name"><Input maxLength={200} value={w.title} onChange={e => onChange({ ...w, title: e.target.value })} /></FieldLabel><FieldLabel label="Form version"><Input maxLength={80} value={w.version} onChange={e => onChange({ ...w, version: e.target.value })} /></FieldLabel></div><FieldLabel label="Original form (optional)"><select className="input" value={w.documentId} onChange={e => onChange({ ...w, documentId: e.target.value })}><option value="">Not supplied yet</option>{w.documentId && !originals.some(d => d.id === w.documentId && ["Applications", "Agreements", "Disclosures", "Company records"].includes(d.category)) && <option value={w.documentId}>Unavailable original — choose another or clear</option>}{originals.filter(d => ["Applications", "Agreements", "Disclosures", "Company records"].includes(d.category)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FieldLabel>
    {w.fields.map((f, i) => <div className="form-grid" key={f.id}><Input aria-label={`Application field label ${i + 1}`} maxLength={200} placeholder="Label on official application" value={f.label} onChange={e => onChange({ ...w, fields: w.fields.map(row => row.id === f.id ? { ...row, label: e.target.value } : row) })} /><select className="input" aria-label={`Source for application field ${i + 1}`} value={f.source} onChange={e => onChange({ ...w, fields: w.fields.map(row => row.id === f.id ? { ...row, source: e.target.value as typeof f.source } : row) })}>{applicationFieldSources.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</select><Button type="button" variant="ghost" aria-label={`Remove application field ${i + 1}`} onClick={() => onChange({ ...w, fields: w.fields.filter(row => row.id !== f.id) })}>Remove field</Button></div>)}
    <Button type="button" variant="outline" disabled={w.fields.length >= 100} onClick={() => onChange({ ...w, fields: [...w.fields, { id: uid("field"), label: "", source: "company.name" }] })}>Add mapped field</Button><div className="form-grid"><FieldLabel label="Prepare for owner"><select className="input" value={ownerId} onChange={e => { setOwnerId(e.target.value); setRepresentativeId(""); }}><option value="">Choose owner…</option>{records.owners.map(o => <option key={o.id} value={o.id}>{o.legalName || "Unnamed owner"}</option>)}</select></FieldLabel><FieldLabel label="Prepare for representative"><select className="input" value={representativeId} onChange={e => setRepresentativeId(e.target.value)}><option value="">Choose representative…</option>{owner?.representatives.map(r => <option key={r.id} value={r.id}>{r.name || "Unnamed representative"}</option>)}</select></FieldLabel></div><Button type="button" variant="outline" disabled={!saved || !ownerId || !representativeId} onClick={exportSheet}><Download size={15} />Download preparation draft</Button>{!saved && <p className="form-note">Save owner & company records before preparing a draft.</p>}{error && <p role="status">{error}</p>}
  </div>;
}
