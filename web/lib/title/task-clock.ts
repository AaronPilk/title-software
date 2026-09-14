import { traceMutation, commandUuid } from "./command-log";
import type { Task, Workspace } from "./model";

/**
 * Suggested starting text, not an approved fixed taxonomy. Every reason is
 * editable through the detail note, and "Other" carries the detail alone.
 */
export const waitingReasons = [
  "Waiting on attorney",
  "Waiting on client",
  "Waiting on lender",
  "Waiting on underwriter",
  "Waiting on county or recording office",
  "Waiting on provider or vendor",
  "Waiting on another team member",
  "Other",
] as const;

export type TaskWaitingPeriod = {
  id: string;
  reason: string;
  detail: string;
  since: string;
  by: string;
  /** Empty while the period is open. */
  until: string;
  resolution: string;
  resolvedBy: string;
};

export type TaskClockState =
  | "Completed"
  | "Waiting"
  | "Overdue"
  | "Due today"
  | "Due soon"
  | "On track"
  | "No due date";

export type TaskClock = {
  state: TaskClockState;
  /** Calendar days until the due date; negative once overdue. Null with no due date. */
  dueInDays: number | null;
  /** Days the task has spent waiting on someone else, across every period. */
  waitingDays: number;
  openWaiting: TaskWaitingPeriod | null;
  openWaitingDays: number | null;
  /**
   * Days since the task was created. Null for tasks saved before creation
   * dates were recorded — an unknown age is never guessed from the due date.
   */
  heldDays: number | null;
  /** heldDays minus waitingDays: time the work was actually ours. Null when heldDays is. */
  activeDays: number | null;
};

const dayValid = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;

const dayNumber = (v: string) => Math.floor(Date.parse(`${v}T00:00:00Z`) / 86_400_000);

const today = (now: Date) => now.toISOString().slice(0, 10);

const actor = (s: Workspace) => {
  if (!s.user.trim()) throw new Error("Choose the operator recording this work.");
  return s.user;
};

export function taskWaiting(t: Task): TaskWaitingPeriod[] {
  return t.waiting || [];
}

export function openWaiting(t: Task): TaskWaitingPeriod | null {
  return taskWaiting(t).find((p) => !p.until) || null;
}

