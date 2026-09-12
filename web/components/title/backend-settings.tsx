"use client";
import { useEffect, useState } from "react";
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

export function BackendSettings() {
  const { s, connection } = useWorkspace();
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("operations"),
    [company, setCompany] = useState(""),
    [memberName, setMemberName] = useState(""),
    [members, setMembers] = useState<any[]>([]),
    [invites, setInvites] = useState<any[]>([]),
    [backups, setBackups] = useState<any[]>([]),
    [selectedBackup, setSelectedBackup] = useState(""),
    [restoreConfirm, setRestoreConfirm] = useState(""),
    [busy, setBusy] = useState(false);
  const admin =
    connection &&
    (connection.access.role === "owner" ||
      (connection.access.role === "admin" && connection.access.allCompanies));
  async function load() {
    if (!admin) return;
    try {
      const [m, b] = await Promise.all([
        backendRequest("/members"),
        backendRequest("/backups"),
      ]);
      setMembers(m.members);
      setInvites(m.invitations);
      setBackups(b.backups);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Unable to refresh access settings.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, [admin]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
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
          <h2>Shared workspace</h2>
        </div>
        <Button variant="outline" onClick={() => void connection.refresh()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
      <p>
        Signed in as <strong>{connection.access.email}</strong> ·{" "}
        {connection.access.role} · revision {connection.revision}
      </p>
      <p className="form-note">
        Records and uploaded files are stored in the Title Software Supabase
        project. Vendor connections remain pending their account access.
      </p>
      <Button variant="outline" onClick={() => void supabase?.auth.signOut()}>
        <LogOut />
        Sign out
      </Button>
      {admin && (
        <>
          <MissiveSettings key={activeWorkspace()} workspaceId={activeWorkspace()} />
          <div className="backend-settings-section">
            <h3>
              <Users size={18} /> Team access
            </h3>
            <p>
              Prepare access for a verified account. This records an invitation;
              it does not send an email.
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
                    "Access invitation prepared. The person can create and verify their account, then sign in.",
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
                  onChange={setRole}
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
                  onChange={setCompany}
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
          </div>
          <div className="backend-settings-section">
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
          </div>
        </>
      )}
    </section>
  );
}
