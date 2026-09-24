"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckSquare2, GitFork, LoaderCircle, MessageSquare, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/title/store";
import { uid, type Page } from "@/lib/title/model";
import { canManageTasks } from "@/lib/title/workspace-capabilities";
import { activeWorkspace } from "@/lib/backend/client";
import { assistantRequest, AssistantClientError } from "@/lib/assistant/client";
import type { AssistantFork, AssistantInput, AssistantResponse, AssistantSource, AssistantThread, AssistantTurn, Specialist } from "@/lib/assistant/protocol";
import { reportingDate } from "./overview-summary";
import { Heading } from "./shared";
import styles from "./assistant.module.css";

const specialists: { name: Specialist; detail: string }[] = [
  { name: "Coordinator", detail: "Priorities and next steps" },
  { name: "Finals reviewer", detail: "Source gaps and policy preparation" },
  { name: "Company coordinator", detail: "Onboarding and company evidence" },
  { name: "Month-end reviewer", detail: "Recorded financial close work" },
];
const sourcePages = new Set<string>(["Overview", "Inbox", "Orders", "Commitments", "Policy workbench", "Policy products", "Revisions", "Companies", "Onboarding", "Documents", "Tasks", "Financials", "Partner portal", "Handoffs", "Automations", "Settings"]);
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const errorMessage = (error: unknown) => error instanceof DOMException && error.name === "TimeoutError"
  ? "The request timed out. Refresh the conversation or retry the same question."
  : error instanceof Error ? error.message : "The assistant could not complete this request.";

export function Assistant({ navigate }: { navigate: (page: Page) => void }) {
  const { s, connection } = useWorkspace();
  if (!connection)
    return <><Heading title="Your assistant" description="Private conversations about your title work." /><section className={`panel ${styles.intro}`}>
      <Sparkles size={28} /><h2>Available in the connected pilot</h2>
      <p>Sign in to your private shared workspace to ask about company records and work with specialist reviewers. The local sample workspace does not run AI or save assistant conversations.</p>
      <Button variant="outline" onClick={() => navigate("Settings")}>Open settings <ArrowRight /></Button>
    </section></>;
  if (!s.companies.length)
    return <><Heading title="Your assistant" description="Private conversations about your title work." /><section className={`panel ${styles.intro}`}>
      <ShieldCheck size={28} /><h2>Choose a company before starting</h2>
      <p>No companies are available to your account yet. Add a company or ask your administrator to assign company access, then return here.</p>
      <Button variant="outline" onClick={() => navigate("Companies")}>View companies <ArrowRight /></Button>
    </section></>;
  return <ConnectedAssistant key={`${connection.access.userId}:${activeWorkspace()}:${connection.access.version}`} navigate={navigate} />;
}

function ConnectedAssistant({ navigate }: { navigate: (page: Page) => void }) {
  const { s } = useWorkspace();
  const [company, setCompany] = useState(s.companies[0]?.id || "");
  const [order, setOrder] = useState("");
  const companyId = s.companies.some((item) => item.id === company) ? company : s.companies[0]?.id || "";
  const orders = s.orders.filter((item) => item.companyId === companyId);
  const orderId = orders.some((item) => item.id === order) ? order : "";
  return <>
    <Heading title="Your assistant" description="Review saved fields and document lists with specialist help. Original files still need a person’s review." />
    <section className={`panel ${styles.scope}`} aria-label="Assistant context">
      <label htmlFor="assistant-company">Company<select id="assistant-company" value={companyId} onChange={(event) => { setCompany(event.target.value); setOrder(""); }}>
        {s.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label htmlFor="assistant-order">Title file <span className={styles.muted}>(optional)</span><select id="assistant-order" value={orderId} onChange={(event) => setOrder(event.target.value)}>
        <option value="">Company overview</option>
        {orders.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.address}</option>)}
      </select></label>
      <p><ShieldCheck size={16} /> Conversations are private to your account. Changing the company or file opens a separate history.</p>
    </section>
    <ConversationScope key={`${companyId}:${orderId}`} companyId={companyId} orderId={orderId} navigate={navigate} />
  </>;
}

