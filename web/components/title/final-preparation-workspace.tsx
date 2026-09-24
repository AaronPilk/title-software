"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Download, FileCheck2, Files, Mail, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { download, getAssetForDocument, useWorkspace } from "@/lib/title/store";
import type { Order, VaultDoc } from "@/lib/title/model";
import { products } from "@/lib/title/business";
import { finalReadiness, orderSources, outputRoles, productionLocked } from "@/lib/title/production";
import { canManageProduction } from "@/lib/title/workspace-capabilities";
import { emptyFinalPreparation, finalHandoffText, finalPreparationFingerprint, finalPreparationProblems, finalPreparationSourceSnapshot, finalPreparationStatus, prepareFinalHandoff, reviewFinalPreparation, saveFinalPreparation, type FinalPreparationInput } from "@/lib/title/final-preparation";
import { createFinalSourceBundle, finalDownloadName, finalHandoffHtml } from "@/lib/title/final-preparation-export";
import { Empty, Status } from "./shared";
import { useWorkspaceNavigationGuard } from "./use-workspace-navigation-guard";
import styles from "./final-preparation-workspace.module.css";

type Props = { order: Order; onReviewSources: () => void; onReviewFields: () => void; onReviewDetails: () => void; onReviewProducts: () => void };
const steps = ["Sources & facts", "WFG worksheet", "Local reply", "Review & export"];
const clone = <T,>(value: T) => structuredClone(value);
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const amountValue = (value: string) => value === "" ? null : Number(value);

export function FinalPreparationWorkspace(props: Props) {
  const { s, connection } = useWorkspace();
  const access = connection?.access;
  const order = s.orders.find(row => row.id === props.order.id && row.companyId === props.order.companyId);
  if (!order || !s.companies.some(company => company.id === order.companyId) || (access && !access.allCompanies && !access.companyIds.includes(order.companyId)))
    return <Empty title="Title file unavailable" text="Reopen an available company title file to prepare its final handoff." />;
  const identity = JSON.stringify([order.id, order.companyId, connection?.workspaceId || "local", access || s.user]);
  return <PreparationEditor key={identity} {...props} order={order} identity={identity} />;
}

