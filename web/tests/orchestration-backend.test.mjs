import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, executeCommands, projectWorkspace, normalizeWorkspace, captureCommands, OR, P } from "../.local-test/backend/api.mjs";

const NOW = "2026-09-14T14:00:00.000Z";
const EMAIL = "reviewer@example.test";
const CLIENT_PERSONA = "Browser-selected persona";
const access = (role = "owner", overrides = {}) => ({
  userId: "11111111-1111-4111-8111-111111111111", email: EMAIL, role,
  allCompanies: role === "owner", companyIds: ["A"], restricted: false, version: 1, partnerMembers: [], ...overrides,
});
const freeze = t => t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
function fixture() {
  const s = emptyWorkspace(EMAIL);
  s.companies = ["A", "B"].map(id => ({ id, name: `Company ${id}`, initials: id, color: "blue", contact: "Fixture contact", email: `office-${id.toLowerCase()}@example.test`, location: "Charlotte", jurisdiction: "NC", stage: "Onboarding", steps: [], members: [{ name: "Member", share: 100 }] }));
  s.orders = ["A", "B"].map(companyId => ({ id: `order-${companyId}`, companyId, address: `${companyId === "A" ? "100" : "200"} Fixture Road`, client: `Fixture buyer ${companyId}`, type: "Purchase", underwriter: "Fixture underwriter", owner: "Fixture operator", jurisdiction: "NC", status: "New", due: "2026-09-20", premium: 100, rate: 0.4, month: "2026-09", fields: [], notes: "", exception: "", delivered: false, remitted: false }));
  s.documents = ["A", "B"].map(companyId => ({ id: `doc-${companyId}`, companyId, orderId: `order-${companyId}`, name: `Source ${companyId}.txt`, category: "Other", visibility: "Internal", date: "2026-09-14", size: "42 B", version: 1, text: "The approved new loan amount is 250000." }));
  return s;
}
const profileInput = (companyId = "A") => ({ companyId, environmentId: "verified-existing-environment", externalCompanyId: `external-company-${companyId}`, externalCompanyName: `Confirmed company ${companyId}`, underwriter: "Existing underwriter", inboxAliases: [`inbox-${companyId.toLowerCase()}@example.test`], templateRef: "Approved commitment template", archiveRule: "Company / file / date / version", softPro360Channel: "Existing channel confirmed by administrator", approvers: [EMAIL, CLIENT_PERSONA], evidence: "Reviewed company selector and administrator-supplied identifier." });
const mapInput = (companyId = "A") => ({ companyId, localField: "loanAmount", externalFieldId: "confirmed-provider-loan-field", canRead: true, canWrite: true, risk: "Medium", evidence: "Provider field dictionary reviewed." });
const linkInput = (companyId = "A") => ({ orderId: `order-${companyId}`, externalFileId: `provider-file-${companyId}`, externalFileNumber: "SP-100", missiveConversationId: `thread-${companyId}`, evidence: "Company, property, buyer, and file number checked against original SoftPro file." });
const controlInput = (companyId = "A") => ({ companyId, mode: "Propose", paused: false, reason: "Reviewed pilot preparation approved by business owner." });
const readinessInput = (companyId = "A") => ({ companyId, key: "samples", status: "Ready", evidence: "Representative fictional file and expected result confirmed." });
function configure(s, companyId = "A") {
  OR.saveCompanyProfile(s, profileInput(companyId));
  OR.saveExternalFieldMap(s, mapInput(companyId));
  OR.verifyExternalOrderLink(s, linkInput(companyId));
  OR.setOrchestrationControl(s, controlInput(companyId));
  return s;
}
const proposalInput = (s, companyId = "A") => ({ orderId: `order-${companyId}`, fieldMapId: OR.currentFieldMaps(s, companyId)[0].id, beforeValue: "200000", afterValue: "250000", sourceDocumentId: `doc-${companyId}`, sourcePage: "Page 1", sourceQuote: "The approved new loan amount is 250000.", reason: "New lender instructions received.", matchStatus: "Confirmed", externalReadEvidence: "Operator opened the original company and SoftPro file at 9:30; original loan value 200000 confirmed." });
const reviewInput = { decision: "Approved", note: "Company, original source, and before/after values reviewed." };
const outcomeInput = { result: "Recorded in SoftPro", reference: "Manual audit entry QA-1", note: "Operator manually verified the change against the original source." };
function capture(s, a, fn, persona = a.email) {
  const draft = projectWorkspace(s, a);
  draft.user = persona;
  return { draft, commands: captureCommands(draft, fn) };
}
function run(s, a, fn, name, persona = a.email) {
  const before = structuredClone(s);
  const { draft, commands } = capture(s, a, fn, persona);
  assert.deepEqual(commands.map(c => c.name), [name]);
  const next = executeCommands(s, commands, a);
  assert.deepEqual(s, before, "canonical input stays unchanged until the batch succeeds");
  return { next, draft, commands };
}
function caseFor(name) {
  const s = fixture();
  if (name === "saveCompanyProfile") return { s, fn: d => OR.saveCompanyProfile(d, profileInput()) };
  configure(s);
  if (name === "saveExternalFieldMap") return { s, fn: d => OR.saveExternalFieldMap(d, mapInput()) };
  if (name === "verifyExternalOrderLink") return { s, fn: d => OR.verifyExternalOrderLink(d, linkInput()) };
  if (name === "setOrchestrationControl") return { s, fn: d => OR.setOrchestrationControl(d, controlInput()) };
  if (name === "attestReadiness") return { s, fn: d => OR.attestReadiness(d, readinessInput()) };
  if (name === "proposeExternalChange") return { s, fn: d => OR.proposeExternalChange(d, proposalInput(d)) };
  const p = OR.proposeExternalChange(s, proposalInput(s));
  if (name === "reviewExternalProposal") return { s, fn: d => OR.reviewExternalProposal(d, p.id, reviewInput) };
  OR.reviewExternalProposal(s, p.id, reviewInput);
  return { s, fn: d => OR.recordExternalOutcome(d, p.id, outcomeInput) };
}

