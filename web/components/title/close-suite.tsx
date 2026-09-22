"use client";
import { businessPeriod } from "@/lib/title/business-date";
import { useState } from "react";
import {
  Plus,
  Download,
  CheckCheck,
  RefreshCw,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { TableRow, TableCell } from "@/components/ui/table";
import { useWorkspace, download } from "@/lib/title/store";
import { moneyCents as money } from "@/lib/title/model";
import { ownershipForMonth } from "@/lib/title/ownership-history";
import {
  business,
  newClose,
  saveCloseDraft,
  reviewClose,
  publishClose,
  refreshClose,
  closeCalculations,
  closeFingerprint,
  type ClosePeriod,
} from "@/lib/title/business";
import { Picker, FieldLabel, Status, Empty, DataTable, Metric } from "./shared";
import { StatementDeliveries } from "./statement-deliveries";

type CloseWorkspaceProps = {
  reportingMonth: string;
  onReportingMonthChange: (month: string) => void;
} | {
  reportingMonth?: undefined;
  onReportingMonthChange?: undefined;
};

export function CloseWorkspace({ reportingMonth, onReportingMonthChange }: CloseWorkspaceProps = {}) {
  const { s, update } = useWorkspace();
  const [company, setCompany] = useState(s.companies[0]?.id || ""),
    [localMonth, setLocalMonth] = useState(() => businessPeriod()),
    [selected, setSelected] = useState("");
  const month = reportingMonth ?? localMonth;
  const closes = business(s).closes.filter(
    (p) => p.companyId === company && p.month === month,
  );
  const p = closes.find((p) => p.id === selected) || closes[0];
  return (
    <div className="close-workspace">
      <div className="toolbar">
        <div className="source-actions">
          <Picker
            value={company}
            label="Close company"
            onChange={(v) => {
              setCompany(v);
              setSelected("");
            }}
            options={s.companies.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Input
            type="month"
            aria-label="Close reporting month"
            value={month}
            onChange={(e) => {
              if (!e.target.value) return;
              if (onReportingMonthChange) onReportingMonthChange(e.target.value);
              else setLocalMonth(e.target.value);
              setSelected("");
            }}
          />
        </div>
        <Button
          onClick={async () => {
            let id = "";
            if (
              await update(
                (d) => {
                  id = newClose(d, company, month).id;
                },
                "Close draft created",
                month,
              )
            )
              setSelected(id);
          }}
        >
          <Plus />
          New close revision
        </Button>
      </div>
      <p className="inline-note">
        Freeze one company’s policy rows and ownership assumptions for a period.
        Approved statements publish from that saved revision.
      </p>
      {closes.length > 0 && (
        <div className="revision-tabs">
          {closes.map((c) => (
            <Button
              key={c.id}
              variant={c.id === p?.id ? "default" : "outline"}
              onClick={() => setSelected(c.id)}
            >
              v{c.revision} · {c.status}
            </Button>
          ))}
        </div>
      )}
      {p ? (
        <CloseEditor key={`${p.id}-${p.sourceHash}-${p.status}`} period={p} />
      ) : (
        <section className="panel">
          <Empty
            title="Prepare this company's close"
            text="Create a draft to capture policy totals and ownership as they stand now."
          />
        </section>
      )}
    </div>
  );
}
function CloseEditor({ period }: { period: ClosePeriod }) {
  const { s, update, connection } = useWorkspace();
  const [p, setP] = useState(() => structuredClone(period));
  const [checks, setChecks] = useState([false, false, false]);
  const [cancelNote, setCancelNote] = useState("");
  const c = s.companies.find((c) => c.id === period.companyId)!;
  // What covers this period *now*, so the snapshot can say whether a record
  // has appeared since capture rather than claiming none exists.
  const governingNow = ownershipForMonth(s, c, period.month);
  const changed = period.sourceHash !== closeFingerprint(s, c, period.month),
    editable = period.status === "Draft",
    totals = closeCalculations(p);
  const change = (k: keyof ClosePeriod, v: string | number) => {
    setP((p) => ({ ...p, [k]: v }));
    setChecks([false, false, false]);
  };
  function exportClose() {
    download(
      `${period.companyName}-${period.month}-v${period.revision}.json`,
      JSON.stringify(
        { demo: !connection, notPaymentInstructions: true, close: period },
        null,
        2,
      ),
      "application/json",
    );
  }
  return (
    <>
      <div className="metrics">
        <Metric
          label="Policy premium"
          value={money(totals.premium)}
          detail={`${period.rows.length} captured policy rows`}
        />
        <Metric
          label="Underwriter obligation"
          value={money(totals.remittance)}
          detail="Reviewed source terms"
        />
        <Metric
          label="After expenses / adjustments"
          value={money(totals.profit)}
          detail="Before the entered reserve"
        />
        <Metric
          label="Available for allocation"
          value={money(totals.available)}
          detail="Illustrative, subject to approval"
        />
      </div>
      <section className="panel business-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {period.companyName} · {period.month} · REVISION {period.revision}
            </p>
            <h2>Month-end reconciliation</h2>
          </div>
          <Status value={period.status} />
        </div>
        {changed && (
          <div className="notice warning">
            Live source records have changed. This revision retains its captured
            values.{" "}
            {editable && (
              <Button
                variant="link"
                onClick={async () =>
                  await update(
                    (d) => refreshClose(d, period.id),
                    "Close sources refreshed",
                    period.month,
                  )
                }
              >
                <RefreshCw />
                Refresh draft
              </Button>
            )}
          </div>
        )}
        <DataTable
          headers={[
            "Source",
            "Policy / order",
            "Premium",
            "Underwriter",
            "Obligation",
          ]}
        >
          {period.rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.description}</TableCell>
              <TableCell>{r.orderId}</TableCell>
              <TableCell>{money(r.premium)}</TableCell>
              <TableCell>{r.underwriter}</TableCell>
              <TableCell>{money(r.remittance)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        {!period.rows.length && (
          <p className="inline-note">
            No issued policy rows in this period. A company may still have
            expenses or adjustments.
          </p>
        )}
        <fieldset disabled={!editable} className="form-stack">
          <div className="form-grid">
            <FieldLabel label="Premium per source books ($)">
              <Input
                type="number"
                min="0"
                step=".01"
                value={p.externalPremium}
                onChange={(e) =>
                  change("externalPremium", Number(e.target.value))
                }
              />
            </FieldLabel>
            <FieldLabel label="Underwriter obligation per statement ($)">
              <Input
                type="number"
                min="0"
                step=".01"
                value={p.externalRemittance}
                onChange={(e) =>
                  change("externalRemittance", Number(e.target.value))
                }
              />
            </FieldLabel>
            <FieldLabel label="Operating expenses ($)">
              <Input
                type="number"
                min="0"
                step=".01"
                value={p.expenses}
                onChange={(e) => change("expenses", Number(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Reviewed adjustment (+ / − $)">
              <Input
                type="number"
                step=".01"
                value={p.adjustment}
                onChange={(e) => change("adjustment", Number(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Reserve withheld ($)">
              <Input
                type="number"
                min="0"
                step=".01"
                value={p.reserve}
                onChange={(e) => change("reserve", Number(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Books / remittance source references">
              <Input
                value={p.booksReference}
                onChange={(e) => change("booksReference", e.target.value)}
                placeholder="Books, statement, cutoff and accounting basis"
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Operating agreement / ownership schedule reference">
            <Input
              value={p.agreementReference}
              onChange={(e) => change("agreementReference", e.target.value)}
              placeholder="Agreement version and ownership effective date"
            />
          </FieldLabel>
          <FieldLabel label="Close review and adjustment explanation">
            <Textarea
              value={p.note}
              onChange={(e) => change("note", e.target.value)}
              placeholder="Explain reserves, adjustments, timing and any loss; confirm the source reconciliation."
            />
          </FieldLabel>
          <div className="close-checks">
            {[
              "Policy totals reconcile to the source books and underwriter statements",
              "Expenses, reserves and adjustments have supporting references",
              "Ownership and allocation follow the reviewed agreement",
            ].map((label, i) => (
              <label key={label}>
                <Checkbox
                  checked={checks[i]}
                  onCheckedChange={(v) =>
                    setChecks((x) =>
                      x.map((n, j) => (i === j ? v === true : n)),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="source-actions">
          {editable && (
            <Button
              variant="outline"
              onClick={async () =>
                await update(
                  (d) => saveCloseDraft(d, p),
                  "Close draft saved",
                  period.month,
                )
              }
            >
              Save draft
            </Button>
          )}
          {editable && (
            <Button
              disabled={!checks.every(Boolean) || changed}
              onClick={async () =>
                await update(
                  (d) => reviewClose(d, p),
                  "Company close reviewed",
                  `${period.companyName} · ${period.month}`,
                )
              }
            >
              <CheckCheck />
              Approve saved close
            </Button>
          )}
          {period.status === "Reviewed" && (
            <Button
              disabled={changed}
              onClick={async () =>
                await update(
                  (d) => publishClose(d, period.id),
                  "Statement published in partner view",
                  period.companyName,
                )
              }
            >
              <Eye />
              Publish approved statement
            </Button>
          )}
          <Button variant="outline" onClick={exportClose}>
            <Download />
            Export saved revision
          </Button>
        </div>
        <p className="form-note">
          Approval creates a fixed snapshot. Publishing updates the
          partner view; it does not send a statement or execute a payment.
        </p>
      </section>
      <section className="panel business-panel">
        <h2>Ownership snapshot</h2>
        <p className="form-note">
          {period.ownershipSource
            ? `Allocated on the ownership recorded effective ${period.ownershipSource.effectiveFrom} — the position at the end of ${period.month}, not today's.`
            : governingNow.source === "record"
              ? `Allocated on the member interests on file when this close was captured; no dated ownership record covered ${period.month} at that time. A record effective ${governingNow.record!.effectiveFrom} covers it now.`
              : "Allocated on the company's current member interests: no dated ownership record covers this period."}
        </p>
        <DataTable headers={["Member", "Interest", "Approved allocation"]}>
          {period.members.map((m) => (
            <TableRow key={m.name}>
              <TableCell>{m.name}</TableCell>
              <TableCell>{m.share}%</TableCell>
              <TableCell>
                {period.allocations.find((a) => a.name === m.name)
                  ? money(
                      period.allocations.find((a) => a.name === m.name)!.amount,
                    )
                  : "Awaiting close review"}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {period.reviewedAt && (
          <p className="form-note">
            Reviewed by {period.reviewedBy} · {period.reviewedAt}. Negative
            available results do not create payments.
          </p>
        )}
      </section>
      {/* Manual delivery register for this revision's published member
          statements (J05). Rendered for every revision status so the records
          prepared against a withdrawn or superseded revision stay visible. */}
      <StatementDeliveries period={period} />
      {period.status === "Published" && (
        <section className="panel business-panel">
          <h3>Withdraw publication</h3>
          <p>
            Retain the close history while removing it from the current partner
            view.
          </p>
          <Input
            aria-label="Statement withdrawal reason"
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder="Reason for withdrawal"
          />
          <Button
            variant="outline"
            disabled={!cancelNote.trim()}
            onClick={async () =>
              await update(
                (d) => {
                  const p = d.business!.closes.find((p) => p.id === period.id)!;
                  if (p.status !== "Published")
                    throw new Error("This revision is no longer published.");
                  p.status = "Withdrawn";
                  p.note += `\nPublication withdrawn: ${cancelNote.trim()}`;
                },
                "Partner statement withdrawn",
                period.companyName,
              )
            }
          >
            Withdraw local publication
          </Button>
        </section>
      )}
    </>
  );
}
export function PartnerStatements({ companyId }: { companyId: string }) {
  const { s, connection } = useWorkspace();
  const isPartner = connection?.access.role === "partner";
  const [member, setMember] = useState(""),
    [selected, setSelected] = useState("");
  const periods = business(s)
    .closes.filter((p) => p.companyId === companyId && p.status === "Published")
    .sort((a, b) => b.month.localeCompare(a.month));
  const period = periods.find((p) => p.id === selected) || periods[0];
  const allocation =
    period?.allocations.find((a) => a.name === member) ||
    period?.allocations[0];
  if (!period)
    return (
      <section className="panel partner-panel">
        <Empty
          title="No approved statements published"
          text="The team will publish a reviewed company close when it is ready."
        />
      </section>
    );
  return (
    <section className="panel business-panel">
      <div className="section-heading">
        <h2>Approved member statement</h2>
        <Picker
          value={period.id}
          label="Published period"
          onChange={(v) => {
            setSelected(v);
            setMember("");
          }}
          options={periods.map((p) => ({
            value: p.id,
            label: `${p.month} · v${p.revision}`,
          }))}
        />
      </div>
      <p className="inline-note">
        {isPartner
          ? "Your published member statements."
          : "Administrator preview: choose a member to see their statement."}
      </p>
      <Picker
        value={allocation?.name || ""}
        label="Statement member preview"
        onChange={setMember}
        options={period.allocations.map((a) => a.name)}
      />
      {allocation && (
        <>
          <div className="statement-sheet">
            <p className="eyebrow">
              {period.companyName} · {period.month}
            </p>
            <h2>{allocation.name}</h2>
            <p>Interest at close: {allocation.share}%</p>
            <div className="statement-amount">{money(allocation.amount)}</div>
            <p>Approved illustrative allocation · Revision {period.revision}</p>
            {!isPartner && (
              <dl>
                <div>
                  <dt>Company retained revenue</dt>
                  <dd>{money(period.totals.retained)}</dd>
                </div>
                <div>
                  <dt>Operating expenses</dt>
                  <dd>{money(period.expenses)}</dd>
                </div>
                <div>
                  <dt>Adjustments</dt>
                  <dd>{money(period.adjustment)}</dd>
                </div>
                <div>
                  <dt>Reserve withheld</dt>
                  <dd>{money(period.reserve)}</dd>
                </div>
                <div>
                  <dt>Company amount available</dt>
                  <dd>{money(period.totals.available)}</dd>
                </div>
              </dl>
            )}
            <p className="form-note">
              Not a payment instruction. Published{" "}
              {period.publishedAt.slice(0, 10)} from the approved period
              snapshot.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              download(
                `${period.companyId}-${period.month}-member-statement.txt`,
                `${connection ? "MEMBER STATEMENT" : "LOCAL DEMO MEMBER STATEMENT"} — NOT PAYMENT INSTRUCTIONS\nCompany: ${period.companyName}\nPeriod: ${period.month} · Revision ${period.revision}\nMember: ${allocation.name}\nInterest: ${allocation.share}%\nApproved allocation: ${money(allocation.amount)}\nPublished: ${period.publishedAt}\nReviewed by: ${period.reviewedBy}\n`,
              )
            }
          >
            <Download />
            Download this statement
          </Button>
        </>
      )}
    </section>
  );
}
