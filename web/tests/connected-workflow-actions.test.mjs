import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  executeCommands,
  projectWorkspace,
  captureCommands,
  D,
  T,
  O,
  M,
} from "../.local-test/backend/api.mjs";

const NOW = "2026-09-14T12:00:00.000Z";
const DAY = "2026-09-14";
const SERVER_EMAIL = "operator@example.test";
const freezeTime = (t) => t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
const access = (role = "operations") => ({
  userId: "11111111-1111-4111-8111-111111111111",
  email: SERVER_EMAIL,
  role,
  allCompanies: false,
  companyIds: ["A"],
  restricted: false,
  version: 1,
  partnerMembers: [],
});

function fixture() {
  const s = emptyWorkspace("Fixture recorder");
  s.companies = ["A", "B"].map((id) => ({
    id, name: `Company ${id}`, initials: id, color: "blue",
    contact: "Test contact", email: "contact@example.test", location: "Charlotte",
    jurisdiction: "NC", stage: "Onboarding", steps: [],
    members: [{ name: "Member One", share: 100 }],
  }));
  s.orders = ["A", "B"].map((companyId) => ({
    id: `order-${companyId}`, companyId, address: `Test file ${companyId}`,
    client: "Test client", type: "Purchase", underwriter: "WFG", owner: "Test operator",
    jurisdiction: "NC", status: "New", due: DAY, premium: 100, rate: 0.4,
    month: "2026-09", fields: [], notes: "", exception: "", delivered: false, remitted: false,
  }));
  s.documents = ["A", "B"].map((companyId) => ({
    id: `doc-${companyId}`, companyId, orderId: `order-${companyId}`,
    name: `Reviewed source ${companyId}.txt`, category: "Other", visibility: "Internal",
    date: "2026-09-10", size: "24 B", version: 1, text: "Reviewed fixture evidence",
  }));
  s.tasks = ["A", "B"].map((companyId) => ({
    id: `task-${companyId}`, companyId, title: `Review file ${companyId}`,
    owner: "Assigned operator", due: DAY, done: false, priority: "Normal",
    createdAt: "2026-09-10T12:00:00.000Z",
  }));
  s.deliveries = [];
  s.ownershipHistory = [];
  return s;
}

const deliveryInput = (more = {}) => ({
  documentId: "doc-A", recipientName: "Reviewed Recipient",
  recipientEmail: "recipient@example.test", recipientRole: "Lender", method: "Email",
  reviewNote: "Recipient and exact source version reviewed", ...more,
});
const waitingInput = { reason: "Waiting on attorney", detail: "Requested reviewed clarification", since: "2026-09-12" };
const ownershipInput = {
  effectiveFrom: "2026-09-01", members: [{ name: "Member One", share: 100 }],
  reason: "Reviewed opening ownership evidence",
};
const receiptInput = { deliveredOn: DAY, deliveryReference: "Reviewed manual receipt 001", deliveryNote: "Recipient acknowledged this version" };
const failureInput = { failedOn: DAY, failureReason: "Reviewed failed-delivery notice" };
const retryInput = { recipientEmail: "corrected@example.test", method: "Secure portal", reviewNote: "Corrected destination reviewed" };

function capture(s, a, fn) {
  const draft = projectWorkspace(s, a);
  // Browser persona must never become the authoritative recorded actor.
  draft.user = "Browser persona";
  const commands = captureCommands(draft, fn);
  assert.ok(commands.length > 0);
  return { commands, draft };
}
function replay(s, a, fn, name) {
  const before = structuredClone(s);
  const { commands, draft } = capture(s, a, fn);
  assert.deepEqual(commands.map((c) => c.name), [name]);
  const next = executeCommands(s, commands, a);
  assert.deepEqual(s, before, "execution must not mutate the canonical input");
  return { next, visible: projectWorkspace(next, a), draft, commands };
}

