import test from "node:test";
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
  validateDeliveryMutation,
  recipientRoles,
  deliveryMethods,
} from "../.local-test/delivery-ledger.js";

const NOW = new Date("2026-09-14T12:00:00Z");
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