function PreparationEditor({ order, identity, onReviewSources, onReviewFields, onReviewDetails, onReviewProducts }: Props & { identity: string }) {
  const store = useWorkspace();
  const { s, connection, update } = store;
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<FinalPreparationInput>(() => clone(order.finalPreparation?.input || emptyFinalPreparation(s, order)));
  const [base, setBase] = useState(() => ({ version: order.finalPreparation?.version || 0, source: finalPreparationSourceSnapshot(s, order), input: JSON.stringify(order.finalPreparation?.input || emptyFinalPreparation(s, order)) }));
  const [reviewNote, setReviewNote] = useState(order.finalPreparation?.review?.note || "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false), mounted = useRef(false);
  const live = useRef({ store, order, identity });
  useLayoutEffect(() => { live.current = { store, order, identity }; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sourceSnapshot = finalPreparationSourceSnapshot(s, order);
  const sourceChanged = sourceSnapshot !== base.source || (order.finalPreparation?.version || 0) !== base.version;
  const dirty = JSON.stringify(input) !== base.input;
  useWorkspaceNavigationGuard("workspace", { dirty, busy });
  const status = finalPreparationStatus(s, order);
  const currentReview = status === "Reviewed" || status === "Prepared";
  const sources = orderSources(s, order.id).filter(document => document.companyId === order.companyId && !outputRoles.includes(document.sourceRole!));
  const policyProducts = products(s, order.id);
  const ready = finalReadiness(s, order);
  const canEdit = canManageProduction(connection) && !productionLocked(s, order) && order.status !== "Rejected";
  const problems = finalPreparationProblems(s, order, input);
  const canExport = status === "Prepared" && !dirty && !sourceChanged;
  const sourceCount = sources.filter(document => document.assetId).length;
  const received = s.inbox.filter(message => message.kind === "Finals" && message.orderId === order.id && (!message.companyId || message.companyId === order.companyId));
  function edit(fn: (draft: FinalPreparationInput) => void) {
    setInput(previous => { const next = clone(previous); fn(next); return next; });
    setAcknowledged(false); setError(""); setNotice("");
  }
  function reviewElsewhere(callback: () => void) {
    if (busy) { setError("Wait for the current preparation action to finish before opening another review step."); return; }
    if (dirty) { setError("Save your worksheet edits before opening another review step."); return; }
    callback();
  }
  function reload() {
    const current = live.current;
    const next = clone(current.order.finalPreparation?.input || emptyFinalPreparation(current.store.s, current.order));
    setInput(next); setBase({ version: current.order.finalPreparation?.version || 0, source: finalPreparationSourceSnapshot(current.store.s, current.order), input: JSON.stringify(next) });
    setReviewNote(current.order.finalPreparation?.review?.note || ""); setAcknowledged(false); setSelectedIds([]); setError(""); setNotice("Current worksheet and source facts loaded.");
  }
  async function act(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "The final preparation could not be completed."); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  function assertOpen() {
    if (!mounted.current || live.current.identity !== identity) throw new Error("Your account or title file changed. Reopen final preparation.");
  }
  async function save() {
    const savedInput = clone(input); assertOpen();
    const ok = await update(draft => { assertOpen(); saveFinalPreparation(draft, order.id, savedInput, base.version, base.source); }, "Final preparation worksheet saved", order.id, connection?.revision);
    assertOpen();
    if (!ok) throw new Error("The worksheet save was not confirmed. Your edits remain here; refresh workspace records before trying again.");
    setBase({ version: base.version + 1, source: base.source, input: JSON.stringify(savedInput) }); setAcknowledged(false); setNotice("Worksheet saved as a draft. Review its current facts and decisions before preparing the handoff.");
  }
  function exportGuard(documents: VaultDoc[] = []) {
    assertOpen();
    const captured = live.current;
    const fingerprint = finalPreparationFingerprint(captured.store.s, captured.order);
    const prepared = JSON.stringify(captured.order.finalPreparation?.prepared);
    const references = documents.map(document => [document.id, JSON.stringify(document)]);
    return () => {
      assertOpen();
      const current = live.current;
      if (finalPreparationStatus(current.store.s, current.order) !== "Prepared" || finalPreparationFingerprint(current.store.s, current.order) !== fingerprint || JSON.stringify(current.order.finalPreparation?.prepared) !== prepared)
        throw new Error("The reviewed file or worksheet changed. Review and prepare the current handoff before downloading.");
      for (const [id, reference] of references) {
        const doc = current.store.s.documents.find(document => document.id === id && document.companyId === order.companyId && document.orderId === order.id);
        if (!doc || JSON.stringify(doc) !== reference) throw new Error("A selected original changed. Review the current sources before downloading.");
      }
    };
  }
  function localReplyText() {
    const reply = live.current.order.finalPreparation!.input.reply;
    return `LOCAL REPLY DRAFT — NOT SENT\nTo: ${reply.to}\nSubject: ${reply.subject}\n\n${reply.body}\n\nReview the recipient and actual outgoing attachments in your approved email channel.`;
  }
  async function exportBundle() {
    const selected = selectedIds.map(id => sources.find(document => document.id === id)).filter((document): document is VaultDoc => !!document);
    if (selected.length !== selectedIds.length) throw new Error("A selected original is no longer available. Review the source selection.");
    const assertCurrent = exportGuard(selected); assertCurrent();
    const current = live.current;
    const report = `${finalHandoffText(current.store.s, current.order)}\n\nBUNDLE SELECTION\nThis download contains ${selected.length} selected originals from ${sources.length} referenced sources. Unselected originals and text-only references are not included as files.\n${selected.map(document => `${document.name} · version ${document.version} · ${document.id}`).join("\n")}`;
    const result = await createFinalSourceBundle({ workspaceId: connection?.workspaceId || "", orderId: order.id, companyId: order.companyId, worksheetVersion: current.order.finalPreparation!.version, report, replyText: localReplyText(), documents: selected, assertCurrent,
      readOriginal: document => getAssetForDocument(document, { expectedWorkspaceId: connection?.workspaceId || "", expectedUserId: connection?.access.userId }),
    });
    assertCurrent(); download(`${finalDownloadName(order.id)}-final-handoff.zip`, result.archive);
    setNotice(`Downloaded the handoff and ${result.manifest.sources.length} selected ${result.manifest.sources.length === 1 ? "original" : "originals"}. Source checksums are recorded in manifest.json. No email was sent.`);
  }
  return <section className={styles.workspace} aria-label="WFG final preparation">
    <div className={styles.header}><div><p className={styles.eyebrow}>Final preparation</p><h2>Prepare this final</h2><p>Review the source facts and WFG decisions, download the handoff with selected originals, and prepare a local reply.</p></div><Status value={status} /></div>
    <nav className={styles.steps} aria-label="Final preparation steps">{steps.map((label, index) => <button type="button" key={label} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button>)}</nav>
    {(sourceChanged || status === "Source changed") && <div className={styles.warning} role="alert"><strong>Review the current file before continuing.</strong><p>The sources, facts, products or worksheet changed. Downloads remain unavailable until the current record is reviewed and prepared.</p>{sourceChanged && <Button variant="outline" disabled={busy} onClick={reload}><RefreshCw size={14} />Reload current worksheet</Button>}</div>}
    {error && <p className={styles.warning} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!canEdit && <p className={styles.note}>This file is read-only in your current access or issuance state.</p>}
    {step === 0 && <div className={styles.content}>
      <div className={styles.summary}><div><strong>{received.length}</strong><span>Saved finals requests</span></div><div><strong>{sources.length}</strong><span>Source records</span></div><div><strong>{ready.pendingFields.length}</strong><span>Facts awaiting review</span></div></div>
      <div className={styles.journey}>
        <ActionCard icon={<Files size={21} />} title="Read the originals" text={`${sourceCount} stored originals available. Open the existing reader to inspect pages, use OCR and capture supported facts.`} action="Open source package" onClick={() => reviewElsewhere(onReviewSources)} />
        <ActionCard icon={<FileCheck2 size={21} />} title="Confirm facts and clearance" text="Compare captured facts with their source pages, then review the commitment context, requirements and exceptions." action="Review captured facts" onClick={() => reviewElsewhere(onReviewFields)} secondary={{ label: "Review file details", onClick: () => reviewElsewhere(onReviewDetails) }} />
        <ActionCard icon={<Check size={21} />} title="Confirm the policy products" text={`${policyProducts.length} Owner / Loan products on this file. Configure the exact form, insured, amounts and product review before completing this worksheet.`} action="Manage policy products" onClick={() => reviewElsewhere(onReviewProducts)} />
      </div>
      <div className={styles.sourceList}><h3>Sources attached to this file</h3>{sources.map(document => <div key={document.id}><span><strong>{document.name}</strong><small>{document.sourceRole || "Other"} · version {document.version}</small></span><small>{document.assetId ? "Original stored" : "Section reference only"}</small></div>)}{!sources.length && <p>No final sources are attached yet. Open the source package to add the originals.</p>}</div>
      <Button onClick={() => setStep(1)}>Continue to WFG worksheet <ArrowRight size={15} /></Button>
    </div>}
    {step === 1 && <fieldset className={styles.content} disabled={!canEdit || busy || sourceChanged}>
      <div className={styles.sectionHeader}><div><h3>Company and attorney compatibility</h3><p>Record the approved evidence for this file and state. This worksheet cannot move a title file between companies.</p></div></div>
      <div className={styles.twoColumns}><label>Issuing company<select value={input.issuingCompanyId} onChange={event => edit(draft => { draft.issuingCompanyId = event.target.value; })}>{s.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Referring company<select value={input.referringCompanyId} onChange={event => edit(draft => { draft.referringCompanyId = event.target.value; })}>{s.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label></div>
      <label>Company WFG authority evidence<Textarea value={input.eligibility.companyEvidence} maxLength={4000} onChange={event => edit(draft => { draft.eligibility.companyEvidence = event.target.value; })} placeholder="Approved appointment/reference, state and effective date" /></label>
      <label>Attorney WFG eligibility evidence<Textarea value={input.eligibility.attorneyEvidence} maxLength={4000} onChange={event => edit(draft => { draft.eligibility.attorneyEvidence = event.target.value; })} placeholder="Verified attorney eligibility reference for this transaction" /></label>
      <label>Compatibility review outcome<Textarea value={input.eligibility.note} maxLength={4000} onChange={event => edit(draft => { draft.eligibility.note = event.target.value; })} placeholder="Explain why this company, attorney and WFG can be used for this file" /></label>
      <div className={styles.sectionHeader}><div><h3>Product forms and endorsements</h3><p>Use exact approved codes and versions. No form, endorsement or fee is selected automatically.</p></div><Button type="button" variant="outline" onClick={() => edit(draft => { draft.products = emptyFinalPreparation(s, order).products.map(row => draft.products.find(previous => previous.policyId === row.policyId) || row); })}>Sync current products</Button></div>
      {!policyProducts.length && <Empty title="Add the required policy products" text="Open policy products to create the Owner and/or Loan products for this file, then return and sync their rows." action={<Button type="button" variant="outline" onClick={() => reviewElsewhere(onReviewProducts)}>Manage policy products</Button>} />}
      {input.products.map((product, productIndex) => <section className={styles.product} key={product.policyId} aria-label={`Policy worksheet ${product.policyId}`}>
        <div className={styles.sectionHeader}><h4>{policyProducts.find(row => row.id === product.policyId)?.kind || "Unavailable"} policy <small>{product.policyId}</small></h4><Button type="button" variant="ghost" onClick={() => reviewElsewhere(onReviewProducts)}>Open policy product</Button></div>
        <div className={styles.twoColumns}><label>Policy variant<select value={product.variant} onChange={event => edit(draft => { draft.products[productIndex].variant = event.target.value as typeof product.variant; })}>{["Needs review", "Standard", "Enhanced"].map(value => <option key={value}>{value}</option>)}</select></label><label>Exact form and version<Input value={product.form} maxLength={1000} onChange={event => edit(draft => { draft.products[productIndex].form = event.target.value; })} /></label></div>
        <label>Variant, form and jacket review<Textarea value={product.reviewNote} maxLength={4000} onChange={event => edit(draft => { draft.products[productIndex].reviewNote = event.target.value; })} placeholder="How these choices match the approved commitment and jacket instructions" /></label>
        {product.endorsements.map((endorsement, endorsementIndex) => <div className={styles.decision} key={endorsement.id}>
          <div className={styles.sectionHeader}><strong>Endorsement {endorsementIndex + 1}</strong><Button type="button" variant="ghost" aria-label={`Remove endorsement ${endorsementIndex + 1} for ${product.policyId}`} onClick={() => edit(draft => { draft.products[productIndex].endorsements.splice(endorsementIndex, 1); })}><Trash2 size={14} /></Button></div>
          <div className={styles.threeColumns}><label>Endorsement code<Input value={endorsement.code} maxLength={500} onChange={event => edit(draft => { draft.products[productIndex].endorsements[endorsementIndex].code = event.target.value; })} /></label><label>Endorsement decision<select value={endorsement.decision} onChange={event => edit(draft => { draft.products[productIndex].endorsements[endorsementIndex].decision = event.target.value as typeof endorsement.decision; })}>{["Needs review", "Include", "Exclude"].map(value => <option key={value}>{value}</option>)}</select></label><label>Endorsement fee ($)<Input type="number" min="0" step="0.01" value={endorsement.fee ?? ""} onChange={event => edit(draft => { draft.products[productIndex].endorsements[endorsementIndex].fee = amountValue(event.target.value); })} /></label></div>
          <label>Endorsement rationale<Textarea value={endorsement.rationale} maxLength={4000} onChange={event => edit(draft => { draft.products[productIndex].endorsements[endorsementIndex].rationale = event.target.value; })} /></label>
        </div>)}
        <Button type="button" variant="outline" disabled={product.endorsements.length >= 30} onClick={() => edit(draft => { draft.products[productIndex].endorsements.push({ id: newId("endorsement"), code: "", decision: "Needs review", rationale: "", fee: null }); })}><Plus size={14} />Add endorsement decision</Button>
        <label>Endorsement review summary<Textarea value={product.endorsementReviewNote} maxLength={4000} onChange={event => edit(draft => { draft.products[productIndex].endorsementReviewNote = event.target.value; })} placeholder="Confirm all required endorsement choices, including any intentional exclusions or no endorsements" /></label>
      </section>)}
      <div className={styles.sectionHeader}><div><h3>Binder and other fees</h3><p>Enter a verified amount when a fee applies. A blank amount is not a zero charge.</p></div></div>
      {input.fees.map((fee, index) => <section className={styles.decision} key={fee.id} aria-label={`${fee.kind} fee decision`}>
        <div className={styles.sectionHeader}><h4>{fee.kind === "Binder" ? "Binder fee" : "Other fee"}</h4>{fee.kind === "Other" && <Button type="button" variant="ghost" aria-label={`Remove fee ${index + 1}`} onClick={() => edit(draft => { draft.fees.splice(index, 1); })}><Trash2 size={14} /></Button>}</div>
        <div className={styles.threeColumns}><label>Fee label<Input value={fee.label} maxLength={500} onChange={event => edit(draft => { draft.fees[index].label = event.target.value; })} /></label><label>Fee applicability<select value={fee.decision} onChange={event => edit(draft => { draft.fees[index].decision = event.target.value as typeof fee.decision; })}>{["Needs review", "Applies", "Not applicable"].map(value => <option key={value}>{value}</option>)}</select></label><label>Fee amount ($)<Input type="number" min="0" step="0.01" value={fee.amount ?? ""} onChange={event => edit(draft => { draft.fees[index].amount = amountValue(event.target.value); })} /></label></div>
        <label>Approved fee source<Input value={fee.reference} maxLength={4000} onChange={event => edit(draft => { draft.fees[index].reference = event.target.value; })} /></label><label>Fee rationale<Textarea value={fee.rationale} maxLength={4000} onChange={event => edit(draft => { draft.fees[index].rationale = event.target.value; })} /></label>
      </section>)}
      <Button type="button" variant="outline" disabled={input.fees.length >= 30} onClick={() => edit(draft => { draft.fees.push({ id: newId("fee"), kind: "Other", label: "", decision: "Needs review", amount: null, reference: "", rationale: "" }); })}><Plus size={14} />Add other fee</Button>
      <label>Fee review summary<Textarea value={input.feeReviewNote} maxLength={4000} onChange={event => edit(draft => { draft.feeReviewNote = event.target.value; })} /></label>
      <label>Preparation notes<Textarea value={input.note} maxLength={4000} onChange={event => edit(draft => { draft.note = event.target.value; })} /></label>
      <Button type="button" onClick={() => setStep(2)}>Continue to local reply <ArrowRight size={15} /></Button>
    </fieldset>}
    {step === 2 && <fieldset className={styles.content} disabled={!canEdit || busy || sourceChanged}>
      <div className={styles.sectionHeader}><div><h3>Prepare the local reply</h3><p>This text stays in the worksheet. Review recipients and actual attachments in your approved email channel.</p></div><Mail size={21} /></div>
      <label>Reply recipient<Input type="email" value={input.reply.to} maxLength={254} onChange={event => edit(draft => { draft.reply.to = event.target.value; })} /></label>
      <label>Reply subject<Input value={input.reply.subject} maxLength={500} onChange={event => edit(draft => { draft.reply.subject = event.target.value; })} /></label>
      <label>Local reply text<Textarea rows={10} value={input.reply.body} maxLength={20000} onChange={event => edit(draft => { draft.reply.body = event.target.value; })} /></label>
      {!input.reply.body.trim() && <Button type="button" variant="outline" onClick={() => edit(draft => { draft.reply.body = `Please review the WFG final preparation handoff for ${order.address || order.id}.\n\nFile: ${order.id}\n\nThe handoff records the reviewed source facts and policy instructions. Official jacket and policy issuance remain in the approved underwriter workflow.\n\nPlease confirm the final outgoing documents before sending.`; })}>Prepare local reply</Button>}
      <Button type="button" onClick={() => setStep(3)}>Continue to review & export <ArrowRight size={15} /></Button>
    </fieldset>}
    {step === 3 && <div className={styles.content}>
      <div className={styles.sectionHeader}><div><h3>Review the complete handoff</h3><p>Save the worksheet, confirm current evidence and decisions, then prepare its export.</p></div></div>
      {problems.length > 0 && <details className={styles.blockers} open><summary>{problems.length} items need review</summary><ul>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul></details>}
      {problems.length === 0 && <p className={styles.notice}>{canExport ? "The prepared handoff reflects the current saved worksheet and sources." : currentReview && !dirty && !sourceChanged ? "The current worksheet is reviewed. Prepare its handoff when ready." : "Required worksheet and source checks are complete. Save any edits and confirm your review before preparing the handoff."}</p>}
      <label>Final review note<Textarea value={currentReview ? order.finalPreparation?.review?.note || reviewNote : reviewNote} maxLength={4000} disabled={!canEdit || busy || sourceChanged || currentReview} onChange={event => { setReviewNote(event.target.value); setAcknowledged(false); }} placeholder="Record the evidence checked and why the WFG preparation is ready for handoff" /></label>
      <label className={styles.check}><input type="checkbox" checked={(currentReview && !dirty && !sourceChanged) || acknowledged} disabled={!canEdit || busy || sourceChanged || dirty || currentReview || problems.length > 0} onChange={event => setAcknowledged(event.target.checked)} />I checked the current source facts, compatibility, forms, endorsements, fees and local reply.</label>
      <div className={styles.actions}><Button disabled={!canEdit || busy || sourceChanged || dirty || currentReview || !order.finalPreparation || problems.length > 0 || !reviewNote.trim() || !acknowledged} onClick={() => void act(async () => { assertOpen(); if (!await update(draft => { assertOpen(); reviewFinalPreparation(draft, order.id, base.version, base.source, reviewNote); }, "Final preparation reviewed", order.id, connection?.revision)) throw new Error("The review save was not confirmed. Refresh and review the current worksheet."); assertOpen(); setNotice("Current worksheet reviewed. Prepare the handoff when ready."); })}><Check size={15} />Confirm worksheet review</Button><Button variant="outline" disabled={!canEdit || busy || sourceChanged || dirty || status !== "Reviewed"} onClick={() => void act(async () => { assertOpen(); if (!await update(draft => { assertOpen(); prepareFinalHandoff(draft, order.id, base.version, base.source); }, "Final handoff prepared", order.id, connection?.revision)) throw new Error("Handoff preparation was not confirmed. Refresh the worksheet before exporting."); assertOpen(); setNotice("Reviewed handoff prepared. It is ready to download for the approved external workflow."); })}>Prepare handoff <ArrowRight size={15} /></Button></div>
      <section className={styles.export} aria-label="Final handoff downloads"><h3>Download the reviewed work</h3><p>Readable handoff and local reply files. These downloads do not issue a policy, update SoftPro, send email or record delivery.</p>
        <div className={styles.actions}>{["html", "txt"].map(format => <Button key={format} variant="outline" disabled={!canExport || busy} onClick={() => void act(async () => { const guard = exportGuard(); guard(); const current = live.current; const report = finalHandoffText(current.store.s, current.order); guard(); download(`${finalDownloadName(order.id)}-final-handoff.${format}`, format === "html" ? finalHandoffHtml(report, `Final preparation · ${order.id}`) : report, format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8"); setNotice("Reviewed handoff downloaded. No provider or delivery state changed."); })}><Download size={14} />{format === "html" ? "Download readable handoff" : "Download handoff text"}</Button>)}<Button variant="outline" disabled={!canExport || busy} onClick={() => void act(async () => { const guard = exportGuard(); guard(); download(`${finalDownloadName(order.id)}-local-reply.txt`, localReplyText()); setNotice("Local reply downloaded. No email was sent."); })}>Download local reply</Button></div>
        <h4>Select original files for the bundle</h4><p>Up to 50 originals, 25 MB each and 64 MB total. All referenced sources appear in the handoff; only the originals selected below are included in the ZIP.</p>
        <div className={styles.sourceSelection}>{sources.map(document => <label key={document.id} className={styles.check}><input type="checkbox" checked={selectedIds.includes(document.id)} disabled={!canExport || busy || !document.assetId} onChange={event => setSelectedIds(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))} /><span>{document.name}<small>{document.sourceRole || "Other"} · v{document.version}{document.assetId ? "" : " · Text reference, no original bytes"}</small></span></label>)}</div>
        <Button disabled={!canExport || busy || !selectedIds.length} onClick={() => void act(exportBundle)}><Download size={15} />Download handoff + selected originals</Button>
      </section>
    </div>}
    <div className={styles.footer}><p>{sourceChanged ? "Reload the current facts to continue." : dirty ? "Unsaved worksheet edits" : order.finalPreparation ? `Worksheet v${order.finalPreparation.version} · ${status}` : "Worksheet not saved yet"}</p><Button disabled={!canEdit || busy || sourceChanged || (!dirty && !!order.finalPreparation)} onClick={() => void act(save)}><Save size={15} />{busy ? "Working…" : "Save worksheet"}</Button></div>
  </section>;
}

function ActionCard({ icon, title, text, action, onClick, secondary }: { icon: ReactNode; title: string; text: string; action: string; onClick: () => void; secondary?: { label: string; onClick: () => void } }) {
  return <section className={styles.actionCard}><span className={styles.cardIcon}>{icon}</span><h3>{title}</h3><p>{text}</p><Button variant="outline" onClick={onClick}>{action}<ArrowRight size={14} /></Button>{secondary && <Button variant="ghost" onClick={secondary.onClick}>{secondary.label}</Button>}</section>;
}