test("connected waiting commands preserve IDs and authoritative actors through save and projection", (t) => {
  freezeTime(t);
  const a = access("finance");
  const started = replay(fixture(), a, (s) => T.startWaiting(s, "task-A", waitingInput), "startWaiting");
  const period = started.visible.tasks[0].waiting[0];
  assert.equal(period.id, started.draft.tasks[0].waiting[0].id);
  assert.equal(period.by, SERVER_EMAIL);
  assert.equal(period.since, waitingInput.since);
  assert.equal(started.next.tasks.find((x) => x.id === "task-B").waiting, undefined);
  const saved = JSON.parse(JSON.stringify(started.next));
  const finished = replay(saved, a, (s) => T.resolveWaiting(s, "task-A", { until: DAY, resolution: "Reviewed clarification received" }), "resolveWaiting");
  assert.equal(finished.visible.tasks[0].waiting[0].resolvedBy, SERVER_EMAIL);
  assert.equal(finished.visible.tasks[0].waiting[0].by, SERVER_EMAIL);
  assert.equal(finished.visible.tasks[0].waiting[0].id, period.id);
  assert.equal(finished.visible.tasks[0].waiting[0].until, DAY);
});

test("connected ownership recording uses reviewed effective dates and the server actor", (t) => {
  freezeTime(t);
  const result = replay(fixture(), access("onboarding"), (s) => O.recordOwnership(s, "A", ownershipInput), "recordOwnership");
  assert.equal(result.visible.ownershipHistory.length, 1);
  const recorded = result.visible.ownershipHistory[0];
  assert.equal(recorded.id, result.draft.ownershipHistory[0].id);
  assert.equal(recorded.companyId, "A");
  assert.equal(recorded.effectiveFrom, ownershipInput.effectiveFrom);
  assert.deepEqual(recorded.members, ownershipInput.members);
  assert.equal(recorded.recordedBy, SERVER_EMAIL);
  assert.equal(recorded.recordedAt, NOW);
});

test("connected delivery preparation and receipt preserve recipient, version, IDs, and server attribution", (t) => {
  freezeTime(t);
  const a = access();
  const prepared = replay(fixture(), a, (s) => D.prepareDelivery(s, deliveryInput()), "prepareDelivery");
  const record = prepared.visible.deliveries[0];
  assert.equal(record.id, prepared.draft.deliveries[0].id);
  assert.equal(record.preparedBy, SERVER_EMAIL);
  assert.equal(record.preparedAt, NOW);
  assert.equal(record.snapshot.documentId, "doc-A");
  assert.equal(record.snapshot.documentVersion, 1);
  assert.equal(record.recipientEmail, deliveryInput().recipientEmail);
  const saved = JSON.parse(JSON.stringify(prepared.next));
  const received = replay(saved, a, (s) => D.recordDelivery(s, record.id, receiptInput), "recordDelivery");
  assert.equal(received.visible.deliveries[0].status, "Recorded");
  assert.equal(received.visible.deliveries[0].recordedBy, SERVER_EMAIL);
  assert.equal(received.visible.deliveries[0].recordedAt, NOW);
  assert.equal(received.visible.deliveries[0].deliveryReference, receiptInput.deliveryReference);
  assert.equal(received.visible.deliveries[0].deliveredOn, DAY);
});

