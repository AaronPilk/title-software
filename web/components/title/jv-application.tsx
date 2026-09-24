"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Check, FileText, LockKeyhole, Plus, Save, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/title/store";
import type { Company, VaultDoc } from "@/lib/title/model";
import { JV_STEPS, jvReadiness, newJVApplicant, validateJVApplication, type JVApplicant, type JVApplication, type JVRecord, type JVStep } from "@/lib/title/jv-application";
import { jvIntakeClientRequest, type JVIntakeAction, type JVIntakeContext } from "@/lib/backend/jv-intake-client";
import { FieldLabel, Picker, Status } from "./shared";
import { JVApplicationReader } from "./jv-application-reader";
import { JVPortalRequests } from "./jv-portal-requests";
import { applyJVApplicationFill } from "@/lib/title/jv-application-fill";
import { UploadDocument } from "./document-upload";
import styles from "./jv-application-flow.module.css";
import type { JVApplicationFillPatch } from "@/lib/title/jv-extraction";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import type { WorkspaceNavigationScope } from "@/lib/title/workspace-navigation-guard";

const sections = ["Applicants", "Ownership & history", "Branding & documents", "Review", "Setup checklist"] as const;
const stepStatuses: JVStep["status"][] = ["Not started", "In progress", "Complete", "Not applicable"];
const errorStatus = (error: unknown) => error && typeof error === "object" && "status" in error ? error.status : undefined;
const requestMessage = (error: unknown) => errorStatus(error) === 409
  ? "This application changed since you opened it. Reload the latest version before saving again."
  : errorStatus(error) === 401 || errorStatus(error) === 403
    ? "Your access changed or your session ended. Sign in with access to this company and reopen its private application."
    : "The private application could not be saved or loaded. Check the entries and connection, then try again.";

type PanelProps = { company: Company; onDocuments?: () => void; existingCompany?: boolean; initiallyOpen?: boolean; entryAction?: "upload" | "link"; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; navigationScope?: WorkspaceNavigationScope };
export function JVApplicationPanel({ company, onDocuments, existingCompany = false, initiallyOpen = false, entryAction, onDirtyChange, onBusyChange, navigationScope = "workspace" }: PanelProps) {
  const { s, connection } = useWorkspace();
  if (!connection) return <section className="panel jv-panel" aria-label="Joint venture application"><header className="jv-header"><LockKeyhole size={19} aria-hidden="true" /><div><h3>Joint venture application</h3><p className="form-note">Sign in to a shared workspace to use the protected application. Personal intake is unavailable in local mode.</p></div></header></section>;
  const { access, workspaceId } = connection;
  const allowed = ["owner", "admin", "onboarding"].includes(access.role) && access.restricted && (access.allCompanies || access.companyIds.includes(company.id)) && s.companies.some(item => item.id === company.id);
  if (!allowed) return null;
  const scope = JSON.stringify([workspaceId, access.userId, access.version, access.role, access.restricted, access.allCompanies, access.companyIds, company.id]);
  const originals = s.documents.filter(doc => doc.companyId === company.id && !doc.orderId && doc.category === "Applications" && doc.visibility === "Restricted" && !!doc.assetId);
  return <JVApplicationWorkspace key={scope} context={{ workspaceId, userId: access.userId, companyId: company.id }} originals={originals} onDocuments={onDocuments} existingCompany={existingCompany} initiallyOpen={initiallyOpen} entryAction={entryAction} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} navigationScope={navigationScope} />;
}

