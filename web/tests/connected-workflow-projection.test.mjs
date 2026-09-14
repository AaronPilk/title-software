import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  emptyWorkspace,
  executeCommands,
  normalizeWorkspace,
  projectWorkspace,
  D,
  T,
  O,
} from "../.local-test/backend/api.mjs";

const owner = {
  userId: "projection-owner", email: "owner@example.com", role: "owner",
  allCompanies: true, companyIds: [], restricted: true, version: 1, partnerMembers: [],
};
const scoped = (more = {}) => ({
  ...owner, userId: "projection-staff", email: "staff@example.com", role: "operations",
  allCompanies: false, companyIds: ["A"], restricted: false, ...more,
});
const command = (name, ...args) => ({ id: crypto.randomUUID(), name, args });
const taskEdit = () => command("editDraft", [{
  table: "tasks", id: "TASK-A", value: { title: "Reviewed task title" },
}]);
const recipient = (documentId, email = "recipient@example.com") => ({
  documentId, recipientName: "Synthetic recipient", recipientEmail: email,
  recipientRole: "Closing attorney", method: "Email", reviewNote: "Synthetic delivery review",
});
const company = (id) => ({
  id, name: `Company ${id}`, initials: id, color: "blue", contact: `Contact ${id}`,
  email: `company-${id.toLowerCase()}@example.com`, location: "Charlotte", jurisdiction: "NC",
  stage: "Onboarding", steps: [], members: [{ name: `Member ${id}`, share: 100 }],
});
const order = (id, companyId) => ({
  id, companyId, address: `Synthetic address ${id}`, client: "Synthetic client", type: "Purchase",
  underwriter: "WFG", owner: "Synthetic operator", jurisdiction: "NC", status: "New",
  due: "2026-12-01", premium: 100, rate: 0.4, month: "2026-12", fields: [], notes: "",
  exception: "", delivered: false, remitted: false,
});
const document = (id, companyId, orderId) => ({
  id, companyId, orderId, name: `${id}.txt`, category: "Other", visibility: "Internal",
  date: "2026-01-01", size: "20 B", version: 1, text: `Synthetic source ${id}`,
  sourceRole: "Other",
});
const task = (id, companyId) => ({
  id, companyId, title: `Synthetic task ${id}`, owner: "Synthetic operator", due: "2026-12-01",
  done: false, priority: "Normal", createdAt: "2026-01-01T12:00:00Z",
});
function fixture() {
  const s = emptyWorkspace(owner.email);
  s.companies = [company("A"), company("B")];
  s.orders = [order("ORDER-A", "A"), order("ORDER-A-PUBLIC", "A"), order("ORDER-B", "B")];
  s.documents = [
    document("DOC-A", "A", "ORDER-A"),
    document("DOC-A-PUBLIC", "A", "ORDER-A-PUBLIC"),
    document("DOC-B", "B", "ORDER-B"),
  ];
  s.tasks = [task("TASK-A", "A"), task("TASK-B", "B")];
  for (const id of ["A", "B"]) {
    T.startWaiting(s, `TASK-${id}`, {
      reason: "Waiting on attorney", detail: `WAITING-${id}-ONLY`, since: "2026-01-05",
    });
    O.recordOwnership(s, id, {
      effectiveFrom: "2026-01-01", members: [{ name: `Member ${id}`, share: 100 }],
      reason: `OWNERSHIP-${id}-ONLY`,
    });
  }
  const first = D.prepareDelivery(s, recipient("DOC-A"));
  D.recordDeliveryFailure(s, first.id, {
    failedOn: first.preparedAt.slice(0, 10), failureReason: "Synthetic failed first attempt",
  });
  const retry = D.retryDelivery(s, first.id, { recipientEmail: "", method: "", reviewNote: "Synthetic retry" });
  D.prepareDelivery(s, recipient("DOC-A-PUBLIC", "public@example.com"));
  D.prepareDelivery(s, recipient("DOC-B", "company-b@example.com"));
  return { s, firstId: first.id, retryId: retry.id };
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
const apiError = (status) => (error) => {
  assert(error instanceof ApiError, "Gateway errors must preserve the structured ApiError contract");
  assert.equal(error.status, status);
  return true;
};

test("legacy delivery and ownership arrays normalize on copies in projection and command execution", () => {
  const s = fixture().s;
  delete s.deliveries;
  delete s.ownershipHistory;
  const original = structuredClone(s);
  deepFreeze(s);
  const normalized = normalizeWorkspace(s);
  assert.deepEqual(normalized.deliveries, []);
  assert.deepEqual(normalized.ownershipHistory, []);
  const visible = projectWorkspace(s, owner);
  assert.deepEqual(visible.deliveries, []);
  assert.deepEqual(visible.ownershipHistory, []);
  const updated = executeCommands(s, [taskEdit()], owner);
  assert.deepEqual(updated.deliveries, []);
  assert.deepEqual(updated.ownershipHistory, []);
  assert.equal(updated.tasks[0].title, "Reviewed task title");
  assert.deepEqual(s, original);
  assert(!Object.hasOwn(s, "deliveries"));
  assert(!Object.hasOwn(s, "ownershipHistory"));
});

test("owner sees both company histories and scoped staff sees only its company and nested waiting", () => {
  const { s } = fixture();
  const all = projectWorkspace(s, owner);
  assert.equal(all.deliveries.length, 4);
  assert.deepEqual(all.ownershipHistory.map(r => r.companyId).sort(), ["A", "B"]);
  const visible = projectWorkspace(s, scoped());
  assert.equal(visible.deliveries.length, 3);
  assert(visible.deliveries.every(r => r.companyId === "A"));
  assert.deepEqual(visible.ownershipHistory.map(r => r.companyId), ["A"]);
  assert.deepEqual(visible.tasks.map(t => t.id), ["TASK-A"]);
  assert.deepEqual(visible.tasks[0].waiting, s.tasks[0].waiting);
  assert(!JSON.stringify(visible).includes("WAITING-B-ONLY"));
  assert(!JSON.stringify(visible).includes("OWNERSHIP-B-ONLY"));
  assert(!JSON.stringify(visible).includes("company-b@example.com"));
});

test("partner projection receives neither staff delivery nor ownership nor waiting history", () => {
  const { s } = fixture();
  const visible = projectWorkspace(s, scoped({
    role: "partner", partnerMembers: [{ id: "grant-A", companyId: "A", memberName: "Member A" }],
  }));
  assert.equal(visible.companies.length, 1);
  assert.deepEqual(visible.deliveries, []);
  assert.deepEqual(visible.ownershipHistory, []);
  assert.deepEqual(visible.tasks, []);
  assert(!JSON.stringify(visible).includes("Synthetic failed first attempt"));
  assert(!JSON.stringify(visible).includes("OWNERSHIP-A-ONLY"));
});

test("restricted file evidence withholds its delivery retry chain and nested task references only", () => {
  const { s, firstId, retryId } = fixture();
  s.documents.find(d => d.id === "DOC-A").visibility = "Restricted";
  s.tasks.push(task("TASK-A-RESTRICTED", "A"));
  T.startWaiting(s, "TASK-A-RESTRICTED", {
    reason: "Waiting on attorney", detail: "DOC-A", since: "2026-01-05",
  });
  const visible = projectWorkspace(s, scoped());
  assert(!visible.orders.some(o => o.id === "ORDER-A"));
  assert(!visible.deliveries.some(r => r.id === firstId || r.id === retryId));
  assert.deepEqual(visible.deliveries.map(r => r.documentId), ["DOC-A-PUBLIC"]);
  assert(!visible.tasks.some(t => t.id === "TASK-A-RESTRICTED"));
  assert(visible.tasks.some(t => t.id === "TASK-A" && t.waiting.length === 1));
  assert.equal(visible.ownershipHistory.length, 1);
  assert.equal(projectWorkspace(s, owner).deliveries.length, 4);
});

test("projected histories and accepted command inputs cannot mutate original workspace objects", () => {
  const { s } = fixture();
  const original = structuredClone(s);
  deepFreeze(s);
  const visible = projectWorkspace(s, scoped());
  visible.deliveries[0].recipientName = "Changed view only";
  visible.ownershipHistory[0].members[0].share = 1;
  visible.tasks[0].waiting[0].detail = "Changed view only";
  const commands = [command("prepareDelivery", recipient("DOC-A-PUBLIC", "another@example.com"))];
  const originalCommands = structuredClone(commands);
  deepFreeze(commands);
  const updated = executeCommands(s, commands, scoped());
  const created = updated.deliveries.find(r => r.recipientEmail === "another@example.com");
  assert.equal(created.preparedBy, "staff@example.com");
  assert.deepEqual(commands, originalCommands);
  assert.deepEqual(s, original);
  assert.notEqual(projectWorkspace(s, scoped()).deliveries[0].recipientName, "Changed view only");
});

test("same-company readable delivery is accepted while another-company document is denied", () => {
  const { s } = fixture();
  const updated = executeCommands(s, [command("prepareDelivery", recipient("DOC-A-PUBLIC", "new@example.com"))], scoped());
  assert(updated.deliveries.some(r => r.documentId === "DOC-A-PUBLIC" && r.recipientEmail === "new@example.com"));
  assert.throws(() => executeCommands(s, [command("prepareDelivery", recipient("DOC-B", "new@example.com"))], scoped()), apiError(403));
});

test("retry resolves a readable current version and denies a newly restricted replacement", () => {
  const { s, firstId, retryId } = fixture();
  s.deliveries = s.deliveries.filter(r => r.id !== retryId);
  const base = s.documents.find(d => d.id === "DOC-A");
  s.documents.push({ ...base, id: "DOC-A-V2", version: 2 });
  const retryCommand = command("retryDelivery", firstId, { recipientEmail: "", method: "", reviewNote: "Current copy checked" });
  const updated = executeCommands(s, [retryCommand], scoped());
  assert(updated.deliveries.some(r => r.previousDeliveryId === firstId && r.documentId === "DOC-A-V2"));
  s.documents.find(d => d.id === "DOC-A-V2").visibility = "Restricted";
  assert.throws(() => executeCommands(s, [retryCommand], scoped()), apiError(403));
});

for (const [name, corrupt] of [
  ["missing delivery company", s => { s.deliveries[0].companyId = "MISSING"; }],
  ["different delivery company", s => { s.deliveries[0].companyId = "B"; }],
  ["missing delivery order", s => { s.deliveries[0].orderId = "MISSING"; }],
  ["different delivery order", s => { s.deliveries[0].orderId = "ORDER-A-PUBLIC"; }],
  ["missing delivery document", s => { s.deliveries[0].documentId = "MISSING"; s.deliveries[0].snapshot.documentId = "MISSING"; }],
  ["different delivery document company", s => { s.deliveries[0].documentId = "DOC-B"; s.deliveries[0].snapshot.documentId = "DOC-B"; }],
  ["snapshot document identity mismatch", s => { s.deliveries[0].snapshot.documentId = "DOC-A-PUBLIC"; }],
  ["snapshot document version mismatch", s => { s.deliveries[0].snapshot.documentVersion = 999; }],
  ["orphan delivery retry", s => { s.deliveries[1].previousDeliveryId = "MISSING"; }],
  ["ownership record referencing missing company", s => { s.ownershipHistory[0].companyId = "MISSING"; }],
]) {
  test(`gateway rejects ${name} as a structured validation error without changing input`, () => {
    const { s } = fixture();
    corrupt(s);
    const original = structuredClone(s), commands = [taskEdit()];
    deepFreeze(s);
    deepFreeze(commands);
    assert.throws(() => normalizeWorkspace(s), apiError(400));
    assert.throws(() => executeCommands(s, commands, owner), apiError(400));
    assert.deepEqual(s, original);
  });
}

for (const name of ["deliveries", "ownershipHistory"]) {
  test(`malformed present ${name} is rejected instead of normalized away`, () => {
    const { s } = fixture();
    s[name] = { invalid: true };
    assert.throws(() => normalizeWorkspace(s), apiError(400));
    assert.throws(() => projectWorkspace(s, owner), apiError(400));
    assert.throws(() => executeCommands(s, [taskEdit()], owner), apiError(400));
    assert.deepEqual(s[name], { invalid: true });
  });
}

const reclassify = (s, documentId, sourceRole) => executeCommands(s, [command("editDraft", [{
  table: "documents", id: documentId, value: { sourceRole },
}])], scoped());
function uploadSecondVersion(s, sourceRole) {
  const { id, version, ...source } = s.documents.find(d => d.id === "DOC-A");
  return executeCommands(s, [command("editDraft", [{
    table: "documents", id: "DOC-A-V2", insert: true, value: { ...source, sourceRole },
  }])], scoped());
}
function failedFirstAttempt() {
  const { s, firstId, retryId } = fixture();
  s.deliveries = s.deliveries.filter(r => r.id !== retryId);
  return { s, firstId };
}
const retry = (s, firstId) => executeCommands(s, [command("retryDelivery", firstId, {
  recipientEmail: "", method: "", reviewNote: "Current version checked for this retry",
})], scoped());

for (const documentId of ["DOC-A", "DOC-A-V2"]) {
  test(`valid v1-to-v2 delivery history survives allowed output reclassification of ${documentId}`, () => {
    const first = failedFirstAttempt();
    const withV2 = uploadSecondVersion(first.s, "Other");
    const withRetry = retry(withV2, first.firstId);
    const histories = structuredClone(withRetry.deliveries);
    const changed = reclassify(withRetry, documentId, "Revised commitment");
    assert.equal(changed.documents.find(d => d.id === documentId).sourceRole, "Revised commitment");
    assert.deepEqual(changed.deliveries, histories);
    assert.deepEqual(normalizeWorkspace(changed).deliveries, histories);
    assert.equal(projectWorkspace(changed, scoped()).deliveries.length, 3);
    assert.equal(executeCommands(changed, [taskEdit()], scoped()).tasks[0].title, "Reviewed task title");
    const restoredRole = reclassify(changed, documentId, "Other");
    assert.deepEqual(restoredRole.deliveries, histories);
    assert.equal(withRetry.documents.find(d => d.id === documentId).sourceRole, "Other");
  });
}

test("same-document delivery retry snapshots survive output reclassification after preparation", () => {
  const { s } = fixture();
  const histories = structuredClone(s.deliveries);
  const changed = reclassify(s, "DOC-A", "Revised commitment");
  assert.deepEqual(normalizeWorkspace(changed).deliveries, histories);
  assert.deepEqual(changed.deliveries.filter(r => r.documentId === "DOC-A").map(r => r.snapshot.sourceRole), ["Other", "Other"]);
  assert.equal(projectWorkspace(changed, scoped()).deliveries.length, 3);
});

test("a new version and retry after failed-source reclassification retain their original captured roles", () => {
  const first = failedFirstAttempt();
  const changed = reclassify(first.s, "DOC-A", "Revised commitment");
  const withV2 = uploadSecondVersion(changed, "Revised commitment");
  const withRetry = retry(withV2, first.firstId);
  const firstRecord = withRetry.deliveries.find(r => r.id === first.firstId);
  const retryRecord = withRetry.deliveries.find(r => r.previousDeliveryId === first.firstId);
  assert.equal(firstRecord.snapshot.sourceRole, "Other");
  assert.equal(retryRecord.snapshot.sourceRole, "Revised commitment");
  assert.equal(retryRecord.documentId, "DOC-A-V2");
  const history = structuredClone(withRetry.deliveries);
  const reclassifiedAgain = reclassify(withRetry, "DOC-A", "Other");
  assert.deepEqual(normalizeWorkspace(reclassifiedAgain).deliveries, history);
  assert.equal(executeCommands(reclassifiedAgain, [taskEdit()], scoped()).tasks[0].title, "Reviewed task title");
});

const dayBefore = (timestamp) => new Date(Date.parse(timestamp) - 86_400_000).toISOString().slice(0, 10);
for (const [name, prepare, corrupt] of [
  ["recorded delivery date before preparation", "Recorded", r => { r.deliveredOn = dayBefore(r.preparedAt); }],
  ["recorded timestamp before preparation", "Recorded", r => { r.recordedAt = new Date(Date.parse(r.preparedAt) - 60_000).toISOString(); }],
  ["failed delivery date before preparation", "Failed", r => { r.failedOn = dayBefore(r.preparedAt); }],
  ["cancellation timestamp before preparation", "Cancelled", r => { r.cancelledAt = new Date(Date.parse(r.preparedAt) - 60_000).toISOString(); }],
]) {
  test(`restore normalization rejects ${name} before the workspace is used`, () => {
    const { s } = fixture();
    const record = s.deliveries.find(r => r.documentId === "DOC-A-PUBLIC");
    if (prepare === "Recorded") D.recordDelivery(s, record.id, {
      deliveredOn: record.preparedAt.slice(0, 10), deliveryReference: "Synthetic send receipt", deliveryNote: "",
    });
    else if (prepare === "Failed") D.recordDeliveryFailure(s, record.id, {
      failedOn: record.preparedAt.slice(0, 10), failureReason: "Synthetic bounce",
    });
    else D.cancelDelivery(s, record.id, "Synthetic cancellation");
    assert.doesNotThrow(() => normalizeWorkspace(s));
    corrupt(record);
    const original = structuredClone(s);
    deepFreeze(s);
    assert.throws(() => normalizeWorkspace(s), apiError(400));
    assert.throws(() => executeCommands(s, [taskEdit()], owner), apiError(400));
    assert.deepEqual(s, original);
  });
}
