"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, FolderClosed, FolderPlus, ImagePlus, Pencil, Plus, ArrowRight, Download, Trash2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkspace, getAssetForDocument, download } from "@/lib/title/store";
import { companyDesk, companyServiceRenewals, companyEmails, emptyCompanyDesk, type CompanyDesk, type ServiceRenewal } from "@/lib/title/company-workspace";
import { saveCompanyUnderwriters } from "@/lib/title/business";
import { type Company, type VaultDoc, uid } from "@/lib/title/model";
import { canManageCompanies, canManageOnboardingEvidence } from "@/lib/title/workspace-capabilities";
import { FieldLabel, Status } from "./shared";
import { UploadDocument } from "./document-upload";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import { agencyDocumentSnapshot, archiveAgencyDocument, restoreAgencyDocument, renameAgencyDocument, moveAgencyDocument, designateAgencyDocument, agencyDocumentArchiveProblem, documentDisplayName, isAgencyDocumentArchived } from "@/lib/title/agency-documents";
import { saveAgencyMaintenance } from "@/lib/title/agency-maintenance";
import { CompanyLogo } from "./company-logo";
import styles from "./company-workspace.module.css";

export function CompanyCardFacts({ company }: { company: Company }) {
  const { s } = useWorkspace();
  const underwriters = s.business?.onboarding.find(row => row.companyId === company.id)?.requiredUnderwriters || [];
  const renewals = companyServiceRenewals(s, company);
  return <div className={styles.cardFacts}>{!!underwriters.length && <span>{underwriters.join(" · ")}</span>}<dl className={styles.cardRenewals} aria-label="Company service renewal dates">{(["Domain", "Email", "Website"] as const).map(service => {
    const renewal = renewals.find(row => row.service === service), paused = s.agencyMaintenance?.records.some(record => record.scope === "company" && record.companyId === company.id && record.kind === service && !record.active);
    return <div key={service}><dt>{service}</dt><dd>{service === "Website" && company.desk?.websiteNotNeeded ? "Not needed" : paused ? "Paused" : renewal?.renewalOn || "No date"}</dd></div>;
  })}</dl></div>;
}