function JVApplicationWorkspace({ context, originals, onDocuments, existingCompany, initiallyOpen, entryAction, onDirtyChange, onBusyChange, navigationScope }: { context: JVIntakeContext; originals: VaultDoc[]; onDocuments?: () => void; existingCompany: boolean; initiallyOpen: boolean; entryAction?: "upload" | "link"; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; navigationScope: WorkspaceNavigationScope }) {
  const { connection } = useWorkspace();
  const [opened, setOpened] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false), [manualOpen, setManualOpen] = useState(false), [linksOpen, setLinksOpen] = useState(entryAction === "link");
  const [portalDirty, setPortalDirty] = useState(false), [portalBusy, setPortalBusy] = useState(false);
  const [readerDirty, setReaderDirty] = useState(false);
  const [sourceSelection, setSourceSelection] = useState({ id: "", generation: 0 });
  const pendingUpload = useRef(false);
  const [record, setRecord] = useState<JVRecord | null>(null);
  const [draft, setDraft] = useState<JVApplication | null>(null);
  const [section, setSection] = useState(0);
  const [applicantIndex, setApplicantIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const alive = useRef(true), working = useRef(false), generation = useRef(0);
  const contentId = useId();
  const payloadDirty = !!record && !!draft && JSON.stringify(draft) !== JSON.stringify(record.payload);
  const noteDirty = record?.status === "Ready for review" && reviewNote !== record.reviewNote;
  const dirty = payloadDirty || noteDirty || readerDirty;
  const navigationDirty = dirty || portalDirty;
  useWorkspaceNavigationGuard(navigationScope, { dirty: navigationDirty, busy: busy || portalBusy || uploadOpen });
  const dirtyCallback = useRef(onDirtyChange);
  useEffect(() => { dirtyCallback.current = onDirtyChange; });
  useEffect(() => { dirtyCallback.current?.(navigationDirty || busy || portalBusy || uploadOpen); return () => { dirtyCallback.current?.(false); }; }, [navigationDirty, busy, portalBusy, uploadOpen]);
  const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; });
  useEffect(() => { busyCallback.current?.(busy || portalBusy || uploadOpen); return () => { busyCallback.current?.(false); }; }, [busy, portalBusy, uploadOpen]);
  const problems = draft ? jvReadiness(draft) : [];
  const applicant = draft?.applicants[applicantIndex];
  const checklistDone = draft?.steps.filter(step => step.status === "Complete" || step.status === "Not applicable").length ?? 0;
  const showDetailsSummary = payloadDirty || (record?.version ?? 0) > 0;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function change(next: (value: JVApplication) => JVApplication) {
    if (working.current) return;
    setDraft(current => current ? next(current) : current);
    setNotice(""); setError(""); setReviewConfirmed(false);
  }
  function changeApplicant(patch: Partial<JVApplicant>, sourceDocumentId?: string) {
    if (!applicant) return;
    const targetId = applicant.id;
    change(current => ({ ...current, applicants: current.applicants.map(item => item.id === targetId ? { ...item, ...patch, id: item.id } : item), sourceDocumentIds: sourceDocumentId ? [...new Set([...current.sourceDocumentIds, sourceDocumentId])] : current.sourceDocumentIds }));
  }
  function fillApplication(patch: JVApplicationFillPatch, sourceDocumentId: string) {
    if (working.current || !draft || !originals.some(doc => doc.id === sourceDocumentId)) throw new Error("Reopen the source and review the suggestions again.");
    const next = applyJVApplicationFill(draft, patch, sourceDocumentId);
    change(() => next);
  }
  function clear() {
    generation.current++; setOpened(false); setRecord(null); setDraft(null); setReviewNote(""); setReviewConfirmed(false); setSection(0); setApplicantIndex(0); setManualOpen(false); setUploadOpen(false); setReaderDirty(false); setSourceSelection({ id: "", generation: 0 }); setError(""); setConflict(false); setNotice("");
  }
  function close() {
    if (working.current || (dirty && !window.confirm("Discard unsaved application changes and close?"))) return;
    clear();
  }
  function documents() {
    if (working.current || (dirty && !window.confirm("Discard unsaved application changes and open company documents?"))) return;
    clear(); onDocuments?.();
  }
  async function request(action: JVIntakeAction) {
    if (working.current || portalBusy) return;
    if (action === "load" && dirty && !window.confirm("Reloading will discard unsaved application changes. Load the latest saved version?")) return;
    let payload: JVApplication | undefined;
    if (action !== "load") {
      if (!draft || !record || conflict) return;
      if (action === "reopen" && payloadDirty) return;
      try { if (action !== "reopen") payload = validateJVApplication(draft); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Check the application entries before saving."); return; }
    }
    if (action === "review" && (!reviewConfirmed || payloadDirty || !reviewNote.trim())) return;
    const currentGeneration = ++generation.current;
    working.current = true; setBusy(true); setError(""); setNotice(""); setOpened(true);
    try {
      const result = await jvIntakeClientRequest(context, action, action === "load" ? undefined : action === "reopen" ? { expectedVersion: record!.version } : { expectedVersion: record!.version, payload, ...(action === "review" ? { reviewNote } : {}) });
      if (!alive.current || generation.current !== currentGeneration) return;
      setRecord(result); setDraft(result.payload); setConflict(false);
      if (action === "load" && pendingUpload.current) { pendingUpload.current = false; setUploadOpen(true); } setReviewConfirmed(false);
      setReviewNote(action === "save" && result.status === "Ready for review" ? reviewNote : result.reviewNote);
      setApplicantIndex(index => Math.min(index, Math.max(0, result.payload.applicants.length - 1)));
      setNotice(action === "load" ? "Private application loaded." : action === "review" ? "Application marked reviewed. Company launch approval is a separate decision." : action === "submit" ? "Application saved and submitted for manual review." : action === "reopen" ? "Application reopened as a draft." : "Private application saved.");
    } catch (cause) {
      if (!alive.current || generation.current !== currentGeneration) return;
      const status = errorStatus(cause);
      if (status === 401 || status === 403) { setDraft(null); setRecord(null); setReviewNote(""); setReviewConfirmed(false); }
      setConflict(status === 409); setError(requestMessage(cause));
    } finally {
      working.current = false;
      if (alive.current && generation.current === currentGeneration) setBusy(false);
    }
  }

  function openUpload() {
    if (busy || portalBusy || conflict || (readerDirty && !window.confirm("Discard the current document review and upload another application?"))) return;
    if (draft) { setOpened(true); setUploadOpen(true); }
    else { pendingUpload.current = true; void request("load"); }
  }
  const openAction = useRef({ request, openUpload });
  useEffect(() => { openAction.current = { request, openUpload }; });
  useEffect(() => {
    if (!initiallyOpen && !entryAction) return;
    const timer = window.setTimeout(() => {
      if (entryAction === "upload") openAction.current.openUpload();
      else if (entryAction === "link") setLinksOpen(true);
      else void openAction.current.request("load");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initiallyOpen, entryAction]);

  const requestFirst = !existingCompany && !originals.length && !showDetailsSummary && !manualOpen;
  const uploadButton = <Button type="button" variant={requestFirst ? "outline" : "default"} disabled={busy || portalBusy || conflict} onClick={openUpload}><Upload size={16} />Upload completed application</Button>;
  const linkButton = <Button type="button" variant={requestFirst ? "default" : "ghost"} disabled={busy || portalBusy} aria-expanded={linksOpen} onClick={() => { if (linksOpen && portalDirty && !window.confirm("Discard the unsaved application-link details?")) return; setLinksOpen(current => !current); }}>Send application link</Button>;
  return <section className={`panel jv-panel ${styles.flow}`} aria-label="Joint venture application" aria-busy={busy}>
    <header className={styles.heading}>
      <span className={styles.icon}><FileText size={23} aria-hidden="true" /></span>
      <div><p className={styles.eyebrow}>{existingCompany ? "Existing joint venture" : "Company application"}</p><h3>{existingCompany ? "Add the application you already have" : "Start with an application"}</h3><p className="form-note">{existingCompany ? "Upload the completed application. We’ll read the details so you can check and save them without retyping." : "Upload a completed application, or send a private link for the new venture to fill out."}</p></div>
    </header>
    <ol className={styles.steps} aria-label={requestFirst ? "New application steps" : "Application import steps"}><li><span>1</span>{requestFirst ? "Send private link" : "Upload application"}</li><li><span>2</span>{requestFirst ? "Applicant completes form" : "Check the details"}</li><li><span>3</span>{requestFirst ? "Review and save" : "Save to company"}</li></ol>
    <div className={styles.primaryActions}>{requestFirst ? <>{linkButton}{uploadButton}</> : <>{uploadButton}{linkButton}</>}{!opened && <Button type="button" variant="outline" onClick={() => void request("load")} disabled={busy || portalBusy} aria-expanded={false} aria-controls={contentId}>Open private application</Button>}</div>
    {linksOpen && <div className={styles.links}><JVPortalRequests context={context} initiallyOpen embedded onDirtyChange={setPortalDirty} onBusyChange={setPortalBusy} applicationDirty={dirty || busy} onApplicationChanged={() => { clear(); void connection?.refresh?.(); }} /></div>}
    {uploadOpen && <UploadDocument companyId={context.companyId} initialDestination="company" applicationOnly onUploaded={docs => { const first = docs[0]; if (first) { setSourceSelection(current => ({ id: first.id, generation: current.generation + 1 })); setNotice("Original saved privately. Review the suggested details below."); } }} onClose={() => setUploadOpen(false)} />}
    {opened && <div id={contentId}>
      <div className={styles.savedHeader}>{record && <Status value={record.status} />}<p className="form-note"><LockKeyhole size={13} aria-hidden="true" /> Application details are private to authorized staff.</p><Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy || portalBusy} aria-expanded={true} aria-controls={contentId}><X size={15} />Close application</Button></div>
      {error && <div className="notice warning" role="alert"><div><p>{error}</p><Button type="button" variant="outline" size="sm" disabled={busy || portalBusy} onClick={() => void request("load")}>{conflict ? "Reload latest application" : "Retry loading application"}</Button>{draft && !conflict && <p className="form-note">Your unsaved entries remain here. Use Save application details to retry saving.</p>}</div></div>}
      {notice && <p className="form-note" role="status">{notice}</p>}
      {(record as (JVRecord & { sourceChanged?: boolean }) | null)?.sourceChanged && <p className="notice warning" role="alert">An application original changed. Review the current originals and submit again.</p>}
      {busy && !draft && <p role="status">Loading protected application…</p>}
      {draft && record && <>
        {originals.length > 0 && <div className={styles.importArea}>
          {applicant && <JVApplicationReader key={`reader:${sourceSelection.generation}`} companyId={context.companyId} applicant={applicant} applicationApplicants={draft.applicants} applicationDetails={draft} onFill={changeApplicant} onApplicationFill={fillApplication} disabled={busy || portalBusy || conflict} guided selectedDocumentId={sourceSelection.id} autoRead={!!sourceSelection.id} onReviewStateChange={setReaderDirty} />}
        </div>}
        {showDetailsSummary && <div className={styles.summary} aria-label="Application details summary"><div><h4>{payloadDirty ? "Details ready to save" : record.version ? "Saved application details" : "Your application details"}</h4><p>{draft.applicants.filter(person => person.name || person.email).length} applicant{draft.applicants.filter(person => person.name || person.email).length === 1 ? "" : "s"} · {draft.sourceDocumentIds.length} linked original{draft.sourceDocumentIds.length === 1 ? "" : "s"}</p>{draft.applicants.some(person => person.name) && <p className="form-note">{draft.applicants.map(person => person.name).filter(Boolean).join(" · ")}</p>}<p className="form-note">You can save now and add missing information later.</p></div><Button type="button" disabled={busy || portalBusy || conflict || (!payloadDirty && record.version > 0)} onClick={() => void request("save")}><Check size={16} />Save application details</Button></div>}
        <div className={styles.secondaryActions}><Button type="button" variant="outline" aria-expanded={manualOpen} onClick={() => setManualOpen(current => !current)}>{manualOpen ? "Hide application details" : !originals.length && !showDetailsSummary ? "Enter details manually" : "Edit application details"}</Button>{(showDetailsSummary || manualOpen) && <Button type="button" variant="ghost" onClick={() => { setManualOpen(true); setSection(3); }}>Review status and missing details</Button>}</div>
        {manualOpen && <div className={styles.manual}>
        <nav className="jv-nav" aria-label="Application sections">{sections.map((name, index) => <Button type="button" size="sm" key={name} variant={section === index ? "default" : "outline"} aria-current={section === index ? "step" : undefined} onClick={() => setSection(index)}>{index + 1}. {name}</Button>)}</nav>
        <form autoComplete="off" onSubmit={event => { event.preventDefault(); void request("save"); }}>
          <fieldset disabled={busy || portalBusy} className="jv-section">
            <legend className="sr-only">{sections[section]}</legend>
            <h4>{sections[section]}</h4>
            {section < 2 && <div className="jv-applicant-bar">
              <FieldLabel label="Current applicant"><Picker label="Current applicant" value={applicant?.id ?? ""} onChange={id => { const index = draft.applicants.findIndex(item => item.id === id); if (index >= 0) setApplicantIndex(index); }} options={draft.applicants.map((item, index) => ({ value: item.id, label: `Applicant ${index + 1}` }))} disabled={busy || portalBusy} /></FieldLabel>
              <Button type="button" variant="outline" size="sm" disabled={draft.applicants.length >= 20} onClick={() => { const added = newJVApplicant(); change(current => ({ ...current, applicants: [...current.applicants, added] })); setApplicantIndex(draft.applicants.length); }}><Plus size={15} />Add applicant</Button>
              <Button type="button" variant="outline" size="sm" disabled={draft.applicants.length <= 1} onClick={() => { if (!applicant || !window.confirm("Remove this applicant and their entered information?")) return; change(current => ({ ...current, applicants: current.applicants.filter(item => item.id !== applicant.id) })); setApplicantIndex(index => Math.max(0, index - 1)); }}>Remove applicant</Button>
            </div>}
            {section === 0 && applicant && <div key={applicant.id}>
              <p className="form-note">Enter each person separately. Date of birth, Social Security number and driver’s license are masked until you choose Reveal.</p>
              <div className="jv-grid">
                <FieldLabel label="Applicant name"><Input value={applicant.name} maxLength={200} autoComplete="off" onChange={event => changeApplicant({ name: event.target.value })} /></FieldLabel>
                <FieldLabel label="Email"><Input type="email" value={applicant.email} maxLength={254} autoComplete="off" onChange={event => changeApplicant({ email: event.target.value })} /></FieldLabel>
                <FieldLabel label="Phone"><Input type="tel" value={applicant.phone} maxLength={50} autoComplete="off" onChange={event => changeApplicant({ phone: event.target.value })} /></FieldLabel>
                <PrivateField label="Date of birth" value={applicant.dob} placeholder="YYYY-MM-DD" maxLength={10} onChange={value => changeApplicant({ dob: value })} />
                <PrivateField label="Social Security number" value={applicant.ssn} placeholder="9 digits" maxLength={11} inputMode="numeric" onChange={value => changeApplicant({ ssn: value })} />
                <PrivateField label="Driver’s license" value={applicant.driverLicense} maxLength={100} onChange={value => changeApplicant({ driverLicense: value })} />
                <FieldLabel label="Current address"><Textarea value={applicant.currentAddress} rows={2} maxLength={1000} autoComplete="off" onChange={event => changeApplicant({ currentAddress: event.target.value })} /></FieldLabel>
              </div>
            </div>}
            {section === 1 && applicant && <div key={applicant.id}>
              <div className="jv-grid">
                <FieldLabel label="Ownership election"><Picker label="Ownership election" value={applicant.ownershipType} onChange={value => changeApplicant({ ownershipType: value as JVApplicant["ownershipType"], ...(value === "individual" ? { businessStatus: "not-applicable" as const } : value === "business" && applicant.businessStatus === "not-applicable" ? { businessStatus: "forming" as const } : {}) })} options={[{ value: "undecided", label: "Choose individual or business" }, { value: "individual", label: "Own individually" }, { value: "business", label: "Own through a business" }]} disabled={busy || portalBusy} /></FieldLabel>
                {applicant.ownershipType === "business" && <>
                  <FieldLabel label="Owner business name"><Input value={applicant.businessName} maxLength={200} onChange={event => changeApplicant({ businessName: event.target.value })} /></FieldLabel>
                  <FieldLabel label="Owner business status"><Picker label="Owner business status" value={applicant.businessStatus === "not-applicable" ? "forming" : applicant.businessStatus} onChange={value => changeApplicant({ businessStatus: value as JVApplicant["businessStatus"] })} options={[{ value: "existing", label: "Already formed" }, { value: "forming", label: "Still being formed" }]} disabled={busy || portalBusy} /></FieldLabel>
                  <FieldLabel label="Formation document or filing reference"><Input value={applicant.businessReference} maxLength={1000} onChange={event => changeApplicant({ businessReference: event.target.value })} /></FieldLabel>
                </>}
              </div>
              {applicant.ownershipType === "business" && <p className={applicant.businessStatus === "forming" ? "notice warning" : "form-note"}>The company process requires the owner’s LLC to be formed before the venture. A business still being formed cannot be submitted for review.</p>}
              <HistoryFields applicant={applicant} onChange={changeApplicant} />
            </div>}
            {section === 2 && <>
              <div className="jv-grid"><FieldLabel label="Logo preferences"><Textarea rows={3} maxLength={4000} value={draft.logoPreferences} onChange={event => change(current => ({ ...current, logoPreferences: event.target.value }))} placeholder="Colors, wording, style or references (optional)" /></FieldLabel><FieldLabel label="Other application information"><Textarea rows={3} maxLength={8000} value={draft.notes} onChange={event => change(current => ({ ...current, notes: event.target.value }))} placeholder="Other information for the reviewer (optional)" /></FieldLabel></div>
              <h5>Application originals</h5><p className="form-note">Link uploaded originals filed for this company as Restricted / Applications. Keep private applicant information in those protected originals.</p>
              <div className="jv-document-list">{originals.map(doc => <label className="duplicate-ack" key={doc.id}><input type="checkbox" checked={draft.sourceDocumentIds.includes(doc.id)} onChange={event => change(current => ({ ...current, sourceDocumentIds: event.target.checked ? [...new Set([...current.sourceDocumentIds, doc.id])] : current.sourceDocumentIds.filter(id => id !== doc.id) }))} /><span>{doc.name} · v{doc.version}</span></label>)}</div>
              {!originals.length && <p className="form-note">No eligible application originals have been uploaded for this company.</p>}
              {draft.sourceDocumentIds.filter(id => !originals.some(doc => doc.id === id)).map(id => <div className="notice warning" key={id}><p>An attached original is no longer available in this company’s Restricted Applications.</p><Button type="button" variant="outline" size="sm" onClick={() => change(current => ({ ...current, sourceDocumentIds: current.sourceDocumentIds.filter(value => value !== id) }))}>Remove unavailable reference</Button></div>)}
              {onDocuments && <Button type="button" variant="outline" onClick={documents}><FileText size={15} />Open company documents</Button>}
            </>}
            {section === 3 && <>
              <p>{draft.applicants.length} applicant{draft.applicants.length === 1 ? "" : "s"} · {draft.sourceDocumentIds.length} linked original{draft.sourceDocumentIds.length === 1 ? "" : "s"} · {checklistDone} of {JV_STEPS.length} setup steps resolved</p>
              <p className="form-note">Compare every applicant’s details and five-year histories against the original application. Review records an internal check; company launch, legal approval and vendor submissions remain separate.</p>
              {problems.length ? <div className="jv-readiness"><h5>Needed before review</h5><ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div> : <p className="notice" role="status">The required application information is present and ready for a person to review.</p>}
              {record.status === "Draft" && <Button type="button" disabled={!!problems.length || conflict} onClick={() => void request("submit")}>Save and submit for review</Button>}
              {record.status === "Ready for review" && <div className="jv-review">
                {payloadDirty && <p className="notice warning">Save your application changes before recording the review. Changes to applicant intake return it to Draft.</p>}
                <FieldLabel label="Review note"><Textarea rows={3} maxLength={4000} value={reviewNote} onChange={event => { setReviewNote(event.target.value); setReviewConfirmed(false); }} placeholder="Record the evidence checked and any follow-up." /></FieldLabel>
                <label className="duplicate-ack"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} disabled={payloadDirty || !!problems.length} /><span>I compared each applicant’s details and histories with the originals and reviewed the ownership election.</span></label>
                <Button type="button" disabled={!reviewConfirmed || !reviewNote.trim() || payloadDirty || !!problems.length || conflict} onClick={() => void request("review")}>Mark application reviewed</Button>
              </div>}
              {record.status === "Reviewed" && <div className="jv-review"><h5>Recorded review</h5><p>{record.reviewNote}</p>{record.reviewedAt && <p className="form-note">Reviewed {new Date(record.reviewedAt).toLocaleString()}.</p>}<Button type="button" variant="outline" disabled={conflict || payloadDirty} onClick={() => void request("reopen")}>Reopen as draft</Button></div>}
            </>}
            {section === 4 && <>
              <p className="form-note">Track each setup task independently. Completed or not-applicable tasks need an evidence reference or a meaningful explanation. Application review does not complete these tasks.</p>
              {JV_STEPS.map((definition, index) => {
                const step = draft.steps.find(item => item.id === definition.id);
                if (!step) return null;
                const changeStep = (patch: Partial<JVStep>) => change(current => ({ ...current, steps: current.steps.map(item => item.id === step.id ? { ...item, ...patch, id: item.id } : item) }));
                return <details key={step.id} className="jv-checklist-row"><summary><span>{index + 1}. {definition.title}</span><Status value={step.status} /></summary><p className="form-note">{definition.description}</p><div className="jv-grid">
                  <FieldLabel label={`${definition.title} status`}><Picker label={`${definition.title} status`} value={step.status} onChange={value => changeStep({ status: value as JVStep["status"] })} options={stepStatuses} disabled={busy || portalBusy} /></FieldLabel>
                  <FieldLabel label={`${definition.title} assignee`}><Input value={step.assignee} maxLength={200} onChange={event => changeStep({ assignee: event.target.value })} placeholder="Responsible person" /></FieldLabel>
                  <FieldLabel label={`${definition.title} due date`}><Input type="date" value={step.dueDate} onChange={event => changeStep({ dueDate: event.target.value })} /></FieldLabel>
                  <FieldLabel label={`${definition.title} evidence reference`}><Input value={step.reference} maxLength={2000} onChange={event => changeStep({ reference: event.target.value })} placeholder="Document, filing or confirmation reference" /></FieldLabel>
                  <FieldLabel label={`${definition.title} note`}><Textarea rows={2} value={step.note} maxLength={4000} onChange={event => changeStep({ note: event.target.value })} /></FieldLabel>
                </div></details>;
              })}
            </>}
          </fieldset>
          <footer className="jv-footer">
            <p className="form-note" aria-live="polite">{dirty ? "Unsaved changes" : record.version ? `Saved version ${record.version}` : "New application · not saved"}{noteDirty ? " · Review note is saved when you mark the application reviewed." : ""}</p>
            <div className="jv-actions"><Button type="button" variant="outline" disabled={busy || section === 0} onClick={() => setSection(index => index - 1)}><ChevronLeft size={15} />Back</Button><Button type="button" variant="outline" disabled={busy || section === sections.length - 1} onClick={() => setSection(index => index + 1)}>Next<ChevronRight size={15} /></Button><Button type="submit" disabled={busy || portalBusy || conflict || (!payloadDirty && record.version > 0)}><Save size={15} />{busy ? "Working…" : record.status === "Draft" ? "Save draft" : "Save application"}</Button></div>
          </footer>
        </form>
        </div>}
      </>}
    </div>}
  </section>;
}

