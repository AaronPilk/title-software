"use client";

/** Navigation guards hold status only. Private form values stay in their component. */
export type WorkspaceNavigationScope = "workspace" | "company-detail";
export type WorkspaceNavigationState = { dirty: boolean; busy: boolean };
const guards = new Map<symbol, { scope: WorkspaceNavigationScope; state: () => WorkspaceNavigationState }>();

function states(scope?: WorkspaceNavigationScope) {
  return [...guards.values()].filter(guard => !scope || guard.scope === scope).map(guard => guard.state());
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (states().some(state => state.dirty || state.busy)) {
    event.preventDefault(); event.returnValue = "";
  }
}
export function registerWorkspaceNavigationGuard(scope: WorkspaceNavigationScope, state: () => WorkspaceNavigationState) {
  const key = Symbol();
  if (!guards.size) window.addEventListener("beforeunload", beforeUnload);
  guards.set(key, { scope, state });
  return () => {
    guards.delete(key);
    if (!guards.size) window.removeEventListener("beforeunload", beforeUnload);
  };
}
/** A busy write cannot be discarded. One decision covers all drafts that will close. */
export function allowWorkspaceNavigation(scope?: WorkspaceNavigationScope) {
  const current = states(scope);
  if (current.some(state => state.busy)) return false;
  return !current.some(state => state.dirty) || window.confirm("Discard unsaved changes? Save them first to keep your work.");
}
