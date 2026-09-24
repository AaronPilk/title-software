"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "radix-ui";
import { ArrowRight, BookOpen, HelpCircle, LoaderCircle, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { useWorkspace } from "@/lib/title/store";
import { AssistantClientError, assistantRequest } from "@/lib/assistant/client";
import type { AssistantInput, AssistantResponse, AssistantSource, AssistantTurn } from "@/lib/assistant/protocol";
import { helpGuides, suggestedHelpGuides, type HelpScreen } from "@/lib/assistant/help-guides";
import { pageVisibleInWorkspace, workspacePages } from "@/lib/title/workspace-view";
import type { Page } from "@/lib/title/model";
import styles from "./help-agent.module.css";

type Props = {
  screen: HelpScreen;
  navigate: (page: Page) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideLauncher?: boolean;
};
const views = { agency: "Agency", production: "Production", partner: "Partner" };
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const describeError = (error: unknown) => error instanceof DOMException && error.name === "TimeoutError"
  ? "The guide took too long to respond. Your question is still here."
  : error instanceof Error ? error.message : "The guide could not respond right now.";

/** Keep private history and callbacks scoped to this signed-in identity and screen. */
export function HelpAgent(props: Props) {
  const { connection } = useWorkspace();
  const identity = connection ? `${connection.workspaceId}:${connection.access.userId}:${connection.access.role}:${connection.access.version}` : "local";
  return <HelpConversation key={`${identity}:${props.screen.view}:${props.screen.page}:${props.screen.surface || "page"}`} {...props} role={connection?.access.role || "owner"} identity={connection ? { userId: connection.access.userId, workspaceId: connection.workspaceId, accessVersion: connection.access.version } : undefined} />;
}

function HelpConversation({ screen, navigate, open: controlledOpen, onOpenChange, hideLauncher, role, identity }: Props & { role: string; identity?: { userId: string; workspaceId: string; accessVersion: number } }) {
  const connected = !!identity;
  const { page, view, surface } = screen;
  const userId = identity?.userId, workspaceId = identity?.workspaceId, accessVersion = identity?.accessVersion;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [data, setData] = useState<AssistantResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const [pendingSend, setPendingSend] = useState<AssistantInput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deleteReview, setDeleteReview] = useState(false);
  const [notice, setNotice] = useState("");
  const [guideId, setGuideId] = useState("");
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const thread = data?.threads.find(item => item.id === selected);
  const running = !!data?.threads.some(item => item.turns.some(turn => turn.forks.some(fork => fork.status === "Running")));
  const guides = helpGuides(role);
  const suggestions = suggestedHelpGuides(role, screen);
  const activeGuide = guides.find(guide => guide.id === guideId);
  const navigateGuide = (id: string) => {
    const guide = guides.find(item => item.id === id);
    if (!guide || !workspacePages.includes(guide.page as Page) || !pageVisibleInWorkspace(guide.page as Page, role)) return;
    changeOpen(false);
    navigate(guide.page as Page);
  };
  function changeOpen(next: boolean) {
    if (next && !open) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInternalOpen(next);
    onOpenChange?.(next);
  }
  const request = useCallback(async (input: AssistantInput) => {
    // An explicit send or refresh supersedes a slower history poll.
    for (const current of controllers.current) current.abort();
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await assistantRequest({ ...input, purpose: "help", screen: { page, view, ...(surface ? { surface } : {}) } }, { companyId: "", orderId: "", userId, workspaceId, accessVersion }, controller.signal);
      controller.signal.throwIfAborted();
      return response;
    } finally { controllers.current.delete(controller); }
  }, [page, view, surface, userId, workspaceId, accessVersion]);
  const fail = useCallback((cause: unknown) => {
    if (!alive.current || isAbort(cause)) return;
    setError(describeError(cause));
    if (cause instanceof AssistantClientError && [401, 403, 409].includes(cause.status)) {
      setData(null); setSelected(""); setDeleteReview(false);
    }
  }, []);
  // Install before the first paint: Radix's layer registration runs later.
  // Escape must never reach an underlying form during that short window.
  useLayoutEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      setInternalOpen(false); onOpenChange?.(false);
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open, onOpenChange]);
  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    return () => { alive.current = false; for (const current of activeControllers) current.abort(); activeControllers.clear(); };
  }, []);
  const refresh = useCallback(async () => {
    if (!connected || operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try {
      const response = await request({ action: "list" });
      if (!alive.current) return;
      setData(response);
      const recovered = pendingSend && response.threads.find(item => item.turns.some(turn => turn.id === pendingSend.requestId));
      if (recovered) { setSelected(recovered.id); setPendingSend(null); setQuestion(""); }
      else setSelected(current => response.threads.some(item => item.id === current) ? current : response.threads[0]?.id || "");
    } catch (cause) { fail(cause); }
    finally { operation.current = false; if (alive.current) { setLoaded(true); setBusy(false); } }
  }, [connected, request, fail, pendingSend]);
  useEffect(() => {
    if (!open || !connected || loaded) return;
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [open, connected, loaded, refresh]);
  useEffect(() => {
    if (!open || !running || busy || error) return;
    const timer = setTimeout(() => { void refresh(); }, 1500);
    return () => clearTimeout(timer);
  }, [open, running, busy, error, data, refresh]);

  async function send(payload: AssistantInput) {
    if (operation.current || !connected) return;
    operation.current = true; setBusy(true); setError(""); setNotice(""); setPendingSend(payload);
    try {
      const response = await request(payload);
      if (!alive.current) return;
      setData(response); setLoaded(true);
      setSelected(response.threads.find(item => item.turns.some(turn => turn.id === payload.requestId))?.id || payload.threadId || response.threads[0]?.id || "");
      setQuestion(""); setPendingSend(null);
    } catch (cause) {
      fail(cause);
      if (alive.current && cause instanceof AssistantClientError && cause.status >= 400 && cause.status < 500) setPendingSend(null);
    } finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy || running || (data && data.remaining <= 0)) return;
    const payload = pendingSend?.question === question.trim() ? pendingSend : {
      action: "send" as const, threadId: selected || undefined, requestId: crypto.randomUUID(), question: question.trim(), specialists: ["Product guide"] as AssistantInput["specialists"],
    };
    void send(payload);
  }
  function chooseQuestion(value: string) {
    if (busy) return;
    setQuestion(value); setPendingSend(null); setNotice(""); input.current?.focus();
  }
  async function deleteConversation() {
    if (!selected || operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try {
      const response = await request({ action: "delete", threadId: selected });
      if (!alive.current) return;
      setData(response); setSelected(""); setQuestion(""); setPendingSend(null); setDeleteReview(false); setNotice("Conversation deleted.");
    } catch (cause) { fail(cause); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    {!hideLauncher && <Dialog.Trigger asChild><button type="button" ref={launcher} className={styles.launcher}><HelpCircle size={18} aria-hidden="true" />Ask for help</button></Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content data-product-help="open" className={styles.dialog} onOpenAutoFocus={event => {
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnFocus.current = document.activeElement;
        if (input.current) { event.preventDefault(); input.current.focus(); }
      }} onCloseAutoFocus={event => {
        const target = returnFocus.current?.isConnected ? returnFocus.current : launcher.current;
        if (target) { event.preventDefault(); target.focus(); }
      }}>
        <header className={styles.header}>
          <span className={styles.eyebrow}><HelpCircle size={14} aria-hidden="true" />Your product guide</span>
          <Dialog.Title className={styles.title}>How can I help?</Dialog.Title>
          <Dialog.Description className={styles.description}>Ask how to use Title Software. I’ll explain the steps and show you where to go.</Dialog.Description>
          <Dialog.Close asChild><button type="button" className={styles.close} aria-label="Close help"><X size={19} aria-hidden="true" /></button></Dialog.Close>
        </header>
        <div className={styles.body}>
          <p className={styles.context}>{views[screen.view]} / {screen.page}{screen.surface && screen.surface !== "page" ? ` · ${screen.surface === "company" ? "Company details" : screen.surface === "document" ? "Document preview" : "Title file"}` : ""}</p>
          <section className={styles.guides} aria-label="Quick guides">
            <h3><BookOpen size={15} aria-hidden="true" />Quick guides</h3>
            <div className={styles.chips}>{suggestions.slice(0, 3).map(guide => <button type="button" key={guide.id} onClick={() => setGuideId(current => current === guide.id ? "" : guide.id)} aria-expanded={activeGuide?.id === guide.id}>{guide.title}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>
            <details className={styles.allGuides}><summary>Browse all guides</summary><div className={styles.chips}>{guides.map(guide => <button type="button" key={guide.id} onClick={() => setGuideId(guide.id)}>{guide.title}</button>)}</div></details>
            {activeGuide && <article className={styles.guide} aria-label={activeGuide.title}>
              <h4>{activeGuide.title}</h4><p>{activeGuide.summary}</p><ol>{activeGuide.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>{activeGuide.note && <p className={styles.caption}>{activeGuide.note}</p>}
              <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => navigateGuide(activeGuide.id)}>Open {activeGuide.page}<ArrowRight size={13} aria-hidden="true" /></button>{connected && <button type="button" className={styles.secondary} disabled={busy} onClick={() => chooseQuestion(activeGuide.question)}>Ask about this</button>}</div>
            </article>}
          </section>
          {!connected ? <p className={styles.caption}>These step-by-step guides work in the sample workspace. Sign in to the shared workspace to ask a question and keep your private conversation history.</p> : <>
            <div className={styles.toolbar}>
              <label>Conversation<select aria-label="Help conversation" value={selected} disabled={busy || running} onChange={event => { setSelected(event.target.value); setQuestion(""); setPendingSend(null); setDeleteReview(false); setNotice(""); }}><option value="">New conversation</option>{data?.threads.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <button type="button" className={styles.iconButton} aria-label="New help conversation" disabled={busy || running} onClick={() => { setSelected(""); setQuestion(""); setPendingSend(null); setDeleteReview(false); setNotice(""); input.current?.focus(); }}><Plus size={17} /></button>
              <button type="button" className={styles.iconButton} aria-label="Refresh help history" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} className={busy ? styles.spin : ""} /></button>
              {thread && <button type="button" className={styles.iconButton} aria-label="Delete help conversation" disabled={busy || running} onClick={() => setDeleteReview(true)}><Trash2 size={16} /></button>}
            </div>
            {deleteReview && <div className={styles.confirm}><p>Delete this private conversation?</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setDeleteReview(false)}>Keep conversation</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void deleteConversation()}>Delete conversation</button></div></div>}
            {error && <div className={styles.error} role="alert"><p>{error}</p><p>Quick guides are still available above.</p>{pendingSend && <button type="button" disabled={busy} className={styles.secondary} onClick={() => void send(pendingSend)}>Retry same question</button>}</div>}
            {notice && <p className={styles.caption} role="status">{notice}</p>}
            <section className={styles.conversation} aria-label="Your help conversation" aria-live="polite" aria-relevant="additions text">
              {!loaded && busy && <p className={styles.caption}>Loading your private history…</p>}
              {!thread && <div className={styles.starters}><p>Try a question about this screen:</p>{suggestions.slice(0, 2).map(guide => <button key={guide.id} type="button" disabled={busy} onClick={() => chooseQuestion(guide.question)}>{guide.question}</button>)}</div>}
              {thread?.turns.map(turn => <HelpAnswer key={turn.id} turn={turn} sources={data?.context.sources || []} guides={guides} navigateGuide={navigateGuide} retry={() => chooseQuestion(turn.question)} busy={busy} />)}
            </section>
            <form className={styles.composer} onSubmit={submit}>
              <label htmlFor={inputId}>Your question</label>
              <textarea ref={input} id={inputId} value={question} onChange={event => { setQuestion(event.target.value); setPendingSend(null); }} maxLength={2000} rows={3} placeholder="For example: How do I upload company documents?" disabled={busy} />
              <p className={styles.caption}>Answers use the software’s help guides. No client files are attached. Leave out passwords and personal client details.</p>
              <div className={styles.composerFoot}><span className={styles.caption}>{running ? "Finding the next steps…" : data && data.remaining <= 0 ? "Today’s question limit is reached. Quick guides remain available." : "Private to your account"}</span><button type="submit" className={styles.primary} disabled={busy || running || !question.trim() || !!(data && data.remaining <= 0)}>{busy || running ? <LoaderCircle size={15} className={styles.spin} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}{busy ? "Working…" : "Ask guide"}</button></div>
            </form>
          </>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function HelpAnswer({ turn, sources, guides, navigateGuide, retry, busy }: { turn: AssistantTurn; sources: AssistantSource[]; guides: ReturnType<typeof helpGuides>; navigateGuide: (id: string) => void; retry: () => void; busy: boolean }) {
  return <article className={styles.turn}>
    <div className={styles.question}><span>You</span><p>{turn.question}</p></div>
    {turn.forks.map(fork => <div className={styles.answer} key={fork.id}>
      <strong>Product guide</strong>
      {fork.status === "Running" ? <p role="status"><LoaderCircle size={14} className={styles.spin} aria-hidden="true" />Finding the steps in the help guides…</p> : fork.status === "Failed" ? <><p>{fork.error || "I couldn’t prepare an answer this time."} The quick guides above are still available.</p><button type="button" className={styles.secondary} disabled={busy} onClick={retry}>Try this question again</button></> : fork.result ? <>
        <p>{fork.result.summary}</p>
        {fork.result.findings.length > 0 && <ol className={styles.steps}>{fork.result.findings.map((finding, index) => <li key={index}><p>{finding.text}</p><div className={styles.sources}>{[...new Set(finding.sourceIds)].map(id => {
          const source = sources.find(item => item.id === id);
          const guide = source && guides.find(item => item.id === id);
          return guide ? <button key={id} type="button" onClick={() => navigateGuide(guide.id)}>{guide.title}<ArrowRight size={12} aria-hidden="true" /></button> : null;
        })}</div></li>)}</ol>}
        {fork.result.nextStep && <div className={styles.nextStep}><span>Next step</span><p>{fork.result.nextStep}</p></div>}
      </> : <p>No answer was returned. Try a quick guide above.</p>}
    </div>)}
  </article>;
}
