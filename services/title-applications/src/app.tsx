import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { jvReadiness, newJVApplicant, newJVApplication, validateJVApplication, type JVApplicant } from "../../../web/lib/title/jv-application";
import type { JVRecipientPayload, JVPortalPublicRecord, JVPortalAttachment } from "../../../web/lib/title/jv-portal";
import "./styles.css";

// The invitation is deliberately never written to browser storage or a query string.
let bootstrapToken = "";
if (typeof window !== "undefined") {
  const fragment = window.location.hash.slice(1);
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (/^[A-Za-z0-9_-]{43}$/.test(fragment)) bootstrapToken = fragment;
}

const sections = ["Applicant details", "Ownership & history", "Branding & documents", "Review & submit"];
const MiB = 1024 * 1024;
const prettyBytes = (bytes: number) => bytes >= MiB ? `${(bytes / MiB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const application = (payload: JVRecipientPayload) => ({ ...newJVApplication(), ...payload });
const canonicalPayload = (payload: JVRecipientPayload): JVRecipientPayload => {
  const { applicants, logoPreferences, notes } = validateJVApplication(application(payload));
  return { applicants, logoPreferences, notes };
};

class PortalError extends Error {
  constructor(readonly status: number) { super("The private request could not be completed."); }
}

function Field({ label, value, onChange, multiline = false, secret = false, hint, type = "text", maxLength = 200, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; secret?: boolean; hint?: string;
  type?: string; maxLength?: number; inputMode?: "text" | "numeric" | "email" | "tel";
}) {
  const id = React.useId(), [revealed, setRevealed] = useState(false);
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className={secret ? "secret-control" : undefined}>
      {multiline ? <textarea id={id} value={value} onChange={event => onChange(event.target.value)} maxLength={maxLength} rows={3} aria-describedby={hint ? `${id}-hint` : undefined} autoComplete="off" /> :
        <input id={id} type={secret && !revealed ? "password" : type} value={value} onChange={event => onChange(event.target.value)} maxLength={maxLength} inputMode={inputMode} autoComplete="off" spellCheck={false} aria-describedby={hint ? `${id}-hint` : undefined} />}
      {secret && <button type="button" className="reveal" aria-label={`${revealed ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? "Hide" : "Show"}</button>}
    </div>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </div>;
}

