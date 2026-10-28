"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/title/store";
import { companyDesk, companyPartnerContacts, validateCompanyDesk, type CompanyPartnerContact } from "@/lib/title/company-workspace";
import { canManageCompanies } from "@/lib/title/workspace-capabilities";
import { uid, type Company } from "@/lib/title/model";
import { FieldLabel } from "./shared";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import styles from "./company-workspace.module.css";

export function CompanyPartnerContacts({ company, onDirtyChange, onBusyChange }: { company: Company; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const { connection, update } = useWorkspace();
  const canEdit = canManageCompanies(connection);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<CompanyPartnerContact[]>([]), [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false);
  const contacts = companyPartnerContacts(company);
  const dirty = editing && canEdit && JSON.stringify(draft) !== baseline;
  useWorkspaceNavigationGuard("company-detail", { dirty, busy });
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  function edit() { setDraft(structuredClone(contacts)); setBaseline(JSON.stringify(contacts)); setError(""); setEditing(true); }
  function change(id: string, patch: Partial<CompanyPartnerContact>) { setDraft(current => current.map(contact => contact.id === id ? { ...contact, ...patch } : contact)); }
  async function save() {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      const partnerContacts = draft.map(contact => ({ ...contact, name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() }));
      validateCompanyDesk({ ...companyDesk(company), partnerContacts });
      const saved = await update(state => {
        const current = state.companies.find(row => row.id === company.id);
        if (!current || JSON.stringify(companyPartnerContacts(current)) !== baseline) throw new Error("Partner contacts changed. Reopen this editor to use the latest details.");
        current.desk = { ...companyDesk(current), partnerContacts };
      }, "Partner contacts updated", company.name);
      if (saved) setEditing(false);
      else setError("The contacts were not saved. Reopen the editor if someone else has changed them.");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save partner contacts."); }
    finally { working.current = false; setBusy(false); }
  }

  return <section aria-label="Partner contacts" className={styles.overview}>
    <header className={styles.heading}><div><h3>Partner contacts</h3><p>Who to contact about this joint venture.</p></div>{canEdit && !editing && <Button variant="outline" onClick={edit}>{contacts.length ? "Edit partner contacts" : "Add partner contacts"}</Button>}</header>
    {editing && canEdit ? <form className="form-stack" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset className={styles.fieldset} disabled={busy}>
      {draft.map((contact, index) => <section className={styles.service} key={contact.id}>
        <FieldLabel label={`Partner ${index + 1} name`}><Input required maxLength={200} value={contact.name} onChange={event => change(contact.id, { name: event.target.value })} /></FieldLabel>
        <div className="form-grid"><FieldLabel label={`Partner ${index + 1} email (optional)`}><Input type="email" maxLength={254} value={contact.email} onChange={event => change(contact.id, { email: event.target.value })} /></FieldLabel><FieldLabel label={`Partner ${index + 1} phone (optional)`}><Input type="tel" maxLength={60} value={contact.phone} onChange={event => change(contact.id, { phone: event.target.value })} /></FieldLabel></div>
        <Button type="button" variant="ghost" aria-label={`Remove partner contact ${index + 1}`} onClick={() => setDraft(current => current.filter(row => row.id !== contact.id))}>Remove contact</Button>
      </section>)}
      <Button type="button" variant="outline" disabled={draft.length >= 100} onClick={() => setDraft(current => [...current, { id: uid("partner"), name: "", email: "", phone: "" }])}><Plus size={14} />Add a partner</Button>
      <p className="form-note">Name, email and phone are enough. Ownership percentages and documents are optional records below.</p>
    </fieldset>{error && <p role="alert">{error}</p>}<div className={styles.actions}><Button type="button" variant="ghost" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard unsaved partner contact changes?")) setEditing(false); }}>Cancel</Button><Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save partner contacts"}</Button></div></form> : contacts.length ? <div className={styles.contactFacts}>{contacts.map(contact => <p key={contact.id}><strong>{contact.name}</strong>{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}{contact.phone && <span>{contact.phone}</span>}</p>)}</div> : <p className="form-note">Add a partner’s name, email and phone whenever you have them.</p>}
  </section>;
}
