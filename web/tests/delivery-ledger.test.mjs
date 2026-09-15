import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import { validateBusinessMutation } from "../.local-test/business.js";
import {
  deliveries,
  deliveryCurrent,
  deliveryState,
  deliveryCoverage,
  prepareDelivery,
  recordDelivery,
  recordDeliveryFailure,
  retryDelivery,
  cancelDelivery,
  isValidDeliveries,
  canRetryDelivery,
  deliveryRetried,
  validateDeliveryMutation,
  recipientRoles,
  deliveryMethods,
} from "../.local-test/delivery-ledger.js";

const NOW = new Date("2026-09-14T12:00:00Z");
// Preparation uses the system clock; recording below uses the fixed NOW.
// Keep both on the same day so these fixtures do not expire as time advances.
beforeEach((t) => t.mock.timers.enable({ apis: ["Date"], now: NOW }));
const day = (n) =>
  new Date(Date.parse("2026-09-14T00:00:00Z") + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

function seed() {
  const s = createSeed();
  s.user = "Tyler";
  s.deliveries = [];
  const order = s.orders[0];
  s.documents = s.documents.filter((d) => d.orderId !== order.id);
  s.documents.push({
    id: "doc-final-1",
    companyId: order.companyId,
    orderId: order.id,
    name: "Final policy.pdf",
    category: "Policy",
    visibility: "Internal",
    date: "2026-09-10",
    size: "220 KB",
    version: 1,
    sourceRole: "Final policy",
    policyId: "pol-1",
  });
  return { s, order };
}

const validInput = (over = {}) => ({
  documentId: "doc-final-1",
  recipientName: "Dana Reed",
  recipientEmail: "dana@lender.example",
  recipientRole: "Lender",
  method: "Email",
  reviewNote: "Loan policy for the Harbor file",
  ...over,
});

function supersede(s, over = {}) {
  const base = s.documents.find((d) => d.id === "doc-final-1");
  s.documents.push({ ...base, id: "doc-final-2", version: 2, date: "2026-09-13", ...over });
}

test("preparing a delivery freezes the document version, recipient and operator", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  assert.equal(r.status, "Prepared");
  assert.equal(r.attempt, 1);
  assert.equal(r.previousDeliveryId, "");
  assert.equal(r.preparedBy, "Tyler");
  assert.equal(r.preparedAt, NOW.toISOString());
  assert.equal(r.snapshot.documentName, "Final policy.pdf");
  assert.equal(r.snapshot.documentVersion, 1);
  assert.equal(r.snapshot.sourceRole, "Final policy");
  assert.ok(r.snapshot.orderReference);
  assert.equal(deliveries(s).length, 1);
  assert.equal(deliveryState(s, r), "Prepared");
});

test("preparation rejects a missing document, a loose document, a bad email and unknown choices", () => {
  const { s } = seed();
  assert.throws(() => prepareDelivery(s, validInput({ documentId: "nope" })), /no longer on file/);
  s.documents.push({
    id: "doc-loose",
    companyId: s.companies[0].id,
    name: "Company handbook.pdf",
    category: "Company",
    visibility: "Internal",
    date: "2026-09-01",
    size: "10 KB",
    version: 1,
  });
  assert.throws(
    () => prepareDelivery(s, validInput({ documentId: "doc-loose" })),
    /against a document on an order file/,
  );
  assert.throws(() => prepareDelivery(s, validInput({ recipientName: "  " })), /Name the person/);
  assert.throws(() => prepareDelivery(s, validInput({ recipientEmail: "dana" })), /valid email/);
  assert.throws(
    () => prepareDelivery(s, validInput({ recipientRole: "Neighbour" })),
    /how this recipient relates/,
  );
  assert.throws(
    () => prepareDelivery(s, validInput({ method: "Carrier pigeon" })),
    /how this document is being delivered/,
  );
  s.user = "  ";
  assert.throws(() => prepareDelivery(s, validInput()), /Choose the operator/);
});

test("a superseded document cannot start a new delivery", () => {
  const { s } = seed();
  supersede(s);
  assert.throws(
    () => prepareDelivery(s, validInput()),
    /newer version of this document exists/,
  );
  // The current version can.
  assert.doesNotThrow(() => prepareDelivery(s, validInput({ documentId: "doc-final-2" })));
});

