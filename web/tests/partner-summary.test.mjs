import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export * from "./lib/backend/partner-summary.ts"; export { emptyWorkspace, projectWorkspace } from "./lib/backend/workspace.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: "node", format: "esm",
});
const { projectPartnerSummary, selectPartnerSummary, summarizePartnerCompany, emptyWorkspace, projectWorkspace } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const now = new Date("2026-09-13T12:00:00Z");
const company = (id, memberName) => ({ id, name: `Private company ${id}`, members: [{ name: memberName, share: 100, email: `private-${id}@example.com` }] });
const order = (id, overrides = {}) => ({
  id: `private-file-${id}`, companyId: "A", receivedAt: "2026-09-01", outcomes: [],
  address: "Private property address", client: "Private client", notes: "Private internal note", premium: 12345,
  status: "New", month: "1999-01", ...overrides,
});
const event = (kind, date) => ({ kind, date, note: "Private event note", actor: "private-staff@example.com" });
const state = (orders = []) => ({ companies: [company("A", "Member A"), company("B", "Member B")], orders });
const access = (overrides = {}) => ({
  userId: "partner-a", email: "a@example.com", role: "partner", companyIds: ["A"], allCompanies: false,
  restricted: false, version: 1, partnerMembers: [{ id: "grant-a", companyId: "A", memberName: "Member A" }], ...overrides,
});

test("summary requires both company scope and a current exact membership assignment", () => {
  const source = state([order("a"), order("b", { companyId: "B" })]);
  for (const denied of [
    access({ partnerMembers: [] }),
    access({ role: "viewer" }),
    access({ companyIds: [] }),
    access({ companyIds: ["B"] }),
    access({ partnerMembers: [{ id: "stale", companyId: "A", memberName: "Removed member" }] }),
    access({ partnerMembers: [{ id: "case", companyId: "A", memberName: "member a" }] }),
    access({ partnerMembers: [{ id: "unscoped", companyId: "B", memberName: "Member B" }] }),
    access({ allCompanies: true, partnerMembers: [] }),
  ]) assert.deepEqual(projectPartnerSummary(source, denied, now).rows, []);
  const revoked = structuredClone(source);
  revoked.companies[0].members = [];
  assert.deepEqual(projectPartnerSummary(revoked, access(), now).rows, []);
  assert.equal(selectPartnerSummary(projectPartnerSummary(source, access(), now), "B", "2026-09"), undefined);
});

test("projection contains only safe company aggregates, deduplicates grants, and never mutates source", () => {
  const source = state([order("a"), order("b", { companyId: "B" })]);
  source.partnerSummary = { asOfDate: "2026-09-13", rows: [{ companyId: "B", secret: "Untrusted saved summary" }] };
  const before = JSON.stringify(source);
  const summary = projectPartnerSummary(source, access({ partnerMembers: [
    ...access().partnerMembers, { id: "duplicate", companyId: "A", memberName: "Member A" },
  ] }), now);
  assert.deepEqual(summary, {
    asOfDate: "2026-09-13",
    rows: [{ companyId: "A", period: "2026-09", received: 1, pending: 1, closingRecorded: 0, rejected: 0, recovered: 0, lost: 0 }],
  });
  for (const privateValue of ["private", "Private", "Member A", "premium", "notes", "client", "address", "Untrusted", '"B"'])
    assert.equal(JSON.stringify(summary).includes(privateValue), false, privateValue);
  assert.equal(JSON.stringify(source), before);
});

test("monthly event counts use dates, count each file once, and distinguish closings from issuance", () => {
  const source = state([
    order("intake"),
    order("closed", { receivedAt: "2026-08-01", outcomes: [event("Closing recorded", "2026-09-08"), event("Closing recorded", "2026-09-09")] }),
    order("lost", { receivedAt: "2026-08-01", outcomes: [event("Rejected", "2026-09-02"), event("Recovery lost", "2026-09-05")] }),
    order("recovered", { receivedAt: "2026-08-01", outcomes: [event("Recovered", "2026-09-10"), event("Rejected", "2026-09-01")] }),
    order("undated", { receivedAt: undefined, outcomes: [event("Closing recorded", "2026-09-06")] }),
    order("future", { receivedAt: "2026-09-20", outcomes: [event("Closing recorded", "2026-09-30")] }),
    order("issued", { receivedAt: "2026-08-01", status: "Issued" }),
    order("foreign", { companyId: "B" }),
  ]);
  const summary = projectPartnerSummary(source, access(), now);
  assert.deepEqual(selectPartnerSummary(summary, "A", "2026-09"), {
    companyId: "A", period: "2026-09", received: 1, pending: 3, closingRecorded: 2, rejected: 2, recovered: 1, lost: 1,
  });
  assert.equal(selectPartnerSummary(summary, "A", "2026-08").pending, 4);
  assert.deepEqual(summarizePartnerCompany(source, "A", "2026-09", now), selectPartnerSummary(summary, "A", "2026-09"));
});

