"use client";
import { BackendSettings, type BackendSettingsSection } from "./backend-settings";
import { PartnerStatements } from "./close-suite";
import { PartnerDocuments } from "./partner-documents";
import { partnerPeriod } from "@/lib/title/followups";
import { selectPartnerSummary, summarizePartnerCompany } from "@/lib/backend/partner-summary";
import { reportingDate } from "./overview-summary";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpRight,
  Check,
  Download,
  ExternalLink,
  LockKeyhole,
  MapPin,
  Plus,
  Upload,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  useWorkspace,
  download,
  exportCsv,
  exportFullBackup,
  parseBackupFile,
  type WorkspaceBackup,
} from "@/lib/title/store";
import { MAX_BACKUP_FILE_BYTES } from "@/lib/title/backup-assets";
import {
  Heading,
  Segments,
  Metric,
  Status,
  Picker,
  CompanyAvatar,
  DataTable,
  Empty,
  FieldLabel,
} from "./shared";
export const integrations = [
  {
    name: "Document intelligence",
    initials: "OCR",
    color: "teal",
    status: "Ready for review",
    statusColor: "green",
    action: "How to use document review",
    description: "Read PDFs and scans, identify title and company information, and review field suggestions with their original page evidence. Built in; no external AI account needed.",
    requirements: [
      "In Documents, open an uploaded original and choose Read document text.",
      "For a title file, open Final sources and choose Read document package. Company documents also offer package review. Select the originals together to see conflicting values across the package.",
      "Check each proposed value, source quote and page against the original before saving. Unclear values need manual capture.",
      "Package review supports up to 1,000 physical pages across 100 originals, 25 MB per original and 500 MB total. Saved batches resume when you reopen the same originals. Unread pages stay flagged; unfamiliar layouts and handwriting may need manual entry. Single-document text review supports 120 pages.",
    ],
    note: "Staff need access to the file and its originals. Saving suggestions does not approve a policy or update SoftPro. Representative documents are still needed to measure accuracy; uploads do not automatically train a model.",
    url: null,
  },
  {
    name: "SoftPro",
    initials: "SP",
    color: "blue",
    status: "Vendor access needed",
    statusColor: "amber",
    action: "View next steps",
    description: "Company mappings and reviewed handoffs are available. Direct SoftPro reads and writes still need vendor access and connector development.",
    requirements: [
      "SoftPro Select is confirmed; verify build, hosting arrangement, and administrator.",
      "Verify ProInterface API / SDK entitlement and supported operations.",
      "Map company, order, policy, and document identifiers.",
      "Build and test the supported connection in a vendor sandbox before enabling reviewed writes.",
    ],
    note: "Deferred until vendor access is available. Connections currently records manually verified setup, proposals and outcomes; it does not synchronize with SoftPro.",
    url: "https://www.softprocorp.com/real-estate-software-solutions/softpro-select/",
  },
  {
    name: "Missive",
    initials: "MI",
    color: "blue",
    status: "Shared workspace only",
    statusColor: "blue",
    action: "View setup steps",
    description:
      "Reviewed incoming email and attachment imports are built for the shared workspace. Sample mode does not connect to Missive.",
    requirements: [
      "Map authorized shared mailboxes to their company profiles.",
      "Keep the personal bearer token on the server and restrict account access.",
      "Check the connection, preview incoming messages and choose the correct title file before importing.",
      "Review original attachments and the imported record before using them in a file.",
    ],
    note: "The shared workspace shows the actual Missive connection status above. Outgoing drafts, sends and scheduled polling are not implemented.",
    url: "https://missiveapp.com/docs/developers/rest-api",
  },
  {
    name: "Docusign",
    initials: "D",
    color: "violet",
    status: "Account setup needed",
    statusColor: "blue",
    action: "View setup steps",
    description: "Connect a company account, load approved templates, prepare reviewed drafts and check envelope status in the shared workspace.",
    requirements: [
      "Create a DocuSign developer app and have its integration key and secret installed on the server.",
      "Register the pilot callback address, then connect the intended DocuSign account to the title company.",
      "Test an approved template and its recipient roles in the sandbox before completing production Go-Live.",
      "Prepare the draft here; review and send it in DocuSign. Check its recorded status here afterwards.",
    ],
    note: "Live account acceptance is pending vendor credentials. Draft preparation does not send an envelope. Automatic completed-document retrieval and status webhooks are not included.",
    url: "https://developers.docusign.com/docs/esign-rest-api/",
  },
  {
    name: "QuickBooks",
    initials: "qb",
    color: "green",
    status: "Account setup needed",
    statusColor: "blue",
    action: "View setup steps",
    description: "Connect each company’s QuickBooks Online account and review dated Profit and Loss reports with the chosen accounting basis.",
    requirements: [
      "Create an Intuit developer app and have its client ID and secret installed on the server.",
      "Register the pilot callback address and authorize the correct QuickBooks realm for each title company.",
      "Compare a sandbox report against the same period and Cash or Accrual basis in QuickBooks.",
      "Finish Intuit’s production requirements, install production credentials and reconnect the live company.",
    ],
    note: "Live account acceptance is pending vendor credentials. Reports are read-only and do not post to a close, ledger or remittance record. CSV preview remains available in Financials.",
    url: "https://developer.intuit.com/app/developer/qbo/docs/develop",
  },
  {
    name: "SoftPro 360",
    initials: "360",
    color: "teal",
    status: "Vendor access needed",
    statusColor: "amber",
    action: "View next steps",
    description: "CPL and policy handoff tracking is available. Automated underwriter requests and returned documents are not connected.",
    requirements: [
      "Confirm existing 360 integrations and underwriter authority.",
      "Verify jacket, endorsement, final-policy image, and remittance workflows.",
      "Keep provider confirmations distinct from local preparation.",
      "Do not automate another person’s credentials or MFA.",
    ],
    note: "Existing underwriter channels remain in SoftPro. This app records preparation and human-reported outcomes; it does not issue jackets or CPLs through a provider.",
    url: "https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/",
  },
];
export function PartnerPortal() {
  const { s, connection } = useWorkspace();
  const isPartner = connection?.access.role === "partner";
  const [company, setCompany] = useState(s.companies[0]?.id || "");
  const [tab, setTab] = useState("Overview");
  const [month, setMonth] = useState(() => reportingDate().period);
  const currentPeriod = reportingDate().period;
  const c = s.companies.find((x) => x.id === company) || s.companies[0];
  if (!c)
    return (
      <section className="panel empty-state">
        <h2>No company access assigned</h2>
        <p>Your company documents will appear here after access is assigned.</p>
      </section>
    );
  const summary = isPartner
    ? selectPartnerSummary(s.partnerSummary, c.id, month)
    : summarizePartnerCompany(s, c.id, month);
  const previewPeriod = isPartner ? undefined : partnerPeriod(s, c.id, month);
  const orders = previewPeriod?.orders || [];
  const activeTab = isPartner && tab === "Orders" ? "Overview" : tab;
  const asOfDate = isPartner
    ? s.partnerSummary?.asOfDate
    : `${currentPeriod}-${reportingDate().day.padStart(2, "0")}`;
  return (
    <>
      <Heading
        title="Partner portal"
        description="A company’s view of its documents and business."
      >
        <span className="subtle-pill">
          <EyeIcon />
          {isPartner ? "Shared with you" : "Preview only"}
        </span>
        <Input
          type="month"
          aria-label="Partner reporting month"
          value={month}
          max={currentPeriod}
          onChange={(e) => setMonth(e.target.value)}
        />
        <Picker
          value={c.id}
          onChange={setCompany}
          label={isPartner ? "Your company" : "Preview company"}
          options={s.companies.map((x) => ({ value: x.id, label: x.name }))}
        />
      </Heading>
      <div className="partner-welcome">
        <CompanyAvatar company={c} large />
        <div>
          <p className="eyebrow">YOUR COMPANY WORKSPACE</p>
          <h2>{c.name}</h2>
          <p>{isPartner ? "Company activity, your statements, and shared documents." : `Welcome back, ${c.contact.split(" ")[0] || "partner"}.`}</p>
        </div>
        <Status value={c.stage} />
      </div>
      {summary ? (
        <>
          <div className="metrics partner-metrics">
            <Metric label="Received orders" value={summary.received} detail="Receipt dates in this month" />
            <Metric label="Pending orders" value={summary.pending} detail={month === asOfDate?.slice(0, 7) ? `As of ${asOfDate}` : "At the end of this month"} />
            <Metric label="Recorded closings" value={summary.closingRecorded} detail="Closing events in this month" />
            <Metric label="Rejected orders" value={summary.rejected} detail="Rejection events in this month" />
            <Metric label="Recovered orders" value={summary.recovered} detail="Recovery events in this month" />
            <Metric label="Lost recoveries" value={summary.lost} detail="Lost events in this month" />
          </div>
          <p className="inline-note">
            Each event count includes a file once per month; a file can appear in more than one count.
            Pending includes dated receipts awaiting a recorded closing, excluding rejected or lost files.
            Files without a receipt date are excluded from received and pending totals.
          </p>
        </>
      ) : (
        <section className="panel partner-panel">
          <Empty
            title={month ? "Activity summary unavailable" : "Select a reporting month"}
            text={month ? "No activity summary is available for this company and period. Published statements and shared documents remain below." : "Choose a month to see the company’s recorded activity."}
          />
        </section>
      )}
      <Segments
        value={activeTab}
        onChange={setTab}
        items={isPartner ? ["Overview", "Statements", "Shared documents"] : ["Overview", "Statements", "Shared documents", "Orders"]}
      />
      {activeTab === "Statements" ? (
        <PartnerStatements key={c.id} companyId={c.id} />
      ) : activeTab === "Shared documents" ? (
        <PartnerDocuments key={c.id} companyId={c.id} />
      ) : isPartner ? (
        <section className="panel partner-panel">
          <div className="section-heading"><h2>Company activity</h2><span className="subtle">{c.name} only</span></div>
          <p>Activity totals reflect the team’s recorded receipt, closing, and recovery events. A recorded closing is separate from policy issuance.</p>
          <p>Your individual earnings appear under Statements after the team publishes a reviewed financial close. Company materials appear under Shared documents.</p>
        </section>
      ) : (
        <section className="panel partner-panel">
          <div className="section-heading">
            <h2>{activeTab === "Overview" ? "Period business" : "Company orders"}</h2>
            <span className="subtle">{c.name} only</span>
          </div>
          <DataTable headers={["Order", "Property", "Status", "Next update"]}>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{o.id}</TableCell>
                <TableCell>{o.address}</TableCell>
                <TableCell><Status value={o.status} /></TableCell>
                <TableCell>{o.status === "Rejected" ? "Team reviewing outcome" : o.status === "Issued" ? "Completed" : "Closing team is preparing the file"}</TableCell>
              </TableRow>
            ))}
          </DataTable>
          {!orders.length && <Empty title="No orders in this period" />}
        </section>
      )}
      <p className="inline-note">
        {isPartner
          ? "Company totals are limited to your current membership assignments. Statements and documents appear only when published to you."
          : "Administrator preview. Earnings appear after a reviewed financial close is published."}
      </p>
    </>
  );
}
function EyeIcon() {
  return <UsersRound size={14} />;
}
export function Settings() {
  const {
    s,
    update,
    reset,
    restore,
    connection: sharedConnection,
  } = useWorkspace();
  const [tab, setTab] = useState(sharedConnection ? "Account" : "Connections");
  const workspaceAdmin = !!sharedConnection && (sharedConnection.access.role === "owner" || (sharedConnection.access.role === "admin" && sharedConnection.access.allCompanies));
  const [connection, setConnection] = useState<
    (typeof integrations)[number] | null
  >(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<WorkspaceBackup | null>(
    null,
  );
  const [restoreBusy, setRestoreBusy] = useState(false);
  const backupFileRef = useRef<HTMLInputElement>(null);
  async function handleExportBackup() {
    setBackupBusy(true);
    try {
      const result = await exportFullBackup(s);
      if (result.missing.length)
        toast.warning(
          `Backup saved. ${result.missing.length} file${result.missing.length === 1 ? "" : "s"} could not be read from this browser and were left out: ${result.missing.join(", ")}.`,
        );
      else
        toast.success(
          `Full backup saved with ${result.saved} file${result.saved === 1 ? "" : "s"}.`,
        );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not prepare the backup.",
      );
    } finally {
      setBackupBusy(false);
    }
  }
  async function handleBackupFileChosen(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_FILE_BYTES)
        throw new Error("Choose a local backup file up to 96 MB.");
      const backup = parseBackupFile(await file.text());
      setPendingRestore(backup);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not read this backup file.",
      );
    }
  }
  async function confirmRestore() {
    if (!pendingRestore) return;
    setRestoreBusy(true);
    try {
      await restore(pendingRestore.workspace, pendingRestore.assets);
      setPendingRestore(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not restore this backup's files. Nothing was changed.",
      );
    } finally {
      setRestoreBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Workspace settings"
        description="Your team, connections, and operating standards."
      />
      <Segments
        value={tab}
        onChange={setTab}
        items={sharedConnection ? ["Account", "Connections", "Team & access", ...(workspaceAdmin ? ["Recovery"] : []), ...(sharedConnection.access.role !== "partner" ? ["Jurisdictions", "Activity"] : [])] : ["Connections", "Team & access", "Jurisdictions", "Activity", "Demo workspace"]}
      />
      {sharedConnection && ["Account", "Connections", "Team & access", "Recovery"].includes(tab) && <BackendSettings key={`${tab}:${sharedConnection.access.version}`} section={tab as BackendSettingsSection} />}
      {tab === "Connections" && (
        <>
          <div className="settings-intro">
            <h2>Tools & integrations</h2>
            <p>
              {sharedConnection ? "Document reading and reviewed field suggestions are available now. Missive's actual connection status is shown above to workspace administrators. Each card explains what you can use today and what still needs work." : "Document reading and reviewed field suggestions work with local sample files. Vendor accounts connect through the shared workspace; each card explains what is available and what still needs work."}
            </p>
          </div>
          <div className="integration-grid">
            {integrations.filter((i) => !sharedConnection || !["Missive", "Docusign", "QuickBooks"].includes(i.name)).map((i) => (
              <section className="panel integration-card" key={i.name} aria-label={i.name}>
                <div>
                  <span className={`integration-logo ${i.color}`}>
                    {i.initials}
                  </span>
                  <span className={`status ${i.statusColor}`}>{i.status}</span>
                </div>
                <h3>{i.name}</h3>
                <p>{i.description}</p>
                <Button variant="outline" onClick={() => setConnection(i)}>
                  {i.action}
                  <ArrowUpRight />
                </Button>
              </section>
            ))}
          </div>
        </>
      )}
      {!sharedConnection && tab === "Team & access" && (
        <>
          <div className="notice">
            <LockKeyhole size={18} />
            <p>
              These are demo identities for workflow review. Switching a person
              changes the active workspace persona, not authentication or data
              permissions.
            </p>
          </div>
          <section className="panel">
            <DataTable
              headers={["Person", "Responsibilities", "Demo role", ""]}
            >
              {[
                {
                  name: "Stephenie",
                  role: "Company administrator",
                  work: "Onboarding, company records, branding",
                },
                {
                  name: "Tyler",
                  role: "Policy operations",
                  work: "Order intake, preparation, exceptions",
                },
                {
                  name: "John",
                  role: "Operations lead",
                  work: "Licensing, underwriting, financial review",
                },
              ].map((p) => (
                <TableRow key={p.name}>
                  <TableCell>
                    <span className="person-inline">
                      <span className="avatar">{p.name[0]}</span>
                      <strong>{p.name}</strong>
                    </span>
                  </TableCell>
                  <TableCell>{p.work}</TableCell>
                  <TableCell>{p.role}</TableCell>
                  <TableCell>
                    <Button
                      variant={s.user === p.name ? "secondary" : "outline"}
                      size="sm"
                      disabled={!!sharedConnection || s.user === p.name}
                      onClick={async () =>
                        await update(
                          (d) => {
                            d.user = p.name;
                          },
                          "Demo persona changed",
                          p.name,
                        )
                      }
                    >
                      {s.user === p.name
                        ? "Current persona"
                        : "Preview persona"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </section>
          <section className="panel permission-matrix">
            <div className="section-heading">
              <h2>Planned access boundaries</h2>
            </div>
            <DataTable
              headers={["Record type", "Internal team", "Company partner"]}
            >
              {[
                [
                  "Company materials",
                  "Assigned companies",
                  "Published versions only",
                ],
                [
                  "Applications / identity records",
                  "Specifically authorized staff",
                  "No access",
                ],
                [
                  "Policy source documents",
                  "Assigned operations staff",
                  "Approved status summaries",
                ],
                [
                  "Financial close",
                  "Authorized finance reviewers",
                  "Approved company statements",
                ],
              ].map((row) => (
                <TableRow key={row[0]}>
                  {row.map((x) => (
                    <TableCell key={x}>{x}</TableCell>
                  ))}
                </TableRow>
              ))}
            </DataTable>
          </section>
        </>
      )}
      {tab === "Jurisdictions" && (
        <>
          <div className="settings-intro flex-intro">
            <div>
              <h2>Built for the Carolinas. Ready to expand.</h2>
              <p>
                Operational templates must be reviewed for each state before
                live use.
              </p>
            </div>
            {(!sharedConnection || workspaceAdmin) && <Button variant="outline" onClick={() => setStateOpen(true)}>
              <Plus />
              Plan another state
            </Button>}
          </div>
          <div className="jurisdiction-grid">
            {[
              {
                code: "NC",
                name: "North Carolina",
                notes: [
                  "Track agency and individual producer credentials separately.",
                  "Record the independent attorney opinion and review reference.",
                  "Keep underwriter authority and formation records distinct.",
                ],
                url: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-26-1.html",
              },
              {
                code: "SC",
                name: "South Carolina",
                notes: [
                  "Track agency, title producer, and financial-interest disclosures.",
                  "Record supervising attorney and review evidence.",
                  "Verify state-specific premium and commission terms.",
                ],
                url: "https://www.scstatehouse.gov/code/t38c075.php",
              },
            ].map((j) => (
              <section className="panel jurisdiction-card" key={j.code}>
                <span className="state-code">{j.code}</span>
                <h3>{j.name}</h3>
                <Status value="Review before launch" />
                <ul>
                  {j.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <a href={j.url} target="_blank" rel="noreferrer">
                  Official source
                  <ExternalLink size={13} />
                </a>
              </section>
            ))}
            {(s.expansionStates || []).map((name) => (
              <section className="panel jurisdiction-card" key={name}>
                <MapPin />
                <h3>{name}</h3>
                <Status value="Planning" />
                <p>
                  Assign a qualified reviewer, collect official requirements,
                  and version the operational template before activation.
                </p>
              </section>
            ))}
          </div>
        </>
      )}
      {tab === "Activity" && (
        <section className="panel activity-panel">
          <div className="section-heading">
            <h2>Workspace activity</h2>
            <Button
              variant="ghost"
              onClick={() =>
                exportCsv("titleos-activity.csv", [
                  ["Time", "Actor", "Event", "Detail"],
                  ...s.activity.map((a) => [a.at, a.actor, a.title, a.detail]),
                ])
              }
            >
              <Download />
              Export
            </Button>
          </div>
          {s.activity.map((a) => (
            <div className="audit-row" key={a.id}>
              <span className="audit-icon">
                <Activity size={16} />
              </span>
              <div className="grow">
                <strong>{a.title}</strong>
                <p>{a.detail}</p>
              </div>
              <span>
                {a.actor}
                <small>{new Date(a.at).toLocaleString()}</small>
              </span>
            </div>
          ))}
          {!s.activity.length && <Empty title="No recorded activity" text="Changes visible to your account will appear here." />}
        </section>
      )}
      {!sharedConnection && tab === "Demo workspace" && (
        <section className="panel demo-settings">
          <h2>Local preview</h2>
          <p>
            Fictional business records are saved in this browser. Uploaded
            sample files use browser storage. There is no live authentication,
            external synchronization, document extraction service, or automated
            policy issuance.
          </p>
          <p>
            Use redacted samples only. Local sample data stays separate from the
            authenticated shared workspace and its server recovery points.
          </p>
          <div className="settings-actions">
            <Button
              variant="outline"
              onClick={() =>
                download(
                  "titleos-local-workspace.json",
                  JSON.stringify({ demo: true, ...s }, null, 2),
                  "application/json",
                )
              }
            >
              <Download />
              Export demo records
            </Button>
            <Button
              variant="outline"
              disabled={backupBusy}
              onClick={handleExportBackup}
            >
              <Download />
              {backupBusy ? "Preparing backup…" : "Export full backup"}
            </Button>
            <Button
              variant="outline"
              onClick={() => backupFileRef.current?.click()}
            >
              <Upload />
              Restore from backup
            </Button>
            <input
              ref={backupFileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={handleBackupFileChosen}
            />
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              Reset sample workspace
            </Button>
          </div>
          <p className="inline-note">
            Export demo records saves metadata and sample text only. Export
            full backup also bundles every uploaded file into the same
            downloaded file, so browser storage is not the only copy of
            anything — use it before clearing browser data, switching browsers,
            or moving to a new computer. Restore from backup only accepts a
            file made by Export full backup and replaces everything currently
            in this browser; the confirmation step shows what it contains first,
            and the resulting toast offers Undo.
          </p>
        </section>
      )}
      <Dialog
        open={!!connection}
        onOpenChange={(v) => !v && setConnection(null)}
      >
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>{connection?.name}</DialogTitle>
            <DialogDescription>
              {connection?.description}
            </DialogDescription>
          </DialogHeader>
          <ol className="connection-checklist">
            {connection?.requirements.map((r) => (
              <li key={r}>
                <span>
                  <Check size={14} />
                </span>
                {r}
              </li>
            ))}
          </ol>
          <p className="form-note">
            {connection?.note}
          </p>
          {connection?.url && <Button asChild variant="outline">
            <a href={connection?.url} target="_blank" rel="noreferrer">
              Read official documentation
              <ExternalLink />
            </a>
          </Button>}
        </DialogContent>
      </Dialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the sample workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Restore the original fictional records. Export anything you want
              to keep first. The confirmation toast offers Undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>Reset demo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!pendingRestore}
        onOpenChange={(v) => !v && setPendingRestore(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRestore && (
                <>
                  Exported{" "}
                  {new Date(pendingRestore.exportedAt).toLocaleString()}
                  {" · "}
                  {pendingRestore.workspace.companies.length} companies,{" "}
                  {pendingRestore.workspace.orders.length} files,{" "}
                  {pendingRestore.assets.length} uploaded document
                  {pendingRestore.assets.length === 1 ? "" : "s"}. This replaces
                  everything currently in this browser. The confirmation toast
                  offers Undo.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!!pendingRestore?.missingAssets.length && (
            <div className="notice warning">
              <p>
                {pendingRestore.missingAssets.length} document
                {pendingRestore.missingAssets.length === 1 ? "" : "s"} had no
                readable file when this backup was made and will stay file-less
                after restoring:{" "}
                {pendingRestore.missingAssets.map((m) => m.name).join(", ")}.
                Re-attach each file afterward if needed.
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreBusy}>Cancel</AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: Radix's Action closes
                the dialog on click, but this confirm is async and should
                keep the dialog open (with a busy label) until it settles. */}
            <Button disabled={restoreBusy} onClick={confirmRestore}>
              {restoreBusy ? "Restoring…" : "Restore backup"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={stateOpen} onOpenChange={setStateOpen}>
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>Plan another state</DialogTitle>
            <DialogDescription>
              Create an expansion placeholder. No operational checklist is
              activated.
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const value = String(
                new FormData(e.currentTarget).get("state"),
              ).trim();
              if (value) {
                if (
                  !(await update(
                    (d) => {
                      d.expansionStates = Array.from(
                        new Set([...(d.expansionStates || []), value]),
                      );
                    },
                    "Expansion state added",
                    value,
                  ))
                )
                  return;
                setStateOpen(false);
              }
            }}
          >
            <FieldLabel label="State name">
              <Input
                name="state"
                required
                maxLength={60}
                placeholder="e.g. Virginia"
              />
            </FieldLabel>
            <Button type="submit">Add to expansion plan</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
