// Actual domain and backend command/projection code; isolated fictional state.
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ absWorkingDir: root, write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  stdin: { resolveDir: root, contents: "export {emptyWorkspace,executeCommands,projectWorkspace} from './lib/backend/workspace';export {createSeed} from './lib/title/model';export * as P from './lib/title/production';" } });
const { emptyWorkspace, executeCommands, projectWorkspace, createSeed, P } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));
const owner = { userId: crypto.randomUUID(), email: "qa-owner@example.test", role: "owner", allCompanies: true, companyIds: [], restricted: true, version: 1, partnerMembers: [] };
const command = (name, ...args) => ({ id: crypto.randomUUID(), name, args });
function fixture() {
  const s = emptyWorkspace(), seed = createSeed(); s.companies = seed.companies.slice(0, 2);
  const order = structuredClone(seed.orders.find(o => o.companyId === s.companies[0].id));
  order.status = "Needs review"; order.fields = []; order.type = "Purchase"; order.production = { ...P.titleFile(order), version: 1 };
  s.orders = [order];
  const doc = { id: "qa-evidence-source", companyId: order.companyId, orderId: order.id, assetId: "qa-original-bytes", name: "Fictional deed.pdf", mime: "application/pdf", sourceRole: "Deed", version: 2, category: "Policy documents", visibility: "Internal", date: "2026-09-23", size: "1 KB" };
  s.documents = [doc];
  const values = Object.fromEntries(P.neededFields(order).filter(f => f.role === "Deed").map(f => [f.id, "Manually checked " + f.id]));
  values.name = "Cedar Example, LLC";
  const context = { documentVersion: doc.version, assetId: doc.assetId, sourceRole: doc.sourceRole, orderVersion: 1,
    fields: { name: { page: "PDF page 2 · OCR 0°", method: "ocr", quote: "Grantee: Cedar Example", suggestedValue: "Cedar Example", engineConfidence: 91 } } };
  return { s, order, doc, values, context };
}
const capture = f => command("replaceSourceFields", f.order.id, f.doc.id, f.values, "PDF pages 1–2", f.context);
test("assisted capture persists exact suggestion, correction, page and version without approving fields", () => {
  const f = fixture(), next = executeCommands(f.s, [capture(f)], owner), o = next.orders[0], field = o.fields.find(f => f.id === "name");
  assert.equal(field.sourceValue, "Cedar Example, LLC"); assert.equal(field.sourcePage, "PDF page 2 · OCR 0°");
  assert.deepEqual(field.captureEvidence, { documentVersion: 2, method: "ocr", quote: "Grantee: Cedar Example", suggestedValue: "Cedar Example", corrected: true, engineConfidence: 91 });
  assert.ok(o.fields.every(f => !f.reviewed)); assert.equal(o.client, f.order.client); assert.equal(P.titleFile(o).loanAmount, P.titleFile(f.order).loanAmount);
  assert.equal(P.titleFile(o).version, 2); assert.equal(o.status, "Needs review"); assert.equal(f.s.orders[0].fields.length, 0);
});
test("unchanged suggested wording records no correction", () => {
  const f = fixture(); f.values.name = "Cedar Example";
  assert.equal(executeCommands(f.s, [capture(f)], owner).orders[0].fields.find(f => f.id === "name").captureEvidence.corrected, false);
});
for (const [key, value] of [["documentVersion", 1], ["assetId", "stale-asset"], ["sourceRole", "Mortgage"], ["orderVersion", 0]])
  test(`stale ${key} rejects assisted and manual form capture atomically`, () => {
    const f = fixture(), before = structuredClone(f.s); f.context[key] = value;
    assert.throws(() => executeCommands(f.s, [capture(f)], owner), /changed after capture/); assert.deepEqual(f.s, before);
  });
test("a newly uploaded version prevents capture from the superseded source", () => {
  const f = fixture(); f.s.documents.push({ ...f.doc, id: "qa-current-source", assetId: "qa-new-bytes", version: 3 });
  assert.throws(() => executeCommands(f.s, [capture(f)], owner), /superseded/);
  assert.throws(() => P.replaceSourceFields(f.s, f.order.id, f.doc.id, f.values, "page 2"), /superseded/);
});
for (const [name, mutate] of [
  ["non-source quotation", e => { e.quote = "Different wording"; }],
  ["oversized quotation", e => { e.quote = "Cedar Example" + "x".repeat(2001); }],
  ["invalid confidence", e => { e.engineConfidence = 101; }],
  ["invented reading method", e => { e.method = "verified-ai"; }],
  ["missing page", e => { e.page = ""; }],
]) test(`${name} cannot enter saved capture evidence`, () => {
  const f = fixture(); mutate(f.context.fields.name); assert.throws(() => executeCommands(f.s, [capture(f)], owner), /exact suggested wording/);
});
test("evidence cannot introduce a field belonging to another source type", () => {
  const f = fixture(); f.context.fields.loanAmount = f.context.fields.name;
  assert.throws(() => executeCommands(f.s, [capture(f)], owner), /belong to this source/);
});
test("draft field edits cannot omit, replace or rewrite saved extraction evidence", () => {
  const f = fixture(), captured = executeCommands(f.s, [capture(f)], owner);
  for (const action of ["omit", "replace", "change"]) {
    const fields = structuredClone(captured.orders[0].fields), field = fields.find(f => f.id === "name");
    if (action === "omit") delete field.captureEvidence;
    if (action === "replace") field.captureEvidence = null;
    if (action === "change") field.captureEvidence.quote = "Rewritten history";
    assert.throws(() => executeCommands(captured, [command("editDraft", [{ table: "orders", id: f.order.id, value: { fields } }])], owner), /Source identity/);
  }
});
test("legacy source evidence also cannot be omitted during a draft edit", () => {
  const f = fixture(); P.replaceSourceFields(f.s, f.order.id, f.doc.id, f.values, "page 2");
  const fields = structuredClone(f.s.orders[0].fields); delete fields[0].sourcePage;
  assert.throws(() => executeCommands(f.s, [command("editDraft", [{ table: "orders", id: f.order.id, value: { fields } }])], owner), /Source identity/);
});
test("cross-company accounts cannot capture or read another company's extraction evidence", () => {
  const f = fixture(), scoped = { ...owner, role: "operations", allCompanies: false, companyIds: [f.s.companies[1].id] };
  assert.throws(() => executeCommands(f.s, [capture(f)], scoped), /outside your access|outside.*scope/);
  const next = executeCommands(f.s, [capture(f)], owner); assert.equal(projectWorkspace(next, scoped).orders.length, 0);
});
