import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import {
  newClose,
  reviewClose,
  publishClose,
  validateBusinessMutation,
} from "../.local-test/business.js";
import {
  statementDeliveries,
  prepareStatementDelivery,
  statementDeliveryCurrent,
  statementDeliveryText,
  recordStatementDelivery,
  cancelStatementDelivery,
  isValidStatementDeliveries,
  isValidStatementDeliveryWorkspace,
} from "../.local-test/statement-delivery.js";

const today = () => new Date().toISOString().slice(0, 10);
function publish(s, companyId = "c1") {
  const p = newClose(s, companyId, "2026-09");
  p.booksReference = "Reviewed sample books";
  p.agreementReference = "Reviewed sample agreement";
  p.note = "Reviewed period inputs and allocation";
  p.externalPremium = p.totals.premium;
  p.externalRemittance = p.totals.remittance;
  reviewClose(s, p);
  publishClose(s, p.id);
  return p;
}
function fixture() {
  const s = createSeed();
  const p = publish(s);
  const input = {
    companyId: p.companyId,
    closeId: p.id,
    memberName: p.allocations[0].name,
    recipientName: "Approved recipient",
    recipientEmail: "recipient@example.com",
    reviewNote: "Confirmed the member, address and statement",
    confirmed: true,
  };
  return { s, p, input };
}
const outcome = () => ({
  deliveredOn: today(),
  reference: "Mail archive message 123",
  note: "Confirmed manual delivery record",
});
function mutate(s, fn) {
  const before = structuredClone(s);
  const result = fn();
  validateBusinessMutation(before, s);
  return result;
}

test("statement preparation freezes only the selected member and export does not record delivery", () => {
  const { s, p, input } = fixture();
  const originalClose = structuredClone(p);
  const r = mutate(s, () => prepareStatementDelivery(s, input));
  const beforeExport = structuredClone(s);
  const text = statementDeliveryText(s, r.id);
  assert.match(text, /Revision 1/);
  assert.ok(text.includes(input.memberName));
  assert.ok(text.includes(input.recipientEmail));
  for (const member of p.allocations.slice(1))
    assert.ok(!text.includes(member.name));
  assert.deepEqual(s, beforeExport);
  assert.deepEqual(p, originalClose);
  assert.equal(r.status, "Prepared");
  assert.equal(r.deliveryReference, "");
});
test("preparation rejects wrong company, unreviewed source, invalid recipient and ambiguous member without mutation", () => {
  for (const change of [
    (f) => {
      f.input.companyId = "c2";
    },
    (f) => {
      f.p.status = "Reviewed";
    },
    (f) => {
      f.input.confirmed = false;
    },
    (f) => {
      f.input.recipientEmail = "invalid";
    },
    (f) => {
      f.input.reviewNote = " ";
    },
    (f) => {
      f.input.memberName = "Wrong member";
    },
    (f) => {
      f.p.allocations.push({ ...f.p.allocations[0] });
    },
  ]) {
    const f = fixture();
    change(f);
    const before = structuredClone(f.s);
    assert.throws(() => prepareStatementDelivery(f.s, f.input));
    assert.deepEqual(f.s, before);
  }
});
test("live ownership changes and a new draft do not change or redirect a prepared statement", () => {
  const { s, p, input } = fixture();
  const r = prepareStatementDelivery(s, input);
  const text = statementDeliveryText(s, r.id);
  const c = s.companies.find((c) => c.id === p.companyId);
  mutate(s, () => {
    c.name = "Renamed company";
    c.email = "changed@example.com";
    c.members = [{ name: "New member", share: 100 }];
    newClose(s, c.id, p.month);
  });
  assert.equal(statementDeliveryCurrent(s, r), true);
  assert.equal(statementDeliveryText(s, r.id), text);
});
test("superseded and withdrawn closes block pending export/delivery, while recorded history survives", () => {
  const { s, p, input } = fixture();
  const completed = prepareStatementDelivery(s, input);
  const text = statementDeliveryText(s, completed.id);
  mutate(s, () => recordStatementDelivery(s, completed.id, outcome()));
  const pending = prepareStatementDelivery(s, {
    ...input,
    recipientEmail: "second@example.com",
  });
  const next = mutate(s, () => publish(s));
  assert.equal(p.status, "Superseded");
  assert.equal(statementDeliveryCurrent(s, pending), false);
  const before = structuredClone(s);
  assert.throws(() => statementDeliveryText(s, pending.id), /source changed/);
  assert.throws(
    () => recordStatementDelivery(s, pending.id, outcome()),
    /source changed/,
  );
  assert.deepEqual(s, before);
  assert.equal(statementDeliveryText(s, completed.id), text);
  const latest = prepareStatementDelivery(s, { ...input, closeId: next.id });
  mutate(s, () => {
    next.status = "Withdrawn";
    next.note += "\nWithdrawn for review";
  });
  assert.equal(statementDeliveryCurrent(s, latest), false);
  assert.equal(statementDeliveryCurrent(s, pending), false);
  assert.throws(() => recordStatementDelivery(s, latest.id, outcome()));
  mutate(s, () => cancelStatementDelivery(s, latest.id, "Source withdrawn"));
  assert.equal(latest.status, "Cancelled");
  assert.equal(statementDeliveryText(s, completed.id), text);
});
test("delivery requires actual dated evidence and repeated completion is idempotent", () => {
  const { s, input } = fixture();
  const r = prepareStatementDelivery(s, input);
  for (const value of [
    { ...outcome(), deliveredOn: "2099-01-01" },
    { ...outcome(), deliveredOn: "2026-02-30" },
    { ...outcome(), deliveredOn: "2020-01-01" },
    { ...outcome(), reference: " " },
    { ...outcome(), note: " " },
  ]) {
    const before = structuredClone(s);
    assert.throws(() => recordStatementDelivery(s, r.id, value));
    assert.deepEqual(s, before);
  }
  mutate(s, () => recordStatementDelivery(s, r.id, outcome()));
  const recorded = structuredClone(s);
  assert.equal(recordStatementDelivery(s, r.id, outcome()), r);
  assert.deepEqual(s, recorded);
  assert.throws(() =>
    recordStatementDelivery(s, r.id, {
      ...outcome(),
      reference: "Replacement",
    }),
  );
  assert.deepEqual(s, recorded);
});
test("mutation validation protects frozen recipient, statement and completed evidence", () => {
  const { s, input } = fixture();
  const r = prepareStatementDelivery(s, input);
  for (const edit of [
    (x) => {
      x.statementDeliveries[0].recipientEmail = "other@example.com";
    },
    (x) => {
      x.statementDeliveries[0].snapshot.amount += 1;
    },
    (x) => {
      x.statementDeliveries = [];
    },
  ]) {
    const after = structuredClone(s);
    edit(after);
    assert.throws(() => validateBusinessMutation(s, after), /Preserve/);
  }
  recordStatementDelivery(s, r.id, outcome());
  const after = structuredClone(s);
  after.statementDeliveries[0].deliveryReference = "Replaced evidence";
  assert.throws(() => validateBusinessMutation(s, after), /history/);
  assert.throws(() => cancelStatementDelivery(s, r.id, "No longer needed"));
});
test("old workspaces remain valid and complete delivery history survives JSON backup serialization", () => {
  const { s, input } = fixture();
  assert.deepEqual(statementDeliveries(s), []);
  assert.equal(isValidStatementDeliveries(undefined), true);
  const r = prepareStatementDelivery(s, input);
  recordStatementDelivery(s, r.id, outcome());
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(isValidStatementDeliveries(restored.statementDeliveries), true);
  assert.equal(isValidStatementDeliveryWorkspace(restored), true);
  assert.equal(
    statementDeliveryText(restored, r.id),
    statementDeliveryText(s, r.id),
  );
  assert.deepEqual(
    statementDeliveries(restored, input.companyId),
    s.statementDeliveries,
  );
  assert.deepEqual(statementDeliveries(restored, "c2"), []);
  for (const bad of [
    null,
    "bad",
    {},
    [{}],
    [r, r],
    [{ ...r, snapshot: null }],
    [{ ...r, snapshot: { ...r.snapshot, companyId: "other" } }],
    [{ ...r, recordedAt: "bad" }],
  ]) {
    assert.equal(isValidStatementDeliveries(bad), false);
  }
});

