"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Building2, CheckCheck, ClipboardCheck, FileCheck2, GitCompareArrows, History, Info, Link2, Plus, Settings2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/title/store";
import type { Workspace } from "@/lib/title/model";
import { Heading, Picker, Segments, Status, Empty, FieldLabel, SearchBox } from "./shared";
import {
  orchestration, currentProfile, currentFieldMaps, currentOrderLink, currentControl, currentReadiness,
  proposalStaleness, orchestrationFields, readinessItems,
  saveCompanyProfile, saveExternalFieldMap, verifyExternalOrderLink, setOrchestrationControl,
  attestReadiness, proposeExternalChange, reviewExternalProposal, recordExternalOutcome, matchExternalOrder,
} from "@/lib/title/orchestration";
import styles from "./orchestration.module.css";

type Proposal = ReturnType<typeof orchestration>["proposals"][number];
type Profile = ReturnType<typeof currentProfile>;
type Save = (change: (draft: Workspace) => void, title: string) => Promise<boolean>;
type Modal = { kind: "profile" | "control" | "proposal" | "match" } | { kind: "mapping"; field?: string } | { kind: "link"; orderId: string } | { kind: "readiness"; key: string } | { kind: "review"; id: string; decision: "Approved" | "Rejected" } | { kind: "outcome"; id: string } | null;
const fieldLabels: Record<string, string> = {
  address: "Property address", client: "Buyer / insured", seller: "Seller", lender: "Lender", loanAmount: "Loan amount",
  legalDescription: "Legal description", county: "County", attorney: "Attorney", attorneyEmail: "Attorney email",
};
const value = (f: FormData, key: string) => String(f.get(key) || "").trim();
const lines = (text: string) => text.split(/[\n,;]/).map(x => x.trim()).filter(Boolean);
const dateTime = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const fieldLabel = (field: string) => fieldLabels[field] || field;

function Note({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={`${styles.note} ${warning ? styles.warning : ""}`}><Info size={16} /><div>{children}</div></div>;
}
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children || "Not provided"}</dd></div>;
}
function Panel({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.panel}><header className={styles.panelHead}><div><h2>{title}</h2><p>{description}</p></div>{action}</header>{children}</section>;
}

