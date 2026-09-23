"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileScan, FileText, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAsset, useWorkspace } from "@/lib/title/store";
import type { VaultDoc } from "@/lib/title/model";
import type { SourceCaptureContext } from "@/lib/title/production";
import { analyzeTitleDocuments, type CandidateReview, type DocumentCandidate, type DocumentField } from "@/lib/title/document-intelligence";
import type { PackageScanCheckpoint, PackageScanIdentity, PackageScanPage } from "@/lib/title/package-scan";
import { documentScanIdentity } from "./use-document-scan";
import { FieldLabel } from "./shared";

export type PackageCaptureValue = { id: string; value: string; evidence: SourceCaptureContext["fields"][string] };
export type CompanyProfileCapture = { packageId: string; packageVersion: number; sourceIdentities: { documentId: string; identity: string }[]; values: { name?: string; contact?: string; email?: string } };
type StoredPage = PackageScanPage & { documentId: string };
type SavedPackage = { id: string; version: number; accessIdentity: string; sources: PackageScanIdentity[]; checkpoint: PackageScanCheckpoint | null; pages: StoredPage[]; decisions: CandidateReview[] };
type Props = {
  documents: VaultDoc[];
  onOpenOriginal: (document: VaultDoc) => void;
  onCapture?: (document: VaultDoc, values: PackageCaptureValue[]) => void;
  captureFields?: Record<string, string[]>;
  onCompanyCapture?: (capture: CompanyProfileCapture) => void;
};
const readable = (doc: VaultDoc) => !!doc.assetId && ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(doc.mime || "");

export function PackageReviewButton(props: Props) {
  const { connection } = useWorkspace();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const allowed = !!connection && ["owner", "admin", "operations", "onboarding"].includes(connection.access.role);
  const documents = props.documents.filter(readable);
  const scope = JSON.stringify([connection?.workspaceId, connection?.access.userId, connection?.access.version, documents.map(doc => documentScanIdentity(doc, connection)).sort()]);
  if (!allowed) return null;
  return <>
    <Button ref={trigger} variant="outline" disabled={!documents.length} onClick={() => setOpen(true)}><FileScan />Read document package</Button>
    {open && <PackageReview key={scope} {...props} documents={documents} onClose={() => setOpen(false)} onReturnFocus={() => trigger.current?.focus()} />}
  </>;
}

