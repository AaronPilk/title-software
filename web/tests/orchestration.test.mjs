import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import { captureCommands } from "../.local-test/command-log.js";
import * as O from "../.local-test/orchestration.js";

const profileInput = (companyId, extra = {}) => ({ companyId, environmentId: "Select production", externalCompanyId: "JV-1", externalCompanyName: "Sample title agency", underwriter: "Configured underwriter", inboxAliases: ["title@example.test"], templateRef: "Approved template 1", archiveRule: "Approved archive schedule", softPro360Channel: "Existing approved channel", approvers: ["reviewer@example.test"], evidence: "Administrator reviewed the actual company selector", ...extra });
function setup() {
  const s = createSeed();
  s.user = "operator@example.test";
  const company = s.companies[0], file = s.orders.find(o => o.companyId === company.id);
  file.status = "In progress";
  file.outcomes = [];
  s.business.policies = s.business.policies.filter(p => p.orderId !== file.id);
  O.orchestration(s);
  const p = O.saveCompanyProfile(s, profileInput(company.id));
  const map = O.saveExternalFieldMap(s, { companyId: company.id, localField: "lender", externalFieldId: "Verified.Select.LenderName", canRead: true, canWrite: true, risk: "Medium", evidence: "Field identifier verified in approved vendor documentation" });
  const link = O.verifyExternalOrderLink(s, { orderId: file.id, externalFileId: "file-001", externalFileNumber: "SP-2026-001", missiveConversationId: "thread-001", evidence: "Operator matched the actual Select file and company" });
  O.setOrchestrationControl(s, { companyId: company.id, mode: "Propose", paused: false, reason: "Begin manual review preparation" });
  const doc = { id: "or-source", companyId: company.id, orderId: file.id, name: "Lender request", category: "Correspondence", visibility: "Internal", date: "2026-09-14", size: "1 KB", version: 1, text: "Please change the lender to Oak Bank. Loan amount is 350000." };
  s.documents.push(doc);
  return { s, company, file, p, map, link, doc };
}
const changeInput = (f, extra = {}) => ({ orderId: f.file.id, fieldMapId: f.map.id, beforeValue: "External Old Bank", afterValue: "Oak Bank", sourceDocumentId: f.doc.id, sourcePage: "1", sourceQuote: "change the lender to Oak Bank", externalReadEvidence: "Operator read the lender in Select file SP-2026-001 today", reason: "Signed lender request", matchStatus: "Confirmed", ...extra });
const proposed = (f, extra) => O.proposeExternalChange(f.s, changeInput(f, extra));
function approve(f, proposal) {
  f.s.user = "REVIEWER@example.test";
  return O.reviewExternalProposal(f.s, proposal.id, { decision: "Approved", note: "Reviewed the source, company, actual file and proposed field value" });
}

test("a stored PDF may support a manually transcribed quotation while its original identity is pinned", () => {
  const f = setup();
  delete f.doc.text;
  Object.assign(f.doc, { name: "Original lender letter.pdf", assetId: "stored-pdf-original", mime: "application/pdf" });
  const before = structuredClone(f.s), row = proposed(f, { sourcePage: "PDF page 2" });
  assert.equal(row.status, "Pending review");
  assert.equal(JSON.parse(row.sourceFingerprint).assetId, "stored-pdf-original");
  assert.equal(row.sourcePage, "PDF page 2");
  O.validateOrchestrationMutation(before, f.s);
  f.doc.assetId = "different-upload";
  assert.ok(O.proposalStaleness(f.s, row).some(reason => /source/i.test(reason)));
});

test("legacy state is optional and initializes to empty Observe mode without vendor calls", () => {
  const s = createSeed();
  assert.equal(O.isValidOrchestration(undefined), true);
  assert.equal(O.isValidOrchestration(null), false);
  assert.equal(O.currentControl(s, s.companies[0].id).mode, "Observe");
  assert.equal(s.orchestration, undefined);
  assert.deepEqual(Object.keys(O.orchestration(s)), ["version", "profiles", "fieldMaps", "links", "controls", "readiness", "proposals", "events"]);
  O.validateOrchestrationMutation(s, structuredClone(s));
});