export function OrchestrationWorkspace() {
  const { s, update, connection } = useWorkspace();
  const [companyChoice, setCompanyChoice] = useState("");
  const companyId = s.companies.some(c => c.id === companyChoice) ? companyChoice : s.companies[0]?.id || "";
  const company = s.companies.find(c => c.id === companyId);
  const [tab, setTab] = useState("Setup");
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState("All");
  const data = orchestration({ ...s });
  const profile = currentProfile(s, companyId);
  const maps = currentFieldMaps(s, companyId);
  const control = currentControl(s, companyId);
  const readiness = currentReadiness(s, companyId);
  const proposals = data.proposals.filter(p => p.companyId === companyId).slice().reverse();
  const events = data.events.filter(e => e.companyId === companyId).slice().reverse();
  const orders = s.orders.filter(o => o.companyId === companyId);
  const linked = orders.filter(o => { const link = currentOrderLink(s, o.id); return link && link.profileId === profile?.id; }).length;
  const readyCount = readiness.filter(r => r.status === "Ready").length;
  const pending = proposals.filter(p => p.status === "Pending review" || p.status === "Exception").length;
  const admin = !connection || ["owner", "admin"].includes(connection.access.role);
  const mayConfigureProfile = !connection || connection.access.role === "owner" || connection.access.role === "admin" && connection.access.allCompanies;
  const operator = !connection || ["owner", "admin", "operations"].includes(connection.access.role);
  const approver = operator && !!profile?.approvers.some(a => a.toLowerCase() === s.user.toLowerCase());
  const saving = !!connection?.saving;
  const canPropose = operator && !!profile && maps.some(m => m.canWrite && m.profileId === profile.id) && control.mode === "Propose" && !control.paused;
  const save: Save = async (change, title) => {
    const saved = await update(change, title, company?.name || "Company connection");
    if (saved) setModal(null);
    return saved;
  };
  const selectedProposal = modal && "id" in modal ? proposals.find(p => p.id === modal.id) : undefined;

  return <div className={styles.workspace}>
    <Heading eyebrow="BALLANTYNE TITLE" title="Connections" description="Keep SoftPro authoritative. Give every handoff a clear owner, source, and review." />
    <section className={styles.hero}>
      <div className={styles.heroLead}><span className={styles.heroIcon}><Link2 size={23} /></span><div><h2>One production system. A clearer way to work.</h2><p>Map each company to its existing SoftPro environment, verify file references, and review proposed changes together. Vendor access and provider-approved configuration are required before live synchronization.</p></div></div>
      <span className={styles.tag}><ShieldCheck size={14} /> Reviewed workspace records</span>
    </section>
    {!company ? <Empty title="Start with a company" text="Add your title company in Companies, then return here to document its SoftPro and Missive setup." /> : <>
      <div className={styles.scope}><div className={styles.company}><span>Company</span><Picker label="Connection company" value={companyId} options={s.companies.map(c => ({ value: c.id, label: c.name }))} onChange={id => { setCompanyChoice(id); setModal(null); setQuery(""); }} /></div><div className={styles.actions}><Status value={control.paused ? "Paused" : control.mode} />{admin && <Button variant="outline" onClick={() => setModal({ kind: "control" })} disabled={saving}><Settings2 size={15} /> Review controls</Button>}</div></div>
      {control.paused && <Note warning><p>New proposals and approvals are paused for this company. Existing records remain available for review.</p></Note>}
      <div className={styles.metrics}>
        <div className={styles.metric}><span><Building2 size={14} /> Company setup</span><strong>{profile ? "Mapped" : "Needed"}</strong><small>{profile ? profile.externalCompanyName : "Confirm the existing SoftPro company"}</small></div>
        <div className={styles.metric}><span><FileCheck2 size={14} /> Verified file links</span><strong>{linked}<span className={styles.caption}> / {orders.length}</span></strong><small>Manually checked against SoftPro</small></div>
        <div className={styles.metric}><span><GitCompareArrows size={14} /> Needs review</span><strong>{pending}</strong><small>Proposals and exceptions awaiting a decision</small></div>
        <div className={styles.metric}><span><ClipboardCheck size={14} /> Business inputs</span><strong>{readyCount}<span className={styles.caption}> / {readinessItems.length}</span></strong><small>Readiness evidence recorded</small></div>
      </div>
      <div className={styles.tabs}><Segments value={tab} onChange={setTab} items={["Setup", "Files", "Review queue", "Readiness", "History"]} /></div>
      {tab === "Setup" && <div className={styles.layout}>
        <Panel title="Company identity & routing" description="Use the exact company selected inside your existing SoftPro environment." action={mayConfigureProfile && <Button variant="outline" size="sm" onClick={() => setModal({ kind: "profile" })} disabled={saving}>{profile ? "Edit setup" : "Add setup"}</Button>}>
          {profile ? <div className={`${styles.panelBody} ${styles.stack}`}><dl className={`${styles.detailList} ${styles.detailGrid}`}>
            <Detail label="SoftPro environment">{profile.environmentId}</Detail><Detail label="SoftPro company ID">{profile.externalCompanyId}</Detail><Detail label="SoftPro company name">{profile.externalCompanyName}</Detail><Detail label="Underwriter">{profile.underwriter}</Detail>
            <Detail label="SoftPro 360 channel">{profile.softPro360Channel}</Detail><Detail label="Inbox aliases">{profile.inboxAliases.join("\n")}</Detail><Detail label="Approved template reference">{profile.templateRef}</Detail><Detail label="Archive convention">{profile.archiveRule}</Detail><Detail label="Authorized reviewers">{profile.approvers.join("\n")}</Detail><Detail label="Verified against">{profile.evidence}</Detail>
          </dl><p className={styles.caption}>Setup version {profile.version} · Recorded by {profile.createdBy} · {dateTime(profile.createdAt)}</p><Note><p>Company mappings document the existing business structure. Adding another JV does not create another SoftPro account.</p></Note></div> : <Empty title="Confirm this company’s setup" text="Record its exact SoftPro identity, the inboxes it uses, approved templates, and who can review changes." action={mayConfigureProfile && <Button onClick={() => setModal({ kind: "profile" })}><Plus size={15} /> Add company setup</Button>} />}
        </Panel>
        <div className={styles.stack}>
          <Panel title="Field mapping" description="Actual provider field identifiers, confirmed from your environment." action={admin && profile && <Button variant="outline" size="sm" onClick={() => setModal({ kind: "mapping" })} disabled={saving}><Plus size={14} /> Map field</Button>}>
            {!maps.length ? <Empty title="No fields mapped" text="After company setup, add verified external field identifiers and document whether each can be read or proposed for a change." /> : <ul className={styles.list}>{maps.map(m => <li key={m.id}><div className={styles.rowHead}><div><h3>{fieldLabel(m.localField)}</h3><p>{m.externalFieldId}</p></div><Status value={m.profileId === profile?.id ? m.risk : "Needs review"} /></div><div className={styles.rowFoot}><span className={styles.tag}>{m.canRead ? "Read" : "No read"}</span><span className={styles.tag}>{m.canWrite ? "Reviewed change" : "Read only"}</span><small>Version {m.version}</small>{admin && <Button variant="ghost" size="sm" onClick={() => setModal({ kind: "mapping", field: m.localField })} disabled={saving}>Review mapping</Button>}</div><p className={styles.caption}>{m.evidence}</p>{m.profileId !== profile?.id && <p className={styles.caption}>Reconfirm this mapping for the current company setup.</p>}</li>)}</ul>}
          </Panel>
          <Note><p>Get the SoftPro connection method and permissions from your administrator or SoftPro support. Existing SoftPro 360 integrations stay in their current environment. Store credentials through server setup; this page records business configuration.</p></Note>
        </div>
      </div>}
      {tab === "Files" && <section>
        <div className={styles.toolbar}><div><h2>Match the file before any change</h2><p className={styles.caption}>Confirm the company, property, and file number against SoftPro.</p></div><div className={styles.actions}><SearchBox value={query} onChange={setQuery} placeholder="Search file or property…" /><Button variant="outline" onClick={() => setModal({ kind: "match" })}><GitCompareArrows size={15} /> Match a source</Button></div></div>
        {!orders.length ? <Empty title="No title files for this company" text="Create or select a title file in Orders, then verify its existing SoftPro reference here." /> : <div className={styles.fileGrid}>{orders.filter(o => `${o.id} ${o.address} ${o.client}`.toLowerCase().includes(query.toLowerCase())).map(o => {
          const link = currentOrderLink(s, o.id);
          const threads = s.inbox.filter(m => m.orderId === o.id && m.missive);
          return <article className={styles.file} key={o.id}><div className={styles.fileTop}><FileCheck2 size={20} /><div><h3>{o.address}</h3><p>{o.id} · {o.client}</p></div></div><Status value={link && link.profileId === profile?.id ? "Manually verified" : "Needs review"} />
            <dl className={styles.detailList}><Detail label="SoftPro file number">{link?.externalFileNumber}</Detail><Detail label="SoftPro file ID">{link?.externalFileId}</Detail><Detail label="Missive conversation">{link?.missiveConversationId}</Detail>{link && <Detail label="Verification evidence">{link.evidence}</Detail>}</dl>
            {!!threads.length && <p className={styles.candidate}><strong>{threads.length} imported conversation reference{threads.length === 1 ? "" : "s"}</strong> associated with this file. Confirm the original conversation when recording its link.</p>}
            <div className={styles.rowFoot}>{operator && <Button variant="outline" size="sm" onClick={() => setModal({ kind: "link", orderId: o.id })} disabled={!profile || saving}>{link ? "Recheck file link" : "Verify file link"}</Button>}{!profile && <small>Company setup comes first.</small>}{link && <small>Version {link.version} · {dateTime(link.createdAt)}{link.profileId !== profile?.id ? " · Company setup changed; recheck this link." : ""}</small>}</div>
          </article>;
        })}</div>}
        {!!orders.length && !orders.some(o => `${o.id} ${o.address} ${o.client}`.toLowerCase().includes(query.toLowerCase())) && <Empty title="No matching files" text="Try the property address, buyer, or workspace file number." />}
      </section>}
      {tab === "Review queue" && <section className={styles.stack}>
        <div className={styles.toolbar}><div><h2>A decision with the source beside it</h2><p className={styles.caption}>Approval records intent. A separate receipt records a person’s work in SoftPro.</p></div><div className={styles.actions}><Picker label="Proposal status" value={queueFilter} onChange={setQueueFilter} options={["All", "Pending review", "Exception", "Approved", "Rejected", "Recorded"]} />{operator && <Button disabled={!canPropose || saving} onClick={() => setModal({ kind: "proposal" })}><Plus size={15} /> New proposal</Button>}</div></div>
        {!canPropose && operator && <Note><p>{control.paused ? "Resume this company’s controls before preparing proposals." : control.mode !== "Propose" ? "The company is in Observe mode. An administrator can enable Propose after reviewing the setup." : "Complete company setup and confirm a writable field for the current setup before preparing a proposal."}</p></Note>}
        {!proposals.filter(p => queueFilter === "All" || p.status === queueFilter).length ? <Empty title="No proposals in this view" text="Start with a verified file link and a source document. Each proposal preserves the before and after values for review." /> : proposals.filter(p => queueFilter === "All" || p.status === queueFilter).map(p => <ProposalCard key={p.id} proposal={p} s={s} mayReview={approver} operator={operator} paused={control.paused || control.mode !== "Propose"} saving={saving} onReview={decision => setModal({ kind: "review", id: p.id, decision })} onOutcome={() => setModal({ kind: "outcome", id: p.id })} />)}
      </section>}
      {tab === "Readiness" && <section className={styles.stack}>
        <Note><p>These are business attestations with supporting evidence. Completing this checklist does not verify an API connection or authorize live production changes.</p></Note>
        <div className={styles.readiness}>{readinessItems.map(item => {
          const entry = readiness.find(r => r.key === item.key);
          return <article className={styles.readinessItem} key={item.key}><div className={styles.rowHead}><h3>{item.label}</h3><Status value={entry?.status || "Missing"} /></div><p>{entry?.evidence || "Add the business decision, document reference, or named owner needed to confirm this item."}</p>{entry && <p className={styles.caption}>{entry.createdBy} · {dateTime(entry.createdAt)}</p>}{admin && <Button variant="outline" size="sm" onClick={() => setModal({ kind: "readiness", key: item.key })} disabled={saving}>{entry ? "Update evidence" : "Add evidence"}</Button>}</article>;
        })}</div>
      </section>}
      {tab === "History" && <Panel title="Connection history" description="Who changed the setup, reviewed a proposal, or recorded an outcome.">
        {!events.length ? <Empty title="A clear history starts here" text="Setup changes, verified links, decisions, and receipts will appear as they are recorded." /> : <ol className={styles.timeline}>{events.map(event => <li key={event.id}><span className={styles.timelineDot}><History size={14} /></span><div><h3>{event.action}</h3><p>{event.note}</p><small>{event.createdBy} · {dateTime(event.createdAt)}</small></div></li>)}</ol>}
      </Panel>}
      <Dialog open={!!modal} onOpenChange={open => { if (!open && !saving) setModal(null); }}><DialogContent className={styles.dialog}>
        {modal?.kind === "profile" && <ProfileForm key={companyId} companyId={companyId} companyName={company.name} profile={profile} save={save} />}
        {modal?.kind === "mapping" && <MappingForm companyId={companyId} maps={maps} initialField={modal.field} save={save} />}
        {modal?.kind === "match" && <MatchForm s={s} companyId={companyId} mayVerify={operator} onVerify={orderId => setModal({ kind: "link", orderId })} />}
        {modal?.kind === "control" && <ControlForm companyId={companyId} mode={control.mode} paused={control.paused} save={save} />}
        {modal?.kind === "link" && <LinkForm s={s} orderId={modal.orderId} save={save} />}
        {modal?.kind === "readiness" && <ReadinessForm companyId={companyId} itemKey={modal.key} current={readiness.find(r => r.key === modal.key)} save={save} />}
        {modal?.kind === "proposal" && <ProposalForm s={s} companyId={companyId} save={save} />}
        {modal?.kind === "review" && selectedProposal && <ReviewForm s={s} proposal={selectedProposal} decision={modal.decision} save={save} />}
        {modal?.kind === "outcome" && selectedProposal && <OutcomeForm proposal={selectedProposal} canRecordApplied={!control.paused && control.mode === "Propose" && !proposalStaleness(s, selectedProposal).length} save={save} />}
      </DialogContent></Dialog>
    </>}
  </div>;
}

