"use client";
import { useState } from "react";
import {
  Building2,
  Plus,
  ChevronRight,
  Check,
  ArrowRight,
  Mail,
  MapPin,
  FolderClosed,
  UsersRound,
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
  Picker,
  Status,
  CompanyAvatar,
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
  const { s } = useWorkspace();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All companies");
  const rows = s.companies.filter(
    (c) =>
      (filter === "All companies" || c.stage === filter) &&
      `${c.name} ${c.contact} ${c.jurisdiction}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Companies"
        description="A home for every company in your portfolio."
      >
        <Button onClick={onNew}>
          <Plus />
          Add company
        </Button>
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
              <CompanyAvatar company={c} large />
              <Status value={c.stage} />
            </div>
            <h2>{c.name}</h2>
            <p>
              <MapPin size={13} />
              {c.location} · {c.jurisdiction}
            </p>
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
              <span>{c.contact}</span>
              <ChevronRight size={16} />
            </div>
          </button>
        ))}
        <button className="add-company-card" onClick={onNew}>
          <span>
            <Plus size={22} />
          </span>
          <strong>A new beginning</strong>
          <p>Add your next title company</p>
        </button>
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
  const { update } = useWorkspace();
  const [state, setState] = useState("NC");
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim(),
      contact = String(f.get("contact")).trim();
    if (!name || !contact) {
      toast.error("Enter a company name and contact.");
      return;
    }
    update(
      (d) => {
        const id = uid("company");
        d.companies.unshift({
          id,
          name,
          initials: name
            .split(" ")
            .slice(0, 2)
            .map((x) => x[0])
            .join("")
            .toUpperCase(),
          color: ["teal", "blue", "violet", "amber", "rose"][
            d.companies.length % 5
          ],
          contact,
          email: String(f.get("email")),
          location: String(f.get("city")),
          jurisdiction: state,
          stage: "Onboarding",
          steps: Array(7).fill(false),
          members: [],
        });
        d.tasks.unshift({
          id: uid("task"),
          title: "Collect onboarding application",
          companyId: id,
          owner: "Stephenie",
          due: "2026-09-15",
          priority: "Normal",
          done: false,
        });
      },
      "Company added",
      `${name} · onboarding started`,
    );
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>
            Create a demo company workspace and onboarding checklist.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <FieldLabel label="Company name">
            <Input
              name="name"
              required
              maxLength={100}
              placeholder="e.g. Magnolia Title"
            />
          </FieldLabel>
          <div className="form-grid">
            <FieldLabel label="Primary contact">
              <Input
                name="contact"
                required
                maxLength={100}
                placeholder="Full name"
              />
            </FieldLabel>
            <FieldLabel label="Contact email">
              <Input
                name="email"
                type="email"
                required
                placeholder="name@example.com"
              />
            </FieldLabel>
            <FieldLabel label="City">
              <Input
                name="city"
                required
                placeholder="e.g. Raleigh"
                maxLength={100}
              />
            </FieldLabel>
            <FieldLabel label="Initial operating state">
              <Picker
                value={state}
                onChange={setState}
                label="Initial operating state"
                options={["NC", "SC"]}
              />
            </FieldLabel>
          </div>
          <p className="form-note">
            This starts an internal checklist. It does not create an LLC, obtain
            an EIN, or submit a license application.
          </p>
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create workspace</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function CompanyDetail({
  id,
  onClose,
  onDoc,
  onUpload,
}: {
  id: string;
  onClose: () => void;
  onDoc: (doc: VaultDoc) => void;
  onUpload: (id: string) => void;
}) {
  const { s, update } = useWorkspace();
  const [tab, setTab] = useState("Overview");
  const c = s.companies.find((x) => x.id === id);
  if (!c) return null;
  const docs = s.documents.filter((d) => d.companyId === id);
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="detail-sheet company-detail">
        <SheetHeader>
          <CompanyAvatar company={c} large />
          <SheetTitle>{c.name}</SheetTitle>
          <SheetDescription>
            {c.location} · {c.jurisdiction}
          </SheetDescription>
        </SheetHeader>
        <div className="sheet-body">
          <Segments
            value={tab}
            onChange={setTab}
            items={["Overview", "Documents", "Members", "Jurisdictions"]}
          />
          {tab === "Overview" && (
            <>
              <div className="detail-grid">
                <div>
                  <small>Primary contact</small>
                  <strong>{c.contact}</strong>
                </div>
                <div>
                  <small>Contact email</small>
                  <strong>{c.email}</strong>
                </div>
                <div>
                  <small>Operating states</small>
                  <strong>
                    {(c.operatingStates || [c.jurisdiction]).join(" · ")}
                  </strong>
                </div>
                <div>
                  <small>Company status</small>
                  <Status value={c.stage} />
                </div>
              </div>
              <div className="checklist-title">
                <h3>Onboarding checklist</h3>
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
              <div className="checklist">
                {onboardingSteps.map((step, i) => (
                  <label key={step}>
                    <Checkbox
                      checked={c.steps[i]}
                      onCheckedChange={(v) =>
                        update(
                          (d) => {
                            const company = d.companies.find(
                              (x) => x.id === id,
                            )!;
                            company.steps[i] = v === true;
                            company.stage = company.steps.every(Boolean)
                              ? "Active"
                              : "Onboarding";
                          },
                          v === true
                            ? "Onboarding step completed"
                            : "Onboarding step reopened",
                          `${c.name} · ${step}`,
                        )
                      }
                    />
                    <span>{step}</span>
                    <small>{onboardingOwner(i)}</small>
                  </label>
                ))}
              </div>
              <div className="notice">
                <Building2 size={17} />
                <p>
                  {c.jurisdiction} checklist is a planning template. State
                  licensing, attorney review, and underwriter evidence need
                  confirmation before launch.
                </p>
              </div>
            </>
          )}
          {tab === "Documents" && (
            <>
              <div className="section-heading">
                <h3>Company documents</h3>
                <Button size="sm" onClick={() => onUpload(id)}>
                  <Plus />
                  Upload
                </Button>
              </div>
              {docs.map((d) => (
                <button
                  key={d.id}
                  className="doc-list-row"
                  onClick={() => onDoc(d)}
                >
                  <FolderClosed size={20} />
                  <div className="grow">
                    <strong>{d.name}</strong>
                    <small>
                      {d.category} · v{d.version}
                    </small>
                  </div>
                  <Status value={d.visibility} />
                  <ChevronRight size={15} />
                </button>
              ))}
              {!docs.length && (
                <Empty
                  title="Your vault is ready"
                  text="Upload the first company document to get started."
                />
              )}
            </>
          )}
          {tab === "Jurisdictions" && <CompanyJurisdictions id={id} />}{" "}
          {tab === "Members" && <CompanyMembers company={c} />}
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
  const { s } = useWorkspace();
  const active = s.companies.filter((c) => c.stage === "Onboarding");
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
        <Button onClick={onNew}>
          <Plus />
          Add company
        </Button>
      </Heading>
      <div className="onboarding-summary">
        <span>
          <strong>{active.length}</strong> in progress
        </span>
        <span>
          <strong>
            {s.companies.filter((c) => c.stage === "Active").length}
          </strong>{" "}
          launched
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
                  <CompanyAvatar company={c} />
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
function CompanyJurisdictions({ id }: { id: string }) {
  const { s, update } = useWorkspace();
  const c = s.companies.find((x) => x.id === id)!;
  const operating = c.operatingStates || [c.jurisdiction];
  const kinds = [
    "Agency license",
    "Producer credential",
    "Underwriter authority",
  ];
  return (
    <>
      <p className="inline-note">
        Formation, operating authority, and each order’s property state are
        separate. Entries below are local administrative tracking, not proof of
        licensure.
      </p>
      <FieldLabel label="Formation state">
        <Picker
          value={c.formationState || c.jurisdiction}
          label="Company formation state"
          options={["NC", "SC"]}
          onChange={(value) =>
            update(
              (d) => {
                d.companies.find((x) => x.id === id)!.formationState = value;
              },
              "Formation state updated",
              c.name,
            )
          }
        />
      </FieldLabel>
      <div className="field-label">
        <span>Operating states</span>
        <div className="operating-states">
          {["NC", "SC"].map((state) => (
            <label key={state}>
              <Checkbox
                checked={operating.includes(state)}
                onCheckedChange={(v) => {
                  if (
                    v !== true &&
                    (operating.length === 1 ||
                      s.orders.some(
                        (o) => o.companyId === id && o.jurisdiction === state,
                      ))
                  ) {
                    toast.error(
                      "Keep at least one operating state and any state with existing orders.",
                    );
                    return;
                  }
                  update(
                    (d) => {
                      const company = d.companies.find((x) => x.id === id)!;
                      company.operatingStates =
                        v === true
                          ? [...new Set([...operating, state])]
                          : operating.filter((x) => x !== state);
                    },
                    "Operating states updated",
                    c.name,
                  );
                }}
              />
              {state === "NC" ? "North Carolina" : "South Carolina"}
            </label>
          ))}
        </div>
      </div>
      {operating.map((state) => (
        <section className="authority-section" key={state}>
          <h3>{state} · Authority records</h3>
          {kinds.map((kind) => {
            const record = c.authorizations?.find(
              (a) => a.state === state && a.kind === kind,
            );
            function save(
              field: "status" | "reference" | "reviewer",
              value: string,
            ) {
              update(
                (d) => {
                  const company = d.companies.find((x) => x.id === id)!;
                  company.authorizations ??= [];
                  let r = company.authorizations.find(
                    (a) => a.state === state && a.kind === kind,
                  );
                  if (!r) {
                    r = {
                      state,
                      kind,
                      status: "Not started",
                      reference: "",
                      reviewer: "John",
                    };
                    company.authorizations.push(r);
                  }
                  r[field] = value;
                },
                "Authority tracking updated",
                `${c.name} · ${state} · ${kind}`,
              );
            }
            return (
              <div className="authority-record" key={kind}>
                <div>
                  <strong>{kind}</strong>
                  <Picker
                    value={record?.status || "Not started"}
                    onChange={(v) => save("status", v)}
                    label={`${state} ${kind} status`}
                    options={["Not started", "In review", "Evidence recorded"]}
                  />
                </div>
                <Input
                  aria-label={`${state} ${kind} evidence reference`}
                  defaultValue={record?.reference || ""}
                  placeholder="Evidence reference or document identifier"
                  onBlur={(e) => {
                    if (e.target.value !== (record?.reference || ""))
                      save("reference", e.target.value);
                  }}
                />
                <div className="authority-reviewer">
                  <span>Assigned reviewer</span>
                  <Picker
                    value={record?.reviewer || "John"}
                    onChange={(v) => save("reviewer", v)}
                    label={`${state} ${kind} reviewer`}
                    options={["John", "Stephenie", "Tyler"]}
                  />
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

function CompanyMembers({ company }: { company: Company }) {
  const { update } = useWorkspace();
  const [members, setMembers] = useState(() =>
    company.members.map((m) => ({ ...m })),
  );
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
    Math.abs(total - 100) < 0.000001;
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    update(
      (d) => {
        d.companies.find((c) => c.id === company.id)!.members = members.map(
          (m) => ({ name: m.name.trim(), share: m.share }),
        );
      },
      "Demo ownership updated",
      company.name,
    );
  }
  return (
    <form onSubmit={save} className="form-stack">
      <p className="inline-note">
        Edit fictional ownership interests for financial planning. Live
        distributions will use reviewed agreements and effective ownership
        dates.
      </p>
      {members.map((m, i) => (
        <div className="member-editor" key={i}>
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
            onClick={() => setMembers((prev) => prev.filter((_, j) => j !== i))}
            aria-label={`Remove member ${i + 1}`}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="member-editor-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setMembers((prev) => [
              ...prev,
              { name: "", share: Math.max(0, 100 - total) },
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
        Save demo ownership
      </Button>
    </form>
  );
}
