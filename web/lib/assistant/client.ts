import { activeWorkspace, supabase } from "@/lib/backend/client";
import type { AssistantInput, AssistantResponse } from "./protocol";

export class AssistantClientError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = "AssistantClientError";
  }
}

export async function assistantRequest(
  input: AssistantInput,
  scope: { companyId: string; orderId: string },
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const workspaceId = activeWorkspace();
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  if (!supabase || !workspaceId || !apiKey)
    throw new AssistantClientError("Open your signed-in shared workspace to use the assistant.", 401);
  signal?.throwIfAborted();
  const { data, error } = await supabase.auth.getSession();
  signal?.throwIfAborted();
  if (error || !data.session)
    throw new AssistantClientError("Sign in again to continue with the assistant.", 401);
  if (activeWorkspace() !== workspaceId)
    throw new DOMException("Workspace changed.", "AbortError");

  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("Assistant request timed out.", "TimeoutError")), 45_000);
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...input, workspaceId, companyId: scope.companyId, orderId: scope.orderId }),
      cache: "no-store",
      signal: controller.signal,
    });
    let result: AssistantResponse & { error?: string };
    try {
      result = await response.json();
    } catch {
      controller.signal.throwIfAborted();
      throw new AssistantClientError("The assistant could not return a response. Refresh your private workspace and try again.", response.status);
    }
    controller.signal.throwIfAborted();
    if (!response.ok)
      throw new AssistantClientError(typeof result?.error === "string" ? result.error : "The assistant request failed.", response.status);
    if (activeWorkspace() !== workspaceId)
      throw new DOMException("Workspace changed.", "AbortError");
    if (!result || !Array.isArray(result.threads) || !result.context ||
        result.context.userId !== data.session.user.id ||
        result.context.workspaceId !== workspaceId ||
        result.context.companyId !== scope.companyId ||
        result.context.orderId !== scope.orderId ||
        result.threads.some((thread) => thread.companyId !== scope.companyId || thread.orderId !== scope.orderId || thread.accessVersion !== result.context.accessVersion))
      throw new AssistantClientError("The assistant context changed. Refresh this company before continuing.", 409);
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