test("profile changes append revisions and preserve one environment plus unique company and inbox mappings", () => {
  const f = setup(), second = f.s.companies[1];
  const before = structuredClone(f.s);
  const revised = O.saveCompanyProfile(f.s, profileInput(f.company.id, { evidence: "Updated template verification", templateRef: "Template 2" }));
  assert.equal(revised.version, 2);
  assert.equal(f.s.orchestration.profiles[0].templateRef, "Approved template 1");
  O.validateOrchestrationMutation(before, f.s);
  assert.throws(() => O.saveCompanyProfile(f.s, profileInput(second.id, { externalCompanyId: "JV-2", environmentId: "Another environment", inboxAliases: [] })), /same SoftPro environment/);
  assert.throws(() => O.saveCompanyProfile(f.s, profileInput(second.id, { inboxAliases: [] })), /already mapped/);
  assert.throws(() => O.saveCompanyProfile(f.s, profileInput(second.id, { externalCompanyId: "JV-2", inboxAliases: [" TITLE@EXAMPLE.TEST "] })), /inbox alias/);
  O.saveCompanyProfile(f.s, profileInput(second.id, { externalCompanyId: "JV-2", inboxAliases: ["second@example.test"] }));
  O.validateOrchestrationMutation(f.s, f.s);
});

test("all command inputs reject unknown fields and forged identity or time", () => {
  const f = setup();
  assert.throws(() => O.saveCompanyProfile(f.s, { ...profileInput(f.company.id), createdBy: "forged" }), /exactly/);
  assert.throws(() => O.proposeExternalChange(f.s, { ...changeInput(f), createdAt: "2000-01-01T00:00:00Z" }), /exactly/);
  assert.throws(() => O.setOrchestrationControl(f.s, { companyId: f.company.id, mode: "Automatic", paused: false, reason: "No review" }), /exactly/);
  const row = proposed(f);
  assert.throws(() => O.reviewExternalProposal(f.s, row.id, { decision: "Approved", note: "ok", by: "reviewer@example.test" }), /exactly/);
  assert.equal(row.createdBy, "operator@example.test");
  assert.ok(Number.isFinite(Date.parse(row.createdAt)));
});

test("field maps allow only supported fields and cannot share external identifiers or lower risk floors", () => {
  const f = setup();
  const input = { companyId: f.company.id, localField: "loanAmount", externalFieldId: "Verified.LoanAmount", canRead: true, canWrite: true, risk: "Low", evidence: "Actual vendor field reviewed" };
  assert.equal(O.saveExternalFieldMap(f.s, input).risk, "Medium");
  assert.equal(O.saveExternalFieldMap(f.s, { ...input, localField: "legalDescription", externalFieldId: "Verified.Legal" }).risk, "High");
  assert.equal(O.saveExternalFieldMap(f.s, { ...input, localField: "county", externalFieldId: "Verified.County" }).risk, "High");
  assert.throws(() => O.saveExternalFieldMap(f.s, { ...input, localField: "hidden.vendor.script" }), /exactly/);
  assert.throws(() => O.saveExternalFieldMap(f.s, { ...input, localField: "attorney", externalFieldId: "Verified.Select.LenderName" }), /already maps/);
  assert.throws(() => O.saveExternalFieldMap(f.s, { ...input, canRead: false, canWrite: false }), /direction/);
});

