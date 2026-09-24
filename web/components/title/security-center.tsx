"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { exportSecurityEvents, listSecurityEvents, loadSecurityCenter, loadSecurityMemberLabels, recordAccessReview } from "@/lib/backend/security-center-client";
import { securityReadiness, type SecurityCenterSummary, type SecurityEventPage, type SecurityMemberLabel, type SecurityCompanyLabel } from "@/lib/backend/security-center";

type SecurityCenterProps = { workspaceId: string; userId: string; companies?: readonly SecurityCompanyLabel[] };
export function SecurityCenter({ workspaceId, userId, companies }: SecurityCenterProps) {
  return <SecurityCenterSession key={`${workspaceId}:${userId}`} workspaceId={workspaceId} userId={userId} companies={companies} />;
}
function SecurityCenterSession({ workspaceId, userId, companies }: SecurityCenterProps) {
  const [summary, setSummary] = useState<SecurityCenterSummary | null>(null);
  const [events, setEvents] = useState<SecurityEventPage | null>(null);
  const [memberLabels, setMemberLabels] = useState<SecurityMemberLabel[]>([]);
  const [labelsUnavailable, setLabelsUnavailable] = useState(false);
  const [note, setNote] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(true);
  const identity = `${workspaceId}:${userId}`;
  const generation = useRef(0);
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError(""); setAcknowledged(false);
    try {
      const [nextSummary, nextEvents, nextLabels] = await Promise.all([
        loadSecurityCenter(workspaceId, userId), listSecurityEvents(workspaceId, userId),
        loadSecurityMemberLabels(workspaceId, userId).then(labels => ({ labels, unavailable: false })).catch((error: unknown) => {
          // Authorization or identity failures must clear all evidence. A label
          // service outage may fall back to explicit IDs, never guessed names.
          const status = (error as { status?: number } | null)?.status;
          if (status === 401 || status === 403) throw error;
          return { labels: [], unavailable: true };
        }),
      ]);
      if (current !== generation.current) return;
      setLoadedIdentity(identity); setSummary(nextSummary); setEvents(nextEvents); setMemberLabels(nextLabels.labels); setLabelsUnavailable(nextLabels.unavailable);
    } catch (e) {
      if (current !== generation.current) return;
      setSummary(null); setEvents(null); setMemberLabels([]); setError(e instanceof Error ? e.message : "Unable to load security evidence.");
    } finally { if (current === generation.current) setBusy(false); }
  }, [workspaceId, userId, identity]);
  const cancelRequests = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => { active = false; cancelRequests(); };
  }, [refresh, cancelRequests]);
  const visible = loadedIdentity === identity ? summary : null;
  async function review() {
    if (!visible || !acknowledged || !note.trim()) return;
    const current = generation.current; setBusy(true); setError(""); setNotice("");
    try {
      await recordAccessReview({ workspaceId, snapshotDigest: visible.snapshotDigest, note }, userId);
      if (current !== generation.current) return;
      setNote(""); setAcknowledged(false); setNotice("Access review recorded. Permissions are unchanged."); await refresh();
    } catch (e) {
      if (current !== generation.current) return;
      setAcknowledged(false); setError(e instanceof Error ? e.message : "Unable to record the review.");
    } finally { if (current === generation.current) setBusy(false); }
  }
  async function older() {
    if (!events?.nextCursor) return;
    const current = generation.current; setBusy(true); setError("");
    try { const next = await listSecurityEvents(workspaceId, userId, events.nextCursor); if (current === generation.current) setEvents(next); }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Unable to load older events."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function exportPage() {
    const current = generation.current; setBusy(true); setError("");
    try {
      const page = await exportSecurityEvents(workspaceId, userId);
      if (current !== generation.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(page, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "security-events-latest-page.json"; link.click(); URL.revokeObjectURL(url);
      setNotice(`Exported ${page.items.length} recent events.${page.nextCursor ? " Older events remain available through the paginated export endpoint." : ""}`);
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Unable to export events."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const stamp = (value: string) => new Date(value).toLocaleString();
  const emails = new Map(memberLabels.map(member => [member.userId, member.email]));
  const companyNames = new Map(companies?.map(company => [company.id, company.name]));
  return <section aria-label="Security center" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Security center</h2><p className="text-sm text-muted-foreground">Review access and retained security evidence. This screen does not certify compliance.</p></div><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh security evidence</Button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!visible && busy && <p role="status">Loading security evidence…</p>}
    {visible && <>
      <p className="text-xs text-muted-foreground">Evidence checked {stamp(visible.checkedAt)}</p>
      <div className="grid gap-3 md:grid-cols-2">{securityReadiness(visible).map(control => <article key={control.id} className="rounded-lg border p-4"><h3 className="font-medium">{control.label}</h3><p className="text-xs uppercase text-muted-foreground">{control.status.replaceAll("_", " ")}</p><p className="mt-2 text-sm">{control.detail}</p></article>)}</div>
      {visible.documentScanning && <article className="rounded-lg border p-4"><h3 className="font-medium">Document scanning</h3><p className="text-sm">{visible.documentScanning.policy === "pending_setup" ? "Needs review — NOT ACTIVATED. Hosted scanner setup and policy activation are required. Uploads can currently enter without a clean scan." : "New uploads require a clean scan before ingestion; scanner failure blocks ingestion."}</p><p className="text-sm">Connected configuration: {visible.documentScanning.configured ? "present" : "missing"}. Originals without scan evidence: {visible.documentScanning.legacyUnscannedCount}. Configuration presence does not verify scanner health.</p></article>}
      <article className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">Review staff access</h3><p className="text-sm">Review every account’s role, company scope, restricted-record access and membership version. Email labels come from the current staff directory; the saved review contains account IDs.</p>
        {labelsUnavailable && <p className="text-sm text-muted-foreground">Member labels are unavailable. Refresh to retry, or use the account IDs to check the staff directory.</p>}
        {visible.latestReview && <p className="text-sm">Last review: {stamp(visible.latestReview.createdAt)} by {visible.latestReview.actorId}. {visible.latestReview.current ? "Snapshot still matches." : "Review is stale; access or company scope changed."}<br />Note: {visible.latestReview.note}</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Current membership snapshot</caption><thead><tr>{["Staff account", "Role", "Companies", "Restricted records", "Status", "Version"].map(heading => <th key={heading} className="p-2">{heading}</th>)}</tr></thead><tbody>{visible.snapshot.members.map(member => <tr key={member.userId} className="border-t"><td className="p-2"><span className="block text-sm">{emails.get(member.userId) ?? "Email unavailable"}</span><span className="block font-mono text-[11px] text-muted-foreground">{member.userId}</span></td><td className="p-2">{member.role}</td><td className="p-2">{member.allCompanies ? "All companies" : member.companyIds.length ? member.companyIds.map(companyId => <span className="block" key={companyId}>{companyNames.get(companyId) || "Company name unavailable"}<span className="ml-1 font-mono text-[11px] text-muted-foreground">({companyId})</span></span>) : "None"}</td><td className="p-2">{member.restricted ? "Allowed" : "Not allowed"}</td><td className="p-2">{member.active ? "Active" : "Inactive"}</td><td className="p-2">{member.version}</td></tr>)}</tbody></table></div>
        <label className="block text-sm">Review note<textarea aria-label="Review note" className="mt-1 block w-full rounded-md border p-2" value={note} onChange={event => { setNote(event.target.value); setNotice(""); }} maxLength={1000} rows={3} disabled={busy} placeholder="Record the review outcome and follow-up owner; omit client data, credentials and secrets." /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the displayed account permissions and recorded any follow-up needed.</label>
        <Button disabled={busy || !acknowledged || !note.trim()} onClick={() => void review()}>Record access review</Button><p className="text-xs text-muted-foreground">Recording a review does not grant or revoke access. Membership changes invalidate this acknowledgement.</p>
      </article>
      <article className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">Recent security events</h3><Button variant="outline" disabled={busy} onClick={() => void exportPage()}>Export latest 100 events</Button></div><p className="text-xs text-muted-foreground">Metadata only: no document content, filenames, credentials or raw errors. Event history begins when collection is deployed.</p>
        {!events?.items.length ? <p className="text-sm">No security events have been recorded.</p> : <ul className="space-y-2">{events.items.map(event => <li key={event.id} className="border-t pt-2 text-sm"><span className="font-medium">{event.eventType}</span> · {event.outcome} · {stamp(event.createdAt)}<div className="break-all text-xs text-muted-foreground">Actor {event.actorId ?? "background or recipient service"}{event.companyId ? ` · Company ${event.companyId}` : ""}{event.recordId ? ` · ${event.recordType} ${event.recordId}` : ""}{event.count !== null ? ` · Count ${event.count}` : ""}</div></li>)}</ul>}
        {events?.nextCursor && <Button variant="outline" disabled={busy} onClick={() => void older()}>Older security events</Button>}
      </article>
    </>}
  </section>;
}