for (const name of OR.orchestrationActionNames) {
  test(`connected orchestration ${name} captures and replays the real form action with server identity`, t => {
    freeze(t);
    const { s, fn } = caseFor(name);
    const { next, draft } = run(s, access(), fn, name, CLIENT_PERSONA);
    const clientEvent = draft.orchestration.events.at(-1), event = next.orchestration.events.at(-1);
    assert.equal(event.id, clientEvent.id, "command-derived record IDs survive replay");
    assert.equal(event.createdBy, EMAIL);
    assert.equal(event.createdAt, NOW);
    assert.equal(event.companyId, "A");
    assert.equal(clientEvent.createdBy, CLIENT_PERSONA);
    assert.deepEqual(normalizeWorkspace(JSON.parse(JSON.stringify(next))), next);
    const latest = next.orchestration.proposals.at(-1);
    if (name === "reviewExternalProposal") assert.equal(latest.review.by, EMAIL);
    if (name === "recordExternalOutcome") { assert.equal(latest.outcome.by, EMAIL); assert.equal(latest.outcome.kind, "Human attestation"); }
  });
}

test("connected orchestration full capture/save/reload round trip preserves approved manual receipt", t => {
  freeze(t);
  const original = fixture(), a = access();
  const { draft, commands } = capture(original, a, d => {
    OR.saveCompanyProfile(d, profileInput());
    OR.saveExternalFieldMap(d, mapInput());
    OR.verifyExternalOrderLink(d, linkInput());
    OR.setOrchestrationControl(d, controlInput());
    OR.attestReadiness(d, readinessInput());
    const p = OR.proposeExternalChange(d, proposalInput(d));
    OR.reviewExternalProposal(d, p.id, reviewInput);
    OR.recordExternalOutcome(d, p.id, outcomeInput);
  });
  assert.equal(commands.length, 8);
  const next = executeCommands(original, JSON.parse(JSON.stringify(commands)), a);
  const restored = projectWorkspace(JSON.parse(JSON.stringify(next)), a);
  assert.equal(restored.orchestration.proposals[0].id, draft.orchestration.proposals[0].id);
  assert.equal(restored.orchestration.proposals[0].status, "Recorded");
  assert.equal(restored.orchestration.events.length, 8);
  assert.equal(restored.orchestration.proposals[0].outcome.reference, outcomeInput.reference);
  assert.deepEqual(original.orchestration.proposals, []);
});