/** Whole days between two calendar dates, never negative. */
function spanDays(from: string, to: string) {
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

export function waitingDays(t: Task, now = new Date()) {
  const end = today(now);
  return taskWaiting(t).reduce(
    (total, p) => total + spanDays(p.since, p.until || end),
    0,
  );
}

export function taskClock(t: Task, now = new Date()): TaskClock {
  const end = today(now);
  const open = openWaiting(t);
  const waited = waitingDays(t, now);
  const held = t.createdAt && dayValid(t.createdAt.slice(0, 10))
    ? spanDays(t.createdAt.slice(0, 10), end)
    : null;
  const dueInDays = t.due && dayValid(t.due) ? dayNumber(t.due) - dayNumber(end) : null;
  const state: TaskClockState = t.done
    ? "Completed"
    : open
      ? "Waiting"
      : dueInDays === null
        ? "No due date"
        : dueInDays < 0
          ? "Overdue"
          : dueInDays === 0
            ? "Due today"
            : dueInDays <= 2
              ? "Due soon"
              : "On track";
  return {
    state,
    dueInDays,
    waitingDays: waited,
    openWaiting: open,
    openWaitingDays: open ? spanDays(open.since, end) : null,
    heldDays: held,
    activeDays: held === null ? null : Math.max(0, held - waited),
  };
}

/** Open tasks whose due date has passed, oldest first. Waiting tasks are still overdue. */
export function overdueTasks(s: Workspace, now = new Date()) {
  return s.tasks
    .filter((t) => !t.done && (taskClock(t, now).dueInDays ?? 0) < 0)
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}

function getTask(s: Workspace, taskId: string) {
  const t = s.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error("That task is no longer on file.");
  return t;
}

export function startWaiting(
  s: Workspace,
  taskId: string,
  input: { reason: string; detail: string; since: string },
  now = new Date(),
) {
  return traceMutation(s, "startWaiting", [taskId, input], () => {
    const t = getTask(s, taskId);
    if (t.done) throw new Error("Reopen the task before recording what it is waiting on.");
    if (openWaiting(t))
      throw new Error("This task is already waiting on something. Resolve that first.");
    const reason = input.reason.trim();
    const detail = input.detail.trim();
    if (!waitingReasons.includes(reason as (typeof waitingReasons)[number]))
      throw new Error("Choose what this task is waiting on.");
    if (reason === "Other" && !detail)
      throw new Error("Describe what this task is waiting on.");
    const since = input.since.trim();
    if (!dayValid(since)) throw new Error("Enter the date this task started waiting.");
    if (dayNumber(since) > dayNumber(today(now)))
      throw new Error("A task cannot start waiting on a future date.");
    const by = actor(s);
    const period: TaskWaitingPeriod = {
      id: `wait-${commandUuid().slice(0, 8)}`,
      reason,
      detail,
      since,
      by,
      until: "",
      resolution: "",
      resolvedBy: "",
    };
    t.waiting = [...taskWaiting(t), period];
    return period;
  });
}

export function resolveWaiting(
  s: Workspace,
  taskId: string,
  input: { until: string; resolution: string },
  now = new Date(),
) {
  return traceMutation(s, "resolveWaiting", [taskId, input], () => {
    const t = getTask(s, taskId);
    const open = openWaiting(t);
    if (!open) throw new Error("This task is not waiting on anything.");
    const until = input.until.trim();
    const resolution = input.resolution.trim();
    if (!dayValid(until)) throw new Error("Enter the date this stopped waiting.");
    if (dayNumber(until) < dayNumber(open.since))
      throw new Error("The resolved date cannot be before the task started waiting.");
    if (dayNumber(until) > dayNumber(today(now)))
      throw new Error("A waiting period cannot be resolved on a future date.");
    if (!resolution) throw new Error("Record what unblocked this task.");
    const resolvedBy = actor(s);
    t.waiting = taskWaiting(t).map((p) =>
      p.id === open.id ? { ...p, until, resolution, resolvedBy } : p,
    );
    return t.waiting.find((p) => p.id === open.id)!;
  });
}

const periodShape = (v: unknown): v is TaskWaitingPeriod => {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.reason === "string" &&
    typeof p.detail === "string" &&
    typeof p.since === "string" &&
    typeof p.by === "string" &&
    typeof p.until === "string" &&
    typeof p.resolution === "string" &&
    typeof p.resolvedBy === "string"
  );
};

export function validWaitingShape(t: Task) {
  return t.waiting === undefined || (Array.isArray(t.waiting) && t.waiting.every(periodShape));
}

/**
 * Cross-cutting invariants, enforced centrally so no UI path can bypass them.
 * Waiting history is append-only: a recorded period's identity and start never
 * change, and a resolved period is never reopened or rewritten.
 */
export function validateTaskClock(before: Workspace, after: Workspace) {
  for (const t of after.tasks) {
    if (!validWaitingShape(t))
      throw new Error("That waiting record is not in a shape this workspace can store.");
    const periods = taskWaiting(t);
    if (periods.filter((p) => !p.until).length > 1)
      throw new Error("A task can only be waiting on one thing at a time.");
    if (t.done && periods.some((p) => !p.until))
      throw new Error("Resolve what this task is waiting on before completing it.");
    for (const p of periods) {
      if (p.until && dayNumber(p.until) < dayNumber(p.since))
        throw new Error("A waiting period cannot end before it started.");
      if (p.until && !p.resolution.trim())
        throw new Error("A resolved waiting period must record what unblocked the task.");
    }
    const prior = before.tasks.find((x) => x.id === t.id);
    if (!prior) continue;
    for (const p of taskWaiting(prior)) {
      const now = periods.find((x) => x.id === p.id);
      if (!now)
        throw new Error("Waiting history stays on the task; it cannot be removed.");
      if (now.reason !== p.reason || now.since !== p.since || now.by !== p.by)
        throw new Error("A recorded waiting period cannot be rewritten.");
      if (p.until && (now.until !== p.until || now.resolution !== p.resolution))
        throw new Error("A resolved waiting period cannot be reopened or edited.");
    }
  }
}
