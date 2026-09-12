import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import { executeRules } from "../.local-test/engine.js";
import {
  createRevision,
  applyRevision,
  recheckRevision,
} from "../.local-test/production.js";
import {
  createFollowup,
  cancelFollowupItem,
  recordFollowupSent,
  resolveFollowupItem,
  partnerPeriod,
} from "../.local-test/followups.js";
import {
  reviewCommitment,
  finalReadiness,
  orderSources,
  neededFields,
  sameDocumentFamily,
  titleFile,
} from "../.local-test/production.js";
import {
  business,
  enrichBusiness,
  getCommitment,
  saveCommitment,
  prepareCommitment,
  commitmentProblems,
  addPolicy,
  savePolicy,
  voidDraftPolicy,
  preparePolicy,
  issuePolicy,
  deliverPolicy,
  policyProblems,
  products,
  saveCPL,
  prepareCPL,
  returnCPL,
  deliverCPL,
  recordCommitmentReturn,
  getOnboarding,
  saveApplication,
  saveCredential,
  recordOnboardingEvidence,
  companyProblems,
  validateBusinessMutation,
  newClose,
  reviewClose,
  refreshClose,
  publishClose,
  saveCloseDraft,
  ledgerLines,
  handoffCurrent,
  recordHandoff,
  openCorrection,
  requestCorrection,
  reviewCorrectionRequest,
  recordCorrection,
  cancelCorrection,
} from "../.local-test/business.js";
const source = (s, o, role, extra = {}) => {
  const d = {
    id: crypto.randomUUID(),
    companyId: o.companyId,
    orderId: o.id,
    name: `${role}.txt`,
    sourceRole: role,
    category: "Policy documents",
    visibility: "Internal",
    date: "2026-09-11",
    size: "1KB",
    version: 1,
    text: "Fictional fixture",
    ...extra,
  };
  s.documents.push(d);
  return d;
};
function finalCase() {
  const s = createSeed(),
    o = s.orders[0];
  o.production.requirements.forEach((r) => {
    r.status = r.kind === "Requirement" ? "Satisfied" : "Retained";
    r.evidence = "Recorded source reference";
    r.note = "Disposition reviewed";
  });
  o.fields.forEach((f) => (f.reviewed = true));
  reviewCommitment(s, o, "Final opinion and evidence reviewed.");
  return { s, o };
}
function policy(s, o, kind = "Owner") {
  let p = addPolicy(s, o.id, kind);
  savePolicy(s, {
    ...p,
    insured: kind === "Owner" ? "Fictional Owner" : "Fictional Lender",
    form: "DEMO form and approval",
    amount: kind === "Owner" ? 400000 : 320000,
    loanAmount: kind === "Loan" ? 320000 : 0,
    loanReference: kind === "Loan" ? "Primary loan" : "",
    premium: kind === "Owner" ? 1000 : 250,
    reviewNote: "Final coverage and evidence reviewed",
    securityDocumentId:
      orderSources(s, o.id).find((d) => d.sourceRole === "Deed of trust")?.id ||
      "",
    securityPage: "1",
    loanReviewNote: "Loan principal reviewed",
    exceptions: o.production.requirements
      .filter((r) => r.kind === "Exception")
      .map((r) => ({
        itemId: r.id,
        disposition: "Retain",
        wording: r.text,
        reason: "Retained after review",
      })),
  });
  return products(s, o.id).find((x) => x.id === p.id);
}
function policyDoc(s, o, p, name = "Final policy.pdf") {
  return source(s, o, "Final policy", {
    name,
    policyId: p.id,
    policyVersion: p.version,
    productionVersion: o.production.version,
    preparationFingerprint: p.preparedSnapshot,
  });
}
function correctionDoc(s, o, c, name = "Correction.pdf") {
  return source(s, o, "Correction output", {
    name,
    correctionId: c.id,
    preparationFingerprint: c.reviewSnapshot,
  });
}
function cpl(s, o, decision = "Not requested") {
  const input = {
    id: crypto.randomUUID(),
    orderId: o.id,
    party: "Sample covered party",
    recipient: "recipient@example.com",
    form: "DEMO CPL form",
    reason: "Decision reviewed for this example",
    decision,
    reference: "",
    documentId: "",
    version: 1,
    loanReference: "Primary loan",
    status: "Draft",
    snapshot: "",
    deliveryReference: "",
  };
  saveCPL(s, input);
  return business(s).cpls.find((c) => c.id === input.id);
}
function commitmentCase() {
  const s = createSeed(),
    o = s.orders[0];
  const pto = source(s, o, "Preliminary opinion");
  policy(s, o);
  cpl(s, o);
  const c = getCommitment(s, o);
  saveCommitment(s, {
    ...c,
    ptoDocumentId: pto.id,
    attorneyReference: "Signed PTO reference",
    premiumBasis: "Standard — manually reviewed",
    reviewNote: "Intake evidence, legal description and coverage reviewed",
  });
  return { s, o, c: getCommitment(s, o) };
}
function closeInputs(p) {
  return {
    ...p,
    booksReference: "Books and statement DEMO",
    agreementReference: "Operating agreement v1 effective 2026-01-01",
    note: "Expenses and ownership reconciled.",
  };
}
function launchedCompany() {
  const s = createSeed(),
    c = s.companies.find((c) => c.id === "c3");
  saveApplication(s, {
    ...getOnboarding(s, c),
    mailingAddress: "100 Example Street",
    secureApplicationReference: "Secure intake DEMO",
    signatureReference: "Signed application DEMO",
    applicationStatus: "Reviewed",
    applicationNote: "Reviewed applicant business details",
  });
  for (const kind of [
    "Agency license",
    "Producer credential",
    "Underwriter authority",
  ])
    saveCredential(s, {
      id: crypto.randomUUID(),
      companyId: c.id,
      state: "NC",
      kind,
      underwriter: kind === "Underwriter authority" ? "WFG" : "",
      holder: "Sample holder",
      identifier: "DEMO credential",
      reference: "Reviewed authority record",
      expiresOn: "2099-12-31",
      reviewOn: "2099-01-01",
      status: "Verified locally",
      reviewer: "John",
    });
  for (let step = 0; step < 7; step++)
    recordOnboardingEvidence(s, c.id, {
      step,
      reference: `Step ${step} reference`,
      documentId: "",
      note: "Evidence reviewed for local demonstration",
    });
  return { s, c };
}

