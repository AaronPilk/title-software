"use client";
import { useState } from "react";
import { Download, ClipboardCheck, Ban, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace, download } from "@/lib/title/store";
import { moneyCents as money } from "@/lib/title/model";
import type { ClosePeriod } from "@/lib/title/business";
import {
  statementDeliveries,
  statementDeliveryCurrent,
  statementDeliveryText,
  prepareStatementDelivery,
  recordStatementDelivery,
  cancelStatementDelivery,
  type StatementDelivery,
} from "@/lib/title/statement-delivery";
import { Picker, FieldLabel } from "./shared";

const today = () => new Date().toISOString().slice(0, 10);
const stamp = (iso: string) => (iso ? iso.slice(0, 10) : "");

/**
 * The visible state of a delivery record. "Source changed" is a Prepared
 * record whose published statement no longer matches what was frozen at
 * preparation (withdrawn, superseded, re-reviewed) — it can only be
 * cancelled, never downloaded or recorded as delivered against.
 */
function deliveryState(
  s: ReturnType<typeof useWorkspace>["s"],
  d: StatementDelivery,
) {
  if (d.status === "Prepared" && !statementDeliveryCurrent(s, d))
    return { label: "Source changed", color: "amber" } as const;
  return {
    Prepared: { label: "Prepared", color: "blue" },
    Recorded: { label: "Recorded", color: "green" },
    Cancelled: { label: "Cancelled", color: "neutral" },
  }[d.status] as { label: string; color: string };
}

/**
 * Manual statement delivery register for one close revision (J05). This
 * records that a person delivered a published member statement by hand —
 * it never sends anything. Exporting the statement text and recording the
 * actual delivery are deliberately separate steps: a download is not a
 * delivery. Every record freezes the member, recipient and revision figures
 * it was prepared against, so later close revisions can't quietly change
 * what a past record says was delivered.
 */
export function StatementDeliveries({ period }: { period: ClosePeriod }) {
  const { s, update } = useWorkspace();
  const records = statementDeliveries(s, period.companyId)
    .filter((d) => d.closeId === period.id)
    .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
  const canPrepare =
    period.status === "Published" && period.allocations.length > 0;
  return (
    <section className="panel business-panel delivery-register">
      <h2>Statement delivery register</h2>
      <p>
        Record manual delivery of this revision's published member statements.
        Nothing here sends an email; the app only keeps the evidence of a
        delivery someone made.
      </p>
      {canPrepare ? (
        <PrepareDelivery period={period} />
      ) : (
        <p className="inline-note">
          {period.status === "Published"
            ? "No member allocations are captured on this revision."
            : `This revision is ${period.status.toLowerCase()}; new deliveries are prepared from the currently published revision. Records prepared against this revision stay listed below.`}
        </p>
      )}
      {records.length > 0 && (
        <div className="delivery-list">
          {records.map((d) => (
            <DeliveryCard key={d.id} delivery={d} />
          ))}
        </div>
      )}
      {!records.length && (
        <p className="form-note">No delivery records for this revision yet.</p>
      )}
    </section>
  );
}

function PrepareDelivery({ period }: { period: ClosePeriod }) {
  const { update } = useWorkspace();
  const [memberName, setMemberName] = useState(
    period.allocations[0]?.name || "",
  );
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const allocation = period.allocations.find((a) => a.name === memberName);
  const ready =
    !!allocation &&
    !!recipientName.trim() &&
    !!recipientEmail.trim() &&
    !!reviewNote.trim() &&
    confirmed;
  return (
    <div className="form-stack delivery-prepare">
      <h3>Prepare a delivery record</h3>
      <div className="form-grid">
        <FieldLabel label="Member statement">
          <Picker
            value={memberName}
            label="Delivery member"
            onChange={(v) => {
              setMemberName(v);
              setConfirmed(false);
            }}
            options={period.allocations.map((a) => ({
              value: a.name,
              label: `${a.name} · ${a.share}% · ${money(a.amount)}`,
            }))}
          />
        </FieldLabel>
        <FieldLabel label="Recipient name">
          <Input
            aria-label="Delivery recipient name"
            value={recipientName}
            maxLength={120}
            onChange={(e) => {
              setRecipientName(e.target.value);
              setConfirmed(false);
            }}
            placeholder="Who receives this statement"
          />
        </FieldLabel>
        <FieldLabel label="Recipient email">
          <Input
            aria-label="Delivery recipient email"
            type="email"
            value={recipientEmail}
            onChange={(e) => {
              setRecipientEmail(e.target.value);
              setConfirmed(false);
            }}
            placeholder="name@example.com"
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Review note">
        <Textarea
          aria-label="Delivery review note"
          rows={2}
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder="What you checked before preparing this statement for delivery"
        />
      </FieldLabel>
      <label className="delivery-confirm">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
          aria-label="I reviewed the member, recipient and published figures"
        />
        <span>
          I reviewed the member, recipient and the published figures
          {allocation ? ` (${money(allocation.amount)})` : ""} for this
          statement.
        </span>
      </label>
      <div className="source-actions">
        <Button
          disabled={!ready}
          onClick={async () => {
            if (
              await update(
                (d) =>
                  prepareStatementDelivery(d, {
                    companyId: period.companyId,
                    closeId: period.id,
                    memberName,
                    recipientName: recipientName.trim(),
                    recipientEmail: recipientEmail.trim(),
                    reviewNote: reviewNote.trim(),
                    confirmed,
                  }),
                "Statement delivery prepared",
                `${period.companyName} · ${memberName} · v${period.revision}`,
              )
            ) {
              setRecipientName("");
              setRecipientEmail("");
              setReviewNote("");
              setConfirmed(false);
            }
          }}
        >
          <FileCheck2 />
          Prepare delivery record
        </Button>
      </div>
      <p className="form-note">
        Preparation freezes the member, recipient and figures. To change the
        recipient afterward, cancel the record and prepare a new one.
      </p>
    </div>
  );
}

