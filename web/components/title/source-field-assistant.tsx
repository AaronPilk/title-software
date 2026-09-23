"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAsset, useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import { suggestSourceFields, type SourceFieldCandidate, type SourceFieldSuggestion } from "@/lib/title/field-extraction";
import type { SourceCaptureContext } from "@/lib/title/production";
import type { SourceReadResult } from "@/lib/title/source-field-reader";

type Fill = { id: string; value: string; evidence: SourceCaptureContext["fields"][string] };
export function SourceFieldAssistant({ doc, defs, onFill }: { doc: VaultDoc; defs: { id: string; label: string }[]; onFill: (values: Fill[]) => void }) {
  const { s, connection } = useWorkspace();
  const workspaceId = connection?.workspaceId || "local";
  const current = s.documents.some(d => d.id === doc.id && d.version === doc.version && d.assetId === doc.assetId && d.sourceRole === doc.sourceRole && d.companyId === doc.companyId && d.orderId === doc.orderId);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  const [scanPages, setScanPages] = useState(""), [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const identity = JSON.stringify([workspaceId, connection?.access.userId, connection?.access.version, doc.id, doc.version, doc.assetId, doc.sourceRole, doc.companyId, doc.orderId]);
  const [savedResult, setResult] = useState<{ identity: string; read: SourceReadResult; fields: SourceFieldSuggestion[] } | null>(null);
  const result = savedResult?.identity === identity ? savedResult : null;
  const controller = useRef<AbortController | null>(null);
  const valid = useRef(current);
  useEffect(() => { valid.current = current; return () => { valid.current = false; controller.current?.abort(); }; }, [current, identity]);
  async function read() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setResult(null); setProgress("Opening the original…");
    try {
      const blob = doc.assetId ? await getAsset(doc.assetId) : undefined;
      if (abort.signal.aborted || !valid.current) return;
      const { readFieldSource } = await import("@/lib/title/source-field-reader");
      const read = await readFieldSource(doc, blob, { signal: abort.signal, scanPages, rotation, onProgress: message => { if (!abort.signal.aborted && valid.current) setProgress(message); } });
      if (!abort.signal.aborted && valid.current) setResult({ identity, read, fields: suggestSourceFields(defs, read.pages) });
    } catch (reason) {
      if (!abort.signal.aborted && valid.current) setError(reason instanceof Error ? reason.message : "The original could not be read. Capture its values manually.");
    } finally { if (controller.current === abort && valid.current) { setBusy(false); setProgress(""); } }
  }
  function fill(field: SourceFieldSuggestion, candidate: SourceFieldCandidate): Fill {
    return { id: field.fieldId, value: candidate.rawValue, evidence: {
      page: candidate.method === "source-text" ? "Source text · confirm original reference" : `${doc.mime === "application/pdf" ? "PDF page" : "Image"} ${candidate.page}${candidate.method === "ocr" ? ` · OCR ${rotation}°` : ""}`,
      method: candidate.method, quote: candidate.quote, suggestedValue: candidate.rawValue,
      ...(candidate.confidence === undefined ? {} : { engineConfidence: candidate.confidence }),
    } };
  }
  const suggested = result?.fields.filter(f => f.status === "suggested" && f.candidates.length === 1) || [];
  return <section aria-label="Source field suggestions" className="form-stack" style={{ border: "1px solid #dfe7ef", borderRadius: 12, padding: 16, background: "#f8fafc", color: "#18354b" }}>
    <strong>Read the original into fields</strong>
    <p className="form-note">Find labeled values in this source, then check them against the original. Unclear or missing values stay for manual capture. Nothing is approved or sent to SoftPro.</p>
    <p className="form-note">PDF text and OCR run in your browser. Scans are read up to six pages per run. Legal wording, handwritten text and unfamiliar layouts may need manual capture.</p>
    {doc.mime === "application/pdf" && <label className="field-label">Scanned pages (optional)<Input aria-label="Scanned pages for field suggestions" value={scanPages} disabled={busy} onChange={e => { setScanPages(e.target.value); setResult(null); }} placeholder="Automatic, or e.g. 1, 3-5" maxLength={100}/></label>}
    {["application/pdf", "image/png", "image/jpeg"].includes(doc.mime || "") && <label className="field-label">Scan orientation<select aria-label="Field suggestion scan orientation" value={rotation} disabled={busy} onChange={e => { setRotation(Number(e.target.value) as typeof rotation); setResult(null); }}><option value={0}>As stored</option><option value={90}>Turn right (90°)</option><option value={180}>Turn upside down (180°)</option><option value={270}>Turn left (90°)</option></select></label>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button type="button" variant="outline" disabled={busy || !current} onClick={() => void read()}>{busy ? "Reading source…" : "Find field suggestions"}</Button>
      {busy && <Button type="button" variant="ghost" onClick={() => { controller.current?.abort(); setBusy(false); setProgress(""); setError("Reading cancelled. No suggestions were applied."); }}>Cancel reading</Button>}
    </div>
    {!current && <p role="alert">This source changed or is no longer available. Reopen its current version.</p>}
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error}</p>}
    {result && current && <>
      <p role="status">Read {result.read.pages.length} of {result.read.totalPages} page(s). {suggested.length} field(s) have one labeled candidate. {result.fields.filter(f => f.status === "ambiguous").length} need a choice.</p>
      {result.read.unreadPages.length > 0 && <p role="alert">Unread pages: {result.read.unreadPages.join(", ")}. Suggestions are incomplete. Read these pages or check them manually before saving.</p>}
      {result.read.notes.map(note => <p className="form-note" key={note}>{note}</p>)}
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
