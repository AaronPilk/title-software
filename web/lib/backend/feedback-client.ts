import { backendRequest } from "./client";
import type { FeedbackCursor, FeedbackItem, FeedbackPage, FeedbackSubmission, FeedbackUpdate } from "./feedback";

export function listFeedback(workspaceId: string, cursor: FeedbackCursor | null | undefined, userId: string) {
  const query = cursor ? `?${new URLSearchParams({ before: cursor.createdAt, beforeId: cursor.id })}` : "";
  return backendRequest<FeedbackPage>(`/feedback${query}`, undefined, "GET", 30_000, workspaceId, userId);
}
export function submitFeedback(input: FeedbackSubmission, userId: string) {
  return backendRequest<FeedbackItem>("/feedback", input, "POST", 30_000, input.workspaceId, userId);
}
export function updateFeedback(input: FeedbackUpdate, userId: string) {
  return backendRequest<FeedbackItem>("/feedback/update", input, "POST", 30_000, input.workspaceId, userId);
}
