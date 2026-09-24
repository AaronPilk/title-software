import { activeWorkspace, backendRequest, supabase } from "./client";
import type { JVIntakeContext } from "./jv-intake-client";
import type { JVPortalStaffRecord, JVPortalAttachment, JVRecipientPayload } from "../title/jv-portal";
import { readRequestBytes } from "../shared/request-body";

export type JVPortalAction = "list" | "create" | "send" | "revoke" | "request-changes" | "load-submission" | "apply";
export type JVPortalList = { requests: JVPortalStaffRecord[]; mailConfigured: boolean };
export type JVPortalPrepared = { request: JVPortalStaffRecord; link?: string; deliveryStatus: string };
export type JVPortalSubmission = { request: JVPortalStaffRecord; payload: JVRecipientPayload; attachments: JVPortalAttachment[] };
const changed = () => Object.assign(new Error("Your account or workspace changed. Reopen the application requests."), { status: 403 });
function assertScope(context: JVIntakeContext) { if (!context.workspaceId || !context.userId || !context.companyId || activeWorkspace() !== context.workspaceId) throw changed(); }
async function assertUser(context: JVIntakeContext) {
  assertScope(context);
  if (!supabase) throw changed();
  const { data } = await supabase.auth.getSession();
  assertScope(context);
  if (data.session?.user.id !== context.userId) throw changed();
  return data.session;
}
export async function jvPortalClientRequest<T>(context: JVIntakeContext, action: JVPortalAction, data: Record<string, unknown> = {}): Promise<T> {
  await assertUser(context);
  const result = await backendRequest<T>(`/jv-portal/${action}`, { ...data, workspaceId: context.workspaceId, companyId: context.companyId }, "POST", 60_000, context.workspaceId, context.userId, true);
  await assertUser(context);
  return result;
}
export async function jvPortalDownload(context: JVIntakeContext, id: string, attachmentId: string): Promise<Blob> {
  const session = await assertUser(context);
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/title-api/jv-portal/download-attachment`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ workspaceId: context.workspaceId, companyId: context.companyId, id, attachmentId }),
  });
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw Object.assign(new Error("The application attachment could not be downloaded."), { status: response.status }); }
  const bytes = await readRequestBytes({ body: response.body, headers: response.headers, signal: AbortSignal.timeout(60_000) }, { maxBytes: 10 * 1024 * 1024, timeoutMs: 60_000 });
  await assertUser(context);
  return new Blob([bytes], { type: response.headers.get("Content-Type") || "application/octet-stream" });
}
