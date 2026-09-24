import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
Error.stackTraceLimit = 0;
const web = fileURLToPath(new URL("../", import.meta.url));
const output = await build({ absWorkingDir: web, stdin: { resolveDir: web, contents: `export * from './lib/backend/workspace'; export {createSeed} from './lib/title/model'; export * as P from './lib/title/production'; export * from './lib/title/field-review-history';` }, bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const { executeCommands, normalizeWorkspace, projectWorkspace, emptyWorkspace, createSeed, P, recordFieldReviewChanges, fieldReviewHistoryShapeValid } = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].contents).toString("base64"));
const owner = { userId: crypto.randomUUID(), email: "reviewer@example.test", role: "owner", companyIds: [], allCompanies: true, restricted: true, version: 1, partnerMembers: [] };
const command = (name, ...args) => ({ id: crypto.randomUUID(), name, args });
const edit = (id, value) => command("editDraft", [{ table: "orders", id, value }]);
function fixture() {
  const s = normalizeWorkspace({ ...emptyWorkspace(), ...createSeed() }), order = s.orders[0];
  order.fields.forEach(field => { field.reviewed = false; });
  return { s, order, doc: s.documents.find(doc => doc.id === order.fields[0].documentId) };
}
test("correction and subsequent review retain prior value and exact source identity", () => {
  const { s, order, doc } = fixture(), fields = structuredClone(order.fields), previous = fields[0].proposed;
  fields[0].proposed = "Corrected fictional vesting";
  const corrected = executeCommands(s, [edit(order.id, { fields })], owner), current = corrected.orders[0];
  assert.equal(current.fieldReviewHistory.length, 1);
  assert.deepEqual(Object.fromEntries(["kind", "before", "value", "documentId", "documentVersion", "by"].map(key => [key, current.fieldReviewHistory[0][key]])), { kind: "Correction", before: previous, value: "Corrected fictional vesting", documentId: doc.id, documentVersion: doc.version, by: owner.email });
  fields[0].reviewed = true;
  const reviewed = executeCommands(corrected, [edit(order.id, { fields })], owner).orders[0];
  assert.equal(reviewed.fieldReviewHistory.length, 2); assert.equal(reviewed.fieldReviewHistory[1].kind, "Review");
  assert.deepEqual(reviewed.fieldReviewHistory[0], current.fieldReviewHistory[0]); assert.equal(s.orders[0].fieldReviewHistory, undefined);
});
test("assisted capture keeps the candidate, correction and quote after later recapture", () => {
  const { s, order, doc } = fixture();
  const defs = P.neededFields(order).filter(field => field.role === doc.sourceRole), values = Object.fromEntries(defs.map(field => [field.id, "Checked " + field.id]));
  const context = { documentVersion: doc.version, assetId: doc.assetId || "", sourceRole: doc.sourceRole, orderVersion: P.titleFile(order).version, fields: { [defs[0].id]: { page: "PDF page 1", method: "ocr", quote: "Grantee: Candidate Example", suggestedValue: "Candidate Example", engineConfidence: 92 } } };
  const first = executeCommands(s, [command("replaceSourceFields", order.id, doc.id, values, "PDF page 1", context)], owner);
  const event = first.orders[0].fieldReviewHistory.find(row => row.fieldId === defs[0].id);
  assert.equal(event.suggestedValue, "Candidate Example"); assert.equal(event.value, values[defs[0].id]); assert.equal(event.quote, "Grantee: Candidate Example"); assert.equal(event.method, "ocr");
  const secondValues = { ...values, [defs[0].id]: "Second reviewed value" };
  const next = executeCommands(first, [command("replaceSourceFields", order.id, doc.id, secondValues, "PDF page 1")], owner);
  assert.deepEqual(next.orders[0].fieldReviewHistory.find(row => row.id === event.id), event);
  assert.equal(next.orders[0].fieldReviewHistory.at(-1).value, "Second reviewed value");
  assert.ok(next.orders[0].fields.every(field => !field.reviewed));
});
test("unrelated edits do not invent correction history", () => {
  const { s, order } = fixture();
  const next = executeCommands(s, [edit(order.id, { notes: "File note" })], owner);
  assert.equal(next.orders[0].fieldReviewHistory, undefined);
});
test("submitted history cannot replace the server-generated audit", () => {
  const { s, order } = fixture(), fields = structuredClone(order.fields); fields[0].proposed = "Changed";
  const next = executeCommands(s, [edit(order.id, { fields })], owner);
  assert.throws(() => executeCommands(next, [edit(order.id, { fieldReviewHistory: [] })], owner), /Unsupported field/);
  const changed = structuredClone(next); changed.orders[0].fieldReviewHistory[0].by = "forged@example.test";
  assert.throws(() => recordFieldReviewChanges(next, changed, owner.email), /cannot be edited/);
});
test("company scoping includes correction evidence and legacy snapshots remain valid", () => {
  const { s, order } = fixture(), fields = structuredClone(order.fields); fields[0].proposed = "Private corrected wording";
  const next = executeCommands(s, [edit(order.id, { fields })], owner);
  const other = { ...owner, role: "operations", allCompanies: false, companyIds: [s.companies.find(c => c.id !== order.companyId).id] };
  assert.doesNotMatch(JSON.stringify(projectWorkspace(next, other)), /Private corrected wording/);
  assert.equal(fieldReviewHistoryShapeValid(undefined), true); assert.equal(fieldReviewHistoryShapeValid([]), true);
  for (const bad of [null, [{}], [next.orders[0].fieldReviewHistory[0], next.orders[0].fieldReviewHistory[0]]]) assert.equal(fieldReviewHistoryShapeValid(bad), false);
});

test("one change that corrects and reviews records both human actions", () => {
  const { s, order } = fixture(), fields = structuredClone(order.fields);
  fields[0].proposed = "Corrected and checked"; fields[0].reviewed = true;
  const next = executeCommands(s, [edit(order.id, { fields })], owner).orders[0];
  assert.deepEqual(next.fieldReviewHistory.map(row => row.kind), ["Correction", "Review"]);
  assert.ok(next.fieldReviewHistory.every(row => row.value === "Corrected and checked" && row.by === owner.email));
});
