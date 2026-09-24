import { createClient } from "@supabase/supabase-js";
import type { Workspace } from "../title/model";
import type { Access } from "./workspace";
import { recoveryIntent } from "./recovery-intent";
import { captureVendorCallback } from "./vendor-callback";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const backendConfigured = !!url && !!key;
export const hostedPilot = process.env.NEXT_PUBLIC_TITLE_HOSTED_PILOT === "true";
captureVendorCallback();
export const supabase = backendConfigured ? createClient(url, key) : null;
// Redirect events can arrive before React mounts and are not replayed as recovery.
// Capture the intent synchronously; do not call async Auth methods in this callback.
if (supabase && typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event, session) => {
    recoveryIntent.observe(event, session?.access_token);
  });
}
export type RemoteState = {
  workspaceId: string;
  name: string;
  revision: number;
  state: Workspace;
  access: Access;
};
let workspaceId = "";
export const activeWorkspace = () => workspaceId;
export const setActiveWorkspace = (id: string) => {
  workspaceId = id;
};
export async function backendRequest<T = unknown>(
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
  timeoutMs = 30000,
  requestWorkspaceId = workspaceId,
  expectedUserId?: string,
  requireActiveWorkspace = false,
): Promise<T> {
  if (!supabase) throw new Error("The shared backend is not configured.");
  const assertPinnedWorkspace = () => {
    if (requireActiveWorkspace && requestWorkspaceId && workspaceId !== requestWorkspaceId)
      throw Object.assign(new Error("Your workspace changed. Reopen this page to continue."), { status: 403 });
  };
  assertPinnedWorkspace();
  const { data: session } = await supabase.auth.getSession();
  assertPinnedWorkspace();
  if (!session.session) throw new Error("Sign in to continue.");
  if (expectedUserId && session.session.user.id !== expectedUserId)
    throw Object.assign(new Error("Your signed-in account changed. Reopen this page to continue."), { status: 403 });
  const query =
    method === "GET" && requestWorkspaceId
      ? `${path.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(requestWorkspaceId)}`
      : "";
  const response = await fetch(`${url}/functions/v1/title-api${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${session.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify(data),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result: unknown = await response.json();
  assertPinnedWorkspace();
  if (!response.ok) {
    const error = responseError(result, "The server could not complete this request.") as Error & { status: number; code?: string };
    error.status = response.status;
    throw error;
  }
  return result as T;
}
function responseError(result: unknown, fallback: string): Error & { code?: string } {
  const details = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const error = new Error(typeof details.error === "string" && details.error ? details.error : fallback) as Error & { code?: string };
  if (typeof details.code === "string") error.code = details.code;
  return error;
}
export async function uploadRemoteAsset(
  id: string,
  file: File,
  companyId: string,
  documentId: string,
  expected: { expectedUserId?: string; expectedWorkspaceId?: string } = {},
) {
  const requestWorkspaceId = workspaceId;
  const { expectedUserId, expectedWorkspaceId } = expected;
  const contextChanged = () => Object.assign(
    new Error("Your account or workspace changed. Reopen Upload documents before sending these originals."),
    { status: 403 },
  );
  if (expectedWorkspaceId !== undefined && expectedWorkspaceId !== requestWorkspaceId)
    throw contextChanged();
  if (!supabase || !requestWorkspaceId)
    throw new Error("Open a connected workspace first.");
  const { data } = await supabase.auth.getSession();
  if (workspaceId !== requestWorkspaceId) throw contextChanged();
  if (!data.session) throw new Error("Sign in to upload.");
  if (expectedUserId !== undefined && data.session.user.id !== expectedUserId)
    throw contextChanged();
  const form = new FormData();
  form.set("workspaceId", requestWorkspaceId);
  form.set("id", id);
  form.set("companyId", companyId);
  form.set("documentId", documentId);
  form.set("file", file);
  const response = await fetch(`${url}/functions/v1/title-api/assets/upload`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw responseError(result, "Upload failed.");
  return result;
}
export async function downloadRemoteAsset(id: string): Promise<Blob> {
  if (!supabase || !workspaceId)
    throw new Error("Open a connected workspace first.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to download.");
  const response = await fetch(
    `${url}/functions/v1/title-api/assets/download?workspaceId=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(id)}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${data.session.access_token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    const result: unknown = await response.json();
    throw responseError(result, "Download failed.");
  }
  return response.blob();
}