test("duplicate preparation is idempotent and changed recipients are separate reviewed attempts", () => {
  const { s, input } = fixture();
  const r = prepareStatementDelivery(s, input);
  const before = structuredClone(s);
  assert.equal(prepareStatementDelivery(s, input), r);
  assert.deepEqual(s, before);
  const other = prepareStatementDelivery(s, {
    ...input,
    recipientEmail: "different@example.com",
  });
  assert.notEqual(other.id, r.id);
  assert.equal(statementDeliveries(s).length, 2);
});
test("restore rejects orphaned, cross-company and altered statement snapshots while retaining withdrawn history", () => {
  const { s, p, input } = fixture();
  const r = prepareStatementDelivery(s, input);
  recordStatementDelivery(s, r.id, outcome());
  p.status = "Withdrawn";
  p.note += "\nWithdrawn";
  assert.equal(
    isValidStatementDeliveryWorkspace(JSON.parse(JSON.stringify(s))),
    true,
  );
  for (const edit of [
    (x) => {
      x.business.closes = [];
    },
    (x) => {
      x.statementDeliveries[0].snapshot.amount += 0.01;
    },
    (x) => {
      x.business.closes[0].companyId = "c2";
    },
    (x) => {
      x.business.closes[0].allocations[0].amount += 0.01;
    },
    (x) => {
      x.statementDeliveries[0].recordedAt = "2000-01-01T00:00:00.000Z";
    },
    (x) => {
      x.statementDeliveries[0].deliveredOn = "2099-01-01";
    },
    (x) => {
      x.statementDeliveries[0].recordedAt = "2099-01-01T00:00:00.000Z";
    },
  ]) {
    const bad = structuredClone(s);
    edit(bad);
    assert.equal(isValidStatementDeliveryWorkspace(bad), false);
  }
});