export function RecipientApp({ apiBase = "/api", fetcher = globalThis.fetch, invitationToken }: {
  apiBase?: string; fetcher?: typeof fetch; invitationToken?: string;
}) {
  const [token, setToken] = useState(() => { const value = invitationToken ?? bootstrapToken; bootstrapToken = ""; return value; });
  const [session, setSession] = useState("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState("");
  const [record, setRecord] = useState<JVPortalPublicRecord | null>(null);
  const [draft, setDraft] = useState<JVRecipientPayload | null>(null);
  const [stage, setStage] = useState<"welcome" | "code" | "form" | "ended">(token ? "welcome" : "ended");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [step, setStep] = useState(0);
  const [applicantIndex, setApplicantIndex] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const errorRef = useRef<HTMLDivElement>(null), headingRef = useRef<HTMLHeadingElement>(null);
  const epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const readonly = record?.status === "Submitted";
  const dirty = !!draft && !!record && JSON.stringify(draft) !== JSON.stringify(record.payload);
  const problems = useMemo(() => draft ? jvReadiness(application(draft)) : [], [draft]);
  const person = draft?.applicants[applicantIndex];

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (stage === "form") headingRef.current?.focus(); }, [step, stage]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { epoch.current++; controller.current?.abort(); }, []);

  function endAccess(message: string) {
    epoch.current++;
    controller.current?.abort();
    setToken(""); setSession(""); setCode(""); setDraft(null); setRecord(null); setAcknowledged(false);
    setStage("ended"); setNotice(""); setError(message); setBusy(false); busyRef.current = false;
  }
  useEffect(() => {
    const invitationChanged = () => {
      const nextToken = window.location.hash.slice(1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(nextToken)) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (dirty && !window.confirm("Opening this invitation will clear your unsaved entries. Continue without saving?")) return;
      endAccess(""); setToken(nextToken); setSessionExpiresAt(""); setStep(0); setApplicantIndex(0); setStage("welcome");
    };
    window.addEventListener("hashchange", invitationChanged);
    return () => window.removeEventListener("hashchange", invitationChanged);
  }, [dirty]);
  useEffect(() => {
    if (session && (clock >= Date.parse(sessionExpiresAt) || (record && clock >= Date.parse(record.expiresAt)))) {
      endAccess("Your secure session has ended. Reopen the original email link and verify again to continue from your last saved draft.");
    }
  }, [clock, session, sessionExpiresAt, record]);

  async function api<T>(action: string, data: object | FormData, signal: AbortSignal): Promise<T> {
    const multipart = data instanceof FormData;
    const response = await fetcher(`${apiBase}/${action}`, {
      method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal,
      headers: multipart ? undefined : { "Content-Type": "application/json" }, body: multipart ? data : JSON.stringify(data),
    });
    if (!response.ok) throw new PortalError(response.status);
    return (action === "download" ? response.blob() : response.json()) as Promise<T>;
  }
  async function run(work: (signal: AbortSignal, current: () => boolean) => Promise<void>, mutating = false) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const generation = epoch.current, abort = new AbortController(); controller.current = abort;
    const current = () => generation === epoch.current && !abort.signal.aborted;
    const timeout = window.setTimeout(() => {
      if (!current()) return;
      abort.abort(); setBusy(false); busyRef.current = false;
      if (mutating) setConflict(true);
      setError("This request took too long to confirm. Check your connection. If you were saving, uploading, or submitting, reload the latest draft to check whether it finished before trying again.");
    }, 30_000);
    try { await work(abort.signal, current); }
    catch (cause) {
      if (!current()) return;
      if (cause instanceof PortalError && (cause.status === 401 || cause.status === 403 || cause.status === 404 || cause.status === 410)) {
        if (stage === "code" && cause.status === 401) setError("That code could not be verified. Check the six digits or request a new code.");
        else endAccess("This private link or session is no longer available. Reopen the original email link to verify again, or contact the Ballantyne team for a new invitation.");
      } else if (cause instanceof PortalError && cause.status === 409) {
        setConflict(true); setError("A newer version is available. Your unsaved entries are still on this page. Reload the latest draft before making further changes.");
      } else if (cause instanceof PortalError && cause.status === 429) {
        setError("Please wait before trying again. Verification codes can be resent after one minute; repeated requests may require a longer wait.");
      } else if (cause instanceof PortalError && cause.status === 413) {
        setError("This request is too large. Use files smaller than 10 MB and keep the total below 40 MB.");
      } else if (cause instanceof PortalError && (cause.status === 400 || cause.status === 422 || cause.status === 415)) {
        setError("Some information could not be accepted. Check dates, email addresses, identity numbers, and file type or size, then try again.");
      } else {
        if (mutating) setConflict(true);
        setError("We could not confirm this action. Your entries are still here. Check your connection, then reload the latest saved draft before retrying an upload or submission.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (current()) { setBusy(false); busyRef.current = false; controller.current = null; }
    }
  }
  function accept(next: JVPortalPublicRecord) {
    const nextDraft = structuredClone(next.payload);
    // A newly issued invitation has no stored applicants. Make its first editor
    // immediately usable while keeping the unsaved blank row only in memory.
    if (!nextDraft.applicants.length && next.status !== "Submitted") nextDraft.applicants.push(newJVApplicant());
    setRecord(next); setDraft(nextDraft); setConflict(false); setAcknowledged(false);
    setApplicantIndex(index => Math.max(0, Math.min(index, next.payload.applicants.length - 1)));
  }
  async function start() {
    await run(async (signal, current) => {
      await api("start", { token }, signal);
      if (!current()) return;
      setStage("code"); setCode(""); setResendAt(Date.now() + 60_000);
      setNotice("If this link is available, a verification code has been sent. Check the inbox that received your invitation. The code is valid for 10 minutes.");
    });
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Enter the six-digit code from your email."); return; }
    await run(async (signal, current) => {
      const next = await api<{ session: string; expiresAt: string; application: JVPortalPublicRecord }>("verify", { token, code }, signal);
      if (!current()) return;
      setSession(next.session); setSessionExpiresAt(next.expiresAt); accept(next.application); setToken(""); setCode(""); setStage("form");
    });
  }
  function editPayload(patch: Partial<JVRecipientPayload>) {
    if (readonly || busy || conflict) return;
    setDraft(value => value ? { ...value, ...patch } : value); setNotice(""); setAcknowledged(false);
  }
  function editPerson(patch: Partial<JVApplicant>) {
    if (!draft || !person) return;
    editPayload({ applicants: draft.applicants.map((entry, index) => index === applicantIndex ? { ...entry, ...patch } : entry) });
  }
  function validate(): JVRecipientPayload | null {
    if (!draft) return null;
    try { return canonicalPayload(draft); }
    catch { setError("Check your entries before saving: use YYYY-MM-DD for dates, a valid email, and a nine-digit SSN. History end dates must follow their start dates. Long answers may need to be shortened."); return null; }
  }
  async function save(submit = false) {
    if (!record || readonly || conflict) return;
    const payload = validate(); if (!payload) return;
    if (submit && (problems.length || !acknowledged)) { setError("Complete the review items and confirm you have checked the information before submitting."); return; }
    await run(async (signal, current) => {
      const next = await api<JVPortalPublicRecord>(submit ? "submit" : "save", { session, expectedVersion: record.version, payload }, signal);
      if (!current()) return;
      accept(next); setNotice(submit ? "Your application has been submitted for the Ballantyne team to review." : "Draft saved. You can return using the original email link.");
    }, true);
  }
  async function reload() {
    if (dirty && !window.confirm("Reloading replaces your unsaved entries with the latest saved draft. Continue?")) return;
    await run(async (signal, current) => { const next = await api<JVPortalPublicRecord>("load", { session }, signal); if (current()) { accept(next); setNotice("Latest saved application loaded."); } });
  }
  async function upload(file: File | undefined) {
    if (!file || !record || readonly || conflict) return;
    if (!file.size || file.size > 10 * MiB || record.attachments.length >= 10 || record.attachments.reduce((sum, entry) => sum + entry.bytes, 0) + file.size > 40 * MiB) {
      setError("Choose a nonempty file up to 10 MB. You can include up to 10 files, with a combined limit of 40 MB."); return;
    }
    const payload = validate(); if (!payload) return;
    await run(async (signal, current) => {
      // Save first so the upload's returned record cannot replace unsaved form entries.
      let latest = record;
      if (dirty) {
        latest = await api<JVPortalPublicRecord>("save", { session, expectedVersion: record.version, payload }, signal);
        if (!current()) return;
        accept(latest);
      }
      const body = new FormData(); body.set("session", session); body.set("file", file);
      const next = await api<JVPortalPublicRecord>("upload", body, signal);
      if (current()) { accept(next); setNotice("Document uploaded and draft saved."); }
    }, true);
  }
  async function removeAttachment(attachment: JVPortalAttachment) {
    if (!record || readonly || conflict || !window.confirm(`Remove ${attachment.name} from this application?`)) return;
    const payload = validate(); if (!payload) return;
    await run(async (signal, current) => {
      let latest = record;
      if (dirty) { latest = await api<JVPortalPublicRecord>("save", { session, expectedVersion: record.version, payload }, signal); if (!current()) return; accept(latest); }
      const next = await api<JVPortalPublicRecord>("remove-attachment", { session, expectedVersion: latest.version, attachmentId: attachment.id }, signal);
      if (current()) { accept(next); setNotice("Document removed from the application."); }
    }, true);
  }
  async function download(attachment: JVPortalAttachment) {
    await run(async (signal, current) => {
      const blob = await api<Blob>("download", { session, attachmentId: attachment.id }, signal);
      if (!current()) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = attachment.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Document download started.");
    });
  }
  function switchStep(index: number) { setStep(index); if (!conflict) setError(""); }
  function goToProblem(problem: string) {
    const match = problem.match(/^Applicant (\d+)/); if (match) setApplicantIndex(Number(match[1]) - 1);
    switchStep(/ownership|business|residence|employment/.test(problem) ? 1 : 0);
  }
  const resendSeconds = Math.max(0, Math.ceil((resendAt - clock) / 1000));

  return <div className="portal-shell">
    <a className="skip-link" href="#main">Skip to application</a>
    <header className="brand-header"><img src="/brand/ballantyne-title-logo.png" alt="Ballantyne Title" /><span className="private-label"><span aria-hidden="true">◈</span> Private application</span></header>
    <main id="main">
      <div className="intro"><p className="eyebrow">LET’S BUILD SOMETHING TOGETHER</p><h1>Joint venture application</h1><p>A thoughtful first step toward your new venture.</p></div>
      {error && <div ref={errorRef} className="message error" role="alert" tabIndex={-1}><strong>Action needed</strong><p>{error}</p></div>}
      {notice && <div className="message notice" role="status">{notice}</div>}
      {stage === "ended" && <section className="card welcome-card"><span className="section-kicker">PRIVATE ACCESS</span><h2>Open your invitation to continue</h2><p>Use the full private link in your Ballantyne invitation email. Links last seven days, and each visit requires an email verification code.</p><p>If your link has expired or been withdrawn, contact the Ballantyne team for a new invitation. Your last saved draft remains available to the team.</p></section>}
      {stage === "welcome" && <section className="card welcome-card"><span className="section-kicker">WELCOME TO BALLANTYNE</span><h2>Your next chapter starts here.</h2><p>Tell us about the people and ownership behind your venture. You can save your progress and come back through this invitation.</p><div className="welcome-facts"><p><strong>1. Verify your email</strong><span>We’ll send a code to the invited recipient.</span></p><p><strong>2. Complete your application</strong><span>Gather identity details and five years of address and work history.</span></p><p><strong>3. Send for review</strong><span>The Ballantyne team will review your information and any supporting documents.</span></p></div><button type="button" className="primary" disabled={busy} onClick={start}>{busy ? "Sending…" : "Send verification code"}</button><p className="fine-print">Your invitation is private and expires seven days after it was issued. Please do not forward it.</p></section>}
      {stage === "code" && <section className="card welcome-card"><span className="section-kicker">EMAIL VERIFICATION</span><h2>Check your inbox</h2><p>Enter the six-digit code sent to the email address that received this invitation.</p><form onSubmit={verify}><label htmlFor="verification-code">Verification code</label><input id="verification-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} autoFocus disabled={busy} /><button type="submit" className="primary" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and continue"}</button></form><button type="button" className="text-button" onClick={start} disabled={busy || resendSeconds > 0}>{resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Send a new code"}</button><p className="fine-print">Codes last 10 minutes. Check spam or junk if you do not see the message.</p></section>}
      {stage === "form" && record && draft && <>
        <section className="application-banner"><div><p className="eyebrow">{record.companyName}</p><h2>Welcome, {record.recipientName}</h2><p>Invitation expires {dateLabel(record.expiresAt)}.</p></div><span className={`status-badge ${readonly ? "submitted" : ""}`}>{record.status}</span></section>
        {record.status === "Changes requested" && <aside className="message correction"><strong>The team has requested an update</strong><p className="preserve-lines">{record.correctionNote || "Review your application, make the requested changes, and submit it again."}</p></aside>}
        {readonly && <aside className="message notice"><strong>Thank you. Your application is with the team.</strong><p>{record.submittedAt ? `Submitted ${dateLabel(record.submittedAt)}. ` : ""}You can review your information below. The team will contact you if changes are needed. Submission does not constitute legal, licensing, or regulatory approval.</p></aside>}
        <nav className="stepper" aria-label="Application sections">{sections.map((label, index) => <button type="button" key={label} aria-current={step === index ? "step" : undefined} onClick={() => switchStep(index)}><span className="step-number">{index + 1}</span><span>{label}</span></button>)}</nav>
        <div className="form-layout"><section className="card form-card" aria-busy={busy}>
          <div className="section-heading"><span className="section-kicker">STEP {step + 1} OF {sections.length}</span><h2 ref={headingRef} tabIndex={-1}>{sections[step]}</h2></div>
          {step < 2 && <div className="applicant-picker"><label htmlFor="current-applicant">Current applicant</label><div className="inline-controls"><select id="current-applicant" value={applicantIndex} onChange={event => setApplicantIndex(Number(event.target.value))} disabled={busy}>{draft.applicants.map((entry, index) => <option key={entry.id} value={index}>Applicant {index + 1}{entry.name ? ` · ${entry.name}` : ""}</option>)}</select>{!readonly && <button type="button" disabled={busy || conflict || draft.applicants.length >= 20} onClick={() => { editPayload({ applicants: [...draft.applicants, newJVApplicant()] }); setApplicantIndex(draft.applicants.length); }}>Add applicant</button>}</div><small>Include every proposed owner or applicant, up to 20 people.</small></div>}
          <fieldset key={`${step}-${person?.id || "all"}`} disabled={readonly || busy || conflict}>
            {step === 0 && person && <>
              <p className="section-description">Enter details as they appear on official records. Sensitive identity numbers stay masked unless you choose to show them.</p>
              <div className="field-grid"><Field label="Applicant name" value={person.name} onChange={name => editPerson({ name })} /><Field label="Email" type="email" inputMode="email" maxLength={254} value={person.email} onChange={email => editPerson({ email })} /><Field label="Phone" type="tel" inputMode="tel" maxLength={50} value={person.phone} onChange={phone => editPerson({ phone })} /><Field label="Date of birth" secret maxLength={10} hint="Use YYYY-MM-DD, for example 1985-01-15." value={person.dob} onChange={dob => editPerson({ dob })} /><Field label="Social Security number" secret inputMode="numeric" maxLength={32} hint="Nine digits, with or without hyphens." value={person.ssn} onChange={ssn => editPerson({ ssn })} /><Field label="Driver’s license number" secret maxLength={100} value={person.driverLicense} onChange={driverLicense => editPerson({ driverLicense })} /></div>
              <Field label="Current address" multiline maxLength={1000} value={person.currentAddress} onChange={currentAddress => editPerson({ currentAddress })} />
            </>}
            {step === 1 && person && <>
              <div className="field"><label htmlFor="ownership">Ownership election</label><select id="ownership" value={person.ownershipType} onChange={event => editPerson({ ownershipType: event.target.value as JVApplicant["ownershipType"] })}><option value="undecided">Select ownership</option><option value="individual">Own as an individual</option><option value="business">Own through a business</option></select></div>
              {person.ownershipType === "business" && <div className="inset"><p>For this application, the owner business must be formed before the joint venture can move forward. If it is still forming, save a draft and return when you have the formation reference.</p><Field label="Owner business name" value={person.businessName} onChange={businessName => editPerson({ businessName })} /><div className="field"><label htmlFor="business-status">Owner business status</label><select id="business-status" value={person.businessStatus} onChange={event => editPerson({ businessStatus: event.target.value as JVApplicant["businessStatus"] })}><option value="not-applicable">Select status</option><option value="forming">Still forming</option><option value="existing">Already formed</option></select></div><Field label="Formation document or filing reference" multiline maxLength={2000} value={person.businessReference} onChange={businessReference => editPerson({ businessReference })} /></div>}
              <div className="history-heading"><h3>Residence history</h3><p>Cover the past five years without gaps. Include your current address and leave its end date blank.</p></div>
              {person.residenceHistory.map((row, index) => <section className="history-card" key={row.id}><div className="row-heading"><h4>Residence {index + 1}</h4>{!readonly && <button type="button" className="text-button danger" aria-label={`Remove residence ${index + 1}`} onClick={() => editPerson({ residenceHistory: person.residenceHistory.filter(item => item.id !== row.id) })}>Remove</button>}</div><Field label={`Residence ${index + 1} address`} multiline maxLength={1000} value={row.address} onChange={address => editPerson({ residenceHistory: person.residenceHistory.map(item => item.id === row.id ? { ...item, address } : item) })} /><div className="field-grid">{(["from", "to"] as const).map(key => <Field key={key} type="date" label={`Residence ${index + 1} ${key === "from" ? "start" : "end"} date`} value={row[key]} onChange={value => editPerson({ residenceHistory: person.residenceHistory.map(item => item.id === row.id ? { ...item, [key]: value } : item) })} />)}</div></section>)}
              {!readonly && <button type="button" disabled={person.residenceHistory.length >= 40} onClick={() => editPerson({ residenceHistory: [...person.residenceHistory, { id: crypto.randomUUID(), address: "", from: "", to: "" }] })}>Add residence</button>}
              <div className="history-heading"><h3>Employment history</h3><p>Cover the past five years without gaps. Include self-employment, unemployment, or retirement as applicable. Leave the end date blank for your current role or status.</p></div>
              {person.employmentHistory.map((row, index) => <section className="history-card" key={row.id}><div className="row-heading"><h4>Employment {index + 1}</h4>{!readonly && <button type="button" className="text-button danger" aria-label={`Remove employment ${index + 1}`} onClick={() => editPerson({ employmentHistory: person.employmentHistory.filter(item => item.id !== row.id) })}>Remove</button>}</div><div className="field-grid"><Field label={`Employment ${index + 1} employer or status`} value={row.employer} onChange={employer => editPerson({ employmentHistory: person.employmentHistory.map(item => item.id === row.id ? { ...item, employer } : item) })} /><Field label={`Employment ${index + 1} role`} value={row.role} onChange={role => editPerson({ employmentHistory: person.employmentHistory.map(item => item.id === row.id ? { ...item, role } : item) })} /></div><Field label={`Employment ${index + 1} address`} multiline maxLength={1000} value={row.address} onChange={address => editPerson({ employmentHistory: person.employmentHistory.map(item => item.id === row.id ? { ...item, address } : item) })} /><div className="field-grid">{(["from", "to"] as const).map(key => <Field key={key} type="date" label={`Employment ${index + 1} ${key === "from" ? "start" : "end"} date`} value={row[key]} onChange={value => editPerson({ employmentHistory: person.employmentHistory.map(item => item.id === row.id ? { ...item, [key]: value } : item) })} />)}</div></section>)}
              {!readonly && <button type="button" disabled={person.employmentHistory.length >= 40} onClick={() => editPerson({ employmentHistory: [...person.employmentHistory, { id: crypto.randomUUID(), employer: "", role: "", address: "", from: "", to: "" }] })}>Add employment</button>}
            </>}
            {step === 2 && <><p className="section-description">Share your design preferences and attach supporting records for the team. These details are optional unless the team has asked you to provide them.</p><Field label="Logo preferences" multiline maxLength={10000} hint="For example, colors, style, wording, or an existing brand to reference." value={draft.logoPreferences} onChange={logoPreferences => editPayload({ logoPreferences })} /><Field label="Other application information" multiline maxLength={10000} hint="Use the identity fields for identity numbers, rather than entering them in these notes." value={draft.notes} onChange={notes => editPayload({ notes })} /></>}
          </fieldset>
          {step === 2 && <section className="document-section"><h3>Supporting documents</h3><p>PDF, PNG, JPEG, and plain text files. Up to 10 files, 10 MB each, 40 MB combined. Originals remain private to this application and the reviewing team.</p>{record.attachments.length ? <ul className="attachments">{record.attachments.map(attachment => <li key={attachment.id}><div><strong>{attachment.name}</strong><small>{prettyBytes(attachment.bytes)}</small></div><div className="attachment-actions"><button type="button" disabled={busy} onClick={() => download(attachment)} aria-label={`Download ${attachment.name}`}>Download</button>{!readonly && <button type="button" className="text-button danger" disabled={busy || conflict} onClick={() => removeAttachment(attachment)} aria-label={`Remove ${attachment.name}`}>Remove</button>}</div></li>)}</ul> : <p className="empty-state">No documents uploaded yet.</p>}{!readonly && <div className="upload-control"><label htmlFor="supporting-document">Upload a supporting document</label><input id="supporting-document" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" disabled={busy || conflict || record.attachments.length >= 10} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} /><small>Uploading also saves your current draft. Wait for confirmation before leaving this page.</small></div>}</section>}
          {step === 3 && <section className="review"><p>Review every applicant’s details, ownership choice, and five-year histories before sending this application to the team.</p><div className="review-totals"><div><strong>{draft.applicants.length}</strong><span>{draft.applicants.length === 1 ? "Applicant" : "Applicants"}</span></div><div><strong>{record.attachments.length}</strong><span>Supporting documents</span></div><div><strong>{problems.length}</strong><span>Items to complete</span></div></div>{draft.applicants.map((entry, index) => <div className="review-person" key={entry.id}><div><strong>{entry.name || `Applicant ${index + 1}`}</strong><p>{entry.ownershipType === "business" ? entry.businessName || "Business ownership" : entry.ownershipType === "individual" ? "Individual ownership" : "Ownership not selected"}</p></div><button type="button" onClick={() => { setApplicantIndex(index); switchStep(0); }}>Review applicant {index + 1}</button></div>)}{!readonly && <>{problems.length > 0 ? <div className="review-issues"><h3>Before you submit</h3><ul>{problems.map((problem, index) => <li key={`${problem}-${index}`}><button type="button" className="text-button" onClick={() => goToProblem(problem)}>{problem}</button></li>)}</ul></div> : <p className="ready-note">All required application fields are complete.</p>}<label className="checkbox-label"><input type="checkbox" checked={acknowledged} disabled={busy || conflict} onChange={event => setAcknowledged(event.target.checked)} /><span>I have reviewed the information for every applicant and am ready to send it to Ballantyne for review.</span></label><button type="button" className="primary submit-button" disabled={busy || conflict || problems.length > 0 || !acknowledged} onClick={() => save(true)}>{busy ? "Working…" : "Submit application"}</button></>}<p className="fine-print">Submission starts a human review. It does not approve the venture, satisfy a licensing requirement, or replace legal or regulatory advice.</p></section>}
          {step < 2 && person && !readonly && draft.applicants.length > 1 && <button type="button" className="text-button danger remove-applicant" disabled={busy || conflict} onClick={() => { if (window.confirm(`Remove Applicant ${applicantIndex + 1} and their entered details?`)) { editPayload({ applicants: draft.applicants.filter((_, index) => index !== applicantIndex) }); setApplicantIndex(0); } }}>Remove this applicant</button>}
          <div className="step-actions"><button type="button" disabled={step === 0} onClick={() => switchStep(step - 1)}>Back</button><span>{step + 1} of {sections.length}</span>{step < sections.length - 1 ? <button type="button" className="primary" onClick={() => switchStep(step + 1)}>Next</button> : <span />}</div>
        </section><aside className="help-card"><span className="section-kicker">A LITTLE GUIDANCE</span><h3>Take your time.</h3><p>Save your draft whenever you pause. To return, open the original invitation and request a fresh verification code.</p><p>Your session lasts up to one hour. Unsaved changes are cleared when the session ends.</p><p>Use the form to enter your answers. Supporting PDFs and other files help the team review your application; uploading them does not automatically fill the form.</p><div className="help-divider" /><strong>Need a hand?</strong><p>Reply to your invitation or contact your Ballantyne representative. Do not send identity numbers by ordinary email.</p></aside></div>
        <div className="save-bar"><div role="status" aria-live="polite"><strong>{readonly ? "Submitted for review" : dirty ? "You have unsaved changes" : "Your draft is saved"}</strong><span>{sessionExpiresAt ? `Session ends ${dateLabel(sessionExpiresAt)}` : ""}</span></div><div className="save-actions"><button type="button" disabled={busy} onClick={reload}>Reload latest draft</button>{!readonly && <button type="button" className="primary" disabled={busy || conflict} onClick={() => save()}>{busy ? "Working…" : "Save draft"}</button>}<button type="button" className="text-button" onClick={() => { if (!dirty || window.confirm("You have unsaved changes. End this session without saving?")) endAccess("You have ended this session. Reopen the original email link when you are ready to continue."); }}>End session</button></div></div>
      </>}
    </main>
    <footer><span>Ballantyne Title</span><p>Private joint venture intake · Information provided for review</p></footer>
  </div>;
}

const root = typeof document === "undefined" ? null : document.getElementById("root");
if (root) createRoot(root).render(<RecipientApp />);