type TaskReview = { threadId: string; turnId: string; forkId: string; title: string; due: string };
function ConversationScope({ companyId, orderId, navigate }: { companyId: string; orderId: string; navigate: (page: Page) => void }) {
  const { update, connection } = useWorkspace();
  const [data, setData] = useState<AssistantResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const [chosen, setChosen] = useState<Specialist[]>(["Coordinator"]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingSend, setPendingSend] = useState<AssistantInput | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [review, setReview] = useState<TaskReview | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState("");
  const controllers = useRef(new Set<AbortController>());
  const operation = useRef(false);
  const alive = useRef(true);
  const answerEnd = useRef<HTMLDivElement>(null);
  const currentThread = data?.threads.find((thread) => thread.id === selected);
  const forksRunning = !!data?.threads.some((thread) => thread.turns.some((turn) => turn.forks.some((fork) => fork.status === "Running")));
  const canCreateTask = !!connection && canManageTasks(connection);
  const availableSpecialists = specialists.filter((specialist) => specialist.name !== "Month-end reviewer" || (connection && ["owner", "admin", "finance"].includes(connection.access.role)));

  const request = useCallback(async (input: AssistantInput) => {
    // A newer operation replaces a pending poll, so an older list cannot overwrite it.
    for (const pending of controllers.current) pending.abort();
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const result = await assistantRequest(input, { companyId, orderId, userId: connection?.access.userId, workspaceId: connection?.workspaceId, accessVersion: connection?.access.version }, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    }
    finally { controllers.current.delete(controller); }
  }, [companyId, orderId, connection?.access.userId, connection?.access.version, connection?.workspaceId]);
  const fail = useCallback((reason: unknown) => {
    if (!alive.current || isAbort(reason)) return;
    setError(errorMessage(reason));
    if (reason instanceof AssistantClientError && [401, 403, 409].includes(reason.status)) {
      setData(null); setSelected(""); setReview(null);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    void request({ action: "list" }).then((result) => {
      if (!alive.current) return;
      setData(result); setSelected(result.threads[0]?.id || "");
    }, fail).finally(() => { if (alive.current) setLoading(false); });
    return () => {
      alive.current = false;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    };
  }, [request, fail]);
  useEffect(() => {
    if (!forksRunning || error || busy || taskBusy) return;
    const timer = setTimeout(() => {
      if (operation.current) return;
      void request({ action: "list" }).then((result) => {
        if (alive.current) setData(result);
      }, fail);
    }, 1500);
    return () => clearTimeout(timer);
  }, [data, forksRunning, error, busy, taskBusy, request, fail]);
  useEffect(() => {
    answerEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected, currentThread?.turns.length]);

  async function refresh() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError("");
    try {
      const result = await request({ action: "list" });
      if (alive.current) {
        setData(result);
        const recovered = pendingSend && result.threads.find((thread) => thread.turns.some((turn) => turn.id === pendingSend.requestId));
        if (recovered) {
          setSelected(recovered.id); setQuestion(""); setPendingSend(null);
        }
      }
    } catch (reason) { fail(reason); }
    finally { operation.current = false; if (alive.current) { setBusy(false); setLoading(false); } }
  }
  async function send(input: AssistantInput) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError(""); setNotice(""); setPendingSend(input);
    try {
      const result = await request(input);
      if (!alive.current) return;
      setData(result);
      const thread = result.threads.find((item) => item.turns.some((turn) => turn.id === input.requestId)) ||
        result.threads.find((item) => item.id === input.threadId) || result.threads[0];
      setSelected(thread?.id || ""); setQuestion(""); setPendingSend(null);
    } catch (reason) {
      fail(reason);
      if (alive.current && reason instanceof AssistantClientError && reason.status >= 400 && reason.status < 500)
        setPendingSend(null);
    } finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !chosen.length || busy || forksRunning || !data || data.remaining <= 0) return;
    void send({ action: "send", threadId: selected || undefined, requestId: crypto.randomUUID(), question: question.trim(), specialists: [...chosen] });
  }
  function newConversation() {
    setSelected(""); setQuestion(""); setPendingSend(null); setNotice(""); setReview(null);
  }
  async function deleteConversation() {
    if (!selected || operation.current || forksRunning) return;
    operation.current = true;
    setBusy(true); setError("");
    try {
      const result = await request({ action: "delete", threadId: selected });
      if (!alive.current) return;
      setData(result); newConversation(); setDeleting(false); setNotice("Conversation deleted.");
    } catch (reason) { fail(reason); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function openTask(thread: AssistantThread, turn: AssistantTurn, fork: AssistantFork) {
    if (!fork.result) return;
    const today = reportingDate();
    setTaskError("");
    setReview({ threadId: thread.id, turnId: turn.id, forkId: fork.id, title: (fork.result.nextStep || fork.result.summary).trim().slice(0, 180), due: `${today.period}-${today.day.padStart(2, "0")}` });
  }
  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!review || !review.title.trim() || !review.due || !canCreateTask || operation.current) return;
    operation.current = true;
    setTaskBusy(true); setTaskError("");
    try {
      const fresh = await request({ action: "list" });
      if (!alive.current) return;
      setData(fresh);
      const turn = fresh.threads.find((thread) => thread.id === review.threadId)?.turns.find((item) => item.id === review.turnId);
      const fork = turn?.forks.find((item) => item.id === review.forkId);
      if (!turn) {
        setReview(null);
        setError("This answer is no longer available with your current source access. Start a new conversation.");
        return;
      }
      if (fork?.status !== "Complete" || !fork.result || fresh.context.revision !== turn.revision)
        throw new Error("The records or source access changed since this answer. Ask for an updated review before creating the task.");
      const saved = await update((draft) => {
        draft.tasks.unshift({ id: uid("task"), title: review.title.trim(), due: review.due, companyId, owner: connection!.access.email, assigneeId: connection!.access.userId, priority: "Normal", done: false });
      }, "Assistant task created", review.title.trim(), turn.revision);
      if (!alive.current) return;
      if (!saved) {
        setTaskError("The task was not saved. Refresh the workspace and review the answer again.");
        return;
      }
      setReview(null); setNotice("Task created and assigned to you. Open Tasks to follow up.");
    } catch (reason) {
      if (reason instanceof AssistantClientError && [401, 403, 409].includes(reason.status)) fail(reason);
      else if (alive.current && !isAbort(reason)) setTaskError(errorMessage(reason));
    } finally { operation.current = false; if (alive.current) setTaskBusy(false); }
  }

  return <>
    <div className={styles.service}>
      <span><ShieldCheck size={15} /> Private to {connection?.access.email}</span>
      <span>{data ? `Private assistant · ${data.remaining} questions remaining today` : loading ? "Checking assistant availability…" : "Assistant unavailable"}</span>
    </div>
    {error && <div className={styles.error} role="alert"><p>{error}</p><div className={styles.actions}>
      {pendingSend && <Button variant="outline" disabled={busy} onClick={() => void send(pendingSend)}>Retry same question</Button>}
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw /> Refresh history</Button>
    </div></div>}
    {notice && <div className={styles.notice} role="status"><p>{notice}</p>{notice.startsWith("Task created") && <Button variant="ghost" onClick={() => navigate("Tasks")}>Open tasks <ArrowRight /></Button>}</div>}
    <div className={styles.layout}>
      <aside className={`panel ${styles.history}`} aria-label="Private conversations">
        <div className={styles.historyHeading}><h2>Your conversations</h2><Button size="icon" variant="ghost" disabled={busy || forksRunning} aria-label="New conversation" onClick={newConversation}><Plus /></Button></div>
        <p className={styles.caption}>For this company{orderId ? " and title file" : " overview"} only</p>
        {loading ? <p className={styles.muted}>Loading history…</p> : data?.threads.length ? data.threads.map((thread) => <button key={thread.id} type="button" className={`${styles.historyItem} ${selected === thread.id ? styles.selected : ""}`} disabled={busy} onClick={() => { setSelected(thread.id); setQuestion(""); setPendingSend(null); setReview(null); setNotice(""); }}>
          <MessageSquare size={15} /><span><strong>{thread.title}</strong><small>{thread.turns.length} {thread.turns.length === 1 ? "question" : "questions"}{thread.turns.some((turn) => turn.forks.some((fork) => fork.status === "Running")) ? " · Reviewing" : ""}</small></span>
        </button>) : <p className={styles.muted}>Your saved conversations will appear here.</p>}
      </aside>
      <section className={`panel ${styles.conversation}`} aria-label="Assistant conversation" aria-busy={loading}>
        <div className={styles.conversationHeading}><div><h2>{currentThread?.title || "Start a conversation"}</h2><p>{data?.context.companyName || "Selected company"}{orderId ? ` · ${orderId}` : " · Company overview"}</p></div>{currentThread && <Button size="icon" variant="ghost" disabled={busy || taskBusy || forksRunning} onClick={() => setDeleting(true)} aria-label="Delete this conversation"><Trash2 /></Button>}</div>
        <div className={styles.answers}>
          {!currentThread && <div className={styles.welcome}><Sparkles size={26} /><h3>What needs your attention?</h3><p>Ask a focused question. Choose up to two specialists for separate reviews of the same authorized records.</p><div className={styles.starters}>
            {(orderId ? ["What source documents or review steps are missing from this file?", "What should I check before preparing this policy?", "Summarize the open follow-ups on this file."] : ["What should I prioritize for this company?", "What onboarding evidence still needs review?", "Summarize the recorded month-end work and outstanding questions."]).map((starter) => <button type="button" key={starter} disabled={busy || !data} onClick={() => setQuestion(starter)}>{starter}<ArrowRight size={15} /></button>)}
          </div></div>}
          {currentThread?.turns.map((turn) => <article className={styles.turn} key={turn.id}>
            <div className={styles.question}><span>You · {new Date(turn.createdAt).toLocaleString()}</span><p>{turn.question}</p></div>
            <div className={styles.forks}>{turn.forks.map((fork) => <ForkCard key={fork.id} fork={fork} turn={turn} sources={data?.context.sources || []} currentRevision={data?.context.revision} navigate={navigate} onTask={canCreateTask ? () => openTask(currentThread, turn, fork) : undefined} />)}</div>
          </article>)}
          <div ref={answerEnd} />
        </div>
        <form className={styles.composer} onSubmit={submit}>
          <fieldset className={styles.specialists}><legend>Choose one or two reviewers</legend><div>{availableSpecialists.map((specialist) => <label key={specialist.name} className={chosen.includes(specialist.name) ? styles.specialistSelected : ""}>
            <input type="checkbox" checked={chosen.includes(specialist.name)} disabled={busy || (chosen.length === 2 && !chosen.includes(specialist.name))} onChange={() => setChosen((current) => current.includes(specialist.name) ? current.filter((name) => name !== specialist.name) : [...current, specialist.name].slice(0, 2))} />
            <span><strong>{specialist.name}</strong><small>{specialist.detail}</small></span>
          </label>)}</div></fieldset>
          <label htmlFor="assistant-question" className={styles.questionLabel}>Your question</label>
          <Textarea id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this company or file…" maxLength={2000} rows={3} disabled={busy || !data} />
          <div className={styles.composerFoot}><p>{forksRunning ? "The reviewers are working. Your next question can start once they finish." : data?.context.truncated ? "This review uses a limited set of visible records. Select a file for a more focused answer." : "Answers are suggestions. Business records change only after your review."}</p><Button type="submit" disabled={busy || forksRunning || !data || data.remaining <= 0 || !question.trim() || !chosen.length}>{busy ? <LoaderCircle className={styles.spin} /> : <Send />}{busy ? "Working…" : "Ask reviewers"}</Button></div>
        </form>
      </section>
    </div>
    <Dialog open={deleting} onOpenChange={(open) => { if (!busy) setDeleting(open); }}><DialogContent className="modal"><DialogHeader><DialogTitle>Delete this conversation?</DialogTitle><DialogDescription>This removes its private questions and specialist answers. Existing business records and tasks stay unchanged.</DialogDescription></DialogHeader><div className={styles.actions}><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>Cancel</Button><Button disabled={busy} onClick={() => void deleteConversation()}>Delete conversation</Button></div></DialogContent></Dialog>
    <Dialog open={canCreateTask && !!review} onOpenChange={(open) => { if (!open && !taskBusy) setReview(null); }}><DialogContent className="modal"><DialogHeader><DialogTitle>Review as a task</DialogTitle><DialogDescription>Edit the next step before saving it to {data?.context.companyName || "this company"}. The task will be assigned to your account: {connection?.access.email}.</DialogDescription></DialogHeader>{review && <form onSubmit={createTask} className={styles.taskForm}>
      <label htmlFor="assistant-task-title">Task title<Input id="assistant-task-title" required maxLength={180} value={review.title} disabled={taskBusy} onChange={(event) => setReview({ ...review, title: event.target.value })} /></label>
      <label htmlFor="assistant-task-due">Due date<Input id="assistant-task-due" type="date" required value={review.due} disabled={taskBusy} onChange={(event) => setReview({ ...review, due: event.target.value })} /></label>
      {taskError && <p role="alert" className={styles.taskError}>{taskError}</p>}
      <p className={styles.caption}>The source context will be checked again before saving. This creates a task only.</p>
      <div className={styles.actions}><Button variant="outline" type="button" disabled={taskBusy} onClick={() => setReview(null)}>Cancel</Button><Button type="submit" disabled={taskBusy || !review.title.trim() || !review.due}>{taskBusy && <LoaderCircle className={styles.spin} />}Create reviewed task</Button></div>
    </form>}</DialogContent></Dialog>
  </>;
}

