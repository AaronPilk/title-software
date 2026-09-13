import type { Workspace } from "@/lib/title/model";

/** Reporting follows the company's Carolina business date, including at UTC month boundaries. */
export function reportingDate(now = new Date()) {
  const timeZone = "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "numeric",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return {
    period: `${value("year")}-${value("month")}`,
    day: value("day"),
    month: new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(now),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now),
    label: new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric",
    }).format(now),
  };
}

export function overviewPremium(s: Workspace, period: string) {
  const visibleCompanies = new Set(s.companies.map((company) => company.id));
  const orders = s.orders.filter((order) => visibleCompanies.has(order.companyId));
  const orderIds = new Set(orders.map((order) => order.id));
  const policies = s.business?.policies || [];
  const issued = policies.filter((policy) =>
    orderIds.has(policy.orderId) &&
    ["Issued", "Delivered"].includes(policy.status) &&
    policy.issuedMonth === period,
  );
  const legacyOrders = orders.filter((order) =>
    order.status === "Issued" && order.month === period &&
    !policies.some((policy) => policy.orderId === order.id),
  ).length;
  return {
    premium: issued.reduce((cents, policy) => cents + Math.round(policy.premium * 100), 0) / 100,
    products: issued.length,
    legacyOrders,
  };
}
