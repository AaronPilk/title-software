"use client";
import { BufferedInput } from "./buffered-input";
import { ledgerLines } from "@/lib/title/business";
import { CloseWorkspace } from "./close-suite";
import { AccountingImport } from "./accounting-import";
import { useState } from "react";
import {
  Download,
  ChartNoAxesCombined,
  CheckCheck,
  ArrowUpRight,
  ShieldCheck,
  FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { TableRow, TableCell } from "@/components/ui/table";
import { useWorkspace, exportCsv } from "@/lib/title/store";
import { moneyCents as money, type Workspace } from "@/lib/title/model";
import { financeRows, round, allocateOwnership } from "@/lib/title/engine";
import {
  Heading,
  Picker,
  Segments,
  Metric,
  DataTable,
  Status,
  Empty,
} from "./shared";
export function Financials() {
  const { s, update } = useWorkspace();
  const [month, setMonth] = useState("2026-09");
  const [tab, setTab] = useState("Overview");
  const [checks, setChecks] = useState([false, false, false]);
  const expenses = Object.fromEntries(
    Object.entries(s.expenses || {})
      .filter(([key]) => key.startsWith(month + ":"))
      .map(([key, value]) => [key.slice(8), value]),
  );
  const rows = financeRows(s, month);
  const issued = s.companies.flatMap((c) =>
    ledgerLines(s, c.id, month).map((row) => ({
      ...row,
      companyId: c.id,
      rate: row.premium ? row.remittance / row.premium : 0,
      remitted:
        s.business?.policies.find((p) => p.id === row.id)
          ?.remittanceReference ||
        s.orders.find((o) => o.id === row.id)?.remitted ||
        false,
    })),
  );
  const premium = round(rows.reduce((n, r) => n + r.premium, 0)),
    remittance = round(rows.reduce((n, r) => n + r.remittance, 0));
  const reportKey =
    month +
    JSON.stringify(
      issued.map((o) => [o.id, o.companyId, o.underwriter, o.premium, o.rate]),
    ) +
    JSON.stringify(expenses) +
    JSON.stringify(
      rows
        .filter((r) => r.orders > 0)
        .map((r) => [r.company.id, r.company.members]),
    );
  const approved = s.approvedReports.includes(reportKey);
  function exportReport() {
    exportCsv(`titleos-${month}-draft-report.csv`, [
      ["DEMO ESTIMATES - NOT PAYMENT INSTRUCTIONS"],
      [
        "Company",
        "Issued policies",
        "Premium",
        "Underwriter obligation",
        "Retained revenue",
        "Illustrative expenses",
        "Estimated profit",
      ],
      ...rows.map((r) => [
        r.company.name,
        r.orders,
        r.premium,
        r.remittance,
        r.retained,
        expenses[r.company.id] || 0,
        round(r.retained - (expenses[r.company.id] || 0)),
      ]),
    ]);
  }
  return (
    <>
      <Heading
        title="Financials"
        description="A clearer month-end for every company."
      >
        <Picker
          value={month}
          onChange={(v) => {
            setMonth(v);
            setChecks([false, false, false]);
          }}
          label="Reporting month"
          options={[
            { value: "2026-09", label: "September 2026" },
            { value: "2026-08", label: "August 2026" },
          ]}
        />
        <Button variant="outline" onClick={exportReport}>
          <Download />
          Export report
        </Button>
      </Heading>
      <div className="metrics">
        <Metric
          label="Issued premium"
          value={money(premium)}
          detail={`${issued.length} issued demo policies`}
        />
        <Metric
          label="Underwriter obligation"
          value={money(remittance)}
          detail="Illustrative terms · not a payment"
        />
        <Metric
          label="Retained revenue"
          value={money(premium - remittance)}
          detail="Before operating expenses"
        />
        <Metric
          label="Close status"
          value={approved ? "Reviewed" : "Draft"}
          detail="Local reconciliation checklist"
        />
      </div>
      <div className="toolbar">
        <Segments
          value={tab}
          onChange={setTab}
          items={[
            "Overview",
            "Company closes",
            "Underwriter remittance",
            "Ownership estimates",
            "Accounting import",
          ]}
        />
        <span className="subtle-pill">Illustrative demo figures</span>
      </div>
      {tab === "Company closes" && <CloseWorkspace />}
      {tab === "Accounting import" && <AccountingImport />}
      {tab === "Overview" && (
        <>
          <section className="panel">
            <DataTable
              headers={[
                "Company",
                "Issued policies",
                "Premium",
                "Underwriter obligation",
                "Retained revenue",
              ]}
            >
              {rows.map((r) => (
                <TableRow key={r.company.id}>
                  <TableCell>
                    <strong>{r.company.name}</strong>
                  </TableCell>
                  <TableCell>{r.orders}</TableCell>
                  <TableCell>{money(r.premium)}</TableCell>
                  <TableCell>{money(r.remittance)}</TableCell>
                  <TableCell>
                    <strong>{money(r.retained)}</strong>
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </section>
          <div className="finance-bottom">
            <section className="panel revenue-chart">
              <h2>Retained revenue by company</h2>
              {rows
                .filter((r) => r.retained > 0)
                .map((r) => (
                  <div className="bar-chart-row" key={r.company.id}>
                    <span>{r.company.name}</span>
                    <div>
                      <i
                        style={{
                          width: `${(r.retained / Math.max(1, ...rows.map((x) => x.retained))) * 100}%`,
                        }}
                      />
                    </div>
                    <strong>{money(r.retained)}</strong>
                  </div>
                ))}
              {!premium && <Empty title="No issued policies" />}
            </section>
            <section className="panel close-card">
              <h2>Month-end review</h2>
              <p>Check the source records before confirming a demo close.</p>
              {[
                "Issued-policy totals reviewed",
                "Underwriter terms verified for the period",
                "Company allocation and adjustments reviewed",
              ].map((label, i) => (
                <label key={label}>
                  <Checkbox
                    checked={checks[i]}
                    onCheckedChange={(v) =>
                      setChecks((prev) =>
                        prev.map((x, j) => (j === i ? v === true : x)),
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
              <Button
                disabled={!checks.every(Boolean) || !issued.length || approved}
                onClick={async () =>
                  await update(
                    (d) => d.approvedReports.push(reportKey),
                    "Demo close reviewed",
                    month,
                  )
                }
              >
                <ShieldCheck />
                {approved ? "Demo close reviewed" : "Confirm demo review"}
              </Button>
            </section>
          </div>
        </>
      )}
      {tab === "Underwriter remittance" && (
        <>
          <div className="notice">
            <FileCheck2 size={18} />
            <p>
              The demo uses illustrative 40% underwriter allocations. Actual
              agreements, state rules, effective dates, adjustments, and
              remittance statements must be verified before live use.
            </p>
          </div>
          <section className="panel">
            <DataTable
              headers={[
                "Underwriter",
                "Issued policies",
                "Premium",
                "Estimated obligation",
                "Reconciled",
                "",
              ]}
            >
              {["WFG", "Commonwealth"].map((name) => {
                const orders = issued.filter((o) => o.underwriter === name);
                return (
                  <TableRow key={name}>
                    <TableCell>
                      <strong>{name}</strong>
                    </TableCell>
                    <TableCell>{orders.length}</TableCell>
                    <TableCell>
                      {money(orders.reduce((n, o) => n + o.premium, 0))}
                    </TableCell>
                    <TableCell>
                      {money(
                        orders.reduce(
                          (n, o) => n + round(o.premium * o.rate),
                          0,
                        ),
                      )}
                    </TableCell>
                    <TableCell>
                      {orders.filter((o) => o.remitted).length} /{" "}
                      {orders.length}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          !approved ||
                          !orders.length ||
                          orders.every((o) => o.remitted)
                        }
                        onClick={async () =>
                          await update(
                            (d) => {
                              d.orders
                                .filter(
                                  (o) =>
                                    o.month === month &&
                                    o.status === "Issued" &&
                                    o.underwriter === name,
                                )
                                .forEach((o) => (o.remitted = true));
                              d.business?.policies
                                .filter(
                                  (p) =>
                                    p.issuedMonth === month &&
                                    ["Issued", "Delivered"].includes(
                                      p.status,
                                    ) &&
                                    d.orders.find((o) => o.id === p.orderId)
                                      ?.underwriter === name,
                                )
                                .forEach(
                                  (p) =>
                                    (p.remittanceReference = `Local review ${month} · ${name}`),
                                );
                            },
                            "Demo remittance reconciled",
                            `${name} · ${month} · no payment made`,
                          )
                        }
                      >
                        Mark reconciled in demo
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </DataTable>
          </section>
          <p className="inline-note">
            Complete the month-end review on the Overview tab to enable
            reconciliation. No bank connection or payment is involved.
          </p>
        </>
      )}
      {tab === "Ownership estimates" && (
        <>
          <div className="notice">
            <ChartNoAxesCombined size={18} />
            <p>
              Planning estimates based on fictional ownership interests, not
              referral counts. Actual distributions require approved accounts,
              agreements, reserves, and professional review.
            </p>
          </div>
          {rows
            .filter((r) => r.orders > 0)
            .map((r) => {
              const profit = round(r.retained - (expenses[r.company.id] || 0));
              const allocations = allocateOwnership(profit, r.company.members);
              return (
                <section className="panel distribution-card" key={r.company.id}>
                  <div className="section-heading">
                    <h2>{r.company.name}</h2>
                    <Status value="Draft" />
                  </div>
                  <div className="distribution-summary">
                    <div>
                      <small>Retained revenue</small>
                      <strong>{money(r.retained)}</strong>
                    </div>
                    <label>
                      <span>Illustrative expenses ($)</span>
                      <BufferedInput
                        type="number"
                        aria-label={`${r.company.name} illustrative expenses`}
                        value={expenses[r.company.id] || 0}
                        min="0"
                        max="10000000"
                        step=".01"
                        onCommit={async (text) => {
                          const value = Math.min(
                            10000000,
                            Math.max(0, Number(text) || 0),
                          );
                          await update((d) => {
                            d.expenses = {
                              ...d.expenses,
                              [month + ":" + r.company.id]: value,
                            };
                          });
                        }}
                      />
                    </label>
                    <div>
                      <small>Estimated profit</small>
                      <strong>{money(profit)}</strong>
                    </div>
                  </div>
                  <DataTable
                    headers={[
                      "Member",
                      "Ownership interest",
                      "Illustrative allocation",
                    ]}
                  >
                    {allocations.map((m) => (
                      <TableRow key={m.name}>
                        <TableCell>{m.name}</TableCell>
                        <TableCell>{m.share}%</TableCell>
                        <TableCell>{money(m.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                </section>
              );
            })}
          {!issued.length && <Empty title="No estimates for this month" />}
        </>
      )}
    </>
  );
}
