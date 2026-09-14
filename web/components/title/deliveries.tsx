"use client";
import { useState } from "react";
import { Send, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/title/store";
import { Picker, FieldLabel, Status, Empty } from "./shared";
import {
  deliveries,
  deliveryState,
  deliveryCoverage,
  prepareDelivery,
  recordDelivery,
  recordDeliveryFailure,
  retryDelivery,
  cancelDelivery,
  canRetryDelivery,
  deliveryRetried,
  recipientRoles,
  deliveryMethods,
} from "@/lib/title/delivery-ledger";

type PanelMode = "" | "record" | "fail" | "cancel" | "retry";

export function DeliveryManager({ documentId }: { documentId: string }) {
  const { s, update } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>(recipientRoles[0]);
  const [method, setMethod] = useState<string>(deliveryMethods[0]);
  const [retryMethod, setRetryMethod] = useState<string>(deliveryMethods[0]);
  const [panel, setPanel] = useState<{ id: string; mode: PanelMode }>({
    id: "",
    mode: "",
  });
  const today = new Date().toISOString().slice(0, 10);
  const doc = s.documents.find((d) => d.id === documentId);
  const rows = deliveries(s, { documentId });
  const coverage = deliveryCoverage(s, documentId);
  if (!doc || !doc.orderId) return null;

  const closePanel = () => setPanel({ id: "", mode: "" });

  async function prepare(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      documentId,
      recipientName: String(f.get("recipientName") || ""),
      recipientEmail: String(f.get("recipientEmail") || ""),
      recipientRole: role,
      method,
      reviewNote: String(f.get("reviewNote") || ""),
    };
    if (
      !(await update(
        (d) => {
          prepareDelivery(d, input);
        },
        "Delivery prepared",
        `${doc!.name} · ${input.recipientName}`,
      ))
    )
      return;
    setOpen(false);
    setRole(recipientRoles[0]);
    setMethod(deliveryMethods[0]);
  }

  async function submitRecord(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      deliveredOn: String(f.get("deliveredOn") || ""),
      deliveryReference: String(f.get("deliveryReference") || ""),
      deliveryNote: String(f.get("deliveryNote") || ""),
    };
    if (
      !(await update(
        (d) => {
          recordDelivery(d, id, input);
        },
        "Delivery recorded",
        `${doc!.name} · ${input.deliveryReference}`,
      ))
    )
      return;
    closePanel();
  }

  async function submitFailure(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      failedOn: String(f.get("failedOn") || ""),
      failureReason: String(f.get("failureReason") || ""),
    };
    if (
      !(await update(
        (d) => {
          recordDeliveryFailure(d, id, input);
        },
        "Delivery failure recorded",
        `${doc!.name} · ${input.failureReason}`,
      ))
    )
      return;
    closePanel();
  }

  async function submitRetry(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      recipientEmail: String(f.get("retryEmail") || ""),
      method: retryMethod,
      reviewNote: String(f.get("retryNote") || ""),
    };
    if (
      !(await update(
        (d) => {
          retryDelivery(d, id, input);
        },
        "Delivery retried",
        doc!.name,
      ))
    )
      return;
    closePanel();
  }

  async function submitCancel(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reason = String(f.get("cancelReason") || "");
    if (
      !(await update(
        (d) => {
          cancelDelivery(d, id, reason);
        },
        "Delivery cancelled",
        `${doc!.name} · ${reason}`,
      ))
    )
      return;
    closePanel();
  }

  return (
    <section className="delivery-manager">
      <header className="delivery-manager-head">
        <div>
          <strong>Recipient deliveries</strong>
          <small>
            {coverage.recorded
              ? `${coverage.recipients} recipient${coverage.recipients === 1 ? " holds" : "s hold"} a recorded copy`
              : "No delivery recorded yet"}
            {coverage.prepared ? ` · ${coverage.prepared} prepared` : ""}
            {coverage.failed ? ` · ${coverage.failed} failed` : ""}
            {coverage.stale ? ` · ${coverage.stale} superseded` : ""}
          </small>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          <Send size={15} />
          {open ? "Close" : "Prepare a delivery"}
        </Button>
      </header>
      <p className="form-note">
        Downloading a document is not delivering it. These records are evidence
        that a person actually sent it, entered by the person who sent it.
      </p>

      {open && (
        <form className="form-stack delivery-form" onSubmit={prepare}>
          <div className="form-grid">
            <FieldLabel label="Recipient">
              <Input name="recipientName" required maxLength={120} placeholder="Dana Reed" />
            </FieldLabel>
            <FieldLabel label="Email">
              <Input
                name="recipientEmail"
                type="email"
                required
                maxLength={160}
                placeholder="dana@lender.example"
              />
            </FieldLabel>
          </div>
          <div className="form-grid">
            <FieldLabel label="Relationship to the file">
              <Picker
                value={role}
                onChange={setRole}
                label="Recipient relationship"
                options={[...recipientRoles]}
              />
            </FieldLabel>
            <FieldLabel label="How it is being delivered">
              <Picker
                value={method}
                onChange={setMethod}
                label="Delivery method"
                options={[...deliveryMethods]}
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Review note">
            <Textarea
              name="reviewNote"
              maxLength={400}
              placeholder="What you checked before sending this version."
            />
          </FieldLabel>
          <Button type="submit">Prepare delivery</Button>
        </form>
      )}

      {!rows.length ? (
        <Empty
          title="No deliveries recorded"
          text="Prepare one when this version of the document goes to someone."
        />
      ) : (
        <ul className="delivery-list">
          {rows.map((r) => {
            const state = deliveryState(s, r);
            const active = panel.id === r.id ? panel.mode : "";
            return (
              <li key={r.id} className="delivery-row">
                <div className="delivery-row-head">
                  <div>
                    <strong>{r.recipientName}</strong>
                    <span className="subtle"> · {r.recipientRole}</span>
                    {r.attempt > 1 && (
                      <span className="subtle"> · attempt {r.attempt}</span>
                    )}
                  </div>
                  <Status value={state} />
                </div>
                <small className="subtle">
                  {r.recipientEmail} · {r.method} · {r.snapshot.documentName} v
                  {r.snapshot.documentVersion} · prepared by {r.preparedBy} on{" "}
                  {r.preparedAt.slice(0, 10)}
                </small>
                {r.reviewNote && <p className="delivery-note">{r.reviewNote}</p>}
                {r.status === "Recorded" && (
                  <p className="delivery-note">
                    Delivered {r.deliveredOn} · reference {r.deliveryReference} ·
                    recorded by {r.recordedBy}
                    {r.deliveryNote ? ` — ${r.deliveryNote}` : ""}
                  </p>
                )}
                {r.status === "Failed" && (
                  <p className="delivery-note">
                    Did not arrive {r.failedOn} — {r.failureReason} (recorded by{" "}
                    {r.failedBy})
                  </p>
                )}
                {r.status === "Cancelled" && (
                  <p className="delivery-note">
                    Cancelled by {r.cancelledBy} — {r.cancelReason}
                  </p>
                )}
                {state === "Source changed" && (
                  <p className="delivery-note">
                    A newer version of this document exists, so this preparation
                    can no longer be recorded as delivered. Cancel it and prepare
                    one from the current version.
                  </p>
                )}

                <div className="delivery-actions">
                  {state === "Prepared" && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPanel({ id: r.id, mode: "record" })}
                      >
                        Record delivery
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPanel({ id: r.id, mode: "fail" })}
                      >
                        Did not arrive
                      </Button>
                    </>
                  )}
                  {(state === "Prepared" || state === "Source changed") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPanel({ id: r.id, mode: "cancel" })}
                    >
                      Cancel
                    </Button>
                  )}
                  {canRetryDelivery(s, r) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRetryMethod(r.method);
                        setPanel({ id: r.id, mode: "retry" });
                      }}
                    >
                      <RotateCcw size={14} />
                      Try again
                    </Button>
                  )}
                  {r.status === "Failed" && deliveryRetried(s, r) && (
                    <span className="subtle">Already retried below</span>
                  )}
                </div>

                {active === "record" && (
                  <form
                    className="form-stack delivery-form"
                    onSubmit={(e) => submitRecord(e, r.id)}
                  >
                    <div className="form-grid">
                      <FieldLabel label="Delivered on">
                        <Input
                          name="deliveredOn"
                          type="date"
                          required
                          min={r.preparedAt.slice(0, 10)}
                          max={today}
                          defaultValue={today}
                        />
                      </FieldLabel>
                      <FieldLabel label="Evidence reference">
                        <Input
                          name="deliveryReference"
                          required
                          maxLength={160}
                          placeholder="Missive thread, portal receipt, tracking number"
                        />
                      </FieldLabel>
                    </div>
                    <FieldLabel label="Note">
                      <Textarea name="deliveryNote" maxLength={400} />
                    </FieldLabel>
                    <div className="delivery-actions">
                      <Button type="submit">Record delivery</Button>
                      <Button type="button" variant="ghost" onClick={closePanel}>
                        Close
                      </Button>
                    </div>
                  </form>
                )}

                {active === "fail" && (
                  <form
                    className="form-stack delivery-form"
                    onSubmit={(e) => submitFailure(e, r.id)}
                  >
                    <div className="form-grid">
                      <FieldLabel label="Failed on">
                        <Input
                          name="failedOn"
                          type="date"
                          required
                          min={r.preparedAt.slice(0, 10)}
                          max={today}
                          defaultValue={today}
                        />
                      </FieldLabel>
                      <FieldLabel label="What happened">
                        <Input
                          name="failureReason"
                          required
                          maxLength={200}
                          placeholder="Bounced — mailbox full"
                        />
                      </FieldLabel>
                    </div>
                    <div className="delivery-actions">
                      <Button type="submit">Record failure</Button>
                      <Button type="button" variant="ghost" onClick={closePanel}>
                        Close
                      </Button>
                    </div>
                  </form>
                )}

                {active === "retry" && (
                  <form
                    className="form-stack delivery-form"
                    onSubmit={(e) => submitRetry(e, r.id)}
                  >
                    <p className="form-note">
                      A new attempt to the same recipient, bound to whichever
                      version of this document is current now.
                    </p>
                    <div className="form-grid">
                      <FieldLabel label="Email (leave as is to reuse)">
                        <Input
                          name="retryEmail"
                          type="email"
                          maxLength={160}
                          defaultValue={r.recipientEmail}
                        />
                      </FieldLabel>
                      <FieldLabel label="How it is being delivered">
                        <Picker
                          value={retryMethod}
                          onChange={setRetryMethod}
                          label="Retry delivery method"
                          options={[...deliveryMethods]}
                        />
                      </FieldLabel>
                    </div>
                    <FieldLabel label="Review note">
                      <Textarea name="retryNote" maxLength={400} />
                    </FieldLabel>
                    <div className="delivery-actions">
                      <Button type="submit">Prepare retry</Button>
                      <Button type="button" variant="ghost" onClick={closePanel}>
                        Close
                      </Button>
                    </div>
                  </form>
                )}

                {active === "cancel" && (
                  <form
                    className="form-stack delivery-form"
                    onSubmit={(e) => submitCancel(e, r.id)}
                  >
                    <FieldLabel label="Why this is being cancelled">
                      <Input
                        name="cancelReason"
                        required
                        maxLength={200}
                        placeholder="Superseded by a corrected version"
                      />
                    </FieldLabel>
                    <div className="delivery-actions">
                      <Button type="submit">Cancel delivery</Button>
                      <Button type="button" variant="ghost" onClick={closePanel}>
                        Close
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
