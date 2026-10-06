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

export async function submitFeedbackWithScreenshot(input: FeedbackSubmission, file: File, userId: string) {
  const { feedbackScreenshotBytes, encodeFeedbackScreenshot, MAX_FEEDBACK_SCREENSHOT_BYTES } = await import("./feedback-screenshot-validation");
  if (file.size > MAX_FEEDBACK_SCREENSHOT_BYTES) throw new Error("Choose a PNG or JPEG screenshot up to 4 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  feedbackScreenshotBytes(bytes, file.type);
  return backendRequest<FeedbackItem>("/feedback/screenshot", { ...input, screenshot: { fileName: file.name, mime: file.type, base64: encodeFeedbackScreenshot(bytes) } }, "POST", 120_000, input.workspaceId, userId);
}
export async function readFeedbackScreenshot(workspaceId: string, id: string, userId: string) {
  const result = await backendRequest<{ fileName: string; mime: string; base64: string }>("/feedback/screenshot/read", { workspaceId, id }, "POST", 30_000, workspaceId, userId);
  const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
  return { fileName: result.fileName, blob: new Blob([bytes], { type: result.mime }) };
}
