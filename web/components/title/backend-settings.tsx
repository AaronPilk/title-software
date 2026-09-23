"use client";
import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, LogOut, Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useWorkspace } from "@/lib/title/store";
import {
  activeWorkspace,
  backendRequest,
  supabase,
} from "@/lib/backend/client";
import { Picker } from "./shared";
import { MissiveSettings } from "./missive-settings";
import { TeamAccess } from "./team-access";
import { OriginalFileRecovery } from "./original-file-recovery";

export type BackendSettingsSection = "Account" | "Connections" | "Team & access" | "Recovery";
type RecoveryPoint = { id: string; revision: number; created_at: string };
type SettingsData = { backups?: RecoveryPoint[] };

export function BackendSettings({ section = "Account" }: { section?: BackendSettingsSection }) {
  const { connection } = useWorkspace();
  const access = connection?.access;
  const identity = JSON.stringify([activeWorkspace(), access?.userId, access?.role, access?.version, access?.allCompanies, access?.restricted, access?.companyIds, section]);
  return <BackendSettingsContent key={identity} section={section} />;
}

function BackendSettingsContent({ section }: { section: BackendSettingsSection }) {
  const { s, connection } = useWorkspace();
  const [backups, setBackups] = useState<RecoveryPoint[]>([]),
    [selectedBackup, setSelectedBackup] = useState(""),
    [restoreConfirm, setRestoreConfirm] = useState(""),
    [busy, setBusy] = useState(false);
  const admin =
    connection &&
    (connection.access.role === "owner" ||
      (connection.access.role === "admin" && connection.access.allCompanies));
  const workspaceId = activeWorkspace();
  const readSettings = useCallback(async (): Promise<SettingsData> => {
    if (!admin) return {};
    const path = section === "Recovery" ? "/backups" : "";
    if (!path) return {};
    const result = await backendRequest<SettingsData>(path);
    return activeWorkspace() === workspaceId ? result : {};
  }, [admin, section, workspaceId]);
  const acceptSettings = useCallback((data: SettingsData) => {
    if (data.backups) setBackups(data.backups);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void readSettings().then(
      (data) => { if (!cancelled) acceptSettings(data); },
      (error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to refresh settings."); },
    );
    return () => { cancelled = true; };
  }, [readSettings, acceptSettings]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      acceptSettings(await readSettings());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!connection) return null;
  if (admin && section === "Team & access") return <TeamAccess workspaceId={workspaceId} companies={s.companies} access={connection.access} refreshWorkspace={connection.refresh} />;
  return (
    <section className="panel backend-settings">
      <div className="section-heading">
        <div>
          <Cloud size={20} />
          <h2>{section === "Account" ? "Your account" : section}</h2>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void act(async () => { await connection.refresh(); })}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
      {section === "Account" && <>
      <p>
        Signed in as <strong>{connection.access.email}</strong> ·{" "}
        {connection.access.role} · revision {connection.revision}
      </p>
      <p className="form-note">
        Your changes and uploaded documents are saved to the shared workspace.
        Company access is assigned by your administrator.
      </p>
      <p className="form-note">{connection.access.allCompanies ? "Access to all companies" : `Access to ${s.companies.length} assigned ${s.companies.length === 1 ? "company" : "companies"}`}{connection.access.restricted ? " · Restricted evidence access enabled" : ""}</p>
      <Button variant="outline" onClick={() => void supabase?.auth.signOut()}>
        <LogOut />
        Sign out
      </Button>
      </>}
      {!admin && section !== "Account" && <p className="form-note">An organization-wide administrator manages {section === "Connections" ? "vendor connections" : section === "Recovery" ? "recovery points" : "team access"}. Your assigned role and companies are shown in Account.</p>}
      {admin && (
        <>
          {section === "Connections" && <MissiveSettings key={workspaceId} workspaceId={workspaceId} />}
          {section === "Recovery" && <div className="backend-settings-section">
            <h3>
              <Archive size={18} /> Server recovery points
            </h3>
            <p>
              Snapshots preserve shared records and references to immutable
              uploaded files; they do not make independent copies of those
              bytes. A restore requires the originals to remain in storage,
              preserves the audit trail, and first saves the current version.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await backendRequest("/backups", {
                    workspaceId: activeWorkspace(),
                  });
                  toast.success("Server recovery point created.");
                })
              }
            >
              <Archive />
              Create recovery point
            </Button>
            {backups.length > 0 && (
              <>
                <Picker
                  label="Recovery point"
                  value={selectedBackup}
                  onChange={setSelectedBackup}
                  options={backups.map((b) => ({
                    value: b.id,
                    label: `Revision ${b.revision} · ${new Date(b.created_at).toLocaleString()}`,
                  }))}
                />
                {connection.access.role === "owner" && (
                  <>
                    <label>
                      Type RESTORE to recover this version
                      <Input
                        aria-label="Confirm server restore"
                        value={restoreConfirm}
                        onChange={(e) => setRestoreConfirm(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      disabled={
                        busy || !selectedBackup || restoreConfirm !== "RESTORE"
                      }
                      onClick={() =>
                        void act(async () => {
                          await backendRequest("/backups/restore", {
                            workspaceId: activeWorkspace(),
                            backupId: selectedBackup,
                            expectedRevision: connection.revision,
                          });
                          setRestoreConfirm("");
                          await connection.refresh();
                          toast.success("Recovery point restored.");
                        })
                      }
                    >
                      Restore selected recovery point
                    </Button>
                  </>
                )}
              </>
            )}
            <OriginalFileRecovery workspaceId={workspaceId} />
          </div>}
        </>
      )}
    </section>
  );
}
