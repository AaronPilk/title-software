"use client";

import { useEffect, useRef, useState } from "react";
import { backendRequest } from "@/lib/backend/client";
import { vendorIntentKey, type VendorIntent } from "@/lib/backend/vendor-callback";
import type { Access } from "@/lib/backend/workspace";
import type { Vendor, VendorStatus } from "@/lib/backend/vendor-integrations";
import type { DocusignTemplate } from "@/lib/backend/docusign";
import type { QuickBooksProfitAndLoss } from "@/lib/backend/quickbooks";
import { businessDay } from "@/lib/title/business-date";
import styles from "./vendor-settings.module.css";

type Company = { id: string; name: string };
type Props = { workspaceId: string; access: Access; companies: Company[] };
type Provider = { provider: Vendor; appConfigured: boolean; environment: "sandbox" | "production" | null; redirectUri: string | null };
type Directory = { providers: Provider[]; connections: VendorStatus[] };
type Draft = { requestId: string; envelopeId: string | null; status: string; envelopeStatus?: string | null; lastCheckedAt?: string | null };
type Recipient = { roleName: string; name: string; email: string };
const names: Record<Vendor, string> = { docusign: "DocuSign", quickbooks: "QuickBooks" };
class StaleResponse extends Error {}
const errorText = (error: unknown) => error instanceof Error ? error.message : "The connection request could not be completed. Try again.";

export function VendorSettings(props: Props) {
  const { access, workspaceId } = props;
  if (access.role !== "owner" && !(access.role === "admin" && access.allCompanies))
    return <p className={styles.note}>An organization administrator manages DocuSign and QuickBooks connections.</p>;
  // A change of account or permissions removes private reports and draft fields
  // immediately, including results of requests begun in the previous context.
  const identity = JSON.stringify([workspaceId, access.userId, access.role, access.version, access.allCompanies, access.companyIds, access.restricted]);
  return <SettingsSession key={identity} {...props} />;
}

