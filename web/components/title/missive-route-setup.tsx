"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { backendRequest } from "@/lib/backend/client";
import { useWorkspace } from "@/lib/title/store";

type Proposal = { revision: number; fingerprint: string; skippedCount: number;
  proposals: { companyId: string; companyName: string; organizationId: string; teamId: string; teamName: string }[] };
export function MissiveRouteSetup({ onConnected }: { onConnected: () => void }) {
  const { connection } = useWorkspace();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!connection || !(connection.access.role === "owner" || connection.access.role === "admin" && connection.access.allCompanies)) return null;
  const ctx = connection;
  async function review() {
    setBusy(true); setError(""); setProposal(null);
    try {
      const result = await backendRequest<Proposal>("/integrations/missive/company-routes", undefined, "GET", 30000, ctx.workspaceId, ctx.access.userId, true);
      if (alive.current) setProposal(result);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not review the company inboxes."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function connect() {
    if (!proposal || busy) return;
    setBusy(true); setError("");
    try {
      await backendRequest("/integrations/missive/company-routes", { workspaceId: ctx.workspaceId, expectedRevision: proposal.revision, fingerprint: proposal.fingerprint }, "POST", 30000, ctx.workspaceId, ctx.access.userId, true);
      if (alive.current) { setProposal(null); onConnected(); }
    } catch (e) { if (alive.current) { setProposal(null); setError(e instanceof Error ? e.message : "Could not connect the inboxes. Review the list again."); } }
    finally { if (alive.current) setBusy(false); }
  }
  return <section aria-label="Connect company inboxes" className="panel" style={{ padding: 24, maxWidth: 760, marginTop: 20 }}>
    <h3>Connect the company inboxes you already imported</h3>
    <p className="subtle">We’ll verify the saved Missive inbox IDs against your connection. Emails stay in Missive and appear here for reading.</p>
    {error && <p role="alert">{error}</p>}
    {!proposal ? <Button variant="outline" disabled={busy} onClick={review}>{busy ? "Checking inboxes…" : "Review company inboxes"}</Button> : <>
      <div style={{ maxHeight: 280, overflow: "auto", marginBlock: 16 }}>
        <ul aria-label="Reviewed company inbox matches" style={{ listStyle: "none", padding: 0 }}>
          {proposal.proposals.map(p => <li key={`${p.companyId}:${p.teamId}`} style={{ paddingBlock: 10, borderBottom: "1px solid var(--border)" }}><strong>{p.companyName}</strong><span className="subtle" style={{ display: "block" }}>Missive inbox: {p.teamName}</span></li>)}
        </ul>
      </div>
      <p className="subtle">{proposal.proposals.length} inboxes matched by their saved IDs. {proposal.skippedCount > 0 ? `${proposal.skippedCount} companies have no new, unambiguous inbox match.` : ""}</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button disabled={busy || !proposal.proposals.length} onClick={connect}>{busy ? "Connecting…" : `Connect ${proposal.proposals.length} inboxes`}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>Cancel</Button>
      </div>
    </>}
  </section>;
}
