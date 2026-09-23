"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/title/store";
import { uid, type Company } from "@/lib/title/model";
import { businessDay, nextWeekday } from "@/lib/title/business-date";
import {
  buildCompanyFromCandidate, companyCandidateKey, companyCandidateName, companyIntakeReview,
  companyProfileMissing, parseCompanyCandidateResponse, validCompanyDisplayName,
  type MissiveCompanyCandidateResponse,
} from "@/lib/title/company-intake";
import { FieldLabel } from "./shared";

export function MissiveCompanyIntakeButton() {
  const { connection } = useWorkspace();
  const [open, setOpen] = useState(false);
  const allowed = !!connection && connection.access.allCompanies && ["owner", "admin"].includes(connection.access.role);
  const scope = connection ? JSON.stringify([connection.workspaceId, connection.access.userId, connection.access.version, connection.access.role, connection.access.allCompanies]) : "";
  if (!allowed) return null;
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Building2 />Import company names from Missive</Button>
    {open && <MissiveCompanyIntake key={scope} onClose={() => setOpen(false)} />}
  </>;
}

function MissiveCompanyIntake({ onClose }: { onClose: () => void }) {
  const { s, update, connection } = useWorkspace();
  const [directory, setDirectory] = useState<MissiveCompanyCandidateResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reviewedSignature, setReviewedSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false), working = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = !!connection && connection.access.allCompanies && ["owner", "admin"].includes(connection.access.role);
  const review = companyIntakeReview(s, (directory?.candidates || []).filter(candidate => selected.includes(companyCandidateKey(candidate))).map(candidate => ({ candidate, name: names[companyCandidateKey(candidate)] ?? candidate.teamName })));
  const reviewed = reviewedSignature === review.signature;

  async function load() {
    if (!connection || !allowed || working.current) return;
    working.current = true; setBusy(true); setError("");
    setDirectory(null); setSelected([]); setNames({}); setReviewedSignature("");
    try {
      const { activeWorkspace, backendRequest } = await import("@/lib/backend/client");
      if (!mounted.current) return;
      const result = await backendRequest<unknown>("/integrations/missive/company-candidates", undefined, "GET", 30000, connection.workspaceId || activeWorkspace(), connection.access.userId);
      if (mounted.current) setDirectory(parseCompanyCandidateResponse(result));
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Unable to read the Missive company directory."); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  async function save() {
    if (!connection || !allowed || working.current || !reviewed || !review.canCreate) return;
    const chosen = review.rows.map(row => ({ candidate: row.candidate, name: row.name }));
    const signature = review.signature;
    working.current = true; setBusy(true); setError("");
    try {
      const importedAt = new Date().toISOString();
      const saved = await update(draft => {
        const latest = companyIntakeReview(draft, chosen);
        if (!latest.canCreate || latest.signature !== signature) throw new Error("The company list changed. Review the current matches before importing.");
        for (const row of latest.rows) {
          const company = buildCompanyFromCandidate(row.candidate, { id: uid("company"), name: row.name, importedAt, importedBy: connection.access.email, color: ["teal", "blue", "violet", "amber", "rose"][draft.companies.length % 5] });
          draft.companies.unshift(company);
          draft.tasks.unshift({
            id: uid("task"), companyId: company.id,
            title: "Complete company profile, confirm legal name, and collect owners and documents",
            owner: connection.access.email, assigneeId: connection.access.userId,
            due: nextWeekday(businessDay()), priority: "Normal", done: false,
          });
        }
      }, "Company names imported", `${chosen.length} incomplete company profile${chosen.length === 1 ? "" : "s"} created from reviewed Missive inbox names. Legal names, contacts, operating states, owners and documents still need confirmation.`);
      if (mounted.current) {
        if (saved) onClose();
        else setError("The import was not saved. Review any workspace notice and try again.");
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "The company profiles could not be saved."); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  if (!allowed) return null;
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="modal" style={{ maxWidth: 780 }}>
      <DialogHeader>
        <DialogTitle>Import company names from Missive</DialogTitle>
        <DialogDescription>Review your team inbox names and choose which ones represent separate title companies. Your mom can fill in each company’s missing information later.</DialogDescription>
      </DialogHeader>
      <p className="form-note">These are display names, not verified legal company names. This reads only the Missive directory and creates profiles in this system; it does not change Missive, import email, or activate inbox routes.</p>
      <Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw />{busy ? "Working…" : directory ? "Refresh Missive names" : "Load Missive names"}</Button>
      {error && <p role="alert" className="notice warning">{error}</p>}
      {directory && <>
        {directory.truncated && <p role="alert" className="notice warning">This directory is incomplete. Additional Missive inboxes are not shown.</p>}
        <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
          {!directory.candidates.length && <p>No team inboxes were found in this Missive connection.</p>}
          {directory.candidates.map(candidate => {
            const key = companyCandidateKey(candidate), isSelected = selected.includes(key);
            const name = names[key] ?? candidate.teamName;
            const existing = s.companies.find(company => company.intake && companyCandidateKey(company.intake) === key);
            const row = companyIntakeReview(s, [{ candidate, name }]).rows[0];
            const duplicate = review.rows.find(item => companyCandidateKey(item.candidate) === key)?.aliases.length;
            return <section key={key} className="panel" style={{ padding: 16, marginBlock: 12 }}>
              <label className="duplicate-ack">
                <Checkbox disabled={busy || !!existing} checked={isSelected && !existing} onCheckedChange={checked => setSelected(current => checked === true ? [...new Set([...current, key])] : current.filter(value => value !== key))} aria-label={`Create company from ${candidate.teamName}`} />
                <span><strong>{candidate.teamName}</strong><br /><small>Missive organization: {candidate.organizationName}</small></span>
              </label>
              {existing ? <p className="form-note">Already imported as {existing.name}.</p> : <>
                <FieldLabel label={`Company display name for ${candidate.teamName}`}>
                  <Input value={name} maxLength={100} disabled={busy || !isSelected} onChange={event => setNames(current => ({ ...current, [key]: event.target.value }))} />
                </FieldLabel>
                {isSelected && !validCompanyDisplayName(companyCandidateName(name)) && <p role="alert">Enter a display name of 1–100 characters.</p>}
                {!!row.matches.length && <div className="notice warning"><div><strong>Review existing companies before creating another</strong><ul>{row.matches.map(match => <li key={match.company.id}>{match.company.name}: {match.reasons.join(" · ")}</li>)}</ul><p>Leave this inbox unselected if it belongs to a company already on file.</p></div></div>}
                {!!duplicate && <p role="alert" className="notice warning">Two selected inboxes have the same company name. Select one inbox for that company, or give distinct companies their correct names.</p>}
              </>}
            </section>;
          })}
        </div>
        {!!review.rows.length && <label className="duplicate-ack">
          <Checkbox checked={reviewed} disabled={busy} onCheckedChange={value => setReviewedSignature(value === true ? review.signature : "")} aria-label="I reviewed the selected company names and existing matches" />
          <span>I reviewed every selected inbox and the existing matches. Each selection is a separate title company; names remain unverified until checked against company documents.</span>
        </label>}
        <p className="form-note">{review.rows.length} selected. Contacts, email, city, operating state, owners and formation details will stay blank. Each profile receives a completion task assigned to you.</p>
      </>}
      <div className="form-actions">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy || !review.canCreate || !reviewed}>Create {review.rows.length || "selected"} company profile{review.rows.length === 1 ? "" : "s"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

/** Only Missive scaffolds use this incomplete-profile path. The normal form stays strict. */
export function CompanyIntakeProfile({ company }: { company: Company }) {
  const { connection } = useWorkspace();
  const [open, setOpen] = useState(false);
  const canEdit = !connection || (["owner", "admin", "onboarding"].includes(connection.access.role) && (connection.access.allCompanies || connection.access.companyIds.includes(company.id)));
  if (!company.intake) return null;
  const missing = companyProfileMissing(company);
  const needsBasics = company.intake.profileStatus === "incomplete" || company.intake.nameUnverified;
  return <section className="notice" style={{ alignItems: "start" }}>
    <Building2 size={18} />
    <div>
      <strong>{needsBasics ? "Company profile needs completion" : "Company profile basics confirmed"}</strong>
      <p>Created from Missive inbox “{company.intake.teamName}” in {company.intake.organizationName}.</p>
      {company.intake.nameUnverified && <p>The display name has not been verified against company documents.</p>}
      {!!missing.length && <p>Still needed: {missing.join(", ")}.</p>}
      <p>Ownership, formation documents, licensing and onboarding approvals are reviewed separately.</p>
      {canEdit && <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{needsBasics ? "Complete company profile" : "Edit company profile"}</Button>}
      {canEdit && open && <CompanyIntakeProfileEditor key={`${company.id}:${connection?.access.version ?? "local"}`} company={company} onClose={() => setOpen(false)} />}
    </div>
  </section>;
}

export function CompanyIntakeProfileEditor({ company, onClose, initialValues = {}, sourceReference }: { company: Company; onClose: () => void; initialValues?: { name?: string; contact?: string; email?: string }; sourceReference?: string }) {
  const { update } = useWorkspace();
  const [name, setName] = useState(initialValues.name ?? company.name), [contact, setContact] = useState(initialValues.contact ?? company.contact);
  const [email, setEmail] = useState(initialValues.email ?? company.email), [location, setLocation] = useState(company.location);
  const [jurisdiction, setJurisdiction] = useState(company.jurisdiction);
  const [confirmedName, setConfirmedName] = useState(company.intake?.nameUnverified || initialValues.name !== undefined ? "" : company.name);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const confirmed = confirmedName === name.trim();
  const values = { name: name.trim(), contact: contact.trim(), email: email.trim(), location: location.trim(), jurisdiction };
  const missing = companyProfileMissing(values);
  const [baseline] = useState(() => JSON.stringify({ name: company.name, contact: company.contact, email: company.email, location: company.location, jurisdiction: company.jurisdiction, intake: company.intake }));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !validCompanyDisplayName(values.name)) return;
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) { setError("Enter a valid contact email, or leave it blank until confirmed."); return; }
    setSaving(true); setError("");
    try {
      const saved = await update(draft => {
        const current = draft.companies.find(row => row.id === company.id);
        if (!current?.intake || JSON.stringify({ name: current.name, contact: current.contact, email: current.email, location: current.location, jurisdiction: current.jurisdiction, intake: current.intake }) !== baseline) throw new Error("The company profile changed. Close this form and reopen the latest profile before saving.");
        if (current.jurisdiction && current.jurisdiction !== jurisdiction) throw new Error("Use the Jurisdictions tab to manage operating states after the first state is set.");
        Object.assign(current, values);
        if (!company.jurisdiction && jurisdiction) current.operatingStates = [...new Set([...(current.operatingStates || []), jurisdiction])];
        current.intake = { ...current.intake, nameUnverified: !confirmed, profileStatus: !missing.length && confirmed ? "complete" : "incomplete" };
      }, "Company profile updated", `${values.name} · ${!missing.length && confirmed ? "profile basics confirmed; ownership and onboarding evidence remain separate" : "incomplete profile saved for later completion"}${sourceReference ? ` · ${sourceReference}` : ""}`);
      if (saved) onClose(); else setError("The company profile was not saved. Review any workspace notice and try again.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save company profile."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !saving) onClose(); }}><DialogContent className="modal">
    <DialogHeader><DialogTitle>Complete company profile</DialogTitle><DialogDescription>Enter confirmed company details. You can save missing information and finish later.</DialogDescription></DialogHeader>
    <form className="form-stack" onSubmit={save}>
      {sourceReference && <p className="form-note">Prefilled from {sourceReference}. Confirm the details before saving. This does not fill ownership, city or operating-state information.</p>}
      <FieldLabel label="Company name"><Input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={saving} /></FieldLabel>
      <label className="duplicate-ack"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmedName(value === true ? name.trim() : "")} aria-label="I verified the legal company name against its documents" disabled={saving} /><span>I verified the legal company name against its documents.</span></label>
      <div className="form-grid">
        <FieldLabel label="Primary contact"><Input maxLength={100} value={contact} onChange={event => setContact(event.target.value)} disabled={saving} placeholder="Add when confirmed" /></FieldLabel>
        <FieldLabel label="Contact email"><Input type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={saving} placeholder="Add when confirmed" /></FieldLabel>
        <FieldLabel label="City"><Input maxLength={100} value={location} onChange={event => setLocation(event.target.value)} disabled={saving} placeholder="Add when confirmed" /></FieldLabel>
        <FieldLabel label="Initial operating state"><select aria-label="Initial operating state" className="input" value={jurisdiction} disabled={saving || !!company.jurisdiction} onChange={event => setJurisdiction(event.target.value)}><option value="">Not confirmed yet</option>{[...new Set(["NC", "SC", company.jurisdiction].filter(Boolean))].map(state => <option key={state} value={state}>{state}</option>)}</select></FieldLabel>
      </div>
      {company.jurisdiction && <p className="form-note">Manage additional operating states in the company’s Jurisdictions tab.</p>}
      <p className="form-note">{missing.length ? `Still needed: ${missing.join(", ")}.` : confirmed ? "Profile basics are ready to save." : "Confirm the legal company name to finish these profile basics."} Owners and documents can be added from the company’s Members and Documents tabs.</p>
      {error && <p role="alert" className="notice warning">{error}</p>}
      <div className="form-actions"><Button variant="outline" type="button" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving || !validCompanyDisplayName(values.name)}>{saving ? "Saving…" : "Save company profile"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