function PackageReview({ documents, onOpenOriginal, onCapture, captureFields, onCompanyCapture, onClose, onReturnFocus }: Props & { onClose: () => void; onReturnFocus: () => void }) {
  const { connection } = useWorkspace();
  const [selected, setSelected] = useState(() => documents.map(doc => doc.id));
  const [saved, setSaved] = useState<SavedPackage | null>(null);
  const latest = useRef<SavedPackage | null>(null);
  const [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [showMissing, setShowMissing] = useState(false);
  const alive = useRef(true), working = useRef(false), abort = useRef<AbortController | null>(null);
  const restoreFocus = useRef(false);
  function close(restore = true) { restoreFocus.current = restore; abort.current?.abort(); onClose(); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); latest.current = null; }; }, []);
  const publish = (value: SavedPackage) => { latest.current = value; if (alive.current) setSaved(value); };
  async function request<T,>(action: string, input: Record<string, unknown>) {
    if (!alive.current || !connection) throw new Error("Reopen this package under your current signed-in account.");
    const { activeWorkspace, backendRequest } = await import("@/lib/backend/client");
    if (!alive.current) throw new Error("Package review closed.");
    const workspaceId = connection.workspaceId || activeWorkspace();
    const result = await backendRequest<T>(`/document-packages/${action}`, { workspaceId, ...input }, "POST", 120000, workspaceId, connection.access.userId);
    if (!alive.current) throw new Error("Package review closed.");
    return result;
  }
  async function operation(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "The document review could not be completed."); }
    finally { working.current = false; if (alive.current) { setBusy(false); setScanning(false); } }
  }
  async function openPackage() {
    await operation(async () => {
      setMessage("Opening the saved review…");
      const result = await request<SavedPackage>("open", { documentIds: selected });
      if (!result.id || !Array.isArray(result.sources) || !Array.isArray(result.pages) || !Array.isArray(result.decisions)) throw new Error("The saved review was incomplete. Reopen the package.");
      publish(result);
      setMessage(result.checkpoint ? "Saved pages and review decisions restored." : "Ready to scan the selected originals.");
    });
  }
  async function scan() {
    await operation(async () => {
      const session = latest.current;
      if (!session) throw new Error("Open the package first.");
      const controller = new AbortController(); abort.current = controller; setScanning(true);
      const { readDocumentPackage } = await import("@/lib/title/package-reader");
      if (!alive.current) return;
      const inputs = session.sources.map(source => {
        const doc = documents.find(doc => doc.id === source.documentId);
        if (!doc) throw new Error("A source is no longer available. Reopen the package.");
        return { document: doc, loadOriginal: async () => {
          if (!alive.current) throw new Error("Package review closed.");
          const blob = await getAsset(doc.assetId!);
          if (!blob) throw new Error(`Restore the uploaded original for ${doc.name} before scanning.`);
          return blob;
        } };
      });
      const result = await readDocumentPackage(inputs, {
        accessIdentity: session.accessIdentity, signal: controller.signal,
        loadCheckpoint: async identities => {
          if (JSON.stringify(identities) !== JSON.stringify(session.sources)) throw new Error("Original bytes or source details changed. Reopen the package.");
          return session.checkpoint;
        },
        onProgress: progress => { if (alive.current) setMessage(progress.message); },
        onBatch: async (batch, checkpoint) => {
          const current = latest.current;
          if (!current || current.id !== session.id) throw new Error("Package review changed. Reopen it before continuing.");
          const result = await request<{ version: number }>("save", { id: session.id, expectedVersion: current.version, batch, checkpoint });
          if (!Number.isSafeInteger(result.version) || result.version <= current.version) throw new Error("The scan checkpoint was not confirmed. Reopen the package to recover saved pages.");
          const pages = new Map(current.pages.map(page => [`${page.documentId}:${page.page}`, page]));
          for (const page of batch.pages) pages.set(`${batch.source.documentId}:${page.page}`, { ...page, documentId: batch.source.documentId });
          publish({ ...current, version: result.version, checkpoint, pages: [...pages.values()], decisions: batch.pages.length ? [] : current.decisions });
        },
      });
      if (alive.current) setMessage(result.status === "complete" ? `All ${result.totalPages} pages read and saved. Review the field suggestions below.` : `${result.completedPages} of ${result.totalPages} pages saved. Resume to read unfinished pages.`);
    });
  }
  async function record(candidate: DocumentCandidate, action: "accepted" | "corrected" | "rejected", value: string, note: string) {
    await operation(async () => {
      const current = latest.current;
      if (!current) throw new Error("Open the current review first.");
      const result = await request<{ version: number; decisions: CandidateReview[] }>("review", { id: current.id, expectedVersion: current.version, decisions: [{ candidateId: candidate.id, action, ...(action === "corrected" ? { value } : {}), note }] });
      if (!Number.isSafeInteger(result.version) || result.version <= current.version || !Array.isArray(result.decisions)) throw new Error("The review decision was not confirmed. Reopen the package.");
      publish({ ...current, version: result.version, decisions: result.decisions });
      setMessage("Review decision saved. Business fields remain unchanged until you explicitly capture them.");
    });
  }
  const analysis = useMemo(() => {
    if (!saved || scanning) return { review: null, error: "" };
    try {
      return { review: analyzeTitleDocuments(saved.sources.map(source => ({ id: source.documentId, name: source.name, version: source.version, pages: saved.pages.filter(page => page.documentId === source.documentId) })).filter(doc => doc.pages.length)), error: "" };
    } catch (reason) { return { review: null, error: reason instanceof Error ? reason.message : "Review suggestions could not be prepared." }; }
  }, [saved, scanning]);
  const total = saved?.checkpoint?.sources.reduce((count, source) => count + source.totalPages, 0) || 0;
  const completed = saved?.checkpoint?.sources.reduce((count, source) => count + source.completed.length, 0) || 0;
  const fields = analysis.review?.fields.filter(field => (showMissing || field.candidates.length) && (category === "all" || field.category === category)) || [];
  const newestDecisions = new Map((saved?.decisions || []).map(decision => [decision.candidateId, decision]));
  function captureDocument(doc: VaultDoc) {
    if (!onCapture || !analysis.review || busy) return;
    const values: PackageCaptureValue[] = [];
    for (const field of analysis.review.fields.filter(field => captureFields?.[doc.id]?.includes(field.fieldId))) {
      const choices = field.candidates.filter(candidate => candidate.evidence.documentId === doc.id).flatMap(candidate => {
        const decision = newestDecisions.get(candidate.id);
        return decision && decision.disposition !== "rejected" && decision.reviewedValue ? [{ candidate, decision }] : [];
      });
      if (!choices.length) continue;
      if (new Set(field.candidates.map(candidate => candidate.rawValue)).size > 1 && field.candidates.some(candidate => !newestDecisions.has(candidate.id))) {
        setError(`Review every conflicting ${field.label} suggestion before capturing this source. Accept, correct or reject each source value.`); return;
      }
      if (new Set(choices.map(choice => choice.decision.reviewedValue)).size !== 1) { setError(`Resolve the accepted ${field.label} values before capturing this source. Reject the inapplicable suggestion.`); return; }
      const { candidate, decision } = choices[0];
      const page = saved?.pages.find(page => page.documentId === doc.id && page.page === candidate.evidence.page);
      values.push({ id: field.fieldId, value: decision.reviewedValue!, evidence: {
        page: `${doc.mime === "application/pdf" ? "PDF page" : doc.mime === "text/plain" ? "Text page" : "Image"} ${candidate.evidence.page}${candidate.evidence.method === "ocr" ? ` · OCR ${page?.rotation || 0}°` : ""}`,
        method: candidate.evidence.method, quote: candidate.evidence.quote, suggestedValue: candidate.rawValue,
        ...(candidate.evidence.confidence !== undefined ? { engineConfidence: candidate.evidence.confidence } : {}),
      } });
    }
    if (!values.length) { setError("Accept or correct at least one source-appropriate field before opening capture."); return; }
    onCapture(doc, values); close(false);
  }
  function captureCompany() {
    if (!onCompanyCapture || !analysis.review || !saved || busy) return;
    const values: CompanyProfileCapture["values"] = {};
    for (const [fieldId, target] of [["companyLegalName", "name"], ["companyContact", "contact"], ["companyEmail", "email"]] as const) {
      const field = analysis.review.fields.find(row => row.fieldId === fieldId);
      if (!field) continue;
      const accepted = field.candidates.flatMap(candidate => {
        const decision = newestDecisions.get(candidate.id);
        return decision && decision.disposition !== "rejected" && decision.reviewedValue ? [decision.reviewedValue] : [];
      });
      if (!accepted.length) continue;
      if (new Set(accepted).size !== 1 || (new Set(field.candidates.map(candidate => candidate.rawValue)).size > 1 && field.candidates.some(candidate => !newestDecisions.has(candidate.id)))) { setError(`Resolve every conflicting ${field.label} suggestion before filling the company profile.`); return; }
      if (accepted[0].length > (target === "email" ? 254 : 100)) { setError(`${field.label} is too long for the company profile. Review and shorten the corrected value first.`); return; }
      values[target] = accepted[0];
    }
    if (!Object.keys(values).length) { setError("Accept or correct a company legal name, primary contact or contact email before filling the profile."); return; }
    onCompanyCapture({ packageId: saved.id, packageVersion: saved.version, values, sourceIdentities: saved.sources.map(source => ({ documentId: source.documentId, identity: documentScanIdentity(documents.find(doc => doc.id === source.documentId)!, connection) })) });
    close(false);
  }

  return <Dialog open onOpenChange={value => { if (!value) close(); }}>
    <DialogContent className="modal" style={{ maxWidth: 1000, maxHeight: "90dvh", overflowY: "auto" }} onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus.current) onReturnFocus(); }}>
      <DialogHeader><DialogTitle>Read and review a document package</DialogTitle><DialogDescription>Read the originals, identify supported title and company information, and review every value with its page evidence.</DialogDescription></DialogHeader>
      <p className="form-note">Up to 1,000 pages across 100 originals, 25 MB each and 500 MB total. Completed page batches and review decisions save to your private workspace. Keep this window open while scanning; reopen the same originals to resume later. Reading new pages resets earlier field decisions so newly found conflicts receive a fresh review.</p>
      {!saved && <>
        <div style={{ maxHeight: "30vh", overflowY: "auto" }}>{documents.map(doc => <label key={doc.id} className="duplicate-ack" style={{ marginBlock: 10 }}><Checkbox checked={selected.includes(doc.id)} disabled={busy} onCheckedChange={checked => setSelected(ids => checked === true ? [...new Set([...ids, doc.id])] : ids.filter(id => id !== doc.id))} aria-label={`Include ${doc.name}`} /><span>{doc.name} · v{doc.version}</span></label>)}</div>
        {new Set(documents.filter(doc => selected.includes(doc.id)).map(doc => doc.companyId)).size > 1 && <p role="alert">Select originals from one company for each package.</p>}
        <Button disabled={busy || !selected.length || selected.length > 100 || new Set(documents.filter(doc => selected.includes(doc.id)).map(doc => doc.companyId)).size > 1} onClick={() => void openPackage()}>Open saved package review</Button>
      </>}
      {error && <p role="alert" className="notice warning">{error}</p>}
      {message && <p role="status" aria-live="polite">{message}</p>}
      {saved && <>
        <div className="source-actions"><Button disabled={busy} onClick={() => void scan()}><FileScan />{saved.checkpoint ? "Resume / retry unread pages" : "Scan every page"}</Button>{scanning && <Button variant="outline" onClick={() => { abort.current?.abort(); setMessage("Pausing after the current saved batch…"); }}><Pause />Pause scanning</Button>}<Button disabled={busy} variant="outline" onClick={() => { setSaved(null); latest.current = null; setMessage(""); }}>Choose originals</Button></div>
        {!!total && <><progress aria-label="Package pages saved" max={total} value={completed} style={{ width: "100%" }} /><p>{completed} of {total} physical pages read and saved{completed === total ? "." : "; unread pages still need review."}</p></>}
        <div>{saved.sources.map(source => {
          const doc = documents.find(doc => doc.id === source.documentId);
          const checkpoint = saved.checkpoint?.sources.find(row => row.identity.documentId === source.documentId);
          const classified = analysis.review?.documents.find(row => row.id === source.documentId);
          const accepted = (analysis.review?.fields || []).flatMap(field => field.candidates).some(candidate => candidate.evidence.documentId === source.documentId && newestDecisions.has(candidate.id) && newestDecisions.get(candidate.id)?.disposition !== "rejected");
          return <section className="panel" key={source.documentId} style={{ padding: 12, marginBlock: 10 }}><strong>{source.name} · v{source.version}</strong><p className="form-note">{classified ? `Suggested document types: ${classified.roles.join(", ")}.` : "Document type review will appear after scanning."}</p><Button variant="outline" size="sm" disabled={!doc} onClick={() => doc && onOpenOriginal(doc)}><FileText />Open original</Button>{onCapture && !!captureFields?.[source.documentId]?.length && <Button variant="outline" size="sm" disabled={busy || !accepted || !doc} onClick={() => doc && captureDocument(doc)}>Capture reviewed fields from {source.name}</Button>}{checkpoint && !!checkpoint.issues.length && <details><summary>{checkpoint.issues.length} page(s) need manual review or retry</summary><ul>{checkpoint.issues.map(issue => <li key={issue.page}>Page {issue.page}: {issue.message}</li>)}</ul></details>}</section>;
        })}</div>
        {analysis.error && <p role="alert" className="notice warning">{analysis.error}</p>}
        {analysis.review && saved.pages.length > 0 && !scanning && <>
          <p className="form-note">Suggestions distinguish deed, security instrument, prior policy, company and property evidence. Conflicting values stay visible. Nothing is approved, sent, or written to business fields automatically.</p>
          {analysis.review.warnings.map(warning => <p key={warning} className="notice warning">{warning}</p>)}
          {onCompanyCapture && <Button variant="outline" disabled={busy || !saved.decisions.some(decision => ["companyLegalName", "companyContact", "companyEmail"].includes(decision.fieldId) && decision.disposition !== "rejected")} onClick={captureCompany}>Use reviewed company details</Button>}
          <div className="form-grid"><FieldLabel label="Review category"><select aria-label="Review category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All suggested information</option><option value="title">Title recording and vesting</option><option value="company">Company and ownership</option><option value="property">Property details</option><option value="policy">Prior policy details</option></select></FieldLabel><label className="duplicate-ack"><Checkbox checked={showMissing} onCheckedChange={value => setShowMissing(value === true)} />Show fields with no supported evidence</label></div>
          {!fields.length && <p>No supported field suggestions in this category. Compare the original and capture missing information manually.</p>}
          {fields.map(field => <section key={field.fieldId} style={{ borderTop: "1px solid var(--border)", paddingBlock: 14 }}><h3>{field.label}</h3>{field.status === "ambiguous" && <p className="notice warning">Resolve the document and entity context before choosing among these values.</p>}{field.warnings.map(warning => <p key={warning} className="form-note">{warning}</p>)}{field.candidates.map(candidate => <PackageCandidate key={`${candidate.id}:${newestDecisions.get(candidate.id)?.reviewedAt || "new"}`} field={field} candidate={candidate} source={saved.sources.find(source => source.documentId === candidate.evidence.documentId)!} decision={newestDecisions.get(candidate.id)} disabled={busy} onOriginal={() => { const doc = documents.find(doc => doc.id === candidate.evidence.documentId); if (doc) onOpenOriginal(doc); }} onRecord={(action, value, note) => record(candidate, action, value, note)} />)}</section>)}
        </>}
      </>}
      <div className="form-actions"><Button variant="outline" onClick={() => close()}>Close review</Button></div>
    </DialogContent>
  </Dialog>;
}

