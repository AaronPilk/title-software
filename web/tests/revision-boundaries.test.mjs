import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import { addPolicy, validateBusinessMutation } from "../.local-test/business.js";
import {
  titleFile,
  createFieldRevision,
  recheckFieldRevision,
  applyFieldRevision,
  createRevision,
  applyRevision,
  reviewCommitment,
  finalReadiness,
} from "../.local-test/production.js";

function changedToCash(field = "lender") {
  const s = createSeed();
  const o = s.orders.find(
    (o) =>
      !["Issued", "Rejected"].includes(o.status) &&
      titleFile(o).financing === "Financed",
  );
  const r = createFieldRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Please correct this field",
    field,
    proposed: field === "lender" ? "New Bank" : "Wake",
  });
  const before = structuredClone(s);
  // The same financing/amount/version change made by File details → Save.
  o.production = {
    ...titleFile(o),
    financing: "Cash",
    loanAmount: 0,
    version: titleFile(o).version + 1,
    commitmentReview: undefined,
  };
  validateBusinessMutation(before, s);
  return { s, o, r };
}

test("a lender revision cannot be refreshed after the file becomes cash", () => {
  const { s, r } = changedToCash();
  const before = structuredClone(s);
  assert.throws(() => recheckFieldRevision(s, r.id), /cash file/);
  assert.deepEqual(s, before);
});
test("an earlier refreshed lender request cannot apply to a cash file", () => {
  const { s, o, r } = changedToCash();
  // Represents a request refreshed by the earlier release and saved locally.
  r.baseVersion = titleFile(o).version;
  const before = structuredClone(s);
  assert.throws(() => applyFieldRevision(s, r.id, true), /cash file/);
  assert.deepEqual(s, before);
});
test("cash files still permit a reviewed county revision after refresh", () => {
  const { s, o, r } = changedToCash("county");
  recheckFieldRevision(s, r.id);
  const before = structuredClone(s);
  applyFieldRevision(s, r.id, true);
  validateBusinessMutation(before, s);
  assert.equal(titleFile(o).county, "Wake");
  assert.equal(titleFile(o).financing, "Cash");
  assert.equal(titleFile(o).loanAmount, 0);
});

function reviewedFile() {
  const s = createSeed();
  const o = s.orders[0];
  titleFile(o).requirements.forEach((r) => {
    r.status = r.kind === "Requirement" ? "Satisfied" : "Retained";
    r.evidence = "Recorded source reference";
    r.note = "Disposition reviewed";
  });
  o.fields.forEach((f) => (f.reviewed = true));
  reviewCommitment(s, o, "Final opinion and evidence reviewed.");
  assert.equal(finalReadiness(s, o).ready, true);
  return { s, o };
}

for (const [field, proposed] of [
  ["lender", "Updated lender"],
  ["seller", "Updated seller"],
  ["legalDescription", "Updated legal description"],
  ["county", "Wake"],
  ["attorney", "Updated law firm"],
  ["attorneyEmail", "review@example.com"],
]) {
  test(`${field} revision requires a fresh commitment review and preserves source reviews`, () => {
    const { s, o } = reviewedFile();
    const fields = structuredClone(o.fields);
    const requirements = structuredClone(titleFile(o).requirements);
    const r = createFieldRevision(s, {
      companyId: o.companyId,
      orderId: o.id,
      messageId: "",
      text: "Please apply the reviewed correction",
      field,
      proposed,
    });
    const before = structuredClone(s);
    applyFieldRevision(s, r.id, true);
    validateBusinessMutation(before, s);
    assert.equal(titleFile(o).commitmentReview, undefined);
    assert.equal(finalReadiness(s, o).ready, false);
    assert.ok(finalReadiness(s, o).missingContext.includes("commitment review"));
    assert.deepEqual(o.fields, fields);
    assert.deepEqual(titleFile(o).requirements, requirements);
    reviewCommitment(s, o, "Revised commitment and evidence reviewed.");
    assert.equal(finalReadiness(s, o).ready, true);
  });
}

test("a multi-loan revision requires fresh commitment review even when the shared amount stays unchanged", () => {
  const { s, o } = reviewedFile();
  const survivor = addPolicy(s, o.id, "Loan");
  const target = addPolicy(s, o.id, "Loan");
  const fields = structuredClone(o.fields);
  const originalSurvivor = structuredClone(survivor);
  const originalAmount = titleFile(o).loanAmount;
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    productId: target.id,
    text: "Please revise the second loan to $340,000",
    proposed: 340000,
  });
  const before = structuredClone(s);
  applyRevision(s, r.id, true);
  validateBusinessMutation(before, s);
  assert.equal(target.loanAmount, 340000);
  assert.equal(titleFile(o).loanAmount, originalAmount);
  assert.deepEqual(survivor, originalSurvivor);
  assert.deepEqual(o.fields, fields);
  assert.equal(titleFile(o).commitmentReview, undefined);
  assert.equal(finalReadiness(s, o).ready, false);
  assert.ok(finalReadiness(s, o).missingContext.includes("commitment review"));
  reviewCommitment(s, o, "Both revised loan commitments reviewed.");
  assert.equal(finalReadiness(s, o).ready, true);
});