test("connected delivery failure, retry, and cancellation retain the original immutable attempt", (t) => {
  freezeTime(t);
  const a = access();
  const prepared = replay(fixture(), a, (s) => D.prepareDelivery(s, deliveryInput()), "prepareDelivery");
  const firstId = prepared.visible.deliveries[0].id;
  const failed = replay(prepared.next, a, (s) => D.recordDeliveryFailure(s, firstId, failureInput), "recordDeliveryFailure");
  assert.equal(failed.visible.deliveries[0].failedBy, SERVER_EMAIL);
  assert.equal(failed.visible.deliveries[0].status, "Failed");
  const original = structuredClone(failed.visible.deliveries[0]);
  const retried = replay(failed.next, a, (s) => D.retryDelivery(s, firstId, retryInput), "retryDelivery");
  const second = retried.visible.deliveries.find((r) => r.previousDeliveryId === firstId);
  assert.equal(second.id, retried.draft.deliveries.find((r) => r.previousDeliveryId === firstId).id);
  assert.equal(second.attempt, 2);
  assert.equal(second.preparedBy, SERVER_EMAIL);
  assert.equal(second.recipientEmail, retryInput.recipientEmail);
  assert.deepEqual(retried.visible.deliveries.find((r) => r.id === firstId), original);
  const cancelled = replay(retried.next, a, (s) => D.cancelDelivery(s, second.id, "Recipient requested a different approved channel"), "cancelDelivery");
  const last = cancelled.visible.deliveries.find((r) => r.id === second.id);
  assert.equal(last.status, "Cancelled");
  assert.equal(last.cancelledBy, SERVER_EMAIL);
  assert.equal(last.cancelledAt, NOW);
  assert.deepEqual(cancelled.visible.deliveries.find((r) => r.id === firstId), original);
});

function actionCase(name) {
  const state = fixture();
  if (name === "startWaiting") return { state, fn: (s) => T.startWaiting(s, "task-A", waitingInput) };
  if (name === "resolveWaiting") {
    T.startWaiting(state, "task-A", waitingInput);
    return { state, fn: (s) => T.resolveWaiting(s, "task-A", { until: DAY, resolution: "Reviewed clarification received" }) };
  }
  if (name === "recordOwnership") return { state, fn: (s) => O.recordOwnership(s, "A", ownershipInput) };
  if (name === "prepareDelivery") return { state, fn: (s) => D.prepareDelivery(s, deliveryInput()) };
  const prepared = D.prepareDelivery(state, deliveryInput());
  if (name === "recordDelivery") return { state, fn: (s) => D.recordDelivery(s, prepared.id, receiptInput) };
  if (name === "recordDeliveryFailure") return { state, fn: (s) => D.recordDeliveryFailure(s, prepared.id, failureInput) };
  if (name === "cancelDelivery") return { state, fn: (s) => D.cancelDelivery(s, prepared.id, "Reviewed cancellation request") };
  D.recordDeliveryFailure(state, prepared.id, failureInput);
  return { state, fn: (s) => D.retryDelivery(s, prepared.id, retryInput) };
}
const actionRoles = {
  startWaiting: ["operations", "onboarding", "finance", "owner", "admin"],
  resolveWaiting: ["operations", "onboarding", "finance", "owner", "admin"],
  recordOwnership: ["onboarding", "owner", "admin"],
  prepareDelivery: ["operations", "owner", "admin"],
  recordDelivery: ["operations", "owner", "admin"],
  recordDeliveryFailure: ["operations", "owner", "admin"],
  retryDelivery: ["operations", "owner", "admin"],
  cancelDelivery: ["operations", "owner", "admin"],
};
const allRoles = ["operations", "onboarding", "finance", "owner", "admin", "viewer", "partner"];

for (const [name, permitted] of Object.entries(actionRoles)) {
  test(`connected ${name} enforces its role contract`, (t) => {
    freezeTime(t);
    for (const role of allRoles) {
      const { state, fn } = actionCase(name);
      // Capture through an authorized staff projection, then independently check the server role.
      const { commands } = capture(state, access("owner"), fn);
      if (permitted.includes(role)) {
        const next = executeCommands(state, commands, access(role));
        const visible = projectWorkspace(next, access(role));
        assert.deepEqual(visible.companies.map((c) => c.id), ["A"], `${name}/${role} company scope`);
      } else {
        assert.throws(() => executeCommands(state, commands, access(role)), (error) => error.status === 403, `${name}/${role} must be forbidden`);
      }
    }
  });
}

