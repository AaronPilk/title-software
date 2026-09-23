"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, Tabs } from "radix-ui";
import { CheckCircle2, MessageSquare, RefreshCw, Send, X } from "lucide-react";
import type { Access } from "@/lib/backend/workspace";
import type { Page } from "@/lib/title/model";
import type { FeedbackCursor, FeedbackItem, FeedbackKind, FeedbackStatus, FeedbackView } from "@/lib/backend/feedback";
import { listFeedback, submitFeedback, updateFeedback } from "@/lib/backend/feedback-client";
import styles from "./developer-feedback.module.css";

type Props = { workspaceId: string; access: Access; page: Page; view: FeedbackView };
type Draft = { id: string; kind: FeedbackKind; message: string; page: Page; view: FeedbackView };
const kinds: Record<FeedbackKind, string> = { problem: "Problem", idea: "Idea", question: "Question" };
const statuses: Record<FeedbackStatus, string> = { new: "Received", in_progress: "In progress", done: "Done" };
const views: Record<FeedbackView, string> = { agency: "Agency", production: "Production", partner: "Partner" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
const freshDraft = (page: Page, view: FeedbackView): Draft => ({ id: crypto.randomUUID(), kind: "problem", message: "", page, view });

/** A new identity destroys both drafts and pending request callbacks. */
export function DeveloperFeedback(props: Props) {
  return <FeedbackWidget key={`${props.workspaceId}:${props.access.userId}:${props.access.email}:${props.access.role}:${props.access.version}`} {...props} />;
}

function FeedbackWidget({ workspaceId, access, page, view }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("send");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<FeedbackItem | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const owner = access.role === "owner";
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function changeOpen(next: boolean) {
    if (next && !draft?.message.trim() && !busy.current && !receipt) setDraft(freshDraft(page, view));
    setOpen(next);
  }
  function changeDraft(change: Partial<Pick<Draft, "kind" | "message">>) {
    if (busy.current) return;
    setDraft(current => current ? { ...current, ...change, id: crypto.randomUUID() } : current);
    setError("");
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.message.trim() || draft.message.length > 4000 || busy.current) return;
    busy.current = true; setSending(true); setError("");
    try {
      const item = await submitFeedback({ workspaceId, ...draft }, access.userId);
      if (!alive.current) return;
      setReceipt(item); setDraft(null);
    } catch (cause) {
      if (alive.current) setError(errorMessage(cause));
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  }

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild>
      <button className={styles.launcher} type="button"><MessageSquare size={17} aria-hidden="true" />Feedback</button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.dialog}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Built together</span>
          <Dialog.Title className={styles.title}>Developer feedback</Dialog.Title>
          <Dialog.Description className={styles.description}>Tell us what feels confusing, what is missing, or what could work better.</Dialog.Description>
          <Dialog.Close asChild><button type="button" className={styles.close} aria-label="Close feedback"><X size={19} aria-hidden="true" /></button></Dialog.Close>
        </header>
        <Tabs.Root value={tab} onValueChange={setTab} className={styles.tabs}>
          <Tabs.List className={styles.tabList} aria-label="Feedback sections">
            <Tabs.Trigger value="send" className={styles.tab}>Send feedback</Tabs.Trigger>
            <Tabs.Trigger value="inbox" className={styles.tab}>{owner ? "Feedback inbox" : "My feedback"}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="send" className={styles.body}>
            {receipt ? <div className={styles.receipt} role="status">
              <CheckCircle2 size={30} aria-hidden="true" />
              <h3>Feedback received</h3>
              <p>Your message is saved in the workspace owner’s feedback inbox. You can follow its status and replies in {owner ? "Feedback inbox" : "My feedback"}.</p>
              <p className={styles.caption}>Reference {receipt.id.slice(0, 8)} · {views[receipt.view]} / {receipt.page}</p>
              <div className={styles.actions}>
                <button className={styles.primary} type="button" onClick={() => setTab("inbox")}>View feedback</button>
                <button className={styles.secondary} type="button" onClick={() => { setReceipt(null); setDraft(freshDraft(page, view)); }}>Send another</button>
              </div>
            </div> : draft && <form onSubmit={send} className={styles.form}>
              <p className={styles.context}>About <strong>{views[draft.view]} / {draft.page}</strong></p>
              <fieldset className={styles.kinds} disabled={sending}>
                <legend>What would you like to share?</legend>
                <div>{(Object.keys(kinds) as FeedbackKind[]).map(kind => <label key={kind} className={draft.kind === kind ? styles.selectedKind : undefined}>
                  <input type="radio" name="feedback-kind" value={kind} checked={draft.kind === kind} onChange={() => changeDraft({ kind })} />{kinds[kind]}
                </label>)}</div>
              </fieldset>
              <div className={styles.field}><label htmlFor="feedback-message">Your feedback</label>
                <textarea id="feedback-message" required maxLength={4000} rows={6} value={draft.message} disabled={sending} onChange={event => changeDraft({ message: event.target.value })} placeholder="What were you trying to do? What happened, or what would help?" aria-describedby="feedback-sharing" />
              </div>
              <div className={styles.count}>{draft.message.length.toLocaleString()} / 4,000</div>
              <p id="feedback-sharing" className={styles.caption}>Your message, email, and this page are shared privately with the workspace owner. Screenshots and documents are not attached automatically. Leave out passwords and client details.</p>
              {error && <p className={styles.error} role="alert">{error} Your draft is still here; retrying the same message will not create a duplicate.</p>}
              <div className={styles.actions}><button className={styles.primary} type="submit" disabled={sending || !draft.message.trim()}><Send size={15} aria-hidden="true" />{sending ? "Sending…" : "Send feedback"}</button></div>
            </form>}
          </Tabs.Content>
          <Tabs.Content value="inbox" className={styles.body}>
            {tab === "inbox" && <FeedbackInbox workspaceId={workspaceId} userId={access.userId} owner={owner} />}
          </Tabs.Content>
        </Tabs.Root>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function mergeItems(current: FeedbackItem[], incoming: FeedbackItem[]) {
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) {
    if ((byId.get(item.id)?.version ?? -1) <= item.version) byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

function FeedbackInbox({ workspaceId, userId, owner }: { workspaceId: string; userId: string; owner: boolean }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [cursor, setCursor] = useState<FeedbackCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const loadedPages = useRef(1);

  const load = useCallback(async (older?: FeedbackCursor) => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true);
    try {
      let result = await listFeedback(workspaceId, older, userId);
      const incoming = [...result.items];
      // Refresh every page already opened, retaining older rows if new feedback
      // pushes them onto a later page. Cursor overlap is deduplicated by ID.
      if (!older) for (let index = 1; index < loadedPages.current && result.nextCursor; index++) {
        result = await listFeedback(workspaceId, result.nextCursor, userId);
        incoming.push(...result.items);
      }
      if (!alive.current) return;
      if (older) loadedPages.current++;
      setItems(current => mergeItems(current, incoming));
      setCursor(result.nextCursor); setLoaded(true); setError(""); setAccessDenied(false);
    } catch (cause) {
      if (alive.current) {
        setError(errorMessage(cause));
        if (cause && typeof cause === "object" && "status" in cause && (cause.status === 401 || cause.status === 403)) {
          setItems([]); setCursor(null); setLoaded(false); setSaved(""); setEditingId(null); setAccessDenied(true); loadedPages.current = 1;
        }
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { alive.current = false; clearTimeout(timer); };
  }, [load]);
  useEffect(() => {
    if (editingId || accessDenied) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [editingId, accessDenied, load]);

  return <section aria-label={owner ? "Workspace feedback" : "Your feedback"} className={styles.inbox}>
    <div className={styles.inboxHeader}>
      <p className={styles.caption}>{accessDenied ? "Automatic refresh paused. Sign in with the right account, then refresh." : editingId ? "Automatic refresh pauses while you edit." : "Updates every 15 seconds while this inbox is open."}</p>
      <button type="button" className={styles.secondary} disabled={loading || !!editingId} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />Refresh feedback</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}{loaded ? " Previously loaded feedback is still shown." : " Use Refresh feedback to try again."}</p>}
    {saved && <p className={styles.saved} role="status">{saved}</p>}
    {!loaded && loading && <p className={styles.empty} role="status">Loading feedback…</p>}
    {loaded && !items.length && <div className={styles.empty}><MessageSquare size={25} aria-hidden="true" /><p>No feedback yet.</p><span>Messages and replies will appear here.</span></div>}
    <div className={styles.items}>{items.map(item => <article key={item.id} className={styles.item} aria-label={`Feedback ${item.id.slice(0, 8)}`}>
      <div className={styles.itemHeading}><span className={styles.kind}>{kinds[item.kind]}</span><span className={styles.status} data-status={item.status}>{statuses[item.status]}</span></div>
      <p className={styles.message}>{item.message}</p>
      <p className={styles.metadata}>{views[item.view]} / {item.page} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></p>
      {owner && <p className={styles.metadata}>{item.author_email}</p>}
      {item.owner_reply && <div className={styles.reply}><strong>Reply from the workspace owner</strong><p>{item.owner_reply}</p></div>}
      {owner && (editingId === item.id ? <FeedbackEditor key={item.id} workspaceId={workspaceId} userId={userId} item={item} onCancel={() => setEditingId(null)} onSaved={updated => { setItems(current => mergeItems(current, [updated])); setEditingId(null); setSaved("Feedback update saved. The sender can see your reply and status."); }} /> : <button type="button" className={styles.secondary} disabled={!!editingId} onClick={() => { setSaved(""); setEditingId(item.id); }}>Update feedback</button>)}
    </article>)}</div>
    {cursor && <button type="button" className={styles.secondary} disabled={loading || !!editingId} onClick={() => void load(cursor)}>{loading ? "Loading…" : "Load older feedback"}</button>}
  </section>;
}

function FeedbackEditor({ workspaceId, userId, item, onCancel, onSaved }: { workspaceId: string; userId: string; item: FeedbackItem; onCancel: () => void; onSaved: (item: FeedbackItem) => void }) {
  const [status, setStatus] = useState(item.status);
  const [reply, setReply] = useState(item.owner_reply || "");
  const [expectedVersion] = useState(item.version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || reply.length > 2000) return;
    busy.current = true; setSaving(true); setError("");
    try {
      const updated = await updateFeedback({ workspaceId, id: item.id, expectedVersion, status, reply }, userId);
      if (alive.current) onSaved(updated);
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  return <form className={styles.editor} onSubmit={save}>
    <div className={styles.field}><label htmlFor="feedback-status">Feedback status</label><select id="feedback-status" value={status} disabled={saving} onChange={event => setStatus(event.target.value as FeedbackStatus)}>{(Object.keys(statuses) as FeedbackStatus[]).map(value => <option value={value} key={value}>{statuses[value]}</option>)}</select></div>
    <div className={styles.field}><label htmlFor="feedback-reply">Reply to sender</label><textarea id="feedback-reply" rows={3} maxLength={2000} value={reply} disabled={saving} onChange={event => setReply(event.target.value)} /></div>
    <p className={styles.caption}>The sender can read this reply. {reply.length.toLocaleString()} / 2,000</p>
    {error && <p className={styles.error} role="alert">{error} Your changes are still here. If someone updated this item, copy your reply before canceling and refreshing.</p>}
    <div className={styles.actions}><button className={styles.secondary} type="button" disabled={saving} onClick={onCancel}>Cancel update</button><button className={styles.primary} type="submit" disabled={saving}>{saving ? "Saving…" : "Save update"}</button></div>
  </form>;
}