export function CompanyOverviewDetails({ company, onDirtyChange, onBusyChange }: { company: Company; onDirtyChange?: (v: boolean) => void; onBusyChange?: (v: boolean) => void }) {
  const { s, connection, update } = useWorkspace();
  const canEdit = canManageCompanies(connection), canUnderwriters = canManageOnboardingEvidence(connection);
  const [editing, setEditing] = useState(false), [upload, setUpload] = useState(false);
  const [draft, setDraft] = useState<CompanyDesk>(emptyCompanyDesk), [states, setStates] = useState<string[]>([]), [writers, setWriters] = useState<string[]>([]);
  const [rawBaseline, setRawBaseline] = useState("");
  const [renewalBaseline, setRenewalBaseline] = useState("");
  const [baseline, setBaseline] = useState(""), [priorWriters, setPriorWriters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false);
  const current = { ...companyDesk(company), renewals: companyServiceRenewals(s, company) }, underwriters = s.business?.onboarding.find(row => row.companyId === company.id)?.requiredUnderwriters || [];
  const snapshot = (c: Company) => JSON.stringify({ desk: c.desk, email: c.email, states: c.operatingStates || [c.jurisdiction] });
  const dirty = editing && (JSON.stringify({ desk: draft, states }) !== baseline || JSON.stringify(writers) !== JSON.stringify(priorWriters));
  useWorkspaceNavigationGuard("company-detail", { dirty, busy: busy || upload });
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy || upload); return () => onBusyChange?.(false); }, [busy, upload, onBusyChange]);
  function edit() {
    setRenewalBaseline(JSON.stringify(s.agencyMaintenance?.records.filter(r => r.scope === "company" && r.companyId === company.id && ["Domain", "Email", "Website"].includes(r.kind)) || []));
    setRawBaseline(snapshot(company)); setDraft(structuredClone({ ...current, emails: companyEmails(company) })); setStates((company.operatingStates || [company.jurisdiction]).filter(Boolean)); setWriters([...underwriters]); setPriorWriters([...underwriters]);
    setBaseline(JSON.stringify({ desk: { ...current, emails: companyEmails(company) }, states: (company.operatingStates || [company.jurisdiction]).filter(Boolean) })); setError(""); setEditing(true);
  }
  function close() { if (!busy && (!dirty || window.confirm("Discard unsaved company details?"))) setEditing(false); }
  async function save() {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    const original = rawBaseline;
    try {
      const ok = await update(d => {
        const c = d.companies.find(c => c.id === company.id);
        if (!c || snapshot(c) !== original) throw new Error("Company details changed. Reopen this editor.");
        // Capture the explicit choice before state-change validation creates any legacy onboarding defaults.
        if (canUnderwriters && JSON.stringify(writers) !== JSON.stringify(priorWriters)) saveCompanyUnderwriters(d, { companyId: c.id, names: writers, expected: priorWriters });
        const tracked = d.agencyMaintenance?.records.filter(r => r.scope === "company" && r.companyId === company.id && ["Domain", "Email", "Website"].includes(r.kind)) || [];
        if (JSON.stringify(tracked) !== renewalBaseline) throw new Error("Service renewals changed. Reopen this editor to use the latest dates.");
        for (const record of tracked) {
          const renewal = draft.renewals.find(r => r.service === record.kind);
          if (renewal && (renewal.renewalOn !== record.nextDueOn || (renewal.renewalYears || record.intervalYears) !== record.intervalYears))
            saveAgencyMaintenance(d, { expectedRevision: record.revision, record: { ...record, revision: record.revision + 1, nextDueOn: renewal.renewalOn, intervalYears: renewal.renewalYears || record.intervalYears } });
        }
        c.desk = structuredClone(draft);
        c.email = draft.emails?.find(email => email.primary)?.address || "";
        if (!c.jurisdiction && states.length) c.jurisdiction = states[0] as Company["jurisdiction"];
        if (JSON.stringify([...(c.operatingStates || [c.jurisdiction])].filter(Boolean).sort()) !== JSON.stringify([...states].sort())) c.operatingStates = states;
      }, "Company details updated", company.name);
      if (ok) setEditing(false); else setError("The details were not saved. Check the workspace notice and try again.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save company details."); }
    finally { working.current = false; setBusy(false); }
  }
  async function selectLogo(doc: VaultDoc) {
    await update(d => {
      const c = d.companies.find(c => c.id === company.id); if (!c) throw new Error("Company is unavailable.");
      c.desk = { ...companyDesk(c), logoDocumentId: doc.id };
    }, "Company logo selected", company.name);
  }
  const logos = s.documents.filter(d => d.companyId === company.id && !d.orderId && d.category === "Branding" && d.visibility === "Internal" && !d.archivedAt && !!d.assetId && ["image/png", "image/jpeg"].includes(d.mime || ""));
  return <section className={styles.overview} aria-label="Company at a glance">
    <header className={styles.heading}><div><h3>Company details</h3><p>Company contact details, services and important dates.</p></div>{canEdit && <Button variant="outline" size="sm" onClick={edit}><Pencil size={14} />Edit details</Button>}</header>
    <div className={styles.facts}><div><small>Operating states</small><strong>{(company.operatingStates || [company.jurisdiction]).filter(Boolean).map(s => s === "NC" ? "North Carolina" : s === "SC" ? "South Carolina" : s).join(" · ") || "Add operating states"}</strong></div><div><small>Underwriters</small><strong>{underwriters.join(" · ") || "Choose underwriters"}</strong></div></div>
    <div className={styles.contactFacts}>{current.address && <p><strong>Company address</strong>{current.address}</p>}{companyEmails(company).map(email => <p key={email.id}><strong>{email.primary ? "Primary company email" : email.label || "Additional email"}</strong><a href={`mailto:${email.address}`}>{email.address}</a></p>)}<p><strong>Domain</strong>{current.domain || "Not entered"}</p><p><strong>Website</strong>{current.websiteNotNeeded ? "Website Not Needed" : current.website || "Not entered"}</p></div>
    <div className={styles.renewals}>{(["Domain", "Email", "Website"] as const).map(service => { const r = current.renewals.find(r => r.service === service); const paused = s.agencyMaintenance?.records.some(record => record.scope === "company" && record.companyId === company.id && record.kind === service && !record.active); return <div key={service}><CalendarDays size={18} /><small>{service} renewal</small><strong>{service === "Website" && current.websiteNotNeeded ? "Not needed" : paused ? "Paused in Maintenance" : r?.renewalOn || "Add a date"}</strong>{r?.renewalYears && <span>Renews every {r.renewalYears} {r.renewalYears === 1 ? "year" : "years"}</span>}{r?.provider && <span>{r.provider}</span>}</div>; })}</div>
    {canEdit && <div className={styles.logoControls}>{current.logoDocumentId && <CompanyLogo company={company} />}<Button variant="ghost" onClick={() => setUpload(true)}><ImagePlus size={16} />{current.logoDocumentId ? "Change logo" : "Upload company logo"}</Button>{current.logoDocumentId && <Button variant="ghost" disabled={busy} onClick={() => void update(d => { const c = d.companies.find(c => c.id === company.id); if (!c || companyDesk(c).logoDocumentId !== current.logoDocumentId) throw new Error("The company logo changed. Refresh and try again."); c.desk = { ...companyDesk(c), logoDocumentId: "" }; }, "Company logo removed", company.name)}>Remove logo</Button>}</div>}
    {editing && <Dialog open onOpenChange={v => { if (!v) close(); }}><DialogContent className="modal"><DialogHeader><DialogTitle>Company details</DialogTitle><DialogDescription>{company.name}</DialogDescription></DialogHeader>
      <form className="form-stack" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy} className={styles.fieldset}>
        <FieldLabel label="Company address"><Input maxLength={500} value={draft.address || ""} onChange={e => setDraft({ ...draft, address: e.target.value })} placeholder="Street, city, state and ZIP" /></FieldLabel>
        <fieldset className={styles.service}><legend>Company email addresses</legend>{(draft.emails || []).map((email, index) => <div className={styles.emailRow} key={email.id}><FieldLabel label={`Email label ${index + 1}`}><Input maxLength={100} value={email.label} onChange={e => setDraft({ ...draft, emails: draft.emails!.map(row => row.id === email.id ? { ...row, label: e.target.value } : row) })} /></FieldLabel><FieldLabel label={`Email address ${index + 1}`}><Input required type="email" maxLength={254} value={email.address} onChange={e => setDraft({ ...draft, emails: draft.emails!.map(row => row.id === email.id ? { ...row, address: e.target.value } : row) })} /></FieldLabel><label className={styles.primaryEmail}><input type="radio" name="primary-company-email" checked={email.primary} onChange={() => setDraft({ ...draft, emails: draft.emails!.map(row => ({ ...row, primary: row.id === email.id })) })} />Primary</label><Button type="button" variant="ghost" aria-label={`Remove email ${index + 1}`} onClick={() => { const emails = draft.emails!.filter(row => row.id !== email.id); if (email.primary && emails[0]) emails[0] = { ...emails[0], primary: true }; setDraft({ ...draft, emails }); }}><X size={15} /></Button></div>)}<Button type="button" variant="outline" disabled={(draft.emails?.length || 0) >= 20} onClick={() => setDraft({ ...draft, emails: [...(draft.emails || []), { id: uid("email"), label: "", address: "", primary: !draft.emails?.length }] })}><Plus size={14} />Add email address</Button></fieldset>
        <div className="form-grid"><FieldLabel label="Company domain"><Input maxLength={300} placeholder="company.com" value={draft.domain || ""} onChange={e => setDraft({ ...draft, domain: e.target.value })} /></FieldLabel><FieldLabel label="Company website"><Input type="url" maxLength={300} placeholder="https://company.com" disabled={draft.websiteNotNeeded} value={draft.website || ""} onChange={e => setDraft({ ...draft, website: e.target.value })} /></FieldLabel></div><label className={styles.primaryEmail}><input type="checkbox" checked={!!draft.websiteNotNeeded} onChange={e => setDraft({ ...draft, websiteNotNeeded: e.target.checked })} />Website Not Needed</label>
        <FieldLabel label="Company logo"><select className="input" aria-label="Company logo" value={draft.logoDocumentId} onChange={e => setDraft({ ...draft, logoDocumentId: e.target.value })}><option value="">Use initials</option>{logos.map(d => <option key={d.id} value={d.id}>{documentDisplayName(d)}</option>)}</select></FieldLabel>
        <fieldset><legend className="mb-2 text-sm font-medium">Operating states</legend><div className={styles.checks}>{[...new Set(["NC", "SC", ...states])].map(code => <label key={code}><input type="checkbox" disabled={code === company.jurisdiction} checked={states.includes(code)} onChange={e => setStates(e.target.checked ? [...states, code] : states.filter(v => v !== code))} />{code === "NC" ? "North Carolina" : code === "SC" ? "South Carolina" : code}</label>)}</div></fieldset>
        {canUnderwriters && <fieldset><legend className="mb-2 text-sm font-medium">Underwriters</legend><div className={styles.checks}>{[...new Set(["WFG", "Commonwealth", "First American", ...priorWriters])].map(name => <label key={name}><input type="checkbox" checked={writers.includes(name)} onChange={e => setWriters(e.target.checked ? [...writers, name] : writers.filter(v => v !== name))} />{name}</label>)}</div><small>Record which underwriters the company works with. Approval evidence stays in the application records.</small></fieldset>}
        {(["Domain", "Email", "Website"] as const).map(service => { const r = draft.renewals.find(r => r.service === service) || { service, renewalOn: "", provider: "", reference: "" }; const patch = (values: Partial<ServiceRenewal>) => setDraft({ ...draft, renewals: [...draft.renewals.filter(x => x.service !== service), { ...r, ...values }] }); return <fieldset key={service} className={styles.service}><legend>{service}</legend><div className="form-grid"><FieldLabel label={`${service} renewal date`}><Input type="date" disabled={service === "Website" && draft.websiteNotNeeded} value={r.renewalOn} onChange={e => patch({ renewalOn: e.target.value })} /></FieldLabel><FieldLabel label={`${service} provider`}><Input maxLength={200} value={r.provider} onChange={e => patch({ provider: e.target.value })} /></FieldLabel><FieldLabel label={`${service} renewal term`}><select className="input" aria-label={`${service} renewal term`} value={r.renewalYears || ""} onChange={e => patch({ renewalYears: e.target.value ? Number(e.target.value) : undefined })}><option value="">Choose term</option>{Array.from({ length: 10 }, (_, i) => i + 1).map(years => <option key={years} value={years}>{years} {years === 1 ? "year" : "years"}</option>)}</select></FieldLabel></div><FieldLabel label={`${service} reference`}><Input maxLength={500} placeholder="Domain, account reference or website" value={r.reference} onChange={e => patch({ reference: e.target.value })} /></FieldLabel></fieldset>; })}
      </fieldset>{error && <p role="alert">{error}</p>}<div className={styles.actions}><Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !states.length}>{busy ? "Saving…" : "Save company details"}</Button></div></form>
    </DialogContent></Dialog>}
    {upload && <UploadDocument companyId={company.id} initialCategory="Branding" onClose={() => setUpload(false)} onUploaded={docs => { const logo = docs.find(d => d.companyId === company.id && !d.orderId && d.category === "Branding" && d.visibility === "Internal" && ["image/png", "image/jpeg"].includes(d.mime || "")); if (logo) void selectLogo(logo); }} />}
  </section>;
}

