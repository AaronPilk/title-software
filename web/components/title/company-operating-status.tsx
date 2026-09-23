"use client";

import { useEffect, useRef, useState } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/title/store";
import type { Company } from "@/lib/title/model";
import { buildOperatingConfirmation, companyDisplayStage, validateOperatingConfirmation, type OperatingConfirmation } from "@/lib/title/company-operating-status";
import { FieldLabel } from "./shared";

const isTestCompany = (company: Company) => /\b(?:qa|test|testing|demo|fictional|sample)\b/i.test(company.name);
const reviewSignature = (companies: Company[]) => JSON.stringify(companies.map(company => [company.id, company.name, company.operatingStatus ?? null]).sort(([a], [b]) => String(a).localeCompare(String(b))));
function confirmedOperations(company: Company): OperatingConfirmation | null {
  try { return validateOperatingConfirmation(company.operatingStatus ?? null); }
  catch { return null; }
}

export function ConfirmActiveCompaniesButton() {
  const { connection } = useWorkspace();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const allowed = !!connection && (connection.access.role === "owner" || (connection.access.role === "admin" && connection.access.allCompanies));
  const scope = connection ? JSON.stringify([connection.workspaceId, connection.access.userId, connection.access.version, connection.access.role, connection.access.allCompanies]) : "";
  if (!allowed) return null;
  return <>
    <Button ref={trigger} variant="outline" onClick={() => setOpen(true)}><Building2 />Confirm active companies</Button>
    {open && <ConfirmActiveCompanies key={scope} onClose={() => setOpen(false)} onClosed={() => trigger.current?.focus()} />}
  </>;
}

