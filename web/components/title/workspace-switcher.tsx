"use client";
import { Building2, Files } from "lucide-react";
import type { WorkspaceView } from "@/lib/title/workspace-view";
import styles from "./workspace-switcher.module.css";

export function WorkspaceSwitcher({ view, onChange }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void }) {
  return <div className={styles.switcher}>
    <p className={styles.label}>Your workspace</p>
    <div className={styles.choices} role="group" aria-label="Workspace view">
      <button type="button" aria-pressed={view === "agency"} onClick={() => onChange("agency")}>
        <Building2 size={16} aria-hidden="true" /> Agency
      </button>
      <button type="button" aria-pressed={view === "production"} onClick={() => onChange("production")}>
        <Files size={16} aria-hidden="true" /> Production
      </button>
    </div>
    <p className={styles.description}>{view === "agency" ? "Companies, partners & business operations" : "Title files, requests & policy work"}</p>
  </div>;
}
