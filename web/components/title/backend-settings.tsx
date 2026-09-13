"use client";
import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, LogOut, Users, Archive } from "lucide-react";
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

export type BackendSettingsSection = "Account" | "Connections" | "Team & access" | "Recovery";
type Membership = { user_id: string; role: string; company_ids: string[]; all_companies: boolean; active: boolean };
type Invitation = { id: string; email: string; role: string; revoked_at: string | null; accepted_at: string | null };
type RecoveryPoint = { id: string; revision: number; created_at: string };
type SettingsData = { members?: Membership[]; invitations?: Invitation[]; backups?: RecoveryPoint[] };

export function BackendSettings({ section = "Account" }: { section?: BackendSettingsSection }) {
  const { s, connection } = useWorkspace();
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("operations"),
    [company, setCompany] = useState(""),
    [memberName, setMemberName] = useState(""),
    [members, setMembers] = useState<Membership[]>([]),
    [invites, setInvites] = useState<Invitation[]>([]),
    [backups, setBackups] = useState<RecoveryPoint[]>([]),
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
    const path = section === "Team & access" ? "/members" : section === "Recovery" ? "/backups" : "";
    if (!path) return {};
    const result = await backendRequest<SettingsData>(path);
    return activeWorkspace() === workspaceId ? result : {};
  }, [admin, section, workspaceId]);
  const acceptSettings = useCallback((data: SettingsData) => {
    if (data.members) setMembers(data.members);
    if (data.invitations) setInvites(data.invitations);
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
          {section === "Team & access" && <div className="backend-settings-section">
            <h3>
              <Users size={18} /> Team access
            </h3>
            <p>
              Assign a role and company scope. Access invitations are recorded here;
              share sign-in instructions with the person separately.
            </p>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await backendRequest("/members/invite", {
                    workspaceId: activeWorkspace(),
                    email,
                    role,
                    companyIds: company ? [company] : [],
                    allCompanies: company === "" && role !== "partner",
                    restricted: role === "onboarding",
                    partnerMembers:
                      role === "partner"
                        ? [{ companyId: company, memberName }]
                        : [],
                  });
                  setEmail("");
                  toast.success(
                    "Access invitation prepared. Share account setup and sign-in instructions separately.",
                  );
                });
              }}
            >
              <label>
                Email
                <Input
                  aria-label="Invitation email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Role
                <Picker
                  label="Invitation role"
                  value={role}
                  onChange={(value) => { setRole(value); setMemberName(""); }}
                  options={[
                    "operations",
                    "onboarding",
                    "finance",
                    "viewer",
                    "partner",
                    ...(connection.access.role === "owner" ? ["admin"] : []),
                  ]}
                />
              </label>
              <label>
                Company
                <Picker
                  label="Invitation company"
                  value={company}
                  onChange={(value) => { setCompany(value); setMemberName(""); }}
                  options={[
                    { value: "", label: "All companies (staff only)" },
                    ...s.companies.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </label>
              {role === "partner" && (
                <label>
                  Member identity
                  <Picker
                    label="Partner member identity"
                    value={memberName}
                    onChange={setMemberName}
                    options={(
                      s.companies.find((c) => c.id === company)?.members || []
                    ).map((m) => m.name)}
                  />
                </label>
              )}
              <Button
                type="submit"
                disabled={
                  busy || (role === "partner" && (!company || !memberName))
                }
              >
                Prepare access invitation
              </Button>
            </form>
            <div className="backend-access-list">
              {members.map((m) => (
                <div key={m.user_id}>
                  <span>
                    {m.user_id === connection.access.userId
                      ? connection.access.email
                      : m.user_id}
                    <small>
                      {m.role} · {m.active ? "Active" : "Revoked"}
                    </small>
                    <small>{m.all_companies ? "All companies" : (m.company_ids || []).map((id: string) => s.companies.find((company) => company.id === id)?.name || "Unavailable company").join(", ") || "No company access assigned"}</small>
                  </span>
                  {m.active &&
                    m.role !== "owner" &&
                    m.user_id !== connection.access.userId && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await backendRequest("/members/revoke", {
                              workspaceId: activeWorkspace(),
                              userId: m.user_id,
                            });
                            toast.success("Access revoked.");
                          })
                        }
                      >
                        Revoke access
                      </Button>
                    )}
                </div>
              ))}
            </div>
            {invites
              .filter((i) => !i.revoked_at && !i.accepted_at)
              .map((i) => (
                <p className="form-note" key={i.id}>
                  {i.email} · {i.role} · awaiting verified sign-in
                </p>
              ))}
          </div>}
          {section === "Recovery" && <div className="backend-settings-section">
            <h3>
              <Archive size={18} /> Server recovery points
            </h3>
            <p>
              Snapshots preserve shared records and references to immutable
              uploaded files. A restore preserves the audit trail and first
              saves the current version.
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
          </div>}
        </>
      )}
    </section>
  );
}
