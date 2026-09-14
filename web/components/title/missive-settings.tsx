"use client";
import { useEffect, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { backendRequest, downloadRemoteAsset } from "@/lib/backend/client";
import { download, useWorkspace } from "@/lib/title/store";
import { productionLocked } from "@/lib/title/production";
import type { MissiveCheck, MissiveSetup } from "@/lib/backend/missive";
import type { MissiveMapping, MissivePage, MissivePreview } from "@/lib/backend/missive-import";

type Setup = MissiveSetup & { mapping: MissiveMapping | null; attachmentDownloadEnabled?: boolean };
type MissiveEvent = { id: string; messageId: string; conversationId: string; subject: string; receivedAt: string; status: "queued" | "completed"; mappingVersion: number; companyId: string; teamId: string; currentMapping: boolean };
type Events = { events: MissiveEvent[]; webhookConfigured: boolean; nextOffset: number | null };
export function MissiveSettings({ workspaceId }: { workspaceId: string }) {
  const { s, connection } = useWorkspace();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [check, setCheck] = useState<MissiveCheck | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [teamId, setTeamId] = useState(""), [companyId, setCompanyId] = useState("");
  const [conversations, setConversations] = useState<MissivePage | null>(null);
  const [messages, setMessages] = useState<MissivePage | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [preview, setPreview] = useState<MissivePreview | null>(null);
  const [orderId, setOrderId] = useState(""), [kind, setKind] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sourceMailId, setSourceMailId] = useState("");
  const [events, setEvents] = useState<Events | null>(null);
  const mapping = setup?.mapping;
  const importedSources = s.inbox.filter(m => mapping && m.missive && m.companyId === mapping.companyId &&
    m.missive.organizationId === mapping.organizationId && m.missive.teamId === mapping.teamId);
  const sourceMail = importedSources.find(m => m.id === sourceMailId);
  const sourceOrder = s.orders.find(o => o.id === sourceMail?.orderId);
  const sourceLocked = !sourceOrder || productionLocked(s, sourceOrder);
  useEffect(() => {
    let cancelled = false;
    backendRequest<Setup>("/integrations/missive")
      .then(value => { if (!cancelled) setSetup(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load Missive settings."); });
    return () => { cancelled = true; };
  }, [workspaceId]);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Missive request failed."); }
    finally { setBusy(false); }
  }
  function resetReview() { setPreview(null); setOrderId(""); setKind(""); setReviewed(false); }
  const request = <T,>(path: string, input: Record<string, unknown> = {}, timeoutMs = 30000) => backendRequest<T>(`/integrations/missive/${path}`, {
    workspaceId, expectedMappingVersion: mapping?.version || 0, ...input,
  }, "POST", timeoutMs);
  async function loadConversations(until?: number) {
    resetReview(); setMessages(null); setConversationId("");
    setConversations(await request<MissivePage>("conversations", { until }));
  }
  return (
    <div className="backend-settings-section">
      <h3><Mail size={18} /> Missive</h3>
      <p>Review incoming emails, save the original message, then import selected attachments into the same title file.</p>
      {setup?.status === "workspace_required" && <p className="form-note">Assign this workspace to the server’s Missive connection to continue.</p>}
      {setup?.status === "token_required" && <p className="form-note">Add a working Missive REST API token as the server secret MISSIVE_API_TOKEN.</p>}
      <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        setCheck(null); resetReview(); setConversations(null); setMessages(null); setEvents(null);
        const current = await backendRequest<Setup>("/integrations/missive"); setSetup(current);
        if (current.status === "ready") setCheck(await request<MissiveCheck>("check"));
      })}><RefreshCw size={16} /> {busy ? "Working…" : "Check Missive connection"}</Button>
      {error && <p role="alert" className="form-note">{error}</p>}
      {notice && <p role="status" className="form-note">{notice}</p>}
      {check && <div>
        <p><strong>Connection verified.</strong> Choose the team inbox and the company it feeds.</p>
        {(check.moreOrganizations || check.moreTeams) && <p className="form-note">This directory shows the first 200 organizations and teams. Additional teams need a separate connection review.</p>}
        <div className="form-grid">
          <label>Missive team inbox<select aria-label="Missive team inbox" value={teamId} disabled={busy} onChange={e => setTeamId(e.target.value)}>
            <option value="">Select an inbox</option>
            {check.teamInboxes.map(t => <option value={t.id} key={t.id}>{t.name} · {check.organizations.find(o => o.id === t.organizationId)?.name || t.organizationId}</option>)}
          </select></label>
          <label>Destination company<select aria-label="Missive destination company" value={companyId} disabled={busy} onChange={e => setCompanyId(e.target.value)}>
            <option value="">Select a company</option>{s.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        </div>
        <Button disabled={busy || !teamId || !companyId} onClick={() => void run(async () => {
          const result = await request<{ mapping: MissiveMapping }>("mapping", { teamId, companyId });
          setSetup(current => current ? { ...current, mapping: result.mapping } : current);
          resetReview(); setConversations(null); setMessages(null); setSourceMailId(""); setEvents(null); setNotice("Inbox routing saved.");
        })}>Save reviewed inbox routing</Button>
      </div>}
      {mapping && <div>
        <p><strong>{mapping.teamName}</strong> → {s.companies.find(c => c.id === mapping.companyId)?.name || "Company unavailable"}</p>
        <p className="form-note">This shows the team’s current inbox queue. Assigned and archived conversations may no longer appear. Review each message before importing.</p>
        <Button variant="outline" disabled={busy || setup?.status !== "ready"} onClick={() => void run(() => loadConversations())}>Browse inbox queue</Button>
        <Button variant="ghost" disabled={busy || setup?.status !== "ready"} onClick={() => void run(async () => setEvents(await request<Events>("events")))}>Refresh incoming events</Button>
      </div>}
      {events && <section aria-label="Incoming Missive events">
        <h4>Incoming events</h4>
        <p className="form-note">New source events await your review before anything enters a title file. Pending events are shown oldest first.</p>
        {!events.webhookConfigured && <p className="form-note">Incoming event delivery is not configured yet. You can still browse the inbox queue.</p>}
        {!events.events.some(e => e.status === "queued") && <p>No incoming events awaiting review.</p>}
        {events.events.filter(e => e.status === "queued").map(event => <div key={event.id}>
          <p><strong>{event.subject || "Incoming email"}</strong> · {new Date(event.receivedAt).toLocaleString()}</p>
          {!event.currentMapping && <p className="form-note">This event belongs to {s.companies.find(c => c.id === event.companyId)?.name || "a previously mapped company"}, inbox {event.teamId}. Review and restore its inbox routing above before opening it.</p>}
          <Button variant="outline" disabled={busy || !event.currentMapping} onClick={() => void run(async () => {
            resetReview(); setMessages(null); setConversationId(event.conversationId);
            setPreview(await request<MissivePreview>("preview", { messageId: event.messageId }));
          })}>Review incoming email</Button>
        </div>)}
        {events.nextOffset !== null && <Button variant="ghost" disabled={busy} onClick={() => void run(async () => {
          setEvents(await request<Events>("events", { offset: events.nextOffset }));
        })}>Next pending events</Button>}
      </section>}
      {conversations && <div>
        <label>Conversation<select aria-label="Missive conversation" value={conversationId} disabled={busy} onChange={e => {
          const id = e.target.value; setConversationId(id); resetReview(); setMessages(null);
          if (id) void run(async () => { setMessages(await request<MissivePage>("messages", { conversationId: id })); });
        }}><option value="">Select a conversation</option>{conversations.rows.map(c => <option key={c.id} value={c.id}>{c.subject} · {new Date(c.at * 1000).toLocaleDateString()}</option>)}</select></label>
        {!!conversations.skipped && <p>{conversations.skipped} unavailable conversations omitted.</p>}
        {!conversations.rows.length && <p>No readable conversations on this page.</p>}
        {conversations.until && <Button variant="ghost" disabled={busy} onClick={() => void run(() => loadConversations(conversations.until!))}>Older conversations</Button>}
      </div>}
      {messages && <div>
        <label>Email message<select aria-label="Missive message" value={preview?.id || ""} disabled={busy} onChange={e => {
          const id = e.target.value; resetReview();
          if (id) void run(async () => setPreview(await request<MissivePreview>("preview", { messageId: id })));
        }}><option value="">Select a message to review</option>{messages.rows.map(m => <option key={m.id} value={m.id}>{m.subject} · {new Date(m.at * 1000).toLocaleString()}</option>)}</select></label>
        {!messages.rows.length && <p>No supported incoming email messages on this page.</p>}
        {messages.until && <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { resetReview(); setMessages(await request<MissivePage>("messages", { conversationId, until: messages.until })); })}>Older messages</Button>}
      </div>}
      {preview && <div>
        <h4>{preview.subject}</h4><p>{preview.from} &lt;{preview.email}&gt; · {new Date(preview.receivedAt).toLocaleString()}</p>
        <p>To: {preview.headers.to.map(a => a.address).join(", ") || "No recipient listed"}</p>
        <pre className="message-text" style={{ maxHeight: 320, overflow: "auto" }}>{preview.body || "(Message body is empty.)"}</pre>
        <p className="form-note">The original message will be preserved. {preview.attachments.length} attachments are listed by Missive. Save the message first, then select the attachments you need below.</p>
        {preview.attachments.map(a => <p key={a.id}>{a.name} · {a.bytes.toLocaleString()} bytes · Not downloaded</p>)}
        <div className="form-grid">
          <label>Title file<select aria-label="Missive title file" value={orderId} disabled={busy} onChange={e => { setOrderId(e.target.value); setReviewed(false); }}>
            <option value="">Select an open title file</option>{s.orders.filter(o => o.companyId === mapping?.companyId && !productionLocked(s, o)).map(o => <option key={o.id} value={o.id}>{o.id} · {o.address}</option>)}
          </select></label>
          <label>Request type<select aria-label="Missive request type" value={kind} disabled={busy} onChange={e => { setKind(e.target.value); setReviewed(false); }}>
            <option value="">Choose after reviewing</option>{["Commitment", "Revision", "Finals"].map(k => <option key={k}>{k}</option>)}
          </select></label>
        </div>
        <label className="form-note"><input type="checkbox" checked={reviewed} disabled={busy || !orderId || !kind} onChange={e => setReviewed(e.target.checked)} /> I reviewed this message and its company, file, and request type.</label>
        <Button disabled={busy || !reviewed || !orderId || !kind || !connection} onClick={() => void run(async () => {
          const result = await request<{ alreadyImported?: boolean; replayed?: boolean }>("import", {
            requestId: crypto.randomUUID(), expectedRevision: connection!.revision, messageId: preview.id,
            orderId, kind, fingerprint: preview.fingerprint,
          });
          resetReview();
          setNotice(result.alreadyImported || result.replayed ? "This message is already saved in the inbox. Select its source below to save attachments." : "Message and original source saved. Select the imported source below to save its attachments.");
          try {
            await connection!.refresh();
            if (events) setEvents(await request<Events>("events"));
          } catch { setError("The message is saved, but this view could not refresh. Refresh the workspace to see the saved source."); }
        })}>Import reviewed message text</Button>
      </div>}
      {mapping && <section aria-label="Imported Missive attachments">
        <h4>Attachments from imported messages</h4>
        <p className="form-note">Each file keeps its original message reference. Saved attachments appear in Documents and need review before being classified as title evidence.</p>
        {!setup?.attachmentDownloadEnabled && <p className="form-note">Attachment download needs an approved Missive storage origin in the server configuration. Saved files remain available here.</p>}
        <label>Imported message<select aria-label="Imported Missive message" value={sourceMailId} disabled={busy} onChange={e => setSourceMailId(e.target.value)}>
          <option value="">Choose a saved source</option>
          {importedSources.map(m => <option key={m.id} value={m.id}>{m.subject} · {m.orderId}</option>)}
        </select></label>
        {!importedSources.length && <p>No messages have been imported from this team yet.</p>}
        {sourceMail?.missive && <div>
          <p><strong>{sourceMail.subject}</strong> · {sourceMail.orderId} · {s.companies.find(c => c.id === sourceMail.companyId)?.name}</p>
          {sourceLocked && <p className="form-note">This title file is closed for new source attachments. Previously saved attachments remain available.</p>}
          {!sourceMail.missive.attachments.length && <p>This message has no attachments.</p>}
          {sourceMail.missive.attachments.map(attachment => {
            const doc = s.documents.find(d => d.providerSource?.provider === "Missive" && d.providerSource.sourceMailId === sourceMail.id && d.providerSource.attachmentId === attachment.id);
            return <div key={attachment.id}>
              <p><strong>{attachment.name}</strong> · {attachment.bytes.toLocaleString()} bytes · {doc ? "Saved to documents" : "Not saved"}</p>
              {doc?.assetId ? <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                download(doc.name, await downloadRemoteAsset(doc.assetId!));
                setNotice(`${doc.name} downloaded.`);
              })}>Download {attachment.name}</Button> : <Button variant="outline" disabled={busy || !connection || !setup?.attachmentDownloadEnabled || sourceLocked} onClick={() => void run(async () => {
                const result = await request<{ alreadyImported?: boolean; replayed?: boolean }>("attachments/import", {
                  requestId: crypto.randomUUID(), expectedRevision: connection!.revision,
                  messageId: sourceMail.missive!.messageId, attachmentId: attachment.id,
                }, 120000);
                await connection!.refresh();
                setNotice(result.alreadyImported || result.replayed ? `${attachment.name} is already saved.` : `${attachment.name} saved to Documents. Review its source role before using it as title evidence.`);
              })}>Save {attachment.name} to documents</Button>}
            </div>;
          })}
        </div>}
      </section>}
    </div>
  );
}