test("initial commitment permits open requirements but final preparation does not", () => {
  const { s, o } = commitmentCase();
  assert.deepEqual(commitmentProblems(s, o), []);
  const prepared = prepareCommitment(s, o.id);
  assert.equal(prepared.status, "Prepared");
  assert.equal(finalReadiness(s, o).ready, false);
  assert.equal(business(s).handoffs.length, 1);
  prepareCommitment(s, o.id);
  assert.equal(business(s).handoffs.length, 1);
});
test("refinance commitment does not require an invented seller", () => {
  const { s, o } = commitmentCase();
  o.type = "Refinance";
  o.production.seller = "";
  assert.ok(!commitmentProblems(s, o).includes("Seller"));
});
test("commitment return rejects output from an earlier preparation even at the same intake version", () => {
  const { s, o, c } = commitmentCase();
  prepareCommitment(s, o.id);
  const old = source(s, o, "Commitment output", {
    commitmentVersion: c.version,
    productionVersion: o.production.version,
    preparationFingerprint: c.snapshot,
  });
  const p = products(s, o.id)[0];
  savePolicy(s, { ...p, premium: 1100 });
  prepareCommitment(s, o.id);
  assert.throws(
    () => recordCommitmentReturn(s, o.id, "return-1", old.id),
    /current commitment/,
  );
  const current = source(s, o, "Commitment output", {
    version: 2,
    commitmentVersion: c.version,
    productionVersion: o.production.version,
    preparationFingerprint: c.snapshot,
  });
  recordCommitmentReturn(s, o.id, "return-2", current.id);
  assert.equal(c.status, "Returned");
});
test("two loan products preserve independent loan principal and identity", () => {
  const { s, o } = finalCase();
  const p1 = policy(s, o, "Loan"),
    p2 = policy(s, o, "Loan");
  savePolicy(s, {
    ...p2,
    loanReference: "Junior loan",
    loanAmount: 50000,
    amount: 50000,
  });
  assert.deepEqual(policyProblems(s, o, p1), []);
  assert.deepEqual(
    policyProblems(
      s,
      o,
      products(s, o.id).find((p) => p.id === p2.id),
    ),
    [],
  );
  voidDraftPolicy(s, p2.id);
  assert.equal(products(s, o.id).length, 1);
});
test("SC retained commission above 60 percent is flagged before policy preparation", () => {
  const { s, o } = finalCase();
  o.jurisdiction = "SC";
  const p = policy(s, o);
  p.rate = 0.2;
  assert.ok(policyProblems(s, o, p).some((e) => e.includes("60%")));
  assert.throws(() => preparePolicy(s, p.id, "Reviewed"), /policy details/);
});
test("mortgage review does not require a trustee or deed-of-trust classification", () => {
  const { s, o } = finalCase();
  o.production.securityInstrument = "Mortgage";
  const security = orderSources(s, o.id).find(
    (d) => d.sourceRole === "Deed of trust",
  );
  security.sourceRole = "Mortgage";
  reviewCommitment(s, o, "Mortgage evidence reviewed");
  assert.ok(!neededFields(o).some((f) => f.id === "trustee"));
  assert.equal(finalReadiness(s, o).ready, true);
});
test("each policy issues and delivers independently with identical filenames", () => {
  const { s, o } = finalCase();
  const owner = policy(s, o),
    loan = policy(s, o, "Loan");
  preparePolicy(s, owner.id, "Owner reviewed");
  assert.throws(
    () =>
      issuePolicy(s, owner.id, {
        reference: "Owner-1",
        documentId: "x",
        month: "2026-09",
      }),
    /every policy/,
  );
  preparePolicy(s, loan.id, "Loan reviewed");
  const ownerDoc = policyDoc(s, o, owner);
  issuePolicy(s, owner.id, {
    reference: "Owner-1",
    documentId: ownerDoc.id,
    month: "2026-09",
  });
  assert.notEqual(o.status, "Issued");
  const loanDoc = policyDoc(s, o, loan);
  assert.equal(sameDocumentFamily(ownerDoc, loanDoc), false);
  assert.equal(
    orderSources(s, o.id).filter((d) => d.sourceRole === "Final policy").length,
    2,
  );
  issuePolicy(s, loan.id, {
    reference: "Loan-1",
    documentId: loanDoc.id,
    month: "2026-09",
  });
  assert.equal(o.status, "Issued");
  assert.equal(
    ledgerLines(s, o.companyId, "2026-09").filter((r) => r.orderId === o.id)
      .length,
    2,
  );
  assert.equal(
    ledgerLines(s, o.companyId, "2026-09")
      .filter((r) => r.orderId === o.id)
      .reduce((n, r) => n + r.premium, 0),
    1250,
  );
  deliverPolicy(s, owner.id, "owner@example.com", "Delivery 1");
  assert.equal(o.delivered, false);
  deliverPolicy(s, loan.id, "lender@example.com", "Delivery 2");
  assert.equal(o.delivered, true);
  assert.throws(() => voidDraftPolicy(s, owner.id), /unissued/);
});
test("partial issuance locks shared source changes and keeps successful handoff current", () => {
  const { s, o } = finalCase();
  const owner = policy(s, o),
    loan = policy(s, o, "Loan");
  preparePolicy(s, owner.id, "Reviewed");
  preparePolicy(s, loan.id, "Reviewed");
  const d = policyDoc(s, o, owner);
  issuePolicy(s, owner.id, {
    reference: "Policy-1",
    documentId: d.id,
    month: "2026-09",
  });
  const before = structuredClone(s),
    after = structuredClone(s);
  after.orders.find((x) => x.id === o.id).production.loanAmount = 330000;
  assert.throws(
    () => validateBusinessMutation(before, after),
    /already issued/,
  );
  const job = business(s).handoffs.find((j) => j.sourceId === owner.id);
  assert.equal(handoffCurrent(s, job), true);
  recordHandoff(s, job.id, "SoftPro result", "Returned policy reviewed");
  assert.equal(job.status, "Recorded locally");
  assert.throws(() => addPolicy(s, o.id, "Owner"), /first issuance/);
});
test("rejected orders cannot resume policy issuance through a prepared product", () => {
  const { s, o } = finalCase();
  const p = policy(s, o);
  preparePolicy(s, p.id, "Reviewed");
  const doc = policyDoc(s, o, p);
  o.status = "Rejected";
  assert.throws(
    () =>
      issuePolicy(s, p.id, {
        reference: "NO",
        documentId: doc.id,
        month: "2026-09",
      }),
    /no longer open/,
  );
  assert.equal(p.status, "Prepared");
});
test("cash CPL can complete independently and rejects stale preparation documents", () => {
  const s = createSeed(),
    o = s.orders[0];
  o.production.financing = "Cash";
  o.production.loanAmount = 0;
  const c = cpl(s, o, "Requested");
  prepareCPL(s, c.id);
  const old = source(s, o, "CPL", {
    cplId: c.id,
    cplVersion: c.version,
    preparationFingerprint: c.snapshot,
  });
  o.production.loanAmount = 1;
  prepareCPL(s, c.id);
  assert.throws(() => returnCPL(s, c.id, "CPL-1", old.id), /current recipient/);
  const current = source(s, o, "CPL", {
    version: 2,
    cplId: c.id,
    cplVersion: c.version,
    preparationFingerprint: c.snapshot,
  });
  returnCPL(s, c.id, "CPL-2", current.id);
  const job = business(s).handoffs.find((j) => j.fingerprint === c.snapshot);
  assert.equal(handoffCurrent(s, job), true);
  deliverCPL(s, c.id, "Delivery receipt");
  assert.equal(c.status, "Delivered");
});
test("application and authority evidence are required for launch", () => {
  const s = createSeed(),
    c = s.companies.find((c) => c.id === "c3");
  assert.throws(
    () =>
      recordOnboardingEvidence(s, c.id, {
        step: 6,
        reference: "Launch",
        documentId: "",
        note: "Approved",
      }),
    /launch checks/,
  );
  const after = structuredClone(s);
  after.companies.find((x) => x.id === c.id).stage = "Active";
  assert.throws(() => validateBusinessMutation(s, after), /evidence-based/);
  const launched = launchedCompany();
  assert.equal(launched.c.stage, "Active");
  assert.deepEqual(companyProblems(launched.s, launched.c), []);
});
test("unchanged application save preserves launch; ownership changes reopen it", () => {
  const { s, c } = launchedCompany();
  const old = { ...getOnboarding(s, c), launchSnapshot: undefined };
  saveApplication(s, old);
  assert.equal(c.stage, "Active");
  assert.equal(getOnboarding(s, c).evidence.length, 7);
  const after = structuredClone(s);
  after.companies.find((x) => x.id === c.id).members = [
    { name: "Replacement owner", share: 100 },
  ];
  validateBusinessMutation(s, after);
  assert.equal(after.companies.find((x) => x.id === c.id).stage, "Onboarding");
  assert.equal(
    getOnboarding(
      after,
      after.companies.find((x) => x.id === c.id),
    ).launchedAt,
    "",
  );
});
test("expired credentials reopen launch during hydration and cannot move across companies", () => {
  const { s, c } = launchedCompany();
  const record = business(s).credentials[0];
  assert.throws(
    () => saveCredential(s, { ...record, companyId: "c1" }),
    /another company/,
  );
  record.expiresOn = "2000-01-01";
  enrichBusiness(s);
  assert.equal(c.stage, "Onboarding");
  assert.equal(getOnboarding(s, c).launchedAt, "");
});
test("close review rejects stale ownership even when totals are unchanged", () => {
  const s = createSeed(),
    p = newClose(s, "c1", "2026-09"),
    old = closeInputs(structuredClone(p));
  s.companies.find((c) => c.id === "c1").members = [
    { name: "A", share: 50 },
    { name: "B", share: 50 },
  ];
  refreshClose(s, p.id);
  assert.throws(() => reviewClose(s, old), /Source records changed/);
  assert.equal(p.status, "Draft");
});
test("reviewed close publication freezes allocations and prevents older revision rollback", () => {
  const s = createSeed(),
    p1 = newClose(s, "c1", "2026-09");
  reviewClose(s, closeInputs(p1));
  const p2 = newClose(s, "c1", "2026-09");
  reviewClose(s, { ...closeInputs(p2), reserve: 100 });
  publishClose(s, p2.id);
  assert.throws(() => publishClose(s, p1.id), /newer close/);
  const amounts = structuredClone(p2.allocations);
  s.companies.find((c) => c.id === "c1").members = [
    { name: "Changed", share: 100 },
  ];
  assert.deepEqual(p2.allocations, amounts);
  assert.equal(p2.status, "Published");
});
test("zero-policy loss close persists a draft and allocates no negative payments", () => {
  const s = createSeed(),
    p = newClose(s, "c3", "2026-08");
  saveCloseDraft(s, {
    ...p,
    expenses: 101.27,
    note: "No activity, documented costs",
  });
  reviewClose(s, closeInputs(p));
  assert.equal(p.totals.profit, -101.27);
  assert.equal(p.totals.available, 0);
  assert.ok(p.allocations.every((a) => a.amount === 0));
});
import {
  loadDemoScenario,
  recordOrderOutcome,
  recoveryStage,
  backfillReceivedDate,
} from "../.local-test/business.js";
test("guided sample is idempotent, isolated from current source values and never preapproves evidence", () => {
  const s = createSeed();
  s.orders[0].fields[0].sourceValue = "Private operator-entered value";
  const orderId = loadDemoScenario(s);
  const count = s.orders.length,
    docs = s.documents.length;
  assert.equal(loadDemoScenario(s), orderId);
  assert.equal(s.orders.length, count);
  assert.equal(s.documents.length, docs);
  const o = s.orders.find((o) => o.id === orderId);
  assert.equal(o.companyId, "demo-training-company");
  assert.ok(o.fields.every((f) => !f.reviewed));
  assert.ok(!JSON.stringify(o).includes("Private operator-entered value"));
  assert.equal(finalReadiness(s, o).ready, false);
});
test("rejected and recovered outcomes are separate from policy issuance", () => {
  const s = createSeed(),
    o = s.orders[0];
  recordOrderOutcome(
    s,
    o.id,
    "Rejected",
    "2026-09-11",
    "Another provider selected",
  );
  assert.equal(o.status, "Rejected");
  recordOrderOutcome(
    s,
    o.id,
    "Recovered",
    "2026-09-12",
    "Client returned after follow-up",
  );
  assert.equal(o.status, "Needs review");
  assert.equal(o.exception, "");
  assert.equal(o.outcomes.length, 2);
  recordOrderOutcome(
    s,
    o.id,
    "Closing recorded",
    "2026-09-13",
    "Closing confirmation",
  );
  assert.notEqual(o.status, "Issued");
});
test("recovery stage tracks contacted/lost checkpoints on a rejected file, and resets on recovery", () => {
  const s = createSeed(),
    o = s.orders[0];
  assert.equal(recoveryStage(o), null);
  recordOrderOutcome(s, o.id, "Rejected", "2026-09-01", "Client went quiet");
  assert.equal(recoveryStage(o), "Not yet contacted");
  recordOrderOutcome(s, o.id, "Contacted", "2026-09-03", "Left a voicemail");
  assert.equal(recoveryStage(o), "Awaiting response");
  recordOrderOutcome(
    s,
    o.id,
    "Recovery lost",
    "2026-09-20",
    "No response after three attempts",
  );
  assert.equal(recoveryStage(o), "Lost");
  // A later contact attempt can still resume a recovery marked Lost.
  recordOrderOutcome(s, o.id, "Contacted", "2026-10-01", "Client called back");
  assert.equal(recoveryStage(o), "Awaiting response");
  recordOrderOutcome(s, o.id, "Recovered", "2026-10-02", "Client is proceeding");
  assert.equal(o.status, "Needs review");
  assert.equal(recoveryStage(o), null);
});
test("contacted/recovery-lost checkpoints require an active rejection", () => {
  const s = createSeed(),
    o = s.orders[0];
  assert.throws(
    () => recordOrderOutcome(s, o.id, "Contacted", "2026-09-01", "Follow-up"),
    /active recovery/,
  );
  recordOrderOutcome(s, o.id, "Rejected", "2026-09-01", "Provider decision");
  recordOrderOutcome(s, o.id, "Recovered", "2026-09-05", "Client returned");
  assert.throws(
    () => recordOrderOutcome(s, o.id, "Contacted", "2026-09-06", "Follow-up"),
    /active recovery/,
  );
});
test("receipt date can be backfilled once but not overwritten or set to the future", () => {
  const s = createSeed(),
    o = s.orders.find((x) => !x.receivedAt) || s.orders[0];
  o.receivedAt = "";
  backfillReceivedDate(s, o.id, "2026-01-15");
  assert.equal(o.receivedAt, "2026-01-15");
  assert.throws(
    () => backfillReceivedDate(s, o.id, "2026-02-01"),
    /already has a receipt date/,
  );
  const other = s.orders[1];
  other.receivedAt = "";
  assert.throws(
    () => backfillReceivedDate(s, other.id, "2999-01-01"),
    /valid, non-future/,
  );
});

