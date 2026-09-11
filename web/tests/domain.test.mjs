import test from "node:test";
import assert from "node:assert/strict";
// A temporary TypeScript build is used so the runtime under test matches the app modules.
import { createSeed } from "../.local-test/model.js";
import {
  executeRules,
  financeRows,
  round,
  allocateOwnership,
} from "../.local-test/engine.js";
test("policy intake automation matches known orders and is idempotent", () => {
  const state = createSeed();
  const first = executeRules(state, ["intake"]);
  assert.equal(first, 2);
  assert.equal(state.inbox.find((m) => m.id === "m3").status, "New");
  assert.equal(executeRules(state, ["intake"]), 0);
  assert.equal(state.inbox.find((m) => m.id === "m1").status, "Queued");
});
test("onboarding and rejection tasks are not duplicated", () => {
  const state = createSeed();
  assert.equal(executeRules(state, ["onboarding"]), 2);
  assert.equal(executeRules(state, ["onboarding"]), 0);
  assert.equal(executeRules(state, ["exceptions"]), 0);
  state.rules.find((r) => r.id === "exceptions").enabled = true;
  assert.equal(executeRules(state, ["exceptions"]), 1);
  assert.equal(executeRules(state, ["exceptions"]), 0);
});
test("financial report includes only issued orders in the chosen month", () => {
  const state = createSeed();
  const rows = financeRows(state, "2026-09");
  assert.equal(
    rows.reduce((n, r) => n + r.premium, 0),
    4120,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.remittance, 0),
    1648,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.retained, 0),
    2472,
  );
  assert.equal(
    financeRows(state, "2026-08").reduce((n, r) => n + r.premium, 0),
    4080,
  );
  assert.equal(
    financeRows(state, "2030-01").reduce((n, r) => n + r.premium, 0),
    0,
  );
});
test("every ledger row balances to cents", () => {
  const state = createSeed();
  state.orders.find((o) => o.status === "Issued").premium = 2150.37;
  for (const r of financeRows(state, "2026-09"))
    assert.equal(round(r.retained + r.remittance), r.premium);
});
test("source excerpts remain independent of proposed corrections", () => {
  const state = createSeed();
  const field = state.orders[0].fields[0];
  const original = field.sourceValue;
  field.proposed = "Edited for review";
  assert.equal(field.sourceValue, original);
  assert.notEqual(field.proposed, field.sourceValue);
});
test("onboarding materials task stays assigned to Stephenie", () => {
  const state = createSeed();
  const c = state.companies.find((c) => c.id === "c3");
  c.steps = [true, true, true, true, true, false, false];
  executeRules(state, ["onboarding"]);
  assert.equal(
    state.tasks.find((t) => t.id === "auto-onboard-c3-5").owner,
    "Stephenie",
  );
});

test("ownership estimates allocate every cent without negative residual shares", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({
    name: `Member ${i + 1}`,
    share: 20,
  }));
  const result = allocateOwnership(0.03, five);
  assert.equal(round(result.reduce((n, m) => n + m.amount, 0)), 0.03);
  assert.ok(result.every((m) => m.amount >= 0));
  assert.deepEqual(
    allocateOwnership(10, [
      { name: "A", share: 45 },
      { name: "B", share: 55 },
    ]).map((m) => m.amount),
    [4.5, 5.5],
  );
  assert.deepEqual(allocateOwnership(100, [{ name: "A", share: 60 }]), []);
  assert.ok(allocateOwnership(-10, five).every((m) => m.amount === 0));
});

