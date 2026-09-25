"use client";
import { ConfirmActiveCompaniesButton, CompanyOperatingStatusDetails } from "./company-operating-status";
import { companyDisplayStage, validateOperatingConfirmation } from "@/lib/title/company-operating-status";
import { canManageOnboardingEvidence } from "@/lib/title/workspace-capabilities";
import applicationStyles from "./agency-applications.module.css";
import { CompanyLogo } from "./company-logo";
import { CompanyRecordsPanel } from "./company-records";
import { CompanyOverviewDetails, CompanyFolders, CompanyCardFacts } from "./company-workspace";
import { OwnershipHistoryPanel } from "./ownership";
import { OnboardingCasePanel, CredentialCenter, CompanyOperatingStates } from "./onboarding-suite";
import { JVApplicationPanel } from "./jv-application";
import { CompanyMaterials } from "./materials";
import { CompanyIntakeProfile, CompanyIntakeProfileEditor, MissiveCompanyIntakeButton } from "./company-intake";
import { PackageReviewButton, type CompanyProfileCapture } from "./package-review";
import { documentScanIdentity } from "./use-document-scan";
import { useEffect, useState } from "react";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import {
  Building2,
  Plus,
  ChevronRight,
  ArrowRight,
  MapPin,
  FolderClosed,
  AlertTriangle,
  FileUp,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useWorkspace } from "@/lib/title/store";
