"use client";
import { BufferedInput, BufferedTextarea } from "./buffered-input";
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
  type Workspace,
} from "@/lib/title/model";
import {
  titleFile,
  orderSources,
  approveReplyDraft,
  createRevision,
  applyRevision,
  recheckRevision,
  createFieldRevision,
  applyFieldRevision,
  recheckFieldRevision,
  revisableFields,
  revisableFieldLabel,
  type RevisionRequest,
  type FieldRevision,
  type RevisableField,
  type ReplyDraft,
} from "@/lib/title/production";
import { UploadDocument, DocumentPreview } from "./documents";

function orderLoans(s: Workspace, orderId: string) {
  return (s.business?.policies || []).filter(
    (p) => p.orderId === orderId && p.kind === "Loan" && p.status !== "Void",
  );
}
function revisionLoanLabel(s: Workspace, r: RevisionRequest) {
  if (!r.productId) return "";
  const p = s.business?.policies.find((x) => x.id === r.productId);
  return p ? p.loanReference || "Loan" : "";
}
/**
 * Loan-amount and field revisions are separate record types (see
 * production.ts), but the operator sees one request queue. Newest first
 * across both kinds.
 */
type AnyRequest =
  { kind: "amount"; r: RevisionRequest } | { kind: "field"; r: FieldRevision };
function allRequests(s: Workspace): AnyRequest[] {
  return [
    ...s.revisions.map((r) => ({ kind: "amount" as const, r })),
    ...(s.fieldRevisions || []).map((r) => ({ kind: "field" as const, r })),
  ].sort((a, b) => b.r.createdAt.localeCompare(a.r.createdAt));
}
function requestLabel(s: Workspace, x: AnyRequest) {
  return x.kind === "amount"
    ? revisionLoanLabel(s, x.r) || "Loan amount revision"
    : `${revisableFieldLabel(x.r.field)} revision`;
}

