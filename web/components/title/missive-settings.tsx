"use client";
import { useEffect, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { backendRequest } from "@/lib/backend/client";
import type { MissiveCheck, MissiveSetup } from "@/lib/backend/missive";

export function MissiveSettings({ workspaceId }: { workspaceId: string }) {
  const [setup, setSetup] = useState<MissiveSetup | null>(null);
  const [check, setCheck] = useState<MissiveCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    backendRequest<MissiveSetup>("/integrations/missive")
      .then(value => { if (!cancelled) setSetup(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load Missive settings."); });
    return () => { cancelled = true; };
  }, [workspaceId]);
  async function verify() {
    setBusy(true); setError(""); setCheck(null);
    try {
      const current = await backendRequest<MissiveSetup>("/integrations/missive");
      setSetup(current);
      if (current.status === "ready")
        setCheck(await backendRequest<MissiveCheck>("/integrations/missive/check", { workspaceId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to check Missive.");
    } finally { setBusy(false); }
  }
  return (
    <div className="backend-settings-section">
      <h3><Mail size={18} /> Missive</h3>
      <p>Verify access to your Missive organizations and team inboxes. Message importing is not enabled yet.</p>
      {setup?.status === "workspace_required" && <p className="form-note">Your administrator needs to assign this workspace to the Missive connection before it can be checked.</p>}
      {setup?.status === "token_required" && <p className="form-note">The Missive token needs to be added to the server’s secret settings.</p>}
      {setup?.status === "ready" && !check && <p className="form-note">Server settings are present. Check the connection to verify access.</p>}
      <Button variant="outline" disabled={busy} onClick={() => void verify()}>
        <RefreshCw size={16} /> {busy ? "Checking…" : "Check Missive connection"}
      </Button>
      {error && <p role="alert" className="form-note">{error}</p>}
      {check && <div role="status">
        <p><strong>Connection verified.</strong> Inbox selection and message importing are not enabled yet.</p>
        <p className="form-note">Checked {new Date(check.checkedAt).toLocaleString()}. This check reads organization and team metadata; no messages.</p>
        {check.organizations.length > 0 && <p>Organizations: {check.organizations.map(row => row.name).join(", ")}</p>}
        {check.teamInboxes.length > 0 ? <ul>
          {check.teamInboxes.map(row => <li key={row.id}>{row.name}</li>)}
        </ul> : <p>No team inboxes were returned. Shared email accounts may still be available in Missive.</p>}
        {(check.moreOrganizations || check.moreTeams) && <p className="form-note">Showing the first 200 results for each directory. Additional results may be available in Missive.</p>}
      </div>}
    </div>
  );
}
