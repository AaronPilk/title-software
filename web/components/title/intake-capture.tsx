"use client";
import { useState } from "react";
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
import { FieldLabel, Picker } from "./shared";
import { useWorkspace } from "@/lib/title/store";
import { uid, type Mail, type Order } from "@/lib/title/model";
import { emailValid } from "@/lib/title/business";
export function IntakeCapture({
  message,
  onClose,
  onSaved,
}: {
  message?: Mail;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { s, update } = useWorkspace();
  const [company, setCompany] = useState(
    message?.companyId ||
      s.orders.find((o) => o.id === message?.orderId)?.companyId ||
      s.companies[0]?.id ||
      "",
  );
  const [kind, setKind] = useState<NonNullable<Mail["kind"]>>(
    message?.kind || "Commitment",
  );
  const [file, setFile] = useState(message?.orderId || "none");
  const [from, setFrom] = useState(message?.from || ""),
    [email, setEmail] = useState(message?.email || ""),
    [subject, setSubject] = useState(message?.subject || ""),
    [body, setBody] = useState(message?.body || "");
  const [sourceRef, setSourceRef] = useState(""),
    [address, setAddress] = useState(""),
    [client, setClient] = useState(""),
    [state, setState] = useState(
      s.companies.find((c) => c.id === company)?.jurisdiction || "NC",
    ),
    [type, setType] = useState("Purchase"),
    [underwriter, setUnderwriter] = useState("WFG"),
    [docIds, setDocIds] = useState<string[]>(message?.documentIds || []);
  const docs = s.documents.filter(
    (d) =>
      d.companyId === company &&
      (file === "none" ? !d.orderId : d.orderId === file),
  );
  function save(e: React.FormEvent) {
    e.preventDefault();
    let mailId = message?.id || uid("mail");
    if (
      update(
        (d) => {
          if (
            !from.trim() ||
            !emailValid(email) ||
            !subject.trim() ||
            !body.trim()
          )
            throw new Error(
              "Enter the sender, email, subject and original request.",
            );
          const c = d.companies.find((c) => c.id === company);
          if (!c) throw new Error("Choose a company.");
          if (
            sourceRef.trim() &&
            !message &&
            d.inbox.some((m) => m.sourceReference === sourceRef.trim())
          )
            throw new Error("That source message is already captured.");
          let orderId = file === "none" ? "" : file;
          if (file === "new") {
            if (
              !address.trim() ||
              !client.trim() ||
              !(c.operatingStates || [c.jurisdiction]).includes(state)
            )
              throw new Error("Enter property, client and an operating state.");
            orderId = `T-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
            const o: Order = {
              receivedAt: new Date().toISOString().slice(0, 10),
              id: orderId,
              companyId: company,
              address: address.trim(),
              client: client.trim(),
              type,
              underwriter,
              owner: "Tyler",
              jurisdiction: state,
              delivered: false,
              remitted: false,
              status: "New",
              due: new Date().toISOString().slice(0, 10),
              premium: 0,
              rate: 0.4,
              month: new Date().toISOString().slice(0, 7),
              fields: [],
              notes: `Intake from ${from.trim()}`,
              exception: "",
            };
            d.orders.unshift(o);
          } else if (
            orderId &&
            !d.orders.some((o) => o.id === orderId && o.companyId === company)
          )
            throw new Error("Choose a file in this company.");
          if (
            docIds.some(
              (id) =>
                !d.documents.some(
                  (doc) =>
                    doc.id === id &&
                    doc.companyId === company &&
                    (!orderId ? !doc.orderId : doc.orderId === orderId),
                ),
            )
          )
            throw new Error(
              "Attachments must belong to this company and file.",
            );
          if (message) {
            const m = d.inbox.find((m) => m.id === message.id)!;
            m.companyId = company;
            m.orderId = orderId;
            m.kind = kind;
            m.documentIds = docIds;
            m.attachments = docIds.map(
              (id) => d.documents.find((doc) => doc.id === id)!.name,
            );
            m.status = "New";
          } else
            d.inbox.unshift({
              id: mailId,
              sourceReference: sourceRef.trim(),
              companyId: company,
              kind,
              from: from.trim(),
              email: email.trim(),
              subject: subject.trim(),
              body: body.trim(),
              orderId,
              time: new Date().toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              }),
              status: "New",
              documentIds: docIds,
              attachments: docIds.map(
                (id) => d.documents.find((doc) => doc.id === id)!.name,
              ),
            });
        },
        message ? "Intake routing updated" : "Incoming request captured",
        subject,
      )
    ) {
      onSaved(mailId);
      onClose();
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal wide-modal">
        <DialogHeader>
          <DialogTitle>
            {message ? "Route incoming request" : "Capture incoming request"}
          </DialogTitle>
          <DialogDescription>
            Paste a sample request and confirm the destination. Missive is not
            connected.
          </DialogDescription>
        </DialogHeader>
        <form className="form-stack" onSubmit={save}>
          <div className="form-grid">
            <FieldLabel label="Company">
              <Picker
                value={company}
                label="Incoming request company"
                options={s.companies.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                onChange={(v) => {
                  setCompany(v);
                  setFile("none");
                  setDocIds([]);
                  setState(
                    s.companies.find((c) => c.id === v)?.jurisdiction || "NC",
                  );
                }}
              />
            </FieldLabel>
            <FieldLabel label="Request type">
              <Picker
                value={kind}
                label="Incoming request type"
                options={["Commitment", "Finals", "Revision", "Company"]}
                onChange={(v) => setKind(v as NonNullable<Mail["kind"]>)}
              />
            </FieldLabel>
            <FieldLabel label="Sender name">
              <Input
                required
                value={from}
                readOnly={!!message}
                onChange={(e) => setFrom(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel label="Sender email">
              <Input
                required
                type="email"
                value={email}
                readOnly={!!message}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Subject">
            <Input
              required
              value={subject}
              readOnly={!!message}
              onChange={(e) => setSubject(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Original message">
            <Textarea
              required
              rows={5}
              value={body}
              readOnly={!!message}
              onChange={(e) => setBody(e.target.value)}
            />
          </FieldLabel>
          {!message && (
            <FieldLabel label="Source message reference (optional)">
              <Input
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                placeholder="Use a unique source reference to prevent duplicate intake"
              />
            </FieldLabel>
          )}
          <FieldLabel label="Destination file">
            <Picker
              value={file}
              label="Incoming request file"
              onChange={(v) => {
                setFile(v);
                setDocIds([]);
              }}
              options={[
                { value: "none", label: "Unmatched / company correspondence" },
                { value: "new", label: "Create a new transaction file" },
                ...s.orders
                  .filter((o) => o.companyId === company)
                  .map((o) => ({
                    value: o.id,
                    label: `${o.id} · ${o.address}`,
                  })),
              ]}
            />
          </FieldLabel>
          {file === "new" && (
            <div className="form-grid">
              <FieldLabel label="Property address">
                <Input
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </FieldLabel>
              <FieldLabel label="Client / proposed buyer">
                <Input
                  required
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                />
              </FieldLabel>
              <FieldLabel label="Property state">
                <Picker
                  value={state}
                  label="Intake property state"
                  options={
                    s.companies.find((c) => c.id === company)
                      ?.operatingStates || [
                      s.companies.find((c) => c.id === company)?.jurisdiction ||
                        "NC",
                    ]
                  }
                  onChange={setState}
                />
              </FieldLabel>
              <FieldLabel label="Transaction type">
                <Picker
                  value={type}
                  label="Intake transaction type"
                  options={["Purchase", "Refinance"]}
                  onChange={setType}
                />
              </FieldLabel>
              <FieldLabel label="Underwriter">
                <Picker
                  value={underwriter}
                  label="Intake underwriter"
                  options={["WFG", "Commonwealth"]}
                  onChange={setUnderwriter}
                />
              </FieldLabel>
            </div>
          )}
          {file !== "new" && docs.length > 0 && (
            <FieldLabel label="Link existing uploaded attachments">
              <div className="close-checks">
                {docs.map((doc) => (
                  <label key={doc.id}>
                    <Checkbox
                      checked={docIds.includes(doc.id)}
                      onCheckedChange={(v) =>
                        setDocIds((ids) =>
                          v === true
                            ? [...new Set([...ids, doc.id])]
                            : ids.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    {doc.name}
                  </label>
                ))}
              </div>
            </FieldLabel>
          )}
          <p className="form-note">
            Upload new attachments after capture using “Upload to file.” Use
            sample or redacted content in this local prototype.
          </p>
          <div className="form-actions">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {message ? "Save routing" : "Capture request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
