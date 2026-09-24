import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({ stdin: { contents: `export * from './lib/title/final-preparation'; export * from './lib/title/production'; export {createSeed} from './lib/title/model'; export {captureCommands} from './lib/title/command-log'; export {products, addPolicy, preparePolicy, issuePolicy} from './lib/title/business';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node", target: "es2022" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const { createSeed, products, addPolicy, preparePolicy, issuePolicy, reviewCommitment, finalReadiness, emptyFinalPreparation, finalPreparationSourceSnapshot, finalPreparationProblems, finalPreparationStatus, finalPreparationShapeValid, finalPreparationInputShapeValid, saveFinalPreparation, reviewFinalPreparation, prepareFinalHandoff, finalHandoffData, finalHandoffText, validateFinalPreparationMutation, captureCommands } = api;
const clone = value => structuredClone(value);
Error.stackTraceLimit = 0;

function fixture() {
  const s = createSeed(), o = s.orders[0];
  o.underwriter = "WFG";
  o.production.requirements.forEach(r => { r.status = r.kind === "Requirement" ? "Satisfied" : "Retained"; r.evidence = "Reviewed original"; r.note = "Reviewed disposition"; });
  o.fields.forEach(f => { f.reviewed = true; });
  const policy = addPolicy(s, o.id, "Owner");
  policy.insured = "Fictional owner"; policy.form = "Fictional approved form v1";
  policy.exceptions = o.production.requirements.filter(r => r.kind === "Exception").map(r => ({ itemId: r.id, disposition: "Retain", wording: r.text, reason: "Reviewed fictional final exception instruction" }));
  reviewCommitment(s, o, "Current commitment and final originals reviewed.");
  assert.equal(finalReadiness(s, o).ready, true);
  const input = emptyFinalPreparation(s, o);
  assert.ok(input.products.length);
  input.eligibility = { companyEvidence: "Fictional appointment record reviewed for this file", attorneyEvidence: "Fictional attorney approval record reviewed", note: "Company, state, attorney and WFG match this transaction." };
  for (const row of input.products) {
    row.variant = "Standard"; row.form = products(s, o.id).find(p => p.id === row.policyId).form;
    row.reviewNote = "Variant and form match reviewed commitment and portal instructions.";
    row.endorsementReviewNote = "No endorsement applies according to this fictional reviewed instruction.";
  }
  input.fees[0] = { id: "binder", kind: "Binder", label: "Binder fee", decision: "Not applicable", amount: null, reference: "Fictional reviewed fee instruction", rationale: "Not charged on this fictional file." };
  input.feeReviewNote = "Fee applicability reviewed against supplied instruction.";
  input.reply = { to: "fictional-attorney@example.com", subject: "Final preparation review", body: "Local draft for manual review; policy issuance is still external." };
  assert.deepEqual(finalPreparationProblems(s, o, input), []);
  return { s, o, input };
}
function saved() {
  const f = fixture(); saveFinalPreparation(f.s, f.o.id, f.input, 0, finalPreparationSourceSnapshot(f.s, f.o)); return f;
}
function reviewed() {
  const f = saved(); reviewFinalPreparation(f.s, f.o.id, 1, finalPreparationSourceSnapshot(f.s, f.o), "Compared worksheet with the current original documents."); return f;
}
function prepared() {
  const f = reviewed(); prepareFinalHandoff(f.s, f.o.id, 1, finalPreparationSourceSnapshot(f.s, f.o)); return f;
}

test("database JSON key reordering preserves reviewed preparation and subsequent edits", () => {
  const { s, o } = prepared();
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const reopened = reorder(JSON.parse(JSON.stringify(s))), order = reopened.orders.find(row => row.id === o.id);
  assert.equal(finalPreparationSourceSnapshot(reopened, order), finalPreparationSourceSnapshot(s, o));
  assert.equal(finalPreparationStatus(reopened, order), "Prepared");
  assert.equal(finalHandoffText(reopened, order), finalHandoffText(s, o));
  const next = clone(order.finalPreparation.input); next.note = "Reviewed after reopen";
  assert.doesNotThrow(() => saveFinalPreparation(reopened, order.id, next, 1, finalPreparationSourceSnapshot(reopened, order)));
  assert.equal(finalPreparationStatus(reopened, order), "Draft");
});

test("new worksheet begins unknown and cannot imply eligibility, variant, endorsement or fee approval", () => {
  const { s, o } = fixture(), input = emptyFinalPreparation(s, o);
  assert.equal(input.eligibility.companyEvidence, ""); assert.equal(input.fees[0].amount, null);
  assert.ok(input.products.every(p => p.variant === "Needs review" && p.endorsements.length === 0));
  saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o));
  assert.equal(finalPreparationStatus(s, o), "Draft");
  assert.throws(() => reviewFinalPreparation(s, o.id, 1, finalPreparationSourceSnapshot(s, o), "Looks fine"), /authority evidence|Standard or Enhanced/);
  assert.throws(() => prepareFinalHandoff(s, o.id, 1, finalPreparationSourceSnapshot(s, o)), /Confirm the current/);
  assert.throws(() => finalHandoffText(s, o), /Prepare a current/);
});

test("review and preparation produce a source-linked internal handoff without issuing or sending", () => {
  const { s, o } = saved(), before = clone(s), initialStatus = o.status;
  reviewFinalPreparation(s, o.id, 1, finalPreparationSourceSnapshot(s, o), "Current evidence and instructions checked.");
  assert.equal(finalPreparationStatus(s, o), "Reviewed"); assert.equal(finalPreparationShapeValid(o.finalPreparation), true);
  validateFinalPreparationMutation(before, s);
  const reviewState = clone(s), output = prepareFinalHandoff(s, o.id, 1, finalPreparationSourceSnapshot(s, o));
  validateFinalPreparationMutation(reviewState, s);
  assert.equal(output.notAPolicy, true); assert.equal(output.notSent, true); assert.equal(output.softProUpdated, false);
  assert.equal(o.status, initialStatus); assert.deepEqual(s.business.policies, before.business.policies); assert.deepEqual(s.replyDrafts, before.replyDrafts);
  assert.equal(output.capturedFields.length, o.fields.length); assert.ok(output.sources.length);
  const text = finalHandoffText(s, o);
  assert.match(text, /NOT AN OFFICIAL POLICY OR JACKET/); assert.match(text, /LOCAL REPLY DRAFT — NOT SENT/);
  assert.match(text, /Standard/); assert.match(text, /fictional-attorney@example.com/);
  output.worksheet.reply.body = "mutated export"; assert.notEqual(o.finalPreparation.input.reply.body, "mutated export");
});

test("source, file, commitment and product edits invalidate a reviewed worksheet and deny export", () => {
  const changes = [
    (s, o) => { o.production.version++; },
    (s, o) => { s.documents.find(d => d.orderId === o.id && d.sourceRole === "Deed").version++; },
    (s, o) => { s.documents.find(d => d.orderId === o.id && d.sourceRole === "Deed").assetId = "replacement-original"; },
    (s, o) => { o.fields[0].proposed = "Changed fact"; },
    (s, o) => { o.production.commitmentReference = "New commitment"; },
    (s, o) => { products(s, o.id)[0].form = "Changed form"; },
    (s, o) => { products(s, o.id)[0].endorsements = "Changed instructions"; },
    (s, o) => { products(s, o.id)[0].premium++; },
    (s, o) => { o.underwriter = "Commonwealth"; },
  ];
  for (const change of changes) {
    const { s, o } = prepared(); change(s, o);
    assert.equal(finalPreparationStatus(s, o), "Source changed", change.toString());
    assert.throws(() => finalHandoffData(s, o), /Prepare a current/);
    assert.throws(() => prepareFinalHandoff(s, o.id, 1, finalPreparationSourceSnapshot(s, o)), /Confirm the current/);
  }
});

test("draft save rejects changes while editor was open, preserving the existing review", () => {
  const { s, o, input } = reviewed(), base = finalPreparationSourceSnapshot(s, o), prior = clone(o.finalPreparation);
  o.production.version++;
  assert.throws(() => saveFinalPreparation(s, o.id, input, 1, base), /changed/);
  assert.deepEqual(o.finalPreparation, prior);
  assert.throws(() => saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o)), /changed/);
});

test("saving a change creates a new draft and keeps previous review history", () => {
  const { s, o, input } = prepared(), history = clone(o.finalPreparation.history), before = clone(s);
  input.products[0].variant = "Enhanced";
  saveFinalPreparation(s, o.id, input, 1, finalPreparationSourceSnapshot(s, o));
  assert.equal(o.finalPreparation.version, 2); assert.equal(o.finalPreparation.status, "Draft");
  assert.equal(o.finalPreparation.review, undefined); assert.equal(o.finalPreparation.prepared, undefined);
  assert.deepEqual(o.finalPreparation.history.slice(0, -1), history); validateFinalPreparationMutation(before, s);
});

test("underwriter expansion cannot reuse WFG confirmation", () => {
  for (const name of ["Commonwealth", "First American", "WFG-like", ""]) {
    const { s, o, input } = fixture(); o.underwriter = name;
    saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o));
    assert.throws(() => reviewFinalPreparation(s, o.id, 1, finalPreparationSourceSnapshot(s, o), "Reviewed"), /supports WFG only/);
  }
});

test("referring and issuing companies are preserved but cross-agency preparation is withheld", () => {
  for (const field of ["issuingCompanyId", "referringCompanyId"]) {
    const { s, o, input } = fixture(), originalCompanyId = o.companyId;
    input[field] = s.companies.find(c => c.id !== o.companyId).id;
    saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o));
    assert.equal(o.companyId, originalCompanyId); assert.equal(o.finalPreparation.input[field], input[field]);
    assert.throws(() => reviewFinalPreparation(s, o.id, 1, finalPreparationSourceSnapshot(s, o), "Reviewed"), /Cross-agency/);
  }
  const { s, o, input } = fixture(); input.referringCompanyId = "unavailable-company";
  assert.throws(() => saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o)), /available company/);
});

test("included, omitted and unknown endorsements need explicit reviewed decisions and fees", () => {
  const { s, o, input } = fixture(), row = input.products[0];
  row.endorsements = [{ id: "e1", code: "FICTIONAL-EXAMPLE", decision: "Include", rationale: "Explicit fictional instruction", fee: null }];
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("included endorsement fee")));
  row.endorsements[0].fee = 0;
  assert.deepEqual(finalPreparationProblems(s, o, input), []);
  row.endorsements[0].decision = "Exclude"; row.endorsements[0].fee = 10;
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("excluded endorsement")));
  row.endorsements[0].fee = null; row.endorsements[0].rationale = "";
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("decision and reason")));
  row.endorsements[0].rationale = "Does not apply to this fixture";
  row.endorsements.push({ ...row.endorsements[0], id: "e2", code: " fictional-example " });
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("duplicate endorsement")));
});

test("binder applicability is explicit and fee amounts do not default to zero", () => {
  const { s, o, input } = fixture(); input.fees = [];
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("exactly one binder")));
  input.fees = [{ id: "binder", kind: "Binder", label: "Binder", decision: "Applies", amount: null, reference: "Fictional schedule", rationale: "Applies to fixture" }];
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("confirm the amount")));
  input.fees[0].amount = 0; assert.deepEqual(finalPreparationProblems(s, o, input), []);
  input.fees[0].decision = "Not applicable"; input.fees[0].amount = 25;
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("cannot carry a charge")));
});

test("every current Owner/Loan product must be represented with a matching form", () => {
  const { s, o, input } = fixture(); input.products = [];
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("exact current policy products")));
  input.products = emptyFinalPreparation(s, o).products; input.products[0].form = "different";
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("must match the policy product")));
  input.products[0].policyId = "policy-other-file";
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("exact current policy products")));
});

test("source reviews, loan matches and attorney followups remain readiness gates", () => {
  for (const change of [
    (s, o) => { o.fields[0].reviewed = false; },
    (s, o) => { o.fields.find(f => f.id === "loanAmount").proposed = "$1.00"; },
    (s, o) => { o.production.requirements[0].status = "Open"; },
    (s, o) => { o.production.commitmentReview = undefined; },
    (s, o) => { o.exception = "Missing necessary final evidence"; },
    (s, o) => { s.business.followups.push({ id: "pending", orderId: o.id, companyId: o.companyId, status: "Open" }); },
  ]) {
    const { s, o, input } = fixture(); change(s, o);
    saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o));
    assert.ok(finalPreparationProblems(s, o).length);
    assert.throws(() => reviewFinalPreparation(s, o.id, 1, finalPreparationSourceSnapshot(s, o), "Cannot bypass"));
  }
});

test("issued, partially issued and rejected files reject worksheet mutations", () => {
  for (const change of [
    (s, o) => { o.status = "Issued"; },
    (s, o) => { o.status = "Rejected"; },
    (s, o) => { products(s, o.id)[0].status = "Issued"; },
  ]) {
    const { s, o, input } = reviewed(); change(s, o);
    const snapshot = finalPreparationSourceSnapshot(s, o);
    assert.throws(() => saveFinalPreparation(s, o.id, input, 1, snapshot), /active, unissued/);
    assert.throws(() => reviewFinalPreparation(s, o.id, 1, snapshot, "Review"), /active, unissued/);
    assert.throws(() => prepareFinalHandoff(s, o.id, 1, snapshot), /active, unissued/);
  }
});

test("shape boundary rejects unknown executable fields, oversized values and malformed money", () => {
  const { input } = fixture();
  for (const mutate of [
    i => { i.send = true; }, i => { i.eligibility.approved = true; },
    i => { i.note = "x".repeat(4001); }, i => { i.fees[0].amount = NaN; },
    i => { i.fees[0].amount = -1; }, i => { i.fees[0].amount = 0.001; },
    i => { i.products.push(clone(i.products[0])); }, i => { i.fees.push(clone(i.fees[0])); },
    i => { i.products[0].variant = "Automatically approved"; },
  ]) { const value = clone(input); mutate(value); assert.equal(finalPreparationInputShapeValid(value), false, mutate.toString()); }
});

test("review rejects recipient header injection and empty unreviewed local reply", () => {
  const { s, o, input } = fixture(); input.reply.to = "a@example.com\r\nBcc: b@example.com";
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("local reply")));
  input.reply.to = "a@example.com"; input.reply.subject = "Hello\nBcc: bad";
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("local reply")));
});

test("history cannot be removed, rewritten or replaced with forged current approval", () => {
  const { s, o } = prepared();
  for (const mutate of [
    row => { delete row.finalPreparation; },
    row => { row.finalPreparation.history[0].by = "Forged reviewer"; row.finalPreparation.history.push(clone(row.finalPreparation.history[0])); },
    row => { row.finalPreparation.input.products[0].variant = "Enhanced"; row.finalPreparation.history.push(clone(row.finalPreparation.history[0])); },
    row => { row.finalPreparation.review.snapshot = "forged"; row.finalPreparation.history.push(clone(row.finalPreparation.history[0])); },
  ]) { const after = clone(s); mutate(after.orders.find(row => row.id === o.id)); assert.throws(() => validateFinalPreparationMutation(s, after)); }
  const after = clone(s); after.orders.find(row => row.id === o.id).production.version++;
  assert.doesNotThrow(() => validateFinalPreparationMutation(s, after));
  assert.equal(finalPreparationStatus(after, after.orders.find(row => row.id === o.id)), "Source changed");
});

test("all three actions generate replayable commands with source and worksheet preconditions", () => {
  const { s, o, input } = fixture(), snapshot = finalPreparationSourceSnapshot(s, o);
  const captured = captureCommands(s, state => saveFinalPreparation(state, o.id, input, 0, snapshot));
  assert.equal(captured[0].name, "saveFinalPreparation");
  assert.equal(captured[0].args[3], snapshot);
  const review = captureCommands(s, state => reviewFinalPreparation(state, o.id, 1, snapshot, "Reviewed current sources"));
  const prepare = captureCommands(s, state => prepareFinalHandoff(state, o.id, 1, snapshot));
  assert.equal(review[0].name, "reviewFinalPreparation"); assert.equal(prepare[0].name, "prepareFinalHandoff");
  assert.equal(review[0].args[2], snapshot); assert.equal(prepare[0].args[2], snapshot);
});

test("real product preparation and externally returned issuance do not obsolete unchanged instructions", () => {
  const { s, o } = prepared(), snapshot = finalPreparationSourceSnapshot(s, o), p = products(s, o.id)[0];
  preparePolicy(s, p.id, "Reviewed product and original sources for external handoff.");
  assert.equal(finalPreparationSourceSnapshot(s, o), snapshot);
  assert.equal(finalPreparationStatus(s, o), "Prepared");
  const output = { id: "fictional-final-output", companyId: o.companyId, orderId: o.id, policyId: p.id, sourceRole: "Final policy", version: 1, name: "fictional-final.txt", category: "Policy documents", visibility: "Internal", date: "2026-09-24", size: "1 KB", assetId: "fictional-final-bytes", productionVersion: o.production.version, policyVersion: p.version, preparationFingerprint: p.preparedSnapshot };
  s.documents.push(output);
  assert.equal(finalPreparationSourceSnapshot(s, o), snapshot);
  issuePolicy(s, p.id, { reference: "FICTIONAL-ISSUED-REFERENCE", documentId: output.id, month: "2026-09" });
  assert.equal(o.status, "Issued"); assert.equal(finalPreparationSourceSnapshot(s, o), snapshot);
  assert.equal(finalPreparationStatus(s, o), "Prepared");
  assert.doesNotThrow(() => finalHandoffText(s, o));
  assert.throws(() => saveFinalPreparation(s, o.id, o.finalPreparation.input, 1, snapshot), /active, unissued/);
});

test("source fingerprints omit raw text and recursive historical snapshots", () => {
  const { s, o } = fixture(), p = products(s, o.id)[0], d = s.documents.find(d => d.orderId === o.id && d.sourceRole === "Deed");
  d.text = "PRIVATE-RAW-SOURCE-NEVER-IN-COMMAND-SNAPSHOT";
  p.preparedSnapshot = "OLD-RECURSIVE-SNAPSHOT";
  const snapshot = finalPreparationSourceSnapshot(s, o);
  assert.ok(!snapshot.includes(d.text)); assert.ok(!snapshot.includes(p.preparedSnapshot));
  const versioned = finalPreparationSourceSnapshot(s, o); d.version++;
  assert.notEqual(finalPreparationSourceSnapshot(s, o), versioned);
});

test("each loan requires its own current security evidence and reviewed exceptions", () => {
  const { s, o, input } = fixture(), loan = addPolicy(s, o.id, "Loan");
  loan.insured = "Fictional lender"; loan.form = "Fictional loan form"; loan.loanReference = "FICTIONAL-LOAN-1";
  input.products.push({ policyId: loan.id, variant: "Enhanced", form: loan.form, endorsements: [], endorsementReviewNote: "Reviewed instructions", reviewNote: "Reviewed variant" });
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("current security instrument")));
  assert.ok(finalPreparationProblems(s, o, input).some(e => e.includes("map every commitment exception")));
  loan.securityDocumentId = s.documents.find(d => d.orderId === o.id && d.sourceRole === "Deed of trust").id;
  loan.securityPage = "PDF page 2"; loan.loanReviewNote = "Reviewed original principal";
  loan.exceptions = clone(products(s, o.id)[0].exceptions);
  assert.deepEqual(finalPreparationProblems(s, o, input), []);
});

test("unreviewed non-applicable fields never become labeled reviewed facts in the handoff", () => {
  const { s, o, input } = fixture();
  o.fields.push({ id: "unrelated-extra", label: "Unreviewed extra", proposed: "UNREVIEWED", reviewed: false });
  saveFinalPreparation(s, o.id, input, 0, finalPreparationSourceSnapshot(s, o));
  reviewFinalPreparation(s, o.id, 1, finalPreparationSourceSnapshot(s, o), "Applicable facts checked");
  const data = prepareFinalHandoff(s, o.id, 1, finalPreparationSourceSnapshot(s, o));
  assert.ok(!data.capturedFields.some(f => f.label === "Unreviewed extra"));
  assert.ok(!finalHandoffText(s, o).includes("UNREVIEWED"));
});

test("shape rejects fabricated history order and mismatched review or prepared stamps", () => {
  const { o } = prepared();
  for (const mutate of [
    w => { w.history[0].action = "Reviewed"; },
    w => { w.history[1].version = 2; },
    w => { w.review.by = "different-person"; },
    w => { w.prepared.at = "2020-01-01T00:00:00Z"; },
    w => { w.prepared.snapshot = "different snapshot"; },
  ]) { const w = clone(o.finalPreparation); mutate(w); assert.equal(finalPreparationShapeValid(w), false, mutate.toString()); }
});

test("new received email and unclassified originals invalidate a prepared handoff before evidence classification", () => {
  for (const append of [
    (s, o) => s.documents.push({ id: "new-unclassified-original", companyId: o.companyId, orderId: o.id, name: "Corrected closing.pdf", category: "Email attachment", visibility: "Internal", version: 1, date: "2026-09-24", size: "20 B", assetId: "new-private-original", mime: "application/pdf" }),
    (s, o) => s.inbox.push({ id: "new-missive-source", companyId: o.companyId, orderId: o.id, kind: "Revision", from: "Attorney", email: "attorney@example.test", subject: "Corrected loan amount", body: "Private received correction", time: "2026-09-24", attachments: [], status: "New", missive: { organizationId: "org", teamId: "team", conversationId: "thread", messageId: "new-message", companyId: o.companyId, orderId: o.id, fingerprint: "a".repeat(64), sourceDocumentId: "new-source", mappingVersion: 1, receivedAt: "2026-09-24", importedAt: "2026-09-24", importedBy: "operator@example.test", attachments: [] } }),
  ]) {
    const { s, o } = prepared(), snapshot = finalPreparationSourceSnapshot(s, o);
    append(s, o);
    assert.notEqual(finalPreparationSourceSnapshot(s, o), snapshot);
    assert.equal(finalPreparationStatus(s, o), "Source changed");
    assert.throws(() => finalHandoffData(s, o), /Prepare a current/);
    assert.doesNotMatch(finalPreparationSourceSnapshot(s, o), /Private received correction/);
  }
});

test("incoming inventory is file-scoped, ignores mail lifecycle bookkeeping and generated outputs, and detects original replacement", () => {
  const { s, o } = fixture();
  const original = { id: "unclassified-original", companyId: o.companyId, orderId: o.id, name: "Closing.pdf", category: "Email attachment", visibility: "Internal", version: 1, date: "2026-09-24", size: "20 B", assetId: "private-original", mime: "application/pdf" };
  const mail = { id: "received-source", companyId: o.companyId, orderId: o.id, kind: "Finals", from: "Attorney", email: "attorney@example.test", subject: "Closing", body: "Private body", time: "2026-09-24", attachments: [], status: "New", missive: { organizationId: "org", messageId: "source-message", fingerprint: "b".repeat(64), sourceDocumentId: "source-json" } };
  s.documents.push(original); s.inbox.push(mail);
  const snapshot = finalPreparationSourceSnapshot(s, o);
  mail.status = "Queued"; original.date = "2026-09-25";
  s.documents.push({ ...original, id: "other-file-original", orderId: "OTHER" });
  s.inbox.push({ ...mail, id: "other-company-email", companyId: "OTHER" });
  s.documents.push({ ...original, id: "generated-output", sourceRole: "Final policy", policyId: "output-policy" });
  assert.equal(finalPreparationSourceSnapshot(s, o), snapshot);
  original.assetId = "replacement-original";
  assert.notEqual(finalPreparationSourceSnapshot(s, o), snapshot);
});