test("server attribution and command timestamps override the browser's earlier capture", t => {
  freeze(t);
  const s = fixture(), a = access();
  const { draft, commands } = capture(s, a, d => OR.saveCompanyProfile(d, profileInput()), CLIENT_PERSONA);
  t.mock.timers.setTime(new Date(NOW).getTime() + 60000);
  const next = executeCommands(s, commands, a);
  assert.equal(draft.orchestration.profiles[0].createdAt, NOW);
  assert.equal(next.orchestration.profiles[0].createdAt, "2026-09-14T14:01:00.000Z");
  assert.equal(next.orchestration.profiles[0].createdBy, EMAIL);
});

for (const role of ["owner", "admin", "operations", "onboarding", "finance", "viewer", "partner"]) {
  test(`connected orchestration enforces ${role} capabilities for every registered action`, t => {
    freeze(t);
    const a = access(role, { allCompanies: ["owner", "admin"].includes(role) });
    for (const name of OR.orchestrationActionNames) {
      const { s, fn } = caseFor(name);
      const { commands } = capture(s, access(), fn);
      const config = ["saveCompanyProfile", "saveExternalFieldMap", "setOrchestrationControl", "attestReadiness"].includes(name);
      const allowed = ["owner", "admin"].includes(role) || (!config && role === "operations");
      if (allowed) assert.doesNotThrow(() => executeCommands(s, commands, a), name);
      else assert.throws(() => executeCommands(s, commands, a), e => e.status === 403, `${role}: ${name}`);
    }
  });
}

test("company profile creation requires organization-wide admin scope but scoped admin can maintain visible field mappings", t => {
  freeze(t);
  const s = configure(fixture()), a = access("admin");
  const profile = capture(s, access(), d => OR.saveCompanyProfile(d, profileInput()));
  assert.throws(() => executeCommands(s, profile.commands, a), e => e.status === 403 && /Organization-wide/.test(e.message));
  const map = capture(s, a, d => OR.saveExternalFieldMap(d, mapInput()));
  assert.equal(executeCommands(s, map.commands, a).orchestration.fieldMaps.length, 2);
});

test("every orchestration action rejects extra arguments and forged input fields", t => {
  freeze(t);
  for (const name of OR.orchestrationActionNames) {
    const { s, fn } = caseFor(name), a = access();
    const { commands } = capture(s, a, fn);
    const extra = structuredClone(commands); extra[0].args.push("unexpected");
    assert.throws(() => executeCommands(s, extra, a), e => e.status === 400, `${name}: argument count`);
    const forged = structuredClone(commands), index = ["reviewExternalProposal", "recordExternalOutcome"].includes(name) ? 1 : 0;
    forged[0].args[index].createdBy = "client-forged@example.test";
    assert.throws(() => executeCommands(s, forged, a), e => e.status === 400, `${name}: actor injection`);
  }
});

test("legacy snapshots acquire an empty orchestration ledger without mutating their original saved data", t => {
  freeze(t);
  const legacy = fixture(); delete legacy.orchestration;
  const before = structuredClone(legacy);
  const shown = projectWorkspace(legacy, access());
  assert.deepEqual(Object.values(shown.orchestration).filter(Array.isArray), Array.from({ length: 7 }, () => []));
  const { commands } = capture(shown, access(), d => OR.saveCompanyProfile(d, profileInput()));
  assert.equal(executeCommands(legacy, commands, access()).orchestration.profiles.length, 1);
  assert.deepEqual(legacy, before);
});

test("company isolation permits the same external file number in different companies and hides every other-company integration row", t => {
  freeze(t);
  const s = configure(configure(fixture(), "A"), "B");
  OR.proposeExternalChange(s, proposalInput(s, "A"));
  OR.proposeExternalChange(s, proposalInput(s, "B"));
  const shown = projectWorkspace(s, access("operations"));
  for (const rows of Object.values(shown.orchestration).filter(Array.isArray)) assert.ok(rows.every(r => r.companyId === "A"));
  assert.equal(shown.orchestration.links[0].externalFileNumber, "SP-100");
  assert.doesNotThrow(() => OR.validateOrchestrationMutation(shown, shown));
  const hidden = s.orchestration.proposals.find(p => p.companyId === "B");
  const { commands } = capture(s, access(), d => OR.reviewExternalProposal(d, hidden.id, reviewInput));
  assert.throws(() => executeCommands(s, commands, access("operations")), e => e.status === 403);
});