import {
  enrichWorkspace,
  reviewCommitment,
  approveReplyDraft,
  orderSources,
  createRevision,
  applyRevision,
  recheckRevision,
  finalReadiness,
  neededFields,
  replaceSourceFields,
  titleFile,
} from "../.local-test/production.js";
function readyFinal() {
  const s = createSeed();
  const o = s.orders[0];
  o.fields.forEach((f) => (f.reviewed = true));
  o.production.requirements.forEach((r) => {
    r.status = r.kind === "Requirement" ? "Satisfied" : "Retained";
    r.evidence = "Demo recorded release";
    r.note = "Reviewed by operator";
  });
  reviewCommitment(s, o, "Commitment and supporting final evidence reviewed.");
  return { s, o };
}
test("final readiness requires source documents, clearance evidence, and reviewed fields", () => {
  const { s, o } = readyFinal();
  assert.equal(finalReadiness(s, o).ready, true);
  o.production.requirements[0].evidence = "";
  assert.equal(finalReadiness(s, o).ready, false);
  o.production.requirements[0].evidence = "Restored evidence";
  s.documents = s.documents.filter(
    (d) => !(d.orderId === o.id && d.sourceRole === "Final opinion"),
  );
  assert.deepEqual(finalReadiness(s, o).missingSources, ["Final opinion"]);
});
test("cash and refinance source requirements stay separate", () => {
  const { s, o } = readyFinal();
  o.production.financing = "Cash";
  s.documents = s.documents.filter(
    (d) => d.orderId !== o.id || d.sourceRole !== "Deed of trust",
  );
  reviewCommitment(s, o, "Cash file reviewed.");
  assert.equal(finalReadiness(s, o).ready, true);
  assert.ok(!neededFields(o).some((f) => f.id === "loanAmount"));
  o.type = "Refinance";
  assert.ok(!neededFields(o).some((f) => f.id === "deedDated"));
});
test("loan amount conflicts require review instead of silently changing the file", () => {
  const { s, o } = readyFinal();
  o.fields.find((f) => f.id === "loanAmount").proposed = "$325,000.00";
  assert.equal(finalReadiness(s, o).loanMismatch, true);
  assert.equal(o.production.loanAmount, 320000);
});
test("capturing replacement source fields reopens affected approvals and rejects cross-file evidence", () => {
  const { s, o } = readyFinal();
  o.status = "Ready for jacket";
  const doc = s.documents.find(
    (d) => d.orderId === o.id && d.sourceRole === "Deed",
  );
  const values = Object.fromEntries(
    neededFields(o)
      .filter((f) => f.role === "Deed")
      .map((f) => [f.id, o.fields.find((x) => x.id === f.id).sourceValue]),
  );
  values.deedDated = "September 7, 2026";
  replaceSourceFields(s, o.id, doc.id, values, "page 1");
  assert.equal(o.status, "Needs review");
  assert.equal(o.fields.find((f) => f.id === "deedDated").reviewed, false);
  assert.equal(
    o.fields.find((f) => f.id === "deedDated").sourceValue,
    "September 7, 2026",
  );
  assert.throws(
    () => replaceSourceFields(s, s.orders[1].id, doc.id, values, "1"),
    /company and order/,
  );
});
test("revision requires correct company, confirmation, current file, and cannot apply twice", () => {
  const s = createSeed();
  const o = s.orders[3];
  assert.throws(
    () =>
      createRevision(s, {
        companyId: "c2",
        orderId: o.id,
        messageId: "",
        text: "Change loan",
        proposed: 340000,
      }),
    /company and matching file/,
  );
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Change loan to 340000",
    proposed: 340000,
  });
  assert.throws(() => applyRevision(s, r.id, false), /confirm/);
  o.production.version++;
  assert.throws(() => applyRevision(s, r.id, true), /changed/);
  recheckRevision(s, r.id);
  const draft = applyRevision(s, r.id, true);
  assert.equal(titleFile(o).loanAmount, 340000);
  assert.equal(draft.status, "Awaiting document");
  assert.equal(draft.attachmentId, "");
  assert.equal(draft.fileVersion, o.production.version);
  assert.throws(() => applyRevision(s, r.id, true));
  assert.equal(s.replyDrafts.length, 1);
});
test("workflow migration is idempotent and preserves existing local records", () => {
  const s = createSeed();
  s.companies[0].name = "Edited company";
  s.orders[0].fields[0].proposed = "Edited value";
  s.orders[0].fields[0].reviewed = true;
  const count = s.documents.length;
  enrichWorkspace(s);
  enrichWorkspace(s);
  assert.equal(s.companies[0].name, "Edited company");
  assert.equal(s.orders[0].fields[0].proposed, "Edited value");
  assert.equal(s.orders[0].fields[0].reviewed, true);
  assert.equal(s.documents.length, count);
  assert.equal(s.inbox.filter((m) => m.id === "tyler-revision-demo").length, 1);
});

