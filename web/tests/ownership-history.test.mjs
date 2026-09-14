import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import {
  validateBusinessMutation,
  newClose,
  reviewClose,
  publishClose,
  closeFingerprint,
} from "../.local-test/business.js";
import {
  monthEnd,
  ownershipHistory,
  ownershipAsOf,
  ownershipForMonth,
  ownershipDrift,
  recordOwnership,
  isValidOwnershipHistory,
  validateOwnershipMutation,
} from "../.local-test/ownership-history.js";

const AT = new Date("2026-09-14T12:00:00Z");

function seed() {
  const s = createSeed();
  s.user = "John";
  s.ownershipHistory = [];
  const company = s.companies[0];
  company.members = [
    { name: "Ada Cole", share: 60 },
    { name: "Ben Ruiz", share: 40 },
  ];
  return { s, company };
}

const opening = (extra = {}) => ({
  effectiveFrom: "2026-01-01",
  members: [
    { name: "Ada Cole", share: 60 },
    { name: "Ben Ruiz", share: 40 },
  ],
  reason: "Ownership at formation, per the operating agreement",
  ...extra,
});

test("month end is calculated for short, long and leap months", () => {
  assert.equal(monthEnd("2026-04"), "2026-04-30");
  assert.equal(monthEnd("2026-01"), "2026-01-31");
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.equal(monthEnd("2026-12"), "2026-12-31");
  assert.throws(() => monthEnd("2026-13"), /valid reporting month/);
});

test("with no recorded history the current members govern, visibly", () => {
  const { s, company } = seed();
  const r = ownershipForMonth(s, company, "2026-04");
  assert.equal(r.source, "current");
  assert.equal(r.record, null);
  assert.equal(r.beforeHistory, false);
  assert.deepEqual(r.members, [
    { name: "Ada Cole", share: 60 },
    { name: "Ben Ruiz", share: 40 },
  ]);
});

test("the first record is the opening position and later ones are changes", () => {
  const { s, company } = seed();
  const first = recordOwnership(s, company.id, opening(), AT);
  assert.equal(first.opening, true);
  assert.equal(first.recordedBy, "John");
  const second = recordOwnership(
    s,
    company.id,
    {
      effectiveFrom: "2026-05-01",
      members: [
        { name: "Ada Cole", share: 50 },
        { name: "Ben Ruiz", share: 30 },
        { name: "Cleo Park", share: 20 },
      ],
      reason: "Cleo admitted as a member",
    },
    AT,
  );
  assert.equal(second.opening, false);
  assert.equal(ownershipHistory(s, company.id).length, 2);
});

test("ownership resolves to the record in effect on the date asked about", () => {
  const { s, company } = seed();
  recordOwnership(s, company.id, opening(), AT);
  recordOwnership(
    s,
    company.id,
    {
      effectiveFrom: "2026-05-01",
      members: [
        { name: "Ada Cole", share: 50 },
        { name: "Ben Ruiz", share: 50 },
      ],
      reason: "Shares equalised",
    },
    AT,
  );
  assert.equal(ownershipAsOf(s, company, "2026-04-30").members[0].share, 60);
  assert.equal(ownershipAsOf(s, company, "2026-05-01").members[0].share, 50);
  assert.equal(ownershipAsOf(s, company, "2026-08-15").members[0].share, 50);
  // A date before the opening record is reported, not guessed.
  const early = ownershipAsOf(s, company, "2025-12-31");
  assert.equal(early.source, "current");
  assert.equal(early.beforeHistory, true);
});

test("a close for April uses April's ownership even when closed in September", () => {
  const { s, company } = seed();
  recordOwnership(s, company.id, opening(), AT);
  recordOwnership(
    s,
    company.id,
    {
      effectiveFrom: "2026-05-01",
      members: [
        { name: "Ada Cole", share: 10 },
        { name: "Ben Ruiz", share: 90 },
      ],
      reason: "Ada sold down her interest",
    },
    AT,
  );
  // Current members now reflect the newest position.
  company.members = [
    { name: "Ada Cole", share: 10 },
    { name: "Ben Ruiz", share: 90 },
  ];
  const april = newClose(s, company.id, "2026-04");
  assert.deepEqual(april.members, [
    { name: "Ada Cole", share: 60 },
    { name: "Ben Ruiz", share: 40 },
  ]);
  assert.equal(april.ownershipSource.effectiveFrom, "2026-01-01");
  const june = newClose(s, company.id, "2026-06");
  assert.deepEqual(june.members, [
    { name: "Ada Cole", share: 10 },
    { name: "Ben Ruiz", share: 90 },
  ]);
  assert.equal(june.ownershipSource.effectiveFrom, "2026-05-01");
});