test("connected workflow commands reject extra arguments and undeclared input keys", (t) => {
  freezeTime(t);
  for (const name of Object.keys(actionRoles)) {
    const { state, fn } = actionCase(name);
    const { commands } = capture(state, access("owner"), fn);
    const extraArgument = structuredClone(commands);
    extraArgument[0].args.push(NOW);
    assert.throws(() => executeCommands(state, extraArgument, access("owner")), (error) => error.status === 400, `${name} extra argument`);
    const inputIndex = name === "prepareDelivery" ? 0 : name === "cancelDelivery" ? null : 1;
    if (inputIndex !== null) {
      const extraKey = structuredClone(commands);
      extraKey[0].args[inputIndex].recordedBy = "Browser persona";
      assert.throws(() => executeCommands(state, extraKey, access("owner")), (error) => error.status === 400, `${name} extra input key`);
    }
  }
  const { state, fn } = actionCase("recordOwnership");
  const { commands } = capture(state, access("owner"), fn);
  commands[0].args[1].members[0].email = "undeclared@example.test";
  assert.throws(() => executeCommands(state, commands, access("owner")), (error) => error.status === 400, "ownership member shape is exact");
});

test("ordinary connected task creation uses the server timestamp and subsequent edits cannot change it", (t) => {
  freezeTime(t);
  for (const supplied of [undefined, "1999-01-01T00:00:00.000Z"]) {
    const s = fixture();
    const a = access();
    const created = replay(s, a, (draft) => {
      draft.tasks.unshift({
        id: "task-new", companyId: "A", title: "Review newly received evidence",
        owner: "Assigned operator", due: DAY, done: false, priority: "Normal",
        ...(supplied === undefined ? {} : { createdAt: supplied }),
      });
    }, "editDraft");
    assert.equal(created.visible.tasks.find((x) => x.id === "task-new").createdAt, NOW);
    const renamed = replay(created.next, a, (draft) => { draft.tasks.find((x) => x.id === "task-new").title = "Review corrected evidence"; }, "editDraft");
    assert.equal(renamed.visible.tasks.find((x) => x.id === "task-new").createdAt, NOW);
    for (const remove of [false, true]) {
      const { commands } = capture(renamed.next, a, (draft) => {
        const task = draft.tasks.find((x) => x.id === "task-new");
        if (remove) delete task.createdAt;
        else task.createdAt = "2000-01-01T00:00:00.000Z";
      });
      assert.throws(() => executeCommands(renamed.next, commands, a), (error) => error.status === 400);
    }
  }
});

test("editing a legacy task does not invent an unknown creation timestamp", (t) => {
  freezeTime(t);
  const s = fixture();
  delete s.tasks[0].createdAt;
  const result = replay(s, access(), (draft) => { draft.tasks.find((x) => x.id === "task-A").title = "Reviewed legacy task title"; }, "editDraft");
  assert.equal(Object.hasOwn(result.next.tasks.find((x) => x.id === "task-A"), "createdAt"), false);
  assert.equal(Object.hasOwn(result.visible.tasks.find((x) => x.id === "task-A"), "createdAt"), false);
});

test("a connected material request timestamps its generated task at server execution without aging legacy tasks", (t) => {
  freezeTime(t);
  const state = fixture();
  delete state.tasks[0].createdAt;
  const before = structuredClone(state);
  const a = access("onboarding");
  const { commands, draft } = capture(state, a, (s) => M.createMaterial(s, {
    companyId: "A", kind: "Logo", title: "Reviewed company logo",
    owner: "Assigned operator", brief: "Prepare the company logo from reviewed branding instructions",
  }));
  assert.deepEqual(commands.map((command) => command.name), ["createMaterial"]);
  // Capture and execution happen at different times; persisted age must start at the server clock.
  t.mock.timers.tick(60_000);
  const next = executeCommands(state, commands, a);
  const visible = projectWorkspace(next, a);
  const material = visible.materials.items[0];
  const task = visible.tasks.find((row) => row.id === `task-${material.id}`);
  assert.ok(task, "the material command must generate its assigned task");
  assert.equal(task.id, draft.tasks.find((row) => row.id === `task-${material.id}`).id);
  assert.equal(task.createdAt, "2026-09-14T12:01:00.000Z");
  assert.equal(task.companyId, "A");
  assert.equal(task.owner, "Assigned operator");
  assert.equal(Object.hasOwn(next.tasks.find((row) => row.id === "task-A"), "createdAt"), false);
  assert.equal(Object.hasOwn(visible.tasks.find((row) => row.id === "task-A"), "createdAt"), false);
  assert.deepEqual(state, before);
});