function SettingsSession({ workspaceId, access, companies }: Props) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [provider, setProvider] = useState<Vendor>("docusign");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const selectedCompany = companies.find(company => company.id === companyId) ?? companies[0];
  useEffect(() => {
    let current = true;
    backendRequest<Directory>("/integrations/vendors", undefined, "GET", undefined, workspaceId, access.userId)
      .then(result => { if (current) setDirectory(result); })
      .catch(reason => { if (current) setError(errorText(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, access.userId, refresh]);
  function reload() { setLoading(true); setError(""); setDirectory(null); setRefresh(value => value + 1); }
  const app = directory?.providers.find(item => item.provider === provider);
  const connection = directory?.connections.find(item => item.companyId === selectedCompany?.id && item.provider === provider);
  return <section className={styles.root} aria-label="DocuSign and QuickBooks connections">
    <div className={styles.top}><div><h3>Signature & accounting connections</h3><p>Connect each title company to its own vendor account.</p></div><button type="button" disabled={loading} onClick={reload}>Refresh connections</button></div>
    <div className={styles.fields}>
      <label>Title company<select aria-label="Title company" value={selectedCompany?.id ?? ""} onChange={event => setCompanyId(event.target.value)} disabled={!companies.length}>
        {!companies.length && <option value="">Create a title company first</option>}
        {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select></label>
      <label>Service<select aria-label="Service" value={provider} onChange={event => setProvider(event.target.value as Vendor)}><option value="docusign">DocuSign</option><option value="quickbooks">QuickBooks</option></select></label>
    </div>
    {loading && <p role="status">Loading connection settings…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!loading && !error && app && <>
      {!app.appConfigured && <div className={styles.setup}>
        <span className={styles.badge}>App setup needed</span><h4>{names[provider]} is ready for account setup</h4>
        <p>Your developer must install {provider === "docusign" ? "the integration key and secret" : "the app client ID and secret"} on the server. Then an administrator can connect each company here.</p>
        <ol><li>Create a {provider === "docusign" ? "DocuSign developer app and demo account" : "QuickBooks Online developer app and sandbox company"}.</li><li>Register the callback address provided by your developer.</li><li>Complete a sandbox connection and review its results before connecting live accounts.</li></ol>
        <a href={provider === "docusign" ? "https://developers.docusign.com/platform/auth/authcode/" : "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0"} target="_blank" rel="noreferrer">Open {names[provider]} setup documentation ↗</a>
      </div>}
      {!selectedCompany && <p className={styles.note}>Add your title companies before connecting their vendor accounts.</p>}
      {selectedCompany && <ConnectionPanel key={`${provider}:${selectedCompany.id}:${connection?.revision ?? 0}:${app.environment ?? "unset"}:${app.appConfigured}`} workspaceId={workspaceId} access={access} company={selectedCompany} app={app} connection={connection} onDisconnected={reload} />}
    </>}
  </section>;
}

function ConnectionPanel({ workspaceId, access, company, app, connection, onDisconnected }: {
  workspaceId: string; access: Access; company: Company; app: Provider; connection?: VendorStatus; onDisconnected: () => void;
}) {
  const provider = app.provider, name = names[provider];
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [accountId, setAccountId] = useState(connection?.metadata.accountId ?? "");
  const [disconnectReview, setDisconnectReview] = useState(false);
  const [templates, setTemplates] = useState<DocusignTemplate[] | null>(null), [moreTemplates, setMoreTemplates] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [draftClock, setDraftClock] = useState(Date.now);
  const [templateId, setTemplateId] = useState(""), [subject, setSubject] = useState("");
  const [roles, setRoles] = useState<Recipient[]>([{ roleName: "", name: "", email: "" }]);
  const [reviewed, setReviewed] = useState(false), [draftSaved, setDraftSaved] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => businessDay().slice(0, 7) + "-01"), [endDate, setEndDate] = useState(() => businessDay());
  const [accountingMethod, setAccountingMethod] = useState<"Cash" | "Accrual">("Accrual");
  const [report, setReport] = useState<QuickBooksProfitAndLoss | null>(null);
  const mounted = useRef(false), busyRef = useRef(false), revision = useRef(connection?.revision ?? 0);
  const draftIntent = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function call<T extends { revision?: number }>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
    const result = await backendRequest<T>(`/integrations/vendors/${operation}`, {
      workspaceId, provider, companyId: company.id, expectedRevision: revision.current, expectedGeneration: connection?.generation ?? 0, ...input,
    }, "POST", 60_000, workspaceId, access.userId);
    if (!mounted.current) throw new StaleResponse();
    if (typeof result.revision === "number") revision.current = result.revision;
    return result;
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current || connection?.busy) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { if (mounted.current && !(reason instanceof StaleResponse)) setError(errorText(reason)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function editDraft(update: () => void) { update(); setReviewed(false); setDraftSaved(false); setPendingDraft(null); setNotice(""); }
  const connected = !!connection?.configured;
  const disabled = busy || !!connection?.busy || !app.appConfigured;
  async function startConnection() {
    const result = await call<{ url: string; state: string; expiresAt: string; revision?: number }>("start", { accountId: provider === "docusign" ? accountId.trim() : "" });
    const url = new URL(result.url);
    const approved = provider === "docusign" ? ["https://account-d.docusign.com", "https://account.docusign.com"] : ["https://appcenter.intuit.com"];
    if (!approved.includes(url.origin) || url.username || url.password) throw new Error("The authorization address was not recognized. Refresh settings and try again.");
    const intent: VendorIntent = { state: result.state, provider, companyId: company.id, workspaceId, userId: access.userId, accountId: provider === "docusign" ? accountId.trim() : "", expiresAt: result.expiresAt };
    try { sessionStorage.setItem(vendorIntentKey, JSON.stringify(intent)); } catch { throw new Error("Allow session storage in this browser before connecting an account."); }
    window.location.assign(result.url);
  }
  async function loadDrafts() {
    const result = await call<{ drafts: Draft[]; revision: number }>("drafts"); setDrafts(result.drafts); setDraftClock(Date.now());
  }
  async function checkDraft(requestId: string) {
    const result = await call<{ pending?: boolean; message?: string; draft?: Draft; revision?: number }>("draft-status", { requestId });
    if (result.pending) setNotice("No matching envelope was found yet. Check DocuSign before preparing another draft. This request was not resent.");
    else { setNotice("Draft status refreshed from DocuSign."); if (requestId === pendingDraft) { setPendingDraft(null); setDraftSaved(true); } }
    await loadDrafts();
  }
  function draftCoolingDown(draft: Draft) {
    return !!draft.lastCheckedAt && Date.parse(draft.lastCheckedAt) + 15 * 60_000 > draftClock;
  }
  async function createDraft() {
    const payload = { templateId, emailSubject: subject.trim(), roles: roles.map(role => ({ roleName: role.roleName.trim(), name: role.name.trim(), email: role.email.trim() })) };
    const fingerprint = JSON.stringify(payload);
    if (draftIntent.current?.fingerprint !== fingerprint) draftIntent.current = { fingerprint, id: crypto.randomUUID() };
    const requestId = draftIntent.current.id;
    // Keep this ID after a network failure. Retrying the same request reaches
    // the existing reservation; it cannot create a second envelope.
    setPendingDraft(requestId);
    const result = await call<{ draft?: Draft; envelopeId?: string; pending?: boolean; revision: number }>("draft", { ...payload, requestId, reviewed: true });
    if (result.pending) setNotice("The draft may still be processing. Check its status before preparing another draft. It was not sent again.");
    else { setDraftSaved(true); setPendingDraft(null); setNotice("Draft prepared in DocuSign. Open DocuSign to review it before sending; no email was sent here."); }
    await loadDrafts();
  }
  return <div className={styles.panel}>
    <div className={styles.top}><div><h4>{name} · {company.name}</h4><p>{connected ? connection.metadata.accountName || "Connected account" : "No account connected for this company."}</p></div><span className={styles.badge}>{connected ? `Connected · ${connection.environment === "sandbox" ? "Sandbox" : "Production"}` : "Not connected"}</span></div>
    {connection?.busy && <p role="status" className={styles.note}>This connection is being updated. Refresh connections in a moment.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {app.appConfigured && <>
      <p className={styles.note}>{app.environment === "sandbox" ? "Sandbox: use fictional test data while verifying this connection." : "Production: this connects to the selected company's live vendor account."}</p>
      {provider === "docusign" && <label>DocuSign account ID<input value={accountId} onChange={event => setAccountId(event.target.value)} maxLength={36} disabled={busy} placeholder="Account ID from DocuSign Apps and Keys" /></label>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={disabled || (provider === "docusign" && !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(accountId.trim()))} onClick={() => void run(startConnection)}>{connected ? `Reconnect ${name}` : `Connect ${name}`}</button>
        {connected && <button type="button" disabled={disabled} onClick={() => void run(async () => { const result = await call<{ verified: boolean; revision: number }>("check"); if (!result.verified) throw new Error("The connection could not be verified."); setNotice(`${name} connection verified for ${company.name}.`); })}>Check connection</button>}
      </div>
    </>}
    {connected && <div className={styles.actions}><button type="button" disabled={busy || !!connection?.busy} onClick={() => setDisconnectReview(value => !value)}>Remove connection</button></div>}
    {disconnectReview && <div className={styles.confirm} role="group" aria-label="Confirm removal">
        <p>Remove {name} from {company.name} in Title Software? To revoke the vendor&apos;s app permission too, use your {name} account settings.</p>
        <div className={styles.actions}><button type="button" disabled={busy || !!connection?.busy} onClick={() => void run(async () => { await call("disconnect"); onDisconnected(); })}>Confirm removal</button><button type="button" disabled={busy} onClick={() => setDisconnectReview(false)}>Keep connection</button></div>
      </div>}
    {connected && app.appConfigured && provider === "quickbooks" && <section className={styles.work} aria-label="QuickBooks report review">
      <h4>Review a Profit and Loss report</h4><p>Read the connected company&apos;s report. This does not post entries or change your accounting records.</p>
      <div className={styles.fields}><label>Report start date<input type="date" value={startDate} disabled={busy} onChange={event => { setStartDate(event.target.value); setReport(null); }} /></label><label>Report end date<input type="date" value={endDate} disabled={busy} onChange={event => { setEndDate(event.target.value); setReport(null); }} /></label><label>Accounting basis<select aria-label="Accounting basis" value={accountingMethod} disabled={busy} onChange={event => { setAccountingMethod(event.target.value as "Cash" | "Accrual"); setReport(null); }}><option value="Accrual">Accrual</option><option value="Cash">Cash</option></select></label></div>
      <button type="button" disabled={disabled || !startDate || !endDate || startDate > endDate} onClick={() => void run(async () => { setReport(null); const result = await call<{ report: QuickBooksProfitAndLoss; revision: number }>("report", { startDate, endDate, accountingMethod }); setReport(result.report); })}>Load Profit and Loss</button>
      {report && <div className={styles.report}><p><strong>{company.name}</strong> · {report.startDate} through {report.endDate} · {report.accountingMethod} · {report.currency}</p><p className={styles.note}>Generated by QuickBooks: {report.generatedAt}</p><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Profit and Loss table"><table><caption>Profit and Loss — {company.name}</caption><thead><tr>{report.columns.map((column, index) => <th key={index} scope="col">{column || (index === 0 ? "Account" : "Value")}</th>)}</tr></thead><tbody>{report.rows.map((row, index) => <tr key={index} className={row.kind !== "data" ? styles.total : undefined}>{row.cells.map((cell, cellIndex) => <td key={cellIndex} style={cellIndex === 0 ? { paddingLeft: `${12 + row.depth * 12}px` } : undefined}>{cell}</td>)}</tr>)}</tbody></table></div>{!report.rows.length && <p>No report data for these dates.</p>}</div>}
    </section>}
    {connected && app.appConfigured && provider === "docusign" && <section className={styles.work} aria-label="DocuSign draft preparation">
      <h4>Prepare a signature draft</h4><p>Select an approved template and its exact recipient role names. The envelope stays a draft in DocuSign; review and send it there.</p>
      <div className={styles.actions}><button type="button" disabled={disabled} onClick={() => void run(async () => { const result = await call<{ templates: DocusignTemplate[]; hasMore: boolean; revision: number }>("templates"); setTemplates(result.templates); setMoreTemplates(result.hasMore); setReviewed(false); if (!result.templates.some(template => template.templateId === templateId)) setTemplateId(""); })}>Load templates</button><button type="button" disabled={disabled} onClick={() => void run(loadDrafts)}>Load prepared drafts</button></div>
      {templates && <form onSubmit={event => { event.preventDefault(); if (reviewed) void run(createDraft); }}>
        {!templates.length && <p>No templates returned. Prepare an approved template in this DocuSign account first.</p>}
        {moreTemplates && <p className={styles.note}>Only the first available template page is shown. Ask your developer if the template you need is missing.</p>}
        <label>Signature template<select aria-label="Signature template" value={templateId} disabled={disabled} required onChange={event => editDraft(() => setTemplateId(event.target.value))}><option value="">Choose a template</option>{templates.map(template => <option key={template.templateId} value={template.templateId}>{template.name}</option>)}</select></label>
        {templates.find(template => template.templateId === templateId)?.description && <p className={styles.note}>{templates.find(template => template.templateId === templateId)!.description}</p>}
        <label>Envelope subject<input value={subject} maxLength={100} required disabled={disabled} onChange={event => editDraft(() => setSubject(event.target.value))} /></label>
        {roles.map((role, index) => <fieldset key={index} className={styles.recipient} disabled={disabled}><legend>Recipient {index + 1}</legend><div className={styles.fields}>
          <label>Template role {index + 1}<input value={role.roleName} maxLength={100} required onChange={event => editDraft(() => setRoles(values => values.map((value, at) => at === index ? { ...value, roleName: event.target.value } : value)))} /></label>
          <label>Recipient name {index + 1}<input value={role.name} maxLength={100} required onChange={event => editDraft(() => setRoles(values => values.map((value, at) => at === index ? { ...value, name: event.target.value } : value)))} /></label>
          <label>Recipient email {index + 1}<input type="email" value={role.email} maxLength={254} required onChange={event => editDraft(() => setRoles(values => values.map((value, at) => at === index ? { ...value, email: event.target.value } : value)))} /></label>
        </div>{roles.length > 1 && <button type="button" onClick={() => editDraft(() => setRoles(values => values.filter((_, at) => at !== index)))}>Remove recipient {index + 1}</button>}</fieldset>)}
        <button type="button" disabled={disabled || roles.length >= 20} onClick={() => editDraft(() => setRoles(values => [...values, { roleName: "", name: "", email: "" }]))}>Add recipient</button>
        <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} />I reviewed {company.name}, the template, subject and all recipients.</label>
        <button className={styles.primary} type="submit" disabled={disabled || !reviewed || !templateId || !subject.trim() || draftSaved}>{draftSaved ? "Draft prepared" : "Prepare DocuSign draft"}</button>
      </form>}
      {pendingDraft && <div className={styles.confirm}><p>The request may have reached DocuSign. Check its status before preparing another draft. Retrying unchanged details reuses this request.</p><button type="button" disabled={disabled || !!drafts?.some(draft => draft.requestId === pendingDraft && draftCoolingDown(draft))} onClick={() => void run(() => checkDraft(pendingDraft))}>Check pending draft status</button></div>}
      {drafts && <div className={styles.drafts}><h4>Prepared drafts for {company.name}</h4><p className={styles.note}>DocuSign status checks are limited to once every 15 minutes per envelope. Load prepared drafts again after that interval to re-enable a check.</p>{!drafts.length && <p>No draft requests recorded for this company.</p>}{drafts.map(draft => <article key={draft.requestId}><div><strong>{draft.envelopeStatus || draft.status}</strong><p>{draft.envelopeId ? `Envelope ${draft.envelopeId}` : "Awaiting a confirmed envelope"}</p>{draftCoolingDown(draft) && <p>Next check after {new Date(Date.parse(draft.lastCheckedAt!) + 15 * 60_000).toLocaleTimeString()}.</p>}</div><button type="button" disabled={disabled || draftCoolingDown(draft)} onClick={() => void run(() => checkDraft(draft.requestId))}>Check draft status</button></article>)}</div>}
    </section>}
    {busy && <p role="status" className={styles.note}>Working with {name}…</p>}
  </div>;
}
