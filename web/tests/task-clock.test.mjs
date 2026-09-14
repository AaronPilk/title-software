import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../.local-test/model.js";
import { validateBusinessMutation } from "../.local-test/business.js";
import {
  taskClock,
  taskWaiting,
  openWaiting,
  waitingDays,
  overdueTasks,
  startWaiting,
  resolveWaiting,
  validateTaskClock,
  waitingReasons,
} from "../.local-test/task-clock.js";

const day = (offsetDays, from = "2026-09-14") =>
  new Date(Date.parse(`${from}T00:00:00Z`) + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
const NOW = new Date("2026-09-14T12:00:00Z");

function seed() {
  const s = createSeed();
  s.user = "Tyler";
  s.tasks = [];
  return s;
}

function addTask(s, over = {}) {
  const task = {
    id: over.id || "task-1",
    title: over.title || "Clear the Harbor final",
    companyId: s.companies[0].id,
    owner: "Tyler",
    due: over.due ?? day(3),
    done: over.done ?? false,
    priority: "Normal",
    ...("createdAt" in over
      ? over.createdAt === undefined
        ? {}
        : { createdAt: over.createdAt }
      : { createdAt: `${day(-10)}T09:00:00.000Z` }),
    ...(over.waiting ? { waiting: over.waiting } : {}),
  };
  s.tasks.push(task);
  return task;
}

test("a new task with no waiting reads as on track and carries no waiting time", () => {
  const s = seed();
  const t = addTask(s);
  const clock = taskClock(t, NOW);
  assert.equal(clock.state, "On track");
  assert.equal(clock.dueInDays, 3);
  assert.equal(clock.waitingDays, 0);
  assert.equal(clock.openWaiting, null);
  assert.equal(clock.heldDays, 10);
  assert.equal(clock.activeDays, 10);
});

test("due-date states move through due soon, due today and overdue", () => {
  const s = seed();
  assert.equal(taskClock(addTask(s, { id: "a", due: day(2) }), NOW).state, "Due soon");
  assert.equal(taskClock(addTask(s, { id: "b", due: day(0) }), NOW).state, "Due today");
  assert.equal(taskClock(addTask(s, { id: "c", due: day(-4) }), NOW).state, "Overdue");
  assert.equal(taskClock(addTask(s, { id: "d", due: day(-4) }), NOW).dueInDays, -4);
  assert.equal(taskClock(addTask(s, { id: "e", due: "" }), NOW).state, "No due date");
  assert.equal(taskClock(addTask(s, { id: "f", done: true, due: day(-9) }), NOW).state, "Completed");
});

test("an unknown creation date leaves age unknown instead of guessing it from the due date", () => {
  const s = seed();
  const t = addTask(s, { createdAt: undefined });
  const clock = taskClock(t, NOW);
  assert.equal(clock.heldDays, null);
  assert.equal(clock.activeDays, null);
  // The waiting total is still real; only the age it would be measured against is unknown.
  assert.equal(clock.waitingDays, 0);
});

test("marking a task waiting records the reason, the operator and the start date", () => {
  const s = seed();
  const t = addTask(s);
  const period = startWaiting(
    s,
    t.id,
    { reason: "Waiting on attorney", detail: "Asked Mark for the corrected deed", since: day(-3) },
    NOW,
  );
  assert.equal(period.reason, "Waiting on attorney");
  assert.equal(period.by, "Tyler");
  assert.equal(period.until, "");
  const clock = taskClock(s.tasks[0], NOW);
  assert.equal(clock.state, "Waiting");
  assert.equal(clock.openWaitingDays, 3);
  assert.equal(clock.waitingDays, 3);
  // Waiting time is separated from the time the work was actually ours.
  assert.equal(clock.heldDays, 10);
  assert.equal(clock.activeDays, 7);
});

test("a waiting task is still overdue — waiting does not silently extend the due date", () => {
  const s = seed();
  const t = addTask(s, { due: day(-5) });
  startWaiting(s, t.id, { reason: "Waiting on client", detail: "", since: day(-2) }, NOW);
  const clock = taskClock(s.tasks[0], NOW);
  assert.equal(clock.state, "Waiting");
  assert.equal(clock.dueInDays, -5);
  assert.deepEqual(overdueTasks(s, NOW).map((x) => x.id), [t.id]);
});

test("capture rejects an unknown reason, a bare Other, a future start and a completed task", () => {
  const s = seed();
  const t = addTask(s);
  assert.throws(
    () => startWaiting(s, t.id, { reason: "Waiting on weather", detail: "x", since: day(0) }, NOW),
    /Choose what this task is waiting on/,
  );
  assert.throws(
    () => startWaiting(s, t.id, { reason: "Other", detail: "  ", since: day(0) }, NOW),
    /Describe what this task is waiting on/,
  );
  assert.throws(
    () => startWaiting(s, t.id, { reason: "Waiting on client", detail: "", since: day(2) }, NOW),
    /cannot start waiting on a future date/,
  );
  assert.throws(
    () => startWaiting(s, t.id, { reason: "Waiting on client", detail: "", since: "not-a-date" }, NOW),
    /Enter the date this task started waiting/,
  );
  s.tasks[0].done = true;
  assert.throws(
    () => startWaiting(s, t.id, { reason: "Waiting on client", detail: "", since: day(0) }, NOW),
    /Reopen the task/,
  );
});

test("only one thing can be waited on at a time", () => {
  const s = seed();
  const t = addTask(s);
  startWaiting(s, t.id, { reason: "Waiting on attorney", detail: "", since: day(-2) }, NOW);
  assert.throws(
    () => startWaiting(s, t.id, { reason: "Waiting on lender", detail: "", since: day(-1) }, NOW),
    /already waiting on something/,
  );
});

test("resolving closes the period, keeps it as history and frees a second one", () => {
  const s = seed();
  const t = addTask(s);
  startWaiting(s, t.id, { reason: "Waiting on attorney", detail: "", since: day(-6) }, NOW);
  resolveWaiting(s, t.id, { until: day(-4), resolution: "Corrected deed received" }, NOW);
  const first = taskWaiting(s.tasks[0])[0];
  assert.equal(first.until, day(-4));
  assert.equal(first.resolution, "Corrected deed received");
  assert.equal(first.resolvedBy, "Tyler");
  assert.equal(openWaiting(s.tasks[0]), null);
  assert.equal(taskClock(s.tasks[0], NOW).state, "On track");
  // Closed waiting time stops accruing at the resolved date.
  assert.equal(waitingDays(s.tasks[0], NOW), 2);
  startWaiting(s, t.id, { reason: "Waiting on underwriter", detail: "", since: day(-1) }, NOW);
  assert.equal(taskWaiting(s.tasks[0]).length, 2);
  assert.equal(waitingDays(s.tasks[0], NOW), 3);
});

test("resolution rejects a missing note, a date before the start and a future date", () => {
  const s = seed();
  const t = addTask(s);
  startWaiting(s, t.id, { reason: "Waiting on attorney", detail: "", since: day(-3) }, NOW);
  assert.throws(
    () => resolveWaiting(s, t.id, { until: day(0), resolution: "   " }, NOW),
    /Record what unblocked this task/,
  );
  assert.throws(
    () => resolveWaiting(s, t.id, { until: day(-5), resolution: "ok" }, NOW),
    /cannot be before the task started waiting/,
  );
  assert.throws(
    () => resolveWaiting(s, t.id, { until: day(3), resolution: "ok" }, NOW),
    /cannot be resolved on a future date/,
  );
  assert.throws(
    () => resolveWaiting(s, "task-missing", { until: day(0), resolution: "ok" }, NOW),
    /no longer on file/,
  );
});

test("resolving requires an open period and an operator", () => {
  const s = seed();
  const t = addTask(s);
  assert.throws(
    () => resolveWaiting(s, t.id, { until: day(0), resolution: "ok" }, NOW),
    /not waiting on anything/,
  );
  startWaiting(s, t.id, { reason: "Waiting on client", detail: "", since: day(-1) }, NOW);
  s.user = "   ";
  assert.throws(
    () => resolveWaiting(s, t.id, { until: day(0), resolution: "ok" }, NOW),
    /Choose the operator/,
  );
});

test("the central validator blocks completing a task that is still waiting", () => {
  const s = seed();
  const t = addTask(s);
  startWaiting(s, t.id, { reason: "Waiting on attorney", detail: "", since: day(-2) }, NOW);
  const after = structuredClone(s);
  after.tasks[0].done = true;
  assert.throws(
    () => validateBusinessMutation(s, after),
    /Resolve what this task is waiting on before completing it/,
  );
  // Resolving first makes exactly the same completion legal.
  const ok = structuredClone(s);
  resolveWaiting(ok, t.id, { until: day(0), resolution: "Deed received" }, NOW);
  const done = structuredClone(ok);
  done.tasks[0].done = true;
  assert.doesNotThrow(() => validateBusinessMutation(ok, done));
});

test("waiting history is append-only: no deletion, no rewrite, no reopening", () => {
  const s = seed();
  const t = addTask(s);
  startWaiting(s, t.id, { reason: "Waiting on attorney", detail: "", since: day(-6) }, NOW);
  resolveWaiting(s, t.id, { until: day(-4), resolution: "Deed received" }, NOW);

  const removed = structuredClone(s);
  removed.tasks[0].waiting = [];
  assert.throws(() => validateBusinessMutation(s, removed), /Waiting history stays on the task/);

  const rewritten = structuredClone(s);
  rewritten.tasks[0].waiting[0].reason = "Waiting on lender";
  assert.throws(() => validateBusinessMutation(s, rewritten), /cannot be rewritten/);

  const restarted = structuredClone(s);
  restarted.tasks[0].waiting[0].since = day(-9);
  assert.throws(() => validateBusinessMutation(s, restarted), /cannot be rewritten/);

  const reopened = structuredClone(s);
  reopened.tasks[0].waiting[0].until = "";
  assert.throws(() => validateBusinessMutation(s, reopened), /cannot be reopened or edited/);

  const reworded = structuredClone(s);
  reworded.tasks[0].waiting[0].resolution = "Something else entirely";
  assert.throws(() => validateBusinessMutation(s, reworded), /cannot be reopened or edited/);
});

test("the validator rejects two open periods, a backwards period and a malformed record", () => {
  const s = seed();
  const t = addTask(s);
  const base = {
    id: "wait-a",
    reason: "Waiting on attorney",
    detail: "",
    since: day(-4),
    by: "Tyler",
    until: "",
    resolution: "",
    resolvedBy: "",
  };
  const twoOpen = structuredClone(s);
  twoOpen.tasks[0].waiting = [base, { ...base, id: "wait-b" }];
  assert.throws(() => validateBusinessMutation(s, twoOpen), /only be waiting on one thing/);

  const backwards = structuredClone(s);
  backwards.tasks[0].waiting = [
    { ...base, until: day(-8), resolution: "early" },
  ];
  assert.throws(() => validateBusinessMutation(s, backwards), /cannot end before it started/);

  const unexplained = structuredClone(s);
  unexplained.tasks[0].waiting = [{ ...base, until: day(-1), resolution: "  " }];
  assert.throws(() => validateBusinessMutation(s, unexplained), /must record what unblocked/);

  const malformed = structuredClone(s);
  malformed.tasks[0].waiting = ["not a record"];
  assert.throws(() => validateBusinessMutation(s, malformed), /not in a shape this workspace can store/);
  void t;
});

test("tasks saved before this feature stay valid and unchanged", () => {
  const s = seed();
  const t = addTask(s, { createdAt: undefined });
  delete s.tasks[0].waiting;
  assert.deepEqual(taskWaiting(s.tasks[0]), []);
  assert.equal(waitingDays(s.tasks[0], NOW), 0);
  const after = structuredClone(s);
  after.tasks[0].owner = "Stephenie";
  assert.doesNotThrow(() => validateBusinessMutation(s, after));
  assert.doesNotThrow(() => validateTaskClock(s, after));
  void t;
});

test("every offered reason is accepted and Other carries the detail", () => {
  const s = seed();
  for (const [i, reason] of waitingReasons.entries()) {
    const t = addTask(s, { id: `task-${i}` });
    assert.doesNotThrow(() =>
      startWaiting(s, t.id, { reason, detail: "context", since: day(-1) }, NOW),
    );
    assert.equal(openWaiting(s.tasks.find((x) => x.id === t.id)).reason, reason);
  }
});