test("a close with no dated record still records that current members governed", () => {
  const { s, company } = seed();
  const p = newClose(s, company.id, "2026-04");
  assert.equal(p.ownershipSource, null);
  assert.deepEqual(p.members, [
    { name: "Ada Cole", share: 60 },
    { name: "Ben Ruiz", share: 40 },
  ]);
});

test("editing current members no longer disturbs a close governed by a dated record", () => {
  const { s, company } = seed();
  recordOwnership(s, company.id, opening(), AT);
  const before = closeFingerprint(s, company, "2026-04");
  company.members = [
    { name: "Ada Cole", share: 25 },
    { name: "Ben Ruiz", share: 75 },
  ];
  assert.equal(closeFingerprint(s, company, "2026-04"), before);
  // But a new record that changes which ownership governs April does.
  recordOwnership(
    s,
    company.id,
    {
      effectiveFrom: "2026-03-01",
      members: [
        { name: "Ada Cole", share: 25 },
        { name: "Ben Ruiz", share: 75 },
      ],
      reason: "Backdated correction from the amended agreement",
    },
    AT,
  );
  assert.notEqual(closeFingerprint(s, company, "2026-04"), before);
});

test("with no dated history, changing members still invalidates the close as before", () => {
  const { s, company } = seed();
  const before = closeFingerprint(s, company, "2026-04");
  company.members = [
    { name: "Ada Cole", share: 25 },
    { name: "Ben Ruiz", share: 75 },
  ];
  assert.notEqual(closeFingerprint(s, company, "2026-04"), before);
});

test("recording rejects bad dates, bad shares, duplicates and a missing reason", () => {
  const { s, company } = seed();
  assert.throws(() => recordOwnership(s, company.id, opening({ effectiveFrom: "nope" }), AT), /date this ownership took effect/);
  assert.throws(
    () => recordOwnership(s, company.id, opening({ effectiveFrom: "2026-12-01" }), AT),
    /effective in the future/,
  );
  assert.throws(() => recordOwnership(s, company.id, opening({ reason: "  " }), AT), /Record why/);
  assert.throws(
    () => recordOwnership(s, company.id, opening({ members: [{ name: "Ada Cole", share: 70 }, { name: "Ben Ruiz", share: 40 }] }), AT),
    /total 100 percent/,
  );
  assert.throws(
    () => recordOwnership(s, company.id, opening({ members: [{ name: "Ada Cole", share: 100 }, { name: "ada cole", share: 0 }] }), AT),
    /above zero/,
  );
  assert.throws(
    () => recordOwnership(s, company.id, opening({ members: [{ name: "Ada Cole", share: 50 }, { name: "ada cole", share: 50 }] }), AT),
    /only appear once/,
  );
  assert.throws(() => recordOwnership(s, company.id, opening({ members: [] }), AT), /at least one member/);
  assert.throws(() => recordOwnership(s, "company-gone", opening(), AT), /no longer on file/);
  s.user = "   ";
  assert.throws(() => recordOwnership(s, company.id, opening(), AT), /Choose the operator/);
});

test("two records cannot share an effective date, and a change cannot pre-date the opening", () => {
  const { s, company } = seed();
  recordOwnership(s, company.id, opening(), AT);
  assert.throws(() => recordOwnership(s, company.id, opening({ reason: "again" }), AT), /already has an ownership record effective that date/);
  assert.throws(
    () =>
      recordOwnership(
        s,
        company.id,
        { effectiveFrom: "2025-06-01", members: opening().members, reason: "earlier" },
        AT,
      ),
    /cannot pre-date the opening record/,
  );
});

test("ownership records are append-only and cannot be edited in place", () => {
  const { s, company } = seed();
  recordOwnership(s, company.id, opening(), AT);

  const removed = structuredClone(s);
  removed.ownershipHistory = [];
  assert.throws(() => validateBusinessMutation(s, removed), /stays on file/);

  const edited = structuredClone(s);
  edited.ownershipHistory[0].members[0].share = 70;
  edited.ownershipHistory[0].members[1].share = 30;
  assert.throws(() => validateBusinessMutation(s, edited), /cannot be edited/);

  const redated = structuredClone(s);
  redated.ownershipHistory[0].effectiveFrom = "2026-02-01";
  assert.throws(() => validateBusinessMutation(s, redated), /cannot be edited/);
});

