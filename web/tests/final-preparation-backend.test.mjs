import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
Error.stackTraceLimit = 0;
const web = fileURLToPath(new URL("../", import.meta.url));
const output = await build({ absWorkingDir: web, stdin: { resolveDir: web, contents: `export * from './lib/backend/workspace'; export {createSeed} from './lib/title/model'; export {addPolicy} from './lib/title/business'; export * as FP from './lib/title/final-preparation'; export {captureCommands} from './lib/title/command-log';` }, bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const { executeCommands, normalizeWorkspace, projectWorkspace, emptyWorkspace, createSeed, addPolicy, FP, captureCommands } = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].contents).toString("base64"));
const owner = { userId: "00000000-0000-4000-8000-000000000001", email: "owner@example.test", role: "owner", companyIds: [], allCompanies: true, restricted: true, version: 1, partnerMembers: [] };
const command = (name, ...args) => ({ id: crypto.randomUUID(), name, args });
function fixture() {
  const s = normalizeWorkspace({ ...emptyWorkspace(), ...createSeed() }), order = s.orders.find(o => o.status !== "Issued" && o.status !== "Rejected");
  order.underwriter = "WFG"; s.user = "forged-local-user@example.test";
  return { s, order, input: FP.emptyFinalPreparation(s, order), snapshot: FP.finalPreparationSourceSnapshot(s, order), operations: { ...owner, email: "operator@example.test", role: "operations", allCompanies: false, companyIds: [order.companyId] } };
}
function save(f) { return command("saveFinalPreparation", f.order.id, f.input, 0, f.snapshot); }

