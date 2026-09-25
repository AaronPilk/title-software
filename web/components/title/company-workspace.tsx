"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, FolderClosed, FolderPlus, ImagePlus, Pencil, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/title/store";
import { companyDesk, emptyCompanyDesk, nextServiceRenewal, type CompanyDesk, type ServiceRenewal } from "@/lib/title/company-workspace";
import { saveCompanyUnderwriters } from "@/lib/title/business";
import { type Company, type VaultDoc, uid } from "@/lib/title/model";
import { canManageCompanies, canManageOnboardingEvidence } from "@/lib/title/workspace-capabilities";
import { FieldLabel, Status } from "./shared";
import { UploadDocument } from "./document-upload";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import styles from "./company-workspace.module.css";

export function CompanyCardFacts({ company }: { company: Company }) {
  const { s } = useWorkspace();
  const underwriters = s.business?.onboarding.find(row => row.companyId === company.id)?.requiredUnderwriters || [];
  const next = nextServiceRenewal(company);
  return <div className={styles.cardFacts}>{!!underwriters.length && <span>{underwriters.join(" · ")}</span>}{next && <span><CalendarDays size={13} />{next.service} renews {next.renewalOn}</span>}</div>;
}

export function CompanyOverviewDetails({ company, onDirtyChange, onBusyChange }: { company: Company; onDirtyChange?: (v: boolean) => void; onBusyChange?: (v: boolean) => void }) {
  const { s, connection, update } = useWorkspace();
  const canEdit = canManageCompanies(connection), canUnderwriters = canManageOnboardingEvidence(connection);
  const [editing, setEditing] = useState(false), [upload, setUpload] = useState(false);
  const [draft, setDraft] = useState<CompanyDesk>(emptyCompanyDesk), [states, setStates] = useState<string[]>([]), [writers, setWriters] = useState<string[]>([]);
  const [rawBaseline, setRawBaseline] = useState("");
  const [baseline, setBaseline] = useState(""), [priorWriters, setPriorWriters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false);
  const current = companyDesk(company), underwriters = s.business?.onboarding.find(row => row.companyId === company.id)?.requiredUnderwriters || [];
  const snapshot = (c: Company) => JSON.stringify({ desk: c.desk, states: c.operatingStates || [c.jurisdiction] });
  const dirty = editing && (JSON.stringify({ desk: draft, states }) !== baseline || JSON.stringify(writers) !== JSON.stringify(priorWriters));
  useWorkspaceNavigationGuard("company-detail", { dirty, busy: busy || upload });
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy || upload); return () => onBusyChange?.(false); }, [busy, upload, onBusyChange]);
  function edit() {
    setRawBaseline(snapshot(company)); setDraft(structuredClone(current)); setStates((company.operatingStates || [company.jurisdiction]).filter(Boolean)); setWriters([...underwriters]); setPriorWriters([...underwriters]);
    setBaseline(JSON.stringify({ desk: current, states: (company.operatingStates || [company.jurisdiction]).filter(Boolean) })); setError(""); setEditing(true);
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
        c.desk = structuredClone(draft);
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
  const logos = s.documents.filter(d => d.companyId === company.id && !d.orderId && d.category === "Branding" && d.visibility === "Internal" && !!d.assetId && ["image/png", "image/jpeg"].includes(d.mime || ""));
  return <section className={styles.overview} aria-label="Company at a glance">
    <header className={styles.heading}><div><h3>Company details</h3><p>States, underwriters and important dates.</p></div>{canEdit && <Button variant="outline" size="sm" onClick={edit}><Pencil size={14} />Edit details</Button>}</header>
    <div className={styles.facts}><div><small>Operating states</small><strong>{(company.operatingStates || [company.jurisdiction]).filter(Boolean).map(s => s === "NC" ? "North Carolina" : s === "SC" ? "South Carolina" : s).join(" · ") || "Add operating states"}</strong></div><div><small>Underwriters</small><strong>{underwriters.join(" · ") || "Choose underwriters"}</strong></div></div>
    <div className={styles.renewals}>{(["Domain", "Email", "Website"] as const).map(service => { const r = current.renewals.find(r => r.service === service); return <div key={service}><CalendarDays size={18} /><small>{service} renewal</small><strong>{r?.renewalOn || "Add a date"}</strong>{r?.provider && <span>{r.provider}</span>}</div>; })}</div>
    {canEdit && <Button variant="ghost" onClick={() => setUpload(true)}><ImagePlus size={16} />Upload company logo</Button>}
    {editing && <Dialog open onOpenChange={v => { if (!v) close(); }}><DialogContent className="modal"><DialogHeader><DialogTitle>Company details</DialogTitle><DialogDescription>{company.name}</DialogDescription></DialogHeader>
      <form className="form-stack" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy} className={styles.fieldset}>
        <FieldLabel label="Company logo"><select className="input" aria-label="Company logo" value={draft.logoDocumentId} onChange={e => setDraft({ ...draft, logoDocumentId: e.target.value })}><option value="">Use initials</option>{logos.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FieldLabel>
        <fieldset><legend className="mb-2 text-sm font-medium">Operating states</legend><div className={styles.checks}>{[...new Set(["NC", "SC", ...states])].map(code => <label key={code}><input type="checkbox" disabled={code === company.jurisdiction} checked={states.includes(code)} onChange={e => setStates(e.target.checked ? [...states, code] : states.filter(v => v !== code))} />{code === "NC" ? "North Carolina" : code === "SC" ? "South Carolina" : code}</label>)}</div></fieldset>
        {canUnderwriters && <fieldset><legend className="mb-2 text-sm font-medium">Underwriters</legend><div className={styles.checks}>{[...new Set(["WFG", "Commonwealth", "First American", ...priorWriters])].map(name => <label key={name}><input type="checkbox" checked={writers.includes(name)} onChange={e => setWriters(e.target.checked ? [...writers, name] : writers.filter(v => v !== name))} />{name}</label>)}</div><small>Record which underwriters the company works with. Approval evidence stays in the application records.</small></fieldset>}
        {(["Domain", "Email", "Website"] as const).map(service => { const r = draft.renewals.find(r => r.service === service) || { service, renewalOn: "", provider: "", reference: "" }; const patch = (values: Partial<ServiceRenewal>) => setDraft({ ...draft, renewals: [...draft.renewals.filter(x => x.service !== service), { ...r, ...values }] }); return <fieldset key={service} className={styles.service}><legend>{service}</legend><div className="form-grid"><FieldLabel label={`${service} renewal date`}><Input type="date" value={r.renewalOn} onChange={e => patch({ renewalOn: e.target.value })} /></FieldLabel><FieldLabel label={`${service} provider`}><Input maxLength={200} value={r.provider} onChange={e => patch({ provider: e.target.value })} /></FieldLabel></div><FieldLabel label={`${service} reference`}><Input maxLength={500} placeholder="Domain, account reference or website" value={r.reference} onChange={e => patch({ reference: e.target.value })} /></FieldLabel></fieldset>; })}
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
  const folderDirty = !!editing && editing.name !== originalName;
  useWorkspaceNavigationGuard("company-detail", { dirty: folderDirty, busy: busy || upload });
  useEffect(() => { onDirtyChange?.(folderDirty); return () => onDirtyChange?.(false); }, [folderDirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy || upload); return () => onBusyChange?.(false); }, [busy, upload, onBusyChange]);
  function openFolder(value: { id: string; name: string }) { setOriginalName(value.name); setFolderBaseline(JSON.stringify(desk.folders)); setError(""); setEditing(value); }
  const rows = s.documents.filter(d => d.companyId === company.id && !d.orderId && (folder === "all" || (d.folderId || "") === folder));
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
    <div className={styles.heading}><div className={styles.folderButtons}><Button variant={folder === "all" ? "default" : "outline"} onClick={() => setFolder("all")}>All files</Button><Button variant={folder === "" ? "default" : "outline"} onClick={() => setFolder("")}>Unfiled</Button></div>{canEdit && <div className={styles.actions}><Button variant="outline" onClick={() => { openFolder({ id: uid("folder"), name: "" }); }}><FolderPlus size={15} />New folder</Button><Button onClick={() => setUpload(true)}><Plus size={15} />Upload</Button></div>}</div>
    {!!desk.folders.length && <div className={styles.folders}>{desk.folders.map(f => <div key={f.id} className={folder === f.id ? styles.selectedFolder : styles.folder}><button onClick={() => setFolder(f.id)}><FolderClosed size={20} /><span>{f.name}</span></button>{canEdit && <button aria-label={`Rename ${f.name}`} onClick={() => { openFolder({ ...f }); }}><Pencil size={14} /></button>}</div>)}</div>}
    <div>{rows.map(d => <div className={styles.file} key={d.id}><button onClick={() => onDoc(d)}><FolderClosed size={20} /><span><strong>{d.name}</strong><small>{d.category} · v{d.version}</small></span><ArrowRight size={15} /></button><div className={styles.fileControls}><Status value={d.visibility} />{canEdit && <select aria-label={`Folder for ${d.name}`} value={d.folderId || ""} onChange={e => { const value = e.target.value; void update(state => { const doc = state.documents.find(row => row.id === d.id); if (!doc || (doc.folderId || "") !== (d.folderId || "")) throw new Error("Document folder changed. Refresh and try again."); doc.folderId = value; }, "Document folder changed", company.name); }}><option value="">Unfiled</option>{desk.folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}</div></div>)}</div>
    {!rows.length && <div className={styles.empty}><FolderClosed size={28} /><h3>{folder === "all" ? "Add your company files" : "This folder is ready"}</h3><p>{folder === "all" ? "Upload an application, logo or formation records. Create folders to organize them your way." : "Upload files here or move existing files using their folder menu."}</p></div>}
    {editing && <Dialog open onOpenChange={v => { if (!v && !busy && (!folderDirty || window.confirm("Discard unsaved folder changes?"))) setEditing(null); }}><DialogContent className="modal"><DialogHeader><DialogTitle>{desk.folders.some(f => f.id === editing.id) ? "Rename folder" : "New folder"}</DialogTitle><DialogDescription>{company.name}</DialogDescription></DialogHeader><form className="form-stack" onSubmit={saveFolder}><FieldLabel label="Folder name"><Input autoFocus required maxLength={100} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></FieldLabel>{error && <p role="alert">{error}</p>}<Button disabled={busy || !editing.name.trim()} type="submit">Save folder</Button></form></DialogContent></Dialog>}
    {upload && <UploadDocument companyId={company.id} folderId={folder === "all" ? undefined : folder || undefined} onClose={() => setUpload(false)} />}
  </div>;
}
