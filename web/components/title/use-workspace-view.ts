"use client";
import { useEffect, useRef, useState } from "react";
import type { Page } from "@/lib/title/model";
import { allowWorkspaceNavigation } from "@/lib/title/workspace-navigation-guard";
import {
  defaultWorkspaceView, readWorkspaceLocation, validWorkspaceView,
  viewForPage, viewPreferenceKey, workspaceHash,
  type ViewIdentity, type WorkspaceLocation, type WorkspaceView,
} from "@/lib/title/workspace-view";

const historyPositionKey = "titleWorkspacePosition";
function historyPosition() {
  const value = window.history.state?.[historyPositionKey];
  return Number.isSafeInteger(value) && Math.abs(value) < 1_000_000 ? value as number : undefined;
}
function historyState(position: number) {
  return { ...(window.history.state && typeof window.history.state === "object" ? window.history.state : {}), [historyPositionKey]: position };
}

export function useWorkspaceView(identity: ViewIdentity | undefined, demoUser: string, ready = true, onNavigationAccepted?: () => void) {
  const preferenceKey = viewPreferenceKey(identity, demoUser);
  const startingView = defaultWorkspaceView(identity, demoUser);
  const partner = identity?.role === "partner";
  const [location, setLocation] = useState<WorkspaceLocation>(() => ({
    view: startingView, page: partner ? "Partner portal" : "Overview",
  }));
  const current = useRef(location);
  const previousIdentity = useRef<string | undefined>(undefined);
  const position = useRef(0), restoring = useRef<number | null>(null);
  const accepted = useRef(onNavigationAccepted);
  useEffect(() => { accepted.current = onNavigationAccepted; }, [onNavigationAccepted]);

  useEffect(() => {
    if (!ready) return;
    let preferred = startingView;
    try {
      const saved = window.localStorage.getItem(preferenceKey);
      if (validWorkspaceView(saved)) preferred = saved;
    } catch { /* This preference is optional when browser storage is unavailable. */ }
    const identityChanged = previousIdentity.current !== undefined && previousIdentity.current !== preferenceKey;
    previousIdentity.current = preferenceKey;
    const initial = readWorkspaceLocation(identityChanged ? "" : window.location.hash, preferred, partner);
    current.current = initial;
    setLocation(initial);
    position.current = historyPosition() ?? 0;
    restoring.current = null;
    window.history.replaceState(historyState(position.current), "", identityChanged ? workspaceHash(initial) : window.location.href);
    // Identity changes are authorization boundaries, never a discard decision.
    if (identityChanged) accepted.current?.();
    const read = () => {
      const next = readWorkspaceLocation(window.location.hash, current.current.view, partner);
      if (restoring.current !== null) {
        if (historyPosition() === restoring.current) restoring.current = null;
        return;
      }
      let nextPosition = historyPosition();
      if (nextPosition === undefined) {
        nextPosition = position.current + 1;
        window.history.replaceState(historyState(nextPosition), "", window.location.href);
      }
      if (next.view === current.current.view && next.page === current.current.page) { position.current = nextPosition; return; }
      if (!allowWorkspaceNavigation()) {
        const delta = position.current - nextPosition;
        if (delta) { restoring.current = position.current; window.history.go(delta); }
        else window.history.replaceState(historyState(position.current), "", workspaceHash(current.current));
        return;
      }
      position.current = nextPosition;
      current.current = next;
      setLocation(next);
      accepted.current?.();
    };
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, [preferenceKey, startingView, partner, ready]);

  function go(next: WorkspaceLocation) {
    if (partner) next = { view: "agency", page: next.page === "Settings" ? "Settings" : "Partner portal" };
    if (restoring.current !== null || !allowWorkspaceNavigation()) return false;
    current.current = next;
    setLocation(next);
    if (window.location.hash !== workspaceHash(next)) {
      position.current++;
      window.history.pushState(historyState(position.current), "", workspaceHash(next));
    }
    accepted.current?.();
    return true;
  }
  function navigate(page: Page) {
    return go({ view: viewForPage(page, current.current.view), page });
  }
  function switchView(view: WorkspaceView) {
    if (partner || !go({ view, page: "Overview" })) return false;
    try { window.localStorage.setItem(preferenceKey, view); } catch { /* Navigation still works without persistence. */ }
    return true;
  }
  return { ...location, navigate, switchView };
}
