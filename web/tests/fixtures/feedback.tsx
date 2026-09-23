// Only transport and account context are synthetic. The widget and its CSS are real.
import { useSyncExternalStore } from "react";
import { DeveloperFeedback } from "../../components/title/developer-feedback";
import type { Access } from "../../lib/backend/workspace";
import type { Page } from "../../lib/title/model";
import type { FeedbackCursor, FeedbackItem, FeedbackPage, FeedbackSubmission, FeedbackUpdate, FeedbackView } from "../../lib/backend/feedback";

type FixtureContext = { workspaceId: string; userId: string; role: Access["role"]; page: Page; view: FeedbackView; version: number };
declare global {
  interface Window {
    feedbackRows: FeedbackItem[];
    feedbackRequests: { method: string; input: unknown; userId: string }[];
    feedbackListError: string;
    feedbackListErrorStatus: number;
    feedbackSubmitError: string;
    feedbackUpdateError: string;
    feedbackCommitThenFail: boolean;
    feedbackHoldNextList: boolean;
    feedbackHoldNextMutation: boolean;
    feedbackPendingLists: (() => void)[];
    feedbackPendingMutations: (() => void)[];
    feedbackSettled: number;
    setFeedbackContext: (value: Partial<FixtureContext>) => void;
  }
}
const listeners = new Set<() => void>();
let context: FixtureContext = { workspaceId: "workspace-one", userId: "staff-one", role: "admin", page: "Companies", view: "agency", version: 1 };
window.feedbackRows = [];
window.feedbackRequests = [];
window.feedbackPendingLists = [];
window.feedbackPendingMutations = [];
window.feedbackSettled = 0;
window.setFeedbackContext = value => { context = { ...context, ...value }; listeners.forEach(listener => listener()); };

export function FeedbackFixture() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => context);
  const access: Access = { userId: current.userId, email: `${current.userId}@example.test`, role: current.role, version: current.version, allCompanies: true, restricted: true, companyIds: [], partnerMembers: [] };
  return <><main><h1>Fictional workspace</h1><p id="fixture-context">{current.workspaceId} / {current.userId} / {current.page}</p></main><DeveloperFeedback workspaceId={current.workspaceId} access={access} page={current.page} view={current.view} /></>;
}

export async function listFeedback(workspaceId: string, cursor: FeedbackCursor | null | undefined, userId: string): Promise<FeedbackPage> {
  window.feedbackRequests.push({ method: "list", input: { workspaceId, cursor }, userId });
  if (window.feedbackListError) throw Object.assign(new Error(window.feedbackListError), { status: window.feedbackListErrorStatus });
  const rows = window.feedbackRows.filter(row => row.workspace_id === workspaceId && (context.role === "owner" || row.author_id === context.userId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const offset = cursor ? rows.findIndex(row => row.id === cursor.id) + 1 : 0;
  const items = structuredClone(rows.slice(offset, offset + 2));
  const result = { items, nextCursor: offset + 2 < rows.length ? { createdAt: items[items.length - 1].created_at, id: items[items.length - 1].id } : null };
  if (window.feedbackHoldNextList) { window.feedbackHoldNextList = false; await new Promise<void>(resolve => window.feedbackPendingLists.push(resolve)); }
  window.feedbackSettled++;
  return result;
}
export async function submitFeedback(input: FeedbackSubmission, userId: string): Promise<FeedbackItem> {
  window.feedbackRequests.push({ method: "submit", input: structuredClone(input), userId });
  if (window.feedbackSubmitError) throw new Error(window.feedbackSubmitError);
  const item = window.feedbackRows.find(row => row.id === input.id) || {
    id: input.id, workspace_id: input.workspaceId, author_id: context.userId, author_email: `${context.userId}@example.test`, kind: input.kind, message: input.message,
    page: input.page, view: input.view, status: "new" as const, owner_reply: "", version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (window.feedbackHoldNextMutation) { window.feedbackHoldNextMutation = false; await new Promise<void>(resolve => window.feedbackPendingMutations.push(resolve)); }
  if (!window.feedbackRows.some(row => row.id === item.id)) window.feedbackRows.push(item);
  window.feedbackSettled++;
  if (window.feedbackCommitThenFail) throw new Error("Connection interrupted after saving");
  return structuredClone(item);
}
export async function updateFeedback(input: FeedbackUpdate, userId: string): Promise<FeedbackItem> {
  window.feedbackRequests.push({ method: "update", input: structuredClone(input), userId });
  if (window.feedbackUpdateError) throw new Error(window.feedbackUpdateError);
  const item = window.feedbackRows.find(row => row.id === input.id);
  if (!item || item.version !== input.expectedVersion) throw new Error("This feedback changed. Refresh before updating it.");
  if (window.feedbackHoldNextMutation) { window.feedbackHoldNextMutation = false; await new Promise<void>(resolve => window.feedbackPendingMutations.push(resolve)); }
  Object.assign(item, { status: input.status, owner_reply: input.reply, version: item.version + 1, updated_at: new Date().toISOString() });
  window.feedbackSettled++;
  return structuredClone(item);
}