test("one open preparation per recipient per document, but other recipients are free", () => {
  const { s } = seed();
  prepareDelivery(s, validInput());
  assert.throws(() => prepareDelivery(s, validInput()), /already has a delivery prepared/);
  // Case differences are the same recipient.
  assert.throws(
    () => prepareDelivery(s, validInput({ recipientEmail: "DANA@lender.example" })),
    /already has a delivery prepared/,
  );
  assert.doesNotThrow(() =>
    prepareDelivery(
      s,
      validInput({ recipientName: "Mark Ellis", recipientEmail: "mark@attorney.example", recipientRole: "Closing attorney" }),
    ),
  );
  assert.equal(deliveries(s, { documentId: "doc-final-1" }).length, 2);
});

test("recording a delivery captures the date, reference and operator", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  const done = recordDelivery(
    s,
    r.id,
    { deliveredOn: day(0), deliveryReference: "missive-thread-8821", deliveryNote: "Sent with the CPL" },
    NOW,
  );
  assert.equal(done.status, "Recorded");
  assert.equal(done.deliveryReference, "missive-thread-8821");
  assert.equal(done.recordedBy, "Tyler");
  assert.ok(done.recordedAt);
});

test("recording rejects a missing reference, a pre-preparation date and a future date", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: " ", deliveryNote: "" }, NOW),
    /evidence reference/,
  );
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: day(-5), deliveryReference: "x", deliveryNote: "" }, NOW),
    /before it was prepared/,
  );
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: day(3), deliveryReference: "x", deliveryNote: "" }, NOW),
    /dated in the future/,
  );
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: "nope", deliveryReference: "x", deliveryNote: "" }, NOW),
    /Enter the date this was delivered/,
  );
});

test("a document replaced after preparation goes stale and cannot be recorded", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  assert.equal(deliveryCurrent(s, r), true);
  supersede(s);
  assert.equal(deliveryCurrent(s, r), false);
  assert.equal(deliveryState(s, r), "Source changed");
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: "x", deliveryNote: "" }, NOW),
    /changed after the delivery was prepared/,
  );
  // A stale preparation can still be cancelled with a reason.
  assert.doesNotThrow(() => cancelDelivery(s, r.id, "Superseded by version 2"));
});

test("a failed delivery records why, and retry opens a linked second attempt", () => {
  const { s } = seed();
  const first = prepareDelivery(s, validInput());
  recordDeliveryFailure(s, first.id, { failedOn: day(0), failureReason: "Mailbox full — bounced" }, NOW);
  assert.equal(deliveries(s)[0].status, "Failed");
  assert.equal(deliveries(s)[0].failedBy, "Tyler");
  const second = retryDelivery(s, first.id, {
    recipientEmail: "dana.reed@lender.example",
    method: "Secure portal",
    reviewNote: "Resent to her corrected address",
  });
  assert.equal(second.attempt, 2);
  assert.equal(second.previousDeliveryId, first.id);
  assert.equal(second.recipientEmail, "dana.reed@lender.example");
  assert.equal(second.method, "Secure portal");
  assert.equal(second.status, "Prepared");
  // The original failure stays exactly as it was.
  assert.equal(deliveries(s)[0].status, "Failed");
  assert.equal(deliveries(s)[0].failureReason, "Mailbox full — bounced");
});

test("a retry binds to the version current at retry time, not the failed one", () => {
  const { s } = seed();
  const first = prepareDelivery(s, validInput());
  recordDeliveryFailure(s, first.id, { failedOn: day(0), failureReason: "Bounced" }, NOW);
  supersede(s);
  const second = retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "" });
  assert.equal(second.documentId, "doc-final-2");
  assert.equal(second.snapshot.documentVersion, 2);
  assert.equal(deliveryCurrent(s, second), true);
  // Blank inputs fall back to the failed attempt's recipient and method.
  assert.equal(second.recipientEmail, "dana@lender.example");
  assert.equal(second.method, "Email");
});

test("only a failed delivery can be retried, and only a prepared one recorded or cancelled", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  assert.throws(() => retryDelivery(s, r.id, { recipientEmail: "", method: "", reviewNote: "" }), /Only a failed delivery/);
  recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: "ref", deliveryNote: "" }, NOW);
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: "ref2", deliveryNote: "" }, NOW),
    /Only a prepared delivery can be recorded/,
  );
  assert.throws(() => cancelDelivery(s, r.id, "changed my mind"), /Only a prepared delivery can be cancelled/);
  assert.throws(
    () => recordDeliveryFailure(s, r.id, { failedOn: day(0), failureReason: "x" }, NOW),
    /Only a prepared delivery can be recorded as failed/,
  );
  assert.throws(() => cancelDelivery(s, "dlv-missing", "x"), /no longer on file/);
});

