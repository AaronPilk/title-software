import { createClient } from "@supabase/supabase-js";
import type { Workspace } from "../title/model";
import type { Access } from "./workspace";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const backendConfigured = !!url && !!key;
export const supabase = backendConfigured ? createClient(url, key) : null;
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
export async function backendRequest<T = any>(
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
): Promise<T> {
  if (!supabase) throw new Error("The shared backend is not configured.");
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error("Sign in to continue.");
  const query =
    method === "GET" && workspaceId
      ? `?workspaceId=${encodeURIComponent(workspaceId)}`
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
    signal: AbortSignal.timeout(30000),
  });
  const result: any = await response.json();
  if (!response.ok) {
    const error = new Error(
      result.error || "The server could not complete this request.",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return result;
}
export async function uploadRemoteAsset(
  id: string,
  file: File,
  companyId: string,
  documentId: string,
) {
  if (!supabase || !workspaceId)
    throw new Error("Open a connected workspace first.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to upload.");
  const form = new FormData();
  form.set("workspaceId", workspaceId);
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
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || "Upload failed.");
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
    const result: any = await response.json();
    throw new Error(result.error || "Download failed.");
  }
  return response.blob();
}