test("scoped operator saves a draft through the real command path with server actor and no provider claim", () => {
  const f = fixture(), before = structuredClone(f.s), next = executeCommands(f.s, [save(f)], f.operations), result = next.orders.find(o => o.id === f.order.id);
  assert.equal(result.finalPreparation.status, "Draft"); assert.equal(result.finalPreparation.version, 1);
  assert.equal(result.finalPreparation.history[0].by, f.operations.email); assert.equal(result.companyId, f.order.companyId);
  assert.equal(result.status, f.order.status); assert.equal(result.delivered, f.order.delivered); assert.equal(result.finalPreparation.prepared, undefined);
  assert.deepEqual(f.s, before);
});
for (const role of ["onboarding", "finance", "viewer", "partner"]) test(`${role} cannot save preparation despite company scope`, () => {
  const f = fixture(); assert.throws(() => executeCommands(f.s, [save(f)], { ...f.operations, role }), error => error.status === 403);
});
test("cross-company operator cannot act on or read a worksheet", () => {
  const f = fixture(), wrong = { ...f.operations, companyIds: [f.s.companies.find(c => c.id !== f.order.companyId).id] };
  assert.throws(() => executeCommands(f.s, [save(f)], wrong), error => error.status === 403);
  const saved = executeCommands(f.s, [save(f)], owner);
  assert.equal(projectWorkspace(saved, wrong).orders.some(o => o.id === f.order.id), false);
});
test("referring and issuing companies must be visible even for draft decisions", () => {
  for (const field of ["referringCompanyId", "issuingCompanyId"]) {
    const f = fixture(); f.input[field] = f.s.companies.find(c => c.id !== f.order.companyId).id;
    assert.throws(() => executeCommands(f.s, [save(f)], f.operations), error => error.status === 403);
    const saved = executeCommands(f.s, [save(f)], owner);
    assert.equal(saved.orders.find(o => o.id === f.order.id).companyId, f.order.companyId);
    assert.equal(projectWorkspace(saved, f.operations).orders.some(o => o.id === f.order.id), false);
  }
});
test("worksheet cannot bind a policy from another file", () => {
  const f = fixture(); addPolicy(f.s, f.s.orders.find(o => o.id !== f.order.id && !["Issued", "Rejected"].includes(o.status)).id, "Owner");
  const other = f.s.business.policies.find(p => p.orderId !== f.order.id);
  assert.ok(other); f.input.products = [{ policyId: other.id, variant: "Standard", form: "Fixture form", endorsements: [], endorsementReviewNote: "Checked", reviewNote: "Checked" }];
  assert.throws(() => executeCommands(f.s, [save(f)], owner), /belonging to this title file/);
});
test("client-side capture generates only the supported command and server replays it", () => {
  const f = fixture(), client = structuredClone(f.s);
  const commands = captureCommands(client, draft => FP.saveFinalPreparation(draft, f.order.id, f.input, 0, f.snapshot));
  assert.equal(commands.length, 1); assert.equal(commands[0].name, "saveFinalPreparation");
  assert.equal(executeCommands(f.s, commands, owner).orders.find(o => o.id === f.order.id).finalPreparation.version, 1);
});
test("stale source and stale worksheet submissions reject without partial writes", () => {
  const f = fixture(), updated = structuredClone(f.s); updated.orders.find(o => o.id === f.order.id).fields[0].proposed += " changed";
  assert.throws(() => executeCommands(updated, [save(f)], owner), /changed/);
  const saved = executeCommands(f.s, [save(f)], owner);
  assert.throws(() => executeCommands(saved, [save(f)], owner), /changed/);
});
test("raw patches cannot forge preparation review or erase its history", () => {
  const f = fixture(), saved = executeCommands(f.s, [save(f)], owner), worksheet = saved.orders.find(o => o.id === f.order.id).finalPreparation;
  for (const value of [null, { ...worksheet, status: "Prepared" }, { ...worksheet, history: [] }])
    assert.throws(() => executeCommands(saved, [command("editDraft", [{ table: "orders", id: f.order.id, value: { finalPreparation: value } }])], owner), /Unsupported field/);
});
test("unknown command arguments cannot inject reviewer identities", () => {
  const f = fixture(), cmd = save(f); cmd.args.push("forged-reviewer@example.test");
  assert.throws(() => executeCommands(f.s, [cmd], owner), /Invalid final preparation arguments/);
});
test("missing vendor choices cannot be reviewed or prepared just because a draft exists", () => {
  const f = fixture(), saved = executeCommands(f.s, [save(f)], owner), order = saved.orders.find(o => o.id === f.order.id), snapshot = FP.finalPreparationSourceSnapshot(saved, order);
  assert.throws(() => executeCommands(saved, [command("reviewFinalPreparation", order.id, 1, snapshot, "Attempted approval")], owner), /authority|eligibility|policy products|confirm/i);
  assert.throws(() => executeCommands(saved, [command("prepareFinalHandoff", order.id, 1, snapshot)], owner), /Confirm/);
});
test("legacy snapshots without worksheet still load; malformed worksheet data is rejected", () => {
  const f = fixture(); assert.equal(normalizeWorkspace(f.s).orders.find(o => o.id === f.order.id).finalPreparation, undefined);
  for (const value of [null, {}, { version: 1, status: "Prepared", input: f.input, history: [] }]) {
    const bad = structuredClone(f.s); bad.orders.find(o => o.id === f.order.id).finalPreparation = value;
    assert.throws(() => normalizeWorkspace(bad), /Invalid final preparation worksheet/);
  }
});


test("new intake snapshot inventory matches canonical and operations projections despite unrelated agency records", () => {
  const f = fixture();
  f.s.documents.push({ id: "legacy-agency-document", companyId: f.order.companyId, orderId: f.order.id, name: "Company application.pdf", category: "Applications", visibility: "Internal", version: 1, date: "2026-09-24", size: "20 B", assetId: "private-application", mime: "application/pdf" });
  f.s.inbox.push({ id: "legacy-agency-message", companyId: f.order.companyId, orderId: f.order.id, kind: "Company", from: "Person", email: "person@example.test", subject: "Company review", body: "Agency-only message", time: "2026-09-24", attachments: [], status: "New", missive: { organizationId: "org", messageId: "agency-message", fingerprint: "a".repeat(64), sourceDocumentId: "agency-source" } });
  const projected = projectWorkspace(f.s, f.operations), visibleOrder = projected.orders.find(o => o.id === f.order.id);
  assert.ok(visibleOrder);
  assert.equal(FP.finalPreparationSourceSnapshot(f.s, f.order), FP.finalPreparationSourceSnapshot(projected, visibleOrder));
});
