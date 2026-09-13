"use client";
import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "@/lib/title/store";
import type { Order } from "@/lib/title/model";
import {
  addReferencedSource, reviewReferencedSource, referencedSourceStatus,
  orderSources, productionLocked, titleFile,
  type ReferencedSource, type ReferencedSourceRole,
} from "@/lib/title/production";
import { FieldLabel, Picker } from "./shared";
import { DocumentPreview } from "./documents";
import "./finals-workflow.css";

export function ReferencedSources({ order }: { order: Order }) {
  const { s, update } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [wording, setWording] = useState("");
  const [role, setRole] = useState<ReferencedSourceRole>("Search package");
  const [required, setRequired] = useState(true);
  const locked = order.status === "Rejected" || productionLocked(s, order);
  const references = titleFile(order).referencedSources || [];
  return <section className="referenced-sources panel">
    <div className="referenced-sources-heading">
      <div><h3>Referenced source checklist</h3><p>Record instructions such as “see search” or “refer to prior policy.” Required references hold preparation until reviewed.</p></div>
      <Button variant="outline" disabled={locked} onClick={() => setAdding(v => !v)}><Plus size={16} /> Add reference</Button>
    </div>
    {adding && <form className="form-stack referenced-sources-add" onSubmit={async e => {
      e.preventDefault();
      if (await update(d => addReferencedSource(d, order.id, { wording, role, required }), "Source reference captured", order.id)) {
        setWording(""); setAdding(false);
      }
    }}>
      <fieldset disabled={locked} className="form-stack">
        <FieldLabel label="Original reference wording"><Textarea aria-label="Original reference wording" value={wording} onChange={e => setWording(e.target.value)} rows={3} maxLength={5000} required /></FieldLabel>
        <FieldLabel label="Referenced source type"><Picker label="Referenced source type" value={role} onChange={v => setRole(v as ReferencedSourceRole)} options={["Search package", "Prior policy", "Other"]} /></FieldLabel>
        <label className="referenced-sources-required"><Checkbox checked={required} onCheckedChange={v => setRequired(v === true)} /> Required for preparation</label>
        <p className="form-note">Keep the original wording. A reviewer can record a reasoned “Not applicable” decision if the reference was captured in error.</p>
        <Button type="submit" disabled={!wording.trim()}>Save source reference</Button>
      </fieldset>
    </form>}
    {!references.length && !adding && <p className="form-note">No references recorded. Review the opinion for missing referenced documents; the app does not read or interpret it automatically.</p>}
    {references.map(source => <ReferenceCard key={`${source.id}:${source.reviews.length}`} order={order} source={source} locked={locked} />)}
  </section>;
}

function ReferenceCard({ order, source, locked }: { order: Order; source: ReferencedSource; locked: boolean }) {
  const { s, update } = useWorkspace();
  const [decision, setDecision] = useState<"Reviewed" | "Not applicable">("Reviewed");
  const [documentId, setDocumentId] = useState("");
  const [rationale, setRationale] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState("");
  const docs = orderSources(s, order.id).filter(d => source.role === "Other" || d.sourceRole === source.role);
  const chosen = docs.find(d => d.id === documentId);
  const status = referencedSourceStatus(s, order, source);
  const last = source.reviews.at(-1);
  const needsReview = status === "Pending" || status === "Source changed";
  const doc = s.documents.find(d => d.id === preview && d.orderId === order.id && d.companyId === order.companyId);
  return <article className="referenced-source-card">
    <div className="referenced-sources-heading"><strong>{source.role} · {source.required ? "Required" : "Optional"}</strong><span className={`referenced-source-status ${needsReview ? "pending" : "reviewed"}`}>{status}</span></div>
    <blockquote>{source.wording}</blockquote>
    {status === "Source changed" && <p className="form-note">The reviewed document is no longer the current version. Review the replacement before preparing this file.</p>}
    {last && <div className="referenced-source-decision">
      <p>{last.rationale}</p>
      <small>{last.reviewedBy} · {new Date(last.reviewedAt).toLocaleString()}{last.documentId ? ` · document v${last.documentVersion}` : ""}</small>
      {last.documentId && <Button variant="ghost" size="sm" onClick={() => setPreview(last.documentId)}><FileText size={14} /> View reviewed document</Button>}
    </div>}
    {!locked && (needsReview || editing) && <form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      if (await update(d => reviewReferencedSource(d, order.id, source.id, {
        decision, documentId: chosen?.id || "", documentVersion: chosen?.version || 0, rationale,
      }), "Referenced source reviewed", order.id)) { setEditing(false); setRationale(""); }
    }}>
      <div className="form-grid">
        <FieldLabel label="Review decision"><Picker label={`Decision for ${source.id}`} value={decision} onChange={v => setDecision(v as typeof decision)} options={["Reviewed", "Not applicable"]} /></FieldLabel>
        {decision === "Reviewed" && <FieldLabel label="Current referenced document"><Picker label={`Document for ${source.id}`} value={documentId || "none"} onChange={v => setDocumentId(v === "none" ? "" : v)} options={[{ value: "none", label: "Select current document" }, ...docs.map(d => ({ value: d.id, label: `${d.name} · v${d.version}` }))]} /></FieldLabel>}
      </div>
      {chosen && decision === "Reviewed" && <Button type="button" variant="ghost" onClick={() => setPreview(chosen.id)}><FileText size={14} /> Open selected source</Button>}
      <FieldLabel label="Review rationale"><Textarea aria-label={`Rationale for ${source.id}`} required maxLength={5000} rows={3} value={rationale} onChange={e => setRationale(e.target.value)} placeholder={decision === "Not applicable" ? "Explain why this reference is not applicable." : "Record what was checked and the relevant pages or sections."} /></FieldLabel>
      <Button type="submit" disabled={!rationale.trim() || (decision === "Reviewed" && !chosen)}>Record review decision</Button>
    </form>}
    {!locked && !needsReview && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Record another decision</Button>}
    {source.reviews.length > 1 && <details className="referenced-source-history"><summary>Review history ({source.reviews.length})</summary>{source.reviews.map((r, i) => <p key={i}><strong>{r.decision}</strong> · {r.reviewedBy} · {new Date(r.reviewedAt).toLocaleString()}{r.documentId ? ` · ${s.documents.find(d => d.id === r.documentId)?.name || "Document unavailable"} v${r.documentVersion}` : ""}<br />{r.rationale}</p>)}</details>}
    {doc && <DocumentPreview doc={doc} onClose={() => setPreview("")} />}
  </article>;
}