function FormHeader({ title, description }: { title: string; description: string }) {
  return <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>;
}
function useFormSave(save: Save) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return { busy, error, submit: async (e: FormEvent<HTMLFormElement>, build: (f: FormData) => (draft: Workspace) => void, title: string) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try { if (!await save(build(f), title)) setError("This change was not saved. Check the workspace message and try again."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This change could not be saved."); }
    finally { setBusy(false); }
  } };
}
function FormError({ error }: { error: string }) { return error ? <p className={styles.error} role="alert">{error}</p> : null; }

function ProfileForm({ companyId, companyName, profile, save }: { companyId: string; companyName: string; profile: Profile; save: Save }) {
  const { busy, error, submit } = useFormSave(save);
  return <><FormHeader title="Company setup" description={`${companyName} · Document the existing SoftPro company and the business-approved workflow.`} /><form className={styles.form} onSubmit={e => void submit(e, f => d => saveCompanyProfile(d, {
    companyId, environmentId: value(f, "environmentId"), externalCompanyId: value(f, "externalCompanyId"), externalCompanyName: value(f, "externalCompanyName"),
    underwriter: value(f, "underwriter"), softPro360Channel: value(f, "softPro360Channel"), inboxAliases: lines(value(f, "inboxAliases")), templateRef: value(f, "templateRef"), archiveRule: value(f, "archiveRule"), approvers: lines(value(f, "approvers")), evidence: value(f, "evidence"),
  }), "Company connection setup recorded")}>
    <div className={styles.grid}>
      <FieldLabel label="Existing SoftPro environment ID"><Input name="environmentId" required maxLength={200} defaultValue={profile?.environmentId} placeholder="Confirmed by your SoftPro administrator" /></FieldLabel>
      <FieldLabel label="Exact SoftPro company ID"><Input name="externalCompanyId" required maxLength={200} defaultValue={profile?.externalCompanyId} /></FieldLabel>
      <FieldLabel label="Exact SoftPro company name"><Input name="externalCompanyName" required maxLength={200} defaultValue={profile?.externalCompanyName} /></FieldLabel>
      <FieldLabel label="Underwriter"><Input name="underwriter" maxLength={200} defaultValue={profile?.underwriter} /></FieldLabel>
      <FieldLabel label="Existing SoftPro 360 channel"><Input name="softPro360Channel" maxLength={200} defaultValue={profile?.softPro360Channel} placeholder="Provider / channel confirmed by the team" /></FieldLabel>
      <FieldLabel label="Approved template reference"><Input name="templateRef" maxLength={500} defaultValue={profile?.templateRef} placeholder="Approved template name or document reference" /></FieldLabel>
      <FieldLabel label="Inbox aliases, one per line"><Textarea name="inboxAliases" rows={3} maxLength={4000} defaultValue={profile?.inboxAliases.join("\n")} placeholder="Company mailbox addresses" /></FieldLabel>
      <FieldLabel label="Authorized reviewer emails, one per line"><Textarea name="approvers" rows={3} required maxLength={4000} defaultValue={profile?.approvers.join("\n")} placeholder="Approved John / Tyler account emails" /></FieldLabel>
    </div>
    <FieldLabel label="Archive and naming convention"><Textarea name="archiveRule" maxLength={2000} defaultValue={profile?.archiveRule} placeholder="Approved storage location, folder structure, and version naming" /></FieldLabel>
    <FieldLabel label="How this setup was verified"><Textarea name="evidence" required maxLength={4000} placeholder="Who confirmed it, when, and the supporting setup document or reference" /></FieldLabel>
    <Note><p>All companies use the same existing SoftPro environment. Changing a company’s setup requires new review of proposals based on the previous version.</p></Note>
    <FormError error={error} /><div className={styles.dialogActions}><Button disabled={busy} type="submit">{busy ? "Saving…" : "Save verified setup"}</Button></div>
  </form></>;
}

