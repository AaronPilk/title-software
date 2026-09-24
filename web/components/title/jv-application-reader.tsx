"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import type { JVApplicant } from "@/lib/title/jv-application";
import type { VaultDoc } from "@/lib/title/model";
import { extractJVFields, jvCandidatePatch, extractJVApplication, jvApplicationCandidatePatch, type JVApplicationFillPatch, type JVApplicationExtraction } from "@/lib/title/jv-extraction";
import { documentScanIdentity, useDocumentScan } from "./use-document-scan";
import { DocumentScanStatus } from "./document-scan-status";
import { DocumentPreview } from "./documents";

type Props = {
  companyId: string; applicant: JVApplicant;
  onFill: (patch: Partial<JVApplicant>, sourceDocumentId: string) => void;
  applicationApplicants?: JVApplicant[];
  onApplicationFill?: (patch: JVApplicationFillPatch, sourceDocumentId: string) => void;
  disabled?: boolean;
};
export function JVApplicationReader(props: Props) {
  const { s, connection } = useWorkspace(), [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const docs = s.documents.filter(doc => doc.companyId === props.companyId && !doc.orderId && doc.category === "Applications" && doc.visibility === "Restricted" && doc.assetId && ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(doc.mime || ""));
  const doc = docs.find(doc => doc.id === selected);
  return <section className="jv-reader form-stack" aria-label="Read an application into fields">
    <Button type="button" variant="outline" disabled={props.disabled} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close application reader" : "Read an uploaded application"}</Button>
    {open && <>
      <p className="form-note">Choose the returned application. Review each suggestion against its original page before adding it to the draft. Scanning stays in this browser; nothing is saved until you save the application.</p>
      <label className="field-label">Application original<select aria-label="Application original" value={selected} disabled={props.disabled} onChange={event => setSelected(event.target.value)}><option value="">Choose a restricted company application</option>{docs.map(doc => <option key={doc.id} value={doc.id}>{doc.name} · version {doc.version}</option>)}</select></label>
      {!docs.length && <p className="form-note">Upload the original to this company’s documents as Applications / Restricted first.</p>}
      {doc && <JVReadSession key={`${props.applicant.id}:${documentScanIdentity(doc, connection)}`} {...props} doc={doc} identity={documentScanIdentity(doc, connection)} />}
    </>}
  </section>;
}
function JVReadSession({ doc, identity, applicant, applicationApplicants, onFill, onApplicationFill, disabled }: Props & { doc: VaultDoc; identity: string }) {
  const [reviewed, setReviewed] = useState<string[]>([]), [used, setUsed] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [readRotation, setReadRotation] = useState(0);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [replaceHistory, setReplaceHistory] = useState<string[]>([]);
  const [applicationUsed, setApplicationUsed] = useState(false);
  const [applyError, setApplyError] = useState("");
  const scan = useDocumentScan(doc, identity, () => { setReviewed([]); setUsed([]); setReplaceHistory([]); setApplicationUsed(false); setApplyError(""); });
  const suggestions = useMemo(() => {
    if (scan.busy || !scan.result || rotation !== readRotation) return { fields: [], error: "" };
    try { return { fields: extractJVFields(scan.result.pages), error: "" }; }
    catch { return { fields: [], error: "Suggestions could not be prepared. Enter these details from the original." }; }
  }, [scan.busy, scan.result, rotation, readRotation]);
  const applicationSuggestions = useMemo(() => {
    if (!onApplicationFill || scan.busy || !scan.result || rotation !== readRotation) return { extraction: null, error: "" };
    try { return { extraction: extractJVApplication(scan.result.pages), error: "" }; }
    catch { return { extraction: null, error: "Application suggestions could not be prepared. Enter these details from the original." }; }
  }, [onApplicationFill, scan.busy, scan.result, rotation, readRotation]);
  const extraction = applicationSuggestions.extraction;
  const destinations = applicationApplicants || [applicant];
  const effectiveTargets = Object.fromEntries((extraction?.applicants || []).map((item, index) => [item.key, Object.hasOwn(targets, item.key) ? targets[item.key] : index === 0 ? applicant.id : ""]));
  let applicationPatch: JVApplicationFillPatch | null = null, applicationError = "";
  if (extraction) {
    try { applicationPatch = jvApplicationCandidatePatch(extraction, reviewed, effectiveTargets); }
    catch (reason) { applicationError = reason instanceof Error ? reason.message : "Review the applicant mapping."; }
  }
  const replacements = (applicationPatch?.applicants || []).flatMap(entry => {
    const existing = destinations.find(person => person.id === entry.targetApplicantId);
    return (["residenceHistory", "employmentHistory"] as const).filter(field => entry.patch[field]?.length && existing?.[field].length).map(field => ({ key: `${entry.sourceApplicantKey}:${field}`, label: `${entry.label} ${field === "residenceHistory" ? "residence" : "employment"} history` }));
  });
  const read = (resume = false) => { setReadRotation(rotation); void scan.read(!resume && scan.result?.totalPages && doc.mime !== "text/plain" ? `1-${scan.result.totalPages}` : "", rotation); };
  const busy = disabled || scan.busy;
  return <div className="form-stack">
    <p className="form-note">{doc.name} · Version {doc.version}. Up to 120 pages / 25 MB. Printed labels and clear history tables can become suggestions. Unclear handwriting, ambiguous dates and unsupported layouts need manual entry.</p>
    <label className="field-label">Application scan orientation<select disabled={busy} value={rotation} onChange={event => { setRotation(Number(event.target.value) as typeof rotation); setReviewed([]); setReplaceHistory([]); setApplicationUsed(false); }}><option value={0}>As stored</option><option value={90}>Turn right</option><option value={180}>Upside down</option><option value={270}>Turn left</option></select></label>
    <div className="source-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => read()}>{onApplicationFill ? "Find application fields" : "Find applicant fields"}</Button>{scan.busy && <Button type="button" variant="ghost" onClick={scan.cancel}>Cancel reading</Button>}</div>
    <DocumentScanStatus {...scan} onResume={() => read(true)} />
    {(onApplicationFill ? applicationSuggestions.error : suggestions.error) && <p role="alert">{onApplicationFill ? applicationSuggestions.error : suggestions.error}</p>}
    {rotation !== readRotation && <p role="status">Read the application again to use the new orientation.</p>}
    {onApplicationFill && extraction && <>
      <p role="status">{extraction.candidates.length} application suggestions for {extraction.applicants.length} source applicant{extraction.applicants.length === 1 ? "" : "s"}. Only checked suggestions will be added.</p>
      <p className="form-note">Map each source applicant before reviewing their values. Adding reviewed fields replaces those fields in the chosen applicant; other fields stay as entered. New applicants start with blank fields.</p>
      {extraction.applicants.map(item => <label className="field-label" key={item.key}>{item.label} destination<select aria-label={`${item.label} destination`} disabled={busy || applicationUsed} value={effectiveTargets[item.key]} onChange={event => { setTargets(values => ({ ...values, [item.key]: event.target.value })); setReviewed(values => values.filter(id => extraction.candidates.find(candidate => candidate.id === id)?.applicantKey !== item.key)); setReplaceHistory([]); setApplicationUsed(false); setApplyError(""); }}><option value="">Create a new applicant</option>{destinations.map((person, index) => <option key={person.id} value={person.id}>{person.name || `Applicant ${index + 1}`}</option>)}</select></label>)}
      <ApplicationFeedback extraction={extraction} />
      {extraction.candidates.map(candidate => {
        const person = extraction.applicants.find(item => item.key === candidate.applicantKey);
        const value = typeof candidate.value === "string" ? candidate.value : Object.entries(candidate.value).filter(([key]) => key !== "id").map(([key, value]) => `${key}: ${key === "to" && !value ? "Present" : value || "(blank)"}`).join(" · ");
        return <details className="jv-candidate" key={candidate.id}>
          <summary>{person ? `${person.label} · ` : "Application · "}{candidate.label} · page {candidate.page}{candidate.conflict ? " · conflicting answers: choose one" : ""}</summary>
          <p className="form-note">{candidate.warning}</p><p>Suggested value: {value}</p><blockquote>{candidate.quote}</blockquote>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewPage(candidate.page)}>View original page {candidate.page}</Button>
          <label className="jv-check"><input type="checkbox" disabled={busy || applicationUsed} checked={reviewed.includes(candidate.id)} onChange={event => { setReviewed(values => event.target.checked ? [...values.filter(id => !extraction.candidates.some(other => other.id === id && other.applicantKey === candidate.applicantKey && other.field === candidate.field && typeof other.value === "string")), candidate.id] : values.filter(id => id !== candidate.id)); setReplaceHistory([]); }} />I checked {candidate.label.toLowerCase()} on page {candidate.page}{person ? ` and it belongs to ${person.label.toLowerCase()} in the selected destination` : " for this application"}.</label>
        </details>;
      })}
      {replacements.map(item => <label className="jv-check" key={item.key}><input type="checkbox" checked={replaceHistory.includes(item.key)} disabled={busy || applicationUsed} onChange={event => setReplaceHistory(values => event.target.checked ? [...values, item.key] : values.filter(value => value !== item.key))} />Replace existing {item.label.toLowerCase()} with only the reviewed rows. I checked that no existing rows need to be kept.</label>)}
      {applicationError && <p role="alert">{applicationError}</p>}
      {applyError && <p role="alert">{applyError}</p>}
      <Button type="button" variant="outline" disabled={busy || applicationUsed || !reviewed.length || !applicationPatch || replacements.some(item => !replaceHistory.includes(item.key))} onClick={() => {
        if (!applicationPatch) return;
        try { onApplicationFill(applicationPatch, doc.id); setApplicationUsed(true); setApplyError(""); }
        catch { setApplyError("The reviewed values could not be added. Check the applicant mapping, field limits and current draft, then try again."); }
      }}>Apply reviewed application</Button>
      {applicationUsed && <p role="status">Reviewed suggestions added to the draft. Check missing fields and save the application when ready.</p>}
    </>}
    {!onApplicationFill && scan.result && !scan.busy && rotation === readRotation && <>
      <p role="status">{suggestions.fields.length} labeled suggestions. Missing fields stay blank for manual entry.</p>
      {suggestions.fields.map((candidate, index) => {
        const key = `${candidate.field}:${index}`;
        const duplicate = suggestions.fields.filter(other => other.field === candidate.field).length > 1;
        return <details className="jv-candidate" key={key}>
          <summary>{candidate.label} · page {candidate.page}{duplicate ? " · choose carefully: multiple candidates" : ""}{used.includes(key) ? " · added to form" : ""}</summary>
          <p className="form-note">{candidate.warning}</p><blockquote>{candidate.quote}</blockquote>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewPage(candidate.page)}>View original page {candidate.page}</Button>
          <label className="jv-check"><input type="checkbox" disabled={busy} checked={reviewed.includes(key)} onChange={event => setReviewed(values => event.target.checked ? [...values, key] : values.filter(value => value !== key))} />I checked {candidate.label.toLowerCase()} on page {candidate.page} and it belongs to this applicant.</label>
          <Button type="button" size="sm" variant="outline" disabled={busy || !reviewed.includes(key)} onClick={() => { onFill(jvCandidatePatch(candidate), doc.id); setUsed(values => [...values, key]); }}>Use reviewed {candidate.label.toLowerCase()}</Button>
        </details>;
      })}
    </>}
    {previewPage !== null && <DocumentPreview doc={doc} initialPage={previewPage} onClose={() => setPreviewPage(null)} />}
  </div>;
}

function ApplicationFeedback({ extraction }: { extraction: JVApplicationExtraction }) {
  return <>
    {extraction.issues.length > 0 && <details open><summary>{extraction.issues.length} extraction item{extraction.issues.length === 1 ? "" : "s"} need manual review</summary><ul>{extraction.issues.map((issue, index) => <li key={index}>{issue.page ? `Page ${issue.page}: ` : ""}{issue.message}</li>)}</ul></details>}
    <details><summary>Missing details and completeness feedback ({extraction.missing.length})</summary><p className="form-note">This checks the extracted packet, including five-year history coverage. Confirm every original page was read. A complete extraction still requires human review.</p>{extraction.missing.length ? <ul>{extraction.missing.map((message, index) => <li key={index}>{message}</li>)}</ul> : <p>No required intake gaps were found in the extracted candidates.</p>}</details>
  </>;
}