test("restricted evidence removes the whole company integration history while preserving valid visible revision sequences", t => {
  freeze(t);
  const s = configure(configure(fixture(), "A"), "B");
  OR.proposeExternalChange(s, proposalInput(s, "A"));
  // A later profile is valid history, but must not expose an earlier usable-looking profile when a dependent proposal disappears.
  OR.saveCompanyProfile(s, { ...profileInput("A"), evidence: "Second reviewed configuration." });
  s.documents.find(d => d.id === "doc-A").visibility = "Restricted";
  const shown = projectWorkspace(s, access("operations", { allCompanies: true }));
  for (const rows of Object.values(shown.orchestration).filter(Array.isArray)) assert.ok(rows.every(r => r.companyId === "B"));
  assert.doesNotThrow(() => OR.validateOrchestrationMutation(shown, shown));
  assert.ok(!JSON.stringify(shown.orchestration).includes("provider-file-A"));
  const full = projectWorkspace(s, access("owner", { restricted: true }));
  assert.equal(full.orchestration.profiles.filter(p => p.companyId === "A").length, 2);
  const { commands } = capture(s, access("owner", { restricted: true }), d => OR.setOrchestrationControl(d, { ...controlInput("A"), paused: true }));
  assert.throws(() => executeCommands(s, commands, access("admin", { allCompanies: true })), e => e.status === 403);
});

for (const restricted of [false, true])
  for (const status of ["Pending review", "Exception", "Approved"]) test(`hidden agency evidence cannot erase another file's ${status} blocker with restricted=${restricted}`, t => {
    freeze(t);
    const s = configure(configure(fixture(), "A"), "B");
    for (const suffix of ["blocked", "clear"]) {
      s.orders.push({ ...structuredClone(s.orders[0]), id: `order-A-${suffix}`, address: `Fictional ${suffix} property` });
      s.documents.push({ ...s.documents[0], id: `doc-A-${suffix}`, orderId: `order-A-${suffix}`, name: `Source ${suffix}.txt` });
    }
    s.documents.push({ id: "private-agency-doc", companyId: "A", name: "AGENCY_PRIVATE formation.txt", text: "AGENCY_PRIVATE source", category: "Formation", visibility: "Restricted", date: "2026-09-14", size: "20 B", version: 1 });
    // File A's link references agency evidence; the blocked file has its own
    // entirely production-safe source and active proposal in the same ledger.
    OR.verifyExternalOrderLink(s, { ...linkInput(), evidence: JSON.stringify({ documentId: "private-agency-doc", note: "AGENCY_PRIVATE original checked" }) });
    OR.proposeExternalChange(s, proposalInput(s));
    OR.verifyExternalOrderLink(s, { ...linkInput(), orderId: "order-A-blocked", externalFileId: "provider-file-A-blocked", externalFileNumber: "SP-101", missiveConversationId: "thread-A-blocked" });
    const proposal = OR.proposeExternalChange(s, { ...proposalInput(s), orderId: "order-A-blocked", sourceDocumentId: "doc-A-blocked", matchStatus: status === "Exception" ? "Unknown" : "Confirmed" });
    if (status === "Approved") OR.reviewExternalProposal(s, proposal.id, reviewInput);
    assert.equal(proposal.status, status);
    assert(P.finalReadiness(s, s.orders.find(o => o.id === "order-A-blocked")).missingContext.includes("unresolved external change proposal"));
    const canonical = structuredClone(s);
    const a = access("operations", { restricted, allCompanies: true });
    const shown = projectWorkspace(s, a);
    assert(!shown.orders.some(o => o.id === "order-A-blocked"), "Withhold the file when its unresolved blocker cannot be shown");
    assert(!shown.documents.some(d => d.orderId === "order-A-blocked"));
    assert(shown.orders.some(o => o.id === "order-A-clear"), "An unaffected file in the company remains available");
    assert(shown.orders.some(o => o.id === "order-B"), "Another company's production records remain available");
    assert(!shown.orchestration.proposals.some(p => p.companyId === "A"));
    assert.doesNotMatch(JSON.stringify(shown), /AGENCY_PRIVATE|private-agency-doc/);
    assert.doesNotThrow(() => normalizeWorkspace(shown));
    assert.throws(() => executeCommands(s, [{ id: crypto.randomUUID(), name: "editDraft", args: [[{ table: "orders", id: "order-A-blocked", value: { status: "Ready for jacket" } }]] }], a), e => e.status === 403);
    const full = projectWorkspace(s, access("owner", { restricted: true }));
    assert(full.orders.some(o => o.id === "order-A-blocked"));
    assert(full.orchestration.proposals.some(p => p.id === proposal.id && p.status === status));
    assert.deepEqual(s, canonical);
  });

