"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { activeWorkspace, backendRequest } from "@/lib/backend/client";
import type { Access } from "@/lib/backend/workspace";
import type { Company } from "@/lib/title/model";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Picker } from "./shared";
import styles from "./team-access.module.css";

type Membership = {
  user_id: string; email: string | null; role: string; company_ids: string[];
  all_companies: boolean; restricted_access: boolean; active: boolean; version: number;
};
type Invitation = {
  id: string; email: string; role: string; company_ids: string[];
  all_companies: boolean; restricted_access: boolean; version: number;
  partner_members: { companyId: string; memberName: string }[];
  revoked_at: string | null; accepted_at: string | null; expires_at: string;
  delivery_status?: "not_sent" | "sending" | "sent" | "failed" | "unknown";
  delivery_at?: string | null;
};
type Directory = { members: Membership[]; invitations: Invitation[]; emailDeliveryEnabled?: boolean };
type DeliveryResult = { id: string; status: "sending" | "sent" | "failed" | "unknown"; recorded: boolean; message: string };
type InvitationDraft = {
  email: string; role: string; companyIds: string[]; allCompanies: boolean;
  restricted: boolean; identities: Record<string, string>;
  editing?: { id: string; version: number };
};
const emptyDraft = (): InvitationDraft => ({ email: "", role: "operations", companyIds: [], allCompanies: false, restricted: false, identities: {} });
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
function invitationStatus(invitation: Invitation, now: number) {
  if (invitation.accepted_at) return "Accepted";
  if (invitation.revoked_at) return "Canceled";
  const expiry = Date.parse(invitation.expires_at);
  if (!Number.isFinite(expiry)) return "Expiration unavailable";
  return expiry <= now ? "Expired" : "Awaiting verified sign-in";
}