test("file identity and conversation cannot link to multiple orders in one company", () => {
  const f = setup(), other = structuredClone(f.file);
  other.id = "or-another-order";
  f.s.orders.push(other);
  assert.throws(() => O.verifyExternalOrderLink(f.s, { orderId: other.id, externalFileId: f.link.externalFileId, externalFileNumber: "different-number", missiveConversationId: "", evidence: "Checked" }), /already linked/);
  assert.throws(() => O.verifyExternalOrderLink(f.s, { orderId: other.id, externalFileId: "different-id", externalFileNumber: f.link.externalFileNumber.toLowerCase(), missiveConversationId: "", evidence: "Checked" }), /already linked/);
  assert.throws(() => O.verifyExternalOrderLink(f.s, { orderId: other.id, externalFileId: "different-id", externalFileNumber: "different-number", missiveConversationId: f.link.missiveConversationId, evidence: "Checked" }), /conversation is already/);
});

test("proposal before value is a manual external observation and local file stays unchanged through outcome", () => {
  const f = setup(), localBefore = structuredClone(f.file), before = structuredClone(f.s), row = proposed(f);
  assert.equal(row.beforeValue, "External Old Bank");
  assert.equal(row.status, "Pending review");
  assert.equal(row.sourceDocumentVersion, 1);
  assert.deepEqual(O.proposalStaleness(f.s, row), []);
  approve(f, row);
  O.recordExternalOutcome(f.s, row.id, { result: "Recorded in SoftPro", reference: "Operator entry log 123", note: "Operator recorded the reviewed field in Select and checked it" });
  assert.equal(row.status, "Recorded");
  assert.equal(row.outcome.kind, "Human attestation");
  assert.deepEqual(f.file, localBefore);
  assert.equal(f.s.orchestration.events.filter(e => e.subjectId === row.id).length, 3);
  O.validateOrchestrationMutation(before, f.s);
});

test("missing manual read evidence, wrong quote and same-value requests are rejected", () => {
  const f = setup();
  assert.throws(() => proposed(f, { externalReadEvidence: "" }), /exactly/);
  assert.throws(() => proposed(f, { sourceQuote: "Text which does not exist" }), /quotation/);
  assert.throws(() => proposed(f, { beforeValue: "Oak Bank" }), /must differ/);
  f.doc.text = "Please change\n the lender\tto Oak Bank.";
  assert.equal(proposed(f).sourceQuote, "change the lender to Oak Bank");
});

test("source evidence must belong to the same order and company", () => {
  const f = setup();
  f.doc.companyId = f.s.companies[1].id;
  assert.throws(() => proposed(f), /same company and order/);
  f.doc.companyId = f.company.id;
  delete f.doc.orderId;
  assert.throws(() => proposed(f), /same company and order/);
});

test("Observe mode and emergency pause prevent proposal preparation", () => {
  const f = setup();
  O.setOrchestrationControl(f.s, { companyId: f.company.id, mode: "Observe", paused: false, reason: "Observe only" });
  assert.throws(() => proposed(f), /Enable Propose/);
  O.setOrchestrationControl(f.s, { companyId: f.company.id, mode: "Propose", paused: true, reason: "Investigate mapping" });
  assert.throws(() => proposed(f), /paused/);
});

test("configured named approver is required; high-risk changes still require explicit human review", () => {
  const f = setup(), row = proposed(f);
  assert.throws(() => O.reviewExternalProposal(f.s, row.id, { decision: "Approved", note: "Operator clicked approve" }), /named approver/);
  const high = O.saveExternalFieldMap(f.s, { companyId: f.company.id, localField: "legalDescription", externalFieldId: "Verified.Legal", canRead: true, canWrite: true, risk: "Low", evidence: "Actual field checked" });
  const highProposal = proposed(f, { fieldMapId: high.id, beforeValue: "Lot 1", afterValue: "Lot 2", sourceQuote: "Oak Bank" });
  assert.equal(highProposal.risk, "High");
  assert.equal(highProposal.status, "Pending review");
  approve(f, highProposal);
  assert.equal(highProposal.review.by, "REVIEWER@example.test");
  assert.equal(highProposal.outcome, null);
});

