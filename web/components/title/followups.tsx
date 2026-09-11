"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace, download } from "@/lib/title/store";
import { business } from "@/lib/title/business";
import { orderSources } from "@/lib/title/production";
import {
  recordFollowupSent,
  cancelFollowupItem,
  resolveFollowupItem,
  type AttorneyFollowup,
} from "@/lib/title/followups";
import { FieldLabel, Picker, Status } from "./shared";

export function AttorneyFollowups({ orderId }: { orderId: string }) {
  const { s } = useWorkspace();
  const requests = business(s).followups.filter((r) => r.orderId === orderId);
  if (!requests.length) return null;
  return (
    <section className="business-panel panel">
      <h3>Attorney follow-ups</h3>
      <p className="subtle">
        Saved requests, outstanding items and received evidence stay with this
        file.
      </p>
      {requests.map((r) => (
        <FollowupCard key={r.id} request={r} />
      ))}
    </section>
  );
}
function FollowupCard({ request: r }: { request: AttorneyFollowup }) {
  const { s, update } = useWorkspace();
  const [reference, setReference] = useState("");
  const original = s.inbox.find((m) => m.id === r.messageId);
  return (
    <section className="followup-card">
      <div className="section-heading">
        <strong>
          {r.owner} · {new Date(r.createdAt).toLocaleDateString()}
        </strong>
        <Status value={r.status} />
      </div>
      <p className="subtle">
        To: {r.to || "Attorney recipient not yet recorded"}
        {original ? ` · Original request: ${original.subject}` : ""}
      </p>
      <pre className="followup-body">{r.body}</pre>
      <Button
        variant="outline"
        onClick={() =>
          download(
            `${r.orderId}-${r.id}.txt`,
            `LOCAL FOLLOW-UP RECORD\nStatus: ${r.status}\nTo: ${r.to}\nExternal send reference: ${r.sentReference || "Not recorded"}\n\n${r.body}`,
          )
        }
      >
        Download saved request
      </Button>
      {r.status === "Draft" && (
        <div className="form-grid">
          <FieldLabel label="Manual send reference">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Confirmation from your approved email channel"
            />
          </FieldLabel>
          <Button
            variant="outline"
            onClick={() =>
              update(
                (d) => recordFollowupSent(d, r.id, reference),
                "Attorney follow-up marked waiting",
                r.orderId,
              )
            }
          >
            Record sent externally
          </Button>
        </div>
      )}
      {r.sentReference && (
        <p className="subtle">Recorded send reference: {r.sentReference}</p>
      )}
      {r.items.map((item) => (
        <FollowupItem key={item.id} request={r} item={item} />
      ))}
      <p className="form-note">
        No email is sent here. Resolving an item records receipt and reopens
        source review; it does not approve the final policy.
      </p>
    </section>
  );
}
function FollowupItem({
  request: r,
  item,
}: {
  request: AttorneyFollowup;
  item: AttorneyFollowup["items"][number];
}) {
  const { s, update } = useWorkspace();
  const [doc, setDoc] = useState("none"),
    [message, setMessage] = useState("none"),
    [note, setNote] = useState("");
  const docs = orderSources(s, r.orderId).filter(
    (d) => item.role === "Other" || d.sourceRole === item.role,
  );
  const messages = s.inbox.filter(
    (m) =>
      m.orderId === r.orderId &&
      m.id !== r.messageId &&
      (!m.companyId || m.companyId === r.companyId),
  );
  return (
    <div className="followup-item">
      <div className="section-heading">
        <strong>{item.label}</strong>
        <Status value={item.status} />
      </div>
      {item.status !== "Outstanding" ? (
        <p className="subtle">
          {item.note} · {new Date(item.resolvedAt).toLocaleDateString()} ·{" "}
          {s.documents.find((d) => d.id === item.documentId)?.name ||
            s.inbox.find((m) => m.id === item.responseMessageId)?.subject}
        </p>
      ) : (
        <>
          <div className="form-grid">
            <FieldLabel label="Received source">
              <Picker
                label={`Received source for ${item.label}`}
                value={doc}
                onChange={setDoc}
                options={[
                  { value: "none", label: "Choose received source" },
                  ...docs.map((d) => ({
                    value: d.id,
                    label: `${d.name} · v${d.version}`,
                  })),
                ]}
              />
            </FieldLabel>
            <FieldLabel label="Response message">
              <Picker
                label={`Response to ${item.label}`}
                value={message}
                onChange={setMessage}
                options={[
                  { value: "none", label: "Optional linked response" },
                  ...messages.map((m) => ({ value: m.id, label: m.subject })),
                ]}
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Receipt / clarification review note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldLabel>
          <Button
            variant="outline"
            onClick={() =>
              update(
                (d) =>
                  resolveFollowupItem(d, r.id, item.id, {
                    documentId: doc === "none" ? "" : doc,
                    responseMessageId: message === "none" ? "" : message,
                    note,
                  }),
                "Follow-up item received; source review reopened",
                r.orderId,
              )
            }
          >
            Record item received
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              update(
                (d) => cancelFollowupItem(d, r.id, item.id, note),
                "Follow-up item cancelled with reason; review reopened",
                r.orderId,
              )
            }
          >
            No longer needed — record reason
          </Button>
        </>
      )}
    </div>
  );
}
