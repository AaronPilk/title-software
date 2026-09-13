import type { Order, PartnerCompanyPeriodSummary, PartnerOperationalSummary, Workspace } from "../title/model";
import { outcomesByDate } from "../title/business";
import type { Access } from "./workspace";

const validPeriod = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function carolinaDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function emptySummary(companyId: string, period: string): PartnerCompanyPeriodSummary {
  return { companyId, period, received: 0, pending: 0, closingRecorded: 0, rejected: 0, recovered: 0, lost: 0 };
}

/** A period ends at month-end, or today for the current month. Never infer dates from status. */
function companyPeriod(orders: Order[], companyId: string, period: string, asOfDate: string) {
  const result = emptySummary(companyId, period);
  const cutoff = period === asOfDate.slice(0, 7) ? asOfDate : `${period}-31`;
  for (const order of orders) {
    const received = validDate(order.receivedAt) && order.receivedAt <= cutoff;
    if (received && order.receivedAt!.slice(0, 7) === period) result.received++;
    const events = outcomesByDate(order).filter((event) => validDate(event.date) && event.date <= cutoff);
    const kindsThisMonth = new Set(events.filter((event) => event.date.slice(0, 7) === period).map((event) => event.kind));
    if (kindsThisMonth.has("Rejected")) result.rejected++;
    if (kindsThisMonth.has("Recovered")) result.recovered++;
    if (kindsThisMonth.has("Recovery lost")) result.lost++;
    if (kindsThisMonth.has("Closing recorded")) result.closingRecorded++;

    // Historical pending must use dated outcomes, never today's mutable status.
    // Contacted/lost are only recorded during a rejection, so they also establish it.
    let rejected = false;
    for (const event of events) {
      if (["Rejected", "Contacted", "Recovery lost"].includes(event.kind)) rejected = true;
      if (event.kind === "Recovered") rejected = false;
    }
    if (received && !rejected && !events.some((event) => event.kind === "Closing recorded")) result.pending++;
  }
  return result;
}

/** Admin/demo preview. Connected partners must consume projectPartnerSummary's authorized result. */
export function summarizePartnerCompany(
  source: Workspace, companyId: string, period: string, now = new Date(),
): PartnerCompanyPeriodSummary | undefined {
  const asOfDate = carolinaDate(now);
  if (!validPeriod(period) || period > asOfDate.slice(0, 7) || !source.companies.some((company) => company.id === companyId)) return undefined;
  return companyPeriod(source.orders.filter((order) => order.companyId === companyId), companyId, period, asOfDate);
}

/** Safe allowlist projection. Both company scope and a current exact member assignment are required. */
export function projectPartnerSummary(source: Workspace, access: Access, now = new Date()): PartnerOperationalSummary {
  const asOfDate = carolinaDate(now);
  const result: PartnerOperationalSummary = { asOfDate, rows: [] };
  if (access.role !== "partner") return result;
  const companyIds = new Set(access.partnerMembers.filter((grant) =>
    (access.allCompanies || access.companyIds.includes(grant.companyId)) &&
    source.companies.some((company) => company.id === grant.companyId && company.members.some((member) => member.name === grant.memberName)),
  ).map((grant) => grant.companyId));

  for (const companyId of companyIds) {
    const orders = source.orders.filter((order) => order.companyId === companyId);
    const periods = new Set([asOfDate.slice(0, 7)]);
    for (const order of orders) {
      for (const date of [order.receivedAt, ...(order.outcomes || []).map((event) => event.date)])
        if (validDate(date) && date <= asOfDate) periods.add(date.slice(0, 7));
    }
    for (const period of [...periods].sort()) result.rows.push(companyPeriod(orders, companyId, period, asOfDate));
  }
  return result;
}

/** Quiet months have zero events and retain the previous dated pending balance. */
export function selectPartnerSummary(
  summary: PartnerOperationalSummary | undefined, companyId: string, period: string,
): PartnerCompanyPeriodSummary | undefined {
  if (!summary || !validDate(summary.asOfDate) || !validPeriod(period) || period > summary.asOfDate.slice(0, 7)) return undefined;
  const rows = summary.rows.filter((row) => row.companyId === companyId);
  if (!rows.length) return undefined;
  const exact = rows.find((row) => row.period === period);
  if (exact) return exact;
  const prior = rows.filter((row) => row.period < period).sort((a, b) => b.period.localeCompare(a.period))[0];
  return { ...emptySummary(companyId, period), pending: prior?.pending ?? 0 };
}
