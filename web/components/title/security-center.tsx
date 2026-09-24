"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Archive, ArrowDownToLine, Check, ChevronDown, FileSearch, Info, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "../ui/button";
import styles from "./security-center.module.css";
import { exportSecurityEvents, listSecurityEvents, loadSecurityCenter, loadSecurityMemberLabels, recordAccessReview } from "@/lib/backend/security-center-client";
import type { SecurityCenterSummary, SecurityEventPage, SecurityMemberLabel, SecurityCompanyLabel, SecurityEventType } from "@/lib/backend/security-center";

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
  const stamp = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const emails = new Map(memberLabels.map(member => [member.userId, member.email]));
  const companyNames = new Map(companies?.map(company => [company.id, company.name]));
  const reviewCurrent = visible?.latestReview?.current;
  return <section aria-label="Security center" className={styles.root}>
    <header className={styles.header}>
      <div className={styles.headingGroup}>
        <span className={styles.heroIcon}><ShieldCheck size={26} strokeWidth={1.6} aria-hidden="true" /></span>
        <div><h2>Security center</h2><p>Manage access. Keep a clear record.</p></div>
      </div>
      <div className={styles.refreshGroup}>
        <Button className={styles.button} variant="outline" disabled={busy} onClick={() => void refresh()} aria-label="Refresh security evidence"><RefreshCw size={15} aria-hidden="true" />Refresh</Button>
        {visible && <span className={styles.checked}>Updated {stamp(visible.checkedAt)}</span>}
      </div>
    </header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}><Check size={17} aria-hidden="true" />{notice}</p>}
    {!visible && busy && <p role="status" className={styles.loading}>Loading security evidence…</p>}
    {visible && <>
      <div className={styles.metrics}>
        <article className={styles.metric}>
          <div className={styles.metricHeading}><span className={styles.icon}><Users size={19} aria-hidden="true" /></span><h3>Access review</h3><span className={styles.badge} data-tone={reviewCurrent ? "neutral" : "amber"}>{reviewCurrent ? "Recorded" : "Needs review"}</span></div>
          <strong className={styles.metricValue}>{visible.snapshot.members.length}<span>staff {visible.snapshot.members.length === 1 ? "account" : "accounts"}</span></strong>
          <p>{reviewCurrent ? "Current permissions match the last review." : visible.latestReview ? "Permissions have changed. Review access again." : "Confirm each person has the right access."}</p>
          <a className={styles.textAction} href="#security-access-review" onClick={event => { event.preventDefault(); document.getElementById("security-access-review")?.focus(); }}>Review staff access <span aria-hidden="true">→</span></a>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricHeading}><span className={styles.icon}><Activity size={19} aria-hidden="true" /></span><h3>Security activity</h3></div>
          <strong className={styles.metricValue}>{visible.evidence.eventCount}<span>recorded {visible.evidence.eventCount === 1 ? "event" : "events"}</span></strong>
          <p>{visible.evidence.lastEventAt ? `Latest activity ${stamp(visible.evidence.lastEventAt)}.` : "Events appear here as activity is recorded."}</p>
          <span className={styles.metricFoot}>Event counts do not measure monitoring coverage.</span>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricHeading}><span className={styles.icon}><Archive size={19} aria-hidden="true" /></span><h3>Recovery points</h3></div>
          <strong className={styles.metricValue}>{visible.evidence.backupCount}<span>workspace {visible.evidence.backupCount === 1 ? "snapshot" : "snapshots"}</span></strong>
          <p>{visible.evidence.lastBackupAt ? `Latest snapshot ${stamp(visible.evidence.lastBackupAt)}.` : "Create a recovery point in Settings → Recovery."}</p>
          <span className={styles.metricFoot}>Original-file recovery needs a separate restore test.</span>
        </article>
      </div>
      {visible.documentScanning && <article className={styles.scanning} data-pending={visible.documentScanning.policy === "pending_setup"} aria-label="Document scanning">
        <span className={styles.scanIcon}><FileSearch size={23} strokeWidth={1.7} aria-hidden="true" /></span>
        <div className={styles.scanContent}>
          <div className={styles.scanHeading}><h3>Document scanning</h3><span className={styles.badge} data-tone={visible.documentScanning.policy === "pending_setup" ? "amber" : "neutral"}>{visible.documentScanning.policy === "pending_setup" ? "NOT ACTIVATED" : "Required for new uploads"}</span></div>
          <p>{visible.documentScanning.policy === "pending_setup" ? "Uploads can currently enter without a clean scan. Hosted scanner setup and activation are still needed." : "New uploads require a clean scan. If the scanner is unavailable, ingestion is blocked."}</p>
          <details className={styles.details}><summary>Scanning details<ChevronDown size={14} aria-hidden="true" /></summary><div className={styles.detailBody}><p>Originals without scan evidence: {visible.documentScanning.legacyUnscannedCount}</p><p>Scanner configuration: {visible.documentScanning.configured ? "present" : "missing"}. Configuration presence does not verify scanner health.</p></div></details>
        </div>
      </article>}
      <article className={styles.panel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>PEOPLE & PERMISSIONS</span><h3 id="security-access-review" tabIndex={-1}>Review staff access</h3><p>Check roles, company access, and who can open restricted records.</p></div><span className={styles.count}>{visible.snapshot.members.length} {visible.snapshot.members.length === 1 ? "account" : "accounts"}</span></div>
        {labelsUnavailable && <p className={styles.inlineNote}>Member labels are unavailable. Refresh to retry, or use the account IDs to check the staff directory.</p>}
        {visible.latestReview && <div className={styles.previousReview}><span className={styles.badge} data-tone={reviewCurrent ? "neutral" : "amber"}>{reviewCurrent ? "Current review" : "Review needed"}</span><p>Last reviewed {stamp(visible.latestReview.createdAt)} by {emails.get(visible.latestReview.actorId) || visible.latestReview.actorId}. {reviewCurrent ? "Snapshot still matches." : "Review is stale; access or company scope changed."}</p><p className={styles.reviewNote}>{visible.latestReview.note}</p></div>}
        <div className={styles.tableWrap}><table className={styles.table} role="table"><caption className={styles.srOnly}>Current membership snapshot</caption><thead><tr role="row">{["Staff account", "Role", "Company access", "Restricted records", "Status"].map(heading => <th scope="col" role="columnheader" key={heading}>{heading}</th>)}</tr></thead><tbody>{visible.snapshot.members.map(member => <tr role="row" key={member.userId}>
          <td role="cell" className={styles.accountCell}><div className={styles.account}><span className={styles.avatar} aria-hidden="true">{(emails.get(member.userId) || "?").slice(0, 1).toUpperCase()}</span><div className={styles.accountInfo}><span className={styles.email}>{emails.get(member.userId) || "Email unavailable"}</span><details className={styles.details}><summary>Account details<ChevronDown size={12} aria-hidden="true" /></summary><div className={styles.detailBody}><span className={styles.id}>{member.userId}</span><span>Membership version {member.version}</span><span>Company IDs: {member.allCompanies ? "All companies" : member.companyIds.join(", ") || "None"}</span></div></details></div></div></td>
          <td role="cell" data-label="Role"><span className={styles.role}>{member.role}</span></td>
          <td role="cell" data-label="Company access">{member.allCompanies ? "All companies" : member.companyIds.length ? member.companyIds.map(companyId => <span className={styles.company} key={companyId}>{companyNames.get(companyId) || `Company ${companyId}`}</span>) : <span className={styles.muted}>None</span>}</td>
          <td role="cell" data-label="Restricted records">{member.restricted ? "Allowed" : "Not allowed"}</td>
          <td role="cell" data-label="Status"><span className={styles.memberStatus} data-active={member.active}><span aria-hidden="true" />{member.active ? "Active" : "Inactive"}</span></td>
        </tr>)}</tbody></table></div>
        <div className={styles.reviewForm}>
          <div className={styles.formIntro}><h4>Record your review</h4><p>Save a note once you’ve checked everyone’s permissions.</p></div>
          <label className={styles.field}>Review note<textarea aria-label="Review note" value={note} onChange={event => { setNote(event.target.value); setNotice(""); }} maxLength={1000} rows={3} disabled={busy} placeholder="Summarize your review and any follow-up needed…" /></label>
          <p className={styles.fieldHint}>Leave out client information, passwords, and other secrets.</p>
          <label className={styles.acknowledgement}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I reviewed the displayed account permissions and recorded any follow-up needed.</span></label>
          <div className={styles.formActions}><p>This records a review without changing permissions. Changes to access require a new review.</p><Button className={styles.button} disabled={busy || !acknowledged || !note.trim()} onClick={() => void review()}><ShieldCheck size={16} aria-hidden="true" />Record access review</Button></div>
        </div>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>AUDIT TRAIL</span><h3>Recent security events</h3><p>Document access, recovery points, and permission reviews.</p></div><Button className={styles.button} variant="outline" disabled={busy} onClick={() => void exportPage()} aria-label="Export latest 100 events"><ArrowDownToLine size={16} aria-hidden="true" />Export latest 100</Button></div>
        {!events?.items.length ? <div className={styles.empty}><Activity size={28} strokeWidth={1.5} aria-hidden="true" /><p>No security events have been recorded.</p></div> : <ul className={styles.events}>{events.items.map(event => <li key={event.id}>
          <span className={styles.eventIcon}><Activity size={17} aria-hidden="true" /></span>
          <div className={styles.eventContent}><div className={styles.eventHeading}><strong>{eventLabels[event.eventType] ?? event.eventType}</strong><span className={styles.badge} data-tone={event.outcome === "success" ? "neutral" : "amber"}>{event.outcome === "success" ? "Recorded" : event.outcome === "denied" ? "Denied" : "Failed"}</span></div>
            <p>{event.actorId ? emails.get(event.actorId) || "Staff account" : "Background or recipient service"}{event.companyId && companyNames.has(event.companyId) ? ` · ${companyNames.get(event.companyId)}` : ""}</p>
            <details className={styles.details}><summary>Event details<ChevronDown size={12} aria-hidden="true" /></summary><dl className={styles.metadata}><div><dt>Event</dt><dd>{event.eventType}</dd></div><div><dt>Actor</dt><dd>{event.actorId ?? "Background or recipient service"}</dd></div>{event.companyId && <div><dt>Company ID</dt><dd>{event.companyId}</dd></div>}{event.recordId && <div><dt>{event.recordType} ID</dt><dd>{event.recordId}</dd></div>}{event.count !== null && <div><dt>Count</dt><dd>{event.count}</dd></div>}<div><dt>Recorded at</dt><dd>{stamp(event.createdAt)}</dd></div></dl></details>
          </div><time dateTime={event.createdAt} className={styles.eventTime}>{stamp(event.createdAt)}</time>
        </li>)}</ul>}
        <div className={styles.eventFooter}><p>Metadata only. No document contents, filenames, or credentials are included. History starts when event collection is deployed.</p>{events?.nextCursor && <Button className={styles.button} variant="outline" disabled={busy} onClick={() => void older()}>Older security events</Button>}</div>
      </article>
      <aside className={styles.operations}><Info size={20} aria-hidden="true" /><div><h3>Security is an ongoing practice</h3><p>Access reviews and event history are part of the process. An incident contact, recovery exercises, monitoring, and vendor obligations still need operational review. This screen does not certify compliance.</p></div></aside>
    </>}
  </section>;
}

const eventLabels: Record<SecurityEventType, string> = {
  "file.download": "Original document opened",
  "workspace.export": "Workspace exported",
  "backup.created": "Recovery point created",
  "backup.restored": "Recovery point restored",
  "authorization.denied": "Access request denied",
  "security.events_exported": "Security events exported",
  "access.reviewed": "Staff access reviewed",
  "document.scan_clean": "Document scan cleared",
  "document.scan_blocked": "Document scan blocked",
  "document.scan_unavailable": "Document scanner unavailable",
};
