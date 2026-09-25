"use client";
import { useState } from "react";
import type { CompanyDetailTab } from "./companies";
import { allowWorkspaceNavigation } from "@/lib/title/workspace-navigation-guard";

/** Every accepted entry is fresh, even when reopening the same original. */
export function useCompanyDetailNavigation() {
  const [entry, setEntry] = useState({ id: "", tab: "Overview" as CompanyDetailTab, sourceId: "", generation: 0 });
  function open(id: string, tab: CompanyDetailTab = "Overview", sourceId = "") {
    if (!allowWorkspaceNavigation("company-detail")) return false;
    enterAfterNavigation(id, tab, sourceId);
    return true;
  }
  // Use only after the workspace route guard already accepted the transition.
  function enterAfterNavigation(id: string, tab: CompanyDetailTab = "Overview", sourceId = "") {
    setEntry(current => ({ id, tab, sourceId, generation: current.generation + 1 }));
  }
  // Caller has either passed its navigation guard or must clear on access change.
  function clear() { setEntry(current => ({ ...current, id: "", sourceId: "" })); }
  return { entry, open, clear, enterAfterNavigation };
}
