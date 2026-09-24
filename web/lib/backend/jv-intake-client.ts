import { activeWorkspace, backendRequest } from "@/lib/backend/client";
import type { JVApplication, JVRecord } from "../title/jv-application";

export type JVIntakeContext = { workspaceId: string; userId: string; companyId: string };
export type JVIntakeAction = "load" | "save" | "submit" | "review" | "reopen";
export type JVIntakeData = { expectedVersion?: number; payload?: JVApplication; reviewNote?: string };

/** Private intake never enters the workspace snapshot or a browser cache. */
export async function jvIntakeClientRequest(context: JVIntakeContext, action: JVIntakeAction, data: JVIntakeData = {}): Promise<JVRecord> {
  const { workspaceId, userId, companyId } = context;
  const assertContext = () => {
    if (!workspaceId || !userId || !companyId || activeWorkspace() !== workspaceId)
      throw Object.assign(new Error("Your account or workspace changed. Reopen the private application to continue."), { status: 403 });
  };
  assertContext();
  const result = await backendRequest<JVRecord>(`/jv-intake/${action}`, { ...data, workspaceId, companyId }, "POST", 30_000, workspaceId, userId);
  assertContext();
  if (result.companyId !== companyId)
    throw new Error("The private application could not be loaded. Reopen it to continue.");
  return result;
}
