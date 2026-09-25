"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Building2, Check, FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkspace, saveAsset } from "@/lib/title/store";
import { uid, type VaultDoc, type Workspace } from "@/lib/title/model";
import { getCommitment } from "@/lib/title/business";
import { sourceRoles, outputRoles, sameDocumentFamily, neededFields, titleFile, type SourceRole } from "@/lib/title/production";

type Props = { initialCategory?: string; folderId?: string; productionOnly?: boolean; applicationOnly?: boolean; onUploaded?: (documents: VaultDoc[]) => void; initialDestination?: "company" | "title"; companyId: string | null; orderId?: string; initialRole?: SourceRole; policyId?: string; commitmentVersion?: number; cplId?: string; cplVersion?: number; correctionId?: string; onClose: () => void };
type Entry = { id: string; file: File; category: string; visibility: "Internal" | "Restricted"; role: SourceRole };
const categories = ["Company records", "Formation", "Applications", "Policy documents", "Branding", "Disclosures", "Agreements"];
const categoryNames: Record<string, string> = { "Company records": "General company document / EIN", Formation: "Formation / LLC records", Applications: "Application (restricted)", "Policy documents": "Title / policy document", Branding: "Logo / branding", Disclosures: "Disclosure", Agreements: "Agreement" };
const inputRoles = sourceRoles.filter(role => !outputRoles.includes(role));
function fileProblem(entries: Entry[]) {
  if (!entries.length) return "Add at least one document.";
  if (entries.length > 10 || entries.some(e => e.file.size > 25 * 1024 * 1024) || entries.reduce((n, e) => n + e.file.size, 0) > 100 * 1024 * 1024) return "Use up to 10 files, 25 MB each and 100 MB per batch.";
  if (entries.some(e => !["application/pdf", "text/plain", "text/csv", "image/png", "image/jpeg"].includes(e.file.type))) return "Use PDF, TXT, CSV, PNG, or JPG files.";
  return "";
}
function binding(props: Props) {
  const { companyId, orderId, initialRole, policyId, commitmentVersion, cplId, cplVersion, correctionId, initialDestination, applicationOnly, productionOnly, folderId, initialCategory } = props;
  return JSON.stringify({ companyId, orderId, initialRole, policyId, commitmentVersion, cplId, cplVersion, correctionId, initialDestination, applicationOnly, productionOnly, folderId, initialCategory });
}
function outputSnapshot(state: Workspace, props: Props) {
  if (!props.initialRole || !outputRoles.includes(props.initialRole)) return "";
  const order = state.orders.find(o => o.id === props.orderId);
  if (!order) return "missing";
  return JSON.stringify({ production: titleFile(order).version,
    commitment: props.initialRole === "Commitment output" ? getCommitment(state, order) : undefined,
    policy: props.policyId ? state.business?.policies.find(p => p.id === props.policyId) : undefined,
    cpl: props.cplId ? state.business?.cpls.find(c => c.id === props.cplId) : undefined,
    correction: props.correctionId ? state.business?.corrections.find(c => c.id === props.correctionId) : undefined });
}
/** Assignment is explicit. Original bytes are uploaded only after the user reviews the batch. */
export function UploadDocument(props: Props) {
  const { companyId, orderId, initialRole, policyId, commitmentVersion, cplId, cplVersion, correctionId, onClose } = props;
  const store = useWorkspace();
  const { s, connection } = store;
  const productionOnly = props.productionOnly || connection?.access.role === "operations";
  const [company, setCompany] = useState(s.orders.find(o => o.id === orderId)?.companyId || companyId || "");
  const [kind, setKind] = useState<"company" | "title">(orderId || productionOnly || props.initialDestination === "title" ? "title" : "company");
  const [linkedOrder, setLinkedOrder] = useState(orderId || "");
  const [step, setStep] = useState(orderId || (companyId && !productionOnly && props.initialDestination !== "title") ? 2 : 1);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false), mounted = useRef(true), live = useRef({ store, props });
  useEffect(() => { live.current = { store, props }; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = JSON.stringify(connection ? [connection.workspaceId, connection.access] : ["local"]);
  const [initialIdentity] = useState(identity);
  const [initialBinding] = useState(() => binding(props));
  const [initialOutputSnapshot] = useState(() => outputSnapshot(s, props));
  const accessChanged = identity !== initialIdentity || binding(props) !== initialBinding;
  const output = !!initialRole && outputRoles.includes(initialRole);
  const selectedCompany = s.companies.find(c => c.id === company);
  const selectedOrder = s.orders.find(o => o.id === linkedOrder);
  function destinationProblem(state = s) {
    if (productionOnly && kind !== "title") return "Production documents must belong to a title file.";
    if (props.applicationOnly && (!companyId || kind !== "company" || orderId || linkedOrder || initialRole || policyId || cplId || correctionId || commitmentVersion !== undefined || cplVersion !== undefined)) return "Reopen the application upload from its company.";
    if (accessChanged) return "Your account, access, or upload context changed. Close this dialog and reopen Upload documents.";
    if (!state.companies.some(c => c.id === company)) return "Choose the company these documents belong to.";
    if (connection && !connection.access.allCompanies && !connection.access.companyIds.includes(company)) return "You no longer have access to this company. Close this dialog and refresh.";
    if (companyId && company !== companyId) return "This upload belongs to a different company. Reopen it from the correct company.";
    if (kind === "company") {
      if (props.folderId && !state.companies.find(c => c.id === company)?.desk?.folders.some(f => f.id === props.folderId)) return "This folder changed. Reopen the upload.";
      if (orderId || output || policyId || cplId || correctionId || commitmentVersion !== undefined || cplVersion !== undefined) return "Open this upload from the title file's document workflow.";
      return "";
    }
    const order = state.orders.find(o => o.id === linkedOrder && o.companyId === company);
    if (!order || (orderId && order.id !== orderId)) return "Choose an existing title file belonging to this company.";
    if (output) {
      if (!orderId || !initialRole) return "Open this upload from its title-file workflow.";
      if (outputSnapshot(state, props) !== initialOutputSnapshot) return "This title file changed while the upload was open. Reopen its upload to use the current version.";
      if (initialRole === "Commitment output") {
        const commitment = getCommitment(state, order);
        if (commitmentVersion === undefined || commitment.version !== commitmentVersion || !commitment.snapshot) return "Prepare and review this commitment before adding its output.";
      }
      if (initialRole === "Final policy") {
        const policy = state.business?.policies.find(p => p.id === policyId && p.orderId === order.id);
        if (!policy?.preparedSnapshot || policy.status !== "Prepared") return "Prepare this policy before adding its final document.";
      }
      if (initialRole === "CPL") {
        const cpl = state.business?.cpls.find(c => c.id === cplId && c.orderId === order.id);
        if (!cpl?.snapshot || cplVersion === undefined || cpl.version !== cplVersion) return "Prepare this CPL before adding its returned document.";
      }
      if (initialRole === "Correction output") {
        const correction = state.business?.corrections.find(c => c.id === correctionId && c.orderId === order.id);
        if (!correction?.reviewSnapshot || correction.status !== "Reviewed") return "Review this correction before adding its document.";
      }
    } else if (policyId || cplId || correctionId || commitmentVersion !== undefined || cplVersion !== undefined) return "Open this upload from its title-file workflow.";
    return "";
  }
  function assertCurrent() {
    const { store: current, props: currentProps } = live.current;
    const currentIdentity = JSON.stringify(current.connection ? [current.connection.workspaceId, current.connection.access] : ["local"]);
    if (!mounted.current || currentIdentity !== initialIdentity || binding(currentProps) !== initialBinding) throw new Error("Your account, access, or upload context changed. Close this dialog and reopen Upload documents.");
    const problem = destinationProblem(current.s);
    if (problem) throw new Error(problem);
    return current;
  }
  function proposedVersion(entry: Entry, index: number) {
    const family = (item: Entry) => ({ companyId: company, orderId: kind === "title" ? linkedOrder : undefined, sourceRole: kind === "title" ? item.role : undefined, name: item.file.name, policyId, cplId, correctionId }) as VaultDoc;
    const target = family(entry);
    return Math.max(0, ...s.documents.filter(doc => sameDocumentFamily(doc, target)).map(doc => doc.version)) + 1 + entries.slice(0, index).filter(prior => sameDocumentFamily(family(prior), target)).length;
  }
  function patchEntry(id: string, patch: Partial<Entry>) {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch, ...((patch.category || entry.category) === "Applications" ? { visibility: "Restricted" as const } : {}) } : entry)); setError("");
  }
  function next() {
    const problem = destinationProblem() || (step === 2 ? fileProblem(entries) : "");
    if (problem) { setError(problem); return; }
    setError(""); setStep(step + 1);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (writing.current) return;
    if (step !== 3 && !props.applicationOnly) { next(); return; }
    const problem = destinationProblem() || fileProblem(entries) || (props.applicationOnly && (entries.length !== 1 || entries.some(entry => entry.category !== "Applications" || entry.visibility !== "Restricted" || entry.file.type === "text/csv")) ? "Choose one completed application as a PDF, TXT, PNG, or JPG." : "");
    if (problem) { setError(problem); return; }
    if (entries.some(e => !categories.includes(e.category) || (e.category === "Applications" && e.visibility !== "Restricted") || (kind === "title" && !(output ? e.role === initialRole : inputRoles.includes(e.role))))) { setError("Review each document's category, access, and type before saving."); return; }
    if (connection && !connection.access.restricted && entries.some(e => e.visibility === "Restricted")) { setError("Restricted documents require restricted-document access. Ask an administrator to upload these originals."); return; }
    writing.current = true; setBusy(true); setError("");
    try {
      const before = assertCurrent();
      const existingEntries = entries.map(entry => ({ entry, saved: before.s.documents.find(doc => doc.id === entry.id) }));
      if (existingEntries.some(item => item.saved)) {
        const complete = existingEntries.every(({ entry, saved: doc }) => doc && doc.assetId === entry.id && (doc.folderId || "") === (kind === "company" ? props.folderId || "" : "") && doc.companyId === company && doc.orderId === (kind === "title" ? linkedOrder : undefined) && doc.sourceRole === (kind === "title" ? entry.role : undefined) && doc.name === entry.file.name && doc.mime === entry.file.type && doc.category === entry.category && doc.visibility === entry.visibility && doc.policyId === policyId && doc.cplId === cplId && doc.correctionId === correctionId && doc.commitmentVersion === commitmentVersion && doc.cplVersion === cplVersion);
        if (complete) { props.onUploaded?.(existingEntries.map(item => item.saved!)); onClose(); return; }
        throw new Error("Some selected documents were already saved with different details. Close this dialog and review the saved documents before uploading again.");
      }
      const uploaded: VaultDoc[] = [];
      for (const entry of entries) {
        assertCurrent();
        const { file, id, role } = entry;
        const doc: VaultDoc = {
          id, companyId: company, orderId: kind === "title" ? linkedOrder : undefined, sourceRole: kind === "title" ? role : undefined, policyId, correctionId,
          preparationFingerprint: kind === "title" && role === "Commitment output" ? getCommitment(before.s, before.s.orders.find(o => o.id === linkedOrder)!).snapshot : role === "Final policy" ? before.s.business?.policies.find(p => p.id === policyId)?.preparedSnapshot : role === "CPL" ? before.s.business?.cpls.find(c => c.id === cplId)?.snapshot : role === "Correction output" ? before.s.business?.corrections.find(c => c.id === correctionId)?.reviewSnapshot : undefined,
          commitmentVersion, cplId, cplVersion, policyVersion: policyId ? before.s.business?.policies.find(p => p.id === policyId)?.version : undefined,
          productionVersion: kind === "title" && outputRoles.includes(role) ? titleFile(before.s.orders.find(o => o.id === linkedOrder)!).version : undefined,
          folderId: kind === "company" ? props.folderId : undefined, name: file.name, category: entry.category, visibility: entry.visibility, date: new Date().toISOString().slice(0, 10), size: `${Math.max(1, Math.round(file.size / 1024))} KB`, version: 1, assetId: id, mime: file.type,
        };
        doc.version = Math.max(0, ...[...before.s.documents, ...uploaded].filter(d => sameDocumentFamily(d, doc)).map(d => d.version)) + 1;
        if (outputRoles.includes(role) && before.s.documents.some(d => d.companyId === doc.companyId && d.orderId === doc.orderId && d.name === doc.name && !outputRoles.includes(d.sourceRole!))) throw new Error("Use a distinct filename for this output so it cannot replace a final-source document.");
        uploaded.push(doc);
      }
      for (const entry of entries) {
        assertCurrent();
        await saveAsset(entry.id, entry.file, { companyId: company, documentId: entry.id, expectedUserId: before.connection?.access.userId, expectedWorkspaceId: before.connection?.workspaceId });
        assertCurrent();
      }
      const current = assertCurrent();
      const saved = await current.update(d => {
        assertCurrent();
        const changed = destinationProblem(d); if (changed) throw new Error(changed);
        for (const doc of uploaded) {
          if (d.documents.some(existing => existing.id === doc.id)) throw new Error("Some selected documents were already saved. Close this dialog and review the saved documents before uploading again.");
          if (outputRoles.includes(doc.sourceRole!) && d.documents.some(existing => existing.companyId === doc.companyId && existing.orderId === doc.orderId && existing.name === doc.name && !outputRoles.includes(existing.sourceRole!))) throw new Error("Use a distinct filename for this output so it cannot replace a final-source document.");
          doc.version = Math.max(0, ...d.documents.filter(existing => sameDocumentFamily(existing, doc)).map(existing => existing.version)) + 1;
          d.documents.unshift(doc);
        }
        const order = kind === "title" ? d.orders.find(o => o.id === linkedOrder) : undefined;
        const sourceTypes = uploaded.filter(doc => !outputRoles.includes(doc.sourceRole!)).map(doc => doc.sourceRole);
        if (order && order.status !== "Issued" && sourceTypes.length) {
          order.production = { ...titleFile(order), commitmentReview: undefined, version: titleFile(order).version + 1 };
          order.fields.forEach(field => { if (sourceTypes.includes(neededFields(order).find(item => item.id === field.id)?.role)) field.reviewed = false; });
          if (order.status === "Ready for jacket") order.status = "Needs review";
        }
      }, connection ? "Documents saved to workspace" : "Documents saved locally", `${uploaded.length} files · ${selectedCompany?.name || company}`, before.connection?.revision);
      if (saved) { assertCurrent(); props.onUploaded?.(uploaded); onClose(); } else setError("The save could not be confirmed. Your selected files are still here. Check the save message and saved documents, then try again.");
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setError(/changed|Choose|Prepare|Review|distinct filename|workflow|access|already saved/.test(message) ? message : connection ? "The upload could not be completed. Check your connection and company access, then try again." : "The file could not be stored in this browser. Try a smaller file.");
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !writing.current) onClose(); }}><DialogContent className="modal allocation-upload" onEscapeKeyDown={event => { if (writing.current) event.preventDefault(); }} onInteractOutside={event => { if (writing.current) event.preventDefault(); }}>
    <style>{css}</style>
    <DialogHeader><DialogTitle>{props.applicationOnly ? "Upload completed application" : "Upload documents"}</DialogTitle><DialogDescription>{connection ? "Upload original company and file documents you are authorized to use. Files are stored in your private workspace; company and document permissions apply." : "Use sample or redacted files in this local demo. Files stay in this browser and are not shared with your team."}</DialogDescription></DialogHeader>
    {!props.applicationOnly && <ol className="allocation-steps" aria-label="Upload progress">{["Choose destination", "Add documents", "Review & save"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>}
    {selectedCompany && <div className="allocation-destination"><Building2 size={19} /><div><small>Saving to</small><strong>{selectedCompany.name}</strong><span>{kind === "title" ? `Title file documents${selectedOrder ? ` · ${selectedOrder.id} · ${selectedOrder.address}` : ""}` : props.applicationOnly ? "Private company application · Restricted access" : "Company documents"}</span></div></div>}
    <form onSubmit={submit} className="allocation-form"><fieldset disabled={busy || accessChanged} className="allocation-fields">
      {step === 1 && <><h3>Where do these documents belong?</h3><label className="allocation-field">Company<select aria-label="Upload company" value={company} disabled={!!companyId || !!orderId} onChange={event => { setCompany(event.target.value); setLinkedOrder(""); setEntries(current => current.map(entry => ({ ...entry, id: uid("doc") }))); setError(""); }}><option value="">Choose a company…</option>{s.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {!s.companies.length && <p>Add a company or ask an administrator to give you company access before uploading.</p>}
        <div className="allocation-types" role="group" aria-label="Document destination">{!productionOnly && <button type="button" aria-pressed={kind === "company"} disabled={!!orderId} onClick={() => { setKind("company"); setError(""); }}><strong>Company documents</strong><span>Formation, EIN, applications, logos and agreements for the business.</span></button>}<button type="button" aria-pressed={kind === "title"} onClick={() => { setKind("title"); setError(""); }}><strong>Title file documents</strong><span>Deeds, searches, opinions and policies for a specific property.</span></button></div>
        {kind === "title" && <label className="allocation-field">Title file<select aria-label="Link upload to order" value={linkedOrder} disabled={!!orderId} onChange={event => { setLinkedOrder(event.target.value); setError(""); }}><option value="">Choose an existing title file…</option>{s.orders.filter(order => order.companyId === company).map(order => <option key={order.id} value={order.id}>{order.id} · {order.address}</option>)}</select>{!s.orders.some(order => order.companyId === company) && <small>Create a title file for this company first, then add its documents.</small>}</label>}
      </>}
      {step === 2 && <><h3>Add the originals for {selectedCompany?.name || "this company"}</h3><p className="allocation-explanation">{props.applicationOnly ? "Choose the completed application. We’ll save the original here and read it to suggest application details." : "You’ll check each document’s category and access before saving."}</p><label className="allocation-drop"><Upload size={25} /><strong>{props.applicationOnly ? entries.length ? "Choose a different application" : "Choose completed application" : entries.length ? "Add more documents" : "Choose documents"}</strong><span>{props.applicationOnly ? "One application · Up to 120 pages / 25 MB" : "Up to 10 files · 25 MB each · 100 MB per batch"}</span><Input aria-label={props.applicationOnly ? "Select completed application" : "Select documents"} type="file" multiple={!props.applicationOnly} accept={props.applicationOnly ? ".pdf,.txt,.png,.jpg,.jpeg" : ".pdf,.txt,.csv,.png,.jpg,.jpeg"} onChange={event => { const added = Array.from(event.target.files || []).map(file => ({ id: uid("doc"), file, category: props.applicationOnly ? "Applications" : kind === "title" ? "Policy documents" : props.initialCategory || "Company records", visibility: props.applicationOnly ? "Restricted" as const : "Internal" as const, role: initialRole || "Other" as SourceRole })); setEntries(current => props.applicationOnly ? added : [...current, ...added]); setError(""); event.target.value = ""; }} /></label></>}
      {step === 3 && <><h3>Check where each document will go</h3><p className="allocation-explanation">Review the destination and details, then choose who may view each original before saving.</p>{kind === "title" && <p className="allocation-explanation">{output ? `This workflow adds ${initialRole} documents to the selected title-file version.` : "Choose the type for each title document. Not sure yet keeps it unclassified; choose its source type before capturing fields."}</p>}</>}
      {step > 1 && entries.length > 0 && <div className="allocation-files"><p className="allocation-count">{entries.length} {entries.length === 1 ? "document" : "documents"} · {(entries.reduce((n, e) => n + e.file.size, 0) / 1024 / 1024).toFixed(1)} MB selected</p>{entries.map((entry, index) => <article className="allocation-file" key={entry.id}><div className="allocation-filename"><FileText size={19} /><strong>{entry.file.name}</strong><span>{Math.max(1, Math.round(entry.file.size / 1024))} KB</span><button type="button" aria-label={`Remove ${entry.file.name}`} onClick={() => { setEntries(current => current.filter(e => e.id !== entry.id)); setError(""); }}><X size={17} /></button></div>{step === 3 && <div className="allocation-metadata" data-title={kind === "title"}><p className="allocation-version">Will save as version {proposedVersion(entry, index)}</p>
        <label className="allocation-field">Category<select aria-label={entries.length === 1 ? "Document category" : `Document category for ${entry.file.name} (${index + 1})`} value={entry.category} onChange={event => patchEntry(entry.id, { category: event.target.value })}>{categories.map(category => <option key={category} value={category}>{categoryNames[category]}</option>)}</select></label>
        {kind === "title" && <label className="allocation-field">Document type<select aria-label={entries.length === 1 ? "Uploaded source type" : `Source type for ${entry.file.name} (${index + 1})`} value={entry.role} disabled={output} onChange={event => patchEntry(entry.id, { role: event.target.value as SourceRole })}>{(output && initialRole ? [initialRole] : inputRoles).map(role => <option key={role} value={role}>{role === "Other" ? "Not sure yet" : role}</option>)}</select></label>}
        <label className="allocation-field">{connection ? "Document access" : "Visibility label"}<select aria-label={entries.length === 1 ? "Document visibility" : `Document visibility for ${entry.file.name} (${index + 1})`} value={entry.visibility} disabled={entry.category === "Applications"} onChange={event => patchEntry(entry.id, { visibility: event.target.value as Entry["visibility"] })}>{entry.category !== "Applications" && <option value="Internal">Internal</option>}<option value="Restricted">Restricted</option></select>{entry.category === "Applications" && <small>Applications always use restricted access.</small>}</label>
      </div>}</article>)}</div>}
      {step === 3 && <p className="allocation-explanation">Internal documents follow company access. Restricted documents also require restricted-document permission. Uploading the same filename to the same company and title file creates a new version.</p>}
    </fieldset>
    <p className="allocation-explanation">{connection ? "Saving does not email or publish these documents." : "Files stay in this browser; visibility labels do not grant team access."}</p>
    {(error || accessChanged) && <p role="alert" className="allocation-error">{accessChanged ? "Your account, access, or upload context changed. Close this dialog and reopen Upload documents." : error}</p>}
    <div className="allocation-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><div>{step > 1 && !props.applicationOnly && <Button type="button" variant="ghost" disabled={busy || accessChanged} onClick={() => { setStep(step - 1); setError(""); }}><ArrowLeft size={15} />Back</Button>}<Button type="submit" disabled={busy || accessChanged || (step === 1 ? !company || (kind === "title" && !linkedOrder) : !entries.length)}>{busy ? "Saving…" : props.applicationOnly ? "Upload and read application" : step === 1 ? "Continue" : step === 2 ? "Review documents" : "Save documents"}</Button></div></div>
    </form></DialogContent></Dialog>;
}
const css = `
.allocation-upload{width:min(720px,calc(100vw - 24px));max-width:720px!important;max-height:calc(100dvh - 32px);overflow-y:auto}
.allocation-steps{display:flex;justify-content:space-between;gap:12px;margin:4px 0 0;padding:0;list-style:none;color:#748499;font-size:12px}.allocation-steps li{display:flex;align-items:center;gap:7px}.allocation-steps li>span{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#edf2f7;flex:none}.allocation-steps li[aria-current]{color:#063659;font-weight:650}.allocation-steps li[aria-current]>span{color:white;background:#063659}
.allocation-destination{display:flex;align-items:flex-start;gap:12px;padding:15px;border:1px solid #cbdbea;border-radius:14px;background:#f2f7fb;color:#063659}.allocation-destination>svg{flex:none;margin-top:4px}.allocation-destination div{min-width:0;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}.allocation-destination small{color:#6c7c90;font-size:11px}.allocation-destination strong{font-size:16px}.allocation-destination span{font-size:12px}
.allocation-form,.allocation-fields{display:flex;flex-direction:column;gap:16px;min-width:0}.allocation-fields{border:0;margin:0;padding:0}.allocation-fields h3{font-size:16px;font-weight:650;margin:0}.allocation-field{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:550;min-width:0}.allocation-field select{display:block;width:100%;min-height:40px;border:1px solid #cbd9e6;border-radius:9px;color:#183a56;background:white;font:inherit;padding:8px;min-width:0}.allocation-field select:focus-visible,.allocation-types button:focus-visible,.allocation-filename button:focus-visible{outline:2px solid #2878be;outline-offset:2px}.allocation-field select:disabled{color:#576f84;background:#f2f5f8}.allocation-field small{color:#697b8e;font-size:11px;font-weight:400}
.allocation-types{display:grid;grid-template-columns:1fr 1fr;gap:10px}.allocation-types button{display:flex;flex-direction:column;text-align:left;gap:7px;padding:15px;border:1px solid #d1dce7;border-radius:12px;background:#fff}.allocation-types button[aria-pressed=true]{background:#edf5fc;border-color:#5584af;box-shadow:0 0 0 1px #5584af}.allocation-types button:disabled{opacity:.6}.allocation-types strong{font-size:13px}.allocation-types span,.allocation-explanation{font-size:12px;line-height:1.6;color:#687c91;margin:0}
.allocation-drop{display:flex;flex-direction:column;align-items:center;gap:9px;padding:22px 14px;border:1px dashed #92afc9;border-radius:13px;background:#f8fbfe;color:#284e70}.allocation-drop strong{font-size:14px}.allocation-drop span{font-size:11px;text-align:center}.allocation-drop input{max-width:100%;min-height:38px;font-size:12px;min-width:0}.allocation-files{display:flex;flex-direction:column;gap:10px}.allocation-count{font-size:12px;color:#607a90;margin:0}.allocation-file{border:1px solid #d7e2ec;border-radius:12px;padding:13px;min-width:0;background:#fff}.allocation-filename{display:flex;align-items:center;gap:9px;min-width:0}.allocation-filename>svg{flex:none;color:#6c88a0}.allocation-filename strong{font-size:12px;font-weight:550;overflow-wrap:anywhere;flex:1;min-width:0}.allocation-filename span{font-size:11px;color:#728699;white-space:nowrap}.allocation-filename button{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:8px;color:#6f8394;background:#f4f7fa;border:0}.allocation-version{grid-column:1/-1;margin:0;font-size:11px;color:#607a90}.allocation-metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.allocation-metadata[data-title=true]{grid-template-columns:repeat(3,minmax(0,1fr))}.allocation-error{margin:0;padding:12px;border:1px solid #e8c1b8;background:#fff5f1;color:#a23b24;border-radius:10px;font-size:12px;line-height:1.6}.allocation-actions{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #e1e8ef;padding-top:14px}.allocation-actions>div{display:flex;gap:8px}
@media(max-width:480px){.allocation-upload{padding:17px}.allocation-steps{gap:5px;font-size:10px}.allocation-steps li{gap:4px}.allocation-steps li>span{width:20px;height:20px}.allocation-types,.allocation-metadata,.allocation-metadata[data-title=true]{grid-template-columns:1fr}.allocation-filename{flex-wrap:wrap}.allocation-filename strong{flex-basis:calc(100% - 32px)}.allocation-actions,.allocation-actions>div{gap:4px}.allocation-actions button{padding-inline:10px;font-size:12px}}
`;