function MappingForm({ companyId, maps, initialField, save }: { companyId: string; maps: ReturnType<typeof currentFieldMaps>; initialField?: string; save: Save }) {
  const { busy, error, submit } = useFormSave(save);
  const [field, setField] = useState<string>(initialField || orchestrationFields[0]);
  const current = maps.find(m => m.localField === field);
  const [risk, setRisk] = useState<string>(maps.find(m => m.localField === initialField)?.risk || "Medium");
  return <><FormHeader title="Map an external field" description="Use an identifier verified from the company’s actual SoftPro configuration." /><form className={styles.form} onSubmit={e => void submit(e, f => d => saveExternalFieldMap(d, {
    companyId, localField: field as Parameters<typeof saveExternalFieldMap>[1]["localField"], externalFieldId: value(f, "externalFieldId"), canRead: f.get("canRead") === "on", canWrite: f.get("canWrite") === "on", risk: risk as "Low" | "Medium" | "High", evidence: value(f, "evidence"),
  }), "External field mapping recorded")}>
    <FieldLabel label="Workspace field"><Picker label="Workspace field" value={field} onChange={f => { setField(f); setRisk(maps.find(m => m.localField === f)?.risk || "Medium"); }} options={orchestrationFields.map(f => ({ value: f, label: fieldLabel(f) }))} /></FieldLabel>
    <FieldLabel label="Exact external field identifier"><Input key={`id-${field}`} defaultValue={current?.externalFieldId} name="externalFieldId" required maxLength={300} placeholder="From provider-approved configuration" /></FieldLabel>
    <div className={styles.checkboxRow}><label className={styles.check}><input key={`read-${field}`} name="canRead" type="checkbox" defaultChecked={current?.canRead ?? true} /> Read access documented</label><label className={styles.check}><input key={`write-${field}`} name="canWrite" type="checkbox" defaultChecked={current?.canWrite ?? false} /> Allow reviewed change proposals</label></div>
    <FieldLabel label="Business risk classification"><Picker label="Business risk classification" value={risk} onChange={setRisk} options={["Low", "Medium", "High"]} /></FieldLabel>
    <FieldLabel label="Mapping evidence"><Textarea name="evidence" required maxLength={4000} placeholder="Field dictionary or confirmed configuration reference, access scope, and reviewer" /></FieldLabel>
    <Note><p>Saving an existing workspace field creates a new mapping version. Proposals based on the older mapping must be checked again. Higher-risk fields keep their required classification. All proposals need a named reviewer before a person records an external outcome.</p></Note>
    <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save field mapping"}</Button></div>
  </form></>;
}