test("an empty requirement list needs an explicit commitment review", () => {
  const { s, o } = readyFinal();
  o.production.requirements = [];
  assert.equal(finalReadiness(s, o).ready, false);
  reviewCommitment(
    s,
    o,
    "Reviewed the commitment; no requirements or exceptions in this fictional case.",
  );
  assert.equal(finalReadiness(s, o).ready, true);
});
test("a replacement opinion invalidates clearance and old-version field evidence cannot pass", () => {
  const { s, o } = readyFinal();
  const opinion = s.documents.find(
    (d) => d.orderId === o.id && d.sourceRole === "Final opinion",
  );
  s.documents.push({ ...opinion, id: "opinion-v2", version: 2 });
  assert.equal(finalReadiness(s, o).ready, false);
  reviewCommitment(s, o, "Replacement opinion reviewed.");
  assert.equal(finalReadiness(s, o).ready, true);
  const deed = s.documents.find(
    (d) => d.orderId === o.id && d.sourceRole === "Deed",
  );
  s.documents.push({ ...deed, id: "deed-v2", version: 2 });
  reviewCommitment(s, o, "Replacement deed reviewed.");
  assert.ok(finalReadiness(s, o).pendingFields.some((f) => f.id === "name"));
  assert.ok(!orderSources(s, o.id).some((d) => d.id === deed.id));
});
test("recapturing evidence preserves the current value instead of promoting an unapproved proposal", () => {
  const { s, o } = readyFinal();
  const f = o.fields.find((f) => f.id === "name");
  const before = f.current;
  f.proposed = "Unapproved correction";
  const doc = s.documents.find((d) => d.id === f.documentId);
  const values = Object.fromEntries(
    neededFields(o)
      .filter((f) => f.role === "Deed")
      .map((def) => [
        def.id,
        o.fields.find((x) => x.id === def.id).sourceValue,
      ]),
  );
  replaceSourceFields(s, o.id, doc.id, values, "page 1");
  assert.equal(o.fields.find((f) => f.id === "name").current, before);
});
test("reply approval rejects a commitment from another revision version", () => {
  const s = createSeed();
  const o = s.orders[3];
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Change to 340000",
    proposed: 340000,
  });
  const draft = applyRevision(s, r.id, true);
  const doc = {
    id: "revised-document",
    companyId: o.companyId,
    orderId: o.id,
    sourceRole: "Revised commitment",
    productionVersion: draft.fileVersion - 1,
    name: "Revised commitment.txt",
    category: "Policy documents",
    visibility: "Internal",
    date: "2026-09-11",
    size: "1 KB",
    version: 1,
    text: "Synthetic commitment",
  };
  s.documents.push(doc);
  draft.attachmentId = doc.id;
  assert.throws(() => approveReplyDraft(s, draft.id), /file version/);
  doc.productionVersion = draft.fileVersion;
  approveReplyDraft(s, draft.id);
  assert.equal(draft.status, "Approved locally");
  o.production.version++;
  assert.throws(() => approveReplyDraft(s, draft.id), /file changed/);
});
test("a revision cannot be rebased or applied after a file becomes cash", () => {
  const s = createSeed();
  const o = s.orders[3];
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Change loan to 340000",
    proposed: 340000,
  });
  o.production.financing = "Cash";
  o.production.loanAmount = 0;
  o.production.version++;
  assert.throws(() => recheckRevision(s, r.id), /financed/);
  assert.throws(() => applyRevision(s, r.id, true), /financed/);
  assert.equal(o.production.loanAmount, 0);
  assert.equal(s.replyDrafts.length, 0);
});
test("final evidence cannot satisfy another company's order", () => {
  const { s, o } = readyFinal();
  const deed = orderSources(s, o.id).find((d) => d.sourceRole === "Deed");
  deed.companyId = "c2";
  assert.ok(finalReadiness(s, o).missingSources.includes("Deed"));
  assert.equal(finalReadiness(s, o).ready, false);
});
