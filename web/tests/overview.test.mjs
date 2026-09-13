import test from "node:test";
import assert from "node:assert/strict";
import { reportingDate, overviewPremium } from "../components/title/overview-summary.ts";

function workspace({ orders = [], policies = [], companies = [{ id: "company-a" }] } = {}) {
  return { companies, orders, business: { policies } };
}
const order = (id, extra = {}) => ({ id, companyId: "company-a", status: "Issued", month: "2026-09", premium: 9000, ...extra });
const policy = (id, orderId, premium, extra = {}) => ({ id, orderId, premium, status: "Issued", issuedMonth: "2026-09", ...extra });

test("the reporting month changes at the Carolina midnight, not UTC midnight", () => {
  assert.equal(reportingDate(new Date("2027-01-01T04:59:59Z")).period, "2026-12");
  const current = reportingDate(new Date("2027-01-01T05:00:00Z"));
  assert.equal(current.period, "2027-01");
  assert.equal(current.day, "1");
  assert.equal(current.weekday, "Friday");
  assert.match(current.label, /2027/);
  assert.equal(reportingDate(new Date("2026-07-01T04:00:00Z")).period, "2026-07");
});

test("owner and delivered loan products count once without their file total", () => {
  const s = workspace({
    orders: [order("file-1")],
    policies: [policy("owner", "file-1", 350), policy("loan", "file-1", 150, { status: "Delivered" })],
  });
  assert.deepEqual(overviewPremium(s, "2026-09"), { premium: 500, products: 2, legacyOrders: 0 });
});

test("partial issuance counts only issued products in their recorded issue period", () => {
  const s = workspace({
    orders: [order("file-1", { status: "In progress", month: "2026-08" })],
    policies: [
      policy("issued", "file-1", 350),
      policy("prepared", "file-1", 150, { status: "Prepared" }),
      policy("void", "file-1", 100, { status: "Void" }),
      policy("prior", "file-1", 125, { issuedMonth: "2026-08" }),
    ],
  });
  assert.deepEqual(overviewPremium(s, "2026-09"), { premium: 350, products: 1, legacyOrders: 0 });
});

test("legacy totals are disclosed but not added to policy-product premium", () => {
  assert.deepEqual(overviewPremium(workspace({ orders: [order("legacy")] }), "2026-09"), {
    premium: 0, products: 0, legacyOrders: 1,
  });
  assert.equal(overviewPremium(workspace({ orders: [order("legacy")] }), "2026-10").legacyOrders, 0);
});

test("unavailable companies and missing files contribute no policy data", () => {
  const s = workspace({
    orders: [order("hidden-file", { companyId: "company-b" })],
    policies: [policy("hidden", "hidden-file", 999), policy("orphan", "missing-file", 500)],
  });
  assert.deepEqual(overviewPremium(s, "2026-09"), { premium: 0, products: 0, legacyOrders: 0 });
});

test("an empty workspace has zero ledger totals and cents sum accurately", () => {
  assert.deepEqual(overviewPremium(workspace(), "2026-09"), { premium: 0, products: 0, legacyOrders: 0 });
  const s = workspace({ orders: [order("file")], policies: [policy("one", "file", 0.1), policy("two", "file", 0.2)] });
  assert.equal(overviewPremium(s, "2026-09").premium, 0.3);
});