function PrivateField({ label, value, onChange, placeholder, maxLength, inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; maxLength: number; inputMode?: "numeric" }) {
  const id = useId(), [visible, setVisible] = useState(false);
  return <div className="field-label"><label htmlFor={id}>{label}</label><div className="jv-private-field"><Input id={id} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} inputMode={inputMode} autoComplete="new-password" spellCheck={false} /><Button type="button" size="sm" variant="outline" aria-label={`${visible ? "Hide" : "Reveal"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}{visible ? "Hide" : "Reveal"}</Button></div></div>;
}

function HistoryFields({ applicant, onChange }: { applicant: JVApplicant; onChange: (patch: Partial<JVApplicant>) => void }) {
  return <>
    <h5>Five-year residence history</h5><p className="form-note">Cover the full last five years, including the current residence. Leave an end date blank for the current period.</p>
    {applicant.residenceHistory.map((row, index) => <fieldset className="jv-history-row" key={row.id}><legend>Residence {index + 1}</legend><div className="jv-grid"><FieldLabel label={`Residence ${index + 1} address`}><Input value={row.address} maxLength={1000} onChange={event => onChange({ residenceHistory: applicant.residenceHistory.map(item => item.id === row.id ? { ...item, address: event.target.value } : item) })} /></FieldLabel>{(["from", "to"] as const).map(field => <FieldLabel label={`Residence ${index + 1} ${field === "from" ? "start" : "end"} date`} key={field}><Input type="date" value={row[field]} onChange={event => onChange({ residenceHistory: applicant.residenceHistory.map(item => item.id === row.id ? { ...item, [field]: event.target.value } : item) })} /></FieldLabel>)}</div><Button type="button" variant="outline" size="sm" aria-label={`Remove residence ${index + 1}`} onClick={() => onChange({ residenceHistory: applicant.residenceHistory.filter(item => item.id !== row.id) })}>Remove residence</Button></fieldset>)}
    <Button type="button" variant="outline" size="sm" disabled={applicant.residenceHistory.length >= 40} onClick={() => onChange({ residenceHistory: [...applicant.residenceHistory, { id: crypto.randomUUID(), address: "", from: "", to: "" }] })}><Plus size={15} />Add residence</Button>
    <h5>Five-year employment history</h5><p className="form-note">Cover the full last five years. Include self-employment, unemployment or retirement to explain every period.</p>
    {applicant.employmentHistory.map((row, index) => <fieldset className="jv-history-row" key={row.id}><legend>Employment {index + 1}</legend><div className="jv-grid">{(["employer", "role", "address"] as const).map(field => <FieldLabel label={`Employment ${index + 1} ${field}`} key={field}><Input value={row[field]} maxLength={field === "address" ? 1000 : 200} onChange={event => onChange({ employmentHistory: applicant.employmentHistory.map(item => item.id === row.id ? { ...item, [field]: event.target.value } : item) })} /></FieldLabel>)}{(["from", "to"] as const).map(field => <FieldLabel label={`Employment ${index + 1} ${field === "from" ? "start" : "end"} date`} key={field}><Input type="date" value={row[field]} onChange={event => onChange({ employmentHistory: applicant.employmentHistory.map(item => item.id === row.id ? { ...item, [field]: event.target.value } : item) })} /></FieldLabel>)}</div><Button type="button" variant="outline" size="sm" aria-label={`Remove employment ${index + 1}`} onClick={() => onChange({ employmentHistory: applicant.employmentHistory.filter(item => item.id !== row.id) })}>Remove employment</Button></fieldset>)}
    <Button type="button" variant="outline" size="sm" disabled={applicant.employmentHistory.length >= 40} onClick={() => onChange({ employmentHistory: [...applicant.employmentHistory, { id: crypto.randomUUID(), employer: "", role: "", address: "", from: "", to: "" }] })}><Plus size={15} />Add employment</Button>
  </>;
}
