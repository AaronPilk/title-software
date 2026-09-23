"use client";
import { useState } from "react";
import {
  FileText,
  Plus,
  Upload,
  ArrowRight,
  Check,
  Mail,
  ClipboardCheck,
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
import { useWorkspace, download } from "@/lib/title/store";
import { uid, type Order, type VaultDoc } from "@/lib/title/model";
import {
  sourceRoles,
  fieldDefinitions,
  commitmentSnapshot,
  reviewCommitment,
  titleFile,
  orderSources,
  finalReadiness,
  productionLocked,
  neededFields,
  replaceSourceFields,
  missingDocumentDraft,
  type SourceRole,
  type TitleFile,
  type SourceCaptureContext,
} from "@/lib/title/production";
import { FieldLabel, Picker, Empty } from "./shared";
import { SourceFieldAssistant } from "./source-field-assistant";
import { documentScanIdentity } from "./use-document-scan";
import { UploadDocument, DocumentPreview } from "./documents";
import { AttorneyFollowups } from "./followups";
import { createFollowup } from "@/lib/title/followups";
import { businessDay } from "@/lib/title/business-date";
import { PackageReviewButton, type PackageCaptureValue } from "./package-review";

export function FinalSources({ order }: { order: Order }) {
  const { s, update, connection } = useWorkspace();
  const [upload, setUpload] = useState(false);
  const [preview, setPreview] = useState("");
  const [capture, setCapture] = useState("");
  const [packageCapture, setPackageCapture] = useState<{ identity: string; values: PackageCaptureValue[] } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [addSample, setAddSample] = useState(false);
  const docs = orderSources(s, order.id);
  const check = finalReadiness(s, order);
  const doc = s.documents.find((d) => d.id === preview);
  const captureDoc = s.documents.find((d) => d.id === capture);
  return (
    <div className="final-sources">
      <div className="source-summary">
        <div>
          <h3>Final opinion & recorded documents</h3>
          <p>Keep all attachments with the correct company and file.</p>
        </div>
        <Button variant="outline" onClick={() => setUpload(true)}>
          <Upload />
          Upload files
        </Button>
      </div>
      <div className="source-readiness">
        {[
          "Final opinion",
          ...(order.type !== "Refinance" ? ["Deed"] : []),
          ...(titleFile(order).financing === "Financed"
            ? [titleFile(order).securityInstrument || "Deed of trust"]
            : []),
        ].map((role) => (
          <span
            key={role}
            className={
              check.missingSources.includes(role as SourceRole)
                ? "missing"
                : "available"
            }
          >
            {check.missingSources.includes(role as SourceRole) ? (
              <FileText size={15} />
            ) : (
              <Check size={15} />
            )}{" "}
            {role}
          </span>
        ))}
      </div>
      <p className="inline-note">
        One combined PDF or several attachments can be linked here. For a
        combined file, add a section reference for each document type. Open an
        attachment to read its text or use OCR on a scanned page, then capture
        and review the values against that source.
      </p>
      {docs.map((d) => (
        <div className="source-document" key={d.id}>
          <button
            className="source-document-title"
            onClick={() => setPreview(d.id)}
          >
            <FileText size={22} />
            <span>
              <strong>{d.name}</strong>
              <small>
                {d.size} · v{d.version} · {d.sourceRole}
              </small>
            </span>
          </button>
          <Picker
            value={d.sourceRole || "Other"}
            label={`Source type for ${d.name}`}
            options={sourceRoles}
            disabled={productionLocked(s, order)}
            onChange={async (value) =>
              await update(
                (state) => {
                  const source = state.documents.find((x) => x.id === d.id)!;
                  const o = state.orders.find((x) => x.id === order.id)!;
                  if (o.status === "Issued")
                    throw new Error(
                      "Issued files require a separate correction workflow.",
                    );
                  source.sourceRole = value as SourceRole;
                  o.fields.forEach((f) => {
                    if (f.documentId === d.id) f.reviewed = false;
                  });
                  o.production = {
                    ...titleFile(o),
                    commitmentReview: undefined,
                    version: titleFile(o).version + 1,
                  };
                  if (o.status === "Ready for jacket")
                    o.status = "Needs review";
                },
                "Source type updated",
                order.id,
              )
            }
          />
          <Button
            size="sm"
            variant="outline"
            disabled={
              productionLocked(s, order) ||
              !neededFields(order).some((f) => f.role === d.sourceRole)
            }
            onClick={() => setCapture(d.id)}
          >
            Capture fields
          </Button>
        </div>
      ))}
      {!docs.length && (
        <Empty
          title="Attach the final package"
          text="Upload the original documents, or add a labeled source excerpt with its page reference."
        />
      )}
      <div className="source-actions">
        <PackageReviewButton
          documents={docs}
          onOpenOriginal={source => setPreview(source.id)}
          captureFields={Object.fromEntries(docs.map(source => [source.id, neededFields(order).filter(field => field.role === source.sourceRole).map(field => field.id)]))}
          onCapture={productionLocked(s, order) ? undefined : (source, values) => { setPackageCapture({ identity: documentScanIdentity(source, connection), values }); setCapture(source.id); }}
        />
        <Button variant="outline" onClick={() => setAddSample(true)}>
          <Plus />
          Add source / section reference
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDraft(missingDocumentDraft(s, order))}
        >
          <Mail />
          Draft missing-document request
        </Button>
      </div>
      <div className="notice">
        <ClipboardCheck size={18} />
        <p>
          A final opinion does not automatically clear commitment requirements.
          Review the evidence in File details, then approve the captured fields.
        </p>
      </div>
      <AttorneyFollowups orderId={order.id} />
      {upload && (
        <UploadDocument
          orderId={order.id}
          companyId={order.companyId}
          onClose={() => setUpload(false)}
        />
      )}
      {doc && <DocumentPreview doc={doc} onClose={() => setPreview("")} />}
      {captureDoc && (
        <CaptureFields
          key={documentScanIdentity(captureDoc, connection)}
          order={order}
          doc={captureDoc}
          initialValues={packageCapture?.identity === documentScanIdentity(captureDoc, connection) ? packageCapture.values : []}
          onClose={() => { setCapture(""); setPackageCapture(null); }}
        />
      )}
      {addSample && (
        <AddSource order={order} onClose={() => setAddSample(false)} />
      )}
      {draft !== null && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="modal">
            <DialogHeader>
              <DialogTitle>Missing-document request</DialogTitle>
              <DialogDescription>
                Review this local draft before using an approved email channel.
              </DialogDescription>
            </DialogHeader>
            <FieldLabel label="To">
              <Input value={titleFile(order).attorneyEmail} readOnly />
            </FieldLabel>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
            />
            <Button
              onClick={async () => {
                if (
                  await update(
                    (d) => {
                      createFollowup(d, order.id, {
                        body: draft,
                        owner: order.owner || "Tyler",
                        messageId:
                          d.inbox.find(
                            (m) =>
                              m.orderId === order.id && m.kind === "Finals",
                          )?.id || "",
                        items: check.missingSources.length
                          ? check.missingSources.map((role) => ({
                              label: role,
                              role,
                            }))
                          : [
                              {
                                label:
                                  "Clarified final / recording information",
                                role: "Other",
                              },
                            ],
                      });
                    },
                    "Attorney follow-up saved",
                    order.id,
                  )
                )
                  setDraft(null);
              }}
            >
              Save follow-up with this file
            </Button>
            <Button
              onClick={() =>
                download(
                  `${order.id}-missing-documents-draft.txt`,
                  `LOCAL DRAFT — NOT SENT\n\nTo: ${titleFile(order).attorneyEmail}\nSubject: ${order.id} — final documents\n\n${draft}`,
                )
              }
            >
              Download draft
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function AddSource({ order, onClose }: { order: Order; onClose: () => void }) {
  const { s, update } = useWorkspace();
  const [role, setRole] = useState<SourceRole>("Final opinion");
  const [parent, setParent] = useState("none");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim(),
      text = String(f.get("text")).trim();
    if (!name || !text) return;
    const ok = await update(
      (d) => {
        const parentDoc = d.documents.find(
          (x) => x.id === parent && x.orderId === order.id,
        );
        if (parent !== "none" && !parentDoc)
          throw new Error("The selected parent attachment is no longer available. Choose its current source again.");
        d.documents.unshift({
          id: uid("source"),
          companyId: order.companyId,
          orderId: order.id,
          sourceRole: role,
          parentDocumentId: parentDoc?.id,
          name,
          category: "Policy documents",
          visibility: "Internal",
          date: businessDay(),
          size: `${Math.max(1, Math.ceil(text.length / 1024))} KB`,
          version: 1,
          text: `OPERATOR-CAPTURED SOURCE REFERENCE\n${parentDoc ? `Parent file: ${parentDoc.name} (${parentDoc.id})\n` : ""}\n${text}`,
        });
        const o = d.orders.find((o) => o.id === order.id)!;
        if (o.status === "Issued")
          throw new Error(
            "Issued files require a separate correction workflow.",
          );
        o.production = {
          ...titleFile(o),
          commitmentReview: undefined,
          version: titleFile(o).version + 1,
        };
        o.fields.forEach((f) => {
          if (fieldDefinitions.find((x) => x.id === f.id)?.role === role)
            f.reviewed = false;
        });
        if (o.status === "Ready for jacket") o.status = "Needs review";
      },
      "Source reference added",
      order.id,
    );
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>Add source reference</DialogTitle>
          <DialogDescription>
            Record exact wording and its page reference from the original.
            This does not verify authenticity or a signature.
          </DialogDescription>
        </DialogHeader>
        <form className="form-stack" onSubmit={submit}>
          <FieldLabel label="Source type">
            <Picker
              label="New source type"
              value={role}
              onChange={(v) => setRole(v as SourceRole)}
              options={sourceRoles}
            />
          </FieldLabel>
          <FieldLabel label="Parent attachment">
            <Picker
              value={parent}
              onChange={setParent}
              label="Parent attachment"
              options={[
                { value: "none", label: "Standalone source excerpt" },
                ...orderSources(s, order.id).map((d) => ({
                  value: d.id,
                  label: d.name,
                })),
              ]}
            />
          </FieldLabel>
          <FieldLabel label="Reference name">
            <Input
              name="name"
              placeholder="Final opinion — pages 1–2"
              required
              maxLength={150}
            />
          </FieldLabel>
          <FieldLabel label="Exact excerpt and page references">
            <Textarea name="text" required rows={7} maxLength={20000} />
          </FieldLabel>
          <Button type="submit">Save source reference</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function CaptureFields({
  order,
  doc,
  onClose,
  initialValues = [],
}: {
  order: Order;
  doc: VaultDoc;
  onClose: () => void;
  initialValues?: PackageCaptureValue[];
}) {
  const { update } = useWorkspace();
  const defs = neededFields(order).filter((f) => f.role === doc.sourceRole);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(defs.map(f => [f.id, initialValues.find(item => item.id === f.id)?.value ?? order.fields.find(x => x.id === f.id && x.documentId === doc.id)?.sourceValue ?? ""])));
  const [pageReference, setPageReference] = useState(() => [...new Set(initialValues.map(item => item.evidence.page))].join("; "));
  const [evidence, setEvidence] = useState<SourceCaptureContext["fields"]>(() => Object.fromEntries(initialValues.filter(item => defs.some(def => def.id === item.id)).map(item => [item.id, item.evidence])));
  const [verified, setVerified] = useState(false), [preview, setPreview] = useState(false);
  const [reading, setReading] = useState(false);
  const [orderVersion] = useState(() => titleFile(order).version);
  const assisted = Object.keys(evidence).length > 0;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (reading || (assisted && !verified)) return;
    const capture: SourceCaptureContext = {
      documentVersion: doc.version, assetId: doc.assetId || "", sourceRole: doc.sourceRole!, orderVersion,
      fields: Object.fromEntries(Object.entries(evidence).map(([id, value]) => [id, value.method === "source-text" ? { ...value, page: pageReference } : value])),
    };
    if (
      await update(
        (s) =>
          replaceSourceFields(
            s,
            order.id,
            doc.id,
            values,
            pageReference,
            capture,
          ),
        "Source values captured",
        `${order.id} · ${doc.name}`,
      )
    )
      onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal capture-modal">
        <DialogHeader>
          <DialogTitle>Capture source values</DialogTitle>
          <DialogDescription>
            {doc.name}. Transcribe exactly; the dated date and recording date
            are separate.
          </DialogDescription>
        </DialogHeader>
        <form className="form-stack" onSubmit={submit}>
          <Button type="button" variant="outline" onClick={() => setPreview(true)}>Open original for comparison</Button>
          <SourceFieldAssistant doc={doc} defs={defs} onActivityChange={busy => { setReading(busy); setVerified(false); }} onFill={items => {
            setValues(prior => ({ ...prior, ...Object.fromEntries(items.map(item => [item.id, item.value])) }));
            setEvidence(prior => ({ ...prior, ...Object.fromEntries(items.map(item => [item.id, item.evidence])) }));
            setVerified(false);
            if (!pageReference && items.every(item => item.evidence.method !== "source-text"))
              setPageReference([...new Set(items.map(item => item.evidence.page))].join("; "));
          }} />
          <FieldLabel label="Page or section reference">
            <Input
              name="page"
              required
              value={pageReference}
              onChange={event => { setPageReference(event.target.value); setVerified(false); }}
              maxLength={300}
              placeholder="e.g. page 2, recording stamp"
            />
          </FieldLabel>
          <div className="form-grid">
            {defs.map((f) => (
              <FieldLabel label={f.label} key={f.id}>
                <Input
                  name={f.id}
                  required
                  value={values[f.id] || ""}
                  onChange={event => { setValues(prior => ({ ...prior, [f.id]: event.target.value })); setVerified(false); }}
                  maxLength={500}
                />
              </FieldLabel>
            ))}
          </div>
          <p className="form-note">
            Saving preserves these source values separately from proposed
            corrections and reopens the affected field reviews.
          </p>
          {assisted && <label className="form-note" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><input type="checkbox" checked={verified} disabled={reading} onChange={event => setVerified(event.target.checked)} />I compared every captured value with the original, including any unread pages.</label>}
          <Button type="submit" disabled={reading || (assisted && !verified)}>
            Save for field review
            <ArrowRight />
          </Button>
        </form>
        {preview && <DocumentPreview doc={doc} onClose={() => setPreview(false)} />}
      </DialogContent>
    </Dialog>
  );
}
export function TitleFileDetails({ order }: { order: Order }) {
  const { s, update } = useWorkspace();
  const original = titleFile(order);
  const [file, setFile] = useState<TitleFile>(() => structuredClone(original));
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(
    !!original.commitmentReview &&
      original.commitmentReview.snapshot === commitmentSnapshot(s, order),
  );
  const [reviewNote, setReviewNote] = useState(
    original.commitmentReview?.note || "",
  );
  function change<K extends keyof TitleFile>(key: K, value: TitleFile[K]) {
    setFile((p) => ({
      ...p,
      [key]: value,
      ...(key === "financing" && value === "Cash" ? { loanAmount: 0 } : {}),
    }));
    setConfirmed(false);
    setDirty(true);
  }
  async function save() {
    if (
      await update(
        (s) => {
          const o = s.orders.find((o) => o.id === order.id)!;
          if (titleFile(o).version !== original.version)
            throw new Error(
              "This file changed. Reopen File details to load the latest values.",
            );
          if (
            ![file.loanAmount, file.purchasePrice].every(
              (v) => Number.isFinite(v) && v >= 0 && v <= 100000000,
            )
          )
            throw new Error("Enter valid nonnegative transaction amounts.");
          o.production = {
            ...file,
            commitmentReview: undefined,
            version: original.version + 1,
          };
          if (confirmed) reviewCommitment(s, o, reviewNote);
          o.fields.forEach((f) => (f.reviewed = false));
          if (o.status === "Ready for jacket") o.status = "Needs review";
        },
        "Title file details saved",
        order.id,
      )
    )
      setDirty(false);
  }
  return (
    <div className="file-details">
      <div className="source-summary">
        <div>
          <h3>Transaction & commitment context</h3>
          <p>
            For {order.id}. Provider identities and legal text require review.
          </p>
        </div>
        <Button onClick={save} disabled={!dirty || productionLocked(s, order)}>
          Save details
        </Button>
      </div>
      <fieldset disabled={productionLocked(s, order)}>
        <div className="form-grid">
          <FieldLabel label="Financing">
            <Picker
              value={file.financing}
              label="File financing"
              options={["Financed", "Cash"]}
              onChange={(v) => change("financing", v as TitleFile["financing"])}
            />
          </FieldLabel>
          <FieldLabel label="County">
            <Input
              value={file.county}
              onChange={(e) => change("county", e.target.value)}
            />
          </FieldLabel>
          {file.financing === "Financed" && (
            <FieldLabel label="Security instrument">
              <Picker
                value={file.securityInstrument || "Deed of trust"}
                label="Security instrument"
                options={["Deed of trust", "Mortgage"]}
                onChange={(v) =>
                  change(
                    "securityInstrument",
                    v as TitleFile["securityInstrument"],
                  )
                }
              />
            </FieldLabel>
          )}
          <FieldLabel label="Loan amount ($)">
            <Input
              type="number"
              min="0"
              max="100000000"
              step=".01"
              value={file.loanAmount}
              onChange={(e) => change("loanAmount", Number(e.target.value))}
            />
          </FieldLabel>
          <FieldLabel label="Purchase price ($)">
            <Input
              type="number"
              min="0"
              max="100000000"
              step=".01"
              value={file.purchasePrice}
              onChange={(e) => change("purchasePrice", Number(e.target.value))}
            />
          </FieldLabel>
          <FieldLabel label="Attorney / firm">
            <Input
              value={file.attorney}
              onChange={(e) => change("attorney", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Attorney email">
            <Input
              type="email"
              value={file.attorneyEmail}
              onChange={(e) => change("attorneyEmail", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Lender">
            <Input
              value={file.lender}
              onChange={(e) => change("lender", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Seller">
            <Input
              value={file.seller}
              onChange={(e) => change("seller", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Commitment reference">
            <Input
              value={file.commitmentReference}
              onChange={(e) => change("commitmentReference", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Prior policy / tacking reference">
            <Input
              value={file.priorPolicyReference}
              onChange={(e) => change("priorPolicyReference", e.target.value)}
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Exact property legal description">
          <Textarea
            rows={4}
            value={file.legalDescription}
            onChange={(e) => change("legalDescription", e.target.value)}
          />
        </FieldLabel>
        <div className="form-grid">
          <FieldLabel label="CPL decision">
            <Picker
              value={file.cplDecision}
              label="CPL decision"
              options={["Review required", "Requested", "Not requested"]}
              onChange={(v) =>
                change("cplDecision", v as TitleFile["cplDecision"])
              }
            />
          </FieldLabel>
          <FieldLabel label="CPL provider reference">
            <Input
              value={file.cplReference}
              onChange={(e) => change("cplReference", e.target.value)}
            />
          </FieldLabel>
        </div>
        <p className="inline-note">
          CPL applicability, policy forms, endorsements, and prior-policy
          exceptions require an authorized review. No CPL or commitment is
          generated here.
        </p>
        <div className="source-summary">
          <h3>Requirements & exceptions</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              change("requirements", [
                ...file.requirements,
                {
                  id: uid("requirement"),
                  text: "",
                  kind: "Requirement",
                  status: "Open",
                  evidence: "",
                  note: "",
                },
              ])
            }
          >
            <Plus />
            Add item
          </Button>
        </div>
        {file.requirements.map((r, i) => (
          <section className="requirement-card" key={r.id}>
            <div className="form-grid">
              <Picker
                value={r.kind}
                label={`Item ${i + 1} type`}
                options={["Requirement", "Exception"]}
                onChange={(v) =>
                  change(
                    "requirements",
                    file.requirements.map((x) =>
                      x.id === r.id
                        ? { ...x, kind: v as typeof r.kind, status: "Open" }
                        : x,
                    ),
                  )
                }
              />
              <Picker
                value={r.status}
                label={`Item ${i + 1} review status`}
                options={
                  r.kind === "Requirement"
                    ? ["Open", "Satisfied"]
                    : ["Open", "Retained", "Excluded"]
                }
                onChange={(v) =>
                  change(
                    "requirements",
                    file.requirements.map((x) =>
                      x.id === r.id
                        ? { ...x, status: v as typeof r.status }
                        : x,
                    ),
                  )
                }
              />
            </div>
            <FieldLabel label="Exact requirement or exception">
              <Textarea
                rows={2}
                value={r.text}
                onChange={(e) =>
                  change(
                    "requirements",
                    file.requirements.map((x) =>
                      x.id === r.id ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
              />
            </FieldLabel>
            <FieldLabel
              label={
                r.kind === "Requirement"
                  ? "Clearance evidence reference"
                  : "Source reference"
              }
            >
              <Input
                value={r.evidence}
                onChange={(e) =>
                  change(
                    "requirements",
                    file.requirements.map((x) =>
                      x.id === r.id ? { ...x, evidence: e.target.value } : x,
                    ),
                  )
                }
              />
            </FieldLabel>
            <FieldLabel label="Review decision / reason">
              <Input
                value={r.note}
                onChange={(e) =>
                  change(
                    "requirements",
                    file.requirements.map((x) =>
                      x.id === r.id ? { ...x, note: e.target.value } : x,
                    ),
                  )
                }
              />
            </FieldLabel>
          </section>
        ))}
        {!file.requirements.length && (
          <p className="inline-note">
            Add the items from the actual commitment. The final opinion does not
            establish that no requirements or exceptions exist.
          </p>
        )}
        <section className="commitment-review">
          <FieldLabel label="Commitment review note">
            <Textarea
              rows={3}
              value={reviewNote}
              onChange={(e) => {
                setReviewNote(e.target.value);
                setConfirmed(false);
                setDirty(true);
              }}
              placeholder="Record the reviewed commitment and evidence, or explain why no requirements/exceptions apply."
            />
          </FieldLabel>
          <label>
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => {
                setConfirmed(v === true);
                setDirty(true);
              }}
            />{" "}
            I reviewed the commitment requirements and exceptions against this
            source package.
          </label>
        </section>
      </fieldset>
      {dirty && (
        <div className="notice">
          Unsaved changes. Saving reopens field reviews because the transaction
          context changed.
        </div>
      )}
    </div>
  );
}