function ControlForm({ companyId, mode: initialMode, paused: initialPaused, save }: { companyId: string; mode: "Observe" | "Propose"; paused: boolean; save: Save }) {
  const [mode, setMode] = useState<string>(initialMode);
  const [paused, setPaused] = useState(initialPaused);
  const { busy, error, submit } = useFormSave(save);
  return <><FormHeader title="Company review controls" description="Choose how the team prepares proposed changes and record why the control is changing." /><form className={styles.form} onSubmit={e => void submit(e, f => d => setOrchestrationControl(d, { companyId, mode: mode as "Observe" | "Propose", paused, reason: value(f, "reason") }), "Company review controls updated")}>
    <FieldLabel label="Operating mode"><Picker label="Operating mode" value={mode} onChange={setMode} options={[{ value: "Observe", label: "Observe — setup and review information" }, { value: "Propose", label: "Propose — prepare changes for human review" }]} /></FieldLabel>
    <label className={styles.check}><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /><span><strong>Pause new proposals and approvals</strong><br />Keep existing records visible while a person resolves an issue.</span></label>
    <FieldLabel label="Reason for this setting"><Textarea name="reason" required maxLength={2000} placeholder="Business authorization or issue that prompted this control" /></FieldLabel>
    <Note><p>Neither mode executes changes in SoftPro. Live integration requires separately verified provider access and release approval.</p></Note>
    <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save review controls"}</Button></div>
  </form></>;
}

function LinkForm({ s, orderId, save }: { s: Workspace; orderId: string; save: Save }) {
  const order = s.orders.find(o => o.id === orderId)!;
  const existing = currentOrderLink(s, orderId);
  const candidates = s.inbox.filter(m => m.orderId === orderId && m.missive);
  const profile = currentProfile(s, order.companyId);
  const [fileId, setFileId] = useState(existing?.externalFileId || "");
  const [fileNumber, setFileNumber] = useState(existing?.externalFileNumber || "");
  const [conversation, setConversation] = useState(existing?.missiveConversationId || "");
  const [evidence, setEvidence] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const reviewKey = JSON.stringify([orderId, profile?.id, fileId, fileNumber, conversation, evidence]);
  const { busy, error, submit } = useFormSave(save);
  return <><FormHeader title="Verify the SoftPro file" description={`${order.address} · ${order.id}. Open the original file and confirm the company and identity before recording the link.`} /><form className={styles.form} onSubmit={e => void submit(e, f => d => verifyExternalOrderLink(d, { orderId, externalFileId: value(f, "externalFileId"), externalFileNumber: value(f, "externalFileNumber"), missiveConversationId: value(f, "missiveConversationId"), evidence: value(f, "evidence") }), "External file link verified")}>
    <div className={styles.grid}><FieldLabel label="Exact SoftPro file ID"><Input name="externalFileId" required maxLength={200} value={fileId} onChange={e => setFileId(e.target.value)} /></FieldLabel><FieldLabel label="SoftPro file number"><Input name="externalFileNumber" required maxLength={200} value={fileNumber} onChange={e => setFileNumber(e.target.value)} /></FieldLabel></div>
    <FieldLabel label="Missive conversation ID, if confirmed"><Input name="missiveConversationId" maxLength={200} value={conversation} onChange={e => setConversation(e.target.value)} /></FieldLabel>
    {!!candidates.length && <div className={styles.candidate}><strong>Imported conversation candidates</strong>{candidates.map(m => <p key={m.id}>{m.subject}<br />{m.missive!.conversationId}</p>)}<p>These references came from emails already associated with this workspace file. They still require your review.</p></div>}
    <Note><p>Verify the original file under <strong>{profile?.externalCompanyName}</strong> · SoftPro company ID {profile?.externalCompanyId}.</p></Note>
    <FieldLabel label="Identity checks and supporting reference"><Textarea name="evidence" required maxLength={4000} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Company selected, file number, property, borrower, and where you verified them" /></FieldLabel>
    <label className={styles.check}><input type="checkbox" required checked={acknowledgement === reviewKey} onChange={e => setAcknowledgement(e.target.checked ? reviewKey : "")} /><span>I verified the original SoftPro file and this company. This is a manually checked link.</span></label>
    <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record verified file link"}</Button></div>
  </form></>;
}

