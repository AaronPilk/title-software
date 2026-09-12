"use client";
import {
  recordOrderOutcome,
  recoveryStage,
  backfillReceivedDate,
} from "@/lib/title/business";
import { useState, useEffect } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCheck,
  Download,
  FileText,
  Plus,
  ScanLine,
  ShieldCheck,
  Upload,
  ChevronRight,
  MessageSquare,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
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
import { useWorkspace, download, exportCsv } from "@/lib/title/store";
import {
  companyById,
  money,
  uid,
  orderOutcomeKinds,
  type Order,
  type OrderStatus,
  type OrderOutcomeKind,
} from "@/lib/title/model";
import {
  Heading,
  Picker,
  Segments,
  SearchBox,
  Status,
  DataTable,
  Empty,
  FieldLabel,
} from "./shared";
import { toast } from "sonner";
import {
  finalReadiness,
  productionLocked,
  neededFields,
  titleFile,
} from "@/lib/title/production";
import { FinalSources, TitleFileDetails } from "./final-intake";
export const statuses: OrderStatus[] = [
  "New",
  "In progress",
  "Needs review",
  "Ready for jacket",
  "Issued",
  "Rejected",
];
export function Orders({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { s } = useWorkspace();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All orders");
  const [company, setCompany] = useState("all");
  const rows = s.orders.filter(
    (o) =>
      (company === "all" || o.companyId === company) &&
      (filter === "All orders" || o.status === filter) &&
      `${o.id} ${o.address} ${o.client} ${companyById(s, o.companyId).name}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <>
      <Heading title="Orders" description="Every transaction. One clear view.">
        <Button
          variant="outline"
          onClick={() =>
            exportCsv("titleos-orders.csv", [
              [
                "Demo data",
                "Company",
                "Address",
                "Client",
                "State",
                "Status",
                "Premium",
              ],
              ...rows.map((o) => [
                o.id,
                companyById(s, o.companyId).name,
                o.address,
                o.client,
                o.jurisdiction,
                o.status,
                o.premium,
              ]),
            ])
          }
        >
          <Download />
          Export
        </Button>
        <Button onClick={onNew}>
          <Plus />
          New order
        </Button>
      </Heading>
      <div className="toolbar">
        <Segments
          value={filter}
          onChange={setFilter}
          items={[
            "All orders",
            "Needs review",
            "In progress",
            "Issued",
            "Rejected",
          ]}
        />
        <div className="toolbar-right">
          <SearchBox value={q} onChange={setQ} placeholder="Search orders…" />
          <Picker
            label="Filter by company"
            value={company}
            onChange={setCompany}
            options={[
              { value: "all", label: "All companies" },
              ...s.companies.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      </div>
      <section className="panel">
        <DataTable
          headers={[
            "Order / property",
            "Company",
            "Type",
            "Underwriter",
            "Owner",
            "Status",
            "Due date",
            "",
          ]}
        >
          {rows.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <button className="record-link" onClick={() => onOpen(o.id)}>
                  <strong>{o.address}</strong>
                  <small>
                    {o.id} · {o.jurisdiction}
                  </small>
                </button>
              </TableCell>
              <TableCell>{companyById(s, o.companyId).name}</TableCell>
              <TableCell>{o.type}</TableCell>
              <TableCell>{o.underwriter}</TableCell>
              <TableCell>
                <span className="person-inline">
                  <span
                    className={`person-dot ${o.owner === "John" ? "violet" : "blue"}`}
                  />
                  {o.owner}
                </span>
              </TableCell>
              <TableCell>
                <Status value={o.status} />
              </TableCell>
              <TableCell>
                {new Date(o.due + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Open ${o.id}`}
                  onClick={() => onOpen(o.id)}
                >
                  <ChevronRight />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {!rows.length && <Empty />}
        <div className="table-foot">
          {rows.length} orders{" "}
          <span>Fictional transactions · Local workspace</span>
        </div>
      </section>
    </>
  );
}
export function NewOrder({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { s, update } = useWorkspace();
  const [company, setCompany] = useState(s.companies[0].id);
  const [owner, setOwner] = useState("Tyler");
  const [type, setType] = useState("Purchase");
  const [underwriter, setUnderwriter] = useState("WFG");
  const [state, setState] = useState(
    s.companies[0].operatingStates?.[0] || s.companies[0].jurisdiction,
  );
  const operatingStates = s.companies.find((c) => c.id === company)
    ?.operatingStates || [
    s.companies.find((c) => c.id === company)!.jurisdiction,
  ];
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const address = String(f.get("address")).trim(),
      client = String(f.get("client")).trim();
    if (!address || !client) {
      toast.error("Enter a property address and client name.");
      return;
    }
    const id = `T-2026-${Math.max(1048, ...s.orders.map((o) => Number(o.id.split("-").at(-1)) || 0)) + 1}`;
    update(
      (d) =>
        d.orders.unshift({
          receivedAt: new Date().toISOString().slice(0, 10),
          id,
          companyId: company,
          address,
          client,
          type,
          underwriter,
          owner,
          jurisdiction: state,
          delivered: false,
          remitted: false,
          status: "New",
          due: String(f.get("due")),
          premium: Number(f.get("premium")),
          rate: 0.4,
          month: String(f.get("due")).slice(0, 7),
          fields: [],
          notes: "Created in the local demo workspace.",
          exception: "",
        }),
      "Order created",
      `${id} · ${address}`,
    );
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="modal">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            Add a fictional transaction to your local workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <FieldLabel label="Company">
            <Picker
              value={company}
              onChange={(id) => {
                setCompany(id);
                const c = s.companies.find((c) => c.id === id)!;
                setState(c.operatingStates?.[0] || c.jurisdiction);
              }}
              label="Order company"
              options={s.companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FieldLabel>
          <FieldLabel label="Property address">
            <Input
              name="address"
              placeholder="e.g. 124 Magnolia Lane"
              required
              maxLength={150}
            />
          </FieldLabel>
          <FieldLabel label="Client name">
            <Input
              name="client"
              placeholder="e.g. Morgan Ellis"
              required
              maxLength={100}
            />
          </FieldLabel>
          <div className="form-grid">
            <FieldLabel label="Property state">
              <Picker
                value={state}
                onChange={setState}
                label="Property state"
                options={operatingStates}
              />
            </FieldLabel>
            <FieldLabel label="Transaction type">
              <Picker
                value={type}
                onChange={setType}
                label="Transaction type"
                options={["Purchase", "Refinance", "Commercial"]}
              />
            </FieldLabel>
            <FieldLabel label="Underwriter">
              <Picker
                value={underwriter}
                onChange={setUnderwriter}
                label="Underwriter"
                options={["WFG", "Commonwealth"]}
              />
            </FieldLabel>
            <FieldLabel label="Assigned to">
              <Picker
                value={owner}
                onChange={setOwner}
                label="Assigned to"
                options={["Tyler", "John", "Stephenie"]}
              />
            </FieldLabel>
            <FieldLabel label="Due date">
              <Input
                name="due"
                type="date"
                required
                defaultValue="2026-09-15"
              />
            </FieldLabel>
            <FieldLabel label="Estimated premium ($)">
              <Input
                name="premium"
                type="number"
                min="0"
                max="10000000"
                step=".01"
                defaultValue="1500"
                required
              />
            </FieldLabel>
          </div>
          <p className="form-note">
            Premiums are planning figures. No policy is issued or submitted.
          </p>
          <div className="form-actions">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create order</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function PolicyWorkbench({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { s, update } = useWorkspace();
  const [filter, setFilter] = useState("All active");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("Document review");
  const [attorney, setAttorney] = useState(false);
  const [attorneyRef, setAttorneyRef] = useState("");
  const rows = s.orders.filter(
    (o) =>
      !["Rejected", "Issued"].includes(o.status) &&
      (filter === "All active" || o.status === filter) &&
      `${o.address} ${o.id}`.toLowerCase().includes(q.toLowerCase()),
  );
  const order = s.orders.find((o) => o.id === selectedId) || rows[0];
  const readiness = order ? finalReadiness(s, order) : null;
  const complete = !!readiness?.ready;
  const reviewFields = order
    ? order.fields.filter((f) =>
        neededFields(order).some((def) => def.id === f.id),
      )
    : [];
  const locked = !!order && productionLocked(s, order);
  useEffect(() => {
    setAttorney(false);
    setAttorneyRef("");
  }, [order?.id, order?.production?.version]);
  const currentCompany = order ? companyById(s, order.companyId) : undefined;
  function select(id: string) {
    onSelect(id);
    setAttorney(false);
    setAttorneyRef("");
  }
  function changeField(id: string, value: string) {
    if (!order) return;
    setAttorney(false);
    update((d) => {
      const o = d.orders.find((x) => x.id === order.id)!;
      const f = o.fields.find((x) => x.id === id)!;
      f.proposed = value;
      f.reviewed = false;
      o.production = { ...titleFile(o), version: titleFile(o).version + 1 };
      if (o.status === "Ready for jacket") o.status = "Needs review";
    });
  }
  function prepare() {
    if (
      !order ||
      !complete ||
      order.exception ||
      !attorney ||
      !attorneyRef.trim()
    )
      return;
    const saved = update(
      (d) => {
        const o = d.orders.find((x) => x.id === order.id)!;
        if (!finalReadiness(d, o).ready)
          throw new Error(
            "The source package changed. Review the current preparation checks.",
          );
        o.status = "Ready for jacket";
        o.notes += `\nDemo attorney-review reference: ${attorneyRef.trim()}`;
      },
      "Review package prepared",
      `${order.id} · awaiting underwriter handoff`,
    );
    if (!saved) return;
    download(
      `${order.id}-review-package.json`,
      JSON.stringify(
        {
          demo: true,
          notAPolicy: true,
          orderId: order.id,
          companyId: order.companyId,
          jurisdiction: order.jurisdiction,
          preparedAt: new Date().toISOString(),
          reviewer: s.user,
          attorneyReference: attorneyRef,
          titleFile: titleFile(order),
          changes: reviewFields.map((f) => ({
            field: f.label,
            before: f.current,
            after: f.proposed,
            source: f.source,
            sourceValue: f.sourceValue,
            documentId: f.documentId,
            sourcePage: f.sourcePage,
            reviewed: f.reviewed,
          })),
          nextStep: "Human handoff to approved SoftPro/underwriter workflow",
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  return (
    <>
      <Heading
        title="Policy workbench"
        description="Clear the final-policy backlog, one verified file at a time."
      >
        <span className="subtle-pill">
          <ScanLine size={14} />
          Local preparation
        </span>
      </Heading>
      <div className="workbench">
        <aside className="work-queue">
          <div className="queue-head">
            <strong>Preparation queue</strong>
            <span>{rows.length}</span>
          </div>
          <div className="queue-filters">
            <SearchBox value={q} onChange={setQ} placeholder="Find a policy…" />
            <Picker
              value={filter}
              onChange={setFilter}
              label="Policy status"
              options={[
                "All active",
                "Needs review",
                "Ready for jacket",
                "In progress",
                "New",
              ]}
            />
          </div>
          {rows.map((o) => (
            <button
              className={`queue-item ${o.id === order?.id ? "selected" : ""}`}
              onClick={() => select(o.id)}
              key={o.id}
            >
              <span className="queue-id">
                {o.id}
                <span>{o.jurisdiction}</span>
              </span>
              <strong>{o.address}</strong>
              <small>{companyById(s, o.companyId).name}</small>
              <div>
                <Status value={o.status} />
                {o.exception && <AlertCircle size={14} color="#ba881f" />}
              </div>
            </button>
          ))}
          {!rows.length && (
            <Empty
              title="Queue is clear"
              text="Change the filter to see more orders."
            />
          )}
        </aside>
        <section className="review-space">
          {order ? (
            <>
              <div className="review-header">
                <div>
                  <p className="eyebrow">
                    {order.id} / {order.jurisdiction}
                  </p>
                  <h2>{order.address}</h2>
                  <p>
                    {currentCompany?.name} <span>·</span> {order.underwriter}{" "}
                    <span>·</span> {order.owner}
                  </p>
                </div>
                <Status value={order.status} />
              </div>
              <Segments
                value={tab}
                onChange={setTab}
                items={[
                  "Source package",
                  "Document review",
                  "File details",
                  "Policy lifecycle",
                  "Notes",
                ]}
              />
              {tab === "Source package" && (
                <FinalSources key={order.id} order={order} />
              )}
              {tab === "File details" && (
                <TitleFileDetails
                  key={order.id + ":" + titleFile(order).version}
                  order={order}
                />
              )}
              {tab === "Document review" && (
                <>
                  {order.exception && (
                    <div className="notice warning">
                      <AlertCircle size={18} />
                      <div>
                        <strong>Review is on hold</strong>
                        <p>
                          {order.exception}. Resolve the source issue before
                          preparing this package.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          update(
                            (d) => {
                              const o = d.orders.find(
                                (x) => x.id === order.id,
                              )!;
                              o.exception = "";
                            },
                            "Demo source issue resolved",
                            order.id,
                          );
                        }}
                      >
                        Resolve in demo
                      </Button>
                    </div>
                  )}
                  {order.fields.length ? (
                    <>
                      <div className="review-columns">
                        <div className="document-preview">
                          <div className="document-toolbar">
                            <FileText size={15} />
                            Recorded document excerpts<span>DEMO</span>
                          </div>
                          <div className="paper">
                            <p className="paper-label">
                              CAPTURED SOURCE VALUES
                            </p>
                            <h3>Final package</h3>
                            <p className="paper-sub">
                              {order.id} · {order.jurisdiction}
                            </p>
                            <div className="paper-rule" />
                            {reviewFields.map((f) => (
                              <div key={f.id}>
                                <p>{f.label}</p>
                                <mark>{f.sourceValue}</mark>
                                <small className="source-page-reference">
                                  {f.source}
                                </small>
                              </div>
                            ))}
                            <div className="paper-disclaimer">
                              Source values stay separate from proposed
                              corrections. Verify the original attachments in
                              Source package. No automated extraction is
                              running.
                            </div>
                          </div>
                        </div>
                        <div className="field-comparison">
                          <div className="comparison-title">
                            <h3>Proposed changes</h3>
                            <span>
                              {reviewFields.filter((f) => f.reviewed).length} /{" "}
                              {reviewFields.length} reviewed
                            </span>
                          </div>
                          {reviewFields.map((f) => (
                            <div
                              className={`field-diff ${f.reviewed ? "reviewed" : ""}`}
                              key={f.id}
                            >
                              <div>
                                <label htmlFor={`${order.id}-${f.id}`}>
                                  {f.label}
                                </label>
                                <Checkbox
                                  aria-label={`Reviewed ${f.label}`}
                                  checked={f.reviewed}
                                  disabled={locked || !f.proposed.trim()}
                                  onCheckedChange={(v) =>
                                    update((d) => {
                                      const o = d.orders.find(
                                        (x) => x.id === order.id,
                                      )!;
                                      o.fields.find(
                                        (x) => x.id === f.id,
                                      )!.reviewed = v === true;
                                      if (
                                        v !== true &&
                                        o.status === "Ready for jacket"
                                      )
                                        o.status = "Needs review";
                                    })
                                  }
                                />
                              </div>
                              <p className="old-value">{f.current}</p>
                              <Input
                                id={`${order.id}-${f.id}`}
                                value={f.proposed}
                                disabled={locked}
                                onChange={(e) =>
                                  changeField(f.id, e.target.value)
                                }
                              />
                              <small>
                                <FileText size={11} />
                                {f.source}
                                {f.confidence === "Review required" && (
                                  <span className="text-amber">
                                    Verify wording
                                  </span>
                                )}
                              </small>
                            </div>
                          ))}
                        </div>
                      </div>
                      {readiness && !readiness.ready && (
                        <div className="notice warning">
                          <ClipboardCheck size={18} />
                          <div>
                            <strong>Preparation checks</strong>
                            <p>
                              {readiness.missingSources.length
                                ? `Missing: ${readiness.missingSources.join(", ")}. `
                                : ""}
                              {readiness.pendingFields.length
                                ? `${readiness.pendingFields.length} fields need source review. `
                                : ""}
                              {readiness.unresolved.length
                                ? `${readiness.unresolved.length} requirements or exceptions need a documented decision. `
                                : ""}
                              {readiness.missingContext.length
                                ? `File details: ${readiness.missingContext.join(", ")}. `
                                : ""}
                              {readiness.loanMismatch
                                ? "Confirm the source loan amount against File details."
                                : ""}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setTab(
                                  readiness.missingSources.length
                                    ? "Source package"
                                    : "File details",
                                )
                              }
                            >
                              Review supporting information
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="review-approval">
                        <label>
                          <Checkbox
                            checked={attorney}
                            disabled={locked}
                            onCheckedChange={(v) => setAttorney(v === true)}
                          />
                          Attorney review / opinion verified for this demo
                          package
                        </label>
                        <Input
                          aria-label="Attorney review reference"
                          placeholder="Attorney review reference or note"
                          value={attorneyRef}
                          disabled={locked}
                          onChange={(e) => setAttorneyRef(e.target.value)}
                        />
                        <div>
                          <span>
                            <ShieldCheck size={15} />
                            {complete
                              ? "All fields reviewed"
                              : "Review each field to continue"}
                          </span>
                          <Button
                            disabled={
                              !complete ||
                              !!order.exception ||
                              !attorney ||
                              !attorneyRef.trim() ||
                              locked
                            }
                            onClick={prepare}
                          >
                            <ClipboardCheck />
                            Prepare review package
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="Waiting for source documents"
                      text="Attach the final opinion and recorded instruments, then capture their source fields to begin review."
                      action={
                        <Button onClick={() => setTab("Source package")}>
                          Open source package
                        </Button>
                      }
                    />
                  )}
                </>
              )}
              {tab === "Policy lifecycle" && (
                <PolicyLifecycle key={order.id} order={order} />
              )}{" "}
              {tab === "Notes" && <OrderNotes key={order.id} order={order} />}
            </>
          ) : (
            <Empty title="No policy selected" />
          )}
        </section>
      </div>
    </>
  );
}
export function PolicyLifecycle({ order }: { order: Order }) {
  const { s, update } = useWorkspace();
  const [reference, setReference] = useState("");
  const stages = [
    [
      "Documents reviewed",
      neededFields(order).every((def) =>
        order.fields.some((f) => f.id === def.id && f.reviewed),
      ),
    ],
    ["Ready for jacket", ["Ready for jacket", "Issued"].includes(order.status)],
    ["Jacket / policy recorded as issued", order.status === "Issued"],
    ["Final policy delivered", order.delivered],
    ["Underwriter remittance reconciled", order.remitted],
  ] as const;
  return (
    <div className="lifecycle">
      <p className="inline-note">
        Local simulation. No underwriter portal, filing, delivery service, or
        payment account is connected.
      </p>
      {stages.map(([name, done], i) => (
        <div className="lifecycle-step" key={name}>
          <span className={done ? "done" : ""}>
            {done ? <Check size={17} /> : i + 1}
          </span>
          <div>
            <strong>{name}</strong>
            <p>
              {i === 0
                ? "Exact names, recording details, and trustee wording."
                : i === 1
                  ? "Reviewed package handed to an authorized operator."
                  : i === 2
                    ? "Track provider confirmation separately from preparation."
                    : i === 3
                      ? "Track the final policy image and delivery confirmation."
                      : "Track reconciliation without executing a payment."}
            </p>
          </div>
          <Status value={done ? "Complete" : "Pending"} />
        </div>
      ))}
      {order.status === "Ready for jacket" &&
        !s.business?.policies.some(
          (p) => p.orderId === order.id && p.status !== "Void",
        ) && (
          <div className="lifecycle-action">
            <Input
              aria-label="Demo jacket reference"
              placeholder="Demo jacket reference (e.g. DEMO-001)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Button
              disabled={!reference.trim()}
              onClick={() =>
                update(
                  (d) => {
                    const o = d.orders.find((x) => x.id === order.id)!;
                    if (
                      d.business?.policies.some(
                        (p) => p.orderId === o.id && p.status !== "Void",
                      )
                    )
                      throw new Error(
                        "Record each product in Policy products so every policy has its own document and reference.",
                      );
                    if (
                      o.status !== "Ready for jacket" ||
                      !finalReadiness(d, o).ready
                    )
                      throw new Error(
                        "The preparation evidence changed. Complete the current review before recording issuance.",
                      );
                    o.status = "Issued";
                    o.notes += `\nDemo jacket reference: ${reference.trim()}`;
                  },
                  "Demo issuance recorded",
                  `${order.id} · no external submission`,
                )
              }
            >
              Record demo issuance
            </Button>
          </div>
        )}
      {order.status === "Issued" &&
        !order.delivered &&
        !s.business?.policies.some(
          (p) => p.orderId === order.id && p.status !== "Void",
        ) && (
          <Button
            onClick={() =>
              update(
                (d) => {
                  d.orders.find((x) => x.id === order.id)!.delivered = true;
                },
                "Demo delivery recorded",
                `${order.id} · no message sent`,
              )
            }
          >
            Record demo delivery
          </Button>
        )}
    </div>
  );
}
export function OrderNotes({ order }: { order: Order }) {
  const { update } = useWorkspace();
  const [note, setNote] = useState(order.notes);
  return (
    <div className="notes-panel">
      <FieldLabel label="Order notes">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={9}
        />
      </FieldLabel>
      <Button
        onClick={() =>
          update(
            (d) => {
              d.orders.find((x) => x.id === order.id)!.notes = note;
            },
            "Order notes saved",
            order.id,
          )
        }
      >
        <MessageSquare />
        Save notes
      </Button>
    </div>
  );
}
export function OrderDetail({
  id,
  onClose,
  onReview,
}: {
  id: string;
  onClose: () => void;
  onReview: (id: string) => void;
}) {
  const { s, update } = useWorkspace();
  const o = s.orders.find((x) => x.id === id);
  if (!o) return null;
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="detail-sheet">
        <SheetHeader>
          <SheetDescription>
            {o.id} · {o.jurisdiction}
          </SheetDescription>
          <SheetTitle>{o.address}</SheetTitle>
        </SheetHeader>
        <div className="sheet-body">
          <div className="status-row">
            <Status value={o.status} />
            {recoveryStage(o) && <Status value={recoveryStage(o)!} />}
          </div>
          <div className="detail-grid">
            <div>
              <small>Company</small>
              <strong>{companyById(s, o.companyId).name}</strong>
            </div>
            <div>
              <small>Client</small>
              <strong>{o.client}</strong>
            </div>
            <div>
              <small>Underwriter</small>
              <strong>{o.underwriter}</strong>
            </div>
            <div>
              <small>Premium estimate</small>
              <strong>{money(o.premium)}</strong>
            </div>
            <div>
              <small>Transaction</small>
              <strong>{o.type}</strong>
            </div>
            <div>
              <small>Due date</small>
              <strong>{o.due}</strong>
            </div>
            <div>
              <small>Received</small>
              <strong>{o.receivedAt || "Not recorded"}</strong>
            </div>
          </div>
          {!o.receivedAt && <ReceivedDateBackfill order={o} />}
          <FieldLabel label="Assigned owner">
            <Picker
              value={o.owner}
              label="Order owner"
              onChange={(owner) =>
                update(
                  (d) => {
                    d.orders.find((x) => x.id === id)!.owner = owner;
                  },
                  "Order reassigned",
                  id,
                )
              }
              options={["Stephenie", "Tyler", "John"]}
            />
          </FieldLabel>
          {o.status === "New" && (
            <Button
              variant="outline"
              onClick={() =>
                update(
                  (d) => {
                    d.orders.find((x) => x.id === id)!.status = "In progress";
                  },
                  "Order intake started",
                  id,
                )
              }
            >
              Start intake
            </Button>
          )}
          {o.status !== "Issued" && o.status !== "Rejected" && (
            <Button onClick={() => onReview(id)}>
              <ScanLine />
              Open policy workbench
              <ArrowRight />
            </Button>
          )}
          {o.status === "Issued" ? (
            <PolicyLifecycle key={o.id} order={o} />
          ) : null}
          {/* Distinct suffixes so the two components remount (and reset their
              local state) when the user switches orders, without colliding —
              a shared `key={id}` here previously made React log a duplicate
              key warning and, worse, duplicate this section in the DOM once
              a sibling earlier in the list (the backfill control) toggled
              off, changing the children array shape mid-session. */}
          <OrderOutcome key={`${id}:outcome`} order={o} />
          <OrderNotes key={`${id}:notes`} order={o} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReceivedDateBackfill({ order }: { order: Order }) {
  const { update } = useWorkspace();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="inline-form">
      <FieldLabel label="Backfill receipt date">
        <Input
          type="date"
          aria-label="Backfill receipt date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
        />
      </FieldLabel>
      <Button
        variant="outline"
        onClick={() =>
          update(
            (d) => backfillReceivedDate(d, order.id, date),
            "Receipt date backfilled",
            order.id,
          )
        }
      >
        Save receipt date
      </Button>
    </div>
  );
}
/**
 * Suggested wording for the recovery-track outcomes — approved starting
 * points, not a rigid taxonomy. Clicking one fills the note textarea, which
 * stays fully editable afterward (see the "approved partner outcome
 * wording" gap in docs/implementation-coverage.md).
 */
const outcomeNoteTemplates: Partial<Record<OrderOutcomeKind, string[]>> = {
  Contacted: [
    "Called to check on next steps — left a voicemail.",
    "Emailed asking whether the client wants to proceed.",
    "Reached the client — they asked for more time to decide.",
  ],
  "Recovery lost": [
    "Client went with another agency.",
    "Deal fell through; no policy will be needed.",
    "No response after repeated attempts to reach the client.",
  ],
};
function OrderOutcome({ order }: { order: Order }) {
  const { update } = useWorkspace();
  const [kind, setKind] = useState<OrderOutcomeKind>("Closing recorded"),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [note, setNote] = useState("");
  const stage = recoveryStage(order);
  const templates = outcomeNoteTemplates[kind];
  return (
    <section className="form-stack">
      <h3>Order outcomes</h3>
      {stage && <p className="inline-note">Recovery status: {stage}.</p>}
      {order.outcomes?.map((e, i) => (
        <p className="inline-note" key={i}>
          {e.date} · {e.kind} · {e.note}
        </p>
      ))}
      <Picker
        value={kind}
        label="Order outcome"
        options={[...orderOutcomeKinds]}
        onChange={(v) => setKind(v as OrderOutcomeKind)}
      />
      <Input
        type="date"
        aria-label="Order outcome date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      {templates && (
        <div className="template-chip-row">
          {templates.map((t) => (
            <Button
              key={t}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setNote(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      )}
      <Textarea
        aria-label="Order outcome evidence"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason, referral follow-up or closing confirmation"
      />
      <Button
        variant="outline"
        onClick={() =>
          update(
            (d) => recordOrderOutcome(d, order.id, kind, date, note),
            "Order outcome recorded",
            order.id,
          )
        }
      >
        Record outcome
      </Button>
    </section>
  );
}
