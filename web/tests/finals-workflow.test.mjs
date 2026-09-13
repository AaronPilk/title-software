import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `export * from './lib/title/finals-queue'; export * from './lib/title/production'; export * from './lib/title/business'; export {createSeed} from './lib/title/model'; export {captureCommands} from './lib/title/command-log';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { createSeed, finalsQueue, filterFinalsQueue, nextReadyFinal, titleFile,
  finalReadiness, reviewCommitment, addReferencedSource, reviewReferencedSource,
  referencedSourceStatus, commitmentProblems, commitmentFingerprint,
  referencedSourcesShapeValid,
  validateBusinessMutation, captureCommands, closeFingerprint, newClose, refreshClose,
  launchFingerprint, getOnboarding } = api;
const now = new Date("2026-09-13T12:00:00Z");
function fixture() {
  const s = createSeed();
  s.inbox = []; s.documents = [];
  for (const o of s.orders) { o.fields = []; o.status = "New"; o.production = undefined; }
  s.business.policies = [];
  return s;
}
function message(s, order, time = "2026-09-10T12:00:00Z", extra = {}) {
  const m = { id: crypto.randomUUID(), kind: "Finals", companyId: order.companyId,
    orderId: order.id, time, from: "Attorney", email: "attorney@example.com",
    subject: "Final opinion", body: "Final opinion attached.", status: "New", attachments: [], ...extra };
  s.inbox.push(m); return m;
}
function document(s, order, role = "Search package", version = 1, extra = {}) {
  const d = { id: crypto.randomUUID(), companyId: order.companyId, orderId: order.id,
    sourceRole: role, version, name: `${role}.txt`, category: "Policy documents", visibility: "Internal",
    date: "2026-09-10", size: "1 KB", text: "Fixture source", ...extra };
  s.documents.push(d); return d;
}
function readyFixture() {
  const s = createSeed(), o = s.orders[0];
  o.production.requirements.forEach(r => { r.status = r.kind === "Requirement" ? "Satisfied" : "Retained"; r.evidence = "Reviewed source"; r.note = "Reviewed disposition"; });
  o.fields.forEach(f => { f.reviewed = true; });
  reviewCommitment(s, o, "Final opinion and commitment reviewed.");
  assert.equal(finalReadiness(s, o).ready, true);
  return { s, o };
}

test("finals exclude initial-only, issued, rejected and cross-company requests", () => {
  const s = fixture(), [initial, final, issued, rejected, wrongCompany] = s.orders;
  message(s, initial, undefined, { kind: "Commitment" });
  message(s, final); message(s, issued); issued.status = "Issued";
  message(s, rejected); rejected.status = "Rejected";
  message(s, wrongCompany, undefined, { companyId: "not-this-company" });
  assert.deepEqual(finalsQueue(s, now).map(r => r.order.id), [final.id]);
});

test("multiple final emails yield one file and the earliest known receipt", () => {
  const s = fixture(), o = s.orders[0];
  message(s, o, "2026-09-11T12:00:00Z"); message(s, o, "2026-09-08T12:00:00Z");
  const rows = finalsQueue(s, now);
  assert.equal(rows.length, 1); assert.equal(rows[0].requestCount, 2);
  assert.equal(rows[0].receivedAt, "2026-09-08T12:00:00.000Z"); assert.equal(rows[0].ageDays, 5);
});

test("final source alone enters queue without inventing receipt from order or upload dates", () => {
  const s = fixture(), o = s.orders[0];
  o.receivedAt = "2026-01-01"; document(s, o, "Final opinion");
  const [row] = finalsQueue(s, now);
  assert.equal(row.order.id, o.id); assert.equal(row.receivedAt, null); assert.equal(row.ageDays, null);
});

test("legacy times, invalid dates, future receipts and mixed undated requests remain unknown", () => {
  for (const value of ["10:30 AM", "2026-02-30", "2027-01-01T00:00:00Z", ""]) {
    const s = fixture(), o = s.orders[0]; message(s, o, value); message(s, o);
    assert.equal(finalsQueue(s, now)[0].ageDays, null);
  }
});

test("queue sorts dated finals oldest first and unknown dates last", () => {
  const s = fixture(), [newer, unknown, oldest] = s.orders;
  message(s, newer, "2026-09-11T12:00:00Z"); message(s, unknown, "10:30 AM"); message(s, oldest, "2026-09-05T12:00:00Z");
  assert.deepEqual(finalsQueue(s, now).map(r => r.order.id), [oldest.id, newer.id, unknown.id]);
});

test("queue distinguishes source waiting, reviewed readiness, and partial issuance", () => {
  const { s, o } = readyFixture();
  assert.equal(finalsQueue(s, now).find(r => r.order.id === o.id).stage, "Ready");
  const prior = s.documents;
  s.documents = s.documents.filter(d => !(d.orderId === o.id && d.sourceRole === "Final opinion"));
  assert.equal(finalsQueue(s, now).find(r => r.order.id === o.id).stage, "Waiting");
  s.documents = prior;
  s.business.policies.push({ id: "issued-product", orderId: o.id, status: "Issued" });
  assert.equal(finalsQueue(s, now).find(r => r.order.id === o.id).stage, "Partially issued");
});

test("company, assignee, stage and query filters combine; next-ready stays within them", () => {
  const s = fixture(), [a, b, c] = s.orders;
  const rows = [{ order: a, stage: "Ready" }, { order: b, stage: "Waiting" }, { order: c, stage: "Ready" }];
  c.companyId = a.companyId; c.owner = "Different assignee";
  const filtered = filterFinalsQueue(s, rows, { company: a.companyId, owner: a.owner, stage: "Ready", query: a.id });
  assert.deepEqual(filtered.map(r => r.order.id), [a.id]);
  assert.equal(nextReadyFinal(rows, a.id), c.id);
  assert.equal(nextReadyFinal(rows, c.id), a.id);
  assert.equal(nextReadyFinal(filtered, a.id), undefined);
  a.owner = "";
  assert.deepEqual(filterFinalsQueue(s, rows, { owner: "__unassigned" }).map(r => r.order.id), [a.id]);
});

test("required missing reference blocks commitment and final readiness without an attachment", () => {
  const { s, o } = readyFixture();
  const wording = "See title search, including the recorded release.\nKeep this wording.";
  const r = addReferencedSource(s, o.id, { wording, role: "Search package", required: true });
  assert.equal(r.wording, wording); assert.equal(referencedSourceStatus(s, o, r), "Pending");
  assert.ok(commitmentProblems(s, o).some(p => p.includes("Referenced source needs review")));
  assert.ok(finalReadiness(s, o).missingContext.some(p => p.startsWith("referenced source:")));
  assert.equal(finalReadiness(s, o).ready, false);
  assert.equal(finalsQueue(s, now).find(row => row.order.id === o.id).stage, "Waiting");
  assert.equal(addReferencedSource(s, o.id, { wording, role: "Search package", required: true }).id, r.id);
});

test("reference review requires current exact-version evidence from this company and file", () => {
  const { s, o } = readyFixture();
  const r = addReferencedSource(s, o.id, { wording: "See prior policy", role: "Prior policy", required: true });
  const d = document(s, o, "Prior policy");
  const input = { decision: "Reviewed", documentId: d.id, documentVersion: d.version, rationale: "Date, amount and exceptions reviewed on pages 1–4." };
  for (const bad of [{ ...input, rationale: "" }, { ...input, documentVersion: 2 }, { ...input, documentId: "missing" }])
    assert.throws(() => reviewReferencedSource(s, o.id, r.id, bad));
  const other = document(s, s.orders[1], "Prior policy");
  assert.throws(() => reviewReferencedSource(s, o.id, r.id, { ...input, documentId: other.id }));
  const wrongRole = document(s, o, "Final opinion");
  assert.throws(() => reviewReferencedSource(s, o.id, r.id, { ...input, documentId: wrongRole.id }));
  reviewReferencedSource(s, o.id, r.id, input);
  assert.equal(referencedSourceStatus(s, o, r), "Reviewed");
  assert.ok(!commitmentProblems(s, o).some(p => p.startsWith("Referenced source needs review")));
  assert.equal(r.reviews[0].reviewedBy, s.user);
});

test("replacement invalidates reference and preparation fingerprints; rereview retains original history", () => {
  const { s, o } = readyFixture();
  const r = addReferencedSource(s, o.id, { wording: "See attached search", role: "Search package", required: true });
  const d = document(s, o);
  reviewReferencedSource(s, o.id, r.id, { decision: "Reviewed", documentId: d.id, documentVersion: 1, rationale: "Reviewed first package." });
  const review = structuredClone(r.reviews[0]), fingerprint = commitmentFingerprint(s, o);
  const replacement = document(s, o, "Search package", 2);
  assert.equal(referencedSourceStatus(s, o, r), "Source changed");
  assert.notEqual(commitmentFingerprint(s, o), fingerprint);
  assert.ok(commitmentProblems(s, o).some(p => p.startsWith("Referenced source needs review")));
  assert.throws(() => reviewReferencedSource(s, o.id, r.id, { decision: "Reviewed", documentId: d.id, documentVersion: 1, rationale: "Old copy." }));
  reviewReferencedSource(s, o.id, r.id, { decision: "Reviewed", documentId: replacement.id, documentVersion: 2, rationale: "Reviewed replacement." });
  assert.equal(referencedSourceStatus(s, o, r), "Reviewed");
  assert.deepEqual(r.reviews[0], review); assert.equal(r.reviews.length, 2);
});

test("not-applicable requires rationale and optional references never create an automatic hold", () => {
  const { s, o } = readyFixture();
  const r = addReferencedSource(s, o.id, { wording: "Possible prior policy", role: "Prior policy", required: false });
  assert.ok(!commitmentProblems(s, o).some(p => p.startsWith("Referenced source needs review")));
  assert.throws(() => reviewReferencedSource(s, o.id, r.id, { decision: "Not applicable", documentId: "", documentVersion: 0, rationale: "" }));
  reviewReferencedSource(s, o.id, r.id, { decision: "Not applicable", documentId: "untrusted", documentVersion: 999, rationale: "Attorney confirmed this refers to another transaction." });
  assert.equal(referencedSourceStatus(s, o, r), "Not applicable");
  assert.equal(r.reviews[0].documentId, ""); assert.equal(r.reviews[0].documentVersion, 0);
});

test("original reference and review history cannot be deleted or rewritten", () => {
  const { s, o } = readyFixture();
  const r = addReferencedSource(s, o.id, { wording: "See search", role: "Search package", required: true });
  reviewReferencedSource(s, o.id, r.id, { decision: "Not applicable", documentId: "", documentVersion: 0, rationale: "Reviewed clarification." });
  for (const edit of [n => { n.production.referencedSources = []; }, n => { n.production.referencedSources[0].required = false; }, n => { n.production.referencedSources[0].reviews[0].rationale = "Changed history"; }]) {
    const after = structuredClone(s); edit(after.orders.find(n => n.id === o.id));
    assert.throws(() => validateBusinessMutation(s, after), /Preserve the original source reference/);
  }
});

test("older state needs no migration while malformed source-checklist backups are rejected", () => {
  assert.equal(referencedSourcesShapeValid(undefined), true);
  assert.equal(referencedSourcesShapeValid([]), true);
  for (const value of [null, {}, [null], [{ id: "bad", reviews: {} }]])
    assert.equal(referencedSourcesShapeValid(value), false);
  const { s, o } = readyFixture();
  const r = addReferencedSource(s, o.id, { wording: "See search", role: "Search package", required: true });
  reviewReferencedSource(s, o.id, r.id, { decision: "Not applicable", documentId: "", documentVersion: 0, rationale: "Attorney clarification reviewed." });
  const saved = JSON.parse(JSON.stringify(o.production.referencedSources));
  assert.equal(referencedSourcesShapeValid(saved), true);
  assert.equal(referencedSourcesShapeValid([...saved, saved[0]]), false);
  saved[0].reviews[0].rationale = "";
  assert.equal(referencedSourcesShapeValid(saved), false);
});

test("rejected and partially issued files cannot add or alter referenced-source reviews", () => {
  const { s, o } = readyFixture();
  const r = addReferencedSource(s, o.id, { wording: "See search", role: "Search package", required: true });
  for (const status of ["Rejected", "Issued"]) {
    o.status = status;
    assert.throws(() => addReferencedSource(s, o.id, { wording: "Other source", role: "Other", required: true }));
    assert.throws(() => reviewReferencedSource(s, o.id, r.id, { decision: "Not applicable", documentId: "", documentVersion: 0, rationale: "No longer needed." }));
  }
  o.status = "Needs review"; s.business.policies.push({ id: "partial", orderId: o.id, status: "Issued" });
  assert.throws(() => addReferencedSource(s, o.id, { wording: "Other source", role: "Other", required: true }));
});

test("source checklist changes are captured as domain commands, not forged draft review edits", () => {
  const { s, o } = readyFixture();
  const commands = captureCommands(s, draft => {
    const r = addReferencedSource(draft, o.id, { wording: "See search", role: "Search package", required: true });
    reviewReferencedSource(draft, o.id, r.id, { decision: "Not applicable", documentId: "", documentVersion: 0, rationale: "Clarified by attorney." });
  });
  assert.deepEqual(commands.map(c => c.name), ["addReferencedSource", "reviewReferencedSource"]);
});

test("member contact edits do not change ownership fingerprints or expose contacts in close snapshots", () => {
  const s = createSeed(), c = s.companies[0];
  const before = structuredClone(s), closeBefore = closeFingerprint(s, c, "2026-09"), launchBefore = launchFingerprint(s, c);
  c.members[0].email = "member@example.com"; c.members[0].phone = "555-0100";
  assert.equal(closeFingerprint(s, c, "2026-09"), closeBefore);
  assert.equal(launchFingerprint(s, c), launchBefore);
  validateBusinessMutation(before, s);
  assert.equal(getOnboarding(s, c).applicationStatus, getOnboarding(before, before.companies[0]).applicationStatus);
  const close = newClose(s, c.id, "2026-09");
  assert.deepEqual(Object.keys(close.members[0]).sort(), ["name", "share"]);
  refreshClose(s, close.id);
  assert.deepEqual(Object.keys(close.members[0]).sort(), ["name", "share"]);
});