// The parent keys this component by workspace, signed-in account and access
// version. Cleanup prevents an old request from changing a new account's UI.
export function TeamAccess({ workspaceId, companies, access, refreshWorkspace }: {
  workspaceId: string; companies: Company[]; access: Access;
  refreshWorkspace: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<InvitationDraft>(emptyDraft);
  const [directory, setDirectory] = useState<Directory>({ members: [], invitations: [] });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sendAttempts, setSendAttempts] = useState<Record<string, string>>({});
  const [sendResults, setSendResults] = useState<Record<string, DeliveryResult>>({});
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(false), requestVersion = useRef(0), acting = useRef(false);
  const invitationRequestId = useRef<string | null>(null);
  function updateDraft(next: InvitationDraft) { invitationRequestId.current = null; setDraft(next); }
  const owner = access.role === "owner";
  const roles = owner ? ["operations", "onboarding", "finance", "viewer", "partner", "admin"] : ["operations", "finance", "viewer", "partner"];
  const current = useCallback(() => mounted.current && activeWorkspace() === workspaceId, [workspaceId]);
  const readDirectory = useCallback(async () => {
    const version = ++requestVersion.current;
    const result = await backendRequest<Directory>("/members");
    if (!current() || version !== requestVersion.current) return;
    setDirectory({ members: result.members || [], invitations: result.invitations || [], emailDeliveryEnabled: result.emailDeliveryEnabled === true });
    const invitations = result.invitations || [];
    setSendResults(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => invitations.some(invitation => `${invitation.id}:${invitation.version}` === key))));
    setSendAttempts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => {
      const invitation = invitations.find(invitation => `${invitation.id}:${invitation.version}` === key);
      return invitation && !["sent", "failed", "unknown"].includes(invitation.delivery_status || "not_sent");
    })));
    setLoadError("");
    setNow(Date.now());
  }, [current]);
  useEffect(() => {
    mounted.current = true;
    void readDirectory().catch(error => {
      if (current()) setLoadError(`Unable to load team access. ${message(error)}`);
    }).finally(() => { if (current()) setLoading(false); });
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [current, readDirectory]);

  async function action(run: () => Promise<string>, afterSuccess?: () => void) {
    if (!current() || acting.current) return;
    acting.current = true; setBusy(true);
    let completed = false;
    try {
      const status = await run();
      if (!current()) return;
      completed = true;
      afterSuccess?.();
      toast.success(status);
      await readDirectory();
    } catch (error) {
      if (!current()) return;
      if (completed) {
        setLoadError("Your change was saved, but the list could not be refreshed. Refresh before making another access change.");
        toast.error(`Change saved; refresh failed. ${message(error)}`);
      } else {
        toast.error(message(error));
      }
    } finally {
      if (current()) { acting.current = false; setBusy(false); }
    }
  }
  async function refresh() {
    if (!current() || acting.current) return;
    acting.current = true; setBusy(true);
    try {
      if (!await refreshWorkspace()) throw new Error("Unable to refresh the workspace. Try again.");
      if (current()) await readDirectory();
    } catch (error) {
      if (current()) setLoadError(`Unable to refresh team access. ${message(error)}`);
    } finally {
      if (current()) { acting.current = false; setBusy(false); }
    }
  }
  async function sendSetupEmail(invitation: Invitation) {
    if (!current() || acting.current || directory.emailDeliveryEnabled !== true) return;
    acting.current = true; setBusy(true);
    const key = `${invitation.id}:${invitation.version}`;
    const requestId = sendAttempts[key] || crypto.randomUUID();
    setSendAttempts(previous => ({ ...previous, [key]: requestId }));
    let result: DeliveryResult | undefined;
    try {
      result = await backendRequest<DeliveryResult>("/members/invitations/send", { workspaceId, invitationId: invitation.id, expectedVersion: invitation.version, requestId });
      if (!current()) return;
      const response = result;
      setSendResults(previous => ({ ...previous, [key]: response }));
      if (result.recorded && result.status !== "sending") setSendAttempts(previous => {
        const next = { ...previous }; delete next[key]; return next;
      });
      if (result.recorded && result.status === "sent") toast.success(result.message);
      else toast.warning(result.message);
      await readDirectory();
    } catch (error) {
      if (!current()) return;
      if (result) {
        setLoadError("The email service responded, but the list could not be refreshed. Refresh to see the recorded delivery status.");
        toast.error(`Email response received; refresh failed. ${message(error)}`);
      } else {
        const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
        const rejected = typeof status === "number" && ([400, 401, 403, 409, 422].includes(status) ||
          (status === 503 && message(error).startsWith("Email delivery needs owner setup")));
        if (rejected) {
          // These API responses reject the request before reserving a send.
          // A later click must remain an explicit new delivery action.
          setSendAttempts(previous => { const next = { ...previous }; delete next[key]; return next; });
          setSendResults(previous => { const next = { ...previous }; delete next[key]; return next; });
        } else {
          setSendResults(previous => ({ ...previous, [key]: { id: invitation.id, status: "unknown", recorded: false, message: "The previous email request could not be confirmed. Retrying reuses that request to retrieve its outcome or finish the same request if it never reached the server." } }));
        }
        toast.error(message(error));
        if (rejected) {
          try { await readDirectory(); }
          catch { if (current()) setLoadError("The email request was rejected, and team access could not be refreshed. Refresh before trying again."); }
        }
      }
    } finally {
      if (current()) { acting.current = false; setBusy(false); }
    }
  }
  const locked = busy || loading || !!loadError;
  const selected = companies.filter(company => draft.companyIds.includes(company.id));
  const partner = draft.role === "partner";
  const allCompanies = owner && draft.allCompanies && !partner;
  const selectedValid = selected.length === draft.companyIds.length && selected.length > 0;
  const identitiesValid = !partner || selected.every(company => company.members.some(member => member.name === draft.identities[company.id]));
  const grantValid = roles.includes(draft.role) && (allCompanies || selectedValid) && identitiesValid;
  const companyNames = (ids: string[], all: boolean) => all ? "All companies" : ids.map(id => companies.find(company => company.id === id)?.name || "Unavailable company").join(", ") || "No company access assigned";
  const canManage = (invitation: Invitation) => owner || (!invitation.all_companies && !invitation.restricted_access && roles.includes(invitation.role));
  function edit(invitation: Invitation) {
    invitationRequestId.current = null;
    setDraft({ email: invitation.email, role: invitation.role, companyIds: invitation.company_ids, allCompanies: invitation.all_companies,
      restricted: invitation.restricted_access, identities: Object.fromEntries((invitation.partner_members || []).map(member => [member.companyId, member.memberName])),
      editing: { id: invitation.id, version: invitation.version } });
  }
  function toggleCompany(id: string, checked: boolean) {
    invitationRequestId.current = null;
    setDraft(previous => {
      const identities = { ...previous.identities };
      if (!checked) delete identities[id];
      return { ...previous, companyIds: checked ? [...previous.companyIds, id] : previous.companyIds.filter(value => value !== id), identities };
    });
  }
  return <section className="panel backend-settings">
    <div className="section-heading"><div><Users size={20} /><h2>Team &amp; access</h2></div>
      <Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw />Refresh</Button>
    </div>
    <p>Choose each person’s role and companies. Preparing, editing or renewing access does not send an email. Share their individual account setup instructions separately.</p>
    <p className="form-note">Revoking a membership also cancels that person’s outstanding invitations in this workspace.</p>
    {loadError && <p className={styles.notice} role="alert">{loadError}</p>}
    {loading && <p role="status">Loading team access…</p>}
    <div className="backend-settings-section">
      <h3>{draft.editing ? `Edit invitation for ${draft.email}` : "Prepare access invitation"}</h3>
      {!owner && <p className="form-note">Choose one or more companies. The owner manages all-company access, restricted evidence and administrator roles.</p>}
      <form className={styles.form} onSubmit={event => {
        event.preventDefault();
        if (locked || !grantValid) return;
        void action(async () => {
          invitationRequestId.current ||= crypto.randomUUID();
          const result = await backendRequest<{ status: string }>("/members/invite", {
            workspaceId, email: draft.email, role: draft.role, companyIds: allCompanies ? [] : draft.companyIds,
            allCompanies, restricted: owner && !partner && draft.restricted,
            partnerMembers: partner ? selected.map(company => ({ companyId: company.id, memberName: draft.identities[company.id] })) : [],
            ...(draft.editing ? { invitationId: draft.editing.id, expectedVersion: draft.editing.version } : { requestId: invitationRequestId.current }),
          });
          return `${result.status}. Share account setup and sign-in instructions separately.`;
        }, () => updateDraft(emptyDraft()));
      }}>
        <div className={styles.fields}>
          <label>Email<Input aria-label="Invitation email" type="email" required value={draft.email} disabled={locked || !!draft.editing} onChange={event => updateDraft({ ...draft, email: event.target.value })} /></label>
          <label>Role<Picker label="Invitation role" value={draft.role} disabled={locked} options={roles} onChange={role => updateDraft({ ...draft, role, identities: {}, ...(role === "partner" ? { allCompanies: false, restricted: false } : {}) })} /></label>
        </div>
        <fieldset className={styles.scope} disabled={locked}><legend>Company access</legend>
          {owner && !partner && <label className={styles.check}><input type="checkbox" checked={allCompanies} onChange={event => updateDraft({ ...draft, allCompanies: event.target.checked, companyIds: [], identities: {} })} />All companies, including companies added later</label>}
          {!allCompanies && <div className={styles.companyList}>
            {!companies.length && <p className="form-note">Create a company before preparing company-specific access.</p>}
            {companies.map(company => <div key={company.id} className={styles.company}>
              <label className={styles.check}><input type="checkbox" checked={draft.companyIds.includes(company.id)} aria-label={`Company access: ${company.name}`} onChange={event => toggleCompany(company.id, event.target.checked)} />{company.name}</label>
              {partner && draft.companyIds.includes(company.id) && <label>Member identity for {company.name}<Picker label={`Partner member identity: ${company.name}`} value={draft.identities[company.id] || ""} options={company.members.map(member => member.name)} disabled={locked} onChange={name => updateDraft({ ...draft, identities: { ...draft.identities, [company.id]: name } })} />{!company.members.length && <small className="form-note">Add a company member before granting partner access.</small>}</label>}
            </div>)}
          </div>}
          <p className="form-note">{allCompanies ? "This includes every current and future company." : `${selected.length} ${selected.length === 1 ? "company" : "companies"} selected.`}</p>
        </fieldset>
        {owner && !partner && <label className={styles.check}><input type="checkbox" checked={draft.restricted} disabled={locked} onChange={event => updateDraft({ ...draft, restricted: event.target.checked })} />Allow restricted evidence access</label>}
        {owner && !partner && <p className="form-note">Restricted evidence may include sensitive application and ownership documents. Grant it only when needed for this person’s work.</p>}
        <div className={styles.actions}>
          <Button type="submit" disabled={locked || !grantValid}>{draft.editing ? "Save invitation changes" : "Prepare access invitation"}</Button>
          {draft.editing && <Button type="button" variant="outline" disabled={busy} onClick={() => updateDraft(emptyDraft())}>Discard edits</Button>}
        </div>
      </form>
    </div>
    <div className="backend-settings-section"><h3>Current memberships</h3>
      {directory.members.some(member => !member.email) && <p className="form-note">Some account emails are unavailable. Refresh to retry; account IDs are shown so you can distinguish these memberships.</p>}
      <div className="backend-access-list">{directory.members.map(member => <div key={member.user_id} className={styles.member}>
        <span>{member.email || "Email unavailable"}{!member.email && <small>Account ID: {member.user_id}</small>}<small>{member.role} · {member.active ? "Active" : "Revoked"}</small><small>{companyNames(member.company_ids || [], member.all_companies)}</small></span>
        {member.active && member.role !== "owner" && member.user_id !== access.userId && (owner || (member.role !== "admin" && !member.all_companies && member.restricted_access === false)) && <Button variant="outline" disabled={locked || !Number.isInteger(member.version)} onClick={() => void action(async () => {
          await backendRequest("/members/revoke", { workspaceId, userId: member.user_id, expectedVersion: member.version });
          return "Access revoked and outstanding invitations canceled.";
        })}>Revoke access</Button>}
      </div>)}</div>
    </div>
    <div className="backend-settings-section"><h3>Access invitations</h3>
      {!loading && !directory.emailDeliveryEnabled && <p className="form-note">Email delivery needs owner setup; access preparation still works.</p>}
      {!loading && !directory.invitations.length && <p className="form-note">No access invitations prepared.</p>}
      <div className={styles.list}>{directory.invitations.map(invitation => {
        const status = invitationStatus(invitation, now);
        const mutable = canManage(invitation) && !invitation.accepted_at && Number.isInteger(invitation.version);
        const expiry = Date.parse(invitation.expires_at);
        const delivery = invitation.delivery_status || "not_sent";
        const deliveryKey = `${invitation.id}:${invitation.version}`;
        const deliveryResult = sendResults[deliveryKey];
        return <article className={styles.invitation} key={invitation.id} aria-label={`Invitation for ${invitation.email}`}>
          <p><strong>{invitation.email}</strong> · {invitation.role} · {status}</p>
          <p>{companyNames(invitation.company_ids || [], invitation.all_companies)}{invitation.restricted_access ? " · Restricted evidence access enabled" : ""}</p>
          {invitation.role === "partner" && <p>Member identities: {(invitation.partner_members || []).map(member => `${companyNames([member.companyId], false)}: ${member.memberName}`).join("; ") || "Unavailable"}</p>}
          <p className="form-note">{Number.isFinite(expiry) ? `${invitation.accepted_at || invitation.revoked_at ? "Original expiration" : status === "Expired" ? "Expired" : "Expires"} ${new Date(expiry).toLocaleString()}` : "Refresh to retrieve this invitation’s expiration."}{invitation.accepted_at ? ` · Accepted ${new Date(invitation.accepted_at).toLocaleString()}` : ""}{invitation.revoked_at ? ` · Canceled ${new Date(invitation.revoked_at).toLocaleString()}` : ""}</p>
          <p className="form-note">{delivery === "sent" ? "Email accepted by the provider. Delivery to the inbox is not confirmed." : delivery === "sending" ? "Email delivery is pending. Refresh to check its status." : delivery === "failed" ? "Setup email failed." : delivery === "unknown" ? "Email delivery is uncertain. Check the recipient’s inbox before retrying; a retry may send another email." : "No setup email sent since this invitation was last updated."}{invitation.delivery_at && Number.isFinite(Date.parse(invitation.delivery_at)) ? ` · Last attempt ${new Date(invitation.delivery_at).toLocaleString()}` : ""}</p>
          {deliveryResult && <p className={styles.notice} role="status">{deliveryResult.message}{!deliveryResult.recorded ? " The delivery record has not been confirmed." : ""}</p>}
          {mutable && <div className={styles.actions}>
            {status === "Awaiting verified sign-in" && <Button variant="outline" disabled={locked} onClick={() => edit(invitation)}>Edit invitation</Button>}
            <Button variant="outline" disabled={locked} onClick={() => void action(async () => {
              const result = await backendRequest<{ status: string }>("/members/invitations/reissue", { workspaceId, invitationId: invitation.id, expectedVersion: invitation.version });
              return `${result.status}. No email sent.`;
            }, () => { if (draft.editing?.id === invitation.id) updateDraft(emptyDraft()); })}>Renew invitation</Button>
            {!invitation.revoked_at && <Button variant="outline" disabled={locked} onClick={() => void action(async () => {
              await backendRequest("/members/invitations/cancel", { workspaceId, invitationId: invitation.id, expectedVersion: invitation.version });
              return "Invitation canceled. Existing membership access is unchanged.";
            }, () => { if (draft.editing?.id === invitation.id) updateDraft(emptyDraft()); })}>Cancel invitation</Button>}
            {status === "Awaiting verified sign-in" && delivery !== "sent" && <Button variant="outline" disabled={locked || !directory.emailDeliveryEnabled || (delivery === "sending" && !sendAttempts[deliveryKey])} onClick={() => void sendSetupEmail(invitation)}>{sendAttempts[deliveryKey] ? "Retry previous email request" : delivery === "failed" || delivery === "unknown" ? "Retry setup email" : "Send setup email"}</Button>}
          </div>}
        </article>;
      })}</div>
    </div>
  </section>;
}
