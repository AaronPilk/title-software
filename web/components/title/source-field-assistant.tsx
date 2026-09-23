"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import { suggestSourceFields, type SourceFieldCandidate, type SourceFieldSuggestion } from "@/lib/title/field-extraction";
import type { SourceCaptureContext } from "@/lib/title/production";
import { documentScanIdentity, useDocumentScan } from "./use-document-scan";
import { DocumentScanStatus } from "./document-scan-status";

type Fill = { id: string; value: string; evidence: SourceCaptureContext["fields"][string] };
type Props = { doc: VaultDoc; defs: { id: string; label: string }[]; onFill: (values: Fill[]) => void; onActivityChange?: (busy: boolean) => void };
export function SourceFieldAssistant(props: Props) {
  const { doc } = props, { s, connection } = useWorkspace();
  const identity = documentScanIdentity(doc, connection);
  const current = s.documents.some(d => d.id === doc.id && d.version === doc.version && d.assetId === doc.assetId && d.mime === doc.mime && d.visibility === doc.visibility && d.sourceRole === doc.sourceRole && d.companyId === doc.companyId && d.orderId === doc.orderId);
  return current ? <SourceFieldSession key={identity} {...props} identity={identity} /> : <p role="alert">This source changed or is no longer available. Reopen its current version.</p>;
}
function SourceFieldSession({ doc, defs, onFill, onActivityChange, identity }: Props & { identity: string }) {
  const [scanPages, setScanPages] = useState(""), [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const scan = useDocumentScan(doc, identity, onActivityChange), { busy, result: readResult } = scan;
  const suggestions = useMemo(() => {
    if (busy || !readResult) return { fields: [] as SourceFieldSuggestion[], error: "" };
    try { return { fields: suggestSourceFields(defs, readResult.pages), error: "" }; }
    catch (reason) { return { fields: [] as SourceFieldSuggestion[], error: reason instanceof Error ? reason.message : "Suggestions could not be prepared. Capture values manually from the original." }; }
  }, [busy, readResult, defs]);
  const fields = suggestions.fields;
  const result = readResult ? { read: readResult, fields } : null;
  function fill(field: SourceFieldSuggestion, candidate: SourceFieldCandidate): Fill {
    return { id: field.fieldId, value: candidate.rawValue, evidence: {
      page: candidate.method === "source-text" ? "Source text · confirm original reference" : `${doc.mime === "application/pdf" ? "PDF page" : "Image"} ${candidate.page}${candidate.method === "ocr" ? ` · OCR ${readResult?.pages.find(page => page.page === candidate.page)?.rotation || 0}°` : ""}`,
      method: candidate.method, quote: candidate.quote, suggestedValue: candidate.rawValue,
      ...(candidate.confidence === undefined ? {} : { engineConfidence: candidate.confidence }),
    } };
  }
  const suggested = result?.fields.filter(f => f.status === "suggested" && f.candidates.length === 1) || [];
  return <section aria-label="Source field suggestions" className="form-stack" style={{ border: "1px solid #dfe7ef", borderRadius: 12, padding: 16, background: "#f8fafc", color: "#18354b" }}>
    <strong>Read the original into fields</strong>
    <p className="form-note">Find labeled values in this source, then check them against the original. Unclear or missing values stay for manual capture. Nothing is approved or sent to SoftPro.</p>
    <p className="form-note">Read the whole document, up to 120 pages and 25 MB. PDF text and scanned pages are combined automatically in your browser. Legal wording, handwritten text and unfamiliar layouts may need manual capture.</p>
    {doc.mime === "application/pdf" && <label className="field-label">Scanned pages (optional)<Input aria-label="Scanned pages for field suggestions" value={scanPages} disabled={busy} onChange={e => { setScanPages(e.target.value); }} placeholder="All unread pages, or e.g. 1, 3-5" maxLength={100}/></label>}
    {["application/pdf", "image/png", "image/jpeg"].includes(doc.mime || "") && <label className="field-label">Scan orientation<select aria-label="Field suggestion scan orientation" value={rotation} disabled={busy} onChange={e => { setRotation(Number(e.target.value) as typeof rotation); }}><option value={0}>As stored</option><option value={90}>Turn right (90°)</option><option value={180}>Turn upside down (180°)</option><option value={270}>Turn left (90°)</option></select></label>}
    <p className="form-note">Leave page selection blank to read every unfinished page. Enter page numbers to replace just those pages, keeping the others. Orientation applies to pages read in this run.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void scan.read(scanPages, rotation)}>{busy ? "Reading source…" : "Find field suggestions"}</Button>
      {busy && <Button type="button" variant="ghost" onClick={scan.cancel}>Cancel reading</Button>}
    </div>
    <DocumentScanStatus {...scan} onResume={() => void scan.read("", rotation)} />
    {suggestions.error && <p role="alert">{suggestions.error} Read pages remain available; capture values manually from the original.</p>}
    {result && !busy && <>
      <p role="status">{suggested.length} field(s) have one labeled candidate. {result.fields.filter(f => f.status === "ambiguous").length} need a choice.</p>
      <Button type="button" variant="outline" disabled={busy || !suggested.length} onClick={() => onFill(suggested.map(f => fill(f, f.candidates[0])))}>Fill unambiguous suggestions for review</Button>
      {result.fields.map(field => <div className="form-stack" key={field.fieldId} style={{ borderTop: "1px solid #dfe7ef", paddingTop: 10 }}>
        <strong>{field.label}</strong>
        {field.status === "missing" && <p className="form-note">No reliable labeled value found. Enter this from the original.</p>}
        {field.status === "ambiguous" && <p className="form-note">More review is needed. Choose only after comparing the source.</p>}
        {field.warnings.map(warning => <p className="form-note" key={warning}>{warning}</p>)}
        {field.candidates.map((candidate, index) => <div className="form-stack" key={`${candidate.page}:${index}`}>
          <div><strong>{candidate.rawValue}</strong> · {candidate.method === "source-text" ? "Source text" : `Page ${candidate.page}`} · {candidate.method === "ocr" ? "OCR" : "Source text"}</div>
          <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0, padding: 10, background: "white", borderRadius: 6 }}>{candidate.quote}</blockquote>
          {candidate.warnings.map(warning => <p className="form-note" key={warning}>{warning}</p>)}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onFill([fill(field, candidate)])}>Use {field.label} from page {candidate.page}</Button>
        </div>)}
      </div>)}
      <p className="form-note">Saved corrections keep the suggested wording and source reference for later validation. Uploading a document does not automatically train a model.</p>
    </>}
  </section>;
}