export function CompanyFolders({ company, onDoc, onDirtyChange, onBusyChange }: { company: Company; onDoc: (d: VaultDoc) => void; onDirtyChange?: (v: boolean) => void; onBusyChange?: (v: boolean) => void }) {
  const { s, connection, update } = useWorkspace();
  const canEdit = canManageCompanies(connection), desk = companyDesk(company);
  const [folder, setFolder] = useState("all"), [upload, setUpload] = useState(false), [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [folderBaseline, setFolderBaseline] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [query, setQuery] = useState(""), [category, setCategory] = useState(""), [access, setAccess] = useState(""), [since, setSince] = useState(""), [designation, setDesignation] = useState("");
  const folderDirty = !!editing && editing.name !== originalName;
  useWorkspaceNavigationGuard("company-detail", { dirty: folderDirty, busy: busy || upload });
  useEffect(() => { onDirtyChange?.(folderDirty); return () => onDirtyChange?.(false); }, [folderDirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy || upload); return () => onBusyChange?.(false); }, [busy, upload, onBusyChange]);
  function openFolder(value: { id: string; name: string }) { setOriginalName(value.name); setFolderBaseline(JSON.stringify(desk.folders)); setError(""); setEditing(value); }
  const rows = s.documents.filter(d => d.companyId === company.id && !d.orderId && (folder === "trash" ? isAgencyDocumentArchived(d) : !isAgencyDocumentArchived(d) && (folder === "all" || (d.folderId || "") === folder)) && (!category || d.category === category) && (!access || d.visibility === access) && (!since || d.date >= since) && (!designation || d.designation === designation) && `${documentDisplayName(d)} ${d.name}`.toLowerCase().includes(query.toLowerCase()));
  async function saveFolder(e: React.FormEvent) {
    e.preventDefault(); if (!editing || busy) return;
    const original = folderBaseline; setBusy(true); setError("");
    try {
      const ok = await update(d => {
        const c = d.companies.find(c => c.id === company.id)!; const next = companyDesk(c);
        if (JSON.stringify(next.folders) !== original) throw new Error("Folders changed. Reopen the folder editor.");
        c.desk = { ...next, folders: [...next.folders.filter(f => f.id !== editing.id), { ...editing, name: editing.name.trim() }] };
      }, "Company folder saved", company.name);
      if (ok) setEditing(null); else setError("Folder was not saved. Check the workspace notice.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save folder."); } finally { setBusy(false); }
  }
  return <div className={styles.library} aria-label="Company file library">
    <div className={styles.heading}><div className={styles.folderButtons}><Button variant={folder === "all" ? "default" : "outline"} onClick={() => setFolder("all")}>All files</Button><Button variant={folder === "" ? "default" : "outline"} onClick={() => setFolder("")}>Unfiled</Button><Button variant={folder === "trash" ? "default" : "outline"} onClick={() => setFolder("trash")}><Trash2 size={15} />Trash</Button></div>{canEdit && <div className={styles.actions}><Button variant="outline" onClick={() => { openFolder({ id: uid("folder"), name: "" }); }}><FolderPlus size={15} />New folder</Button><Button disabled={folder === "trash"} onClick={() => setUpload(true)}><Plus size={15} />Upload</Button></div>}</div>
    {!!desk.folders.length && <div className={styles.folders}>{desk.folders.map(f => <div key={f.id} className={folder === f.id ? styles.selectedFolder : styles.folder}><button onClick={() => setFolder(f.id)}><FolderClosed size={20} /><span>{f.name}</span></button>{canEdit && <button aria-label={`Rename ${f.name}`} onClick={() => { openFolder({ ...f }); }}><Pencil size={14} /></button>}</div>)}</div>}
    <div className={styles.filters}><Input aria-label="Search company documents" placeholder="Search files…" value={query} onChange={e => setQuery(e.target.value)} /><select className="input" aria-label="Document type filter" value={category} onChange={e => setCategory(e.target.value)}><option value="">All document types</option>{[...new Set(s.documents.filter(d => d.companyId === company.id && !d.orderId).map(d => d.category))].sort().map(value => <option key={value}>{value}</option>)}</select><select className="input" aria-label="Document access filter" value={access} onChange={e => setAccess(e.target.value)}><option value="">All access levels</option><option>Internal</option><option>Restricted</option></select><select className="input" aria-label="Document designation filter" value={designation} onChange={e => setDesignation(e.target.value)}><option value="">All versions</option><option>Current</option><option>Final</option></select><FieldLabel label="Uploaded since"><Input type="date" value={since} onChange={e => setSince(e.target.value)} /></FieldLabel></div>
    <div>{rows.map(d => <div className={styles.file} key={d.id}><button onClick={() => onDoc(d)}><FolderClosed size={20} /><span><strong>{documentDisplayName(d)}</strong><small>{d.category} · v{d.version} · {d.date}{d.designation ? ` · ${d.designation}` : ""}{d.archivedAt ? " · In Trash" : ""}</small></span><ArrowRight size={15} /></button><AgencyDocumentActions doc={d} /></div>)}</div>
    {!rows.length && <div className={styles.empty}><FolderClosed size={28} /><h3>{folder === "all" ? "Add your company files" : "This folder is ready"}</h3><p>{folder === "all" ? "Upload an application, logo or formation records. Create folders to organize them your way." : "Upload files here or move existing files using their folder menu."}</p></div>}
    {editing && <Dialog open onOpenChange={v => { if (!v && !busy && (!folderDirty || window.confirm("Discard unsaved folder changes?"))) setEditing(null); }}><DialogContent className="modal"><DialogHeader><DialogTitle>{desk.folders.some(f => f.id === editing.id) ? "Rename folder" : "New folder"}</DialogTitle><DialogDescription>{company.name}</DialogDescription></DialogHeader><form className="form-stack" onSubmit={saveFolder}><FieldLabel label="Folder name"><Input autoFocus required maxLength={100} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></FieldLabel>{error && <p role="alert">{error}</p>}<Button disabled={busy || !editing.name.trim()} type="submit">Save folder</Button></form></DialogContent></Dialog>}
    {upload && <UploadDocument companyId={company.id} folderId={folder === "all" || folder === "trash" ? undefined : folder || undefined} onClose={() => setUpload(false)} />}
  </div>;
}