function ReadinessForm({ companyId, itemKey, current, save }: { companyId: string; itemKey: string; current: ReturnType<typeof currentReadiness>[number] | undefined; save: Save }) {
  const [status, setStatus] = useState<string>(current?.status || "Missing");
  const { busy, error, submit } = useFormSave(save);
  return <><FormHeader title={readinessItems.find(i => i.key === itemKey)?.label || "Readiness evidence"} description="Record a business attestation and its supporting evidence. Preserve the owner and next step when something is missing." /><form className={styles.form} onSubmit={e => void submit(e, f => d => attestReadiness(d, { companyId, key: itemKey as Parameters<typeof attestReadiness>[1]["key"], status: status as "Missing" | "Ready" | "Blocked", evidence: value(f, "evidence") }), "Readiness evidence recorded")}>
    <FieldLabel label="Readiness status"><Picker label="Readiness status" value={status} onChange={setStatus} options={["Missing", "Ready", "Blocked"]} /></FieldLabel>
    <FieldLabel label="Decision, evidence, and owner"><Textarea name="evidence" rows={5} required maxLength={4000} defaultValue={current?.evidence} placeholder="Document or test reference, who approved it, and any outstanding action" /></FieldLabel>
    <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save readiness evidence"}</Button></div>
  </form></>;
}

function ProposalForm({ s, companyId, save }: { s: Workspace; companyId: string; save: Save }) {
  const profile = currentProfile(s, companyId);
  const orders = s.orders.filter(o => { const link = currentOrderLink(s, o.id); return o.companyId === companyId && link && link.profileId === profile?.id; });
  const maps = currentFieldMaps(s, companyId).filter(m => m.canWrite && m.profileId === profile?.id);
  const [orderId, setOrderId] = useState(orders[0]?.id || "");
  const [mapId, setMapId] = useState(maps[0]?.id || "");
  const [sourceId, setSourceId] = useState("");
  const [match, setMatch] = useState("Confirmed");
  const sources = s.documents.filter(d => d.companyId === companyId && d.orderId === orderId &&
    (!!d.text || (d.assetId && d.mime === "application/pdf")));
  const source = sources.find(d => d.id === sourceId);
  const map = maps.find(m => m.id === mapId);
  const order = orders.find(o => o.id === orderId);
  const { busy, error, submit } = useFormSave(save);
  return <><FormHeader title="Prepare a change for review" description="Capture the original evidence and the values a reviewer should compare. Nothing is sent to SoftPro." />
    {!orders.length || !maps.length ? <Empty title="Verify a file and its fields first" text="A proposal needs a current company setup, verified file link, and mapped field that permits reviewed changes." /> : <form className={styles.form} onSubmit={e => void submit(e, f => d => proposeExternalChange(d, { orderId, fieldMapId: mapId, beforeValue: value(f, "beforeValue"), afterValue: value(f, "afterValue"), sourceDocumentId: sourceId, sourcePage: value(f, "sourcePage"), sourceQuote: value(f, "sourceQuote"), reason: value(f, "reason"), matchStatus: match as "Confirmed" | "Ambiguous" | "Unknown", externalReadEvidence: value(f, "externalReadEvidence") }), "External change proposed")}>
      <FieldLabel label="Verified title file"><Picker label="Verified title file" value={orderId} onChange={id => { setOrderId(id); setSourceId(""); }} options={orders.map(o => ({ value: o.id, label: `${o.id} · ${o.address}` }))} /></FieldLabel>
      <div className={styles.grid}><FieldLabel label="Mapped field"><Picker label="Mapped field" value={mapId} onChange={setMapId} options={maps.map(m => ({ value: m.id, label: `${fieldLabel(m.localField)} · ${m.externalFieldId}` }))} /></FieldLabel><FieldLabel label="File match certainty"><Picker label="File match certainty" value={match} onChange={setMatch} options={["Confirmed", "Ambiguous", "Unknown"]} /></FieldLabel></div>
      {(order?.status === "Issued" || match !== "Confirmed") && <Note warning><p>This proposal will require exception handling. Uncertain matches and changes after issuance are not eligible for routine approval.</p></Note>}
      {map?.risk === "High" && <Note warning><p>High-risk change. A named company reviewer must check the original evidence and record an explicit decision before a person handles it in SoftPro.</p></Note>}
      <div className={styles.grid}><FieldLabel label="Current value observed in SoftPro"><Textarea name="beforeValue" maxLength={10000} /></FieldLabel><FieldLabel label="Proposed replacement value"><Textarea name="afterValue" required maxLength={10000} /></FieldLabel></div>
      <FieldLabel label="Evidence of the current SoftPro value"><Textarea name="externalReadEvidence" required maxLength={4000} placeholder="When you opened the original file, who verified it, and the reference showing the current value" /></FieldLabel>
      {sources.length ? <FieldLabel label="Supporting source document"><Picker label="Supporting source document" value={sourceId || "choose"} onChange={id => setSourceId(id === "choose" ? "" : id)} options={[{ value: "choose", label: "Choose a source document" }, ...sources.map(d => ({ value: d.id, label: `${d.name} · v${d.version}` }))]} /></FieldLabel> : <Note warning><p>This file needs a source document with text or a stored PDF. Add the original source through Documents or the reviewed Missive importer first.</p></Note>}
      {source?.text && <details className={styles.candidate}><summary>Read source: {source.name}</summary><blockquote className={styles.quote}>{source.text}</blockquote></details>}
      {source && !source.text && <Note><p>Use Documents → Read document text to copy the PDF passage and physical page reference. A reviewer must compare the quotation with the original PDF; it is a manual transcription.</p></Note>}
      <FieldLabel label="Source page or section"><Input name="sourcePage" required maxLength={100} placeholder="Page 2, revised lender instructions" /></FieldLabel>
      <FieldLabel label="Exact supporting quotation"><Textarea name="sourceQuote" required rows={3} maxLength={10000} placeholder="Copy the relevant passage from the source document" /></FieldLabel>
      <FieldLabel label="Why this change is needed"><Textarea name="reason" required maxLength={4000} /></FieldLabel>
      <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy || !source}>{busy ? "Saving…" : "Submit for review"}</Button></div>
    </form>}
  </>;
}

