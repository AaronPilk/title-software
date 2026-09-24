"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Inbox, Mail, Paperclip, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activeWorkspace, backendRequest } from "@/lib/backend/client";
import type { MissiveFeedConversation, MissiveFeedMessage, MissiveFeedMessageSummary, MissiveFeedPage, MissiveFeedRoute } from "@/lib/backend/missive-feed";
import { useWorkspace } from "@/lib/title/store";
import type { Company } from "@/lib/title/model";
import { Empty } from "./shared";
import { MissiveProductionIntake, type MissiveFileActions } from "./missive-production-intake";
import { MissiveRouteSetup } from "./missive-route-setup";
import styles from "./missive-live-inbox.module.css";

type Setup = { status: "ready" | "token_required" | "routing_required" | "paused"; revision: number; routes: MissiveFeedRoute[]; blockedSharedInboxes: boolean; readOnly: true };
type Identity = MissiveFileActions & { workspaceId: string; userId: string };
type RouteIdentity = Identity & { route: MissiveFeedRoute; revision: number };
class StaleEmailResponse extends Error {}

function useReader({ workspaceId, userId }: Identity) {
  const mounted = useRef(false);
  const lifetime = useRef(0);
  useEffect(() => { mounted.current = true; lifetime.current += 1; return () => { mounted.current = false; lifetime.current += 1; }; }, []);
  return useCallback(async <T,>(path: string, input?: Record<string, unknown>): Promise<T> => {
    const generation = lifetime.current;
    const current = () => mounted.current && lifetime.current === generation && activeWorkspace() === workspaceId;
    if (!current()) throw new StaleEmailResponse();
    try {
      const result = await backendRequest<T>(path, input === undefined ? undefined : { ...input, workspaceId }, input === undefined ? "GET" : "POST", 30_000, workspaceId, userId, true);
      if (!current()) throw new StaleEmailResponse();
      return result;
    } catch (error) {
      if (!current()) throw new StaleEmailResponse();
      throw error;
    }
  }, [workspaceId, userId]);
}

const errorText = (error: unknown) => error instanceof Error ? error.message : "Email could not be loaded. Refresh to try again.";
const dateLabel = (value: number | string) => new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function verifyRoute(value: { route: MissiveFeedRoute; revision: number }, routeId: string, companyId: string, revision: number) {
  if (value.revision !== revision || value.route.id !== routeId || value.route.companyId !== companyId)
    throw new Error("Your inbox access changed. Refresh the inbox list.");
}
function appendRows<T extends { id: string }>(previous: T[], next: T[]) {
  return [...new Map([...previous, ...next].map(row => [row.id, row])).values()];
}

export function MissiveLiveInbox({ onSettings, onOpenFile, onCreateFile }: MissiveFileActions & { onSettings?: () => void }) {
  const { s, connection } = useWorkspace();
  const access = connection?.access;
  if (!connection || !access) return <section className={styles.surface}><Empty title="Connect a shared workspace" text="Live email is available in a connected workspace with an approved Missive inbox." /></section>;
  if (!["owner", "admin", "operations"].includes(access.role)) return <section className={styles.surface}><Empty title="Production access needed" text="Your workspace administrator can review your access to incoming email." /></section>;
  const assigned = access.allCompanies ? null : new Set(access.companyIds);
  const companies = s.companies.filter(company => !assigned || assigned.has(company.id));
  // Remount the entire private reader on account, role, scope or company changes.
  // No email from the previous identity survives even for the next effect frame.
  const identity = JSON.stringify([connection.workspaceId, access.userId, access.role, access.version, access.allCompanies, access.restricted, [...access.companyIds].sort(), companies.map(company => company.id).sort()]);
  const canConfigure = access.role === "owner" || (access.role === "admin" && access.allCompanies);
  return <ConnectedInbox onOpenFile={onOpenFile} onCreateFile={onCreateFile} key={identity} workspaceId={connection.workspaceId} userId={access.userId} companies={companies} canConfigure={canConfigure} onSettings={canConfigure ? onSettings : undefined} />;
}