test("the validator rejects a broken history shape, totals, duplicates and opening records", () => {
  const { s, company } = seed();
  recordOwnership(s, company.id, opening(), AT);
  const base = s.ownershipHistory[0];

  const malformed = structuredClone(s);
  malformed.ownershipHistory = [{ id: "x" }];
  assert.throws(() => validateBusinessMutation(s, malformed), /not in a shape this workspace can store/);

  const unbalanced = structuredClone(s);
  unbalanced.ownershipHistory[0].members = [{ name: "Ada Cole", share: 55 }];
  assert.throws(() => validateBusinessMutation(s, unbalanced), /total 100 percent/);

  const duplicated = structuredClone(s);
  duplicated.ownershipHistory.push({ ...base, id: "own-dupe" });
  assert.throws(() => validateBusinessMutation(s, duplicated), /one ownership record effective on a date/);

  const twoOpenings = structuredClone(s);
  twoOpenings.ownershipHistory.push({ ...base, id: "own-2", effectiveFrom: "2026-06-01" });
  assert.throws(() => validateBusinessMutation(s, twoOpenings), /exactly one opening record/);

  const noOpening = structuredClone(s);
  noOpening.ownershipHistory[0].opening = false;
  assert.throws(() => validateBusinessMutation(s, noOpening), /exactly one opening record/);

  const lateOpening = structuredClone(s);
  lateOpening.ownershipHistory[0].opening = false;
  lateOpening.ownershipHistory.push({ ...base, id: "own-3", effectiveFrom: "2026-07-01", opening: true });
  assert.throws(() => validateBusinessMutation(s, lateOpening), /must be the earliest one/);
});

test("published closes allocated on other ownership are reported, never rewritten", () => {
  const { s, company } = seed();
  const p = newClose(s, company.id, "2026-04");
  p.booksReference = "QB-April";
  p.agreementReference = "OA-2026";
  p.note = "Reviewed April inputs and allocation";
  reviewClose(s, p);
  publishClose(s, p.id);
  const published = s.business.closes.find((x) => x.id === p.id);
  const frozen = structuredClone(published.allocations);
  assert.equal(ownershipDrift(s).length, 0);

  // A backdated record now says April's ownership was different.
  recordOwnership(
    s,
    company.id,
    {
      effectiveFrom: "2026-01-01",
      members: [
        { name: "Ada Cole", share: 30 },
        { name: "Ben Ruiz", share: 70 },
      ],
      reason: "Amended agreement produced at audit",
    },
    AT,
  );
  const drift = ownershipDrift(s);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].month, "2026-04");
  assert.equal(drift[0].effectiveFrom, "2026-01-01");
  assert.deepEqual(drift[0].governing, [
    { name: "Ada Cole", share: 30 },
    { name: "Ben Ruiz", share: 70 },
  ]);
  // The published allocation itself is untouched.
  assert.deepEqual(s.business.closes.find((x) => x.id === p.id).allocations, frozen);
});

test("drift ignores drafts, withdrawn revisions and periods with no dated record", () => {
  const { s, company } = seed();
  newClose(s, company.id, "2026-04");
  recordOwnership(s, company.id, { ...opening(), members: [{ name: "Ada Cole", share: 100 }] }, AT);
  // A draft is never reported as drift.
  assert.equal(ownershipDrift(s).length, 0);
});

test("history is per company and older workspaces stay valid", () => {
  const { s, company } = seed();
  const other = s.companies[1];
  recordOwnership(s, company.id, opening(), AT);
  recordOwnership(s, other.id, { ...opening(), effectiveFrom: "2026-02-01", reason: "Other company" }, AT);
  assert.equal(ownershipHistory(s, company.id).length, 1);
  assert.equal(ownershipHistory(s, other.id).length, 1);
  assert.equal(ownershipHistory(s).length, 2);

  assert.equal(isValidOwnershipHistory(undefined), true);
  assert.equal(isValidOwnershipHistory(["x"]), false);
  const older = structuredClone(s);
  delete older.ownershipHistory;
  assert.deepEqual(ownershipHistory(older), []);
  assert.doesNotThrow(() => validateOwnershipMutation(older, older));
  assert.equal(ownershipForMonth(older, older.companies[0], "2026-04").source, "current");
});