function ForkCard({ fork, turn, sources, currentRevision, navigate, onTask }: { fork: AssistantFork; turn: AssistantTurn; sources: AssistantSource[]; currentRevision?: number; navigate: (page: Page) => void; onTask?: () => void }) {
  const result = fork.result;
  const stale = currentRevision !== undefined && currentRevision !== turn.revision;
  return <section className={styles.fork}>
    <div className={styles.forkHeading}><h3><GitFork size={16} />{fork.specialist}</h3><span className={styles.forkStatus}>{fork.status === "Running" && <LoaderCircle className={styles.spin} size={14} />}{fork.status === "Running" ? "Reviewing" : fork.status}</span></div>
    {fork.status === "Running" ? <p className={styles.muted}>Reviewing the selected records. This subtask is saved with your conversation.</p> : fork.status === "Failed" ? <p className={styles.taskError}>{fork.error || "This reviewer could not complete the analysis. Ask a new question to try again."}</p> : result ? <>
      <p className={styles.summary}>{result.summary}</p>
      {result.findings.length > 0 && <ul className={styles.findings}>{result.findings.map((finding, index) => <li key={index}><p>{finding.text}</p><div className={styles.sources}>{finding.sourceIds.map((id) => {
        const source = sources.find((item) => item.id === id);
        return source && sourcePages.has(source.page) ? <button type="button" key={id} onClick={() => navigate(source.page as Page)}><ArrowRight size={12} />{source.label}</button> : <span key={id} className={styles.caption}>Source no longer available</span>;
      })}</div></li>)}</ul>}
      {result.nextStep && <div className={styles.nextStep}><strong>Suggested next step</strong><p>{result.nextStep}</p></div>}
      <div className={styles.forkFooter}><small>Based on workspace revision {turn.revision}</small>{onTask && <Button variant="outline" size="sm" disabled={stale} onClick={onTask}><CheckSquare2 size={15} />Review as task</Button>}</div>
      {stale && <p className={styles.caption}>The workspace has changed. Ask for a fresh review before creating a task.</p>}
    </> : <p className={styles.muted}>No answer is available for this reviewer.</p>}
  </section>;
}
