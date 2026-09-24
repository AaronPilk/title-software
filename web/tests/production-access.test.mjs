import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const output = await build({ stdin: { contents: `export * from './lib/backend/workspace'; export * from './lib/title/workspace-view'; export * as B from './lib/title/business'; export * as O from './lib/title/ownership-history'; export * as M from './lib/title/materials';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, platform: "node", format: "esm" });
const { emptyWorkspace, executeCommands, projectWorkspace, allowedAsset, accessibleWorkspaceLocation, pageVisibleInWorkspace, B, O, M } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`);
const owner = { userId: crypto.randomUUID(), email: "owner@example.test", role: "owner", allCompanies: true, companyIds: [], restricted: true, version: 1, partnerMembers: [] };
const operations = (extra = {}) => ({ ...owner, userId: crypto.randomUUID(), email: "operations@example.test", role: "operations", allCompanies: false, companyIds: ["A"], ...extra });
const cmd = (name, ...args) => ({ id: crypto.randomUUID(), name, args });
const edit = (table, id, value, insert = false) => cmd("editDraft", [{ table, id, value, insert }]);
function fixture() {
  const s = emptyWorkspace(owner.email);
  s.companies = ["A", "B"].map(id => ({ id, name: `Fictional company ${id}`, initials: id, color: "blue", contact: "AGENCY_PRIVATE contact", email: "agency-private@example.test", location: "Charlotte", jurisdiction: "NC", formationState: "DE", operatingStates: ["NC"], stage: "Onboarding", steps: [true, false], members: [{ name: "AGENCY_PRIVATE member", share: 100, email: "agency-private-member@example.test", phone: "5550100000" }], authorizations: [{ state: "NC", kind: "AGENCY_PRIVATE authority", status: "Review", reference: "AGENCY_PRIVATE reference", reviewer: owner.email }] }));
  s.orders = ["A", "B"].map(companyId => ({ id: `FILE-${companyId}`, companyId, address: `Fictional property ${companyId}`, client: "Fictional buyer", type: "Purchase", underwriter: "WFG", owner: operations().email, jurisdiction: "NC", delivered: false, remitted: false, status: "New", due: "2026-12-01", premium: 1000, rate: .4, month: "2026-12", fields: [], notes: "File notes", exception: "" }));
  s.documents = [
    { id: "production-doc", companyId: "A", orderId: "FILE-A", category: "Policy documents", name: "Recorded source.txt", text: "PRODUCTION_SOURCE" },
    { id: "agency-doc", companyId: "A", category: "Company records", name: "AGENCY_PRIVATE ownership.txt", text: "AGENCY_PRIVATE original" },
    { id: "misrouted-application", companyId: "A", orderId: "FILE-A", category: "Applications", name: "AGENCY_PRIVATE application.txt", text: "AGENCY_PRIVATE application" },
  ].map(d => ({ ...d, assetId: `${d.id}-asset`, visibility: "Internal", version: 1, date: "2026-09-01", size: "20 B" }));
  s.inbox = [
    { id: "production-mail", companyId: "A", orderId: "FILE-A", kind: "Finals", subject: "Finals received", body: "PRODUCTION_MESSAGE" },
    { id: "agency-mail", companyId: "A", orderId: "", kind: "Company", subject: "AGENCY_PRIVATE application", body: "AGENCY_PRIVATE mail" },
    { id: "misrouted-company-mail", companyId: "A", orderId: "FILE-A", kind: "Company", subject: "AGENCY_PRIVATE owners", body: "AGENCY_PRIVATE misrouted mail" },
  ].map(m => ({ ...m, from: "Fictional sender", email: "sender@example.test", time: "2026-09-01", status: "New", documentIds: [], attachments: [] }));
  s.tasks = [
    { id: "production-task", scope: "production", title: "Review file" },
    { id: "agency-task", scope: "agency", title: "AGENCY_PRIVATE financial interests" },
    { id: "legacy-task", title: "AGENCY_PRIVATE unclassified task", assigneeId: owner.userId },
    { id: "auto-rejected-FILE-A", title: "Review rejected order FILE-A" },
  ].map(t => ({ ...t, companyId: "A", owner: "operations@example.test", due: "2026-12-01", done: false, priority: "Normal" }));
  const company = s.companies[0];
  B.getOnboarding(s, company).applicationNote = "AGENCY_PRIVATE onboarding";
  B.saveCredential(s, { id: "agency-credential", companyId: "A", state: "NC", kind: "Agency license", underwriter: "", holder: "AGENCY_PRIVATE holder", identifier: "AGENCY_PRIVATE credential", reference: "AGENCY_PRIVATE evidence", expiresOn: "", reviewOn: "", status: "Needs review", reviewer: owner.email });
  O.recordOwnership(s, "A", { effectiveFrom: "2026-01-01", members: company.members.map(({ name, share }) => ({ name, share })), reason: "AGENCY_PRIVATE ownership history" });
  M.createMaterial(s, { companyId: "A", kind: "Company agreement", title: "AGENCY_PRIVATE agreement", owner: owner.email, brief: "AGENCY_PRIVATE terms" });
  s.expenses = { "2026-09:A": 12345 };
  s.approvedReports = ["AGENCY_PRIVATE close approval"];
  s.expansionStates = ["SC"];
  return s;
}

for (const restricted of [false, true]) test(`operations projection removes agency data even with restricted=${restricted}`, () => {
  const s = fixture(), original = structuredClone(s), a = operations({ restricted });
  const projected = projectWorkspace(s, a);
  assert.deepEqual(projected.companies.map(c => c.id), ["A"]);
  assert.deepEqual(projected.orders.map(o => o.id), ["FILE-A"]);
  assert.deepEqual(projected.documents.map(d => d.id), ["production-doc"]);
  assert.deepEqual(projected.inbox.map(m => m.id), ["production-mail"]);
  assert.deepEqual(projected.tasks.map(t => t.id).sort(), ["auto-rejected-FILE-A", "production-task"]);
  assert.deepEqual(projected.companies[0].members, []);
  assert.deepEqual(projected.companies[0].steps, []);
  for (const field of ["intake", "formationState", "authorizations", "operatingStatus"]) assert.equal(field in projected.companies[0], false);
  assert.equal(projected.companies[0].contact, "");
  assert.deepEqual(projected.business.onboarding, []);
  assert.deepEqual(projected.business.credentials, []);
  assert.deepEqual(projected.materials, { version: 1, items: [], publications: [] });
  assert.deepEqual(projected.ownershipHistory, []);
  assert.deepEqual(projected.expenses, {});
  assert.doesNotMatch(JSON.stringify(projected), /AGENCY_PRIVATE|agency-private/);
  assert.equal(allowedAsset(s, a, "agency-doc-asset"), undefined);
  assert.equal(allowedAsset(s, a, "misrouted-application-asset"), undefined);
  assert.equal(allowedAsset(s, a, "production-doc-asset").id, "production-doc");
  assert.deepEqual(s, original);
});

test("owner and admin keep authorized agency details in either view while operations company scope remains authoritative", () => {
  const s = fixture();
  for (const role of ["owner", "admin"]) {
    const projected = projectWorkspace(s, { ...owner, role });
    assert.match(JSON.stringify(projected), /AGENCY_PRIVATE/);
    for (const view of ["agency", "production"]) assert.deepEqual(accessibleWorkspaceLocation({ view, page: "Tasks" }, role), { view, page: "Tasks" });
    assert(pageVisibleInWorkspace("Onboarding", role));
  }
  assert.deepEqual(projectWorkspace(s, operations({ companyIds: [] })).companies, []);
  assert.deepEqual(projectWorkspace(s, operations({ allCompanies: true })).companies.map(c => c.id), ["A", "B"]);
  assert.deepEqual(accessibleWorkspaceLocation({ view: "agency", page: "Onboarding" }, "operations"), { view: "production", page: "Overview" });
});

test("operations writes are confined to production records and cannot relabel hidden agency evidence", () => {
  const s = fixture(), original = structuredClone(s), a = operations();
  for (const command of [
    edit("companies", "A", { contact: "Changed" }),
    edit("tasks", "agency-task", { done: true }),
    edit("tasks", "legacy-task", { scope: "production" }),
    edit("documents", "agency-doc", { visibility: "Restricted" }),
    edit("inbox", "agency-mail", { orderId: "FILE-A", kind: "Finals" }),
    edit("documents", "new-agency-doc", { ...s.documents[1], id: "new-agency-doc" }, true),
    edit("inbox", "new-agency-mail", { ...s.inbox[1], id: "new-agency-mail" }, true),
    edit("tasks", "new-agency-task", { ...s.tasks.find(t => t.id === "agency-task"), id: "new-agency-task" }, true),
    cmd("startWaiting", "agency-task", { reason: "Waiting on attorney", detail: "Review", since: "2026-09-01" }),
    cmd("recordOwnership", "A", { effectiveFrom: "2026-09-01", members: [{ name: "New owner", share: 100 }], reason: "Changed" }),
  ]) assert.throws(() => executeCommands(s, [command], a), e => e.status === 403, JSON.stringify(command));
  const updated = executeCommands(s, [edit("tasks", "production-task", { done: true }), edit("orders", "FILE-A", { notes: "Reviewed file" }), edit("inbox", "production-mail", { status: "Queued" })], a);
  assert.equal(updated.tasks.find(t => t.id === "production-task").done, true);
  assert.equal(updated.orders[0].notes, "Reviewed file");
  assert.deepEqual(updated.companies, s.companies);
  assert.deepEqual(updated.ownershipHistory, s.ownershipHistory);
  assert.deepEqual(s, original);
});

test("operations task creation stamps production and only an administrator may classify legacy tasks", () => {
  const s = fixture(), a = operations();
  const created = executeCommands(s, [edit("tasks", "new-production-task", { companyId: "A", title: "Review a file", owner: a.email, due: "2026-12-01", done: false, priority: "Normal" }, true)], a);
  assert.equal(created.tasks[0].scope, "production");
  assert(projectWorkspace(created, a).tasks.some(t => t.id === "new-production-task"));
  const classified = executeCommands(s, [edit("tasks", "legacy-task", { scope: "production", title: "Reviewed and approved for production" })], owner);
  assert(projectWorkspace(classified, a).tasks.some(t => t.id === "legacy-task"));
});

test("production snapshots depending on hidden agency evidence are withheld and cannot be used by commands", () => {
  const s = fixture(), a = operations({ restricted: true });
  s.orders[0].notes = JSON.stringify({ sourceDocumentId: "agency-doc", captured: "AGENCY_PRIVATE original" });
  const projected = projectWorkspace(s, a);
  assert.deepEqual(projected.orders, []);
  assert.deepEqual(projected.documents, []);
  assert.deepEqual(projected.inbox, []);
  assert(!projected.tasks.some(t => t.id === "auto-rejected-FILE-A"));
  assert.throws(() => executeCommands(s, [edit("orders", "FILE-A", { notes: "Clear private evidence" })], a), e => e.status === 403);
});