function ConnectedInbox({ companies, canConfigure, onSettings, ...identity }: Identity & { companies: Company[]; canConfigure: boolean; onSettings?: () => void }) {
  const read = useReader(identity);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [companyId, setCompanyId] = useState("");
  const [routeId, setRouteId] = useState("");
  useEffect(() => {
    let current = true;
    void read<Setup>("/missive-feed").then(result => {
      if (!current) return;
      setSetup(result); setLoadedVersion(value => value + 1);
    }).catch(reason => {
      if (!current || reason instanceof StaleEmailResponse) return;
      setSetup(null); setError(errorText(reason));
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [read, reload]);
  const reloadSetup = () => { setLoading(true); setError(""); setReload(value => value + 1); };
  const availableIds = new Set(companies.map(company => company.id));
  const routes = setup?.routes.filter(route => availableIds.has(route.companyId)) || [];
  const routedCompanies = companies.filter(company => routes.some(route => route.companyId === company.id));
  const selectedCompany = routedCompanies.find(company => company.id === companyId) || routedCompanies[0];
  const companyRoutes = routes.filter(route => route.companyId === selectedCompany?.id);
  const route = companyRoutes.find(candidate => candidate.id === routeId) || companyRoutes[0];
  const ready = setup?.status === "ready" && route;
  const configuration = setup?.status === "token_required"
    ? { title: "Connect Missive to see incoming email", text: "A workspace administrator can connect Missive and approve the inboxes for each company." }
    : setup?.status === "paused"
      ? { title: "Live email is paused", text: "A workspace administrator can review the Missive connection and resume inbox access." }
      : { title: "No approved inboxes available", text: canConfigure ? "Review the Missive inbox routing for your companies to make incoming email available here." : "A workspace administrator must approve an inbox containing only production email. You can continue working with reviewed requests in Saved requests." };
  return <div className={styles.root}>
    <div className={styles.heading}>
      <div><h2><Mail size={21} aria-hidden="true" />Live email</h2><p>Incoming email from your company inboxes. Messages stay in Missive.</p></div>
      <Button variant="outline" disabled={loading} onClick={reloadSetup}><RefreshCw size={15} aria-hidden="true" />{loading ? "Refreshing…" : "Refresh inbox list"}</Button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!setup && loading && <p role="status" className={styles.note}>Loading company inboxes…</p>}
    {setup && !ready && <section className={styles.surface}><Empty title={configuration.title} text={configuration.text} action={onSettings ? <Button variant="outline" onClick={onSettings}>Open connection settings</Button> : undefined} /></section>}
    {setup?.status === "routing_required" && canConfigure && <MissiveRouteSetup onConnected={reloadSetup} />}
    {setup?.blockedSharedInboxes && <p className={styles.note}>Some shared inboxes need a company routing review before they can appear here.</p>}
    {ready && <>
      <div className={styles.selectors}>
        <label>Company<select aria-label="Live email company" value={selectedCompany.id} onChange={event => { setCompanyId(event.target.value); setRouteId(""); }}>
          {routedCompanies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select></label>
        <label>Inbox<select aria-label="Live email inbox" value={route.id} onChange={event => setRouteId(event.target.value)}>
          {companyRoutes.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.teamName}</option>)}
        </select></label>
      </div>
      <InboxQueue key={`${setup.revision}:${route.id}`} {...identity} route={route} revision={setup.revision} refreshVersion={loadedVersion} />
    </>}
  </div>;
}

function InboxQueue({ refreshVersion, ...identity }: RouteIdentity & { refreshVersion: number }) {
  const read = useReader(identity);
  const [page, setPage] = useState<MissiveFeedPage<MissiveFeedConversation> | null>(null);
  const pageRef = useRef(page);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState("");
  const busy = useRef(false), stopped = useRef(false), loadedOlder = useRef(false);
  const sequence = useRef(0);
  const pauseOnReadError = useCallback((message: string) => {
    sequence.current += 1; busy.current = false; stopped.current = true; loadedOlder.current = false;
    pageRef.current = null; setPage(null); setError(message); setLoading(false);
  }, []);
  const { route, revision } = identity;
  const routeId = route.id, companyId = route.companyId;
  const load = useCallback(async (older = false) => {
    if (busy.current || (older && pageRef.current?.until == null)) return;
    busy.current = true;
    const request = ++sequence.current;
    try {
      const next = await read<MissiveFeedPage<MissiveFeedConversation>>("/missive-feed/conversations", { routeId, revision, ...(older ? { until: pageRef.current!.until } : {}) });
      if (sequence.current !== request) return;
      verifyRoute(next, routeId, companyId, revision);
      const previous = pageRef.current;
      if (older && previous) {
        next.rows = appendRows(previous.rows, next.rows); loadedOlder.current = true;
      } else if (loadedOlder.current && previous && next.rows.length && next.until !== null) {
        const oldest = Math.min(...next.rows.map(row => row.at));
        const refreshedIds = new Set(next.rows.map(row => row.id));
        const retained = previous.rows.filter(row => row.at < oldest && !refreshedIds.has(row.id));
        next.rows = appendRows(next.rows, retained).sort((a, b) => b.at - a.at);
        if (retained.length) next.until = previous.until;
        else loadedOlder.current = false;
      } else loadedOlder.current = false;
      pageRef.current = next; setPage(next); setCheckedAt(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
      stopped.current = false; setError("");
    } catch (reason) {
      if (reason instanceof StaleEmailResponse || sequence.current !== request) return;
      pageRef.current = null; setPage(null); setError(errorText(reason)); stopped.current = true; loadedOlder.current = false;
    } finally { if (sequence.current === request) { busy.current = false; setLoading(false); } }
  }, [read, routeId, companyId, revision]);
  useEffect(() => { void load(); return () => { sequence.current += 1; busy.current = false; }; }, [load, refreshVersion]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !stopped.current && !busy.current) { setLoading(true); void load(); }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const reloadEmail = (older = false) => { setLoading(true); setError(""); void load(older); };
  const selected = page?.rows.find(row => row.id === selectedId) || page?.rows[0];
  return <>
    <div className={styles.queueMeta}><span>{checkedAt ? `Updated ${checkedAt}` : "Checking inbox…"} · Refreshes every minute while visible</span><Button variant="ghost" disabled={loading} onClick={() => reloadEmail()}><RefreshCw size={14} aria-hidden="true" />Refresh email</Button></div>
    {error && <p role="alert" className={styles.error}>{error} Automatic refresh is paused. Refresh email or the inbox list to try again.</p>}
    <div className={styles.layout}>
      <aside className={`${styles.surface} ${styles.conversations}`} aria-label="Email conversations">
        <div className={styles.sectionHeading}><h3><Inbox size={16} aria-hidden="true" />{route.teamName}</h3><span>{page?.rows.length || 0}</span></div>
        {page?.rows.map(row => <button type="button" className={styles.conversation} key={row.id} aria-pressed={selected?.id === row.id} onClick={() => setSelectedId(row.id)}><span><strong>{row.subject}</strong><small>{dateLabel(row.at)}</small></span><ChevronRight size={15} aria-hidden="true" /></button>)}
        {loading && !page && <p role="status" className={styles.note}>Loading conversations…</p>}
        {page && page.rows.length === 0 && <Empty title="No conversations on this page" text="Incoming conversations in this approved inbox will appear here." />}
        {!!page?.skipped && <p className={styles.note}>Some unavailable conversations were omitted.</p>}
        {page?.until != null && <Button className={styles.older} variant="ghost" disabled={loading} onClick={() => reloadEmail(true)}>{loading ? "Loading…" : "Load older conversations"}</Button>}
      </aside>
      {selected ? <ConversationReader key={`${selected.id}:${selected.at}`} {...identity} conversation={selected} onReadError={pauseOnReadError} /> : <section className={styles.surface}><Empty title="Choose a conversation" text="Select a conversation to see the incoming messages it contains." /></section>}
    </div>
  </>;
}

function ConversationReader({ conversation, onReadError, ...identity }: RouteIdentity & { conversation: MissiveFeedConversation; onReadError: (message: string) => void }) {
  const read = useReader(identity);
  const [page, setPage] = useState<MissiveFeedPage<MissiveFeedMessageSummary> | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const sequence = useRef(0);
  const routeId = identity.route.id, companyId = identity.route.companyId, revision = identity.revision;
  const load = useCallback(async (until?: number) => {
    if (busy.current) return;
    busy.current = true;
    const request = ++sequence.current;
    try {
      const result = await read<MissiveFeedPage<MissiveFeedMessageSummary> & { conversation: MissiveFeedConversation }>("/missive-feed/messages", { routeId, revision, conversationId: conversation.id, ...(until === undefined ? {} : { until }) });
      if (sequence.current !== request) return;
      verifyRoute(result, routeId, companyId, revision);
      if (result.conversation.id !== conversation.id) throw new Error("This conversation changed. Refresh the inbox.");
      setPage(previous => until === undefined || !previous ? result : { ...result, rows: appendRows(previous.rows, result.rows) });
      setError("");
    } catch (reason) {
      if (reason instanceof StaleEmailResponse || sequence.current !== request) return;
      setPage(null); setSelectedId(""); setError(errorText(reason));
      onReadError(errorText(reason));
    } finally { if (sequence.current === request) { busy.current = false; setLoading(false); } }
  }, [read, routeId, companyId, revision, conversation.id, onReadError]);
  // load sets state only after the external email request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return () => { sequence.current += 1; busy.current = false; }; }, [load]);
  const reloadMessages = (until?: number) => { setLoading(true); setError(""); void load(until); };
  return <section className={`${styles.surface} ${styles.reader}`} aria-label="Incoming email">
    <div className={styles.readerHeading}><h3>{conversation.subject}</h3><p>Choose a message to read its full text.</p></div>
    {error && <div className={styles.error}><p role="alert">{error}</p><Button variant="outline" onClick={() => reloadMessages()}>Retry messages</Button></div>}
    {loading && !page && <p role="status" className={styles.note}>Loading incoming messages…</p>}
    {page?.rows.map(message => <button type="button" key={message.id} className={styles.message} aria-pressed={selectedId === message.id} onClick={() => setSelectedId(message.id)}>
      <span className={styles.senderIcon}><Mail size={17} aria-hidden="true" /></span><span className={styles.messageCopy}><strong>{message.from}</strong><span>{message.subject}</span><small>{message.preview || message.email}</small></span><span className={styles.messageMeta}><time>{dateLabel(message.receivedAt)}</time>{message.attachments.length > 0 && <span><Paperclip size={12} aria-hidden="true" />{message.attachments.length}</span>}</span>
    </button>)}
    {page && page.rows.length === 0 && <Empty title="No incoming email on this page" text="This page contains no supported received messages. Older messages may still be available." />}
    {!!page?.skipped && <p className={styles.note}>Only received email is shown.</p>}
    {page?.until != null && <Button variant="ghost" className={styles.older} disabled={loading} onClick={() => reloadMessages(page.until!)}>{loading ? "Loading…" : "Load older messages"}</Button>}
    {selectedId && page?.rows.some(message => message.id === selectedId) && <MessageBody key={selectedId} {...identity} conversationId={conversation.id} messageId={selectedId} onReadError={onReadError} />}
  </section>;
}

function MessageBody({ conversationId, messageId, onReadError, ...identity }: RouteIdentity & { conversationId: string; messageId: string; onReadError: (message: string) => void }) {
  const read = useReader(identity);
  const [message, setMessage] = useState<MissiveFeedMessage | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const routeId = identity.route.id, companyId = identity.route.companyId, revision = identity.revision;
  useEffect(() => {
    let current = true;
    void read<{ revision: number; route: MissiveFeedRoute; conversation: MissiveFeedConversation; message: MissiveFeedMessage }>("/missive-feed/message", { routeId, revision, conversationId, messageId }).then(result => {
      if (!current) return;
      verifyRoute(result, routeId, companyId, revision);
      if (result.message.id !== messageId || result.conversation.id !== conversationId) throw new Error("This email changed. Reopen the conversation.");
      setMessage(result.message);
    }).catch(reason => { if (current && !(reason instanceof StaleEmailResponse)) { setError(errorText(reason)); onReadError(errorText(reason)); } });
    return () => { current = false; };
  }, [read, routeId, companyId, revision, conversationId, messageId, retry, onReadError]);
  return <article className={styles.body} aria-label="Email message text">
    {error ? <><p role="alert" className={styles.error}>{error}</p><Button variant="outline" onClick={() => { setMessage(null); setError(""); setRetry(value => value + 1); }}>Retry email</Button></> : !message ? <p role="status">Loading email text…</p> : <>
      <h4>{message.subject}</h4><p className={styles.address}>{message.from} &lt;{message.email}&gt;</p><p className={styles.address}>{dateLabel(message.receivedAt)}</p>
      <p className={styles.address}>To: {message.to.map(address => address.name ? `${address.name} <${address.address}>` : address.address).join(", ") || "No recipients listed"}</p>
      {message.cc.length > 0 && <p className={styles.address}>Cc: {message.cc.map(address => address.address).join(", ")}</p>}
      <pre>{message.body || "(Message body is empty.)"}</pre>
      <MissiveProductionIntake {...identity} routeId={routeId} companyId={companyId} conversationId={conversationId} messageId={messageId} />
      {message.attachments.length > 0 && <div className={styles.attachments}><h5><Paperclip size={14} aria-hidden="true" />Attachments</h5><ul>{message.attachments.map(attachment => <li key={attachment.id}>{attachment.name}</li>)}</ul><p>Attachment names only. Files remain in Missive.</p></div>}
    </>}
  </article>;
}