function ConfirmActiveCompanies({ onClose, onClosed }: { onClose: () => void; onClosed: () => void }) {
  const { s, connection, update } = useWorkspace();
  const [selected, setSelected] = useState(() => s.companies.filter(company => company.intake && !confirmedOperations(company) && !isTestCompany(company)).map(company => company.id));
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const allowed = !!connection && (connection.access.role === "owner" || (connection.access.role === "admin" && connection.access.allCompanies));
  const chosen = s.companies.filter(company => selected.includes(company.id));
  const signature = reviewSignature(chosen);
  const reviewed = !!chosen.length && signature === acknowledged;

  async function save() {
    if (!connection || !allowed || working.current || !reviewed || !note.trim()) return;
    working.current = true; setBusy(true); setError("");
    try {
      const confirmation = buildOperatingConfirmation(connection.access.email, note);
      const chosenIds = new Set(chosen.map(company => company.id));
      const saved = await update(draft => {
        const latest = draft.companies.filter(company => chosenIds.has(company.id));
        if (reviewSignature(latest) !== signature) throw new Error("The selected companies changed. Review them again before saving.");
        for (const company of latest) company.operatingStatus = { ...confirmation };
      }, "Existing company operations confirmed", `${chosen.length} selected ${chosen.length === 1 ? "company" : "companies"} confirmed active. Workspace setup, documents and approval evidence remain unchanged. ${confirmation.note}`);
      if (alive.current) {
        if (saved) onClose();
        else setError("The confirmation was not saved. Review any workspace notice and try again.");
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "The confirmation could not be saved."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }

  if (!allowed) return null;
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="modal" style={{ maxWidth: 720 }} onCloseAutoFocus={event => { event.preventDefault(); onClosed(); }}>
      <DialogHeader>
        <DialogTitle>Confirm active companies</DialogTitle>
        <DialogDescription>Mark companies that are already operating. Active reflects their existing business operations; their workspace profile, documents and approval evidence may still need completion.</DialogDescription>
      </DialogHeader>
      <p className="form-note">Imported companies without a confirmation are selected below. Test companies are never selected automatically. Review the entire selection before saving.</p>
      <div style={{ maxHeight: "42vh", overflowY: "auto" }}>
        {s.companies.map(company => <label key={company.id} className="duplicate-ack" style={{ display: "flex", alignItems: "start", gap: 12, paddingBlock: 10 }}>
          <Checkbox checked={selected.includes(company.id)} disabled={busy} aria-label={`Confirm ${company.name} is active`} onCheckedChange={checked => setSelected(current => checked === true ? [...new Set([...current, company.id])] : current.filter(id => id !== company.id))} />
          <span><strong>{company.name}</strong><br /><small>{confirmedOperations(company) ? "Operations already confirmed" : companyDisplayStage(company)}{company.intake?.profileStatus === "incomplete" ? " · Profile incomplete" : ""}{isTestCompany(company) ? " · Test company — review separately" : ""}</small></span>
        </label>)}
        {!s.companies.length && <p>No companies are available.</p>}
      </div>
      <FieldLabel label="Confirmation note"><Textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} disabled={busy} placeholder="For example: These companies already operate; we are collecting their records in this workspace." /></FieldLabel>
      <label className="duplicate-ack">
        <Checkbox checked={reviewed} disabled={busy || !chosen.length} onCheckedChange={checked => setAcknowledged(checked === true ? signature : "")} aria-label="I reviewed every selected company and confirm they already operate" />
        <span>I reviewed every selected company and confirm they already operate. Missing setup records will remain visible.</span>
      </label>
      {error && <p className="notice warning" role="alert">{error}</p>}
      <div className="form-actions">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy || !reviewed || !note.trim()} onClick={() => void save()}>{busy ? "Saving…" : `Confirm ${chosen.length} ${chosen.length === 1 ? "company" : "companies"} active`}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function CompanyOperatingStatusDetails({ company }: { company: Company }) {
  const { connection } = useWorkspace();
  const scope = connection ? JSON.stringify([connection.workspaceId, connection.access.userId, connection.access.version, connection.access.role, connection.access.allCompanies]) : "";
  const confirmation = confirmedOperations(company);
  if (!confirmation) return null;
  return <OperatingStatusDetails key={`${scope}:${company.id}:${JSON.stringify(company.operatingStatus)}`} company={company} confirmation={confirmation} />;
}

function OperatingStatusDetails({ company, confirmation }: { company: Company; confirmation: OperatingConfirmation }) {
  const { connection, update } = useWorkspace();
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false), working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const allowed = !!connection && (connection.access.role === "owner" || (connection.access.role === "admin" && connection.access.allCompanies));
  async function clear() {
    if (!allowed || working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      const saved = await update(draft => {
        const current = draft.companies.find(value => value.id === company.id);
        if (!current || JSON.stringify(confirmedOperations(current)) !== JSON.stringify(confirmation)) throw new Error("The company's confirmation changed. Review it again before clearing.");
        current.operatingStatus = null;
      }, "Company operating confirmation cleared", `${company.name} · Workspace setup and approval evidence remain unchanged.`);
      if (alive.current && !saved) setError("The confirmation could not be cleared. Review any workspace notice and try again.");
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "The confirmation could not be cleared."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="notice" style={{ alignItems: "start" }}>
    <Building2 size={18} />
    <div>
      <strong>Existing operations confirmed Active</strong>
      <p>Active reflects existing business operations. Profile details, documents and approval evidence still need their own review.</p>
      <p>{confirmation.note}</p>
      <p className="form-note">Confirmed by {confirmation.confirmedBy} on {new Date(confirmation.confirmedAt).toLocaleString()}.</p>
      {allowed && (clearing ? <>
        <p>Clearing this confirmation returns the displayed status to {company.stage}. Company records and checklist evidence remain unchanged.</p>
        <div className="form-actions"><Button variant="outline" disabled={busy} onClick={() => setClearing(false)}>Keep confirmation</Button><Button variant="outline" disabled={busy} onClick={() => void clear()}>{busy ? "Clearing…" : "Clear confirmation"}</Button></div>
      </> : <Button variant="outline" onClick={() => setClearing(true)}>Clear operating confirmation</Button>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