/** Reuses the same scoped, compare-and-swap actions from the company cabinet and master search. */
export function AgencyDocumentActions({ doc, compact = false }: { doc: VaultDoc; compact?: boolean }) {
  const store = useWorkspace(), { s, connection, update } = store;
  const live = useRef(store); useEffect(() => { live.current = store; });
  const [edit, setEdit] = useState<{ kind: "rename" | "trash"; value: string; expected: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const canEdit = canManageCompanies(connection), company = s.companies.find(company => company.id === doc.companyId);
  const archived = isAgencyDocumentArchived(doc), expected = agencyDocumentSnapshot(doc), label = documentDisplayName(doc);
  const problem = agencyDocumentArchiveProblem(s, doc);
  useWorkspaceNavigationGuard("workspace", { dirty: !!edit, busy });
  useWorkspaceNavigationGuard("company-detail", { dirty: !!edit, busy });
  if (doc.orderId || doc.sourceRole || doc.providerSource || !company) return null;
  async function run(action: (state: typeof s) => void, title: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { if (await update(action, title, label)) setEdit(null); else setError("The change was not saved. Check the workspace notice and try again."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save this document change."); }
    finally { setBusy(false); }
  }
  async function downloadOriginal() {
    setError("");
    const identity = JSON.stringify(connection ? [connection.workspaceId, connection.access] : ["local"]);
    try {
      const blob = doc.assetId ? await getAssetForDocument(doc, { expectedWorkspaceId: connection?.workspaceId || "", expectedUserId: connection?.access.userId }) : new Blob([doc.text || ""]);
      const current = live.current;
      if (identity !== JSON.stringify(current.connection ? [current.connection.workspaceId, current.connection.access] : ["local"]) || !current.s.documents.some(row => row.id === doc.id && agencyDocumentSnapshot(row) === expected)) throw new Error("Document access changed. Reopen the file.");
      download(doc.name, blob);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The original could not be downloaded."); }
  }
  return <div className={styles.documentActions}>
    <div className={styles.fileControls}><Status value={doc.visibility} /><Button variant="ghost" size="sm" onClick={() => void downloadOriginal()} aria-label={`Download ${label}`}><Download size={14} />Download</Button>
      {canEdit && (archived ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(state => restoreAgencyDocument(state, { documentId: doc.id, expected }), "Document restored")}><RotateCcw size={14} />Restore</Button> : <>
        {!compact && <select aria-label={`Folder for ${label}`} disabled={busy} value={doc.folderId || ""} onChange={e => { const folderId = e.target.value; void run(state => moveAgencyDocument(state, { documentId: doc.id, expected, folderId }), "Document folder changed"); }}><option value="">Unfiled</option>{companyDesk(company).folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(""); setEdit({ kind: "rename", value: label, expected }); }}>Rename</Button>
        <select aria-label={`Version designation for ${label}`} disabled={busy} value={doc.designation || ""} onChange={e => { const designation = e.target.value as "Current" | "Final" | ""; void run(state => designateAgencyDocument(state, { documentId: doc.id, expected, designation }), "Document designation changed"); }}><option value="">Version {doc.version}</option><option>Current</option><option>Final</option></select>
        <Button variant="ghost" size="sm" disabled={busy || !!problem} title={problem || "Move to recoverable Trash"} onClick={() => { setError(""); setEdit({ kind: "trash", value: "Incorrect or duplicate upload", expected }); }}><Trash2 size={14} />Delete</Button>
      </>)}
    </div>{archived && <p className={styles.privateNotice}>In Trash since {doc.archivedAt?.slice(0, 10)}. The original can be restored.</p>}{error && <p role="alert">{error}</p>}
    {edit && <Dialog open onOpenChange={open => { if (!open && !busy) setEdit(null); }}><DialogContent className="modal"><DialogHeader><DialogTitle>{edit.kind === "rename" ? "Rename document" : "Move document to Trash"}</DialogTitle><DialogDescription>{edit.kind === "rename" ? `Original filename: ${doc.name}. The original file and its history remain unchanged.` : "Remove an incorrect or duplicate upload from the cabinet. You can restore it from Trash."}</DialogDescription></DialogHeader><form className="form-stack" onSubmit={e => { e.preventDefault(); if (edit.kind === "rename") void run(state => renameAgencyDocument(state, { documentId: doc.id, expected: edit.expected, displayName: edit.value }), "Document renamed"); else void run(state => archiveAgencyDocument(state, { documentId: doc.id, expected: edit.expected, reason: edit.value, actor: connection?.access.userId || "local", at: new Date().toISOString() }), "Document moved to Trash"); }}><FieldLabel label={edit.kind === "rename" ? "Document name" : "Removal reason"}><Input autoFocus required maxLength={edit.kind === "rename" ? 240 : 500} value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })} /></FieldLabel>{error && <p role="alert">{error}</p>}<div className={styles.actions}><Button variant="ghost" type="button" disabled={busy} onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" disabled={busy || !edit.value.trim()}>{edit.kind === "rename" ? "Save name" : "Move to Trash"}</Button></div></form></DialogContent></Dialog>}
  </div>;
}
