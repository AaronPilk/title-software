"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/title/store";
import type { JVApplicant } from "@/lib/title/jv-application";
import type { VaultDoc } from "@/lib/title/model";
import { extractJVFields, jvCandidatePatch } from "@/lib/title/jv-extraction";
import { documentScanIdentity, useDocumentScan } from "./use-document-scan";
import { DocumentScanStatus } from "./document-scan-status";
import { DocumentPreview } from "./documents";

type Props = { companyId: string; applicant: JVApplicant; onFill: (patch: Partial<JVApplicant>, sourceDocumentId: string) => void; disabled?: boolean };
export function JVApplicationReader(props: Props) {
  const { s, connection } = useWorkspace(), [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const docs = s.documents.filter(doc => doc.companyId === props.companyId && !doc.orderId && doc.category === "Applications" && doc.visibility === "Restricted" && doc.assetId && ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(doc.mime || ""));
  const doc = docs.find(doc => doc.id === selected);
  return <section className="jv-reader form-stack" aria-label="Read an application into fields">
    <Button type="button" variant="outline" disabled={props.disabled} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close application reader" : "Read an uploaded application"}</Button>
    {open && <>
      <p className="form-note">Choose this person’s application. Review each suggestion before adding it to their form. Scanning stays in this browser; nothing is saved until you save the application.</p>
      <label className="field-label">Application original<select aria-label="Application original" value={selected} disabled={props.disabled} onChange={event => setSelected(event.target.value)}><option value="">Choose a restricted company application</option>{docs.map(doc => <option key={doc.id} value={doc.id}>{doc.name} · version {doc.version}</option>)}</select></label>
      {!docs.length && <p className="form-note">Upload the original to this company’s documents as Applications / Restricted first.</p>}
      {doc && <JVReadSession key={`${props.applicant.id}:${documentScanIdentity(doc, connection)}`} {...props} doc={doc} identity={documentScanIdentity(doc, connection)} />}
    </>}
  </section>;
}
function JVReadSession({ doc, identity, onFill, disabled }: Props & { doc: VaultDoc; identity: string }) {
  const [reviewed, setReviewed] = useState<string[]>([]), [used, setUsed] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const scan = useDocumentScan(doc, identity, () => { setReviewed([]); setUsed([]); });
  const suggestions = useMemo(() => {
    if (scan.busy || !scan.result) return { fields: [], error: "" };
    try { return { fields: extractJVFields(scan.result.pages), error: "" }; }
    catch { return { fields: [], error: "Suggestions could not be prepared. Enter these details from the original." }; }
  }, [scan.busy, scan.result]);
  const busy = disabled || scan.busy;
  return <div className="form-stack">
    <p className="form-note">{doc.name} · Version {doc.version}. Up to 120 pages / 25 MB. Unclear names, numeric dates, ownership choices and history tables need manual entry.</p>
    <label className="field-label">Application scan orientation<select disabled={busy} value={rotation} onChange={event => { setRotation(Number(event.target.value) as typeof rotation); setReviewed([]); }}><option value={0}>As stored</option><option value={90}>Turn right</option><option value={180}>Upside down</option><option value={270}>Turn left</option></select></label>
    <div className="source-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => void scan.read(scan.result?.totalPages && doc.mime !== "text/plain" ? `1-${scan.result.totalPages}` : "", rotation)}>Find applicant fields</Button>{scan.busy && <Button type="button" variant="ghost" onClick={scan.cancel}>Cancel reading</Button>}</div>
    <DocumentScanStatus {...scan} onResume={() => void scan.read("", rotation)} />
    {suggestions.error && <p role="alert">{suggestions.error}</p>}
    {scan.result && !scan.busy && <>
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