function ProposalCard({ proposal: p, s, mayReview, operator, paused, saving, onReview, onOutcome }: { proposal: Proposal; s: Workspace; mayReview: boolean; operator: boolean; paused: boolean; saving: boolean; onReview: (decision: "Approved" | "Rejected") => void; onOutcome: () => void }) {
  const stale = proposalStaleness(s, p);
  const order = s.orders.find(o => o.id === p.orderId);
  const pending = p.status === "Pending review" || p.status === "Exception";
  const source = s.documents.find(d => d.id === p.sourceDocumentId);
  return <article className={styles.proposal}>
    <header className={styles.proposalTop}><div className={styles.rowHead}><div><h3>{fieldLabel(p.localField)}</h3><p>{order?.address || p.orderId} · {p.orderId}</p></div><div className={styles.actions}><Status value={p.risk} /><Status value={p.status} /></div></div><p className={styles.caption}>{p.reason}</p></header>
    <div className={styles.proposalValues}><div><span>Current value observed</span><p>{p.beforeValue || "(Empty)"}</p></div><ArrowRight size={18} /><div><span>Proposed value</span><p>{p.afterValue || "(Empty)"}</p></div></div>
    <div className={styles.proposalEvidence}><p className={styles.caption}><strong>{source?.name || "Source document"}</strong> · {p.sourcePage}</p><blockquote className={styles.quote}>{p.sourceQuote}</blockquote><p className={styles.caption}>Current-value evidence: {p.externalReadEvidence}</p>{!!stale.length && <Note warning><p>Review context changed: {stale.join(" ")} Prepare a new proposal using current evidence before proceeding.</p></Note>}{!!p.exceptions.length && <Note warning><p>{p.exceptions.join(" ")}</p></Note>}
      {p.review && <dl className={styles.detailList}><Detail label={`${p.review.decision} by ${p.review.by}`}>{p.review.note}</Detail></dl>}
      {p.outcome && <dl className={styles.detailList}><Detail label={p.outcome.result}>{p.outcome.reference} · {p.outcome.note}</Detail><Detail label="Human attestation">{p.outcome.by} · {dateTime(p.outcome.at)}</Detail></dl>}
      <p className={styles.caption}>Prepared by {p.createdBy} · {dateTime(p.createdAt)}</p></div>
    <div className={styles.proposalActions}>
      {pending && mayReview && <><Button size="sm" onClick={() => onReview("Approved")} disabled={saving || paused || !!stale.length || p.status === "Exception"}><CheckCheck size={14} /> Approve proposal</Button><Button size="sm" variant="outline" onClick={() => onReview("Rejected")} disabled={saving}>Reject proposal</Button></>}
      {p.status === "Approved" && operator && <Button size="sm" variant="outline" onClick={onOutcome} disabled={saving}><ClipboardCheck size={14} /> Record manual outcome</Button>}
      {pending && !mayReview && <small>An authorized company reviewer must record the decision.</small>}
      {p.status === "Exception" && <small>This exception requires specialist handling outside routine approval.</small>}
      {p.status === "Approved" && <small>Approved for a person to handle. No vendor write has run.</small>}
      {p.status === "Recorded" && <small>A manual outcome receipt is recorded in the history.</small>}
    </div>
  </article>;
}

