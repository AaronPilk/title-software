"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { backendRequest } from "@/lib/backend/client";
import type { MissiveCredentialStatus } from "@/lib/backend/missive-credentials";

export function MissiveCredentialSettings({ workspaceId, onChanged, onBusyChange }: {
  workspaceId: string; onChanged: () => void | Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<MissiveCredentialStatus | null>(null);
  const [editing, setEditing] = useState(false), [disconnecting, setDisconnecting] = useState(false);
  const [token, setToken] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0), mounted = useRef(false), operation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const current = ++generation.current;
    backendRequest<MissiveCredentialStatus>("/integrations/missive/credential")
      .then(value => { if (mounted.current && current === generation.current) setStatus(value); })
      .catch(() => { if (mounted.current && current === generation.current) setError("Connection settings could not be loaded. Refresh connection settings to try again."); })
      .finally(() => { if (mounted.current && current === generation.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [workspaceId]);
  function begin() {
    if (operation.current || loading) return null;
    operation.current = true;
    const current = ++generation.current;
    setBusy(true); setError(""); setNotice("");
    onBusyChange?.(true);
    return current;
  }
  const isCurrent = (current: number) => mounted.current && current === generation.current;
  function finish(current: number) {
    if (!isCurrent(current)) return;
    operation.current = false; setBusy(false); onBusyChange?.(false);
  }
  async function refreshMetadata() {
    const current = begin();
    if (current === null) return;
    setToken(""); setEditing(false); setDisconnecting(false); setStatus(null);
    try {
      const value = await backendRequest<MissiveCredentialStatus>("/integrations/missive/credential");
      if (!isCurrent(current)) return;
      setStatus(value); await onChanged();
      if (isCurrent(current)) setNotice("Connection settings refreshed. Review the current connection before making changes.");
    } catch { if (isCurrent(current)) setError("Connection settings could not be loaded. Refresh connection settings to try again."); }
    finally { finish(current); }
  }
  async function save(next: string | null) {
    if (!status) return;
    const current = begin();
    if (current === null) return;
    try {
      const result = await backendRequest<MissiveCredentialStatus>("/integrations/missive/credential", {
        workspaceId, expectedRevision: status.revision, token: next,
      }, "POST", 60000);
      if (!isCurrent(current)) return;
      setStatus(result); setToken(""); setEditing(false); setDisconnecting(false);
      setNotice(next ? "Connection verified and saved. Review the inbox routes you want to enable." : "Connection disconnected. Existing files and source history are preserved.");
      await onChanged();
    } catch (reason) {
      if (!isCurrent(current)) return;
      if ((reason as { status?: number })?.status === 409) {
        // Never repeat a credential change against somebody else's new revision.
        setStatus(null); setToken(""); setEditing(false); setDisconnecting(false);
        try {
          const latest = await backendRequest<MissiveCredentialStatus>("/integrations/missive/credential");
          if (!isCurrent(current)) return;
          setStatus(latest); await onChanged();
          if (isCurrent(current)) setError("The connection changed elsewhere. Latest settings are loaded. Review them before making a new change.");
        } catch { if (isCurrent(current)) setError("The connection changed elsewhere, but its latest settings could not be loaded. Refresh connection settings before trying again."); }
      } else setError(reason instanceof Error ? reason.message : "Unable to save connection settings.");
    }
    finally { finish(current); }
  }
  return <section aria-label="Missive account connection">
    <p><strong>{status ? status.configured ? "Missive account connected" : "Connect your Missive account" : loading || busy ? "Loading connection…" : "Connection settings unavailable"}</strong>
      {status?.verifiedAt && <> · Verified {new Date(status.verifiedAt).toLocaleDateString()}</>}</p>
    <p className="form-note">Your token is stored encrypted on the server for this workspace. Staff receive access through their own accounts.</p>
    <Button variant="ghost" disabled={busy || loading} onClick={() => void refreshMetadata()}>Refresh connection settings</Button>
    {!editing && !disconnecting && <div className="button-row">
      <Button variant="outline" disabled={!status || busy} onClick={() => { setEditing(true); setNotice(""); }}>{status?.configured ? "Replace token" : "Connect Missive"}</Button>
      {status?.configured && <Button variant="ghost" disabled={busy} onClick={() => { setDisconnecting(true); setNotice(""); }}>Disconnect account</Button>}
    </div>}
    {editing && <form onSubmit={e => { e.preventDefault(); void save(token); }}>
      <label>Complete Missive API token<input aria-label="Complete Missive API token" type="password" autoComplete="off" spellCheck={false} value={token} maxLength={4096} disabled={busy} onChange={e => setToken(e.target.value)} placeholder="missive_pat-…" /></label>
      <p className="form-note">Copy the entire value from Missive → Settings → API. We check it with Missive before saving. Replacing a token pauses existing inbox routes for a fresh review.</p>
      <div className="button-row"><Button type="submit" disabled={busy || !token}>{busy ? "Verifying…" : "Verify and save connection"}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { setToken(""); setEditing(false); setError(""); }}>Cancel</Button></div>
    </form>}
    {disconnecting && <div>
      <p>Disconnect this workspace from Missive and pause its inbox routes? Saved title files stay available.</p>
      <Button disabled={busy} onClick={() => void save(null)}>{busy ? "Disconnecting…" : "Confirm disconnect"}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setDisconnecting(false)}>Keep connection</Button>
    </div>}
    {error && <p role="alert" className="form-note">{error}</p>}
    {notice && <p role="status" className="form-note">{notice}</p>}
  </section>;
}
