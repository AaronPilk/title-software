"use client";
import { PartnerStatements } from "./close-suite";
import { PartnerDocuments } from "./partner-documents";
import { partnerPeriod } from "@/lib/title/followups";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Link2,
  LockKeyhole,
  MapPin,
  Plus,
  Settings2,
  ShieldCheck,
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
  restoreAssets,
  type WorkspaceBackup,
} from "@/lib/title/store";
import { money, type VaultDoc } from "@/lib/title/model";
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
    name: "SoftPro",
    initials: "SP",
    color: "blue",
    description: "Orders, document attachments, and policy preparation.",
    requirements: [
      "SoftPro Select is confirmed; verify build, hosting arrangement, and administrator.",
      "Verify ProInterface API / SDK entitlement and supported operations.",
      "Map company, order, policy, and document identifiers.",
      "Start with read-only sandbox access; writeback requires review.",
    ],
    url: "https://www.softprocorp.com/real-estate-software-solutions/softpro-select/",
  },
  {
    name: "Missive",
    initials: "MI",
    color: "blue",
    description:
      "Attorney requests, final attachments, and reviewed reply drafts.",
    requirements: [
      "Map authorized shared mailboxes to their company profiles.",
      "Keep the personal bearer token on the server and restrict account access.",
      "Deduplicate conversation/message events and recheck reply threading.",
      "Create drafts with attachments; omit send and send_at until separately enabled.",
    ],
    url: "https://missiveapp.com/docs/developers/rest-api",
  },
  {
    name: "Docusign",
    initials: "D",
    color: "violet",
    description: "Welcome letters, applications, and signature status.",
    requirements: [
      "Use an approved application template without exposing sensitive fields.",
      "Confirm plan eligibility and production integration type.",
      "Configure OAuth, callbacks, and envelope status webhooks.",
      "Store references and approved completed documents in the vault.",
    ],
    url: "https://developers.docusign.com/docs/esign-rest-api/",
  },
  {
    name: "QuickBooks",
    initials: "qb",
    color: "green",
    description: "Company accounting and month-end report imports.",
    requirements: [
      "Confirm John’s actual accounting software first.",
      "Map each authorized company to its QuickBooks realm.",
      "Use an allowlist of read operations for initial report imports.",
      "Do not enable payments or bank transaction execution.",
    ],
    url: "https://developer.intuit.com/app/developer/qbo/docs/develop",
  },
  {
    name: "SoftPro 360",
    initials: "360",
    color: "teal",
    description: "WFG and agentTRAX underwriter workflows.",
    requirements: [
      "Confirm existing 360 integrations and underwriter authority.",
      "Verify jacket, endorsement, final-policy image, and remittance workflows.",
      "Keep provider confirmations distinct from local preparation.",
      "Do not automate another person’s credentials or MFA.",
    ],
    url: "https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/",
  },
  {
    name: "Document intelligence",
    initials: "AI",
    color: "amber",
    description: "Extract candidate fields with page-level evidence.",
    requirements: [
      "Evaluate a redacted NC and SC document set.",
      "Measure exact-match accuracy by field and exception type.",
      "Choose an approved data-processing and retention arrangement.",
      "Keep source excerpts immutable and require professional review.",
    ],
    url: "https://www.alta.org/business-tools/best-practices",
  },
];
export function PartnerPortal({ onDoc }: { onDoc: (d: VaultDoc) => void }) {
  const { s } = useWorkspace();
  const [company, setCompany] = useState(s.companies[0].id);
  const [tab, setTab] = useState("Overview");
  const [month, setMonth] = useState("2026-09");
  const c = s.companies.find((x) => x.id === company) || s.companies[0];
  const period = partnerPeriod(s, c.id, month);
  const orders = period.orders;
  return (
    <>
      <Heading
        title="Partner portal"
        description="A company’s view of its documents and business."
      >
        <span className="subtle-pill">
          <EyeIcon />
          Preview only
        </span>
        <Input
          type="month"
          aria-label="Partner reporting month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <Picker
          value={c.id}
          onChange={setCompany}
          label="Preview company"
          options={s.companies.map((x) => ({ value: x.id, label: x.name }))}
        />
      </Heading>
      <div className="partner-welcome">
        <CompanyAvatar company={c} large />
        <div>
          <p className="eyebrow">YOUR COMPANY WORKSPACE</p>
          <h2>{c.name}</h2>
          <p>Welcome back, {c.contact.split(" ")[0]}.</p>
        </div>
        <Status value={c.stage} />
      </div>
      <div className="metrics partner-metrics">
        <Metric
          label="Received orders"
          value={period.received.length}
          detail="Recorded receipt dates"
        />
        <Metric
          label="Issued orders"
          value={period.issued.length}
          detail="Orders with issuance this month"
        />
        <Metric
          label="Rejected orders"
          value={period.rejected.length}
          detail="Dated rejection events"
        />
        <Metric
          label="Recovered orders"
          value={period.recovered.length}
          detail="Dated recovery events"
        />
        <Metric
          label="Recorded closings"
          value={period.closed.length}
          detail="Independent of policy issuance"
        />
      </div>
      {period.unknownReceived > 0 && (
        <p className="inline-note">
          {period.unknownReceived} legacy records have no receipt date and are
          excluded from received counts. Business rows include a recorded
          receipt, issuance or outcome in the selected month.
        </p>
      )}
      <Segments
        value={tab}
        onChange={setTab}
        items={["Overview", "Statements", "Shared documents", "Orders"]}
      />
      {tab === "Statements" ? (
        <PartnerStatements key={c.id} companyId={c.id} />
      ) : tab === "Shared documents" ? (
        <PartnerDocuments key={c.id} companyId={c.id} />
      ) : (
        <section className="panel partner-panel">
          <div className="section-heading">
            <h2>{tab === "Overview" ? "Period business" : "Company orders"}</h2>
            <span className="subtle">{c.name} only</span>
          </div>
          <DataTable headers={["Order", "Property", "Status", "Next update"]}>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{o.id}</TableCell>
                <TableCell>{o.address}</TableCell>
                <TableCell>
                  <Status value={o.status} />
                </TableCell>
                <TableCell>
                  {o.status === "Rejected"
                    ? "Team reviewing outcome"
                    : o.status === "Issued"
                      ? "Completed"
                      : "Closing team is preparing the file"}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
          {!orders.length && <Empty title="No orders in this period" />}
        </section>
      )}
      <p className="inline-note">
        This is an administrator’s local preview, not a signed-in partner
        account. Production will enforce company access on the server. Earnings
        will appear only after an approved financial close.
      </p>
    </>
  );
}
function EyeIcon() {
  return <UsersRound size={14} />;
}
export function Settings() {
  const { s, update, reset, restore } = useWorkspace();
  const [tab, setTab] = useState("Connections");
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
      await restoreAssets(pendingRestore.assets);
      restore(pendingRestore.workspace);
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
        items={[
          "Connections",
          "Team & access",
          "Jurisdictions",
          "Activity",
          "Demo workspace",
        ]}
      />
      {tab === "Connections" && (
        <>
          <div className="settings-intro">
            <h2>Connect the systems behind your work.</h2>
            <p>
              All connections are currently disconnected. Review each
              integration plan before connecting live services.
            </p>
          </div>
          <div className="integration-grid">
            {integrations.map((i) => (
              <section className="panel integration-card" key={i.name}>
                <div>
                  <span className={`integration-logo ${i.color}`}>
                    {i.initials}
                  </span>
                  <Status value="Not connected" />
                </div>
                <h3>{i.name}</h3>
                <p>{i.description}</p>
                <Button variant="outline" onClick={() => setConnection(i)}>
                  View connection plan
                  <ArrowUpRight />
                </Button>
              </section>
            ))}
          </div>
        </>
      )}
      {tab === "Team & access" && (
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
                      disabled={s.user === p.name}
                      onClick={() =>
                        update(
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
            <Button variant="outline" onClick={() => setStateOpen(true)}>
              <Plus />
              Plan another state
            </Button>
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
        </section>
      )}
      {tab === "Demo workspace" && (
        <section className="panel demo-settings">
          <h2>Local preview</h2>
          <p>
            Fictional business records are saved in this browser. Uploaded
            sample files use browser storage. There is no live authentication,
            external synchronization, document extraction service, or automated
            policy issuance.
          </p>
          <p>
            Use redacted samples only. A backend, access enforcement, backups,
            and approved vendor connections will be added after the product
            review.
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
            "Export demo records" saves metadata and sample text only.
            "Export full backup" also bundles every uploaded file's bytes into
            the same downloaded file, so this browser's storage is not the
            only copy of anything — use it before clearing browser data,
            switching browsers, or moving to a new computer. "Restore from
            backup" only accepts a file made by "Export full backup" and
            replaces everything currently in this browser; the confirmation
            step shows what it contains first, and the resulting toast offers
            Undo.
          </p>
        </section>
      )}
      <Dialog
        open={!!connection}
        onOpenChange={(v) => !v && setConnection(null)}
      >
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>{connection?.name} connection plan</DialogTitle>
            <DialogDescription>
              Requirements for the later integration phase.
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
            No account has been connected and no credentials are requested in
            this MVP.
          </p>
          <Button asChild variant="outline">
            <a href={connection?.url} target="_blank" rel="noreferrer">
              Read official documentation
              <ExternalLink />
            </a>
          </Button>
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
                  Exported {new Date(pendingRestore.exportedAt).toLocaleString()}
                  {" · "}
                  {pendingRestore.workspace.companies.length} companies,{" "}
                  {pendingRestore.workspace.orders.length} files,{" "}
                  {pendingRestore.assets.length} uploaded document
                  {pendingRestore.assets.length === 1 ? "" : "s"}. This
                  replaces everything currently in this browser. The
                  confirmation toast offers Undo.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!!pendingRestore?.missingAssets.length && (
            <div className="notice warning">
              <p>
                {pendingRestore.missingAssets.length} document
                {pendingRestore.missingAssets.length === 1 ? "" : "s"} had no
                readable file when this backup was made and will stay
                file-less after restoring:{" "}
                {pendingRestore.missingAssets.map((m) => m.name).join(", ")}.
                Re-attach the file on each one afterward if it's needed.
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreBusy}>
              Cancel
            </AlertDialogCancel>
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
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(
                new FormData(e.currentTarget).get("state"),
              ).trim();
              if (value) {
                update(
                  (d) => {
                    d.expansionStates = Array.from(
                      new Set([...(d.expansionStates || []), value]),
                    );
                  },
                  "Expansion state added",
                  value,
                );
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