export function Revisions({
  messageId,
  onOpen,
}: {
  messageId: string;
  onOpen: (id: string) => void;
}) {
  const { s } = useWorkspace();
  const [tab, setTab] = useState("Requests");
  const requests = allRequests(s);
  const [selected, setSelected] = useState(
    requests.find((x) => x.r.messageId === messageId)?.r.id ||
      requests[0]?.r.id ||
      "",
  );
  const [create, setCreate] = useState(
    !!messageId && !requests.some((x) => x.r.messageId === messageId),
  );
  const message = s.inbox.find((m) => m.id === messageId);
  const request = requests.find((x) => x.r.id === selected) || requests[0];
  const waiting = requests.filter((x) => x.r.status === "Needs review").length;
  const prepared = requests.filter((x) => x.r.status === "Applied").length;
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
          value={String(waiting)}
          detail="Company and source confirmation"
        />
        <Metric
          label="Changes prepared"
          value={String(prepared)}
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
        (requests.length ? (
          <div className="revision-layout">
            <aside className="panel revision-list">
              {requests.map((x) => (
                <button
                  key={x.r.id}
                  className={x.r.id === request?.r.id ? "selected" : ""}
                  onClick={() => setSelected(x.r.id)}
                >
                  <small>{companyById(s, x.r.companyId).name}</small>
                  <strong>{x.r.orderId}</strong>
                  <span>{requestLabel(s, x)}</span>
                  <Status value={x.r.status} />
                </button>
              ))}
            </aside>
            {request?.kind === "amount" && (
              <RevisionDetail
                key={request.r.id + ":" + request.r.baseVersion}
                request={request.r}
                onOpen={onOpen}
                onDraft={() => setTab("Reply drafts")}
              />
            )}
            {request?.kind === "field" && (
              <FieldRevisionDetail
                key={request.r.id + ":" + request.r.baseVersion}
                request={request.r}
                onOpen={onOpen}
                onDraft={() => setTab("Reply drafts")}
              />
            )}
          </div>
        ) : (
          <Empty
            title="Start with a revision request"
            text="Choose the company and file, capture the requested loan amount or commitment field change, then review it."
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
            requests.some((x) => x.r.messageId === messageId)
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
    matched?.companyId || s.companies[0]?.id || "",
  );
  const [order, setOrder] = useState(matched?.id || "none");
  const [text, setText] = useState(message?.body || "");
  const [amount, setAmount] = useState(
    message?.id === "tyler-revision-demo" ? "340000" : "",
  );
  const [productId, setProductId] = useState("none");
  // "amount" keeps the original loan-amount flow; any other value is one of
  // the commitment fields a field revision can change (see revisableFields).
  const [kind, setKind] = useState<"amount" | RevisableField>("amount");
  const [proposedText, setProposedText] = useState("");
  const isAmount = kind === "amount";
  const eligible = s.orders.filter(
    (o) =>
      o.companyId === company &&
      !["Issued", "Rejected"].includes(o.status) &&
      (!isAmount || titleFile(o).financing === "Financed"),
  );
  const selectedOrder = eligible.find((o) => o.id === order);
  const loans = orderLoans(s, order);
  const needsLoanChoice = isAmount && loans.length > 1;
  const kindOptions = [
    { value: "amount", label: "Loan amount" },
    ...revisableFields
      // A cash file has no lender to revise.
      .filter(
        (f) =>
          f.id !== "lender" ||
          !selectedOrder ||
          titleFile(selectedOrder).financing === "Financed",
      )
      .map((f) => ({ value: f.id, label: f.label })),
  ];
  const currentValue =
    !isAmount && selectedOrder ? titleFile(selectedOrder)[kind] : "";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let id = "";
    if (
      await update(
        (d) => {
          const r = isAmount
            ? createRevision(d, {
                companyId: company,
                orderId: order,
                messageId: message?.id || "",
                text,
                proposed: Number(amount),
                productId: needsLoanChoice ? productId : undefined,
              })
            : createFieldRevision(d, {
                companyId: company,
                orderId: order,
                messageId: message?.id || "",
                text,
                field: kind,
                proposed: proposedText,
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
                setProductId("none");
              }}
              options={s.companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FieldLabel>
          <FieldLabel label="Matching file">
            <Picker
              value={order}
              label="Revision file"
              onChange={(v) => {
                setOrder(v);
                setProductId("none");
              }}
              options={[
                { value: "none", label: "Select the exact file" },
                ...eligible.map((o) => ({
                  value: o.id,
                  label: `${o.id} · ${o.address}`,
                })),
              ]}
            />
          </FieldLabel>
          <FieldLabel label="What is changing">
            <Picker
              value={kind}
              label="Revision kind"
              onChange={(v) => {
                setKind(v as "amount" | RevisableField);
                setProposedText("");
                setProductId("none");
                // A cash file is eligible for a field change but not a
                // loan-amount one; drop a selection that no longer qualifies.
                if (
                  v === "amount" &&
                  selectedOrder &&
                  titleFile(selectedOrder).financing !== "Financed"
                )
                  setOrder("none");
              }}
              options={kindOptions}
            />
          </FieldLabel>
          {!isAmount && (
            <>
              {selectedOrder && (
                <p className="inline-note">
                  Currently on file:{" "}
                  {currentValue ? (
                    <strong>{currentValue}</strong>
                  ) : (
                    "not recorded"
                  )}
                </p>
              )}
              <FieldLabel
                label={`Requested ${revisableFieldLabel(kind).toLowerCase()}`}
              >
                {kind === "legalDescription" ? (
                  <Textarea
                    aria-label="Requested value"
                    rows={4}
                    value={proposedText}
                    onChange={(e) => setProposedText(e.target.value)}
                    required
                    maxLength={5000}
                  />
                ) : (
                  <Input
                    aria-label="Requested value"
                    type={kind === "attorneyEmail" ? "email" : "text"}
                    value={proposedText}
                    onChange={(e) => setProposedText(e.target.value)}
                    required
                    maxLength={500}
                  />
                )}
              </FieldLabel>
            </>
          )}
          {needsLoanChoice && (
            <FieldLabel label="Which loan">
              <Picker
                value={productId}
                label="Revision loan"
                onChange={setProductId}
                options={[
                  { value: "none", label: "Select the exact loan" },
                  ...loans.map((l) => ({
                    value: l.id,
                    label: `${l.loanReference || "Loan"} · ${moneyCents(l.loanAmount)}`,
                  })),
                ]}
              />
            </FieldLabel>
          )}
          {isAmount && (
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
          )}
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
            Loan amount and the listed commitment fields (lender, seller, legal
            description, county, attorney) can be revised here. Coverage,
            endorsements and policy-form changes still require a separate
            professional review.
          </p>
          <Button
            disabled={
              order === "none" ||
              (needsLoanChoice && productId === "none") ||
              (!isAmount && !proposedText.trim())
            }
            type="submit"
          >
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
  const loans = orderLoans(s, order.id);
  // Resolve the loan from the request's own stored productId — never from
  // how many loans happen to be active right now — mirroring
  // resolveRevisionTarget in production.ts. A request whose named loan was
  // voided shows as missing instead of silently pointing at the survivor.
  const targetLoan = r.productId
    ? loans.find((l) => l.id === r.productId)
    : loans.length === 1
      ? loans[0]
      : undefined;
  const targetMissing =
    (!!r.productId && !targetLoan) || (!r.productId && loans.length > 1);
  const currentAmount = targetLoan ? targetLoan.loanAmount : file.loanAmount;
  // Stale if the file's commitment version moved OR the named loan itself
  // changed since capture — the same two checks applyRevision makes.
  const stale =
    !targetMissing &&
    r.status !== "Applied" &&
    (file.version !== r.baseVersion ||
      (!!targetLoan && targetLoan.version !== r.productVersion));
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
        {r.productId &&
          ` Loan: ${targetLoan?.loanReference || (targetMissing ? "no longer active" : "Loan")}.`}
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
      {targetMissing && r.status === "Needs review" && (
        <div className="notice warning">
          <p>
            {r.productId
              ? "The loan this revision named is no longer active on this file (it may have been voided). Hold this request for clarification and capture a new one for the current loans."
              : "This file now has more than one active loan, so this older request no longer says which one it applies to. Hold it for clarification and capture a new request naming the loan."}
          </p>
        </div>
      )}
      {stale && (
        <div className="notice warning">
          <p>
            {targetLoan ? "This loan" : "The file"} changed after this request
            was captured. Current loan amount: {moneyCents(currentAmount)}.
            Recheck the request against the current file.
          </p>
          <Button
            variant="outline"
            onClick={async () =>
              await update(
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
              disabled={!oCheck || !sCheck || stale || targetMissing}
              onClick={async () => {
                if (
                  await update(
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
            onClick={async () =>
              await update(
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
              onClick={async () =>
                await update(
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
function FieldRevisionDetail({
  request: r,
  onOpen,
  onDraft,
}: {
  request: FieldRevision;
  onOpen: (id: string) => void;
  onDraft: () => void;
}) {
  const { s, update } = useWorkspace();
  const [oCheck, setOCheck] = useState(false);
  const [sCheck, setSCheck] = useState(false);
  const [note, setNote] = useState(r.note);
  const order = s.orders.find((o) => o.id === r.orderId)!;
  const file = titleFile(order);
  const label = revisableFieldLabel(r.field);
  const current = file[r.field] || "";
  const stale =
    r.status !== "Applied" &&
    (file.version !== r.baseVersion || current !== r.before);
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
        version {file.version}. Field: {label}.
      </p>
      <div className="revision-diff text">
        <div>
          <small>{label} recorded at capture</small>
          <strong>{r.before || "Not recorded"}</strong>
        </div>
        <ArrowRight />
        <div>
          <small>Requested {label.toLowerCase()}</small>
          <strong>{r.proposed}</strong>
        </div>
      </div>
      <div className="request-original">
        <h3>Source instruction</h3>
        <p>{r.text}</p>
      </div>
      {stale && (
        <div className="notice warning">
          <p>
            The file changed after this request was captured. Current{" "}
            {label.toLowerCase()}: {current || "not recorded"}. Recheck the
            request against the current file.
          </p>
          <Button
            variant="outline"
            onClick={async () =>
              await update(
                (d) => recheckFieldRevision(d, r.id),
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
              I verified this {label.toLowerCase()} instruction against the
              source.
            </label>
          </div>
          <div className="source-actions">
            <Button
              disabled={!oCheck || !sCheck || stale}
              onClick={async () => {
                if (
                  await update(
                    (d) => applyFieldRevision(d, r.id, oCheck && sCheck),
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
            onClick={async () =>
              await update(
                (d) => {
                  const item = d.fieldRevisions.find((x) => x.id === r.id)!;
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
              onClick={async () =>
                await update(
                  (d) => recheckFieldRevision(d, r.id),
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
        Applying changes only the demo title file and prepares a reply draft.
        Captured deed and deed-of-trust field reviews are kept; the file's
        commitment version advances so earlier outputs and drafts go stale. No
        external record or message is changed.
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
  async function edit(
    field: "to" | "subject" | "body" | "attachmentId",
    value: string,
  ) {
    await update((s) => {
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
          <BufferedInput
            aria-label={`Recipient for ${draft.id}`}
            type="email"
            value={draft.to}
            onCommit={(value) => edit("to", value)}
          />
        </FieldLabel>
        <FieldLabel label="Subject">
          <BufferedInput
            value={draft.subject}
            onCommit={(value) => edit("subject", value)}
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Reply draft">
        <BufferedTextarea
          rows={7}
          value={draft.body}
          onCommit={(value) => edit("body", value)}
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
          onClick={async () =>
            await update(
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