test("failure and cancellation require a reason and sane dates", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  assert.throws(
    () => recordDeliveryFailure(s, r.id, { failedOn: day(0), failureReason: "  " }, NOW),
    /why this delivery did not reach/,
  );
  assert.throws(
    () => recordDeliveryFailure(s, r.id, { failedOn: day(4), failureReason: "x" }, NOW),
    /dated in the future/,
  );
  assert.throws(
    () => recordDeliveryFailure(s, r.id, { failedOn: day(-9), failureReason: "x" }, NOW),
    /before the delivery was prepared/,
  );
  assert.throws(() => cancelDelivery(s, r.id, "   "), /Record why this delivery is being cancelled/);
});

test("coverage counts who actually holds a current copy", () => {
  const { s } = seed();
  const a = prepareDelivery(s, validInput());
  recordDelivery(s, a.id, { deliveredOn: day(0), deliveryReference: "r1", deliveryNote: "" }, NOW);
  const b = prepareDelivery(
    s,
    validInput({ recipientName: "Mark Ellis", recipientEmail: "mark@attorney.example", recipientRole: "Closing attorney" }),
  );
  recordDeliveryFailure(s, b.id, { failedOn: day(0), failureReason: "Bounced" }, NOW);
  const c = prepareDelivery(
    s,
    validInput({ recipientName: "Ada Cole", recipientEmail: "ada@buyer.example", recipientRole: "Buyer" }),
  );
  let cov = deliveryCoverage(s, "doc-final-1");
  assert.deepEqual(
    { recorded: cov.recorded, failed: cov.failed, prepared: cov.prepared, recipients: cov.recipients, stale: cov.stale },
    { recorded: 1, failed: 1, prepared: 1, recipients: 1, stale: 0 },
  );
  supersede(s);
  cov = deliveryCoverage(s, "doc-final-1");
  assert.equal(cov.prepared, 0);
  assert.equal(cov.stale, 1);
  void c;
});

test("the central validator refuses to lose, rewrite or reopen delivery history", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: "ref-1", deliveryNote: "" }, NOW);

  const removed = structuredClone(s);
  removed.deliveries = [];
  assert.throws(() => validateBusinessMutation(s, removed), /Delivery history is kept/);

  const reopened = structuredClone(s);
  reopened.deliveries[0].status = "Prepared";
  assert.throws(() => validateBusinessMutation(s, reopened), /stays as it is/);

  const rewritten = structuredClone(s);
  rewritten.deliveries[0].deliveryReference = "ref-2";
  assert.throws(() => validateBusinessMutation(s, rewritten), /cannot be rewritten/);

  const rebound = structuredClone(s);
  rebound.deliveries[0].snapshot.documentVersion = 4;
  assert.throws(() => validateBusinessMutation(s, rebound), /keeps the document version/);

  const moved = structuredClone(s);
  moved.deliveries[0].documentId = "doc-other";
  assert.throws(() => validateBusinessMutation(s, moved), /keeps the document version/);
});

test("the validator rejects incomplete terminal records, two open preparations and broken retry links", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());

  const bareRecorded = structuredClone(s);
  bareRecorded.deliveries[0].status = "Recorded";
  assert.throws(() => validateBusinessMutation(s, bareRecorded), /must carry its date and evidence/);

  const bareFailed = structuredClone(s);
  bareFailed.deliveries[0].status = "Failed";
  assert.throws(() => validateBusinessMutation(s, bareFailed), /must record why it did not arrive/);

  const bareCancelled = structuredClone(s);
  bareCancelled.deliveries[0].status = "Cancelled";
  assert.throws(() => validateBusinessMutation(s, bareCancelled), /must record why/);

  const twoOpen = structuredClone(s);
  twoOpen.deliveries.push({ ...r, id: "dlv-dupe" });
  assert.throws(() => validateBusinessMutation(s, twoOpen), /only have one delivery prepared for a recipient/);

  const orphanRetry = structuredClone(s);
  orphanRetry.deliveries.push({ ...r, id: "dlv-retry", attempt: 2, previousDeliveryId: "dlv-gone", recipientEmail: "x@y.example" });
  assert.throws(() => validateBusinessMutation(s, orphanRetry), /stay linked to the delivery it follows/);

  const backwardsRetry = structuredClone(s);
  backwardsRetry.deliveries.push({ ...r, id: "dlv-retry2", attempt: 1, previousDeliveryId: r.id, recipientEmail: "x@y.example" });
  assert.throws(() => validateBusinessMutation(s, backwardsRetry), /must follow its earlier attempt/);

  const badAttempt = structuredClone(s);
  badAttempt.deliveries[0].attempt = 0;
  assert.throws(() => validateBusinessMutation(s, badAttempt), /whole number from one/);
});

