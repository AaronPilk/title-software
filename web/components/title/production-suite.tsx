"use client";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Plus,
  FileText,
  CheckCheck,
  Upload,
  ArrowRight,
  Layers3,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { type Order, moneyCents, uid } from "@/lib/title/model";
import {
  titleFile,
  orderSources,
  finalReadiness,
} from "@/lib/title/production";
import {
  business,
  loadDemoScenario,
  products,
  getCommitment,
  commitmentFingerprint,
  commitmentProblems,
  saveCommitment,
  prepareCommitment,
  addPolicy,
  voidDraftPolicy,
  savePolicy,
  preparePolicy,
  issuePolicy,
  deliverPolicy,
  saveCPL,
  prepareCPL,
  returnCPL,
  deliverCPL,
  cplFingerprint,
  recordCommitmentReturn,
  openCorrection,
  requestCorrection,
  reviewCorrectionRequest,
  recordCorrection,
  cancelCorrection,
  type PolicyProduct,
  type CommitmentCase,
  type CPLRecord,
  type PolicyCorrection,
} from "@/lib/title/business";
import { TitleFileDetails } from "./final-intake";
import { ReferencedSources } from "./referenced-sources";
import { UploadDocument, DocumentPreview } from "./documents";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import { allowWorkspaceNavigation } from "@/lib/title/workspace-navigation-guard";

