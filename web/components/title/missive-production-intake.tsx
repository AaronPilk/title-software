"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { activeWorkspace, backendRequest } from "@/lib/backend/client";
import type { MissiveIntakePreview } from "@/lib/backend/missive-intake";
import { useWorkspace } from "@/lib/title/store";
import styles from "./missive-live-inbox.module.css";

export type MissiveFileActions = { onOpenFile?: (orderId: string) => void; onCreateFile?: (companyId?: string) => void };
type Props = MissiveFileActions & { workspaceId: string; userId: string; routeId: string; revision: number; companyId: string; conversationId: string; messageId: string };
type Saved = { revision: number; orderId: string; saved: boolean };

/** The review belongs to one mounted account/route/message. Nothing is selected
 * automatically, including a unique suggested title file. */
export function MissiveProductionIntake({ onOpenFile, onCreateFile, ...identity }: Props) {
  const { connection } = useWorkspace();
  const [preview, setPreview] = useState<MissiveIntakePreview | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [orderId, setOrderId] = useState(""), [kind, setKind] = useState("Finals"), [reviewed, setReviewed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [sourceSaved, setSourceSaved] = useState(false);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const revision = useRef(0), requests = useRef(new Map<string, string>()), live = useRef(false), working = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && activeWorkspace() === identity.workspaceId;
  const call = async <T,>(path: string, values: Record<string, unknown>) => {
    if (!current()) throw new Error("The workspace changed. Reopen the email.");
    const result = await backendRequest<T>(path, { workspaceId: identity.workspaceId, routeId: identity.routeId, revision: identity.revision,
      conversationId: identity.conversationId, messageId: identity.messageId, ...values }, "POST", 120_000, identity.workspaceId, identity.userId, true);
    if (!current()) throw new Error("The workspace changed. Reopen the email.");
    return result;
  };
  const load = async () => {
    if (working.current) return; working.current = true; setBusy(true); setError(""); setOpen(true);
    try {
      const result = await call<MissiveIntakePreview>("/missive-intake/preview", {});
      if (result.companyId !== identity.companyId || result.routingRevision !== identity.revision ||
          result.message.id !== identity.messageId || result.message.conversationId !== identity.conversationId) throw new Error("The email destination changed. Refresh the inbox.");
      revision.current = result.revision; setPreview(result); setReviewed(false); setSelected([]); setOrderId("");
      setSourceSaved(false); setAttachments({}); requests.current.clear();
    } catch (reason) { if (current()) { setPreview(null); setError(reason instanceof Error ? reason.message : "Unable to review this email."); } }
    finally { working.current = false; if (current()) setBusy(false); }
  };
  const save = async () => {
    if (!preview || !orderId || !reviewed || working.current) return;
    working.current = true; setBusy(true); setError("");
    const saveOne = async (attachmentId?: string) => {
      const key = `${attachmentId || "source"}:${orderId}:${kind}:${preview.message.fingerprint}:${revision.current}`;
      let requestId = requests.current.get(key); if (!requestId) { requestId = crypto.randomUUID(); requests.current.set(key, requestId); }
      const result = await call<Saved>(attachmentId ? "/missive-intake/save-attachment" : "/missive-intake/save-source", {
        orderId, kind, fingerprint: preview.message.fingerprint, expectedRevision: revision.current, requestId, ...(attachmentId ? { attachmentId } : {}),
      });
      if (!result.saved || result.orderId !== orderId || !Number.isSafeInteger(result.revision)) throw new Error("The save could not be confirmed. Retry to check its result.");
      revision.current = result.revision;
    };
    try {
      if (!sourceSaved) { await saveOne(); setSourceSaved(true); }
      for (const attachmentId of selected) {
        if (attachments[attachmentId] === "Saved") continue;
        setAttachments(previous => ({ ...previous, [attachmentId]: "Saving…" }));
        try { await saveOne(attachmentId); setAttachments(previous => ({ ...previous, [attachmentId]: "Saved" })); }
        catch (reason) {
          if (current()) setAttachments(previous => ({ ...previous, [attachmentId]: "Not confirmed — retry" }));
          throw reason;
        }
      }
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "This save could not be completed. Retry to check its result."); }
    finally {
      working.current = false;
      if (current()) { setBusy(false); await connection?.refresh(); }
    }
  };
  if (!open) return <Button variant="outline" onClick={() => void load()}>Save to title file</Button>;
  return <section className={styles.intake} aria-label="Review email for title file">
    <h4>Save received email to a title file</h4>
    <p>The source will be retained unchanged in the selected file. Selected attachments are saved individually. Missive messages remain unchanged.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy && !preview && <p role="status">Loading the complete email for review…</p>}
    {!preview && !busy && <Button variant="outline" onClick={() => void load()}>Retry review</Button>}
    {preview && <>
      {preview.files.length ? <>
        <label>Existing title file<select aria-label="Existing title file" disabled={busy || sourceSaved} value={orderId} onChange={event => { setOrderId(event.target.value); setReviewed(false); }}>
          <option value="">Choose a file in this company</option>
          {preview.files.filter(file => !preview.existingOrderId || file.id === preview.existingOrderId).map(file => <option key={file.id} value={file.id}>{file.suggested ? "Suggested · " : ""}{file.id} · {file.address} · {file.client}</option>)}
        </select></label>
        {preview.files.some(file => file.suggested) && <p>Suggestions use the file number or address in this email. Confirm the company and file before saving.</p>}
        {preview.existingOrderId && <p>This email was already saved to {preview.existingOrderId}. Its original destination is preserved.</p>}
        <label>Request type<select aria-label="Request type" value={kind} disabled={busy || sourceSaved} onChange={event => setKind(event.target.value)}><option>Finals</option><option>Revision</option><option>Commitment</option></select></label>
      </> : <div><p>No open title files are available in this company. Create a title file with the known property details, then return to this email.</p>
        {onCreateFile && <Button variant="outline" onClick={() => onCreateFile(identity.companyId)}>Create title file</Button>}</div>}
      <details open><summary>Immutable email source</summary><p>{preview.message.subject}<br />{preview.message.from} &lt;{preview.message.email}&gt;<br />{preview.message.receivedAt}</p><pre>{preview.message.body || "(Message body is empty.)"}</pre></details>
      {preview.message.attachments.length > 0 && <fieldset disabled={busy}><legend>Attachments to save</legend>
        {!preview.attachmentDownloadEnabled && <p>Attachment saving needs an approved storage origin in server settings. You can save the email source now.</p>}
        {preview.message.attachments.map(file => <label className={styles.check} key={file.id}><input type="checkbox" disabled={!preview.attachmentDownloadEnabled || attachments[file.id] === "Saved"} checked={selected.includes(file.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, file.id] : previous.filter(id => id !== file.id))} />
          <span>{file.name} · {file.bytes.toLocaleString()} bytes{attachments[file.id] && <strong> · {attachments[file.id]}</strong>}</span></label>)}
      </fieldset>}
      <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy || sourceSaved || !orderId} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed this email and confirm the selected company file is its destination.</span></label>
      {sourceSaved && <p role="status">Email source saved to {orderId}. {selected.filter(id => attachments[id] === "Saved").length} of {selected.length} selected attachments saved.</p>}
      <div className={styles.intakeActions}><Button disabled={busy || !orderId || !reviewed || (sourceSaved && selected.every(id => attachments[id] === "Saved"))} onClick={() => void save()}>{busy ? "Saving…" : sourceSaved ? "Retry remaining attachments" : "Save reviewed email"}</Button>
        {sourceSaved && onOpenFile && <Button variant="outline" disabled={busy} onClick={() => onOpenFile(orderId)}>Open title file</Button>}
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>Reopen review</Button>
      </div>
    </>}
  </section>;
}