test("a malformed or absent ledger is handled without crashing the workspace", () => {
  const { s } = seed();
  assert.equal(isValidDeliveries(undefined), true);
  assert.equal(isValidDeliveries([]), true);
  assert.equal(isValidDeliveries(["nope"]), false);
  assert.equal(isValidDeliveries("nope"), false);
  const malformed = structuredClone(s);
  malformed.deliveries = [{ id: "x" }];
  assert.throws(() => validateBusinessMutation(s, malformed), /not in a shape this workspace can store/);
  // A workspace saved before this feature stays valid.
  const older = structuredClone(s);
  delete older.deliveries;
  assert.deepEqual(deliveries(older), []);
  assert.doesNotThrow(() => validateDeliveryMutation(older, older));
});

test("every offered recipient role and method is accepted", () => {
  const { s } = seed();
  for (const [i, role] of recipientRoles.entries()) {
    const r = prepareDelivery(
      s,
      validInput({ recipientRole: role, recipientEmail: `r${i}@example.com`, method: deliveryMethods[i % deliveryMethods.length] }),
    );
    assert.equal(r.recipientRole, role);
  }
  assert.equal(deliveries(s).length, recipientRoles.length);
});

test("deliveries filter by company, order and document", () => {
  const { s, order } = seed();
  prepareDelivery(s, validInput());
  assert.equal(deliveries(s, { companyId: order.companyId }).length, 1);
  assert.equal(deliveries(s, { companyId: "other" }).length, 0);
  assert.equal(deliveries(s, { orderId: order.id }).length, 1);
  assert.equal(deliveries(s, { documentId: "doc-final-1" }).length, 1);
  assert.equal(deliveries(s, { documentId: "doc-other" }).length, 0);
});

// ---------------------------------------------------------------------------
// Regressions for Codex's September 14 QA findings (F04 delivery, F08, F09, C02).
// ---------------------------------------------------------------------------

test("F08: a failure that has already been retried cannot be retried again", () => {
  const { s } = seed();
  const first = prepareDelivery(s, validInput());
  recordDeliveryFailure(s, first.id, { failedOn: day(0), failureReason: "Bounced" }, NOW);
  assert.equal(canRetryDelivery(s, deliveries(s)[0]), true);

  const second = retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "" });
  recordDelivery(s, second.id, { deliveredOn: day(0), deliveryReference: "ref", deliveryNote: "" }, NOW);

  // Codex's exact sequence: the original failure still offered Try again.
  assert.equal(deliveryRetried(s, deliveries(s)[0]), true);
  assert.equal(canRetryDelivery(s, deliveries(s)[0]), false);
  assert.throws(
    () => retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "" }),
    /already been retried/,
  );
  assert.equal(deliveries(s).length, 2);
});

test("F08: a retry that itself fails can be retried, and the chain keeps its order", () => {
  const { s } = seed();
  const first = prepareDelivery(s, validInput());
  recordDeliveryFailure(s, first.id, { failedOn: day(0), failureReason: "Bounced" }, NOW);
  const second = retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "" });
  recordDeliveryFailure(s, second.id, { failedOn: day(0), failureReason: "Bounced again" }, NOW);
  assert.equal(canRetryDelivery(s, deliveries(s)[0]), false);
  assert.equal(canRetryDelivery(s, deliveries(s)[1]), true);
  const third = retryDelivery(s, second.id, { recipientEmail: "", method: "", reviewNote: "" });
  assert.equal(third.attempt, 3);
  assert.equal(third.previousDeliveryId, second.id);
});

test("F08: a cancelled retry still counts as this failure's successor", () => {
  const { s } = seed();
  const first = prepareDelivery(s, validInput());
  recordDeliveryFailure(s, first.id, { failedOn: day(0), failureReason: "Bounced" }, NOW);
  const second = retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "" });
  cancelDelivery(s, second.id, "Recipient asked us to hold");
  assert.equal(canRetryDelivery(s, deliveries(s)[0]), false);
  assert.throws(
    () => retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "" }),
    /already been retried/,
  );
  // A genuinely new attempt is an explicit new preparation, which is allowed.
  assert.doesNotThrow(() => prepareDelivery(s, validInput()));
});

