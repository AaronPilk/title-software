"use client";
import { IntakeCapture } from "./intake-capture";
import { UploadDocument, DocumentPreview } from "./documents";
import { useState } from "react";
import {
  Archive,
  ArrowRight,
  Check,
  Clock3,
  Download,
  FileText,
  Inbox as InboxIcon,
  Mail,
  Paperclip,
  Play,
  Plus,
  Workflow,
  CheckCheck,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TableRow, TableCell } from "@/components/ui/table";
import { useWorkspace, download } from "@/lib/title/store";
import {
  companyById,
  uid,
  onboardingSteps,
  type Workspace,
} from "@/lib/title/model";
import {
  Heading,
  Segments,
  SearchBox,
  Status,
  Picker,
  DataTable,
  Empty,
  FieldLabel,
} from "./shared";
import { toast } from "sonner";
import { executeRules } from "@/lib/title/engine";
import {
  taskClock,
  taskWaiting,
  openWaiting,
  startWaiting,
  resolveWaiting,
  waitingReasons,
} from "@/lib/title/task-clock";
export function InboxView({
  onReview,
  onRevision,
  onCommitment,
}: {
  onReview: (id: string) => void;
  onRevision: (id: string) => void;
  onCommitment: (id: string) => void;
}) {
  const { s, update, connection } = useWorkspace();
  const [capture, setCapture] = useState(false);
  const [routing, setRouting] = useState(false);
  const [uploadFile, setUploadFile] = useState(false);
  const [previewDoc, setPreviewDoc] = useState("");
  const [selected, setSelected] = useState(s.inbox[0]?.id || "");
  const [filter, setFilter] = useState("All messages");
  const [draft, setDraft] = useState<string | null>(null);
  const [company, setCompany] = useState("c3");
  const [msgOrder, setMsgOrder] = useState("");
  const m = s.inbox.find((x) => x.id === selected);
  const filingCompany = m?.companyId || company;
  const rows = s.inbox.filter(
    (x) => filter === "All messages" || x.status === filter,
  );
  const linked = m ? s.orders.find((o) => o.id === m.orderId) : null;
  async function queue() {
    if (!m || !linked) return;
    if (m.kind === "Commitment") {
      if (
        !(await update(
          (d) => {
            const mail = d.inbox.find((x) => x.id === m.id)!;
            mail.orderId = linked.id;
            mail.status = "Queued";
          },
          "Commitment intake queued",
          linked.id,
        ))
      )
        return;
      onCommitment(linked.id);
      return;
    }
    if (m.kind === "Revision") {
      if (
        !(await update((d) => {
          d.inbox.find((x) => x.id === m.id)!.orderId = linked.id;
        }))
      )
        return;
      onRevision(m.id);
      return;
    }
    await update(
      (d) => {
        d.inbox.find((x) => x.id === m.id)!.status = "Queued";
        d.inbox.find((x) => x.id === m.id)!.orderId = linked.id;
        if (
          linked.fields.length &&
          !["Issued", "Ready for jacket", "Rejected"].includes(linked.status)
        )
          d.orders.find((x) => x.id === linked.id)!.status = "Needs review";
      },
      "Request queued for review",
      linked.id,
    );
  }
  return (
    <>
      <Heading
        title="Inbox"
        description="Turn incoming requests into the next right action."
      >
        <Button onClick={() => setCapture(true)}>
          <Plus />
          Capture request
        </Button>
        <span className="subtle-pill">
          <Mail size={14} />
          Request inbox
        </span>
      </Heading>
      <div className="toolbar">
        <Segments
          value={filter}
          onChange={setFilter}
          items={["All messages", "New", "Queued", "Archived"]}
        />
        <span className="subtle">{rows.length} messages</span>
      </div>
      <div className="inbox-layout panel">
        <aside className="message-list">
          {rows.map((x) => (
            <button
              className={`message-preview ${selected === x.id ? "selected" : ""}`}
              key={x.id}
              onClick={() => {
                setSelected(x.id);
                setMsgOrder("");
              }}
            >
              <div>
                <strong>{x.from}</strong>
                <small>{x.time}</small>
              </div>
              <h3>{x.subject}</h3>
              <p>{x.body.replaceAll("\n", " ").slice(0, 95)}…</p>
              <span>
                <Paperclip size={12} />
                {x.attachments.length} attachments
                <Status value={x.status} />
              </span>
            </button>
          ))}
          {!rows.length && <Empty title="Inbox is clear" />}
        </aside>
        <section className="message-body">
          {m ? (
            <>
              <div className="message-heading">
                <div>
                  <h2>{m.subject}</h2>
                  <p>
                    {m.from} <span>&lt;{m.email}&gt;</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Archive message"
                  disabled={m.status === "Archived"}
                  onClick={async () =>
                    await update(
                      (d) => {
                        d.inbox.find((x) => x.id === m.id)!.status = "Archived";
                      },
                      "Message archived",
                      m.subject,
                    )
                  }
                >
                  <Archive />
                </Button>
              </div>
              <div className="source-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRouting(true)}
                  disabled={!!m.missive}
                >
                  Route / link attachments
                </Button>
                {linked && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUploadFile(true)}
                  >
                    Upload to file
                  </Button>
                )}
              </div>
              {m.missive && <div className="form-note">
                <p>Imported from Missive · {new Date(m.missive.importedAt).toLocaleString()}. Company and file routing are preserved with the original source.</p>
                <Button variant="outline" onClick={() => setPreviewDoc(m.missive!.sourceDocumentId)}>View original message snapshot</Button>
                {m.missive.attachments.length > 0 && <p>Message text saved. {m.missive.attachments.length} Missive attachments have not been downloaded. Upload originals to this file for review.</p>}
                {m.missive.attachments.map(a => <p key={a.id}>{a.name} · {a.bytes.toLocaleString()} bytes · Not downloaded</p>)}
              </div>}
              <pre className="message-text">{m.body}</pre>
              {m.documentIds?.map((id) => {
                const doc = s.documents.find((d) => d.id === id);
                return doc ? (
                  <Button
                    key={id}
                    variant="outline"
                    onClick={() => setPreviewDoc(id)}
                  >
                    <FileText />
                    {doc.name}
                  </Button>
                ) : null;
              })}
              <div className="attachments">
                {m.attachments.map((name) => (
                  <div key={name}>
                    <FileText size={20} />
                    <span>
                      <strong>{name}</strong>
                      <small>{m.documentIds?.length ? "Saved document" : "Attachment reference"}</small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="intake-card">
                <span className="mini-icon blue">
                  <Workflow size={20} />
                </span>
                <div className="grow">
                  <h3>
                    {m.orderId
                      ? m.kind === "Revision"
                        ? "Review the requested revision"
                        : "Match this request to an order"
                      : "File this request to a company"}
                  </h3>
                  <p>
                    {m.orderId
                      ? "Confirm the destination before adding it to the preparation queue."
                      : "Keep company correspondence with its onboarding records."}
                  </p>
                </div>
              </div>
              {m.orderId ? (
                <>
                  <p className="inline-note">
                    Destination: {linked?.id} · {linked?.address}. {m.missive ? "Routing is preserved with the imported source." : "Use Route / link attachments to change it."}
                  </p>
                  <div className="message-actions">
                    <Button
                      disabled={m.status === "Queued" && m.kind !== "Revision"}
                      onClick={queue}
                    >
                      <CheckCheck />
                      {m.kind === "Revision"
                        ? "Review revision"
                        : m.status === "Queued"
                          ? "Queued for review"
                          : "Queue for review"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => linked && onReview(linked.id)}
                    >
                      Open workbench
                      <ArrowRight />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setDraft(
                          `Subject: Re: ${m.subject}\n\nHello,\n\nPlease send a clearer copy of the recorded document, including the complete recording stamp, for ${linked?.address}. We will resume the review once received.\n\nThank you,\n${s.user}\n\n[Local draft — not sent]`,
                        )
                      }
                    >
                      Draft follow-up
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Picker
                    value={filingCompany}
                    onChange={async (value) => {
                      setCompany(value);
                      await update((d) => {
                        const mail = d.inbox.find((x) => x.id === m.id)!;
                        if (
                          (mail.documentIds || []).some(
                            (id) =>
                              d.documents.find((doc) => doc.id === id)
                                ?.companyId !== value,
                          )
                        )
                          throw new Error(
                            "Route attachments with their company before filing.",
                          );
                        mail.companyId = value;
                      });
                    }}
                    label="File message to company"
                    options={s.companies.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                  />
                  <div className="message-actions">
                    <Button
                      disabled={m.status === "Archived"}
                      onClick={async () =>
                        await update(
                          (d) => {
                            d.documents.unshift({
                              id: uid("doc"),
                              companyId: filingCompany,
                              name: `Correspondence — ${m.from}.txt`,
                              category: "Company records",
                              visibility: "Internal",
                              date: "2026-09-11",
                              version: 1,
                              size: "1 KB",
                              text: `DEMO CORRESPONDENCE\n\n${m.body}\n\nAttachments listed in this demo are fictional and not included.`,
                            });
                            d.inbox.find((x) => x.id === m.id)!.status =
                              "Archived";
                          },
                          "Correspondence filed",
                          companyById(s, company).name,
                        )
                      }
                    >
                      File to company
                    </Button>
                  </div>
                </>
              )}
              <p className="inline-note">
                {m.missive ? "Message text imported from Missive. Attachment download and email sending are not enabled." : connection ? "Captured correspondence. Email sending and scheduled mailbox sync are not enabled." : "Sample messages and attachments are fictional. Email sending and live mailbox sync are not connected."}
              </p>
            </>
          ) : (
            <Empty title="Select a message" />
          )}
        </section>
      </div>
      <Dialog open={draft !== null} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>Follow-up draft</DialogTitle>
            <DialogDescription>
              Review and download this draft. No email will be sent.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Follow-up draft text"
            value={draft || ""}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
          />
          <Button onClick={() => download("follow-up-draft.txt", draft || "")}>
            <Download />
            Download draft
          </Button>
        </DialogContent>
      </Dialog>
      {(capture || routing) && (
        <IntakeCapture
          message={routing ? m : undefined}
          onClose={() => {
            setCapture(false);
            setRouting(false);
          }}
          onSaved={(id) => {
            setSelected(id);
            setMsgOrder("");
          }}
        />
      )}
      {uploadFile && linked && (
        <UploadDocument
          companyId={linked.companyId}
          orderId={linked.id}
          initialRole={
            m?.kind === "Commitment" ? "Preliminary opinion" : "Final opinion"
          }
          onClose={() => setUploadFile(false)}
        />
      )}
      {previewDoc && (
        <DocumentPreview
          doc={s.documents.find((d) => d.id === previewDoc)!}
          onClose={() => setPreviewDoc("")}
        />
      )}
    </>
  );
}
export function Tasks() {
  const { s, update } = useWorkspace();
  const [filter, setFilter] = useState("Open");
  const [owner, setOwner] = useState("Everyone");
  const [newTask, setNewTask] = useState(false);
  const [waitingFor, setWaitingFor] = useState("");
  const [reason, setReason] = useState<string>(waitingReasons[0]);
  const [expanded, setExpanded] = useState("");
  const [company, setCompany] = useState(s.companies[0]?.id || "");
  const [assignee, setAssignee] = useState(s.user);
  const today = new Date().toISOString().slice(0, 10);
  const clocks = new Map(s.tasks.map((t) => [t.id, taskClock(t)]));
  const rows = s.tasks.filter((t) => {
    const clock = clocks.get(t.id)!;
    const matchesView =
      filter === "All tasks"
        ? true
        : filter === "Completed"
          ? t.done
          : filter === "Waiting"
            ? !t.done && clock.state === "Waiting"
            : filter === "Overdue"
              ? !t.done && (clock.dueInDays ?? 0) < 0
              : !t.done;
    return matchesView && (owner === "Everyone" || t.owner === owner);
  });
  const openTasks = s.tasks.filter((t) => !t.done);
  const waitingCount = openTasks.filter(
    (t) => clocks.get(t.id)!.state === "Waiting",
  ).length;
  const overdueCount = openTasks.filter(
    (t) => (clocks.get(t.id)!.dueInDays ?? 0) < 0,
  ).length;
  const activeTask = s.tasks.find((t) => t.id === waitingFor);
  const activeOpen = activeTask ? openWaiting(activeTask) : null;
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      title = String(f.get("title")).trim();
    if (!title) return;
    if (
      !(await update(
        (d) =>
          d.tasks.unshift({
            id: uid("task"),
            title,
            companyId: company,
            owner: assignee,
            due: String(f.get("due")),
            priority: "Normal",
            done: false,
            createdAt: new Date().toISOString(),
          }),
        "Task created",
        title,
      ))
    )
      return;
    setNewTask(false);
  }
  async function beginWaiting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTask) return;
    const f = new FormData(e.currentTarget);
    const input = {
      reason,
      detail: String(f.get("detail") || ""),
      since: String(f.get("since") || ""),
    };
    if (
      !(await update(
        (d) => {
          startWaiting(d, activeTask.id, input);
        },
        "Task marked waiting",
        `${activeTask.title} · ${input.reason}`,
      ))
    )
      return;
    setWaitingFor("");
  }
  async function endWaiting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTask) return;
    const f = new FormData(e.currentTarget);
    const input = {
      until: String(f.get("until") || ""),
      resolution: String(f.get("resolution") || ""),
    };
    if (
      !(await update(
        (d) => {
          resolveWaiting(d, activeTask.id, input);
        },
        "Waiting resolved",
        `${activeTask.title} · ${input.resolution}`,
      ))
    )
      return;
    setWaitingFor("");
  }
  return (
    <>
      <Heading
        title="Tasks"
        description="Clear ownership, and a visible reason whenever something is not moving."
      >
        <Button onClick={() => setNewTask(true)}>
          <Plus />
          New task
        </Button>
      </Heading>
      <div className="toolbar">
        <Segments
          value={filter}
          onChange={setFilter}
          items={["Open", "Waiting", "Overdue", "Completed", "All tasks"]}
        />
        <Picker
          value={owner}
          onChange={setOwner}
          label="Filter tasks by owner"
          options={["Everyone", "Stephenie", "Tyler", "John"]}
        />
      </div>
      {!!openTasks.length && (
        <p className="subtle task-clock-summary">
          {openTasks.length} open ·{" "}
          {overdueCount ? `${overdueCount} past due` : "none past due"} ·{" "}
          {waitingCount
            ? `${waitingCount} waiting on someone else`
            : "none waiting"}
        </p>
      )}
      <section className="panel">
        <DataTable
          headers={[
            "",
            "Task",
            "Company",
            "Owner",
            "Priority",
            "Due date",
            "Status",
            "",
          ]}
        >
          {rows.flatMap((t) => {
            const clock = clocks.get(t.id)!;
            const open = clock.openWaiting;
            const history = taskWaiting(t);
            const isOpen = expanded === t.id;
            const main = (
              <TableRow key={`${t.id}:row`} className={t.done ? "completed-row" : ""}>
                <TableCell>
                  <Checkbox
                    aria-label={`Complete ${t.title}`}
                    checked={t.done}
                    onCheckedChange={async (v) =>
                      await update(
                        (d) => {
                          d.tasks.find((x) => x.id === t.id)!.done = v === true;
                        },
                        v ? "Task completed" : "Task reopened",
                        t.title,
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <strong>{t.title}</strong>
                  {open && (
                    <span className="subtle task-waiting-note">
                      {open.reason}
                      {open.detail ? ` — ${open.detail}` : ""} ·{" "}
                      {clock.openWaitingDays} day
                      {clock.openWaitingDays === 1 ? "" : "s"}
                    </span>
                  )}
                </TableCell>
                <TableCell>{companyById(s, t.companyId).name}</TableCell>
                <TableCell>
                  <Picker
                    value={t.owner}
                    label={`Assign ${t.title}`}
                    options={["Stephenie", "Tyler", "John"]}
                    onChange={async (v) =>
                      await update(
                        (d) => {
                          d.tasks.find((x) => x.id === t.id)!.owner = v;
                        },
                        "Task reassigned",
                        `${t.title} · ${v}`,
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Status value={t.priority} />
                </TableCell>
                <TableCell>
                  {t.due}
                  {!t.done && clock.dueInDays !== null && (
                    <span className="subtle task-due-note">
                      {clock.dueInDays < 0
                        ? `${Math.abs(clock.dueInDays)} day${Math.abs(clock.dueInDays) === 1 ? "" : "s"} past due`
                        : clock.dueInDays === 0
                          ? "due today"
                          : `in ${clock.dueInDays} day${clock.dueInDays === 1 ? "" : "s"}`}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Status value={clock.state} />
                </TableCell>
                <TableCell>
                  <div className="task-actions">
                    {!t.done && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!open) setReason(waitingReasons[0]);
                          setWaitingFor(t.id);
                        }}
                      >
                        <Clock3 />
                        {open ? "Resolve waiting" : "Mark waiting"}
                      </Button>
                    )}
                    {!!history.length && (
                      <Button
                        variant="ghost"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? "" : t.id)}
                      >
                        {history.length} waiting record
                        {history.length === 1 ? "" : "s"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
            if (!isOpen || !history.length) return [main];
            return [
              main,
              <TableRow key={`${t.id}:history`}>
                <TableCell colSpan={8}>
                  <div className="task-history">
                    <p className="subtle">
                      Waited {clock.waitingDays} day
                      {clock.waitingDays === 1 ? "" : "s"} in total
                      {clock.activeDays !== null
                        ? ` · ${clock.activeDays} day${clock.activeDays === 1 ? "" : "s"} of that time the work was ours`
                        : " · age unknown for tasks saved before creation dates were recorded"}
                      .
                    </p>
                    {history.map((p) => (
                      <div key={p.id} className="task-history-row">
                        <strong>{p.reason}</strong>
                        {p.detail && <span> — {p.detail}</span>}
                        <span className="subtle">
                          {" "}
                          {p.since} → {p.until || "open"} · recorded by {p.by}
                        </span>
                        {p.until && (
                          <span className="subtle task-history-note">
                            Resolved by {p.resolvedBy}: {p.resolution}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </TableCell>
              </TableRow>,
            ];
          })}
        </DataTable>
        {!rows.length && (
          <Empty
            title={
              filter === "Open"
                ? "Nothing outstanding"
                : filter === "Waiting"
                  ? "Nothing is waiting on anyone"
                  : filter === "Overdue"
                    ? "Nothing is past due"
                    : "No tasks here"
            }
            text="Change the view or add a new task."
          />
        )}
      </section>
      <Dialog
        open={!!waitingFor}
        onOpenChange={(v) => !v && setWaitingFor("")}
      >
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>
              {activeOpen ? "Resolve waiting" : "What is this waiting on?"}
            </DialogTitle>
            <DialogDescription>
              {activeOpen
                ? "Record what unblocked this task. The waiting period stays on the task as history."
                : "Waiting time is tracked separately from the work, so a slow reply from someone else does not read as a missed deadline."}
            </DialogDescription>
          </DialogHeader>
          {activeOpen ? (
            <form className="form-stack" onSubmit={endWaiting}>
              <p className="form-note">
                Waiting on {activeOpen.reason.toLowerCase()} since{" "}
                {activeOpen.since}.
              </p>
              <FieldLabel label="Stopped waiting on">
                <Input
                  name="until"
                  type="date"
                  required
                  min={activeOpen.since}
                  max={today}
                  defaultValue={today}
                />
              </FieldLabel>
              <FieldLabel label="What unblocked it">
                <Textarea
                  name="resolution"
                  required
                  maxLength={400}
                  placeholder="The attorney sent the corrected deed."
                />
              </FieldLabel>
              <Button type="submit">Record resolution</Button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={beginWaiting}>
              <FieldLabel label="Waiting on">
                <Picker
                  value={reason}
                  onChange={setReason}
                  label="What this task is waiting on"
                  options={[...waitingReasons]}
                />
              </FieldLabel>
              <FieldLabel label="Detail">
                <Textarea
                  name="detail"
                  maxLength={400}
                  placeholder="Who, and what you asked them for. Required when the reason is Other."
                />
              </FieldLabel>
              <FieldLabel label="Waiting since">
                <Input
                  name="since"
                  type="date"
                  required
                  max={today}
                  defaultValue={today}
                />
              </FieldLabel>
              <Button type="submit">Mark waiting</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={newTask} onOpenChange={setNewTask}>
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              Give the next step a clear owner.
            </DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={create}>
            <FieldLabel label="Task">
              <Input
                name="title"
                required
                maxLength={180}
                placeholder="What needs to happen?"
              />
            </FieldLabel>
            <FieldLabel label="Company">
              <Picker
                value={company}
                onChange={setCompany}
                label="Task company"
                options={s.companies.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </FieldLabel>
            <div className="form-grid">
              <FieldLabel label="Owner">
                <Picker
                  value={assignee}
                  onChange={setAssignee}
                  label="Task owner"
                  options={["Stephenie", "Tyler", "John"]}
                />
              </FieldLabel>
              <FieldLabel label="Due date">
                <Input
                  name="due"
                  type="date"
                  defaultValue="2026-09-15"
                  required
                />
              </FieldLabel>
            </div>
            <Button type="submit">Create task</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function Automations() {
  const { s, update } = useWorkspace();
  const [result, setResult] = useState("");
  async function run(ids: string[]) {
    const copy = structuredClone(s);
    const count = executeRules(copy, ids);
    if (
      !(await update(
        (d) => {
          executeRules(d, ids);
        },
        "Demo automations completed",
        `${count} records updated`,
      ))
    )
      return;
    setResult(
      count
        ? `${count} records updated. The inbox and task list now reflect this run.`
        : "Everything is up to date. No duplicate work was created.",
    );
  }
  return (
    <>
      <Heading
        title="Automations"
        description="Let routine work take care of itself."
      >
        <Button
          onClick={() => run(s.rules.filter((r) => r.enabled).map((r) => r.id))}
          disabled={!s.rules.some((r) => r.enabled)}
        >
          <Play />
          Run enabled rules
        </Button>
      </Heading>
      <div className="notice">
        <Workflow size={18} />
        <p>
          These rules run on local demo records when you press Run. Scheduled
          execution and external services will be connected later.
        </p>
      </div>
      {result && (
        <div className="notice success">
          <CheckCheck size={18} />
          <p>{result}</p>
        </div>
      )}
      <div className="automation-grid">
        {s.rules.map((r) => (
          <section className="panel automation-card" key={r.id}>
            <div className="automation-top">
              <span className="automation-icon">
                <Workflow size={23} />
              </span>
              <Switch
                checked={r.enabled}
                aria-label={`Enable ${r.name}`}
                onCheckedChange={async (v) =>
                  await update(
                    (d) => {
                      d.rules.find((x) => x.id === r.id)!.enabled = v;
                    },
                    v ? "Automation enabled" : "Automation paused",
                    r.name,
                  )
                }
              />
            </div>
            <h2>{r.name}</h2>
            <p>{r.description}</p>
            <div className="automation-flow">
              <span>{r.trigger}</span>
              <ArrowRight size={15} />
              <span>{r.action}</span>
            </div>
            <div className="automation-footer">
              <span>
                {r.runs} runs
                {r.lastRun !== "Never" && (
                  <small>
                    Last run{" "}
                    {new Date(r.lastRun).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!r.enabled}
                onClick={() => run([r.id])}
              >
                <Play />
                Run demo
              </Button>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
