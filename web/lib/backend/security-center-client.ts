import { backendRequest } from "./client";
import type { AccessReview, AccessReviewInput, SecurityCenterSummary, SecurityCursor, SecurityEventPage, SecurityMemberLabel } from "./security-center";

export function loadSecurityCenter(workspaceId: string, userId: string) {
  return backendRequest<SecurityCenterSummary>("/security/center", undefined, "GET", 30_000, workspaceId, userId, true);
}
export async function loadSecurityMemberLabels(workspaceId: string, userId: string): Promise<SecurityMemberLabel[]> {
  const directory = await backendRequest<{ members: { user_id: string; email: string | null }[] }>("/members", undefined, "GET", 30_000, workspaceId, userId, true);
  if (!Array.isArray(directory.members)) throw new Error("Member labels are unavailable.");
  return directory.members.map(member => ({ userId: member.user_id, email: typeof member.email === "string" && member.email.trim() ? member.email.trim() : null }));
}
export function listSecurityEvents(workspaceId: string, userId: string, cursor?: SecurityCursor | null) {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) { query.set("before", cursor.createdAt); query.set("beforeId", cursor.id); }
  return backendRequest<SecurityEventPage>(`/security/events?${query}`, undefined, "GET", 30_000, workspaceId, userId, true);
}
export function recordAccessReview(input: AccessReviewInput, userId: string) {
  return backendRequest<AccessReview>("/security/access-review", input, "POST", 30_000, input.workspaceId, userId, true);
}
export function exportSecurityEvents(workspaceId: string, userId: string, cursor?: SecurityCursor | null) {
  const query = new URLSearchParams({ limit: "100", format: "json" });
  if (cursor) { query.set("before", cursor.createdAt); query.set("beforeId", cursor.id); }
  return backendRequest<SecurityEventPage>(`/security/events/export?${query}`, undefined, "GET", 30_000, workspaceId, userId, true);
}