test("ambiguous and unknown file matches remain exceptions until a new proposal is captured", () => {
  for (const matchStatus of ["Ambiguous", "Unknown"]) {
    const f = setup(), row = proposed(f, { matchStatus });
    assert.equal(row.status, "Exception");
    assert.throws(() => approve(f, row), /Resolve the exception/);
    O.reviewExternalProposal(f.s, row.id, { decision: "Rejected", note: "Obtain correct file identity" });
    assert.equal(row.status, "Rejected");
  }
});

test("read-only mappings can capture exceptions but cannot approve a write", () => {
  const f = setup();
  f.map = O.saveExternalFieldMap(f.s, { companyId: f.company.id, localField: "lender", externalFieldId: "Verified.Select.LenderName", canRead: true, canWrite: false, risk: "Medium", evidence: "Vendor grants read only" });
  const row = proposed(f);
  assert.equal(row.status, "Exception");
  assert.match(row.exceptions.join(" "), /does not permit/);
  assert.throws(() => approve(f, row), /Resolve the exception/);
});

test("unlinked and obsolete-profile links stay exception evidence, never a silent file match", () => {
  const f = setup();
  f.s.orchestration.links = [];
  f.s.orchestration.events = f.s.orchestration.events.filter(e => e.subjectId !== f.link.id);
  const row = proposed(f);
  assert.equal(row.linkId, "");
  assert.equal(row.status, "Exception");
  O.validateOrchestrationMutation(f.s, f.s);
});

test("issued, jacket-ready, closing-recorded and prepared-policy orders require specialist workflow", () => {
  for (const status of ["Issued", "Ready for jacket", "closing", "prepared"]) {
    const f = setup();
    if (status === "closing") f.file.outcomes.push({ kind: "Closing recorded", date: "2026-09-14", note: "Closing reported", actor: "Operator" });
    else if (status === "prepared") f.s.business.policies.push({ id: "prepared-fixture", orderId: f.file.id, companyId: f.company.id, status: "Prepared" });
    else f.file.status = status;
    const row = proposed(f);
    assert.equal(row.status, "Exception", status);
    assert.match(row.exceptions.join(" "), /closing or issuance/);
    assert.throws(() => approve(f, row), /specialist review/);
  }
});

test("policy preparation after approval invalidates the receipt even when the order object stays unchanged", () => {
  const f = setup(), row = proposed(f), originalOrder = structuredClone(f.file);
  approve(f, row);
  f.s.business.policies.push({ id: "new-policy-context", orderId: f.file.id, status: "Prepared", kind: "Loan", loanAmount: 350000 });
  assert.deepEqual(f.file, originalOrder);
  assert.match(O.proposalStaleness(f.s, row).join(" "), /preparation/);
  assert.throws(() => O.recordExternalOutcome(f.s, row.id, { result: "Recorded in SoftPro", reference: "Receipt", note: "Claimed change" }), /new proposal/);
});

test("multi-loan amount changes require a loan-specific workflow instead of a shared-field guess", () => {
  const f = setup();
  f.map = O.saveExternalFieldMap(f.s, { companyId: f.company.id, localField: "loanAmount", externalFieldId: "Verified.LoanAmount", canRead: true, canWrite: true, risk: "Medium", evidence: "Verified default amount field" });
  f.s.business.policies.push(...[1, 2].map(i => ({ id: `loan-${i}`, orderId: f.file.id, kind: "Loan", status: "Draft" })));
  const row = proposed(f, { beforeValue: "300000", afterValue: "350000", sourceQuote: "Loan amount is 350000" });
  assert.equal(row.status, "Exception");
  assert.match(row.exceptions.join(" "), /multiple active loans/);
  assert.throws(() => approve(f, row), /Resolve the exception/);
});

