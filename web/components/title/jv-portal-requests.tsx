"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { jvPortalClientRequest, jvPortalDownload, type JVPortalAction, type JVPortalList, type JVPortalPrepared, type JVPortalSubmission } from "@/lib/backend/jv-portal-client";
import { jvIntakeClientRequest, type JVIntakeContext } from "@/lib/backend/jv-intake-client";
import type { JVPortalStaffRecord } from "@/lib/title/jv-portal";
import { FieldLabel } from "./shared";

const statusOf = (error: unknown) => error && typeof error === "object" && "status" in error ? error.status : undefined;
const delivery = (value: string) => ({ not_sent: "Email not sent", sending: "Email send in progress", sent: "Email accepted by provider", failed: "Email send failed", unknown: "Email outcome unknown — revoke and prepare a new link" })[value] || "Email not sent";

export function JVPortalRequests({ context, applicationDirty, onApplicationChanged }: { context: JVIntakeContext; applicationDirty: boolean; onApplicationChanged: () => void }) {
  const [opened, setOpened] = useState(false), [requests, setRequests] = useState<JVPortalStaffRecord[]>([]);
  const [mailConfigured, setMailConfigured] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [link, setLink] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [submission, setSubmission] = useState<JVPortalSubmission | null>(null), [showIdentity, setShowIdentity] = useState(false), [reviewed, setReviewed] = useState(false);
  const [applicationVersion, setApplicationVersion] = useState<number | null>(null), [correction, setCorrection] = useState("");
  const alive = useRef(true), working = useRef(false), createId = useRef(crypto.randomUUID());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const blocked = busy || applicationDirty;
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await task(); }
    catch (cause) {
      if (!alive.current) return;
      const status = statusOf(cause);
      if (status === 401 || status === 403) { setSubmission(null); setRequests([]); setLink(""); setName(""); setEmail(""); setCorrection(""); setLoaded(false); }
      setError(status === 409 ? "This application changed. Refresh requests and reopen the submission before continuing." : status === 401 || status === 403 ? "Your session or application access changed. Sign in and reopen this company." : status === 503 ? "Application service or email setup is unavailable. Contact your administrator, then refresh." : "The request could not be completed. Check your entries and refresh before retrying.");
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function refresh() {
    if (!alive.current) return;
    const result = await jvPortalClientRequest<JVPortalList>(context, "list");
    if (alive.current) { setRequests(result.requests); setMailConfigured(result.mailConfigured); setLoaded(true); setSubmission(null); setShowIdentity(false); setReviewed(false); setApplicationVersion(null); setCorrection(""); }
  }
  async function update(action: JVPortalAction, record: JVPortalStaffRecord, extra: Record<string, unknown> = {}) {
    if (applicationDirty) return;
    await run(async () => {
      if (action === "send") setLink("");
      const result = await jvPortalClientRequest<JVPortalStaffRecord | JVPortalPrepared>(context, action, { id: record.id, expectedVersion: record.version, ...extra });
      if (!alive.current) return;
      setLink("");
      if ("link" in result && result.link) setLink(result.link);
      await refresh();
      if (alive.current) {
        setNotice(action === "send" ? delivery("request" in result ? result.request.deliveryStatus : result.deliveryStatus) : action === "apply" ? "Submission applied. Open the private application to review the populated information." : action === "request-changes" ? "Corrections requested. Copy the new private link or choose Send email." : "Application link revoked.");
        if (action === "apply") onApplicationChanged();
      }
    });
  }
  return <div className="jv-portal-requests" aria-busy={busy}>
    <div className="jv-actions"><Button type="button" variant="outline" size="sm" disabled={busy} aria-expanded={opened} onClick={() => { setOpened(!opened); if (!opened && !loaded) void run(refresh); }}>Private application links</Button></div>
    {opened && <div className="jv-section">
      <h4>Send an application</h4><p className="form-note">Prepare a private link for a new joint venture. The recipient verifies their email, saves answers and uploads documents. Submissions fill an empty, unchanged private application. Existing entries wait for your review.</p>
      {applicationDirty && <p className="notice warning">Save or close your unsaved application before changing requests.</p>}
      {error && <p className="notice warning" role="alert">{error}</p>}{notice && <p className="form-note" role="status">{notice}</p>}
      {loaded && !mailConfigured && <p className="notice warning" role="status">Application email setup is needed before recipients can verify and open a link. Your administrator must configure the application email service.</p>}
      <form autoComplete="off" onSubmit={event => { event.preventDefault(); if (blocked || !loaded) return; void run(async () => { const result = await jvPortalClientRequest<JVPortalPrepared>(context, "create", { recipientName: name.trim(), email: email.trim(), requestId: createId.current }); if (!alive.current) return; createId.current = crypto.randomUUID(); setLink(result.link || ""); setName(""); setEmail(""); await refresh(); if (alive.current) setNotice(result.link ? "Private link prepared. No email has been sent. Copy the link or choose Send email below." : "This request was already prepared. Use Send email to issue a fresh link."); }); }}>
        <fieldset className="jv-section" disabled={blocked || !loaded}>
          <div className="jv-grid"><FieldLabel label="Recipient name"><Input value={name} maxLength={200} required onChange={event => { setName(event.target.value); createId.current = crypto.randomUUID(); }} /></FieldLabel><FieldLabel label="Recipient email"><Input type="email" value={email} maxLength={254} required onChange={event => { setEmail(event.target.value); createId.current = crypto.randomUUID(); }} /></FieldLabel></div>
          <Button type="submit" variant="outline" disabled={!name.trim() || !email.trim()}>Prepare private link</Button>
        </fieldset>
      </form>
      {link && <div className="jv-section"><FieldLabel label="New private application link"><Input readOnly value={link} onFocus={event => event.target.select()} /></FieldLabel><p className="form-note">Share only with the named recipient. Sending an email below replaces this link. Preparing a link does not send an email.</p><Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => { if (alive.current) setNotice("Private link copied."); }).catch(() => { if (alive.current) setError("Select the link above and copy it manually."); })}>Copy private link</Button></div>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(refresh)}>Refresh requests</Button>
      {loaded && requests.length === 0 && <p className="form-note">No private application requests yet.</p>}
      {requests.map(record => <article className="jv-request-card" key={record.id}>
        <h5>{record.recipientName}</h5><p>{record.email}</p><p className="form-note">{record.status} · {delivery(record.deliveryStatus)} · Expires {new Date(record.expiresAt).toLocaleDateString()}</p>
        {record.appliedVersion !== null && !record.needsMerge && <p className="form-note">Answers populated the private application. Staff review is still required.</p>}
        {record.needsMerge && <p className="notice warning">The internal application changed. Review this submission before replacing its applicant information.</p>}
        {record.status === "Submitted" && record.notificationStatus !== "sent" && <p className="form-note">Submission received here. A notification email has not been confirmed.</p>}
        <div className="jv-actions">
          {!["Revoked", "Expired", "Submitted"].includes(record.status) && <Button type="button" size="sm" variant="outline" disabled={blocked || !mailConfigured || ["sending", "sent", "unknown"].includes(record.deliveryStatus)} onClick={() => { if (window.confirm(`Send an application email to ${record.email}? Any previous link will stop working.`)) void update("send", record); }}>Send email</Button>}
          {record.status === "Submitted" && <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => void run(async () => { const received = await jvPortalClientRequest<JVPortalSubmission>(context, "load-submission", { id: record.id }); if (!alive.current) return; const current = await jvIntakeClientRequest(context, "load"); if (alive.current) { setSubmission(received); setApplicationVersion(current.version); setReviewed(false); setShowIdentity(false); setCorrection(""); } })}>Review submission</Button>}
          {!["Revoked", "Expired"].includes(record.status) && <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => { if (window.confirm(`Revoke this application link for ${record.recipientName}? Saved internal records remain.`)) void update("revoke", record); }}>Revoke link</Button>}
        </div>
      </article>)}
      {submission && <section className="jv-submission-review" aria-label="Submitted application review">
        <h4>Submitted application</h4><p className="form-note">Compare these answers and supporting originals with the private application before applying changes.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowIdentity(!showIdentity)}>{showIdentity ? "Hide identity details" : "Reveal identity details"}</Button>
        {submission.payload.applicants.map((person, index) => <details className="jv-request-card" key={person.id}><summary>Applicant {index + 1}: {person.name}</summary><dl><dt>Email</dt><dd>{person.email}</dd><dt>Phone</dt><dd>{person.phone}</dd><dt>Date of birth</dt><dd>{showIdentity ? person.dob : "••••••"}</dd><dt>Social Security number</dt><dd>{showIdentity ? person.ssn : "••••••"}</dd><dt>Driver’s license</dt><dd>{showIdentity ? person.driverLicense : "••••••"}</dd><dt>Current address</dt><dd>{person.currentAddress}</dd><dt>Ownership</dt><dd>{person.ownershipType}</dd>{person.ownershipType === "business" && <><dt>Business</dt><dd>{person.businessName} · {person.businessStatus}</dd><dt>Formation reference</dt><dd>{person.businessReference}</dd></>}</dl><h5>Residence history</h5>{person.residenceHistory.map(row => <p key={row.id}>{row.address} · {row.from} to {row.to || "Present"}</p>)}<h5>Employment history</h5>{person.employmentHistory.map(row => <p key={row.id}>{row.employer} · {row.role} · {row.address} · {row.from} to {row.to || "Present"}</p>)}</details>)}
        <h5>Logo preferences</h5><p className="jv-preserve">{submission.payload.logoPreferences || "None provided"}</p><h5>Additional notes</h5><p className="jv-preserve">{submission.payload.notes || "None provided"}</p>
        <h5>Supporting documents</h5>{submission.attachments.length === 0 && <p className="form-note">No supporting documents uploaded.</p>}
        {submission.attachments.map(file => <p key={file.id}><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const blob = await jvPortalDownload(context, submission.request.id, file.id); if (!alive.current) return; const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000); })}>Download {file.name}</Button></p>)}
        {submission.request.needsMerge && <><p className="notice warning">Applying replaces all applicant answers, histories, logo preferences and notes with this submission. Setup steps and existing original documents are preserved. Close this review to compare the current private application first.</p><label className="check-row"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I compared the current application and approve replacing its applicant information with this submission.</label><Button type="button" disabled={blocked || !reviewed || applicationVersion === null} onClick={() => void update("apply", submission.request, { expectedApplicationVersion: applicationVersion })}>Apply reviewed submission</Button></>}
        <FieldLabel label="Corrections to request"><Textarea value={correction} maxLength={2000} rows={3} onChange={event => setCorrection(event.target.value)} placeholder="Describe what needs updating. Do not include identity numbers." /></FieldLabel>
        <Button type="button" variant="outline" disabled={blocked || !correction.trim()} onClick={() => void update("request-changes", submission.request, { note: correction.trim() })}>Request corrections</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => { setSubmission(null); setShowIdentity(false); setCorrection(""); setReviewed(false); }}>Close submission review</Button>
      </section>}
    </div>}
  </div>;
}