function PackageCandidate({ field, candidate, source, decision, disabled, onOriginal, onRecord }: {
  field: DocumentField; candidate: DocumentCandidate; source: PackageScanIdentity; decision?: CandidateReview; disabled: boolean;
  onOriginal: () => void; onRecord: (action: "accepted" | "corrected" | "rejected", value: string, note: string) => Promise<void>;
}) {
  const [value, setValue] = useState(decision?.reviewedValue || candidate.rawValue);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return <article className="form-stack" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBlock: 12 }}>
    <strong>{candidate.rawValue}</strong><p>{source.name} · version {candidate.evidence.documentVersion} · page {candidate.evidence.page} · {candidate.evidence.method === "ocr" ? "OCR" : "source text"}</p>
    <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{candidate.evidence.quote}</blockquote>
    {candidate.warnings.map(warning => <p className="form-note" key={warning}>{warning}</p>)}
    <Button size="sm" variant="outline" onClick={onOriginal}>Compare page {candidate.evidence.page} with original</Button>
    {decision && <p role="status">Saved decision: {decision.disposition}{decision.reviewedValue ? ` · ${decision.reviewedValue}` : ""}. {decision.note}</p>}
    <FieldLabel label={`Reviewed ${field.label} from ${source.name} page ${candidate.evidence.page}`}><Input value={value} disabled={disabled} maxLength={2000} onChange={event => { setValue(event.target.value); setConfirmed(false); }} /></FieldLabel>
    <FieldLabel label={`Review note for ${field.label} from ${source.name} page ${candidate.evidence.page}`}><Textarea value={note} disabled={disabled} maxLength={1000} rows={2} placeholder="What did you confirm or correct against this original?" onChange={event => setNote(event.target.value)} /></FieldLabel>
    <label className="duplicate-ack"><Checkbox checked={confirmed} disabled={disabled} onCheckedChange={checked => setConfirmed(checked === true)} aria-label={`Compared ${field.label} on ${source.name} page ${candidate.evidence.page} with original`} /><span>I compared this value and its document context against the original page.</span></label>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button disabled={disabled || !confirmed || !note.trim() || !value.trim()} onClick={() => void onRecord(value === candidate.rawValue ? "accepted" : "corrected", value, note)}>{value === candidate.rawValue ? "Accept reviewed value" : "Save corrected value"}</Button><Button variant="outline" disabled={disabled || !note.trim()} onClick={() => void onRecord("rejected", value, note)}>Reject suggestion</Button></div>
  </article>;
}