for (const change of ["order", "profile", "map", "link", "document version", "document text", "controls"]) {
  test(`${change} changes invalidate an existing review before a manual external outcome`, () => {
    const f = setup(), row = proposed(f);
    approve(f, row);
    if (change === "order") f.file.address += " Unit 2";
    if (change === "profile") O.saveCompanyProfile(f.s, profileInput(f.company.id, { evidence: "Reconfirmed configuration" }));
    if (change === "map") O.saveExternalFieldMap(f.s, { companyId: f.company.id, localField: "lender", externalFieldId: "Verified.Select.LenderName", canRead: true, canWrite: true, risk: "Medium", evidence: "Reconfirmed field" });
    if (change === "link") O.verifyExternalOrderLink(f.s, { orderId: f.file.id, externalFileId: f.link.externalFileId, externalFileNumber: f.link.externalFileNumber, missiveConversationId: f.link.missiveConversationId, evidence: "File rechecked" });
    if (change === "document version") f.doc.version++;
    if (change === "document text") f.doc.text += " New instruction.";
    if (change === "controls") O.setOrchestrationControl(f.s, { companyId: f.company.id, mode: "Propose", paused: true, reason: "Emergency stop" });
    assert.ok(O.proposalStaleness(f.s, row).length);
    assert.throws(() => O.recordExternalOutcome(f.s, row.id, { result: "Recorded in SoftPro", reference: "Receipt 1", note: "Claimed change" }), /new proposal|paused/);
    O.recordExternalOutcome(f.s, row.id, { result: "Not applied", reference: "Review stopped", note: "No external change was made" });
    assert.equal(row.outcome.result, "Not applied");
  });
}

test("a changed local order cannot be approved under an old captured proposal", () => {
  const f = setup(), row = proposed(f);
  f.file.production.loanAmount += 100;
  assert.throws(() => approve(f, row), /local order changed/);
});

test("repeated changes create separate proposals and terminal history cannot be reused", () => {
  const f = setup(), first = proposed(f);
  approve(f, first);
  O.recordExternalOutcome(f.s, first.id, { result: "Recorded in SoftPro", reference: "Receipt 1", note: "Operator verified the change" });
  const second = proposed(f, { beforeValue: "Oak Bank", afterValue: "New Oak Bank" });
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, "Pending review");
  assert.equal(first.afterValue, "Oak Bank");
  assert.throws(() => O.reviewExternalProposal(f.s, first.id, { decision: "Rejected", note: "Overwrite review" }), /already has a final review/);
  assert.throws(() => O.recordExternalOutcome(f.s, first.id, { result: "Not applied", reference: "Overwrite", note: "Overwrite receipt" }), /Approve the proposal/);
});

test("readiness is a versioned human attestation with no API-verification state", () => {
  const f = setup(), input = { companyId: f.company.id, key: "vendor-method", status: "Ready", evidence: "Vendor representative reviewed our proposed connection method" };
  const a = O.attestReadiness(f.s, input);
  const b = O.attestReadiness(f.s, { ...input, status: "Blocked", evidence: "Waiting for actual vendor access" });
  assert.equal(a.status, "Ready");
  assert.equal(b.version, 2);
  assert.equal(O.currentReadiness(f.s, f.company.id)[0].status, "Blocked");
  assert.throws(() => O.attestReadiness(f.s, { ...input, status: "API verified" }), /exactly/);
});

test("matching is company scoped, recognizes street abbreviations and never selects on name alone", () => {
  const f = setup();
  f.file.address = "101 Oak Street, Charlotte NC";
  f.file.client = "Alex Sample";
  assert.equal(O.matchExternalOrder(f.s, f.company.id, { externalFileNumber: "sp-2026-001" }).status, "Candidate");
  assert.equal(O.matchExternalOrder(f.s, f.company.id, { address: "101 oak st Charlotte NC" }).status, "Candidate");
  const byName = O.matchExternalOrder(f.s, f.company.id, { client: "Alex Sample" });
  assert.equal(byName.status, "Ambiguous");
  assert.equal(byName.requiresHumanConfirmation, true);
  assert.equal(O.matchExternalOrder(f.s, f.s.companies[1].id, { externalFileNumber: f.link.externalFileNumber }).status, "Unknown");
});