test("renewal reminders use recorded dates and do not duplicate work", () => {
  const s = createSeed();
  const due = new Date();
  due.setDate(due.getDate() + 10);
  const far = new Date();
  far.setDate(far.getDate() + 60);
  const base = {
    companyId: "c1",
    state: "NC",
    kind: "Agency license",
    underwriter: "",
    holder: "Demo agency",
    identifier: "DEMO",
    reference: "Local evidence",
    status: "Verified locally",
    reviewer: "John",
    reviewOn: "",
  };
  business(s).credentials.push(
    { ...base, id: "near-renewal", expiresOn: due.toISOString().slice(0, 10) },
    { ...base, id: "far-renewal", expiresOn: far.toISOString().slice(0, 10) },
    { ...base, id: "unknown-renewal", expiresOn: "" },
  );
  const before = s.tasks.length;
  executeRules(s, ["renewals"]);
  assert.equal(s.tasks.length, before + 1);
  assert.equal(s.tasks[0].companyId, "c1");
  assert.equal(s.tasks[0].due, due.toISOString().slice(0, 10));
  executeRules(s, ["renewals"]);
  assert.equal(s.tasks.length, before + 1);
});

test("CPL delivery becomes stale when property or a loan principal changes", () => {
  for (const change of ["property", "loan"]) {
    const { s, o } = finalCase();
    const loan = policy(s, o, "Loan"),
      c = cpl(s, o, "Requested");
    prepareCPL(s, c.id);
    const doc = source(s, o, "CPL", {
      cplId: c.id,
      cplVersion: c.version,
      preparationFingerprint: c.snapshot,
    });
    returnCPL(s, c.id, "Returned CPL", doc.id);
    if (change === "property") o.address = "Different property";
    else loan.loanAmount += 1000;
    assert.throws(() => deliverCPL(s, c.id, "Receipt"), /current returned CPL/);
  }
});
test("simple revision updates one loan product and mirrors the file-level amount", () => {
  const { s, o } = finalCase();
  const loan = policy(s, o, "Loan");
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Change principal to 340000",
    proposed: 340000,
  });
  assert.equal(r.productId, loan.id);
  applyRevision(s, r.id, true);
  assert.equal(loan.loanAmount, 340000);
  assert.equal(loan.status, "Draft");
  assert.equal(loan.loanReviewNote, "");
  assert.equal(titleFile(o).loanAmount, 340000);
});
test("creating a revision on a multi-loan file requires choosing which loan", () => {
  const { s, o } = finalCase();
  policy(s, o, "Loan");
  policy(s, o, "Loan");
  assert.throws(
    () =>
      createRevision(s, {
        companyId: o.companyId,
        orderId: o.id,
        messageId: "",
        text: "Change principal",
        proposed: 350000,
      }),
    /Choose which loan/,
  );
});
test("a revision naming an unknown or voided loan is rejected", () => {
  const { s, o } = finalCase();
  policy(s, o, "Loan");
  policy(s, o, "Loan");
  assert.throws(
    () =>
      createRevision(s, {
        companyId: o.companyId,
        orderId: o.id,
        messageId: "",
        text: "Change principal",
        proposed: 350000,
        productId: "not-a-real-loan-id",
      }),
    /Choose which loan/,
  );
});
test("a multi-loan revision updates only its chosen loan, leaving the file and the other loan untouched", () => {
  const { s, o } = finalCase();
  const loanA = policy(s, o, "Loan");
  const loanB = policy(s, o, "Loan");
  loanA.loanReference = "Loan A";
  loanB.loanReference = "Loan B";
  const loanASnapshot = structuredClone(loanA);
  const fileAmountBefore = titleFile(o).loanAmount;
  const fileVersionBefore = titleFile(o).version;
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Change Loan B principal to 200000",
    proposed: 200000,
    productId: loanB.id,
  });
  assert.equal(r.productId, loanB.id);
  applyRevision(s, r.id, true);
  const refreshedA = products(s, o.id).find((x) => x.id === loanA.id);
  const refreshedB = products(s, o.id).find((x) => x.id === loanB.id);
  assert.equal(refreshedB.loanAmount, 200000);
  assert.equal(refreshedB.status, "Draft");
  assert.deepEqual(refreshedA, loanASnapshot);
  assert.equal(titleFile(o).loanAmount, fileAmountBefore);
  assert.equal(titleFile(o).version, fileVersionBefore);
});
test("a multi-loan revision detects staleness scoped to its own loan, not the file", () => {
  const { s, o } = finalCase();
  policy(s, o, "Loan");
  const loanB = policy(s, o, "Loan");
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: "",
    text: "Change Loan B principal to 200000",
    proposed: 200000,
    productId: loanB.id,
  });
  loanB.loanAmount = 999999;
  loanB.version++;
  assert.throws(
    () => applyRevision(s, r.id, true),
    /changed after the request/,
  );
  recheckRevision(s, r.id);
  applyRevision(s, r.id, true);
  assert.equal(
    products(s, o.id).find((x) => x.id === loanB.id).loanAmount,
    200000,
  );
});
test("message routing cannot silently redirect an existing revision", () => {
  const s = createSeed(),
    o = s.orders[3];
  const message = s.inbox.find((m) => m.kind === "Revision");
  message.orderId = o.id;
  message.companyId = o.companyId;
  const r = createRevision(s, {
    companyId: o.companyId,
    orderId: o.id,
    messageId: message.id,
    text: "Change principal",
    proposed: 340000,
  });
  const after = structuredClone(s);
  after.inbox.find((m) => m.id === message.id).orderId = s.orders[0].id;
  assert.throws(() => validateBusinessMutation(s, after), /linked revision/);
  assert.throws(() => applyRevision(after, r.id, true), /routed to another/);
  assert.equal(titleFile(after.orders[3]).loanAmount, r.before);
});
test("attorney follow-up persists, resolves individual items and reopens review", () => {
  const { s, o } = finalCase();
  const input = {
    body: "Please clarify the final opinion and deed.",
    owner: "Tyler",
    messageId: "",
    items: [
      { label: "Final opinion", role: "Final opinion" },
      { label: "Deed", role: "Deed" },
    ],
  };
  const id = createFollowup(s, o.id, input);
  assert.equal(createFollowup(s, o.id, input), id);
  assert.equal(finalReadiness(s, o).ready, false);
  const saved = enrichBusiness(JSON.parse(JSON.stringify(s))),
    request = business(saved).followups[0];
  assert.equal(request.body, input.body);
  recordFollowupSent(saved, id, "Manual approved-channel reference");
  assert.equal(request.status, "Waiting for attorney");
  const doc = orderSources(saved, o.id).find(
    (d) => d.sourceRole === "Final opinion",
  );
  resolveFollowupItem(saved, id, request.items[0].id, {
    documentId: doc.id,
    responseMessageId: "",
    note: "Received clarified opinion",
  });
  assert.equal(request.items[1].status, "Outstanding");
  assert.equal(request.status, "Waiting for attorney");
  assert.ok(saved.orders[0].fields.every((f) => !f.reviewed));
  const deed = orderSources(saved, o.id).find((d) => d.sourceRole === "Deed");
  resolveFollowupItem(saved, id, request.items[1].id, {
    documentId: deed.id,
    responseMessageId: "",
    note: "Received complete deed",
  });
  assert.equal(request.status, "Resolved");
  assert.equal(saved.tasks.find((t) => t.id === `task-${id}`).done, true);
  assert.equal(finalReadiness(saved, saved.orders[0]).ready, false);
});
test("follow-up evidence cannot come from a different file", () => {
  const { s, o } = finalCase();
  const id = createFollowup(s, o.id, {
    body: "Please clarify.",
    owner: "Tyler",
    messageId: "",
    items: [{ label: "Clarification", role: "Other" }],
  });
  const request = business(s).followups[0],
    foreign = orderSources(s, s.orders[1].id)[0];
  assert.throws(
    () =>
      resolveFollowupItem(s, id, request.items[0].id, {
        documentId: foreign.id,
        responseMessageId: "",
        note: "Wrong file",
      }),
    /Link the received|belong/,
  );
  assert.equal(request.items[0].status, "Outstanding");
});
test("partner period counts receipt and outcomes independently of issuance month", () => {
  const s = createSeed(),
    o = s.orders[0];
  o.receivedAt = "2026-07-01";
  recordOrderOutcome(s, o.id, "Rejected", "2026-07-05", "Provider decision");
  recordOrderOutcome(s, o.id, "Recovered", "2026-08-02", "Client returned");
  recordOrderOutcome(
    s,
    o.id,
    "Closing recorded",
    "2026-08-20",
    "Closing confirmation",
  );
  o.status = "Issued";
  o.month = "2026-09";
  assert.ok(
    partnerPeriod(s, o.companyId, "2026-07").received.some(
      (x) => x.id === o.id,
    ),
  );
  assert.ok(
    partnerPeriod(s, o.companyId, "2026-07").rejected.some(
      (x) => x.id === o.id,
    ),
  );
  assert.ok(
    partnerPeriod(s, o.companyId, "2026-08").recovered.some(
      (x) => x.id === o.id,
    ),
  );
  assert.ok(
    partnerPeriod(s, o.companyId, "2026-08").closed.some((x) => x.id === o.id),
  );
  assert.ok(
    !partnerPeriod(s, o.companyId, "2026-09").received.some(
      (x) => x.id === o.id,
    ),
  );
  assert.ok(
    partnerPeriod(s, o.companyId, "2026-09").issued.some((x) => x.id === o.id),
  );
});

