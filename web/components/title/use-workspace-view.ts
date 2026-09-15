"use client";
import { useEffect, useRef, useState } from "react";
import type { Page } from "@/lib/title/model";
import {
  defaultWorkspaceView, readWorkspaceLocation, validWorkspaceView,
  viewForPage, viewPreferenceKey, workspaceHash,
  type ViewIdentity, type WorkspaceLocation, type WorkspaceView,
} from "@/lib/title/workspace-view";

export function useWorkspaceView(identity: ViewIdentity | undefined, demoUser: string, ready = true) {
  const preferenceKey = viewPreferenceKey(identity, demoUser);
  const startingView = defaultWorkspaceView(identity, demoUser);
  const partner = identity?.role === "partner";
  const [location, setLocation] = useState<WorkspaceLocation>(() => ({
    view: startingView, page: partner ? "Partner portal" : "Overview",
  }));
  const current = useRef(location);
  const previousIdentity = useRef<string | undefined>(undefined);

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
    if (identityChanged) window.history.replaceState(null, "", workspaceHash(initial));
    const read = () => {
      const next = readWorkspaceLocation(window.location.hash, current.current.view, partner);
      current.current = next;
      setLocation(next);
    };
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [preferenceKey, startingView, partner, ready]);

  function go(next: WorkspaceLocation) {
    if (partner) next = { view: "agency", page: next.page === "Settings" ? "Settings" : "Partner portal" };
    current.current = next;
    setLocation(next);
    window.location.hash = workspaceHash(next);
  }
  function navigate(page: Page) {
    go({ view: viewForPage(page, current.current.view), page });
  }
  function switchView(view: WorkspaceView) {
    if (partner) return;
    try { window.localStorage.setItem(preferenceKey, view); } catch { /* Navigation still works without persistence. */ }
    go({ view, page: "Overview" });
  }
  return { ...location, navigate, switchView };
}
