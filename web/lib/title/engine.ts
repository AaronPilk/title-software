import { ledgerLines } from "./business";
import { onboardingSteps, onboardingOwner, type Workspace } from "./model";
export function executeRules(d: Workspace, ids: string[]) {
  let count = 0;
  for (const id of ids) {
    const r = d.rules.find((x) => x.id === id);
    if (!r || !r.enabled) continue;
    if (id === "intake")
      for (const m of d.inbox) {
        const o = d.orders.find((x) => x.id === m.orderId);
        if (m.status === "New" && m.kind !== "Revision" && o) {
          m.status = "Queued";
          if (
            o.fields.length &&
            !["Issued", "Ready for jacket", "Rejected"].includes(o.status)
          )
            o.status = "Needs review";
          count++;
        }
      }
    if (id === "onboarding")
      for (const c of d.companies.filter((x) => x.stage === "Onboarding")) {
        const title =
          onboardingSteps[c.steps.findIndex((x) => !x)] ||
          "Confirm launch readiness";
        const key = `auto-onboard-${c.id}-${c.steps.findIndex((x) => !x)}`;
        if (!d.tasks.some((t) => t.id === key)) {
          d.tasks.unshift({
            id: key,
            title,
            companyId: c.id,
            owner: onboardingOwner(c.steps.findIndex((x) => !x)),
            due: "2026-09-15",
            priority: "Normal",
            done: false,
          });
          count++;
        }
      }
    if (id === "exceptions")
      for (const o of d.orders.filter((x) => x.status === "Rejected")) {
        const key = `auto-rejected-${o.id}`;
        if (!d.tasks.some((t) => t.id === key)) {
          d.tasks.unshift({
            id: key,
            title: `Review rejected order ${o.id}`,
            companyId: o.companyId,
            owner: "John",
            due: "2026-09-15",
            priority: "High",
            done: false,
          });
          count++;
        }
      }
    if (id === "renewals") {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() + 30);
      const cutoff = cutoffDate.toISOString().slice(0, 10);
      for (const record of d.business?.credentials || []) {
        const due = [record.expiresOn, record.reviewOn]
          .filter(Boolean)
          .sort()[0];
        if (!due || due > cutoff) continue;
        const key = `auto-renew-${record.id}-${due}`;
        if (d.tasks.some((t) => t.id === key)) continue;
        d.tasks.unshift({
          id: key,
          title: `Review ${record.state} ${record.underwriter || record.kind} authority`,
          companyId: record.companyId,
          owner: record.reviewer || "John",
          due,
          priority: "High",
          done: false,
        });
        count++;
      }
    }
    r.runs++;
    r.lastRun = new Date().toISOString();
  }
  return count;
}

export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function financeRows(s: Workspace, month: string) {
  return s.companies.map((c) => {
    const orders = ledgerLines(s, c.id, month);
    const premium = round(orders.reduce((n, o) => n + o.premium, 0));
    const remittance = round(orders.reduce((n, o) => n + o.remittance, 0));
    return {
      company: c,
      orders: orders.length,
      premium,
      remittance,
      retained: round(premium - remittance),
    };
  });
}

/** Allocate integer cents by largest remainder, so every share is nonnegative and totals balance. */
export function allocateOwnership(
  profit: number,
  members: { name: string; share: number }[],
) {
  const total = members.reduce((n, m) => n + m.share, 0);
  if (
    !Number.isFinite(profit) ||
    !members.length ||
    Math.abs(total - 100) > 0.000001 ||
    members.some((m) => !Number.isFinite(m.share) || m.share <= 0)
  )
    return [];
  const cents = Math.round(Math.max(0, profit) * 100);
  const shares = members.map((m, index) => {
    const exact = (cents * m.share) / total;
    return {
      ...m,
      index,
      cents: Math.floor(exact),
      fraction: exact - Math.floor(exact),
    };
  });
  const remaining = cents - shares.reduce((n, m) => n + m.cents, 0);
  const ranking = [...shares].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  );
  for (let i = 0; i < remaining; i++) ranking[i].cents++;
  return shares.map((m) => ({
    name: m.name,
    share: m.share,
    amount: m.cents / 100,
  }));
}