function ReviewForm({ s, proposal, decision, save }: { s: Workspace; proposal: Proposal; decision: "Approved" | "Rejected"; save: Save }) {
  const { busy, error, submit } = useFormSave(save);
  const stale = proposalStaleness(s, proposal);
  return <><FormHeader title={decision === "Approved" ? "Approve this proposal" : "Reject this proposal"} description={`${fieldLabel(proposal.localField)} · ${proposal.orderId}. Your decision and note become part of the permanent review history.`} /><form className={styles.form} onSubmit={e => void submit(e, f => d => reviewExternalProposal(d, proposal.id, { decision, note: value(f, "note") }), `External proposal ${decision.toLowerCase()}`)}>
    <div className={styles.proposalValues}><div><span>Before</span><p>{proposal.beforeValue}</p></div><ArrowRight size={18} /><div><span>After</span><p>{proposal.afterValue}</p></div></div>
    <blockquote className={styles.quote}>{proposal.sourceQuote}</blockquote>
    {!!stale.length && <Note warning><p>{stale.join(" ")}</p></Note>}
    <FieldLabel label="Review decision note"><Textarea name="note" required rows={4} maxLength={4000} placeholder="What you verified, or what needs to be corrected" /></FieldLabel>
    {decision === "Approved" && <label className={styles.check}><input type="checkbox" required /><span>I reviewed the original evidence, before and after values, company, and file. Approval records a decision; it does not execute the change.</span></label>}
    <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy || decision === "Approved" && !!stale.length}>{busy ? "Saving…" : decision === "Approved" ? "Record approval" : "Record rejection"}</Button></div>
  </form></>;
}

function OutcomeForm({ proposal, canRecordApplied, save }: { proposal: Proposal; canRecordApplied: boolean; save: Save }) {
  const [result, setResult] = useState(canRecordApplied ? "Recorded in SoftPro" : "Not applied");
  const actualResult = canRecordApplied ? result : "Not applied";
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const reviewKey = JSON.stringify([proposal.id, proposal.review?.at, actualResult, reference, note]);
  const { busy, error, submit } = useFormSave(save);
  return <><FormHeader title="Record a manual outcome" description="Use this after a person has handled the approved proposal. The receipt records evidence; it does not connect to or change SoftPro." /><form className={styles.form} onSubmit={e => void submit(e, f => d => recordExternalOutcome(d, proposal.id, { result: actualResult as "Recorded in SoftPro" | "Not applied", reference: value(f, "reference"), note: value(f, "note") }), "Manual external outcome recorded")}>
    <FieldLabel label="What happened"><Picker label="What happened" value={actualResult} onChange={setResult} options={canRecordApplied ? ["Recorded in SoftPro", "Not applied"] : ["Not applied"]} /></FieldLabel>
    {!canRecordApplied && <Note warning><p>The context changed or the company is paused. You can record that this proposal was not applied. A fresh proposal is required before recording an applied change.</p></Note>}
    <FieldLabel label="Outcome reference"><Input name="reference" required maxLength={500} value={reference} onChange={e => setReference(e.target.value)} placeholder="SoftPro audit entry or documented manual confirmation" /></FieldLabel>
    <FieldLabel label="Who handled it and what was verified"><Textarea name="note" required rows={4} maxLength={4000} value={note} onChange={e => setNote(e.target.value)} placeholder="Person, date, result, and supporting evidence" /></FieldLabel>
    <label className={styles.check}><input type="checkbox" required checked={acknowledgement === reviewKey} onChange={e => setAcknowledgement(e.target.checked ? reviewKey : "")} /><span>I verified this outcome and its supporting reference.</span></label>
    <FormError error={error} /><div className={styles.dialogActions}><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save manual outcome receipt"}</Button></div>
  </form></>;
}

function MatchForm({ s, companyId, mayVerify, onVerify }: { s: Workspace; companyId: string; mayVerify: boolean; onVerify: (orderId: string) => void }) {
  const [result, setResult] = useState<ReturnType<typeof matchExternalOrder> | null>(null);
  return <><FormHeader title="Find the matching file" description="Compare source details with verified links for this company. Every candidate still needs a person to confirm the original file." /><form className={styles.form} onSubmit={e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setResult(matchExternalOrder(s, companyId, { externalFileNumber: value(f, "fileNumber"), missiveConversationId: value(f, "conversationId"), address: value(f, "address"), client: value(f, "client") }));
  }}>
    <div className={styles.grid}>
      <FieldLabel label="Source SoftPro file number"><Input name="fileNumber" maxLength={200} onChange={() => setResult(null)} /></FieldLabel>
      <FieldLabel label="Source Missive conversation ID"><Input name="conversationId" maxLength={200} onChange={() => setResult(null)} /></FieldLabel>
      <FieldLabel label="Source property address"><Input name="address" maxLength={500} onChange={() => setResult(null)} /></FieldLabel>
      <FieldLabel label="Source buyer or insured"><Input name="client" maxLength={200} onChange={() => setResult(null)} /></FieldLabel>
    </div>
    <div className={styles.dialogActions}><Button type="submit">Find candidates</Button></div>
  </form>
    {result && <section className={styles.stack}>
      <Note warning={result.status !== "Candidate"}><p>{result.status === "Candidate" ? "A candidate was found. Review the original SoftPro company and file before accepting the association." : result.status === "Ambiguous" ? "The information does not identify one reliable file. Check the original source and resolve the ambiguity." : "No verified link matches these details. Confirm the correct company and record the original file link from the Files tab."}</p></Note>
      {result.candidates.map(candidate => <article className={styles.file} key={candidate.orderId}><div className={styles.rowHead}><div><h3>{candidate.address}</h3><p>{candidate.orderId} · {candidate.externalFileNumber}</p></div><Status value={candidate.strength} /></div><p className={styles.caption}>{candidate.reasons.join(" · ")}</p>{mayVerify && <div className={styles.rowFoot}><Button variant="outline" size="sm" onClick={() => onVerify(candidate.orderId)}>Review original file link</Button></div>}</article>)}
    </section>}
  </>;
}