test("conflicting exact number, thread or address evidence cannot become a unique selection", () => {
  const f = setup(), other = structuredClone(f.file);
  other.id = "or-other-match"; other.address = "999 Other Road";
  f.s.orders.push(other);
  O.verifyExternalOrderLink(f.s, { orderId: other.id, externalFileId: "file-002", externalFileNumber: "SP-2026-002", missiveConversationId: "thread-002", evidence: "File checked" });
  const conflict = O.matchExternalOrder(f.s, f.company.id, { externalFileNumber: f.link.externalFileNumber, missiveConversationId: "thread-002" });
  assert.equal(conflict.status, "Ambiguous");
  assert.equal(conflict.candidates.length, 2);
  assert.equal(O.matchExternalOrder(f.s, f.company.id, { externalFileNumber: f.link.externalFileNumber, address: "999 Other Rd" }).status, "Ambiguous");
  assert.equal(O.matchExternalOrder(f.s, f.company.id, { externalFileNumber: "Wrong file", missiveConversationId: f.link.missiveConversationId }).status, "Ambiguous");
});

test("validation rejects tampered immutable profiles, source evidence, reviews, outcomes and audit events", () => {
  const f = setup(), row = proposed(f);
  approve(f, row);
  O.recordExternalOutcome(f.s, row.id, { result: "Recorded in SoftPro", reference: "Receipt 1", note: "Checked by operator" });
  const before = structuredClone(f.s);
  for (const tamper of [
    s => s.orchestration.profiles[0].evidence = "Rewritten history",
    s => s.orchestration.proposals[0].sourceQuote = "Rewritten source",
    s => s.orchestration.proposals[0].review.note = "Rewritten approval",
    s => s.orchestration.proposals[0].outcome.reference = "Rewritten receipt",
    s => s.orchestration.events[0].note = "Rewritten event",
    s => s.orchestration.proposals.pop(),
  ]) {
    const after = structuredClone(before); tamper(after);
    assert.throws(() => O.validateOrchestrationMutation(before, after), /immutable|deleted|captured order or source evidence/);
  }
});

test("restore validation rejects malformed shapes, foreign-company references and unsupported lifecycle", () => {
  const f = setup(); proposed(f);
  for (const tamper of [
    s => s.orchestration.unknown = [],
    s => s.orchestration.fieldMaps[0].companyId = s.companies[1].id,
    s => s.orchestration.proposals[0].status = "Recorded",
    s => s.orchestration.events[0].companyId = s.companies[1].id,
    s => s.orchestration.profiles[0].version = 3,
    s => s.orchestration.proposals[0].sourceFingerprint = "not valid captured JSON",
    s => s.orchestration.events = [],
    s => s.orchestration.proposals[0].review = { decision: "Approved", note: "Forged", by: "stranger@example.test", at: "2026-09-14T20:00:00Z" },
  ]) {
    const after = structuredClone(f.s); tamper(after);
    assert.throws(() => O.validateOrchestrationMutation(after, after));
  }
});

test("review transitions also enforce current evidence through mutation validation", () => {
  const f = setup(), row = proposed(f), before = structuredClone(f.s);
  f.s.user = "reviewer@example.test";
  row.review = { decision: "Approved", note: "Reviewed", by: f.s.user, at: new Date().toISOString() };
  row.status = "Approved";
  f.file.address += " Changed";
  assert.throws(() => O.validateOrchestrationMutation(before, f.s), /local order changed/);
});

test("actions use command capture and deterministic IDs rather than raw state edits", () => {
  const f = setup();
  const result = captureCommands(f.s, draft => {
    O.attestReadiness(draft, { companyId: f.company.id, key: "samples", status: "Ready", evidence: "Business accepted representative samples" });
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "attestReadiness");
  assert.equal(result[0].args.length, 1);
});
