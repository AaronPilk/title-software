"use client";
import { useState } from "react";
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
import { useWorkspace, download, exportCsv } from "@/lib/title/store";
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
  const c = s.companies.find((x) => x.id === company) || s.companies[0];
  const orders = s.orders.filter(
    (o) => o.companyId === c.id && o.month === "2026-09",
  );
  const docs = s.documents.filter(
    (d) =>
      d.companyId === c.id &&
      d.visibility === "Partner" &&
      !s.documents.some(
        (x) =>
          x.companyId === d.companyId &&
          x.name === d.name &&
          x.version > d.version,
      ),
  );
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
          label="September orders"
          value={orders.length}
          detail="All received orders"
        />
        <Metric
          label="Closed / issued"
          value={orders.filter((o) => o.status === "Issued").length}
          detail="Demo issued policies"
        />
        <Metric
          label="Rejected orders"
          value={orders.filter((o) => o.status === "Rejected").length}
          detail="Follow-up opportunities"
        />
        <Metric
          label="Shared documents"
          value={docs.length}
          detail="Published to this company"
        />
      </div>
      <Segments
        value={tab}
        onChange={setTab}
        items={["Overview", "Shared documents", "Orders"]}
      />
      {tab === "Shared documents" ? (
        <section className="panel partner-panel">
          {docs.map((d) => (
            <button
              key={d.id}
              className="doc-list-row"
              onClick={() => onDoc(d)}
            >
              <FileText size={22} />
              <div className="grow">
                <strong>{d.name}</strong>
                <small>
                  {d.category} · Version {d.version}
                </small>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          {!docs.length && (
            <Empty
              title="No published documents"
              text="The team will share approved company materials here."
            />
          )}
        </section>
      ) : (
        <section className="panel partner-panel">
          <div className="section-heading">
            <h2>
              {tab === "Overview" ? "September business" : "Company orders"}
            </h2>
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
          {!orders.length && <Empty title="No September orders" />}
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
  const { s, update, reset } = useWorkspace();
  const [tab, setTab] = useState("Connections");
  const [connection, setConnection] = useState<
    (typeof integrations)[number] | null
  >(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
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
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              Reset sample workspace
            </Button>
          </div>
          <p className="inline-note">
            The export contains metadata and sample text. Uploaded binary files
            remain in browser storage and must be downloaded from the vault
            separately.
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
