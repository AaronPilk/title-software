"use client";
import { useLayoutEffect, useRef } from "react";
import { registerWorkspaceNavigationGuard, type WorkspaceNavigationScope, type WorkspaceNavigationState } from "@/lib/title/workspace-navigation-guard";

export function useWorkspaceNavigationGuard(scope: WorkspaceNavigationScope, state: WorkspaceNavigationState) {
  const current = useRef(state);
  useLayoutEffect(() => { current.current = state; }, [state]);
  useLayoutEffect(() => registerWorkspaceNavigationGuard(scope, () => current.current), [scope]);
}