export function ProductionSuite({
  mode,
  onReview,
  initialOrderId,
}: {
  mode: "Commitments" | "Policy products";
  onReview: (id: string) => void;
  initialOrderId?: string;
}) {
  const { s, update } = useWorkspace();
  const [company, setCompany] = useState("all");
  const [selected, setSelected] = useState(
    initialOrderId ||
      s.orders.find((o) => o.status === "New")?.id ||
      s.orders[0]?.id ||
      "",
  );
  const [tab, setTab] = useState("Preparation");
  const rows = s.orders.filter(
    (o) =>
      o.status !== "Rejected" && (company === "all" || o.companyId === company),
  );
  const order = rows.find((o) => o.id === selected) || rows[0];
  const b = business(s);
  return (
    <>
      <Heading
        title={mode}
        description={
          mode === "Commitments"
            ? "From attorney opinion to a reviewed commitment package."
            : "Each policy has its own coverage, document and delivery."
        }
      >
        <Button
          variant="outline"
          onClick={async () => {
            let id = "";
            if (
              await update(
                (d) => {
                  id = loadDemoScenario(d);
                },
                "Guided sample ready",
                "Fictional end-to-end case",
              )
            ) {
              setSelected(id);
              setCompany("all");
              setTab("Preparation");
            }
          }}
        >
          Load sample case
        </Button>
        <Picker
          value={company}
          onChange={setCompany}
          label="Production company"
          options={[
            { value: "all", label: "All companies" },
            ...s.companies.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </Heading>
      <div className="metrics">
        <Metric
          label="Commitment packages"
          value={b.commitments.length}
          detail="Drafts and recorded returns"
        />
        <Metric
          label="Policy products"
          value={b.policies.filter((p) => p.status !== "Void").length}
          detail="Owner and lender coverage"
        />
        <Metric
          label="Issued products"
          value={
            b.policies.filter((p) => ["Issued", "Delivered"].includes(p.status))
              .length
          }
          detail="Local issuance records"
        />
        <Metric
          label="Awaiting delivery"
          value={b.policies.filter((p) => p.status === "Issued").length}
          detail="Document and recipient tracked"
        />
      </div>
      <div className="business-workspace">
        <aside className="panel business-queue">
          <h2>Transaction files</h2>
          {rows.map((o) => (
            <button
              key={o.id}
              className={order?.id === o.id ? "selected" : ""}
              onClick={() => { if (allowWorkspaceNavigation("workspace")) setSelected(o.id); }}
            >
              <strong>{o.address}</strong>
              <span>
                {o.id} · {s.companies.find((c) => c.id === o.companyId)?.name}
              </span>
              <Status value={o.status} />
            </button>
          ))}
        </aside>
        <section className="business-main">
          {order ? (
            <>
              <div className="panel business-file-header">
                <div>
                  <p className="eyebrow">
                    {s.companies.find((c) => c.id === order.companyId)?.name} /{" "}
                    {order.id}
                  </p>
                  <h2>{order.address}</h2>
                  <p>
                    {order.jurisdiction} · {order.underwriter} · {order.type}
                  </p>
                </div>
                <Button variant="outline" onClick={() => { if (allowWorkspaceNavigation("workspace")) onReview(order.id); }}>
                  Final review
                  <ArrowRight />
                </Button>
              </div>
              <Segments
                value={tab}
                onChange={next => { if (next === tab || allowWorkspaceNavigation("workspace")) setTab(next); }}
                items={["Preparation", "File details", "Source documents"]}
              />
              {tab === "File details" ? (
                <section className="panel business-panel">
                  <TitleFileDetails
                    key={order.id}
                    order={order}
                  />
                </section>
              ) : tab === "Source documents" ? (
                <SourcePackage key={order.id} order={order} />
              ) : mode === "Commitments" ? (
                <>
                  <CommitmentEditor
                    key={`${order.id}-${getCommitment(s, order).version}`}
                    order={order}
                  />
                  <PolicyList order={order} finalMode={false} />
                  <CPLPlanner key={order.id} order={order} />
                </>
              ) : (
                <PolicyList
                  order={order}
                  finalMode
                  onReview={() => onReview(order.id)}
                />
              )}
            </>
          ) : (
            <Empty title="No files in this company" />
          )}
        </section>
      </div>
    </>
  );
}
function SourcePackage({ order }: { order: Order }) {
  const { s } = useWorkspace();
  const [upload, setUpload] = useState(false),
    [preview, setPreview] = useState("");
  const docs = orderSources(s, order.id);
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <h2>Source documents</h2>
        <Button onClick={() => setUpload(true)}>
          <Upload />
          Add documents
        </Button>
      </div>
      {docs.map((d) => (
        <button
          className="doc-list-row"
          key={d.id}
          onClick={() => setPreview(d.id)}
        >
          <FileText />
          <div className="grow">
            <strong>{d.name}</strong>
            <small>
              {d.sourceRole} · v{d.version}
            </small>
          </div>
          <ArrowRight size={16} />
        </button>
      ))}
      {!docs.length && (
        <Empty
          title="Add the attorney opinion"
          text="Keep the original opinion and supporting records with this file."
        />
      )}
      {upload && (
        <UploadDocument
          companyId={order.companyId}
          orderId={order.id}
          initialRole="Preliminary opinion"
          onClose={() => setUpload(false)}
        />
      )}{" "}
      {preview && s.documents.some(d => d.id === preview) && (
        <DocumentPreview
          doc={s.documents.find((d) => d.id === preview)!}
          onClose={() => setPreview("")}
        />
      )}
    </section>
  );
}
function CommitmentEditor({ order }: { order: Order }) {
  const { s, update } = useWorkspace();
  const original = getCommitment(s, order);
  const [c, setC] = useState<CommitmentCase>(() => structuredClone(original));
  const [dirty, setDirty] = useState(false),
    [upload, setUpload] = useState(false),
    [returned, setReturned] = useState(""),
    [doc, setDoc] = useState("none");
  const errors = commitmentProblems(s, order);
  const stale =
    original.status !== "Draft" &&
    original.snapshot !== commitmentFingerprint(s, order);
  const docs = orderSources(s, order.id);
  const locked = ["Issued", "Rejected"].includes(order.status);
  const change = (k: keyof CommitmentCase, v: string) => {
    setC((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">INITIAL COMMITMENT</p>
          <h2>Opinion & intake review</h2>
        </div>
        <Status value={stale ? "Review required" : original.status} />
      </div>
      <p className="inline-note">
        Outstanding commitment requirements can remain open. Final-policy
        clearance happens after closing.
      </p>
      <fieldset disabled={locked} className="form-stack">
        <div className="form-grid">
          <FieldLabel label="Preliminary title opinion">
            <Picker
              label="Preliminary title opinion"
              value={c.ptoDocumentId || "none"}
              onChange={(v) => change("ptoDocumentId", v === "none" ? "" : v)}
              options={[
                { value: "none", label: "Select current opinion" },
                ...docs
                  .filter((d) => d.sourceRole === "Preliminary opinion")
                  .map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </FieldLabel>
          <FieldLabel label="Signed opinion review reference">
            <Input
              value={c.attorneyReference}
              onChange={(e) => change("attorneyReference", e.target.value)}
              placeholder="Attorney signature / opinion reference"
            />
          </FieldLabel>
          <FieldLabel label="Premium basis">
            <Picker
              label="Premium basis"
              value={c.premiumBasis}
              onChange={(v) => change("premiumBasis", v)}
              options={[
                "Review required",
                "Standard — manually reviewed",
                "Reissue — eligibility reviewed",
                "Simultaneous — manually reviewed",
              ]}
            />
          </FieldLabel>
          <FieldLabel label="Prior-policy / tacking review">
            <Input
              value={c.priorReview}
              onChange={(e) => change("priorReview", e.target.value)}
              placeholder="Policy, date, amount, exceptions and scope"
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Search-package review">
          <Textarea
            value={c.searchReview}
            onChange={(e) => change("searchReview", e.target.value)}
            placeholder="Record the relevant source review if a search package was supplied."
          />
        </FieldLabel>
        <FieldLabel label="Commitment review note">
          <Textarea
            value={c.reviewNote}
            onChange={(e) => change("reviewNote", e.target.value)}
            placeholder="Confirm the source, exact legal description, selected products and requirements."
          />
        </FieldLabel>
        <ReferencedSources key={order.id} order={order} />
        <div className="source-actions">
          <Button
            variant="outline"
            onClick={async () => {
              if (
                await update(
                  (d) => saveCommitment(d, c),
                  "Commitment draft saved",
                  order.id,
                )
              )
                setDirty(false);
            }}
            disabled={!dirty}
          >
            Save intake review
          </Button>
          <Button
            onClick={async () => {
              let packet: unknown;
              if (
                await update(
                  (d) => {
                    packet = structuredClone(prepareCommitment(d, order.id));
                  },
                  "Commitment package prepared",
                  order.id,
                )
              )
                download(
                  `${order.id}-commitment-review.json`,
                  JSON.stringify(
                    {
                      demo: true,
                      notAnInsuranceCommitment: true,
                      case: packet,
                      file: titleFile(order),
                      products: products(s, order.id),
                    },
                    null,
                    2,
                  ),
                  "application/json",
                );
            }}
            disabled={dirty || errors.length > 0}
          >
            <CheckCheck />
            Prepare local package
          </Button>
        </div>
      </fieldset>
      {dirty ? (
        <p className="notice">Save the intake review before preparation.</p>
      ) : errors.length > 0 ? (
        <div className="readiness-list">
          <strong>Before preparation</strong>
          {errors.map((e, i) => (
            <span key={i}>{e}</span>
          ))}
        </div>
      ) : (
        <p className="notice success">The local intake review is complete.</p>
      )}
      {["Prepared", "Returned"].includes(original.status) && (
        <div className="handoff-box">
          <h3>SoftPro commitment return</h3>
          <p>
            The package is ready for the configured SoftPro workflow. Record its
            returned reference and document here.
          </p>
          <div className="form-grid">
            <Input
              aria-label="Returned commitment reference"
              placeholder="Returned SoftPro commitment reference"
              value={returned}
              onChange={(e) => setReturned(e.target.value)}
            />
            <Picker
              label="Returned commitment document"
              value={doc}
              onChange={setDoc}
              options={[
                { value: "none", label: "Select returned commitment" },
                ...docs
                  .filter(
                    (d) =>
                      d.sourceRole === "Commitment output" &&
                      d.commitmentVersion === original.version,
                  )
                  .map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </div>
          <div className="source-actions">
            <Button variant="outline" onClick={() => setUpload(true)}>
              <Upload />
              Upload returned document
            </Button>
            <Button
              disabled={stale || original.status === "Returned"}
              onClick={async () =>
                await update(
                  (d) => recordCommitmentReturn(d, order.id, returned, doc),
                  "Commitment return recorded",
                  order.id,
                )
              }
            >
              Record local return
            </Button>
          </div>
          {original.returnedReference && (
            <p>Recorded reference: {original.returnedReference}</p>
          )}
        </div>
      )}
      {upload && (
        <UploadDocument
          companyId={order.companyId}
          orderId={order.id}
          initialRole="Commitment output"
          commitmentVersion={original.version}
          onClose={() => setUpload(false)}
        />
      )}
    </section>
  );
}
export function PolicyList({
  order,
  finalMode,
  onReview,
}: {
  order: Order;
  finalMode: boolean;
  onReview?: () => void;
}) {
  const { s, update } = useWorkspace();
  const ps = products(s, order.id);
  return (
    <section className="policy-list">
      <div className="section-heading">
        <div>
          <h2>Policy products</h2>
          <p className="subtle">
            Premiums are entered from reviewed terms; no rate engine is
            connected.
          </p>
        </div>
        <div className="source-actions">
          <Button
            variant="outline"
            disabled={order.status === "Issued"}
            onClick={async () =>
              await update(
                (d) => addPolicy(d, order.id, "Owner"),
                "Owner policy added",
                order.id,
              )
            }
          >
            <Plus />
            Owner
          </Button>
          <Button
            variant="outline"
            disabled={
              order.status === "Issued" || titleFile(order).financing === "Cash"
            }
            onClick={async () =>
              await update(
                (d) => addPolicy(d, order.id, "Loan"),
                "Loan policy added",
                order.id,
              )
            }
          >
            <Plus />
            Loan
          </Button>
        </div>
      </div>
      {!ps.length && (
        <Empty
          title="Choose the coverage products"
          text={
            order.status === "Issued"
              ? "This is a legacy demo order. Its original financial total is preserved."
              : "An owner policy and a loan policy are separate records, even in one transaction."
          }
        />
      )}{" "}
      {ps.map((p) => (
        <PolicyEditor
          key={p.id}
          policy={p}
          order={order}
          finalMode={finalMode}
          onReview={onReview}
        />
      ))}
    </section>
  );
}
function PolicyEditor({
  policy,
  order,
  finalMode,
  onReview,
}: {
  policy: PolicyProduct;
  order: Order;
  finalMode: boolean;
  onReview?: () => void;
}) {
  const { s, update: save } = useWorkspace();
  const [p, setP] = useState(() => structuredClone(policy));
  const policySnapshot = JSON.stringify(policy);
  const [syncedPolicySnapshot, setSyncedPolicySnapshot] = useState(policySnapshot);
  const [dirty, setDirty] = useState(false),
    [upload, setUpload] = useState(false),
    [reference, setReference] = useState(""),
    [documentId, setDocument] = useState("none"),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [recipient, setRecipient] = useState(titleFile(order).attorneyEmail),
    [deliveryRef, setDeliveryRef] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  // Keep a draft's original version so a concurrent edit fails the domain save
  // check. Clean editors follow both new versions and same-version lifecycle changes.
  if (!dirty && !busy && syncedPolicySnapshot !== policySnapshot) {
    setP(structuredClone(policy));
    setSyncedPolicySnapshot(policySnapshot);
  }
  const mounted = useRef(false), working = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useWorkspaceNavigationGuard("workspace", { dirty, busy });
  const update: typeof save = async (...args) => {
    if (working.current) return false;
    working.current = true; setBusy(true); setError("");
    try {
      const saved = await save(...args);
      if (!saved && mounted.current) setError("The policy update was not saved. Your current edits are still here.");
      return saved;
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "The policy update could not be saved.");
      return false;
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const locked = ["Issued", "Delivered"].includes(policy.status);
  const ready = finalReadiness(s, order).ready;
  const change = (k: keyof PolicyProduct, v: string | number) => {
    setP((x) => ({ ...x, [k]: v }));
    setDirty(true);
    setError("");
  };
  const docs = orderSources(s, order.id).filter(
    (d) =>
      d.sourceRole === "Final policy" &&
      d.policyId === p.id &&
      d.policyVersion === p.version,
  );
  const exceptions = titleFile(order).requirements.filter(
    (r) => r.kind === "Exception",
  );
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <div className="product-title">
          <Layers3 />
          <h3>{policy.kind} policy</h3>
        </div>
        <div className="source-actions">
          <Status value={policy.status} />
          {!locked && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={async () =>
                await update(
                  (d) => voidDraftPolicy(d, p.id),
                  "Draft policy removed",
                  order.id,
                )
              }
            >
              Remove draft
            </Button>
          )}
        </div>
      </div>
      {error && <p className="notice warning" role="alert">{error}</p>}
      <fieldset disabled={locked || busy} className="form-stack">
        <div className="form-grid">
          <FieldLabel
            label={
              p.kind === "Owner"
                ? "Proposed insured owner — exact wording"
                : "Proposed insured lender — exact wording"
            }
          >
            <Input
              value={p.insured}
              onChange={(e) => change("insured", e.target.value)}
            />
          </FieldLabel>
          {p.kind === "Loan" && (
            <>
              <FieldLabel label="Loan identifier / reference">
                <Input
                  value={p.loanReference}
                  onChange={(e) => change("loanReference", e.target.value)}
                  placeholder="Distinct first / junior loan reference"
                />
              </FieldLabel>
              <FieldLabel label="Loan principal ($)">
                <Input
                  type="number"
                  min=".01"
                  step=".01"
                  value={p.loanAmount}
                  onChange={(e) => change("loanAmount", Number(e.target.value))}
                />
              </FieldLabel>
            </>
          )}
          <FieldLabel label="Coverage amount ($)">
            <Input
              type="number"
              min=".01"
              step=".01"
              value={p.amount}
              onChange={(e) => change("amount", Number(e.target.value))}
            />
          </FieldLabel>
          <FieldLabel label="Policy premium ($)">
            <Input
              type="number"
              min="0"
              step=".01"
              value={p.premium}
              onChange={(e) => change("premium", Number(e.target.value))}
            />
          </FieldLabel>
          <FieldLabel label="Underwriter share (%)">
            <Input
              type="number"
              min="0"
              max="100"
              step=".01"
              value={Math.round(p.rate * 10000) / 100}
              onChange={(e) => change("rate", Number(e.target.value) / 100)}
            />
          </FieldLabel>
          <FieldLabel label="Approved form / version reference">
            <Input
              value={p.form}
              onChange={(e) => change("form", e.target.value)}
              placeholder="Underwriter, form code, version and approval"
            />
          </FieldLabel>
          <FieldLabel label="Endorsement instructions">
            <Input
              value={p.endorsements}
              onChange={(e) => change("endorsements", e.target.value)}
              placeholder="Exact codes, versions and reviewed instructions"
            />
          </FieldLabel>
        </div>
        {finalMode && (
          <>
            {p.kind === "Loan" && (
              <div className="handoff-box">
                <h4>This loan&apos;s security instrument</h4>
                <Picker
                  label="Product security document"
                  value={p.securityDocumentId || "none"}
                  onChange={(v) =>
                    change("securityDocumentId", v === "none" ? "" : v)
                  }
                  options={[
                    {
                      value: "none",
                      label: "Choose mortgage or deed of trust",
                    },
                    ...orderSources(s, order.id)
                      .filter((d) =>
                        ["Mortgage", "Deed of trust"].includes(d.sourceRole!),
                      )
                      .map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
                <Input
                  aria-label="Loan source page"
                  value={p.securityPage}
                  onChange={(e) => change("securityPage", e.target.value)}
                  placeholder="Principal amount source page"
                />
                <Input
                  aria-label="Loan principal review"
                  value={p.loanReviewNote}
                  onChange={(e) => change("loanReviewNote", e.target.value)}
                  placeholder="Confirm this loan, principal amount and recorded instrument"
                />
              </div>
            )}
            <h4>Final-policy exceptions</h4>
            <p className="subtle">
              Record each item&apos;s destination in this policy. Loan-policy
              subordinate matters require their own reviewed wording.
            </p>
            {exceptions.map((r) => {
              const e = p.exceptions.find((e) => e.itemId === r.id) || {
                itemId: r.id,
                disposition: "Retain" as const,
                wording: r.text,
                reason: "",
              };
              const edit = (key: string, value: string) => {
                setP((x) => ({
                  ...x,
                  exceptions: [
                    ...x.exceptions.filter((i) => i.itemId !== r.id),
                    { ...e, [key]: value },
                  ],
                }));
                setDirty(true);
              };
              return (
                <div className="requirement-card" key={r.id}>
                  <strong>{r.text}</strong>
                  <Picker
                    value={e.disposition}
                    label="Policy exception disposition"
                    options={["Retain", "Revise", "Omit"]}
                    onChange={(v) => edit("disposition", v)}
                  />
                  <Textarea
                    aria-label="Final exception wording"
                    value={e.wording}
                    onChange={(v) => edit("wording", v.target.value)}
                  />
                  <Input
                    aria-label="Exception disposition reason"
                    value={e.reason}
                    onChange={(v) => edit("reason", v.target.value)}
                    placeholder="Reason and supporting reference"
                  />
                </div>
              );
            })}
            {!exceptions.length && (
              <p className="subtle">
                No commitment exceptions entered. The final commitment review
                still requires an explicit attestation.
              </p>
            )}
            <FieldLabel label="Policy preparation review">
              <Textarea
                value={p.reviewNote}
                onChange={(e) => change("reviewNote", e.target.value)}
                placeholder="Record the attorney/underwriter review and the final policy comparison."
              />
            </FieldLabel>
          </>
        )}
        <div className="source-actions">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={async () => {
              if (
                await update(
                  (d) => savePolicy(d, p),
                  "Policy details saved",
                  order.id,
                ) && mounted.current
              )
                setDirty(false);
            }}
          >
            Save policy details
          </Button>
          {finalMode && (
            <Button
              disabled={dirty || !ready}
              onClick={async () =>
                await update(
                  (d) => preparePolicy(d, p.id, p.reviewNote),
                  "Policy preparation reviewed",
                  order.id,
                )
              }
            >
              <ShieldCheck />
              Prepare policy handoff
            </Button>
          )}
        </div>
      </fieldset>
      {finalMode && !ready && !locked && (
        <div className="notice">
          <span>
            Complete the final source and commitment review before preparing
            this product.
          </span>
          {onReview && (
            <Button variant="link" disabled={busy} onClick={() => { if (allowWorkspaceNavigation("workspace")) onReview(); }}>
              Open final review
            </Button>
          )}
        </div>
      )}
      {finalMode && policy.status === "Prepared" && (
        <div className="handoff-box">
          <h4>Record returned policy</h4>
          <p>
            Upload the final document returned by the approved workflow and
            record its reference.
          </p>
          <div className="form-grid">
            <Input
              aria-label="Policy number"
              disabled={busy}
              placeholder="Policy / jacket number"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Input
              aria-label="Policy issuance month"
              disabled={busy}
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <Picker
              label="Final policy document"
              disabled={busy}
              value={documentId}
              onChange={setDocument}
              options={[
                { value: "none", label: "Choose product document" },
                ...docs.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </div>
          <div className="source-actions">
            <Button variant="outline" disabled={busy} onClick={() => setUpload(true)}>
              <Upload />
              Upload final policy
            </Button>
            <Button
              disabled={busy}
              onClick={async () =>
                await update(
                  (d) => issuePolicy(d, p.id, { reference, documentId, month }),
                  "Local policy issuance recorded",
                  order.id,
                )
              }
            >
              Record local issuance
            </Button>
          </div>
        </div>
      )}
      {locked && (
        <div className="handoff-box">
          <p>
            <strong>{policy.policyNumber}</strong> · {policy.issuedMonth} ·{" "}
            {moneyCents(policy.premium)} premium
          </p>
          {policy.status === "Issued" ? (
            <>
              <div className="form-grid">
                <Input
                  aria-label="Policy delivery recipient"
                  disabled={busy}
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
                <Input
                  aria-label="Policy delivery evidence"
                  disabled={busy}
                  value={deliveryRef}
                  onChange={(e) => setDeliveryRef(e.target.value)}
                  placeholder="Delivery evidence / confirmation reference"
                />
              </div>
              <Button
                disabled={busy}
                onClick={async () =>
                  await update(
                    (d) => deliverPolicy(d, p.id, recipient, deliveryRef),
                    "Policy delivery recorded locally",
                    order.id,
                  )
                }
              >
                <Send />
                Record delivery evidence
              </Button>
            </>
          ) : (
            <p>
              Delivered to {policy.deliveryTo} · {policy.deliveryReference}
            </p>
          )}
        </div>
      )}
      {upload && (
        <UploadDocument
          companyId={order.companyId}
          orderId={order.id}
          policyId={p.id}
          initialRole="Final policy"
          onClose={() => setUpload(false)}
        />
      )}
      <p className="form-note">
        Local records only. Issuance and delivery actions do not contact an
        underwriter or send a document.
      </p>
      {locked && <PolicyCorrections policy={policy} order={order} />}
    </section>
  );
}
function PolicyCorrections({
  policy,
  order,
}: {
  policy: PolicyProduct;
  order: Order;
}) {
  const { s } = useWorkspace();
  const corrections = business(s)
    .corrections.filter((c) => c.policyId === policy.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = openCorrection(s, policy.id);
  const [requesting, setRequesting] = useState(false);
  return (
    <div className="handoff-box">
      <div className="section-heading">
        <h4>Post-issuance corrections</h4>
        {!open && !requesting && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRequesting(true)}
          >
            <Plus />
            Request correction
          </Button>
        )}
      </div>
      {!corrections.length && !requesting && (
        <p className="subtle">
          Issued content stays fixed. If something needs to change after
          issuance, request a correction instead of editing the policy above.
        </p>
      )}
      {corrections.map((c) => (
        <CorrectionCard key={c.id} correction={c} order={order} />
      ))}
      {requesting && (
        <RequestCorrectionForm
          policy={policy}
          onClose={() => setRequesting(false)}
        />
      )}
    </div>
  );
}
function CorrectionCard({
  correction: c,
  order,
}: {
  correction: PolicyCorrection;
  order: Order;
}) {
  const { s, update } = useWorkspace();
  const [reviewNote, setReviewNote] = useState(c.reviewNote);
  const [reference, setReference] = useState(c.correctionReference);
  const [documentId, setDocumentId] = useState("none");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const docs = orderSources(s, order.id).filter(
    (d) => d.sourceRole === "Correction output" && d.correctionId === c.id,
  );
  return (
    <div className="requirement-card">
      <div className="section-heading">
        <strong>{c.correctionKind}</strong>
        <Status value={c.status} />
      </div>
      <p className="subtle">
        Requested by {c.requestedBy} ·{" "}
        {new Date(c.createdAt).toLocaleDateString()}
        {c.requestReference ? ` · ${c.requestReference}` : ""}
      </p>
      <p>{c.reason}</p>
      {c.fieldChanges.map((f, i) => (
        <p key={i} className="subtle">
          <strong>{f.label}:</strong> {f.before} → {f.after}
        </p>
      ))}
      {c.status === "Requested" && (
        <>
          <FieldLabel label="Review note">
            <Textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Confirm this correction is warranted and how it was verified."
            />
          </FieldLabel>
          <div className="source-actions">
            <Button
              disabled={!reviewNote.trim()}
              onClick={async () =>
                await update(
                  (d) => reviewCorrectionRequest(d, c.id, reviewNote),
                  "Correction reviewed",
                  order.id,
                )
              }
            >
              <ShieldCheck />
              Mark reviewed
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCancelling(true)}
            >
              Cancel request
            </Button>
          </div>
        </>
      )}
      {c.status === "Reviewed" && (
        <>
          <p className="subtle">{c.reviewNote}</p>
          <div className="form-grid">
            <Input
              aria-label="Correction reference"
              placeholder="Endorsement / reissue reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Picker
              label="Correction document"
              value={documentId}
              onChange={setDocumentId}
              options={[
                { value: "none", label: "Choose correction document" },
                ...docs.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </div>
          <div className="source-actions">
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload correction document
            </Button>
            <Button
              onClick={async () =>
                await update(
                  (d) => recordCorrection(d, c.id, reference, documentId),
                  "Correction recorded locally",
                  order.id,
                )
              }
            >
              Record correction
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCancelling(true)}
            >
              Cancel request
            </Button>
          </div>
        </>
      )}
      {c.status === "Recorded" && (
        <p className="subtle">
          Recorded {new Date(c.recordedAt).toLocaleString()} ·{" "}
          {c.correctionReference}
        </p>
      )}
      {c.status === "Cancelled" && (
        <p className="subtle">Cancelled: {c.cancelReason}</p>
      )}
      {cancelling && (
        <div className="form-grid">
          <Input
            aria-label="Cancellation reason"
            placeholder="Why is this correction being cancelled?"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <Button
            variant="destructive"
            disabled={!cancelReason.trim()}
            onClick={async () => {
              if (
                await update(
                  (d) => cancelCorrection(d, c.id, cancelReason),
                  "Correction request cancelled",
                  order.id,
                )
              ) {
                setCancelling(false);
                setCancelReason("");
              }
            }}
          >
            Confirm cancellation
          </Button>
        </div>
      )}
      {uploadOpen && (
        <UploadDocument
          companyId={order.companyId}
          orderId={order.id}
          correctionId={c.id}
          initialRole="Correction output"
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  );
}
function RequestCorrectionForm({
  policy,
  onClose,
}: {
  policy: PolicyProduct;
  onClose: () => void;
}) {
  const { update } = useWorkspace();
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [requestReference, setRequestReference] = useState("");
  const [correctionKind, setCorrectionKind] =
    useState<PolicyCorrection["correctionKind"]>("Endorsement");
  const [rows, setRows] = useState([{ label: "", before: "", after: "" }]);
  function setRow(i: number, key: "label" | "before" | "after", value: string) {
    setRows((r) =>
      r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)),
    );
  }
  return (
    <div className="requirement-card">
      <h4>Request a correction</h4>
      <FieldLabel label="Reason">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What was found wrong and how it was discovered"
        />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel label="Requested by">
          <Input
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Attorney, underwriter or internal review"
          />
        </FieldLabel>
        <FieldLabel label="Request reference">
          <Input
            value={requestReference}
            onChange={(e) => setRequestReference(e.target.value)}
            placeholder="Email or ticket reference (optional)"
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Correction kind">
        <Picker
          value={correctionKind}
          onChange={(v) =>
            setCorrectionKind(v as PolicyCorrection["correctionKind"])
          }
          label="Correction kind"
          options={[
            "Endorsement",
            "Reissued policy",
            "Administrative correction",
          ]}
        />
      </FieldLabel>
      <h4>Corrected fields</h4>
      {rows.map((row, i) => (
        <div className="form-grid" key={i}>
          <Input
            aria-label="Field label"
            placeholder="Field (e.g. Insured name)"
            value={row.label}
            onChange={(e) => setRow(i, "label", e.target.value)}
          />
          <Input
            aria-label="Before value"
            placeholder="Before"
            value={row.before}
            onChange={(e) => setRow(i, "before", e.target.value)}
          />
          <Input
            aria-label="After value"
            placeholder="After"
            value={row.after}
            onChange={(e) => setRow(i, "after", e.target.value)}
          />
          {rows.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setRows((r) => [...r, { label: "", before: "", after: "" }])
        }
      >
        <Plus />
        Add corrected field
      </Button>
      <div className="source-actions">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            if (
              await update(
                (d) =>
                  requestCorrection(d, policy.id, {
                    reason,
                    requestedBy,
                    requestReference,
                    correctionKind,
                    fieldChanges: rows,
                  }),
                "Correction requested",
                policy.orderId,
              )
            )
              onClose();
          }}
        >
          Submit correction request
        </Button>
      </div>
    </div>
  );
}
function CPLPlanner({ order }: { order: Order }) {
  const { s, update } = useWorkspace();
  const cs = business(s).cpls.filter((c) => c.orderId === order.id);
  return (
    <section className="policy-list">
      <div className="section-heading">
        <h2>Closing protection letters</h2>
        <Button
          variant="outline"
          disabled={order.status === "Issued"}
          onClick={async () =>
            await update(
              (d) =>
                saveCPL(d, {
                  id: uid("cpl"),
                  orderId: order.id,
                  party: "",
                  recipient: "",
                  form: "",
                  reason: "",
                  decision: "Review required",
                  reference: "",
                  documentId: "",
                  version: 1,
                  loanReference: "",
                  status: "Draft",
                  snapshot: "",
                  deliveryReference: "",
                }),
              "CPL review added",
              order.id,
            )
          }
        >
          <Plus />
          Add CPL decision
        </Button>
      </div>
      {!cs.length && (
        <Empty
          title="Record a closing protection decision"
          text="A cash transaction does not automatically make a CPL unnecessary."
        />
      )}
      {cs.map((c) => (
        <CPLEditor key={`${c.id}-${c.version}`} order={order} value={c} />
      ))}
    </section>
  );
}
function CPLEditor({ order, value }: { order: Order; value: CPLRecord }) {
  const { s, update } = useWorkspace();
  const [c, setC] = useState(() => structuredClone(value));
  const [dirty, setDirty] = useState(false),
    [upload, setUpload] = useState(false),
    [doc, setDoc] = useState("none"),
    [reference, setReference] = useState(""),
    [delivery, setDelivery] = useState("");
  const locked = ["Returned", "Delivered"].includes(value.status),
    current = value.snapshot === cplFingerprint(s, value);
  const change = (key: keyof CPLRecord, v: string) => {
    setC((c) => ({ ...c, [key]: v }));
    setDirty(true);
  };
  const docs = orderSources(s, order.id).filter(
    (d) =>
      d.sourceRole === "CPL" && d.cplId === c.id && d.cplVersion === c.version,
  );
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <h3>{value.party || "Closing protection decision"}</h3>
        <Status value={value.status} />
      </div>
      <fieldset disabled={locked} className="form-stack">
        <div className="form-grid">
          <FieldLabel label="CPL decision">
            <Picker
              label="CPL decision"
              value={c.decision}
              onChange={(v) => change("decision", v)}
              options={["Review required", "Requested", "Not requested"]}
            />
          </FieldLabel>
          <FieldLabel label="Covered party">
            <Input
              value={c.party}
              onChange={(e) => change("party", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Recipient email">
            <Input
              type="email"
              value={c.recipient}
              onChange={(e) => change("recipient", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Loan / transaction reference">
            <Input
              value={c.loanReference}
              onChange={(e) => change("loanReference", e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="CPL form / provider reference">
            <Input
              value={c.form}
              onChange={(e) => change("form", e.target.value)}
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Decision reason / review evidence">
          <Textarea
            value={c.reason}
            onChange={(e) => change("reason", e.target.value)}
          />
        </FieldLabel>
        <div className="source-actions">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={async () => {
              if (
                await update(
                  (d) => saveCPL(d, c),
                  "CPL decision recorded",
                  order.id,
                )
              )
                setDirty(false);
            }}
          >
            Save CPL decision
          </Button>
          <Button
            disabled={dirty || c.decision !== "Requested"}
            onClick={async () =>
              await update(
                (d) => prepareCPL(d, c.id),
                "CPL handoff prepared",
                order.id,
              )
            }
          >
            Prepare CPL handoff
          </Button>
        </div>
      </fieldset>
      {value.status === "Prepared" && (
        <div className="handoff-box">
          <h4>Returned CPL document</h4>
          <Input
            aria-label="Returned CPL reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Provider CPL reference"
          />
          <Picker
            value={doc}
            label="Returned CPL document"
            onChange={setDoc}
            options={[
              { value: "none", label: "Choose recipient CPL document" },
              ...docs.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <div className="source-actions">
            <Button variant="outline" onClick={() => setUpload(true)}>
              <Upload />
              Upload CPL
            </Button>
            <Button
              disabled={!current}
              onClick={async () =>
                await update(
                  (d) => returnCPL(d, c.id, reference, doc),
                  "Returned CPL recorded locally",
                  order.id,
                )
              }
            >
              Record returned CPL
            </Button>
          </div>
        </div>
      )}
      {value.status === "Returned" && (
        <div className="handoff-box">
          <p>
            {value.reference} · {value.recipient}
          </p>
          <Input
            aria-label="CPL delivery evidence"
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
            placeholder="Delivery evidence reference"
          />
          <Button
            onClick={async () =>
              await update(
                (d) => deliverCPL(d, c.id, delivery),
                "CPL delivery recorded locally",
                order.id,
              )
            }
          >
            Record delivery evidence
          </Button>
        </div>
      )}
      {value.status === "Delivered" && (
        <p className="notice success">
          Delivery recorded for {value.recipient} · {value.deliveryReference}
        </p>
      )}
      <p className="form-note">
        CPLs have their own provider, recipient and delivery records. No CPL is
        issued or sent by this local prototype.
      </p>
      {upload && (
        <UploadDocument
          orderId={order.id}
          companyId={order.companyId}
          initialRole="CPL"
          cplId={c.id}
          cplVersion={c.version}
          onClose={() => setUpload(false)}
        />
      )}
    </section>
  );
}