test("historical pending follows event-date order and same-date entry order, not mutable status", () => {
  const source = state([order("reopened", {
    receivedAt: "2026-07-01", status: "Rejected",
    outcomes: [event("Recovered", "2026-09-02"), event("Recovery lost", "2026-08-10"), event("Rejected", "2026-08-01")],
  })]);
  let summary = projectPartnerSummary(source, access(), now);
  assert.equal(selectPartnerSummary(summary, "A", "2026-07").pending, 1);
  assert.equal(selectPartnerSummary(summary, "A", "2026-08").pending, 0);
  assert.equal(selectPartnerSummary(summary, "A", "2026-09").pending, 1);
  source.orders[0].outcomes.push(event("Rejected", "2026-09-02"));
  summary = projectPartnerSummary(source, access(), now);
  assert.equal(selectPartnerSummary(summary, "A", "2026-09").pending, 0);
  source.orders[0].outcomes.push(event("Recovered", "2026-09-02"));
  assert.equal(selectPartnerSummary(projectPartnerSummary(source, access(), now), "A", "2026-09").pending, 1);
});

test("quiet months carry pending forward without repeating events or expanding the projection", () => {
  const source = state([order("old", { receivedAt: "2025-01-01", outcomes: [event("Closing recorded", "2026-08-20")] })]);
  const summary = projectPartnerSummary(source, access(), now);
  assert.deepEqual(summary.rows.map((row) => row.period), ["2025-01", "2026-08", "2026-09"]);
  assert.deepEqual(selectPartnerSummary(summary, "A", "2026-07"), {
    companyId: "A", period: "2026-07", received: 0, pending: 1, closingRecorded: 0, rejected: 0, recovered: 0, lost: 0,
  });
  assert.equal(selectPartnerSummary(summary, "A", "2024-12").pending, 0);
  assert.equal(selectPartnerSummary(summary, "A", "2026-09").pending, 0);
  for (const period of ["", "2026-13", "2026-9", "2026-10"])
    assert.equal(selectPartnerSummary(summary, "A", period), undefined);
  assert.equal(selectPartnerSummary(undefined, "A", "2026-09"), undefined);
});

test("invalid, unknown, and future dates cannot create receipt, event, or pending counts", () => {
  const source = state([
    order("unknown", { receivedAt: undefined, status: "Issued" }),
    order("invalid", { receivedAt: "2026-02-30", outcomes: [event("Rejected", "2026-02-30"), event("Closing recorded", "2026-09-32")] }),
    order("future", { receivedAt: "2026-09-14", outcomes: [event("Rejected", "2026-09-14")] }),
    order("orphan", { companyId: "deleted" }),
  ]);
  assert.deepEqual(projectPartnerSummary(source, access(), now).rows, [
    { companyId: "A", period: "2026-09", received: 0, pending: 0, closingRecorded: 0, rejected: 0, recovered: 0, lost: 0 },
  ]);
  assert.equal(summarizePartnerCompany(source, "deleted", "2026-09", now), undefined);
});

test("the current reporting month and cutoff follow Carolina time at a UTC month boundary", () => {
  const source = state([order("newyear", { receivedAt: "2027-01-01" })]);
  const before = projectPartnerSummary(source, access(), new Date("2027-01-01T04:59:59Z"));
  assert.equal(before.asOfDate, "2026-12-31");
  assert.equal(selectPartnerSummary(before, "A", "2027-01"), undefined);
  assert.equal(selectPartnerSummary(before, "A", "2026-12").received, 0);
  const after = projectPartnerSummary(source, access(), new Date("2027-01-01T05:00:00Z"));
  assert.equal(after.asOfDate, "2027-01-01");
  assert.equal(selectPartnerSummary(after, "A", "2027-01").received, 1);
});

test("the real workspace projection publishes aggregates without raw orders or stale saved summaries", () => {
  const source = { ...emptyWorkspace(), ...state([
    order("a", { receivedAt: "2020-01-01" }),
    order("b", { companyId: "B", receivedAt: "2020-01-01" }),
  ]) };
  source.partnerSummary = { asOfDate: "2026-09-13", rows: [{ companyId: "B", secret: "Stale unsafe summary" }] };
  const projected = projectWorkspace(source, access());
  assert.deepEqual(projected.orders, []);
  assert.equal(projected.companies.length, 1);
  assert.equal(selectPartnerSummary(projected.partnerSummary, "A", projected.partnerSummary.asOfDate.slice(0, 7)).pending, 1);
  assert.equal(selectPartnerSummary(projected.partnerSummary, "B", projected.partnerSummary.asOfDate.slice(0, 7)), undefined);
  for (const privateValue of ["Private property address", "Private client", "Private internal note", "private-file-", "Stale unsafe summary"])
    assert.equal(JSON.stringify(projected).includes(privateValue), false, privateValue);
  assert.deepEqual(projectWorkspace(source, access({ partnerMembers: [] })).partnerSummary.rows, []);
  assert.equal(projectWorkspace(source, access({ role: "owner", allCompanies: true })).partnerSummary, undefined);
});
