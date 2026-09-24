"use client";
import { useEffect, useRef, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import styles from "./missive-settings.module.css";
import { Button } from "../ui/button";
import { backendRequest, downloadRemoteAsset } from "@/lib/backend/client";
import { download, useWorkspace } from "@/lib/title/store";
import { productionLocked } from "@/lib/title/production";
import type { MissiveCheck, MissiveSetup } from "@/lib/backend/missive";
import type { MissivePage, MissivePreview } from "@/lib/backend/missive-import";
import { MissiveCredentialSettings } from "./missive-credential-settings";

import type { MissiveRoute, MissiveRouting } from "@/lib/backend/missive-routing";

type Setup = MissiveSetup & { routing: MissiveRouting; attachmentDownloadEnabled?: boolean };
type MissiveEvent = { id: string; messageId: string; conversationId: string; subject: string; receivedAt: string; status: "queued" | "completed"; mappingVersion: number; companyId: string | null; organizationId: string; teamId: string; candidateRouteIds: string[]; originallyShared: boolean };
type Events = { events: MissiveEvent[]; webhookConfigured: boolean; nextOffset: number | null };
type ProductionAccessReview = { routeId: string; revision: number; companyName: string; teamName: string; productionOnly: boolean };
class StaleMissiveResponse extends Error {}
export function MissiveSettings({ workspaceId }: { workspaceId: string }) {
  const { s, connection } = useWorkspace();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [check, setCheck] = useState<MissiveCheck | null>(null);
  const [working, setWorking] = useState(false), [credentialBusy, setCredentialBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const generation = useRef(0), mounted = useRef(false), workflow = useRef(false), credentialOperation = useRef(false);
  const busy = working || credentialBusy;
  const [teamId, setTeamId] = useState(""), [companyId, setCompanyId] = useState("");
  const [conversations, setConversations] = useState<MissivePage | null>(null);
  const [messages, setMessages] = useState<MissivePage | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [preview, setPreview] = useState<MissivePreview | null>(null);
  const [orderId, setOrderId] = useState(""), [kind, setKind] = useState("");
  const [reviewedRevision, setReviewedRevision] = useState<number | null>(null);
  const [sourceMailId, setSourceMailId] = useState("");
  const [events, setEvents] = useState<Events | null>(null);
  const [mappingId, setMappingId] = useState("");
  const [productionReview, setProductionReview] = useState<ProductionAccessReview | null>(null);
  const [productionAcknowledged, setProductionAcknowledged] = useState(false);
  const access = connection?.access;
  const canManageProduction = access?.role === "owner" || (access?.role === "admin" && access.allCompanies);
  const companyName = (route: MissiveRoute) => s.companies.find(c => c.id === route.companyId)?.name || route.companyId;
  const sharedInbox = (route: MissiveRoute) => !!setup?.routing.mappings.some(other => other.id !== route.id &&
    other.organizationId === route.organizationId && other.teamId === route.teamId && other.companyId !== route.companyId);
  const productionRoute = setup?.routing.mappings.find(route => route.id === productionReview?.routeId);
  const productionReviewCurrent = !!productionReview && !!productionRoute && canManageProduction &&
    productionReview.revision === setup?.routing.revision && productionReview.companyName === companyName(productionRoute) &&
    productionReview.teamName === productionRoute.teamName && (productionReview.productionOnly
      ? productionRoute.enabled && !sharedInbox(productionRoute) && productionRoute.productionOnly !== true
      : productionRoute.productionOnly === true);
  const activeRoutes = setup?.routing.mappings.filter(m => m.enabled) || [];
  const selectedId = mappingId || (activeRoutes.length === 1 ? activeRoutes[0].id : "");
  const mapping = activeRoutes.find(m => m.id === selectedId);
  const importedSources = s.inbox.filter(m => mapping && m.missive && m.companyId === mapping.companyId &&
    m.missive.organizationId === mapping.organizationId && m.missive.teamId === mapping.teamId);
  const sourceMail = importedSources.find(m => m.id === sourceMailId);
  const sourceOrder = s.orders.find(o => o.id === sourceMail?.orderId);
  const sourceLocked = !sourceOrder || productionLocked(s, sourceOrder);
  const destination = s.orders.find(o => o.id === orderId && o.companyId === mapping?.companyId && !productionLocked(s, o));
  const reviewed = reviewedRevision !== null && reviewedRevision === connection?.revision && !!destination && !!preview && !!kind;
  useEffect(() => {
    mounted.current = true;
    const current = ++generation.current;
    backendRequest<Setup>("/integrations/missive")
      .then(value => { if (mounted.current && current === generation.current) setSetup(value); })
      .catch(reason => { if (mounted.current && current === generation.current) setError(reason instanceof Error ? reason.message : "Unable to load Missive settings."); });
    return () => { mounted.current = false; };
  }, [workspaceId]);
  async function guarded<T,>(pending: Promise<T>): Promise<T> {
    const current = generation.current;
    try {
      const value = await pending;
      if (!mounted.current || current !== generation.current) throw new StaleMissiveResponse();
      return value;
    } catch (reason) {
      if (!mounted.current || current !== generation.current) throw new StaleMissiveResponse();
      throw reason;
    }
  }
  async function run(fn: (current: () => boolean) => Promise<void>) {
    if (workflow.current || credentialOperation.current) return;
    const current = ++generation.current;
    const stillCurrent = () => mounted.current && current === generation.current;
    workflow.current = true;
    setWorking(true); setError(""); setNotice("");
    try { await fn(stillCurrent); }
    catch (reason) { if (stillCurrent() && !(reason instanceof StaleMissiveResponse)) setError(reason instanceof Error ? reason.message : "Missive request failed."); }
    finally { if (stillCurrent()) { workflow.current = false; setWorking(false); } }
  }
  function resetReview() { setPreview(null); setOrderId(""); setKind(""); setReviewedRevision(null); }
  function clearReads() {
    setCheck(null); resetReview(); setConversations(null); setMessages(null); setEvents(null);
    setSourceMailId(""); setConversationId(""); setNotice("");
    setProductionReview(null); setProductionAcknowledged(false);
  }
  function credentialBusyChanged(next: boolean) {
    credentialOperation.current = next;
    if (next) {
      generation.current++; workflow.current = false; setWorking(false);
      clearReads(); setError("");
    }
    setCredentialBusy(next);
  }
  async function connectionChanged() {
    const current = generation.current;
    clearReads(); setSetup(null); setMappingId(""); setTeamId(""); setCompanyId("");
    try { setSetup(await guarded(backendRequest<Setup>("/integrations/missive"))); }
    catch (reason) { if (mounted.current && current === generation.current && !(reason instanceof StaleMissiveResponse)) setError(reason instanceof Error ? reason.message : "Unable to refresh Missive settings."); }
  }
  const request = <T,>(path: string, input: Record<string, unknown> = {}, timeoutMs = 30000) => guarded(backendRequest<T>(`/integrations/missive/${path}`, {
    workspaceId, expectedRoutingRevision: setup?.routing.revision || 0, mappingId: mapping?.id, ...input,
  }, "POST", timeoutMs));
  async function loadConversations(until?: number) {
    resetReview(); setMessages(null); setConversationId("");
    setConversations(await request<MissivePage>("conversations", { until }));
  }
  function reviewProductionAccess(route: MissiveRoute) {
    if (!canManageProduction || !setup || busy) return;
    setProductionAcknowledged(false); setError(""); setNotice("");
    setProductionReview({ routeId: route.id, revision: setup.routing.revision, companyName: companyName(route), teamName: route.teamName, productionOnly: route.productionOnly !== true });
  }
  async function saveProductionAccess() {
    if (!productionReviewCurrent || !productionReview || !access || (productionReview.productionOnly && !productionAcknowledged)) return;
    const reviewed = productionReview;
    await run(async current => {
      try {
        const result = await guarded(backendRequest<{ routing: MissiveRouting }>("/integrations/missive/production-access", {
          workspaceId, expectedRoutingRevision: reviewed.revision, mappingId: reviewed.routeId,
          productionOnly: reviewed.productionOnly, acknowledged: true,
        }, "POST", 30000, workspaceId, access.userId, true));
        setSetup(previous => previous ? { ...previous, routing: result.routing } : previous);
        clearReads();
        setNotice(reviewed.productionOnly ? "Production inbox access approved. Assigned Production staff can read this inbox." : "Production inbox access removed. Assigned Production staff can no longer read this inbox.");
      } catch (reason) {
        if (!current() || reason instanceof StaleMissiveResponse) return;
        // A timeout may follow a committed change. Load current routing and require
        // a new review instead of retrying the same access grant automatically.
        setProductionReview(null); setProductionAcknowledged(false); setSetup(null);
        try { setSetup(await guarded(backendRequest<Setup>("/integrations/missive", undefined, "GET", 30000, workspaceId, access.userId, true))); }
        catch { if (current()) setError("Production inbox access could not be confirmed. Refresh connection settings before reviewing it again."); return; }
        if (current()) setError(reason instanceof Error ? `${reason.message} Current routes are loaded; review access again before saving.` : "Production inbox access could not be saved. Current routes are loaded; review access again.");
      }
    });
  }
  return (
    <div className={`backend-settings-section ${styles.root}`}>
      <h3><Mail size={18} /> Missive</h3>
      <MissiveCredentialSettings key={workspaceId} workspaceId={workspaceId} onChanged={connectionChanged} onBusyChange={credentialBusyChanged} />
      <p>Review incoming emails, save the original message, then import selected attachments into the same title file.</p>
      {setup?.status === "workspace_required" && <p className="form-note">Connect this workspace to its Missive account above.</p>}
      {setup?.status === "token_required" && <p className="form-note">Connect a working Missive API token above to review your inboxes.</p>}
      <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        setCheck(null); resetReview(); setConversations(null); setMessages(null); setEvents(null); setProductionReview(null); setProductionAcknowledged(false);
        const current = await guarded(backendRequest<Setup>("/integrations/missive")); setSetup(current);
        if (current.status === "ready") setCheck(await request<MissiveCheck>("check"));
      })}><RefreshCw size={16} /> {busy ? "Working…" : "Check Missive connection"}</Button>
      {error && <p role="alert" className="form-note">{error}</p>}
      {notice && <p role="status" className="form-note">{notice}</p>}
      {check && <div>
        <p><strong>Connection verified.</strong> Add each company that receives work from an inbox. A shared inbox can serve several companies; you will choose the destination for each message.</p>
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
          const result = await request<{ routing: MissiveRouting }>("mapping", { teamId, companyId, enabled: true });
          setSetup(current => current ? { ...current, routing: result.routing } : current);
          setMappingId(result.routing.mappings.find(m => m.teamId === teamId && m.companyId === companyId)?.id || "");
          resetReview(); setConversations(null); setMessages(null); setSourceMailId(""); setEvents(null); setNotice("Inbox routing saved. Other company routes remain available.");
        })}>Save reviewed inbox routing</Button>
      </div>}
      {!!setup?.routing.mappings.length && <section aria-label="Company inbox routing" className={styles.routing}>
        <h4>Company inbox routes</h4>
        <p className="form-note">One company or many joint ventures use the same review process. An inbox may be shared, but each saved message belongs to one reviewed company and title file.</p>
        <label>Inbox and company<select aria-label="Active Missive company route" value={selectedId} disabled={busy} onChange={e => {
          setMappingId(e.target.value); resetReview(); setMessages(null); setConversations(null); setSourceMailId("");
        }}><option value="">Choose the company receiving this work</option>{activeRoutes.map(m => <option key={m.id} value={m.id}>{s.companies.find(c => c.id === m.companyId)?.name || m.companyId} · {m.teamName}</option>)}</select></label>
        <details className={styles.manage}><summary>Manage {setup.routing.mappings.length} company inbox {setup.routing.mappings.length === 1 ? "route" : "routes"}</summary><div className={styles.routeList}>
        {setup.routing.mappings.map(route => <div key={route.id} className={styles.routeRow}>
          <div><strong>{companyName(route)}</strong><span>{route.teamName} · {route.enabled ? "Active" : "Paused"}</span>
            <span>{route.productionOnly ? "Production staff access approved" : "General company inbox · Production staff access off"}</span>
            {canManageProduction && <Button variant="ghost" aria-label={`${route.productionOnly ? "Remove" : "Review"} Production access for ${companyName(route)} · ${route.teamName}`}
              disabled={busy || (!route.productionOnly && (!route.enabled || sharedInbox(route)))} onClick={() => reviewProductionAccess(route)}>
              {route.productionOnly ? "Remove Production access" : "Review Production access"}
            </Button>}
            {canManageProduction && !route.productionOnly && sharedInbox(route) && <span>Shared inboxes cannot be approved for Production staff, including when another company route is paused.</span>}
          </div>
          <Button variant="ghost" aria-label={`${route.enabled ? "Pause" : "Enable"} ${companyName(route)} · ${route.teamName}`} disabled={busy} onClick={() => void run(async () => {
            const result = await request<{ routing: MissiveRouting }>("mapping", { mappingId: route.id, teamId: route.teamId, companyId: route.companyId, enabled: !route.enabled });
            setSetup(current => current ? { ...current, routing: result.routing } : current);
            setMappingId(""); resetReview(); setConversations(null); setMessages(null); setSourceMailId(""); setEvents(null);
            setNotice(route.enabled ? "Route paused. Existing message routing is preserved." : "Route enabled. Review the company before importing.");
          })}>{route.enabled ? "Pause" : "Enable"}</Button>
        </div>)}
        </div></details>
        {productionReview && canManageProduction && <section aria-label="Production inbox access review">
          <h4>{productionReview.productionOnly ? "Approve Production inbox access" : "Remove Production inbox access"}</h4>
          <p><strong>{productionReview.companyName}</strong> · {productionReview.teamName}</p>
          {productionReview.productionOnly ? <>
            <p>Assigned Production staff will be able to read every incoming email in this entire inbox, including message bodies and attachment names. Approve only an inbox dedicated to title production. Agency applications, ownership details, financial records and other private company mail must use a separate inbox.</p>
            <label className="form-note"><input type="checkbox" checked={productionAcknowledged && productionReviewCurrent} disabled={busy || !productionReviewCurrent}
              onChange={event => setProductionAcknowledged(event.target.checked)} /> I confirm this entire inbox contains only production mail and assigned Production staff may read it.</label>
          </> : <p>Assigned Production staff will lose access to this inbox. Organization administrators keep their existing access.</p>}
          {!productionReviewCurrent && <p role="status" className="form-note">The reviewed route changed. Cancel this review and check the current inbox routes.</p>}
          <div className="button-row"><Button disabled={busy || !productionReviewCurrent || (productionReview.productionOnly && !productionAcknowledged)} onClick={() => void saveProductionAccess()}>
            {productionReview.productionOnly ? "Approve Production access" : "Confirm removal"}
          </Button><Button variant="ghost" disabled={busy} onClick={() => { setProductionReview(null); setProductionAcknowledged(false); }}>Cancel access review</Button></div>
        </section>}
        <Button variant="ghost" disabled={busy} onClick={() => void run(async () => setEvents(await request<Events>("events")))}>Refresh incoming events</Button>
      </section>}
      {mapping && <div>
        <p><strong>{mapping.teamName}</strong> → {s.companies.find(c => c.id === mapping.companyId)?.name || "Company unavailable"}</p>
        <p className="form-note">This shows the team’s current inbox queue. Assigned and archived conversations may no longer appear. Review each message before importing.</p>
        <Button variant="outline" disabled={busy || setup?.status !== "ready"} onClick={() => void run(() => loadConversations())}>Browse inbox queue</Button>
      </div>}
      {events && <section aria-label="Incoming Missive events">
        <h4>Incoming events</h4>
        <p className="form-note">New source events await your review before anything enters a title file. Pending events are shown oldest first.</p>
        {!events.webhookConfigured && <p className="form-note">Incoming event delivery is not configured yet. You can still browse the inbox queue.</p>}
        {!events.events.some(e => e.status === "queued") && <p>No incoming events awaiting review.</p>}
        {events.events.filter(e => e.status === "queued").map(event => <div key={event.id}>
          <p><strong>{event.subject || "Incoming email"}</strong> · {new Date(event.receivedAt).toLocaleString()}</p>
          {event.companyId && <p className="form-note">Company recorded when received: {s.companies.find(c => c.id === event.companyId)?.name || event.companyId}.</p>}
          {event.originallyShared && <p className="form-note">Shared inbox: choose the destination company above before reviewing. No company has been assigned automatically.</p>}
          {!event.candidateRouteIds.length && <p className="form-note">This event has no active route for inbox {event.teamId}. Enable or add its company route above to review it. Its original source stays in this queue.</p>}
          {!!event.candidateRouteIds.length && <p className="form-note">Available companies: {activeRoutes.filter(m => event.candidateRouteIds.includes(m.id)).map(m => s.companies.find(c => c.id === m.companyId)?.name || m.companyId).join(", ")}</p>}
          <Button variant="outline" disabled={busy || !mapping || !event.candidateRouteIds.includes(mapping.id)} onClick={() => void run(async () => {
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
        <p><strong>Destination company: {s.companies.find(c => c.id === mapping?.companyId)?.name}</strong></p>
        <h4>{preview.subject}</h4><p>{preview.from} &lt;{preview.email}&gt; · {new Date(preview.receivedAt).toLocaleString()}</p>
        <p>To: {preview.headers.to.map(a => a.address).join(", ") || "No recipient listed"}</p>
        <pre className="message-text" style={{ maxHeight: 320, overflow: "auto" }}>{preview.body || "(Message body is empty.)"}</pre>
        <p className="form-note">The original message will be preserved. {preview.attachments.length} attachments are listed by Missive. Save the message first, then select the attachments you need below.</p>
        {preview.attachments.map(a => <p key={a.id}>{a.name} · {a.bytes.toLocaleString()} bytes · Not downloaded</p>)}
        <div className="form-grid">
          <label>Title file<select aria-label="Missive title file" value={destination ? orderId : ""} disabled={busy} onChange={e => { setOrderId(e.target.value); setReviewedRevision(null); }}>
            <option value="">Select an open title file</option>{s.orders.filter(o => o.companyId === mapping?.companyId && !productionLocked(s, o)).map(o => <option key={o.id} value={o.id}>{o.id} · {o.address}</option>)}
          </select></label>
          <label>Request type<select aria-label="Missive request type" value={kind} disabled={busy} onChange={e => { setKind(e.target.value); setReviewedRevision(null); }}>
            <option value="">Choose after reviewing</option>{["Commitment", "Revision", "Finals"].map(k => <option key={k}>{k}</option>)}
          </select></label>
        </div>
        {reviewedRevision !== null && !reviewed && <p role="status" className="form-note">Workspace records changed after your review. Review the current file and confirm again.</p>}
        {orderId && !destination && <p className="form-note">The selected file is no longer open in this company. Choose an available title file.</p>}
        <label className="form-note"><input type="checkbox" checked={reviewed} disabled={busy || !destination || !kind || !connection} onChange={e => setReviewedRevision(e.target.checked ? connection!.revision : null)} /> I reviewed this message and its company, file, and request type.</label>
        <Button disabled={busy || !reviewed || !destination || !connection || setup?.status !== "ready"} onClick={() => void run(async current => {
          if (!reviewed || !destination || !connection || reviewedRevision === null) return;
          const result = await request<{ alreadyImported?: boolean; replayed?: boolean }>("import", {
            requestId: crypto.randomUUID(), expectedRevision: reviewedRevision, messageId: preview.id,
            orderId, kind, fingerprint: preview.fingerprint,
          });
          resetReview();
          setNotice(result.alreadyImported || result.replayed ? "This message is already saved in the inbox. Select its source below to save attachments." : "Message and original source saved. Select the imported source below to save its attachments.");
          try {
            const refreshed = await connection.refresh();
            if (!current()) return;
            if (refreshed === false) { setError("The message is saved, but this view could not refresh. Refresh the workspace to see the saved source."); return; }
            if (events) setEvents(await request<Events>("events"));
          } catch { if (current()) setError("The message is saved, but this view could not refresh. Refresh the workspace to see the saved source."); }
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
                download(doc.name, await guarded(downloadRemoteAsset(doc.assetId!)));
                setNotice(`${doc.name} downloaded.`);
              })}>Download {attachment.name}</Button> : <Button variant="outline" disabled={busy || !connection || !setup?.attachmentDownloadEnabled || sourceLocked} onClick={() => void run(async current => {
                const result = await request<{ alreadyImported?: boolean; replayed?: boolean }>("attachments/import", {
                  requestId: crypto.randomUUID(), expectedRevision: connection!.revision,
                  messageId: sourceMail.missive!.messageId, attachmentId: attachment.id,
                }, 120000);
                setNotice(result.alreadyImported || result.replayed ? `${attachment.name} is already saved.` : `${attachment.name} saved to Documents. Review its source role before using it as title evidence.`);
                const refreshed = await connection!.refresh();
                if (current() && refreshed === false) setError("The attachment is saved, but this view could not refresh. Refresh the workspace to see the saved document.");
              })}>Save {attachment.name} to documents</Button>}
            </div>;
          })}
        </div>}
      </section>}
    </div>
  );
}
