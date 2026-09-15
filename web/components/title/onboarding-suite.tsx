"use client";
import { useState } from "react";
import {
  Plus,
  FileCheck2,
  Download,
  ClipboardCheck,
  CalendarClock,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  type Company,
  onboardingSteps,
  onboardingOwner,
  uid,
} from "@/lib/title/model";
import {
  business,
  getOnboarding,
  companyProblems,
  saveApplication,
  recordOnboardingEvidence,
  evidenceCurrent,
  credentialCurrent,
  saveCredential,
  addHandoff,
  applicationFingerprint,
  today,
  type OnboardingCase,
  type CredentialRecord,
} from "@/lib/title/business";

export function OnboardingHub({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { s, connection } = useWorkspace();
  const canAddCompany = !connection || (connection.access.allCompanies && ["owner", "admin", "onboarding"].includes(connection.access.role));
  const [selected, setSelected] = useState(
    s.companies.find((c) => c.stage === "Onboarding")?.id ||
      s.companies[0]?.id ||
      "",
  );
  const [tab, setTab] = useState("Company cases");
  const c = s.companies.find((c) => c.id === selected) || s.companies[0];
  const due = business(s).credentials.filter((r) => !credentialCurrent(r));
  return (
    <>
      <Heading
        title="Company onboarding"
        description="Application, evidence and approvals in one shared case."
      >
        {canAddCompany && <Button onClick={onNew}>
          <Plus />
          Add company
        </Button>}
      </Heading>
      <div className="metrics">
        <Metric
          label="In onboarding"
          value={s.companies.filter((c) => c.stage === "Onboarding").length}
          detail="Company workspaces in progress"
        />
        <Metric
          label="Applications reviewed"
          value={
            business(s).onboarding.filter(
              (c) => c.applicationStatus === "Reviewed",
            ).length
          }
          detail="Secure intake references recorded"
        />
        <Metric
          label="Authority reviews"
          value={due.length}
          detail="Open, expired or due for review"
        />
        <Metric
          label="Evidence-based launches"
          value={business(s).onboarding.filter((c) => c.launchedAt).length}
          detail="Launch review recorded"
        />
      </div>
      <div className="toolbar">
        <Segments
          value={tab}
          onChange={setTab}
          items={["Company cases", "Authority & renewals"]}
        />
        <Picker
          value={c?.id || ""}
          label="Onboarding company"
          onChange={setSelected}
          options={s.companies.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      {c &&
        (tab === "Company cases" ? (
          <div className="business-workspace">
            <aside className="panel business-queue">
              <h2>Company cases</h2>
              {s.companies.map((x) => (
                <button
                  className={x.id === c.id ? "selected" : ""}
                  key={x.id}
                  onClick={() => setSelected(x.id)}
                >
                  <strong>{x.name}</strong>
                  <span>{getOnboarding(s, x).applicationStatus}</span>
                  <Status value={x.stage} />
                </button>
              ))}
            </aside>
            <section className="business-main">
              <div className="panel business-file-header">
                <div>
                  <h2>{c.name}</h2>
                  <p>
                    {(c.operatingStates || [c.jurisdiction]).join(" · ")} ·{" "}
                    {c.contact}
                  </p>
                </div>
                <Button variant="outline" onClick={() => onOpen(c.id)}>
                  Company record
                  <ArrowRight />
                </Button>
              </div>
              <OnboardingCasePanel key={c.id} company={c} />
            </section>
          </div>
        ) : (
          <CredentialCenter key={c.id} company={c} />
        ))}
    </>
  );
}
export function OnboardingCasePanel({ company }: { company: Company }) {
  const { s, update } = useWorkspace();
  const oc = getOnboarding(s, company);
  const [step, setStep] = useState("0"),
    [reference, setReference] = useState(""),
    [doc, setDoc] = useState("none"),
    [note, setNote] = useState("");
  const errors = companyProblems(s, company);
  const docs = s.documents.filter(
    (d) =>
      d.companyId === company.id &&
      !d.orderId &&
      !s.documents.some(
        (n) =>
          n.companyId === d.companyId &&
          n.orderId === d.orderId &&
          n.name === d.name &&
          n.version > d.version,
      ),
  );
  return (
    <>
      <ApplicationEditor
        key={`${company.id}-${oc.applicationStatus}-${oc.secureApplicationReference}`}
        company={company}
      />
      <section className="panel business-panel">
        <div className="section-heading">
          <h2>Evidence & handoffs</h2>
          <span className="subtle">
            {
              oc.evidence.filter((e) => evidenceCurrent(s, company.id, e))
                .length
            }{" "}
            / 7 reviewed
          </span>
        </div>
        <p className="inline-note">
          Each completed step records its evidence and reviewer. Existing
          checklist ticks remain historical until reviewed here.
        </p>
        <div className="evidence-steps">
          {onboardingSteps.map((label, i) => {
            const e = oc.evidence.find((e) => e.step === i),
              current = evidenceCurrent(s, company.id, e);
            return (
              <button
                key={label}
                className={step === String(i) ? "selected" : ""}
                onClick={() => {
                  setStep(String(i));
                  setReference(e?.reference || "");
                  setDoc(e?.documentId || "none");
                  setNote(e?.note || "");
                }}
              >
                <span className={current ? "step-complete" : "step-number"}>
                  {current ? <FileCheck2 size={17} /> : i + 1}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {onboardingOwner(i)} ·{" "}
                    {e
                      ? current
                        ? `${e.reviewer} reviewed`
                        : "Evidence changed"
                      : "Evidence required"}
                  </small>
                </div>
              </button>
            );
          })}
        </div>
        <div className="handoff-box">
          <h3>{onboardingSteps[Number(step)]}</h3>
          <div className="form-grid">
            <FieldLabel label="Evidence reference">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Filing, approval, secure record or document reference"
              />
            </FieldLabel>
            <FieldLabel label="Supporting company document">
              <Picker
                label="Onboarding supporting document"
                value={doc}
                onChange={setDoc}
                options={[
                  { value: "none", label: "External secure reference only" },
                  ...docs.map((d) => ({
                    value: d.id,
                    label: `${d.name} · v${d.version}`,
                  })),
                ]}
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Review note">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was reviewed and who provided the confirmation"
            />
          </FieldLabel>
          <Button
            onClick={async () =>
              await update(
                (d) =>
                  recordOnboardingEvidence(d, company.id, {
                    step: Number(step),
                    reference,
                    documentId: doc === "none" ? "" : doc,
                    note,
                  }),
                "Onboarding evidence reviewed",
                `${company.name} · ${onboardingSteps[Number(step)]}`,
              )
            }
          >
            <ClipboardCheck />
            {step === "6"
              ? "Record launch approval"
              : "Record reviewed evidence"}
          </Button>
        </div>
        {errors.length > 0 && (
          <div className="readiness-list">
            <strong>Launch checks still open</strong>
            {errors.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        )}
        {oc.launchedAt && (
          <p className="notice success">
            Launch approval recorded on {oc.launchedAt.slice(0, 10)}. Local
            evidence tracking does not verify licenses with a regulator.
          </p>
        )}
      </section>
    </>
  );
}
function ApplicationEditor({ company }: { company: Company }) {
  const { s, update } = useWorkspace();
  const [app, setApp] = useState<OnboardingCase>(() =>
    structuredClone(getOnboarding(s, company)),
  );
  const change = (key: keyof OnboardingCase, value: unknown) =>
    setApp((p) => ({ ...p, [key]: value }));
  async function packet() {
    const content = {
      demo: true,
      company: app.legalName,
      contactEmail: app.contactEmail,
      mailingAddress: app.mailingAddress,
      operatingStates: company.operatingStates || [company.jurisdiction],
      requiredUnderwriters: app.requiredUnderwriters,
      requestedMaterials: [
        "Completed application in approved secure intake",
        "Signed authorization and ownership schedule",
        "Formation and EIN confirmation",
        "Licensing and underwriter approval references",
      ],
      note: "This is a local packet checklist, not a sent application or a legal filing. Do not enter SSNs, dates of birth or bank details in this prototype.",
    };
    if (
      await update(
        (d) => {
          saveApplication(d, {
            ...app,
            applicationStatus:
              app.applicationStatus === "Not started"
                ? "Packet prepared"
                : app.applicationStatus,
          });
          addHandoff(d, {
            kind: "Application packet",
            subject: `Application packet · ${company.name}`,
            companyId: company.id,
            orderId: "",
            sourceId: company.id,
            fingerprint: applicationFingerprint(
              d,
              d.companies.find((c) => c.id === company.id)!,
            ),
          });
        },
        "Application packet prepared",
        company.name,
      )
    ) {
      download(
        `${company.id}-application-packet.json`,
        JSON.stringify(content, null, 2),
        "application/json",
      );
    }
  }
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <h2>Application workspace</h2>
        <Status value={getOnboarding(s, company).applicationStatus} />
      </div>
      <p className="inline-note">
        Keep sensitive identity details in approved secure intake. This
        workspace stores references and business contact information.
      </p>
      <div className="form-grid">
        <FieldLabel label="Legal company name">
          <Input
            value={app.legalName}
            onChange={(e) => change("legalName", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Business contact email">
          <Input
            type="email"
            value={app.contactEmail}
            onChange={(e) => change("contactEmail", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Mailing address">
          <Input
            value={app.mailingAddress}
            onChange={(e) => change("mailingAddress", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Application stage">
          <Picker
            label="Application stage"
            value={app.applicationStatus}
            options={[
              "Not started",
              "Packet prepared",
              "Awaiting return",
              "Received",
              "Reviewed",
            ]}
            onChange={(v) => change("applicationStatus", v)}
          />
        </FieldLabel>
        <FieldLabel label="Secure application reference">
          <Input
            value={app.secureApplicationReference}
            onChange={(e) =>
              change("secureApplicationReference", e.target.value)
            }
            placeholder="Approved intake record ID — no identity numbers"
          />
        </FieldLabel>
        <FieldLabel label="Signed application evidence">
          <Input
            value={app.signatureReference}
            onChange={(e) => change("signatureReference", e.target.value)}
            placeholder="Envelope / signed-document reference"
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Requested underwriters">
        <div className="operating-states">
          {["WFG", "Commonwealth"].map((uw) => (
            <label key={uw}>
              <Checkbox
                checked={app.requiredUnderwriters.includes(uw)}
                onCheckedChange={(v) =>
                  change(
                    "requiredUnderwriters",
                    v === true
                      ? [...new Set([...app.requiredUnderwriters, uw])]
                      : app.requiredUnderwriters.filter((x) => x !== uw),
                  )
                }
              />
              {uw}
            </label>
          ))}
        </div>
      </FieldLabel>
      <FieldLabel label="Additional underwriters (comma separated)">
        <Input
          defaultValue={app.requiredUnderwriters
            .filter((x) => !["WFG", "Commonwealth"].includes(x))
            .join(", ")}
          placeholder="Other reviewed underwriter names"
          onBlur={(e) =>
            change("requiredUnderwriters", [
              ...new Set([
                ...app.requiredUnderwriters.filter((x) =>
                  ["WFG", "Commonwealth"].includes(x),
                ),
                ...e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              ]),
            ])
          }
        />
      </FieldLabel>
      <FieldLabel label="Application review / corrections">
        <Textarea
          value={app.applicationNote}
          onChange={(e) => change("applicationNote", e.target.value)}
          placeholder="Review business details, ownership and signature evidence; record any corrections needed."
        />
      </FieldLabel>
      <div className="source-actions">
        <Button
          onClick={async () =>
            await update(
              (d) => saveApplication(d, app),
              "Application workspace saved",
              company.name,
            )
          }
        >
          Save application
        </Button>
        <Button variant="outline" onClick={packet}>
          <Download />
          Prepare application packet
        </Button>
      </div>
    </section>
  );
}
export function CredentialCenter({ company }: { company: Company }) {
  const { s } = useWorkspace();
  const [selected, setSelected] = useState("new");
  const records = business(s).credentials.filter(
    (r) => r.companyId === company.id,
  );
  const chosen = records.find((r) => r.id === selected);
  return (
    <div className="business-workspace">
      <aside className="panel business-queue">
        <div className="section-heading">
          <h2>Authority records</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="New authority record"
            onClick={() => setSelected("new")}
          >
            <Plus />
          </Button>
        </div>
        {records.map((r) => (
          <button
            className={selected === r.id ? "selected" : ""}
            key={r.id}
            onClick={() => setSelected(r.id)}
          >
            <strong>
              {r.state} · {r.kind}
            </strong>
            <span>{r.underwriter || r.holder}</span>
            <Status
              value={
                credentialCurrent(r) ? "Evidence recorded" : "Review required"
              }
            />
            <small>
              {r.reviewOn
                ? `Review ${r.reviewOn}`
                : r.expiresOn
                  ? `Expires ${r.expiresOn}`
                  : "No scheduled date"}
            </small>
          </button>
        ))}
        {!records.length && (
          <Empty
            title="Add authority evidence"
            text="Track each license, producer and underwriter separately."
          />
        )}
      </aside>
      <section className="business-main">
        <CredentialEditor
          key={selected}
          company={company}
          record={chosen}
          onSaved={setSelected}
        />
        <section className="panel business-panel">
          <h3>Jurisdiction reminders</h3>
          <p>
            Set dates from the actual credential and current state guidance.
            Agency, producer, company filing and underwriter approval are
            separate records.
          </p>
          <div className="research-links">
            <a
              href="https://www.ncdoi.gov/licensees/insurance-business-entity-licensing"
              target="_blank"
              rel="noreferrer"
            >
              North Carolina agency guidance ↗
            </a>
            <a
              href="https://www.doi.sc.gov/364/Agency"
              target="_blank"
              rel="noreferrer"
            >
              South Carolina agency guidance ↗
            </a>
          </div>
          <p className="form-note">
            Dates are operator-entered. No regulatory renewal or filing is
            submitted.
          </p>
        </section>
      </section>
    </div>
  );
}
function CredentialEditor({
  company,
  record,
  onSaved,
}: {
  company: Company;
  record?: CredentialRecord;
  onSaved: (id: string) => void;
}) {
  const { s, update } = useWorkspace();
  const [r, setR] = useState<CredentialRecord>(() =>
    record
      ? structuredClone(record)
      : {
          id: uid("credential"),
          companyId: company.id,
          state: (company.operatingStates || [company.jurisdiction])[0],
          kind: "Agency license",
          underwriter: "",
          holder: "",
          identifier: "",
          reference: "",
          expiresOn: "",
          reviewOn: "",
          status: "Needs review",
          reviewer: s.user,
        },
  );
  const change = (k: keyof CredentialRecord, v: string) =>
    setR((r) => ({ ...r, [k]: v }));
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <h2>{record ? "Review authority record" : "Add authority record"}</h2>
        <CalendarClock />
      </div>
      <div className="form-grid">
        <FieldLabel label="Operating state">
          <Picker
            value={r.state}
            label="Authority state"
            options={company.operatingStates || [company.jurisdiction]}
            onChange={(v) => change("state", v)}
          />
        </FieldLabel>
        <FieldLabel label="Record type">
          <Picker
            value={r.kind}
            label="Authority record kind"
            options={[
              "Agency license",
              "Producer credential",
              "Underwriter authority",
              "Annual filing",
            ]}
            onChange={(v) => change("kind", v)}
          />
        </FieldLabel>
        <FieldLabel label="Holder / responsible party">
          <Input
            value={r.holder}
            onChange={(e) => change("holder", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Underwriter (when applicable)">
          <Input
            value={r.underwriter}
            onChange={(e) => change("underwriter", e.target.value)}
            placeholder="e.g. WFG or Commonwealth"
          />
        </FieldLabel>
        <FieldLabel label="License / agency / profile identifier">
          <Input
            value={r.identifier}
            onChange={(e) => change("identifier", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Evidence reference">
          <Input
            value={r.reference}
            onChange={(e) => change("reference", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Expiry date (if applicable)">
          <Input
            type="date"
            value={r.expiresOn}
            onChange={(e) => change("expiresOn", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Next review / renewal date">
          <Input
            type="date"
            value={r.reviewOn}
            onChange={(e) => change("reviewOn", e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Local review state">
          <Picker
            value={r.status}
            label="Credential review status"
            options={["Needs review", "Verified locally"]}
            onChange={(v) => change("status", v)}
          />
        </FieldLabel>
        <FieldLabel label="Reviewer">
          <Picker
            value={r.reviewer}
            label="Credential reviewer"
            options={["Stephenie", "John", "Tyler"]}
            onChange={(v) => change("reviewer", v)}
          />
        </FieldLabel>
      </div>
      <Button
        onClick={async () => {
          if (
            await update(
              (d) => saveCredential(d, r),
              "Authority record saved",
              company.name,
            )
          )
            onSaved(r.id);
        }}
      >
        Save authority evidence
      </Button>
      <p className="form-note">
        Changing authority evidence reopens launch approval. A local review
        label is not a regulator verification.
      </p>
    </section>
  );
}