test("integration history cannot bypass supported actions using direct editDraft writes", t => {
  freeze(t);
  const s = configure(fixture()), a = access();
  const p = OR.proposeExternalChange(s, proposalInput(s));
  for (const [table, id, patch] of [
    ["orchestration.profiles", s.orchestration.profiles[0].id, { externalCompanyId: "wrong" }],
    ["orchestration.fieldMaps", s.orchestration.fieldMaps[0].id, { canWrite: false }],
    ["orchestration.proposals", p.id, { status: "Approved" }],
    ["orchestration.events", s.orchestration.events[0].id, { createdBy: "spoof" }],
  ]) {
    const { commands } = capture(s, a, d => Object.assign(d.orchestration[table.split(".")[1]].find(r => r.id === id), patch));
    assert.equal(commands[0].name, "editDraft");
    assert.throws(() => executeCommands(s, commands, a), e => e.status === 400 || e.status === 403, table);
  }
});

test("stale source and changed controls prevent an approved receipt while permitting an honest Not applied receipt", t => {
  freeze(t);
  let s = configure(fixture());
  const p = OR.proposeExternalChange(s, proposalInput(s));
  OR.reviewExternalProposal(s, p.id, reviewInput);
  const applied = capture(s, access(), d => OR.recordExternalOutcome(d, p.id, outcomeInput));
  s = run(s, access(), d => OR.setOrchestrationControl(d, { ...controlInput(), paused: true, reason: "Hold for updated lender instructions." }), "setOrchestrationControl").next;
  assert.throws(() => executeCommands(s, applied.commands, access()), e => e.status === 400 && /paused/i.test(e.message));
  const stopped = run(s, access("operations"), d => OR.recordExternalOutcome(d, p.id, { ...outcomeInput, result: "Not applied", reference: "Hold log 1", note: "No external write performed; waiting on reviewed instructions." }), "recordExternalOutcome").next;
  assert.equal(stopped.orchestration.proposals[0].outcome.result, "Not applied");
});

test("source changes after browser approval capture are rejected by canonical replay", t => {
  freeze(t);
  const s = configure(fixture()), p = OR.proposeExternalChange(s, proposalInput(s));
  const { commands } = capture(s, access(), d => OR.reviewExternalProposal(d, p.id, reviewInput));
  s.documents.find(d => d.id === "doc-A").text = "Superseding lender source now asks for 300000.";
  assert.throws(() => executeCommands(s, commands, access()), e => e.status === 400 && /source document changed/i.test(e.message));
  assert.equal(s.orchestration.proposals[0].status, "Pending review");
});

test("a non-named operator cannot approve even when permitted to create proposals", t => {
  freeze(t);
  const s = configure(fixture()), p = OR.proposeExternalChange(s, proposalInput(s));
  const { commands } = capture(s, access(), d => OR.reviewExternalProposal(d, p.id, reviewInput));
  assert.throws(() => executeCommands(s, commands, access("operations", { email: "other@example.test" })), e => e.status === 400 && /named approver/.test(e.message));
});

test("invalid commands fail atomically after earlier valid connection actions in the same batch", t => {
  freeze(t);
  const s = fixture(), a = access(), before = structuredClone(s);
  const { commands } = capture(s, a, d => { OR.saveCompanyProfile(d, profileInput()); OR.saveExternalFieldMap(d, mapInput()); });
  commands[1].args[0].externalFieldId = "";
  assert.throws(() => executeCommands(s, commands, a), e => e.status === 400);
  assert.deepEqual(s, before);
});
