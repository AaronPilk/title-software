import type { VaultDoc, Workspace } from "./model";
import { traceMutation } from "./command-log";
import { companyDesk } from "./company-workspace";
import { sameDocumentFamily } from "./production";
import { isAutomaticApplicationTask, syncAgencySetup } from "./agency-setup";

export const isAgencyDocumentArchived = (doc: Pick<VaultDoc, "archivedAt">) => !!doc.archivedAt;
export const documentDisplayName = (doc: Pick<VaultDoc, "displayName" | "name">) => doc.displayName || doc.name;
export const agencyDocumentSnapshot = (doc: VaultDoc) => JSON.stringify(doc);
export const agencyDocumentAccessDefault = (category: string): "Internal" | "Restricted" =>
  ["Applications", "Company records", "Formation", "Agreements", "Banking", "Partner entities", "Licensing", "Underwriters", "Insurance"].includes(category) ? "Restricted" : "Internal";
const clean = (v: unknown, max: number, required = false): v is string => typeof v === "string" && v.length <= max && (!required || !!v.trim()) && !/[\u0000-\u001f\u007f]/.test(v);
const productionBound = (doc: VaultDoc) => !!(doc.orderId || doc.sourceRole || doc.policyId || doc.cplId || doc.correctionId || doc.parentDocumentId || doc.providerSource || doc.preparationFingerprint || doc.productionVersion !== undefined || doc.commitmentVersion !== undefined || doc.policyVersion !== undefined || doc.cplVersion !== undefined);
/** Dependencies include retained review/publication history, not only active rows. Private intake is checked by the server before committing. */
function references(value: unknown, documentId: string, key = ""): boolean {
  if (typeof value === "string") return /(?:documentId|documentIds|sourceDocumentId|sourceDocumentIds|logoDocumentId|attachments)$/i.test(key) && value === documentId;
  if (Array.isArray(value)) return value.some(item => references(item, documentId, key));
  if (value && typeof value === "object") return Object.entries(value).some(([name, child]) => references(child, documentId, name));
  return false;
}
export function agencyDocumentArchiveProblem(state: Workspace, doc: VaultDoc): string {
  if (productionBound(doc)) return "Production and imported source documents must stay with their original workflow.";
  if (doc.visibility === "Partner") return "Remove partner sharing through publication review before moving this file to Trash.";
  const dependencies = Object.entries(state).filter(([key]) => !["documents", "activity"].includes(key)).map(([key, value]) => [key, key === "tasks" && doc.category === "Applications" && doc.visibility === "Restricted" ? state.tasks.map(task => isAutomaticApplicationTask(task, doc.companyId) ? { ...task, documentIds: [] } : task) : value]);
  if (dependencies.some(([, value]) => references(value, doc.id)) || state.documents.some(other => other.id !== doc.id && other.parentDocumentId === doc.id))
    return "This file is linked to a logo, task, approval, private record, or sharing history. Keep its original available and use a replacement where needed.";
  return "";
}
export function validateAgencyDocuments(state: Workspace) {
  for (const doc of state.documents) {
    if (doc.displayName !== undefined && (!clean(doc.displayName, 240, true) || /[/\\]/.test(doc.displayName))) throw new Error("Use a document name of 1–240 characters without path separators.");
    if (doc.designation !== undefined && !["Current", "Final"].includes(doc.designation)) throw new Error("Choose Current or Final for a company document.");
    const archived = doc.archivedAt !== undefined || doc.archivedBy !== undefined || doc.archiveReason !== undefined;
    if (archived && (!clean(doc.archivedAt, 24, true) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(doc.archivedAt) || !Number.isFinite(Date.parse(doc.archivedAt)) || new Date(doc.archivedAt).toISOString() !== doc.archivedAt || !clean(doc.archivedBy, 254, true) || !clean(doc.archiveReason, 500, true))) throw new Error("Trash requires its removal date, actor, and reason.");
    if (productionBound(doc) && (doc.displayName !== undefined || doc.designation !== undefined || archived)) throw new Error("Company cabinet actions cannot change Production or imported source documents.");
    if (archived && doc.designation !== undefined) throw new Error("A file in Trash cannot be designated Current or Final.");
  }
  for (const doc of state.documents.filter(doc => !!doc.designation)) if (state.documents.some(other => other.id !== doc.id && !!other.designation && sameDocumentFamily(doc, other))) throw new Error("Choose one current or final original for each document version family.");
}
/** The gateway authorizes commands and stamps authenticated archive metadata. */
export function validateAgencyDocumentMutation(before: Workspace, after: Workspace) {
  validateAgencyDocuments(after);
  for (const prior of before.documents) {
    const next = after.documents.find(doc => doc.id === prior.id);
    if (!next) throw new Error("Document originals stay recoverable. Move eligible company documents to Trash instead.");
    if (!prior.archivedAt && next.archivedAt) {
      const problem = agencyDocumentArchiveProblem(before, prior) || agencyDocumentArchiveProblem(after, next);
      if (problem) throw new Error(problem);
    }
  }
}
type Target = { documentId: string; expected: string };
function target(state: Workspace, input: Target, archived = false) {
  const doc = state.documents.find(doc => doc.id === input.documentId);
  if (!doc || agencyDocumentSnapshot(doc) !== input.expected) throw new Error("This document changed. Reopen it before saving.");
  if (productionBound(doc)) throw new Error("This document belongs to its original Production or import workflow.");
  if (!!doc.archivedAt !== archived) throw new Error(archived ? "This document is no longer in Trash." : "Restore this document from Trash before changing it.");
  return doc;
}
export function renameAgencyDocument(state: Workspace, input: Target & { displayName: string }) {
  return traceMutation(state, "renameAgencyDocument", [input], () => {
    const doc = target(state, input); doc.displayName = input.displayName.trim(); validateAgencyDocuments(state);
  });
}
export function moveAgencyDocument(state: Workspace, input: Target & { folderId: string }) {
  return traceMutation(state, "moveAgencyDocument", [input], () => {
    const doc = target(state, input), company = state.companies.find(company => company.id === doc.companyId);
    if (!company || input.folderId && !companyDesk(company).folders.some(folder => folder.id === input.folderId)) throw new Error("Choose a folder in this company.");
    company.desk = companyDesk(company); doc.folderId = input.folderId;
  });
}
export function archiveAgencyDocument(state: Workspace, input: Target & { reason: string; actor: string; at: string }) {
  return traceMutation(state, "archiveAgencyDocument", [input], () => {
    const doc = target(state, input), problem = agencyDocumentArchiveProblem(state, doc);
    if (problem) throw new Error(problem);
    delete doc.designation; doc.archivedAt = input.at; doc.archivedBy = input.actor; doc.archiveReason = input.reason.trim(); validateAgencyDocuments(state);
    if (doc.category === "Applications") syncAgencySetup(state, doc.companyId);
  });
}
export function restoreAgencyDocument(state: Workspace, input: Target) {
  return traceMutation(state, "restoreAgencyDocument", [input], () => {
    const doc = target(state, input, true); delete doc.archivedAt; delete doc.archivedBy; delete doc.archiveReason;
    if (doc.category === "Applications") syncAgencySetup(state, doc.companyId);
  });
}
export function designateAgencyDocument(state: Workspace, input: Target & { designation: "Current" | "Final" | "" }) {
  return traceMutation(state, "designateAgencyDocument", [input], () => {
    const doc = target(state, input);
    if (input.designation) {
      if (!["Current", "Final"].includes(input.designation)) throw new Error("Choose Current or Final.");
      for (const prior of state.documents) if (sameDocumentFamily(prior, doc)) delete prior.designation;
      doc.designation = input.designation;
    } else delete doc.designation;
    validateAgencyDocuments(state);
  });
}