function DeliveryCard({ delivery: d }: { delivery: StatementDelivery }) {
  const { s, update } = useWorkspace();
  const state = deliveryState(s, d);
  const current = d.status === "Prepared" && statementDeliveryCurrent(s, d);
  const [deliveredOn, setDeliveredOn] = useState(today());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const canDownload = current || d.status === "Recorded";
  function exportStatement() {
    try {
      download(
        `${d.snapshot.companyId}-${d.snapshot.month}-v${d.snapshot.revision}-${d.memberName.replace(/[^a-z0-9]+/gi, "-")}-statement.txt`,
        statementDeliveryText(s, d.id),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "This statement can no longer be exported.",
      );
    }
  }
  return (
    <article className="delivery-card" data-state={state.label}>
      <div className="delivery-head">
        <div>
          <strong>{d.memberName}</strong>
          <small>
            {d.snapshot.month} · Revision {d.snapshot.revision} ·{" "}
            {d.snapshot.share}% · {money(d.snapshot.amount)}
          </small>
        </div>
        <span className={`status ${state.color}`}>{state.label}</span>
      </div>
      <div className="detail-grid">
        <div>
          <small>Recipient</small>
          <strong>
            {d.recipientName} · {d.recipientEmail}
          </strong>
        </div>
        <div>
          <small>Published</small>
          <strong>
            {stamp(d.snapshot.publishedAt) || "—"} · reviewed by{" "}
            {d.snapshot.reviewedBy || "—"}
          </strong>
        </div>
        <div>
          <small>Prepared</small>
          <strong>
            {d.preparedBy} · {stamp(d.preparedAt)}
          </strong>
        </div>
        {d.status === "Recorded" && (
          <div>
            <small>Delivered</small>
            <strong>
              {d.deliveredOn} · {d.deliveryReference}
            </strong>
          </div>
        )}
        {d.status === "Cancelled" && (
          <div>
            <small>Cancelled</small>
            <strong>
              {d.cancelledBy} · {stamp(d.cancelledAt)}
            </strong>
          </div>
        )}
      </div>
      <p className="inline-note">Review note: {d.reviewNote}</p>
      {d.status === "Recorded" && (
        <p className="inline-note">
          Delivery note: {d.deliveryNote} — recorded by {d.recordedBy} on{" "}
          {stamp(d.recordedAt)}.
        </p>
      )}
      {d.status === "Cancelled" && (
        <p className="inline-note">Cancelled: {d.cancelReason}</p>
      )}
      {state.label === "Source changed" && (
        <div className="notice warning">
          <p>
            The published statement this record was prepared against has changed
            or been withdrawn. It can't be exported or recorded as delivered;
            cancel it and prepare a new record from the current revision if the
            member still needs a statement.
          </p>
        </div>
      )}
      <div className="source-actions">
        {canDownload && (
          <Button variant="outline" onClick={exportStatement}>
            <Download />
            Download statement text
          </Button>
        )}
      </div>
      {current && (
        <div className="form-stack delivery-record">
          <h4>Record the actual delivery</h4>
          <div className="form-grid">
            <FieldLabel label="Delivered on">
              <Input
                type="date"
                aria-label="Delivered on"
                value={deliveredOn}
                min={stamp(d.preparedAt)}
                max={today()}
                onChange={(e) => setDeliveredOn(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel label="Delivery evidence reference">
              <Input
                aria-label="Delivery evidence reference"
                value={reference}
                maxLength={200}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. hand-delivered receipt, mail tracking, meeting"
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Delivery note">
            <Textarea
              aria-label="Delivery note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How and to whom it was delivered"
            />
          </FieldLabel>
          <div className="source-actions">
            <Button
              disabled={!deliveredOn || !reference.trim() || !note.trim()}
              onClick={async () => {
                if (
                  await update(
                    (w) =>
                      recordStatementDelivery(w, d.id, {
                        deliveredOn,
                        reference: reference.trim(),
                        note: note.trim(),
                      }),
                    "Statement delivery recorded",
                    `${d.snapshot.companyName} · ${d.memberName} · ${deliveredOn}`,
                  )
                ) {
                  setReference("");
                  setNote("");
                }
              }}
            >
              <ClipboardCheck />
              Record delivery
            </Button>
          </div>
          <p className="form-note">
            Downloading the statement does not record a delivery. Record it here
            only after the statement actually reached the recipient.
          </p>
        </div>
      )}
      {d.status === "Prepared" && (
        <div className="inline-form delivery-cancel">
          <FieldLabel label="Cancel this record">
            <Input
              aria-label="Delivery cancellation reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for cancelling"
            />
          </FieldLabel>
          <Button
            variant="ghost"
            disabled={!reason.trim()}
            onClick={async () => {
              if (
                await update(
                  (w) => cancelStatementDelivery(w, d.id, reason.trim()),
                  "Statement delivery cancelled",
                  `${d.snapshot.companyName} · ${d.memberName}`,
                )
              )
                setReason("");
            }}
          >
            <Ban />
            Cancel record
          </Button>
        </div>
      )}
    </article>
  );
}
