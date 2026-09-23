import { ApiError } from "./workspace";
import type { Page } from "../title/model";
import type { FeedbackKind, FeedbackStatus, FeedbackSubmission, FeedbackUpdate, FeedbackView } from "./feedback";

const pages: Page[] = ["Overview", "Assistant", "Inbox", "Orders", "Policy workbench", "Commitments", "Policy products", "Handoffs", "Revisions", "Companies", "Onboarding", "Documents", "Tasks", "Financials", "Partner portal", "Automations", "Connections", "Settings"];
function record(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("Enter a feedback request.");
  if (Object.keys(input).some(key => !keys.includes(key))) throw new ApiError("Unsupported feedback field.");
  return input as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value))
    throw new ApiError("Invalid feedback identifier.");
  return value;
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length > max || value.trim().length < min || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new ApiError(`Enter ${min ? "a message" : "a reply"} up to ${max.toLocaleString("en-US")} characters.`);
  return value.trim();
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new ApiError("Choose a valid feedback option.");
  return value as T;
}
export function feedbackSubmission(value: unknown): FeedbackSubmission {
  const input = record(value, ["workspaceId", "id", "kind", "message", "page", "view"]);
  return { workspaceId: id(input.workspaceId), id: id(input.id),
    kind: choice<FeedbackKind>(input.kind, ["problem", "idea", "question"]), message: text(input.message, 1, 4000),
    page: choice(input.page, pages), view: choice<FeedbackView>(input.view, ["agency", "production", "partner"]) };
}
export function feedbackUpdate(value: unknown): FeedbackUpdate {
  const input = record(value, ["workspaceId", "id", "expectedVersion", "status", "reply"]);
  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1 || (input.expectedVersion as number) > 2147483647)
    throw new ApiError("Refresh feedback before saving this change.", 409);
  return { workspaceId: id(input.workspaceId), id: id(input.id), expectedVersion: input.expectedVersion as number,
    status: choice<FeedbackStatus>(input.status, ["new", "in_progress", "done"]), reply: text(input.reply, 0, 2000) };
}
export function feedbackList(value: unknown) {
  const input = record(value, ["workspaceId", "before", "beforeId", "limit"]);
  const workspaceId = id(input.workspaceId);
  const limit = input.limit === undefined ? 50 : typeof input.limit === "string" && /^\d{1,2}$/.test(input.limit) ? Number(input.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiError("Choose a feedback page size from 1 to 50.");
  if (input.before === undefined && input.beforeId === undefined) return { workspaceId, limit, before: null, beforeId: null };
  if (typeof input.before !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.before) || !Number.isFinite(Date.parse(input.before)))
    throw new ApiError("Refresh feedback to load older reports.");
  // Keep PostgreSQL's microseconds so keyset pagination cannot skip adjacent rows.
  return { workspaceId, limit, before: input.before, beforeId: id(input.beforeId) };
}
