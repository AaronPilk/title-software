"use client";
import { useState } from "react";
import {
  Plus,
  ArrowRight,
  CheckCheck,
  Mail,
  FileText,
  Download,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Heading,
  Picker,
  Segments,
  Status,
  Empty,
  FieldLabel,
  Metric,
} from "./shared";
import { useWorkspace, download } from "@/lib/title/store";
import {
  companyById,
  moneyCents,
  type Mail as MailRecord,
} from "@/lib/title/model";
import {
  titleFile,
  orderSources,
  approveReplyDraft,
  createRevision,
  applyRevision,
  recheckRevision,
  type RevisionRequest,
  type ReplyDraft,
} from "@/lib/title/production";
import { UploadDocument, DocumentPreview } from "./documents";

export function Revisions({
  messageId,
  onOpen,
}: {
  messageId: string;
  onOpen: (id: string) => void;
}) {
  const { s } = useWorkspace();
  const [tab, setTab] = useState("Requests");
  const [selected, setSelected] = useState(
    s.revisions.find((r) => r.messageId === messageId)?.id ||
      s.revisions[0]?.id ||
      "",
  );
  const [create, setCreate] = useState(
    !!messageId && !s.revisions.some((r) => r.messageId === messageId),
  );
  const message = s.inbox.find((m) => m.id === messageId);
  const request = s.revisions.find((r) => r.id === selected) || s.revisions[0];
  return (
    <>
      <Heading
        title="Revisions"
        description="The right company. The right file. A reviewed change."
      >
        <Button onClick={() => setCreate(true)}>
          <Plus />
          New revision
        </Button>
      </Heading>
      <div className="metrics revision-metrics">
        <Metric
          label="Waiting for review"
          value={String(
            s.revisions.filter((r) => r.status === "Needs review").length,
          )}
          detail="Company and source confirmation"
        />
        <Metric
          label="Changes prepared"
          value={String(
            s.revisions.filter((r) => r.status === "Applied").length,
          )}
          detail="Applied to local demo records"
        />
        <Metric
          label="Reply drafts"
          value={String(s.replyDrafts.length)}
          detail="Reviewed before any future sending"
        />
      </div>
      <div className="toolbar">
        <Segments
          value={tab}
          onChange={setTab}
          items={["Requests", "Reply drafts"]}
        />
        <span className="subtle-pill">SoftPro & Missive disconnected</span>
      </div>
      {tab === "Requests" &&
        (s.revisions.length ? (
          <div className="revision-layout">
            <aside className="panel revision-list">
              {s.revisions.map((r) => (
                <button
                  key={r.id}
                  className={r.id === request?.id ? "selected" : ""}
                  onClick={() => setSelected(r.id)}
                >
                  <small>{companyById(s, r.companyId).name}</small>
                  <strong>{r.orderId}</strong>
                  <span>Loan amount revision</span>
                  <Status value={r.status} />
                </button>
              ))}
            </aside>
            {request && (
              <RevisionDetail
                key={request.id + ":" + request.baseVersion}
                request={request}
                onOpen={onOpen}
                onDraft={() => setTab("Reply drafts")}
              />
            )}
          </div>
        ) : (
          <Empty
            title="Start with a revision request"
            text="Choose the company and file, capture the requested loan amount, then review the change."
            action={
              <Button onClick={() => setCreate(true)}>
                <Plus />
                Capture request
              </Button>
            }
          />
        ))}
      {tab === "Reply drafts" &&
        (s.replyDrafts.length ? (
          <div className="reply-drafts">
            {s.replyDrafts.map((d) => (
              <DraftCard key={d.id} draft={d} />
            ))}
          </div>
        ) : (
          <Empty
            title="No reply drafts yet"
            text="Applying a reviewed revision prepares a local reply. The revised commitment must be generated through the approved SoftPro workflow."
          />
        ))}
      {create && (
        <NewRevision
          message={
            s.revisions.some((r) => r.messageId === messageId)
              ? undefined
              : message
          }
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            setSelected(id);
            setTab("Requests");
            setCreate(false);
          }}
        />
      )}
    </>
  );
}
function NewRevision({
  message,
  onClose,
  onCreated,
}: {
  message?: MailRecord;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { s, update } = useWorkspace();
  const matched = s.orders.find((o) => o.id === message?.orderId);
  const [company, setCompany] = useState(
    matched?.companyId || s.companies[0].id,
  );
  const [order, setOrder] = useState(matched?.id || "none");
  const [text, setText] = useState(message?.body || "");
  const [amount, setAmount] = useState(
    message?.id === "tyler-revision-demo" ? "340000" : "",
  );
  const eligible = s.orders.filter(
    (o) =>
      o.companyId === company &&
      !["Issued", "Rejected"].includes(o.status) &&
      titleFile(o).financing === "Financed",
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let id = "";
    if (
      update(
        (d) => {
          const r = createRevision(d, {
            companyId: company,
            orderId: order,
            messageId: message?.id || "",
            text,
            proposed: Number(amount),
          });
          id = r.id;
          if (message)
            d.inbox.find((m) => m.id === message.id)!.status = "Queued";
        },
        "Revision request captured",
        order,
      )
    )
      onCreated(id);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>Capture revision request</DialogTitle>
          <DialogDescription>
            Match the JV first, then the file. This captures an instruction for
            review; it does not change SoftPro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <FieldLabel label="Company / SoftPro profile">
            <Picker
              value={company}
              label="Revision company"
              onChange={(v) => {
                setCompany(v);
                setOrder("none");
              }}
              options={s.companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FieldLabel>
          <FieldLabel label="Matching file">
            <Picker
              value={order}
              label="Revision file"
              onChange={setOrder}
              options={[
                { value: "none", label: "Select the exact file" },
                ...eligible.map((o) => ({
                  value: o.id,
                  label: `${o.id} · ${o.address}`,
                })),
              ]}
            />
          </FieldLabel>
          <FieldLabel label="Requested loan amount ($)">
            <Input
              type="number"
              min=".01"
              max="100000000"
              step=".01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </FieldLabel>
          <FieldLabel label="Original request">
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={10000}
            />
          </FieldLabel>
          <p className="form-note">
            Only a loan-amount revision is supported here. Legal wording,
            coverage, and other changes require a separate professional review.
          </p>
          <Button disabled={order === "none"} type="submit">
            Create review request
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function RevisionDetail({
  request: r,
  onOpen,
  onDraft,
}: {
  request: RevisionRequest;
  onOpen: (id: string) => void;
  onDraft: () => void;
}) {
  const { s, update } = useWorkspace();
  const [oCheck, setOCheck] = useState(false);
  const [sCheck, setSCheck] = useState(false);
  const [note, setNote] = useState(r.note);
  const order = s.orders.find((o) => o.id === r.orderId)!;
  const file = titleFile(order);
  const stale = file.version !== r.baseVersion && r.status !== "Applied";
  return (
    <section className="panel revision-review">
      <div className="source-summary">
        <div>
          <p className="eyebrow">
            {companyById(s, r.companyId).name} / {r.orderId}
          </p>
          <h2>{order.address}</h2>
        </div>
        <Status value={r.status} />
      </div>
      <p className="inline-note">
        Destination: {companyById(s, r.companyId).name} → {r.orderId}. File
        version {file.version}.
      </p>
      <div className="revision-diff">
        <div>
          <small>Recorded at capture</small>
          <strong>{moneyCents(r.before)}</strong>
        </div>
        <ArrowRight />
        <div>
          <small>Requested loan amount</small>
          <strong>{moneyCents(r.proposed)}</strong>
        </div>
      </div>
      <div className="request-original">
        <h3>Source instruction</h3>
        <p>{r.text}</p>
      </div>
      {stale && (
        <div className="notice warning">
          <p>
            The file changed after this request was captured. Current loan
            amount: {moneyCents(file.loanAmount)}. Recheck the request against
            the current file.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              update(
                (d) => recheckRevision(d, r.id),
                "Revision comparison refreshed",
                r.orderId,
              )
            }
          >
            <RefreshCw />
            Refresh comparison
          </Button>
        </div>
      )}
      {r.status === "Needs review" && (
        <>
          <div className="revision-confirmations">
            <label>
              <Checkbox
                checked={oCheck}
                onCheckedChange={(v) => setOCheck(v === true)}
              />
              I confirmed the company, file number, and property.
            </label>
            <label>
              <Checkbox
                checked={sCheck}
                onCheckedChange={(v) => setSCheck(v === true)}
              />
              I verified this loan-amount instruction against the source.
            </label>
          </div>
          <div className="source-actions">
            <Button
              disabled={!oCheck || !sCheck || stale}
              onClick={() => {
                if (
                  update(
                    (d) => applyRevision(d, r.id, oCheck && sCheck),
                    "Reviewed revision applied locally",
                    r.orderId,
                  )
                )
                  onDraft();
              }}
            >
              <CheckCheck />
              Apply reviewed change
            </Button>
            <Button variant="outline" onClick={() => onOpen(order.id)}>
              Open title file
            </Button>
          </div>
        </>
      )}
      {r.status === "Applied" ? (
        <div className="notice success">
          <CheckCheck size={18} />
          <div>
            <strong>Local change prepared</strong>
            <p>
              The official commitment still needs to be regenerated in SoftPro.
              Attach it to the prepared reply for review.
            </p>
            <Button variant="outline" onClick={onDraft}>
              Open reply drafts
              <ArrowRight />
            </Button>
          </div>
        </div>
      ) : (
        <div className="revision-question">
          <FieldLabel label="Clarification needed">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain a missing instruction or mismatch…"
            />
          </FieldLabel>
          <Button
            variant="ghost"
            disabled={!note.trim()}
            onClick={() =>
              update(
                (d) => {
                  const item = d.revisions.find((x) => x.id === r.id)!;
                  item.note = note;
                  item.status = "Needs information";
                },
                "Revision needs information",
                r.orderId,
              )
            }
          >
            Hold for clarification
          </Button>
          {r.status === "Needs information" && (
            <Button
              variant="outline"
              onClick={() =>
                update(
                  (d) => recheckRevision(d, r.id),
                  "Revision reopened",
                  r.orderId,
                )
              }
            >
              Reopen review
            </Button>
          )}
        </div>
      )}
      <p className="form-note">
        Applying changes only the demo file, invalidates prior field reviews,
        and prepares a reply draft. No external record or message is changed.
      </p>
    </section>
  );
}
function DraftCard({ draft }: { draft: ReplyDraft }) {
  const { s, update } = useWorkspace();
  const [upload, setUpload] = useState(false);
  const [preview, setPreview] = useState(false);
  const order = s.orders.find((o) => o.id === draft.orderId)!;
  const docs = orderSources(s, order.id).filter(
    (d) =>
      d.companyId === order.companyId &&
      d.sourceRole === "Revised commitment" &&
      d.productionVersion === draft.fileVersion,
  );
  const attached = docs.find((d) => d.id === draft.attachmentId);
  const stale = draft.fileVersion !== titleFile(order).version;
  const canApprove =
    !!attached &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to) &&
    !!draft.subject.trim() &&
    !!draft.body.trim() &&
    !stale;
  function edit(
    field: "to" | "subject" | "body" | "attachmentId",
    value: string,
  ) {
    update((s) => {
      const d = s.replyDrafts.find((x) => x.id === draft.id)!;
      d[field] = value;
      d.status = (field === "attachmentId" ? value : d.attachmentId)
        ? "Ready for review"
        : "Awaiting document";
    });
  }
  return (
    <section className="panel draft-card">
      <div className="source-summary">
        <div>
          <p className="eyebrow">
            {companyById(s, order.companyId).name} / {order.id}
          </p>
          <h2>Revised commitment reply</h2>
        </div>
        <Status value={stale ? "Source changed" : draft.status} />
      </div>
      <div className="form-grid">
        <FieldLabel label="To">
          <Input
            aria-label={`Recipient for ${draft.id}`}
            type="email"
            value={draft.to}
            onChange={(e) => edit("to", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Subject">
          <Input
            value={draft.subject}
            onChange={(e) => edit("subject", e.target.value)}
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Reply draft">
        <Textarea
          rows={7}
          value={draft.body}
          onChange={(e) => edit("body", e.target.value)}
        />
      </FieldLabel>
      <div className="draft-attachment">
        <FileText size={20} />
        <div>
          <strong>Revised commitment from SoftPro</strong>
          <p>
            Generate the approved document in SoftPro, then attach a sample or
            redacted copy here.
          </p>
        </div>
        <Button variant="outline" onClick={() => setUpload(true)}>
          <UploadIcon />
          Upload copy
        </Button>
      </div>
      <Picker
        value={draft.attachmentId || "none"}
        onChange={(v) => edit("attachmentId", v === "none" ? "" : v)}
        label={`Revised commitment attachment for ${order.id}`}
        options={[
          { value: "none", label: "Awaiting revised commitment" },
          ...docs.map((d) => ({
            value: d.id,
            label: `${d.name} · v${d.version}`,
          })),
        ]}
      />
      {stale && (
        <p className="notice warning">
          The title file changed after this draft was prepared. Capture and
          review a fresh revision before approving a replacement reply.
        </p>
      )}
      <div className="source-actions">
        {attached && (
          <Button variant="outline" onClick={() => setPreview(true)}>
            Preview attachment
          </Button>
        )}
        <Button
          disabled={!canApprove || draft.status === "Approved locally"}
          onClick={() =>
            update(
              (s) => approveReplyDraft(s, draft.id),
              "Reply approved locally",
              order.id,
            )
          }
        >
          <CheckCheck />
          {draft.status === "Approved locally"
            ? "Approved locally"
            : "Approve local draft"}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            download(
              `${order.id}-reply-draft.txt`,
              `LOCAL DRAFT — NOT SENT\nStatus: ${stale || !attached ? "Review required — file or attachment changed" : draft.status}\nTo: ${draft.to}\nSubject: ${draft.subject}\nAttachment: ${attached?.name || "MISSING — generate in SoftPro"}\n${stale ? "OBSOLETE DRAFT: Recheck the current title file and prepare a new revision reply.\n" : ""}\n${draft.body}`,
            )
          }
        >
          <Download />
          Export draft
        </Button>
      </div>
      <p className="form-note">
        This approval records an internal review only. Missive sending is not
        connected. The text export does not include the attachment; download the
        file from its preview.
      </p>
      {upload && (
        <UploadDocument
          orderId={order.id}
          companyId={order.companyId}
          initialRole="Revised commitment"
          onClose={() => setUpload(false)}
        />
      )}
      {preview && attached && (
        <DocumentPreview doc={attached} onClose={() => setPreview(false)} />
      )}
    </section>
  );
}
function UploadIcon() {
  return <Plus size={16} />;
}