test("new attorney follow-up invalidates an existing prepared handoff", () => {
  const { s, o } = finalCase();
  const p = policy(s, o);
  preparePolicy(s, p.id, "Reviewed");
  const before = structuredClone(s);
  createFollowup(s, o.id, {
    body: "Clarification required",
    owner: "Tyler",
    messageId: "",
    items: [{ label: "Clarification", role: "Other" }],
  });
  validateBusinessMutation(before, s);
  const job = business(s).handoffs.find((j) => j.sourceId === p.id);
  assert.equal(job.status, "Hold");
  assert.equal(handoffCurrent(s, job), false);
  assert.throws(
    () => recordHandoff(s, job.id, "Receipt", "Completed"),
    /current|changed|review/i,
  );
});
test("follow-up response routing remains bound to the original file", () => {
  const { s, o } = finalCase();
  const id = createFollowup(s, o.id, {
    body: "Clarification required",
    owner: "Tyler",
    messageId: "",
    items: [{ label: "Clarification", role: "Other" }],
  });
  const message = {
    ...s.inbox[0],
    id: "clarification-response",
    companyId: o.companyId,
    orderId: o.id,
  };
  s.inbox.push(message);
  resolveFollowupItem(s, id, business(s).followups[0].items[0].id, {
    documentId: "",
    responseMessageId: message.id,
    note: "Attorney response reviewed",
  });
  const after = structuredClone(s);
  after.inbox.find((m) => m.id === message.id).orderId = s.orders[1].id;
  assert.throws(
    () => validateBusinessMutation(s, after),
    /evidence for an attorney follow-up/,
  );
});
test("obsolete follow-up can be cancelled with history instead of invented evidence", () => {
  const { s, o } = finalCase();
  const id = createFollowup(s, o.id, {
    body: "Please send security instrument",
    owner: "Tyler",
    messageId: "",
    items: [{ label: "Deed of trust", role: "Deed of trust" }],
  });
  const request = business(s).followups[0];
  o.production.financing = "Cash";
  assert.throws(
    () => cancelFollowupItem(s, id, request.items[0].id, ""),
    /document why/,
  );
  cancelFollowupItem(
    s,
    id,
    request.items[0].id,
    "Transaction changed to cash; review requested by attorney",
  );
  assert.equal(request.status, "Cancelled");
  assert.equal(request.items[0].documentId, "");
  assert.ok(request.items[0].note.includes("cash"));
  assert.ok(
    !finalReadiness(s, o).missingContext.includes(
      "outstanding attorney follow-up",
    ),
  );
  assert.ok(o.fields.every((f) => !f.reviewed));
});
test("a correction request only opens on an issued policy and needs complete before/after evidence", () => {
  const { s, o } = finalCase();
  const owner = policy(s, o);
  assert.throws(
    () =>
      requestCorrection(s, owner.id, {
        reason: "Name misspelled",
        requestedBy: "Attorney",
        requestReference: "",
        correctionKind: "Endorsement",
        fieldChanges: [{ label: "Insured name", before: "Jon Smith", after: "John Smith" }],
      }),
    /issued or delivered/,
  );
  preparePolicy(s, owner.id, "Owner reviewed");
  const doc = policyDoc(s, o, owner);
  issuePolicy(s, owner.id, { reference: "Owner-1", documentId: doc.id, month: "2026-09" });
  assert.throws(
    () =>
      requestCorrection(s, owner.id, {
        reason: "",
        requestedBy: "",
        requestReference: "",
        correctionKind: "Endorsement",
        fieldChanges: [],
      }),
    /before and after value/,
  );
  requestCorrection(s, owner.id, {
    reason: "Name misspelled on the issued policy",
    requestedBy: "Attorney — Morgan & Reed",
    requestReference: "Email 2026-09-11",
    correctionKind: "Endorsement",
    fieldChanges: [{ label: "Insured name", before: "Jon Smith", after: "John Smith" }],
  });
  assert.throws(
    () =>
      requestCorrection(s, owner.id, {
        reason: "Second issue",
        requestedBy: "Attorney",
        requestReference: "",
        correctionKind: "Endorsement",
        fieldChanges: [{ label: "X", before: "A", after: "B" }],
      }),
    /already has an open correction/,
  );
});
test("a reviewed correction can be recorded without touching the issued policy, and its evidence is frozen", () => {
  const { s, o } = finalCase();
  const owner = policy(s, o);
  preparePolicy(s, owner.id, "Owner reviewed");
  const doc = policyDoc(s, o, owner);
  issuePolicy(s, owner.id, { reference: "Owner-1", documentId: doc.id, month: "2026-09" });
  const originalInsured = owner.insured,
    originalPolicyNumber = owner.policyNumber;
  const correction = requestCorrection(s, owner.id, {
    reason: "Name misspelled on the issued policy",
    requestedBy: "Attorney — Morgan & Reed",
    requestReference: "Email 2026-09-11",
    correctionKind: "Endorsement",
    fieldChanges: [{ label: "Insured name", before: "Jon Smith", after: "John Smith" }],
  });
  assert.throws(
    () => reviewCorrectionRequest(s, correction.id, ""),
    /review note/,
  );
  reviewCorrectionRequest(s, correction.id, "Confirmed against the recorded deed.");
  assert.equal(correction.status, "Reviewed");
  const job = business(s).handoffs.find(
    (j) => j.kind === "SoftPro correction" && j.sourceId === correction.id,
  );
  assert.equal(handoffCurrent(s, job), true);
  const before = structuredClone(s),
    after = structuredClone(s);
  after.business.corrections.find((c) => c.id === correction.id).reason = "Changed after review";
  assert.throws(
    () => validateBusinessMutation(before, after),
    /request evidence cannot change/,
  );
  const cdoc = correctionDoc(s, o, correction);
  assert.throws(
    () => recordCorrection(s, correction.id, "END-1", "missing"),
    /correction document for this request/,
  );
  recordCorrection(s, correction.id, "END-1", cdoc.id);
  assert.equal(correction.status, "Recorded");
  assert.equal(job.status, "Recorded locally");
  assert.equal(owner.insured, originalInsured);
  assert.equal(owner.policyNumber, originalPolicyNumber);
  assert.equal(owner.status, "Issued");
});
test("an open correction can be cancelled, holds its handoff, and frees the policy for a new request", () => {
  const { s, o } = finalCase();
  const owner = policy(s, o);
  preparePolicy(s, owner.id, "Owner reviewed");
  const doc = policyDoc(s, o, owner);
  issuePolicy(s, owner.id, { reference: "Owner-1", documentId: doc.id, month: "2026-09" });
  const first = requestCorrection(s, owner.id, {
    reason: "Wrong recording reference",
    requestedBy: "Internal review",
    requestReference: "",
    correctionKind: "Administrative correction",
    fieldChanges: [{ label: "Book/page", before: "1842/316", after: "1842/318" }],
  });
  reviewCorrectionRequest(s, first.id, "Confirmed against the recorded deed.");
  const job = business(s).handoffs.find(
    (j) => j.kind === "SoftPro correction" && j.sourceId === first.id,
  );
  assert.throws(() => cancelCorrection(s, first.id, ""), /why this correction/);
  cancelCorrection(s, first.id, "Underwriter said no correction was needed after all.");
  assert.equal(first.status, "Cancelled");
  assert.equal(job.status, "Hold");
  assert.equal(openCorrection(s, owner.id), undefined);
  const second = requestCorrection(s, owner.id, {
    reason: "A different issue found later",
    requestedBy: "Attorney",
    requestReference: "",
    correctionKind: "Endorsement",
    fieldChanges: [{ label: "Legal description", before: "Lot 12", after: "Lot 12-A" }],
  });
  assert.notEqual(second.id, first.id);
  assert.equal(business(s).corrections.filter((c) => c.policyId === owner.id).length, 2);
});