test("F09: replacing a parent source stales its child's delivery", () => {
  const { s, order } = seed();
  // A child source captured from an uploaded parent.
  const parent = {
    id: "doc-parent",
    companyId: order.companyId,
    orderId: order.id,
    name: "Deed package.pdf",
    category: "Source",
    visibility: "Internal",
    date: "2026-09-10",
    size: "1 MB",
    version: 1,
    sourceRole: "Deed",
  };
  const child = {
    ...parent,
    id: "doc-child",
    name: "Deed of trust.pdf",
    sourceRole: "Deed of trust",
    parentDocumentId: "doc-parent",
  };
  s.documents.push(parent, child);
  const r = prepareDelivery(s, validInput({ documentId: "doc-child" }));
  assert.equal(deliveryCurrent(s, r), true);

  // The parent is replaced by a newer version, which drops the child from the
  // order's current sources even though the child's own version never moved.
  s.documents.push({ ...parent, id: "doc-parent-2", version: 2, date: "2026-09-13" });
  assert.equal(deliveryCurrent(s, r), false);
  assert.equal(deliveryState(s, r), "Source changed");
  assert.throws(
    () => recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: "x", deliveryNote: "" }, NOW),
    /changed after the delivery was prepared/,
  );
  assert.throws(
    () => prepareDelivery(s, validInput({ documentId: "doc-child", recipientEmail: "other@example.com" })),
    /no longer a current source/,
  );
  // The stale preparation can still be cancelled with a reason.
  assert.doesNotThrow(() => cancelDelivery(s, r.id, "Parent deed replaced"));
});

test("F09: an ordinary document with no source role is unaffected by the dependency rule", () => {
  const { s, order } = seed();
  s.documents.push({
    id: "doc-plain",
    companyId: order.companyId,
    orderId: order.id,
    name: "Closing instructions.pdf",
    category: "Correspondence",
    visibility: "Internal",
    date: "2026-09-10",
    size: "40 KB",
    version: 1,
  });
  const r = prepareDelivery(s, validInput({ documentId: "doc-plain" }));
  assert.equal(deliveryCurrent(s, r), true);
  assert.equal(deliveryState(s, r), "Prepared");
});

test("F04: a backup carrying a semantically broken delivery is refused at import", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  const base = structuredClone(s.deliveries[0]);
  // Codex's case: attempt 0 passed the shape check, then an unrelated later
  // edit failed the global validator with no way for the operator to see why.
  assert.equal(isValidDeliveries([{ ...base, attempt: 0 }]), false);
  assert.equal(isValidDeliveries([{ ...base, status: "Recorded" }]), false);
  assert.equal(isValidDeliveries([{ ...base, status: "Failed" }]), false);
  assert.equal(isValidDeliveries([{ ...base, status: "Cancelled" }]), false);
  assert.equal(isValidDeliveries([base]), true);
  assert.equal(isValidDeliveries(undefined), true);
  // The mutation validator still reports precisely which rule a record breaks.
  const broken = structuredClone(s);
  broken.deliveries[0].status = "Recorded";
  assert.throws(() => validateBusinessMutation(s, broken), /must carry its date and evidence/);
  void r;
});

test("C02: a recorded delivery's recipient and evidence are both frozen", () => {
  const { s } = seed();
  const r = prepareDelivery(s, validInput());
  recordDelivery(s, r.id, { deliveredOn: day(0), deliveryReference: "ref-1", deliveryNote: "" }, NOW);

  for (const [field, value] of [
    ["recipientName", "Someone Else"],
    ["recipientEmail", "someone@else.example"],
    ["recipientRole", "Buyer"],
    ["method", "Mail or courier"],
  ]) {
    const edited = structuredClone(s);
    edited.deliveries[0][field] = value;
    assert.throws(
      () => validateBusinessMutation(s, edited),
      /keeps the recipient it was prepared for/,
      `expected ${field} to be frozen`,
    );
  }
  for (const field of ["deliveredOn", "deliveryNote", "recordedBy", "recordedAt"]) {
    const edited = structuredClone(s);
    edited.deliveries[0][field] = "tampered";
    assert.throws(() => validateBusinessMutation(s, edited), /cannot be rewritten/, `expected ${field} frozen`);
  }
});