import { similarCompanies, saveCompanyUnderwriters } from "@/lib/title/business";
import { businessDay, nextWeekday } from "@/lib/title/business-date";
import {
  memberContactError,
  normalizeMemberContacts,
} from "@/lib/title/member-directory";
import {
  onboardingSteps,
  onboardingOwner,
  uid,
  type VaultDoc,
  type Company,
} from "@/lib/title/model";
import {
  Heading,
  SearchBox,
  Status,
  Segments,
  FieldLabel,
  Empty,
} from "./shared";
import { toast } from "sonner";
export function Companies({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { s, connection } = useWorkspace();
  const canAddCompany = !connection || (connection.access.allCompanies && ["owner", "admin", "onboarding"].includes(connection.access.role));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All companies");
  const rows = s.companies.filter(
    (c) =>
      (filter === "All companies" || companyDisplayStage(c) === filter) &&
      `${c.name} ${c.contact} ${c.jurisdiction}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Companies"
        description="Choose a company to add its application, documents and details."
      >
        <ConfirmActiveCompaniesButton />
        <MissiveCompanyIntakeButton />
        {canAddCompany && <Button onClick={onNew}>
          <Plus />
          Add company
        </Button>}
      </Heading>
      <div className="toolbar">
        <Segments
          value={filter}
          onChange={setFilter}
          items={["All companies", "Active", "Onboarding"]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Search companies…" />
      </div>
      <div className="company-grid">
        {rows.map((c) => (
          <button
            key={c.id}
            className="company-card"
            onClick={() => onOpen(c.id)}
          >
            <div className="company-card-top">
              <CompanyLogo company={c} large />
              <Status value={companyDisplayStage(c)} />
            </div>
            <h2>{c.name}</h2>
            <p>
              <MapPin size={13} />
              {[c.location, ...(c.operatingStates || [c.jurisdiction])].filter(Boolean).join(" · ") || "Location and state needed"}
            </p>
            <CompanyCardFacts company={c} />
            <div className="company-card-metrics">
              <div>
                <strong>
                  {
                    s.orders.filter(
                      (o) =>
                        o.companyId === c.id &&
                        !["Issued", "Rejected"].includes(o.status),
                    ).length
                  }
                </strong>
                <small>Open orders</small>
              </div>
              <div>
                <strong>
                  {s.documents.filter((d) => d.companyId === c.id).length}
                </strong>
                <small>Documents</small>
              </div>
              <div>
                <strong>{c.members.length}</strong>
                <small>Members</small>
              </div>
            </div>
            <div className="company-card-footer">
              <span>{companyDisplayStage(c) === "Active" && c.intake?.profileStatus === "incomplete" ? "Add existing application" : c.contact || "Open company"}</span>
              <ChevronRight size={16} />
            </div>
          </button>
        ))}
        {canAddCompany && <button className="add-company-card" onClick={onNew}>
          <span>
            <Plus size={22} />
          </span>
          <strong>A new beginning</strong>
          <p>Add your next title company</p>
        </button>}
      </div>
      {!rows.length && <Empty />}
    </>
  );
}
export function NewCompany({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { s, update, connection } = useWorkspace();
  const canAddCompany = !connection || (connection.access.allCompanies && ["owner", "admin", "onboarding"].includes(connection.access.role));
  const canChooseUnderwriters = canManageOnboardingEvidence(connection);
  const [states, setStates] = useState<string[]>(["NC"]);
  const [writers, setWriters] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  // The acknowledgement is stored as the signature of the exact matches it
  // was given for, and only counts while the displayed matches still produce
  // that signature. Any edit to any field that adds, removes or re-reasons a
  // match (a contact edit surfacing a second company, say) therefore
  // invalidates it automatically — no per-field reset logic to forget.
  const [reviewedSignature, setReviewedSignature] = useState("");
  // Live, explainable duplicate check against the companies already on file.
  // A warning only: the operator sees which records matched and why, and can
  // still create a distinct JV (an exact-name match asks for an explicit
  // acknowledgement first; nothing is ever merged or blocked outright).
  const matches = name.trim()
    ? similarCompanies(s, { name, contact, email, location: city })
    : [];
  const needsAck = matches.some((m) => m.strength === "exact");
  const signature = matches
    .map((m) => `${m.company.id}=${m.strength}:${m.reasons.join("|")}`)
    .join(";");
  const reviewed = !!signature && reviewedSignature === signature;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canAddCompany) {
      toast.error("Your account cannot add companies. Ask your workspace administrator.");
      return;
    }
    const trimmedName = name.trim(),
      trimmedContact = contact.trim();
    if (!trimmedName || !states.length) {
      toast.error("Enter a company name and choose an operating state.");
      return;
    }
    if (needsAck && !reviewed) {
      toast.error(
        "Review the matching companies and confirm this is a different one.",
      );
      return;
    }
    const acknowledged = matches.length
      ? ` · created after reviewing ${matches.length} similar record${matches.length === 1 ? "" : "s"}: ${matches.map((m) => m.company.name).join(", ")}`
      : "";
    if (
      !(await update(
        (d) => {
          const id = uid("company");
          d.companies.unshift({
            id,
            name: trimmedName,
            initials: trimmedName
              .split(" ")
              .slice(0, 2)
              .map((x) => x[0])
              .join("")
              .toUpperCase(),
            color: ["teal", "blue", "violet", "amber", "rose"][
              d.companies.length % 5
            ],
            contact: trimmedContact,
            email: email.trim(),
            location: city.trim(),
            jurisdiction: states[0],
            operatingStates: states,
            stage: "Onboarding",
            steps: Array(7).fill(false),
            members: [],
          });
          if (canChooseUnderwriters && writers.length) saveCompanyUnderwriters(d, { companyId: id, names: writers, expected: [] });
          d.tasks.unshift({
            id: uid("task"),
            title: "Collect onboarding application",
            companyId: id,
            ...(connection
              ? { owner: connection.access.email, assigneeId: connection.access.userId }
              : { owner: "Stephenie" }),
            due: nextWeekday(businessDay()),
            priority: "Normal",
            done: false,
          });
        },
        "Company added",
        `${trimmedName} · onboarding started${acknowledged}`,
      ))
    )
      return;
    onClose();
  }
  if (!canAddCompany) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>
            Add a title company or joint venture to this workspace. Its files,
            ownership, contacts and onboarding stay organized by company.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <FieldLabel label="Company name">
            <Input
              name="name"
              required
              maxLength={100}
              placeholder="e.g. Magnolia Title, LLC"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldLabel>
          <p className="form-note">Use the legal company name from its formation documents. Add each joint venture as its own company; a single-company business only needs one.</p>
          <div className="form-grid">
            <FieldLabel label="Company contact (optional)">
              <Input
                name="contact"
                maxLength={100}
                placeholder="Full name"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel label="Contact email (optional)">
              <Input
                name="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel label="City">
              <Input
                name="city"
                required
                placeholder="e.g. Raleigh"
                maxLength={100}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </FieldLabel>
            <fieldset><legend className="mb-2 text-sm font-medium">Operating states</legend><div className="flex flex-wrap gap-4">{["NC", "SC"].map(code => <label key={code} className="flex items-center gap-2"><input type="checkbox" checked={states.includes(code)} onChange={e => setStates(e.target.checked ? [...states, code] : states.filter(v => v !== code))} />{code === "NC" ? "North Carolina" : "South Carolina"}</label>)}</div></fieldset>
            {canChooseUnderwriters && <fieldset><legend className="mb-2 text-sm font-medium">Underwriters (optional)</legend><div className="flex flex-wrap gap-4">{["WFG", "Commonwealth", "First American"].map(writer => <label key={writer} className="flex items-center gap-2"><input type="checkbox" checked={writers.includes(writer)} onChange={e => setWriters(e.target.checked ? [...writers, writer] : writers.filter(v => v !== writer))} />{writer}</label>)}</div></fieldset>}
          </div>
          <p className="form-note">
            This starts an internal checklist. It does not create an LLC, obtain
            an EIN, or submit a license application.
          </p>
          {matches.length > 0 && (
            <div className="notice warning duplicate-warning" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>
                  {matches.length === 1
                    ? "A similar company is already on file"
                    : `${matches.length} similar companies are already on file`}
                </strong>
                <ul className="duplicate-matches">
                  {matches.map((m) => (
                    <li key={m.company.id}>
                      <span>
                        <b>{m.company.name}</b> · {m.company.location} ·{" "}
                        {m.company.contact} · {companyDisplayStage(m.company)}
                      </span>
                      <small>{m.reasons.join(" · ")}</small>
                    </li>
                  ))}
                </ul>
                <p>
                  Nothing is merged automatically. If this is genuinely a
                  different joint venture, you can still create it
                  {needsAck ? " after confirming below" : ""}.
                </p>
                {needsAck && (
                  <label className="duplicate-ack">
                    <Checkbox
                      checked={reviewed}
                      onCheckedChange={(v) =>
                        setReviewedSignature(v === true ? signature : "")
                      }
                      aria-label="I reviewed the matching companies and this is a different company"
                    />
                    <span>
                      I reviewed the matching companies and this is a different
                      company.
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}
          {connection && <p className="form-note">Initial setup task assigned to you: {connection.access.email}.</p>}
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={needsAck && !reviewed}>
              {matches.length ? "Create separate company" : "Add company"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export type CompanyDetailTab = "Overview" | "Onboarding" | "Application" | "Documents" | "Members" | "Jurisdictions";
export function CompanyDetail({
  id,
  initialTab = "Overview",
  applicationSourceId,
  onClose,
  onDoc,
}: {
  id: string;
  initialTab?: CompanyDetailTab;
  applicationSourceId?: string;
  onClose: () => void;
  onDoc: (doc: VaultDoc, physicalPage?: number) => void;
  onUpload: (id: string) => void;
}) {
  const { s, connection } = useWorkspace();
  const [tab, setTab] = useState<string>(initialTab === "Onboarding" || initialTab === "Jurisdictions" ? "Application" : initialTab === "Members" ? "Overview" : initialTab);
  const [applicationEntry, setApplicationEntry] = useState<"upload" | "link" | undefined>();
  const [applicationDirty, setApplicationDirty] = useState(false);
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [deskDirty, setDeskDirty] = useState(false), [deskBusy, setDeskBusy] = useState(false);
  const [ownerDirty, setOwnerDirty] = useState(false), [ownerBusy, setOwnerBusy] = useState(false);
  const [folderDirty, setFolderDirty] = useState(false), [folderBusy, setFolderBusy] = useState(false);
  const [memberDirty, setMemberDirty] = useState(false), [memberBusy, setMemberBusy] = useState(false);
  const [profileCapture, setProfileCapture] = useState<(CompanyProfileCapture & { companySnapshot: string }) | null>(null);
  const c = s.companies.find((x) => x.id === id);
  if (!c) return null;
  let existingOperationsConfirmed = false;
  try { existingOperationsConfirmed = !!validateOperatingConfirmation(c.operatingStatus ?? null); } catch { /* Invalid legacy metadata cannot confirm operations. */ }
  const isExisting = companyDisplayStage(c) === "Active";
  const canEditApplication = canManageOnboardingEvidence(connection);
  const leaveApplication = () => !applicationBusy && !deskBusy && !ownerBusy && !folderBusy && !memberBusy && (!(applicationDirty || deskDirty || ownerDirty || folderDirty || memberDirty) || window.confirm("Discard unsaved company or application changes? Save them first to keep your work."));
  function changeTab(value: string) {
    if (value === tab || !leaveApplication()) return;
    setApplicationDirty(false); setApplicationEntry(undefined); setTab(value);
  }
  function openApplication(action?: "upload" | "link") {
    if (!leaveApplication()) return;
    setApplicationDirty(false); setApplicationEntry(action); setTab("Application");
  }
  const docs = s.documents.filter((d) => d.companyId === id);
  const companyDocs = docs.filter(d => !d.orderId);
  const titleDocs = docs.filter(d => !!d.orderId);
  const canEditProfile = !connection || (["owner", "admin", "onboarding"].includes(connection.access.role) && (connection.access.allCompanies || connection.access.companyIds.includes(c.id)));
  const profileCaptureCurrent = !!profileCapture && profileCapture.companySnapshot === JSON.stringify(c) && profileCapture.sourceIdentities.every(source => {
    const current = s.documents.find(doc => doc.id === source.documentId && doc.companyId === c.id);
    return current && source.identity === documentScanIdentity(current, connection);
  });
  return (
    <Sheet open={!!id} onOpenChange={(v) => { if (!v && leaveApplication()) onClose(); }}>
      <SheetContent className="detail-sheet company-detail">
        <SheetHeader>
          <CompanyLogo company={c} large />
          <SheetTitle>{c.name}</SheetTitle>
          <SheetDescription>
            {[c.location, ...(c.operatingStates || [c.jurisdiction])].filter(Boolean).join(" · ") || "Location and operating state not yet confirmed"}
          </SheetDescription>
        </SheetHeader>
        <div className="sheet-body">
          <Segments
            value={tab}
            onChange={changeTab}
            items={[
              "Overview",
              "Application",
              "Documents",
            ]}
          />
          {tab === "Overview" && (
            <>
              <CompanyOverviewDetails company={c} onDirtyChange={setDeskDirty} onBusyChange={setDeskBusy} />
              {canEditApplication && <section className={applicationStyles.startCard} aria-label="Start this company’s application">
                <div className={applicationStyles.startIcon}>{isExisting ? <FileUp size={23} /> : <Send size={22} />}</div>
                <h3>{isExisting ? "Already have the application?" : "Collect the application."}</h3>
                <p>{isExisting ? "Upload the completed form. We’ll read it and fill the application details for you to review and save." : "Prepare a private link for the applicant to fill out. Their answers return to this company for review."}</p>
                <div className={applicationStyles.startActions}>
                  <Button onClick={() => openApplication(isExisting ? "upload" : "link")}>{isExisting ? <FileUp /> : <Send />}{isExisting ? "Upload completed application" : "Send application link"}</Button>
                  <Button variant="outline" onClick={() => openApplication()}>Open application <ArrowRight /></Button>
                </div>
              </section>}
              <div className="detail-grid">
                <div>
                  <small>Primary contact</small>
                  <strong>{c.contact || "Managed by the agency"}</strong>
                </div>
                <div>
                  <small>Contact email</small>
                  <strong>{c.email || "Agency contact"}</strong>
                </div>
                <div>
                  <small>Operating states</small>
                  <strong>
                    {(c.operatingStates || [c.jurisdiction]).filter(Boolean).join(" · ") || "Not yet confirmed"}
                  </strong>
                </div>
                <div>
                  <small>Company status</small>
                  <Status value={companyDisplayStage(c)} />
                </div>
              </div>
              <div className={`${applicationStyles.supportLinks} my-5`}><Button variant="outline" onClick={() => changeTab("Documents")}>Company documents & logo <ArrowRight /></Button></div>
              <section className="panel my-5"><div className="section-heading"><h3>Owners</h3></div>{c.members.length ? c.members.map(m => <div key={m.id || m.name} className="detail-grid"><strong>{m.name}</strong><span>{m.share}% ownership</span></div>) : <p className="form-note">Add the people or LLCs that own this company.</p>}
              {canEditProfile && <details className="my-4"><summary className="cursor-pointer font-semibold">Edit members & ownership interests</summary><CompanyMembers key={c.id} company={c} onDirtyChange={setMemberDirty} onBusyChange={setMemberBusy} /></details>}
              <CompanyRecordsPanel company={c} onDirtyChange={setOwnerDirty} onBusyChange={setOwnerBusy} />
              </section>
              {c.intake && <details className={applicationStyles.support}><summary>Company details & Missive source</summary><CompanyIntakeProfile company={c} /></details>}
              <details className="mt-5 border-t pt-5">
              <summary className="cursor-pointer text-sm font-semibold">Formation and approval history</summary>
              <CompanyOperatingStatusDetails company={c} />
              <div className="checklist-title">
                <h3>{existingOperationsConfirmed ? "Workspace setup checklist" : "Onboarding checklist"}</h3>
                <span>
                  {c.steps.filter(Boolean).length} / {onboardingSteps.length}
                </span>
              </div>
              <Progress
                value={
                  (c.steps.filter(Boolean).length / onboardingSteps.length) *
                  100
                }
                className="h-1.5"
              />
              <p className="inline-note">
                Track confirmations from the responsible person. These steps do
                not perform external filings or approvals.
              </p>
              <Button variant="outline" onClick={() => openApplication()}>
                Open evidence review
              </Button>
              <div className="checklist">
                {onboardingSteps.map((step, i) => (
                  <label key={step}>
                    <Checkbox checked={c.steps[i]} disabled />
                    <span>{step}</span>
                    <small>{onboardingOwner(i)}</small>
                  </label>
                ))}
              </div>
              <div className="notice">
                <Building2 size={17} />
                <p>
                  {existingOperationsConfirmed
                    ? "This workspace checklist tracks company records. Confirming existing operations does not verify licensing, attorney review, or underwriter evidence."
                    : `${c.jurisdiction || "The company"} checklist is a planning template. State licensing, attorney review, and underwriter evidence need confirmation before launch.`}
                </p>
              </div>
              </details>
            </>
          )}
          {tab === "Documents" && (
            <section className="company-documents" aria-label="Company documents">
              <div className="company-documents-heading">
                <div>
                  <h3>Company documents</h3>
                  <p>{companyDocs.length ? `${companyDocs.length} ${companyDocs.length === 1 ? "file" : "files"}` : "No files yet"}</p>
                </div>

              </div>
              <p className="company-documents-description">Formation records, applications, agreements, disclosures and logos for {c.name}.</p>
              {!!companyDocs.length && <div className="company-documents-reader">
                <PackageReviewButton documents={companyDocs} onOpenOriginal={onDoc} onCompanyCapture={c.intake && canEditProfile ? capture => setProfileCapture({ ...capture, companySnapshot: JSON.stringify(c) }) : undefined} />
              </div>}
              <CompanyFolders company={c} onDoc={onDoc} onDirtyChange={setFolderDirty} onBusyChange={setFolderBusy} />
              {!!titleDocs.length && <details className="company-documents-disclosure">
                <summary className="cursor-pointer text-sm font-semibold">Title-file documents ({titleDocs.length})</summary>
                <p className="subtle my-3">These originals belong to property files. Read and review them from that title file’s Final sources.</p>
                {titleDocs.map(d => <button className="doc-list-row" key={d.id} onClick={() => onDoc(d)}>
                  <FolderClosed size={20} /><div className="grow"><strong>{d.name}</strong><small>{d.orderId} · {s.orders.find(order => order.id === d.orderId)?.address || "Title file"} · {d.sourceRole || "Type not assigned"}</small></div><Status value={d.visibility} /><ChevronRight size={15} />
                </button>)}
              </details>}
              <details className="company-documents-disclosure">
                <summary className="cursor-pointer text-sm font-semibold">
                  Requests and approvals
                </summary>
                <p className="subtle my-4">
                  Request logos, disclosure templates, title preference forms
                  and other company materials. Attach files from this company,
                  then record their review, approval and sharing history.
                  Upload new files above.
                </p>
                <CompanyMaterials key={c.id} companyId={c.id} onDoc={onDoc} embedded />
              </details>
            </section>
          )}
          {tab === "Application" && <>
            <JVApplicationPanel key={c.id} navigationScope="company-detail" company={c} existingCompany={isExisting} initiallyOpen sourceDocumentId={applicationSourceId} entryAction={applicationEntry} onDirtyChange={setApplicationDirty} onBusyChange={setApplicationBusy} onDocuments={() => { setApplicationDirty(false); setApplicationEntry(undefined); setTab("Documents"); }} />
            {!canEditApplication && <section className={applicationStyles.empty}><h3>Application access needed</h3><p className="form-note">An administrator can give you access to this company’s private applications. Permitted company records remain available in the other tabs.</p></section>}
            <details className={applicationStyles.support}>
              <summary>{isExisting ? "Licensing, records & approval history" : "Formation & launch checklist"}</summary>
              <CompanyOperatingStates company={c} />
              <OnboardingCasePanel company={c} />
              <CredentialCenter key={`${c.id}:${(c.operatingStates || [c.jurisdiction]).join("-")}`} company={c} />
            </details>
          </>}
          {profileCapture && canEditProfile && (profileCaptureCurrent ? <CompanyIntakeProfileEditor key={`${profileCapture.packageId}:${profileCapture.packageVersion}`} company={c} initialValues={profileCapture.values} sourceReference={`reviewed document package ${profileCapture.packageId}, version ${profileCapture.packageVersion}`} onClose={() => setProfileCapture(null)} /> : <div role="alert" className="notice warning"><p>The company, original documents or your access changed. Reopen the package before using its suggestions.</p><Button variant="outline" onClick={() => setProfileCapture(null)}>Dismiss</Button></div>)}
        </div>
      </SheetContent>
    </Sheet>
  );
}
export function Onboarding({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { s, connection } = useWorkspace();
  const canAddCompany = !connection || (connection.access.allCompanies && ["owner", "admin", "onboarding"].includes(connection.access.role));
  const active = s.companies.filter((c) => companyDisplayStage(c) === "Onboarding");
  const buckets = [
    { name: "Application", test: (n: number) => n < 1, color: "blue" },
    {
      name: "Formation",
      test: (n: number) => n >= 1 && n < 3,
      color: "violet",
    },
    { name: "Approvals", test: (n: number) => n >= 3 && n < 5, color: "amber" },
    { name: "Launch preparation", test: (n: number) => n >= 5, color: "green" },
  ];
  return (
    <>
      <Heading
        title="Company onboarding"
        description="Bring the next company on board, one clear step at a time."
      >
        {canAddCompany && <Button onClick={onNew}>
          <Plus />
          Add company
        </Button>}
      </Heading>
      <div className="onboarding-summary">
        <span>
          <strong>{active.length}</strong> in progress
        </span>
        <span>
          <strong>
            {s.companies.filter((c) => companyDisplayStage(c) === "Active").length}
          </strong>{" "}
          active
        </span>
        <span>
          <MapPin size={15} /> North Carolina & South Carolina
        </span>
      </div>
      <div className="kanban">
        {buckets.map((b) => {
          const rows = active.filter((c) =>
            b.test(
              c.steps.findIndex((x) => !x) === -1
                ? 7
                : c.steps.findIndex((x) => !x),
            ),
          );
          return (
            <section key={b.name} className="kanban-column">
              <div className="kanban-title">
                <span className={`person-dot ${b.color}`} />
                <h2>{b.name}</h2>
                <span>{rows.length}</span>
              </div>
              {rows.map((c) => (
                <button
                  className="kanban-card"
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                >
                  <CompanyLogo company={c} />
                  <h3>{c.name}</h3>
                  <p>
                    {c.contact} · {c.jurisdiction}
                  </p>
                  <div className="kanban-progress">
                    <Progress
                      value={(c.steps.filter(Boolean).length / 7) * 100}
                    />
                    <small>{c.steps.filter(Boolean).length} / 7</small>
                  </div>
                  <div className="next-step">
                    <span>Next step</span>
                    <strong>
                      {onboardingSteps[c.steps.findIndex((x) => !x)]}
                    </strong>
                    <ArrowRight size={15} />
                  </div>
                </button>
              ))}
              {!rows.length && (
                <div className="kanban-empty">No companies at this stage</div>
              )}
            </section>
          );
        })}
      </div>
      <section className="panel onboarding-guide">
        <h3>A shared process, from first contact to launch.</h3>
        <p>
          Applications, formation records, licensing confirmations, underwriter
          approvals, and company materials stay together. Stephenie and John can
          pick up where the other left off.
        </p>
      </section>
    </>
  );
}
function CompanyMembers({ company, onDirtyChange, onBusyChange }: { company: Company; onDirtyChange?: (v: boolean) => void; onBusyChange?: (v: boolean) => void }) {
  const { update } = useWorkspace();
  const [members, setMembers] = useState(() =>
    company.members.map((m) => ({ ...m })),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(company.members),
  );
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(members) !== baseline;
  useWorkspaceNavigationGuard("company-detail", { dirty, busy });
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  // Adopt refreshed members only when this editor has no unsaved work.
  if (!dirty && JSON.stringify(company.members) !== baseline) {
    setMembers(company.members.map(m => ({ ...m }))); setBaseline(JSON.stringify(company.members));
  }
  const contactErrors = members.map(memberContactError);
  const total = members.reduce((n, m) => n + m.share, 0);
  const valid =
    members.length > 0 &&
    members.every(
      (m) =>
        m.name.trim() &&
        Number.isFinite(m.share) &&
        m.share > 0 &&
        m.share <= 100,
    ) &&
    new Set(members.map((m) => m.name.trim().toLowerCase())).size ===
      members.length &&
    Math.abs(total - 100) < 0.000001 &&
    !contactErrors.some(Boolean);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const normalized = members.map((m) => ({
      id: m.id || uid("member"),
      name: m.name.trim(),
      share: m.share,
      ...normalizeMemberContacts(m),
    }));
    const saved = await update(
      (d) => {
        const current = d.companies.find((c) => c.id === company.id)!;
        if (JSON.stringify(current.members) !== baseline)
          throw new Error(
            "Company members changed. Reopen this company before saving.",
          );
        current.members = normalized;
      },
      "Company members updated",
      company.name,
    );
    setBusy(false);
    if (saved) {
      setMembers(normalized);
      setBaseline(JSON.stringify(normalized));
    }
  }
  return (
    <>
    <form onSubmit={save} className="form-stack"><fieldset disabled={busy} style={{display:"contents"}}>
      <p className="inline-note">
        Keep member contact details with the company. Ownership interests are
        used for financial planning and require reviewed agreements.
      </p>
      {members.map((m, i) => (
        <div className="form-stack" key={i}>
          <div className="member-editor">
            <FieldLabel label={`Member ${i + 1}`}>
              <Input
                aria-label={`Member ${i + 1} name`}
                required
                maxLength={100}
                value={m.name}
                onChange={(e) =>
                  setMembers((prev) =>
                    prev.map((v, j) =>
                      j === i ? { ...v, name: e.target.value } : v,
                    ),
                  )
                }
              />
            </FieldLabel>
            <FieldLabel label="Interest (%)">
              <Input
                type="number"
                aria-label={`Member ${i + 1} ownership percentage`}
                min="0.01"
                max="100"
                step="0.01"
                required
                value={m.share}
                onChange={(e) =>
                  setMembers((prev) =>
                    prev.map((v, j) =>
                      j === i ? { ...v, share: Number(e.target.value) } : v,
                    ),
                  )
                }
              />
            </FieldLabel>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setMembers((prev) => prev.filter((_, j) => j !== i))
              }
              aria-label={`Remove member ${i + 1}`}
            >
              Remove
            </Button>
          </div>
          <div className="form-grid">
            <FieldLabel label="Email (optional)">
              <Input
                type="email"
                aria-label={`Member ${i + 1} email`}
                maxLength={254}
                value={m.email || ""}
                onChange={(e) =>
                  setMembers((prev) => prev.map((v, j) =>
                    j === i ? { ...v, email: e.target.value } : v,
                  ))
                }
              />
            </FieldLabel>
            <FieldLabel label="Phone (optional)">
              <Input
                type="tel"
                aria-label={`Member ${i + 1} phone`}
                maxLength={60}
                value={m.phone || ""}
                onChange={(e) =>
                  setMembers((prev) => prev.map((v, j) =>
                    j === i ? { ...v, phone: e.target.value } : v,
                  ))
                }
              />
            </FieldLabel>
          </div>
          {contactErrors[i] && (
            <p className="form-note" role="alert">{contactErrors[i]}</p>
          )}
        </div>
      ))}
      <div className="member-editor-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setMembers((prev) => [
              ...prev,
              { id: uid("member"), name: "", share: Math.max(0, 100 - total) },
            ])
          }
        >
          <Plus />
          Add member
        </Button>
        <span>Total interest: {total.toFixed(2)}%</span>
      </div>
      <p className="form-note">
        Use unique member names and positive interests totaling 100%. Changing
        ownership requires a new month-end review.
      </p>
      <Button type="submit" disabled={!valid}>
        {busy ? "Saving…" : "Save members"}
      </Button></fieldset>
    </form>
    <OwnershipHistoryPanel companyId={company.id} />
    </>
  );
}
