"use client";
import { useCallback, useEffect, useState } from "react";
import { activeWorkspace, backendRequest } from "@/lib/backend/client";
import { useWorkspace } from "@/lib/title/store";
import { people } from "@/lib/title/model";

export type StaffChoice = { userId: string; email: string; label: string };
const demoStaff = people.map(label => ({ userId: label, email: label, label }));
type DirectoryResponse = { staff: StaffChoice[]; unavailable: number };
// Coalesce simultaneous row pickers without retaining completed identity data.
const inFlight = new Map<string, Promise<DirectoryResponse>>();
function readDirectory(key: string, workspaceId: string, companyId: string, kind: string) {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = backendRequest<DirectoryResponse>("/staff/assignable", { workspaceId, companyId, kind });
  inFlight.set(key, request);
  void request.finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); }).catch(() => {});
  return request;
}

export function chooseStaffAssignment(staff: StaffChoice[], selection: string) {
  const member = staff.find(item => item.userId === selection);
  if (!member) throw new Error("Choose an available staff account. Refresh the staff list if needed.");
  return { owner: member.email, ...(/^[a-f\d-]{36}$/i.test(member.userId) ? { assigneeId: member.userId } : {}) };
}

/** Only company-scoped identity labels; no Auth metadata or unrelated company grants. */
export function useStaffDirectory(companyId = "", kind: "task" | "order" = "task") {
  const { connection } = useWorkspace();
  const workspaceId = activeWorkspace();
  const readOnly = !!connection && ["viewer", "partner"].includes(connection.access.role);
  const key = !connection ? "demo" : readOnly ? "read-only" : JSON.stringify([workspaceId, connection.access.userId, connection.access.version, companyId, kind]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; staff: StaffChoice[]; error: string } | null>(null);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (key === "demo" || key === "read-only") return;
    let cancelled = false;
    void readDirectory(key, workspaceId, companyId, kind).then(
      data => { if (!cancelled && activeWorkspace() === workspaceId) setResult({ key, attempt, staff: data.staff,
        error: data.unavailable ? "Some staff identities are unavailable. Refresh to try again." : "" }); },
      error => { if (!cancelled && activeWorkspace() === workspaceId) setResult({ key, attempt, staff: [],
        error: error instanceof Error ? error.message : "Unable to load staff. Refresh to try again." }); },
    );
    return () => { cancelled = true; };
  }, [key, workspaceId, companyId, kind, attempt]);
  if (!connection) return { staff: demoStaff, loading: false, error: "", refresh };
  if (readOnly) return { staff: [], loading: false, error: "", refresh };
  const current = result?.key === key && result.attempt === attempt ? result : null;
  return { staff: current?.staff || [], loading: !current, error: current?.error || "", refresh };
}
