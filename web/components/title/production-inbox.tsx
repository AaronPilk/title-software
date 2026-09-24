"use client";
import { useState } from "react";
import { useWorkspace } from "@/lib/title/store";
import { Segments } from "./shared";
import { InboxView } from "./operations";
import { MissiveLiveInbox } from "./missive-live-inbox";

export function ProductionInbox({ view, onSettings, onOpenFile, onCreateFile, ...actions }: {
  view: "agency" | "production";
  onSettings: () => void;
  onOpenFile?: (orderId: string) => void;
  onCreateFile?: (companyId?: string) => void;
  onReview: (id: string) => void;
  onRevision: (id: string) => void;
  onCommitment: (id: string) => void;
}) {
  const { connection } = useWorkspace();
  const canReadEmail = !!connection && ["owner", "admin", "operations"].includes(connection.access.role);
  const [section, setSection] = useState("Live email");
  if (!canReadEmail) return <InboxView {...actions} />;
  return <>
    <div className="toolbar" style={{ marginBottom: 24 }}>
      <Segments value={section} onChange={setSection} items={["Live email", "Saved requests"]} />
    </div>
    {section === "Live email" ? <MissiveLiveInbox key={`${connection.workspaceId}:${connection.access.userId}:${view}`} onSettings={onSettings} onOpenFile={onOpenFile} onCreateFile={onCreateFile} /> : <InboxView {...actions} />}
  </>;
}