test("direct draft edits cannot rewrite waiting, ownership, or delivery history", (t) => {
  freezeTime(t);
  const s = fixture();
  T.startWaiting(s, "task-A", waitingInput);
  T.resolveWaiting(s, "task-A", { until: DAY, resolution: "Reviewed response" });
  O.recordOwnership(s, "A", ownershipInput);
  const delivery = D.prepareDelivery(s, deliveryInput());
  D.recordDelivery(s, delivery.id, receiptInput);
  const edits = [
    (draft) => { draft.tasks[0].waiting[0].detail = "Rewritten detail"; },
    (draft) => { draft.tasks[0].waiting[0].resolvedBy = "Different operator"; },
    (draft) => { draft.ownershipHistory[0].reason = "Rewritten ownership evidence"; },
    (draft) => { draft.deliveries[0].deliveryReference = "Rewritten receipt"; },
  ];
  for (const edit of edits) {
    const { commands } = capture(s, access("owner"), edit);
    assert.deepEqual(commands.map((c) => c.name), ["editDraft"]);
    assert.throws(() => executeCommands(s, commands, access("owner")), (error) => error.status === 400);
  }
});

test("a captured workflow batch reuses generated IDs and a rejected last action commits nothing", (t) => {
  freezeTime(t);
  const state = fixture();
  const before = structuredClone(state);
  const a = access("owner");
  const { commands, draft } = capture(state, a, (s) => {
    T.startWaiting(s, "task-A", waitingInput);
    T.resolveWaiting(s, "task-A", { until: DAY, resolution: "Reviewed response received" });
    O.recordOwnership(s, "A", ownershipInput);
    const received = D.prepareDelivery(s, deliveryInput());
    D.recordDelivery(s, received.id, receiptInput);
    const unsuccessful = D.prepareDelivery(s, deliveryInput({ recipientEmail: "second@example.test" }));
    D.recordDeliveryFailure(s, unsuccessful.id, failureInput);
    const retry = D.retryDelivery(s, unsuccessful.id, retryInput);
    D.cancelDelivery(s, retry.id, "Reviewed cancellation request");
  });
  assert.deepEqual(commands.map((c) => c.name), [
    "startWaiting", "resolveWaiting", "recordOwnership", "prepareDelivery", "recordDelivery",
    "prepareDelivery", "recordDeliveryFailure", "retryDelivery", "cancelDelivery",
  ]);
  const next = executeCommands(state, commands, a);
  const visible = projectWorkspace(next, a);
  assert.deepEqual(visible.deliveries.map((r) => [r.id, r.status, r.previousDeliveryId]),
    draft.deliveries.map((r) => [r.id, r.status, r.previousDeliveryId]));
  assert.equal(visible.tasks[0].waiting[0].resolvedBy, SERVER_EMAIL);
  assert.equal(visible.ownershipHistory[0].recordedBy, SERVER_EMAIL);
  assert.deepEqual(state, before);
  const invalid = structuredClone(commands);
  invalid.at(-1).args.push("unsupported argument");
  assert.throws(() => executeCommands(state, invalid, a), (error) => error.status === 400);
  assert.deepEqual(state, before, "a rejected batch must leave the original canonical workspace untouched");
});
