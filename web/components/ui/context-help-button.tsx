"use client";

import { CircleHelp } from "lucide-react";
import { useOpenProductHelp } from "@/lib/assistant/help-ui-context";

export function ContextHelpButton() {
  const openHelp = useOpenProductHelp();
  if (!openHelp) return null;
  return <button type="button" onClick={openHelp}
    className="mt-2 inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
    <CircleHelp size={14} aria-hidden="true" />Ask for help
  </button>;
}
