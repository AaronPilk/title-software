import { validateCompanyDesk, validateCompanyWorkspace } from "../title/company-workspace";
import { projectPartnerSummary } from "./partner-summary";
import { validateCompanyIntake, companyProfileMissing, companyCandidateKey } from "../title/company-intake";
import { buildOperatingConfirmation, companyDisplayStage } from "../title/company-operating-status";
import { normalizeMemberContacts } from "../title/member-directory";
import { productionOnlyRole, productionCompany, productionDocument, productionMessage, productionTask } from "../title/production-access";
import type { Workspace, Company, Order, VaultDoc } from "../title/model";
import { createSeed } from "../title/model";
import * as B from "../title/business";
import * as P from "../title/production";
import * as FP from "../title/final-preparation";
import { fieldReviewHistoryShapeValid, recordFieldReviewChanges } from "../title/field-review-history";
import * as M from "../title/materials";
import * as F from "../title/followups";
import * as S from "../title/statement-delivery";
import * as T from "../title/task-clock";
import * as D from "../title/delivery-ledger";
import * as O from "../title/ownership-history";
import * as OR from "../title/orchestration";
import { isCalendarDay } from "../title/business-date";
import { executeRules } from "../title/engine";
import {
  withCommandIds,
  type DraftEdit,
  type WorkspaceCommand,
} from "../title/command-log";

export type Role =
  | "owner"
  | "admin"
  | "operations"
  | "onboarding"
  | "finance"
  | "viewer"
  | "partner";
export type Access = {
  userId: string;
  email: string;
  role: Role;
  companyIds: string[];
  allCompanies: boolean;
  restricted: boolean;
  version: number;
  partnerMembers: { id: string; companyId: string; memberName: string }[];
  /** The connected command API requires an account for manual assignments. */
  requireStaffAssignments?: boolean;
  /** Server-resolved current staff, supplied only while validating explicit assignments. */
  assignableStaff?: { userId: string; email: string; role: Role; companyIds: string[]; allCompanies: boolean }[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new ApiError(message, status);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function object<T extends object>(v: T): T;
function object(v: unknown): Record<string, unknown>;
function object(v: unknown): object {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail("Expected an object.");
  return v;
}
const has = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);
const keys = (v: object, allowed: string[]) => {
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) fail(`Unsupported field: ${k}.`);
};
function nonempty(v: unknown, label: string): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v.length > 20000)
    fail(`Enter ${label}.`);
}
function cash(v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e12)
    fail("Enter a valid amount.");
}
function isOneOf<const T>(value: unknown, choices: readonly T[]): value is T {
  return choices.includes(value as T);
}
const admin = (a: Access) => ["owner", "admin"].includes(a.role);
const workspaceAdmin = (a: Access) =>
  a.role === "owner" || (a.role === "admin" && a.allCompanies);
function permitWorkspaceAdmin(a: Access) {
  if (!workspaceAdmin(a))
    fail("Only an organization-wide administrator may change workspace settings.", 403);
}
export const canCompany = (a: Access, id: string) =>
  a.allCompanies || a.companyIds.includes(id);
function validateAssignment(v: Record<string, unknown>, current: { assigneeId?: string; owner: string } | undefined, companyId: unknown, a: Access, kind: "task" | "order") {
  if (!has(v, "assigneeId")) {
    if ((a.requireStaffAssignments && (!current || has(v, "owner") && v.owner !== current.owner)) ||
        (current?.assigneeId && has(v, "owner") && v.owner !== current.owner))
      fail("Choose a workspace staff account to change this assignment.");
    return;
  }
  if (typeof v.assigneeId !== "string" || !/^[a-f\d-]{36}$/i.test(v.assigneeId))
    fail("Choose an active workspace staff account.");
  const staff = a.assignableStaff?.find(member => member.userId === v.assigneeId);
  const roles = kind === "order" ? ["owner", "admin", "operations"] : ["owner", "admin", "operations", "onboarding", "finance"];
  if (!staff || !roles.includes(staff.role) || (!staff.allCompanies && !staff.companyIds.some(id => id === companyId)))
    fail("The selected staff account no longer has access to this company. Refresh the staff list.", 409);
  v.owner = staff.email;
}
function permit(a: Access, group: string) {
  if (admin(a)) return;
  const allowed: Record<string, string[]> = {
    production: ["operations"],
    company: ["onboarding"],
    finance: ["finance"],
    publication: ["onboarding", "finance"],
    tasks: ["operations", "onboarding", "finance"],
  };
  if (!(allowed[group] || []).includes(a.role))
    fail("Your account cannot perform this action.", 403);
}
export function safePayload(v: unknown, depth = 0) {
  if (depth > 28) fail("Request is too deeply nested.");
  if (typeof v === "number" && !Number.isFinite(v)) fail("Invalid number.");
  if (typeof v === "string" && v.length > 2_000_000) fail("Text is too large.");
  if (Array.isArray(v) && v.length > 10000) fail("Too many records.");
  if (v && typeof v === "object")
    for (const [k, value] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(k))
        fail("Invalid property.");
      safePayload(value, depth + 1);
    }
}
export function emptyWorkspace(actor = ""): Workspace {
  return {
    version: 1,
    user: actor,
    companies: [],
    orders: [],
    documents: [],
    tasks: [],
    inbox: [],
    activity: [],
    rules: createSeed().rules,
    revisions: [],
    fieldRevisions: [],
    replyDrafts: [],
    importTemplates: [],
    expenses: {},
    approvedReports: [],
    expansionStates: [],
    statementDeliveries: [],
    deliveries: [],
    ownershipHistory: [],
    orchestration: { version: 1, profiles: [], fieldMaps: [], links: [], controls: [], readiness: [], proposals: [], events: [] },
    materials: { version: 1, items: [], publications: [] },
    business: {
      policies: [],
      commitments: [],
      cpls: [],
      onboarding: [],
      credentials: [],
      closes: [],
      handoffs: [],
      corrections: [],
      followups: [],
    },
  };
}
type RecordIdentity = { id?: string; companyId?: string; orderId?: string; policyId?: string };
type CollectionAt<T, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T ? CollectionAt<NonNullable<T[Head]>, Tail> : never
  : Path extends keyof T ? NonNullable<T[Path]> : never;
type RecordCollection<Path extends string> = string extends Path
  ? (Record<string, unknown> & RecordIdentity)[] : CollectionAt<Workspace, Path>;
function collection<Path extends string>(s: Workspace, table: Path): RecordCollection<Path> {
  const value = table.split(".").reduce<unknown>((v, key) =>
    v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, s);
  if (!Array.isArray(value)) fail("Unknown record collection.");
  return value as RecordCollection<Path>;
}
function replaceCollection(s: Workspace, table: string, rows: unknown[]) {
  const parts = table.split(".");
  const parent = object((parts.length === 1 ? s : (s as unknown as Record<string, unknown>)[parts[0]]) as unknown);
  parent[parts.at(-1)!] = rows;
}
function companyOf(s: Workspace, table: string, r: RecordIdentity | undefined): string {
  if (!r) return "";
  if (table === "companies") return r.id || "";
  if (r.companyId) return r.companyId;
  if (r.orderId)
    return s.orders.find((o) => o.id === r.orderId)?.companyId || "";
  if (r.policyId)
    return companyOf(
      s,
      "business.policies",
      B.business(s).policies.find((p) => p.id === r.policyId),
    );
  return "";
}
const recordTables = [
  "companies",
  "orders",
  "documents",
  "tasks",
  "inbox",
  "revisions",
  "fieldRevisions",
  "replyDrafts",
  "statementDeliveries",
  "deliveries",
  "ownershipHistory",
  "orchestration.profiles",
  "orchestration.fieldMaps",
  "orchestration.links",
  "orchestration.controls",
  "orchestration.readiness",
  "orchestration.proposals",
  "orchestration.events",
  "business.policies",
  "business.commitments",
  "business.cpls",
  "business.onboarding",
  "business.credentials",
  "business.closes",
  "business.handoffs",
  "business.corrections",
  "business.followups",
  "materials.items",
  "materials.publications",
];
const rowId = (r: RecordIdentity) => (r.id || r.companyId || r.orderId)!;
function checkScope(before: Workspace, after: Workspace, a: Access) {
  for (const table of recordTables) {
    const old = collection(before, table),
      next = collection(after, table);
    for (const r of [...old, ...next]) {
      const id = rowId(r),
        x = old.find((o) => rowId(o) === id),
        y = next.find((o) => rowId(o) === id);
      if (eq(x, y)) continue;
      for (const [state, row] of [
        [before, x],
        [after, y],
      ] as const) {
        if (!row) continue;
        const company = companyOf(state, table, row);
        if ((!company && !admin(a)) || (company && !canCompany(a, company)))
          fail("This record is outside your company access.", 403);
      }
    }
  }
}
function ensureShape(s: Workspace) {
  validateCompanyWorkspace(s);
  if (s.orders.some(o => !fieldReviewHistoryShapeValid(o.fieldReviewHistory))) fail("Invalid source field review history.");
  if (s.orders.some(o => o.finalPreparation !== undefined && !FP.finalPreparationShapeValid(o.finalPreparation))) fail("Invalid final preparation worksheet.");
  if (s.orders.some(o => !P.referencedSourcesShapeValid(o.production?.referencedSources))) fail("Invalid referenced-source checklist.");
  for (const table of recordTables) {
    const list = collection(s, table),
      ids = new Set<string>();
    for (const row of list) {
      const id = rowId(row);
      if (
        typeof id !== "string" ||
        !/^[\w .:@-]{1,180}$/.test(id) ||
        ids.has(id)
      )
        fail("Invalid or duplicate record identity.");
      ids.add(id);
      const company = companyOf(s, table, row);
      if (company && !s.companies.some((c) => c.id === company))
        fail("A record names a missing company.");
      if (
        row.orderId &&
        !s.orders.some(
          (o) =>
            o.id === row.orderId &&
            (!row.companyId || o.companyId === row.companyId),
        )
      )
        fail("A record names a different or missing file.");
    }
  }
  for (const doc of s.documents) {
    if (
      !Number.isInteger(doc.version) ||
      doc.version < 1 ||
      !["Internal", "Restricted", "Partner"].includes(doc.visibility)
    )
      fail("Invalid document version or access class.");
    if (doc.providerSource !== undefined) {
      const p = object(doc.providerSource);
      const mail = s.inbox.find(m => m.id === p.sourceMailId);
      const original = mail?.missive;
      const source = s.documents.find(d => d.id === p.sourceDocumentId);
      const attachment = original?.attachments.find(a => a.id === p.attachmentId);
      if (p.provider !== "Missive" || !original || !source || !attachment ||
          doc.companyId !== mail!.companyId || doc.orderId !== mail!.orderId ||
          source.companyId !== doc.companyId || source.orderId !== doc.orderId ||
          p.sourceDocumentId !== original.sourceDocumentId || p.organizationId !== original.organizationId ||
          p.teamId !== original.teamId || p.conversationId !== original.conversationId || p.messageId !== original.messageId ||
          !Number.isSafeInteger(p.mappingVersion) || p.mappingVersion < original.mappingVersion ||
          p.filename !== doc.name || p.filename !== attachment.name || p.mime !== doc.mime || p.mime !== attachment.mime ||
          p.bytes !== attachment.bytes || !Number.isSafeInteger(p.bytes) || p.bytes <= 0 ||
          typeof p.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sha256) ||
          typeof p.importedAt !== "string" || !Number.isFinite(Date.parse(p.importedAt)) ||
          typeof p.importedBy !== "string" || !p.importedBy.trim() ||
          !/^missive:attachment:[a-f0-9]{64}$/.test(doc.id) ||
          doc.assetId !== doc.id.replace("missive:attachment:", "missive:asset:"))
        fail("Invalid imported attachment source or destination.");
    }
    for (const [key, list] of [
      ["policyId", B.business(s).policies],
      ["cplId", B.business(s).cpls],
      ["correctionId", B.business(s).corrections],
    ] as const) {
      const id = doc[key];
      if (
        id &&
        !list.some((r) => r.id === id && r.orderId === doc.orderId)
      )
        fail("Document output belongs to another file.");
    }
  }
  for (const mail of s.inbox)
    for (const id of mail.documentIds || [])
      if (
        !s.documents.some(
          (d) =>
            d.id === id &&
            d.companyId === mail.companyId &&
            (d.orderId || "") === (mail.orderId || ""),
        )
      )
        fail("Message attachment routing does not match.");
  if (!S.isValidStatementDeliveryWorkspace(s))
    fail("Invalid statement delivery data.");
  validateWorkflowState(s);
  workflowError(() => OR.validateOrchestrationMutation(s, s));
}

function workflowError(fn: () => void) {
  try { fn(); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    fail(error instanceof Error ? error.message : "Invalid workflow data.");
  }
}

/** Validate stored histories before use, including their links to canonical records. */
function validateWorkflowState(s: Workspace) {
  if (!s.tasks.every(T.isValidTaskFields)) fail("Invalid task waiting or creation data.");
  if (!D.isValidDeliveries(s.deliveries)) fail("Invalid document delivery data.");
  if (!O.isValidOwnershipHistory(s.ownershipHistory)) fail("Invalid ownership history.");
  workflowError(() => {
    T.validateTaskClock(s, s);
    D.validateDeliveryMutation(s, s);
    O.validateOwnershipMutation(s, s);
  });
  for (const task of s.tasks) {
    const ids = new Set<string>();
    for (const wait of task.waiting || []) {
      if (!wait.id.trim() || ids.has(wait.id) || !wait.by.trim() || !wait.reason.trim() ||
          (wait.until && !wait.resolvedBy.trim())) fail("Invalid task waiting history.");
      ids.add(wait.id);
    }
  }
  for (const record of s.ownershipHistory || []) {
    if (!record.companyId || !isCalendarDay(record.effectiveFrom) ||
        !record.reason.trim() || !record.recordedBy.trim() ||
        !Number.isFinite(Date.parse(record.recordedAt))) fail("Invalid ownership evidence.");
    const names = record.members.map(m => m.name.trim().toLowerCase());
    if (names.some(name => !name) || new Set(names).size !== names.length ||
        record.members.some(m => !Number.isFinite(m.share) || m.share <= 0 || m.share > 100))
      fail("Invalid ownership member interests.");
  }
  const successors = new Set<string>();
  for (const record of s.deliveries || []) {
    const doc = s.documents.find(d => d.id === record.documentId);
    if (!doc || !record.companyId || !record.orderId || doc.companyId !== record.companyId ||
        doc.orderId !== record.orderId || record.snapshot.documentId !== doc.id ||
        record.snapshot.documentVersion !== doc.version || record.snapshot.documentName !== doc.name)
      fail("Delivery document and file references do not match.");
    if (!record.recipientName.trim() || !B.emailValid(record.recipientEmail) ||
        !D.recipientRoles.includes(record.recipientRole as typeof D.recipientRoles[number]) ||
        !D.deliveryMethods.includes(record.method as typeof D.deliveryMethods[number]) ||
        !record.preparedBy.trim() || !Number.isFinite(Date.parse(record.preparedAt)))
      fail("Invalid delivery preparation evidence.");
    if (record.status === "Recorded" && (!isCalendarDay(record.deliveredOn) ||
        !record.recordedBy.trim() || !Number.isFinite(Date.parse(record.recordedAt)) ||
        record.deliveredOn < record.preparedAt.slice(0, 10) ||
        Date.parse(record.recordedAt) < Date.parse(record.preparedAt) ||
        record.deliveredOn > record.recordedAt.slice(0, 10)))
      fail("Invalid recorded delivery evidence.");
    if (record.status === "Failed" && (!isCalendarDay(record.failedOn) || !record.failedBy.trim() ||
        record.failedOn < record.preparedAt.slice(0, 10)))
      fail("Invalid failed delivery evidence.");
    if (record.status === "Cancelled" && (!record.cancelledBy.trim() ||
        !Number.isFinite(Date.parse(record.cancelledAt)) ||
        Date.parse(record.cancelledAt) < Date.parse(record.preparedAt)))
      fail("Invalid cancelled delivery evidence.");
    if (!record.previousDeliveryId) {
      if (record.attempt !== 1) fail("The first delivery attempt must be one.");
      continue;
    }
    const previous = s.deliveries!.find(r => r.id === record.previousDeliveryId);
    const previousDoc = s.documents.find(d => d.id === previous?.documentId);
    // New retries use the domain's current-family rule. Historical links use
    // immutable identity: source roles can be reviewed and reclassified later.
    if (!previous || !previousDoc || previous.status !== "Failed" ||
        previous.companyId !== record.companyId || previous.orderId !== record.orderId ||
        previousDoc.name !== doc.name || record.attempt !== previous.attempt + 1 ||
        record.recipientName !== previous.recipientName || record.recipientRole !== previous.recipientRole ||
        Date.parse(record.preparedAt) < Date.parse(previous.preparedAt) ||
        record.preparedAt.slice(0, 10) < previous.failedOn || successors.has(previous.id))
      fail("Invalid delivery retry history.");
    successors.add(previous.id);
  }
}

/** Copy and validate a persisted snapshot; only absent legacy modules become empty arrays. */
export function normalizeWorkspace(source: Workspace): Workspace {
  const s = structuredClone(object(source)) as Workspace;
  if (s.deliveries === undefined) s.deliveries = [];
  if (s.ownershipHistory === undefined) s.ownershipHistory = [];
  if (s.orchestration === undefined) OR.orchestration(s);
  workflowError(() => ensureShape(s));
  return s;
}
function immutableHistory(before: Workspace, after: Workspace) {
  for (const mail of before.inbox.filter(m => m.missive)) {
    const next = after.inbox.find(m => m.id === mail.id);
    if (!next || !eq(mail.missive, next.missive) || mail.companyId !== next.companyId || mail.orderId !== next.orderId)
      fail("Imported message source and destination cannot change. Capture a separate request if routing needs correction.");
  }
  for (const doc of before.documents) {
    const next = after.documents.find((d) => d.id === doc.id);
    if (!next) fail("Document history cannot be deleted.");
    for (const k of [
      "id",
      "companyId",
      "orderId",
      "assetId",
      "text",
      "version",
      "name",
      "policyId",
      "cplId",
      "correctionId",
      "policyVersion",
      "cplVersion",
      "productionVersion",
      "commitmentVersion",
      "preparationFingerprint",
      "providerSource",
    ] as const)
      if (!eq(doc[k], next[k]))
        fail(
          "Document content and output bindings are immutable. Upload a new version.",
        );
  }
  for (const p of B.business(before).policies.filter((p) =>
    ["Issued", "Delivered"].includes(p.status),
  )) {
    const n = B.business(after).policies.find((x) => x.id === p.id);
    if (!n) fail("Issued policy history cannot be deleted.");
    if (
      !["Issued", "Delivered"].includes(n.status) ||
      (p.status === "Delivered" && n.status !== "Delivered")
    )
      fail("An issued policy cannot return to a draft.");
    for (const k of Object.keys(p).filter(
      (k) =>
        ![
          "status",
          "deliveryTo",
          "deliveryReference",
          "deliveredAt",
          "remittanceReference",
        ].includes(k),
    ))
      if (!eq(p[k as keyof typeof p], n[k as keyof typeof n]))
        fail("Issued policy evidence cannot be changed.");
    if (
      p.status === "Delivered" &&
      !eq({ ...p, remittanceReference: "" }, { ...n, remittanceReference: "" })
    )
      fail("Recorded delivery is immutable.");
  }
  for (const p of B.business(before).closes.filter(
    (p) => p.status !== "Draft",
  )) {
    const n = B.business(after).closes.find((x) => x.id === p.id);
    if (!n) fail("Reviewed financial history cannot be deleted.");
    for (const k of Object.keys(p).filter(
      (k) => !["status", "publishedAt", "note"].includes(k),
    ))
      if (!eq(p[k as keyof typeof p], n[k as keyof typeof n]))
        fail("Reviewed financial snapshots are immutable.");
    if (p.publishedAt && p.publishedAt !== n.publishedAt)
      fail("Publication history cannot be rewritten.");
  }
}
type MemberShareInput = Pick<Company["members"][number], "name" | "share"> & { email?: unknown; phone?: unknown };
function hasMemberShare(member: unknown): member is MemberShareInput {
  if (!member || typeof member !== "object") return false;
  const value = member as Record<string, unknown>;
  return typeof value.name === "string" && !!value.name.trim() &&
    typeof value.share === "number" && Number.isFinite(value.share) && value.share > 0;
}
function validateMembers(members: unknown) {
  if (
    !Array.isArray(members) ||
    !members.every(hasMemberShare) ||
    new Set(members.map((m) => m.name.trim().toLowerCase())).size !==
      members.length ||
    (members.length &&
      Math.abs(members.reduce((n, m) => n + m.share, 0) - 100) > 0.000001)
  )
    fail(
      "Ownership must have unique members and positive shares totaling 100%.",
    );
  for (const member of members) {
    keys(member, ["id", "name", "share", "email", "phone"]);
    try { Object.assign(member, normalizeMemberContacts(member)); }
    catch (e) { fail(e instanceof Error ? e.message : "Check member contact details."); }
  }
}
function applyEdit(
  s: Workspace,
  edit: DraftEdit,
  a: Access,
  baseline: Workspace,
  timestamp: string,
) {
  object(edit);
  if (edit.insert && typeof edit.id === "string" && edit.id.startsWith("missive:"))
    fail("Missive records can only be created by the reviewed importer.");
  const v = object(edit.value);
  if (has(v, "id") && v.id !== edit.id) fail("Record identity cannot change.");
  if (edit.table === "user")
    fail("Signed-in identity is controlled by authentication.", 403);
  if (edit.table === "expenses") {
    permit(a, "finance");
    const values = object(v.value);
    for (const [key, value] of Object.entries(values)) {
      if (eq(s.expenses[key], value)) continue;
      if (
        !/^\d{4}-\d{2}:/.test(key) ||
        !s.companies.some((c) => c.id === key.slice(8)) ||
        !canCompany(a, key.slice(8))
      )
        fail("Invalid expense company or period.");
      cash(value);
      s.expenses[key] = value;
    }
    return;
  }
  if (edit.table === "expansionStates") {
    permitWorkspaceAdmin(a);
    if (
      !Array.isArray(v.value) ||
      v.value.some((x: unknown) => typeof x !== "string" || !/^[A-Z]{2}$/.test(x))
    )
      fail("Invalid state list.");
    s.expansionStates = [...new Set(v.value)] as string[];
    return;
  }
  if (edit.table === "approvedReports") {
    permit(a, "finance");
    // Legacy reviews contain an opaque snapshot spanning the whole workspace.
    // They cannot be safely read or extended through a company projection.
    if (!a.allCompanies)
      fail("An organization-wide finance account must confirm this review.", 403);
    if (
      !Array.isArray(v.value) ||
      v.value.some((x: unknown) => typeof x !== "string")
    )
      fail("Invalid review references.");
    s.approvedReports = [...new Set([...s.approvedReports, ...v.value])];
    return;
  }
  const list = collection(s, edit.table),
    current = list.find((r) => rowId(r) === edit.id);
  if (edit.insert && current) fail("Record already exists.", 409);
  if (!edit.insert && !current) fail("Record no longer exists.", 409);
  if (edit.table === "companies") {
    permit(a, "company");
    if (edit.insert) {
      if (!a.allCompanies)
        fail(
          "Only an organization-wide company manager may create companies.",
          403,
        );
      nonempty(v.name, "company name");
      const intake = v.intake ? validateCompanyIntake(v.intake, a.email) : undefined;
      if (intake) {
        permitWorkspaceAdmin(a);
        if (intake.profileStatus !== "incomplete" || !intake.nameUnverified || v.contact !== "" || v.email !== "" || v.location !== "" || v.jurisdiction !== "")
          fail("Import an incomplete company profile first, then review its details.");
        if (s.companies.some(c => c.intake && companyCandidateKey(c.intake) === companyCandidateKey(intake)))
          fail("This Missive inbox already has a company profile.", 409);
      } else {
        if (typeof v.contact !== "string" || v.contact.length > 100) fail("Check the optional contact name.");
        if (v.email !== "" && !B.emailValid(String(v.email))) fail("Enter a valid company email.");
      }
      if (!intake && !/^[A-Z]{2}$/.test(String(v.jurisdiction)))
        fail("Choose an operating state.");
      if (!intake && v.operatingStates !== undefined && (!Array.isArray(v.operatingStates) || !v.operatingStates.length || v.operatingStates.length > 50 || v.operatingStates.some(x => typeof x !== "string" || !/^[A-Z]{2}$/.test(x)) || !v.operatingStates.includes(v.jurisdiction) || new Set(v.operatingStates).size !== v.operatingStates.length)) fail("Choose valid operating states.");
      list.unshift({
        id: edit.id,
        name: v.name,
        initials: String(v.initials || v.name.slice(0, 2)),
        color: isOneOf(v.color, ["teal", "blue", "violet", "amber", "rose"])
          ? v.color
          : "blue",
        contact: v.contact,
        email: v.email,
        location: String(v.location || ""),
        jurisdiction: v.jurisdiction,
        stage: "Onboarding",
        steps: Array(7).fill(false),
        members: [],
        ...(intake ? { intake, operatingStates: [] } : v.operatingStates ? { operatingStates: v.operatingStates } : {}),
      });
    } else {
      keys(v, [
        "desk",
        "formationState",
        "operatingStates",
        "members",
        "name",
        "contact",
        "email",
        "location",
        "intake",
        "jurisdiction",
        "operatingStatus",
      ]);
      const previous = current as Company;
      if (has(v, "desk")) v.desk = validateCompanyDesk(v.desk);
      if (has(v, "operatingStatus")) {
        permitWorkspaceAdmin(a);
        if (v.operatingStatus !== null) {
          const confirmation = object(v.operatingStatus);
          keys(confirmation, ["status", "confirmedBy", "confirmedAt", "note"]);
          if (confirmation.status !== "Active" || typeof confirmation.note !== "string")
            fail("Confirm that this company is already operating and explain the source.");
          // This records an existing business fact, not completion of a launch
          // review. Actor/time come from this authenticated command only.
          workflowError(() => {
            v.operatingStatus = buildOperatingConfirmation(a.email, confirmation.note as string, timestamp);
          });
        }
      }
      if (has(v, "intake")) {
        if (!previous.intake) fail("Company intake provenance cannot be added to an existing profile.");
        const next = validateCompanyIntake(v.intake);
        const fixed = (value: typeof next) => Object.entries(value).filter(([key]) => !["nameUnverified", "profileStatus"].includes(key)).sort(([a], [b]) => a.localeCompare(b));
        if (!eq(fixed(next), fixed(previous.intake))) fail("Company intake provenance cannot be changed.");
        if (next.profileStatus === "complete" && companyProfileMissing({ ...previous, ...v } as Company).length)
          fail("Complete and confirm the company basics first.");
      }
      const pending = ((v.intake || previous.intake) as Company["intake"])?.profileStatus === "incomplete";
      if (has(v, "name") && !eq(v.name, previous.name) && previous.intake && !has(v, "intake"))
        fail("Review the company name after changing it.");
      if (has(v, "jurisdiction") && (previous.jurisdiction || !previous.intake || !/^[A-Z]{2}$/.test(String(v.jurisdiction))) && v.jurisdiction !== previous.jurisdiction)
        fail("The primary operating state cannot be changed here.");
      if (has(v, "members")) {
        validateMembers(v.members);
        const nextMembers = v.members as Company["members"];
        for (const prior of previous.members) {
          const matchingName = nextMembers.find(m => m.name === prior.name);
          if (prior.id && matchingName && matchingName.id !== prior.id) fail("Keep the existing member identity.");
          const sameIdentity = prior.id ? nextMembers.find(m => m.id === prior.id) : undefined;
          if (sameIdentity && sameIdentity.name !== prior.name) fail("Keep the member ledger name. Record the legal owner and representative in owner details; historical sharing uses the ledger name.");
        }
      }
      if (
        v.operatingStates &&
        (!Array.isArray(v.operatingStates) ||
          (!v.operatingStates.length && !pending) ||
          v.operatingStates.some(
            (x: unknown) => typeof x !== "string" || !/^[A-Z]{2}$/.test(x),
          ) ||
          s.orders.some(
            (o) =>
              o.companyId === edit.id &&
              !(v.operatingStates as unknown[]).includes(o.jurisdiction),
          ))
      )
        fail("Keep operating states used by existing files.");
      if (has(v, "email") && v.email !== "" && !B.emailValid(String(v.email)))
        fail("Enter a valid email.");
      Object.assign(current!, v);
    }
    return;
  }
  if (edit.table === "tasks") {
    const current = s.tasks.find(r => rowId(r) === edit.id)!;
    permit(a, "tasks");
    keys(v, ["id", "scope", "title", "companyId", "owner", "assigneeId", "due", "done", "priority", "createdAt"]);
    if (has(v, "scope") && !isOneOf(v.scope, ["agency", "production"])) fail("Choose an agency or production task.");
    if (productionOnlyRole(a.role)) {
      if (v.scope === "agency") fail("Your account can only manage production tasks.", 403);
      if (edit.insert) v.scope = "production";
    }
    if (!edit.insert && has(v, "scope") && current.scope !== v.scope && !admin(a))
      fail("An administrator must classify an existing task.", 403);
    validateAssignment(v, current, v.companyId || current?.companyId, a, "task");
    if (has(v, "createdAt") && !edit.insert) fail("Task creation time cannot be changed.");
    if (has(v, "createdAt") && typeof v.createdAt !== "string") fail("Invalid task creation time.");
    const n = { ...current, ...v, id: edit.id };
    nonempty(n.title, "task title");
    if (
      !isCalendarDay(n.due) ||
      typeof n.done !== "boolean" ||
      !["High", "Normal"].includes(n.priority)
    )
      fail("Invalid task.");
    if (current && v.companyId && v.companyId !== current.companyId)
      fail("Task routing cannot change.");
    if (edit.insert) list.unshift(n);
    else Object.assign(current!, v);
    return;
  }
  if (edit.table === "rules") {
    const current = s.rules.find(r => rowId(r) === edit.id)!;
    permitWorkspaceAdmin(a);
    if (edit.insert) fail("Unknown automation rule.");
    keys(v, ["enabled"]);
    if (typeof v.enabled !== "boolean") fail("Invalid rule state.");
    current.enabled = v.enabled;
    return;
  }
  if (edit.table === "orders") {
    const current = s.orders.find(r => rowId(r) === edit.id)!;
    permit(
      a,
      !edit.insert && Object.keys(v).every((k) => k === "remitted")
        ? "finance"
        : "production",
    );
    validateAssignment(v, current, v.companyId || current?.companyId, a, "order");
    if (edit.insert) {
      cash(v.premium);
      nonempty(v.address, "property address");
      nonempty(v.client, "client");
      const c = s.companies.find((c) => c.id === v.companyId);
      if (
        !c ||
        !isOneOf(v.jurisdiction, c.operatingStates || [c.jurisdiction])
      )
        fail("Choose a company's operating state.");
      const o: Order = {
        id: edit.id,
        companyId: c.id,
        address: v.address,
        client: v.client,
        type: String(v.type || "Purchase"),
        underwriter: String(v.underwriter || ""),
        owner: String(v.owner || a.email),
        ...(typeof v.assigneeId === "string" && v.assigneeId ? { assigneeId: v.assigneeId } : {}),
        jurisdiction: v.jurisdiction,
        delivered: false,
        remitted: false,
        status: "New",
        due: String(v.due || B.today()),
        premium: v.premium,
        rate: 0.4,
        month: String(v.due || B.today()).slice(0, 7),
        fields: [],
        notes: String(v.notes || ""),
        exception: "",
        receivedAt: B.today(),
      };
      list.unshift(o);
      return;
    }
    keys(v, [
      "owner",
      "assigneeId",
      "notes",
      "exception",
      "production",
      "fields",
      "status",
      "delivered",
      "remitted",
    ]);
    if (has(v, "remitted")) {
      permit(a, "finance");
      if (v.remitted !== true || current.status !== "Issued")
        fail("Only issued records can be reconciled.");
    }
    const locked = P.productionLocked(s, current);
    if (locked && (has(v, "production") || has(v, "fields")))
      fail("Issued production sources cannot be edited.");
    if (v.production) {
      const prior = P.titleFile(current),
        n = { ...prior, ...object(v.production) };
      keys(n, [
        "securityInstrument",
        "version",
        "financing",
        "loanAmount",
        "purchasePrice",
        "county",
        "attorney",
        "attorneyEmail",
        "lender",
        "seller",
        "legalDescription",
        "commitmentReference",
        "cplDecision",
        "cplReference",
        "priorPolicyReference",
        "requirements",
        "commitmentReview",
        "referencedSources",
      ]);
      cash(n.loanAmount);
      cash(n.purchasePrice);
      if (
        !["Cash", "Financed"].includes(n.financing) ||
        !["Review required", "Requested", "Not requested"].includes(
          n.cplDecision,
        )
      )
        fail("Invalid production inputs.");
      if (!eq(n.referencedSources, prior.referencedSources)) fail("Referenced sources require their review actions.");
      if (n.commitmentReview && !eq(n.commitmentReview, prior.commitmentReview))
        fail("Commitment approval requires its review action.");
      if (
        !Array.isArray(n.requirements) ||
        n.requirements.some(
          (r) =>
            !["Requirement", "Exception"].includes(r.kind) ||
            !["Open", "Satisfied", "Retained", "Excluded"].includes(r.status) ||
            typeof r.text !== "string" ||
            (r.status === "Satisfied" && !r.evidence?.trim()) ||
            (r.kind === "Exception" && r.status !== "Open" && !r.note?.trim()),
        )
      )
        fail("Record requirement disposition evidence and note.");
      current.production = {
        ...n,
        version: prior.version + 1,
        commitmentReview: undefined,
      };
    }
    if (v.fields) {
      if (!Array.isArray(v.fields) || v.fields.length !== current.fields.length)
        fail("Capture source fields through the source action.");
      for (const field of v.fields) {
        const old = current.fields.find((f) => f.id === field.id);
        if (!old) fail("Unknown source field.");
        // Omitted source properties are changes too: a draft edit cannot erase
        // capture provenance by leaving it out of the submitted field object.
        for (const k of new Set([...Object.keys(old), ...Object.keys(field)]))
          if (
            !["proposed", "reviewed", "current"].includes(k) &&
            !eq(old[k as keyof typeof old], field[k])
          )
            fail("Source identity must remain intact.");
        if (
          typeof field.proposed !== "string" ||
          typeof field.reviewed !== "boolean"
        )
          fail("Invalid field review.");
        if (field.current !== old.current && field.current !== field.proposed)
          fail("Applied field differs from reviewed value.");
        if (
          field.reviewed &&
          (!field.proposed.trim() ||
            !field.documentId ||
            !s.documents.some(
              (d) => d.id === field.documentId && d.orderId === current.id,
            ))
        )
          fail("Review a captured source value.");
      }
      current.fields = structuredClone(v.fields);
    }
    if (has(v, "status")) {
      if (v.status === "Ready for jacket") {
        const ready = P.finalReadiness(s, current);
        if (!ready.ready)
          fail(
            "Complete source, field and requirement review before preparation.",
          );
      } else if (v.status === "Issued") {
        if (
          current.status !== "Ready for jacket" ||
          B.products(s, current.id).length ||
          !P.finalReadiness(s, current).ready
        )
          fail("Use product-specific issuance after final review.");
      } else if (
        !isOneOf(v.status, ["New", "In progress", "Needs review"]) ||
        ["Issued", "Rejected"].includes(current.status)
      )
        fail("Use the supported status action.");
      current.status = v.status;
    }
    if (has(v, "delivered")) {
      if (
        v.delivered !== true ||
        current.status !== "Issued" ||
        B.products(s, current.id).some((p) => p.status !== "Delivered")
      )
        fail("Record delivery for issued products.");
      current.delivered = true;
    }
    for (const k of ["owner", "assigneeId", "notes", "exception", "remitted"])
      if (has(v, k)) Object.assign(current!, { [k]: v[k] });
    return;
  }
  if (edit.table === "inbox") {
    permit(a, "production");
    if (productionOnlyRole(a.role) && !productionMessage(s, { ...current, ...v } as Workspace["inbox"][number]))
      fail("Production messages must belong to an available title file.", 403);
    if (edit.insert) {
      keys(v, [
        "id",
        "sourceReference",
        "kind",
        "companyId",
        "documentIds",
        "from",
        "email",
        "subject",
        "body",
        "time",
        "orderId",
        "status",
        "attachments",
      ]);
      if (!B.emailValid(String(v.email))) fail("Enter sender email.");
      nonempty(v.from, "sender");
      nonempty(v.subject, "subject");
      nonempty(v.body, "message");
      if (
        v.sourceReference &&
        s.inbox.some((m) => m.sourceReference === v.sourceReference)
      )
        fail("This source message was already captured.");
      list.unshift({ ...v, id: edit.id, status: "New" });
    } else {
      keys(v, [
        "companyId",
        "orderId",
        "kind",
        "documentIds",
        "attachments",
        "status",
      ]);
      if (v.status && !isOneOf(v.status, ["New", "Queued", "Archived"]))
        fail("Invalid message status.");
      Object.assign(current!, v);
    }
    const m = s.inbox.find((r) => r.id === edit.id)!;
    m.attachments = (m.documentIds || []).map((id: string) => {
      const d = s.documents.find((d) => d.id === id);
      if (!d) fail("Missing attachment.");
      return d.name;
    });
    return;
  }
  if (edit.table === "documents") {
    const current = s.documents.find(r => rowId(r) === edit.id)!;
    permit(a, a.role === "onboarding" ? "company" : "production");
    if (productionOnlyRole(a.role) && !productionDocument(s, { ...current, ...v } as VaultDoc))
      fail("Production documents must belong to an available title file.", 403);
    if (edit.insert) {
      nonempty(v.name, "document name");
      if (!isOneOf(v.visibility, ["Internal", "Restricted"]))
        fail("Use reviewed publication to share documents.");
      if (v.visibility === "Restricted" && !a.restricted)
        fail("Restricted document access is required.", 403);
      const c = s.companies.find((c) => c.id === v.companyId);
      if (!c) fail("Choose a company.");
      const existing = s.documents.filter(
        (d) =>
          d.companyId === v.companyId &&
          d.orderId === v.orderId &&
          d.name === v.name,
      );
      const version = Math.max(0, ...existing.map((d) => d.version)) + 1;
      const n = { ...v, id: edit.id, version, date: B.today() } as VaultDoc;
      if (n.orderId) {
        const o = s.orders.find(
          (o) => o.id === n.orderId && o.companyId === n.companyId,
        );
        if (!o) fail("Document routing is invalid.");
        const output = [
          "Commitment output",
          "Revised commitment",
          "Final policy",
          "CPL",
          "Correction output",
        ].includes(n.sourceRole || "");
        if (P.productionLocked(s, o) && !output)
          fail("Add corrections separately from issued sources.");
        if (n.sourceRole === "Final policy") {
          const p = B.business(s).policies.find(
            (p) =>
              p.id === n.policyId &&
              p.orderId === o.id &&
              p.status === "Prepared",
          );
          if (!p) fail("Prepare this product before adding returned output.");
          n.policyVersion = p.version;
          n.preparationFingerprint = p.preparedSnapshot;
        }
        if (n.sourceRole === "Commitment output") {
          const c = B.getCommitment(s, o);
          if (c.status !== "Prepared") fail("Prepare the commitment first.");
          n.commitmentVersion = c.version;
          n.preparationFingerprint = c.snapshot;
        }
        if (n.sourceRole === "CPL") {
          const c = B.business(s).cpls.find(
            (c) =>
              c.id === n.cplId && c.orderId === o.id && c.status === "Prepared",
          );
          if (!c) fail("Prepare the CPL first.");
          n.cplVersion = c.version;
          n.preparationFingerprint = c.snapshot;
        }
        if (n.sourceRole === "Correction output") {
          const c = B.business(s).corrections.find(
            (c) =>
              c.id === n.correctionId &&
              c.orderId === o.id &&
              c.status === "Reviewed",
          );
          if (!c) fail("Review the correction first.");
          n.preparationFingerprint = c.reviewSnapshot;
        }
        if (output) n.productionVersion = P.titleFile(o).version;
      }
      list.unshift(n);
    } else {
      keys(v, ["visibility", "sourceRole", "folderId"]);
      if (has(v, "folderId")) { permit(a, "company"); if (current.orderId) fail("Folders belong to company documents only."); }
      if (v.visibility && !isOneOf(v.visibility, ["Internal", "Restricted"]))
        fail("Use reviewed publication to share documents.");
      if (
        (current.visibility === "Restricted" ||
          v.visibility === "Restricted") &&
        !a.restricted
      )
        fail("Restricted document access is required.", 403);
      if (current.id.startsWith("missive:source:") && v.sourceRole && v.sourceRole !== current.sourceRole)
        fail("Email source snapshots cannot be reclassified as title evidence.");
      if (v.sourceRole) {
        const o = s.orders.find((o) => o.id === current.orderId);
        if (
          !o ||
          P.productionLocked(s, o) ||
          !isOneOf(v.sourceRole, P.sourceRoles)
        )
          fail("This source cannot be reclassified.");
        const oldOrder = baseline.orders.find((x) => x.id === o.id);
        o.production = {
          ...P.titleFile(o),
          version:
            P.titleFile(o).version +
            (oldOrder &&
            P.titleFile(oldOrder).version === P.titleFile(o).version
              ? 1
              : 0),
          commitmentReview: undefined,
        };
        o.fields = o.fields.map((f) =>
          f.documentId === current.id ? { ...f, reviewed: false } : f,
        );
      }
      Object.assign(current!, v);
    }
    return;
  }
  if (["revisions", "fieldRevisions"].includes(edit.table)) {
    const current = collection(s, edit.table).find(r => rowId(r) === edit.id)!;
    permit(a, "production");
    if (edit.insert) fail("Capture a revision with its source action.");
    keys(v, ["note", "status"]);
    if (current.status === "Applied" || v.status !== "Needs information")
      fail("Applied revision history cannot be changed.");
    nonempty(v.note, "hold reason");
    Object.assign(current!, v);
    return;
  }
  if (edit.table === "replyDrafts") {
    const current = s.replyDrafts.find(r => rowId(r) === edit.id)!;
    permit(a, "production");
    if (edit.insert) fail("Prepare the associated revision first.");
    keys(v, ["to", "subject", "body", "attachmentId", "status"]);
    for (const k of ["to", "subject", "body", "attachmentId"])
      if (has(v, k)) Object.assign(current!, { [k]: v[k] });
    if (
      typeof current.to !== "string" ||
      typeof current.body !== "string" ||
      typeof current.subject !== "string"
    )
      fail("Enter draft text.");
    if (
      current.attachmentId &&
      !s.documents.some(
        (d) => d.id === current.attachmentId && d.orderId === current.orderId,
      )
    )
      fail("Choose this file's attachment.");
    current.status = current.attachmentId
      ? "Ready for review"
      : "Awaiting document";
    return;
  }
  if (edit.table === "business.closes") {
    const current = B.business(s).closes.find(r => rowId(r) === edit.id)!;
    permit(a, "finance");
    if (edit.insert) fail("Create a close through its action.");
    keys(v, ["status", "note"]);
    if (
      current.status !== "Published" ||
      v.status !== "Withdrawn" ||
      !String(v.note || "").startsWith(
        current.note + "\nPublication withdrawn: ",
      ) ||
      !String(v.note)
        .slice(current.note.length + 24)
        .trim()
    )
      fail("Record a withdrawal reason for the published close.");
    Object.assign(current!, v);
    return;
  }
  if (edit.table === "business.policies") {
    const current = B.business(s).policies.find(r => rowId(r) === edit.id)!;
    permit(a, "finance");
    if (edit.insert) fail("Create policy products through their action.");
    keys(v, ["remittanceReference"]);
    if (!["Issued", "Delivered"].includes(current.status))
      fail("Only issued policies may be reconciled.");
    nonempty(v.remittanceReference, "remittance review reference");
    current.remittanceReference = v.remittanceReference;
    return;
  }
  fail("This field requires its supported workflow action.");
}

const productionNames =
  "addReferencedSource reviewReferencedSource saveCommitment prepareCommitment addPolicy savePolicy preparePolicy issuePolicy deliverPolicy requestCorrection reviewCorrectionRequest recordCorrection cancelCorrection saveCPL recordCommitmentReturn recordHandoff voidDraftPolicy prepareCPL returnCPL deliverCPL recordOrderOutcome backfillReceivedDate reviewCommitment replaceSourceFields createRevision applyRevision recheckRevision createFieldRevision applyFieldRevision recheckFieldRevision approveReplyDraft createFollowup recordFollowupSent resolveFollowupItem cancelFollowupItem".split(
    " ",
  );
const companyNames =
  "saveCompanyUnderwriters saveApplication recordOnboardingEvidence saveCredential createMaterial setupMaterials updateMaterial approveMaterial".split(
    " ",
  );
const financeNames =
  "newClose reviewClose refreshClose publishClose saveCloseDraft saveImportTemplate deleteImportTemplate prepareStatementDelivery recordStatementDelivery cancelStatementDelivery".split(
    " ",
  );
const publicationNames =
  "createPublication reviewPublication publishDocument withdrawPublication".split(
    " ",
  );
const workflowActions: Record<string, { group: string; fields: string[] | null; target: boolean }> = {
  startWaiting: { group: "tasks", fields: ["reason", "detail", "since"], target: true },
  resolveWaiting: { group: "tasks", fields: ["until", "resolution"], target: true },
  recordOwnership: { group: "company", fields: ["effectiveFrom", "members", "reason"], target: true },
  prepareDelivery: { group: "production", fields: ["documentId", "recipientName", "recipientEmail", "recipientRole", "method", "reviewNote"], target: false },
  recordDelivery: { group: "production", fields: ["deliveredOn", "deliveryReference", "deliveryNote"], target: true },
  recordDeliveryFailure: { group: "production", fields: ["failedOn", "failureReason"], target: true },
  retryDelivery: { group: "production", fields: ["recipientEmail", "method", "reviewNote"], target: true },
  cancelDelivery: { group: "production", fields: null, target: true },
};
function validateWorkflowCommand(cmd: WorkspaceCommand) {
  const spec = workflowActions[cmd.name];
  if (cmd.args.length !== (spec.target ? 2 : 1)) fail("Invalid workflow arguments.");
  if (spec.target) nonempty(cmd.args[0], "workflow record");
  const input = cmd.args[spec.target ? 1 : 0];
  if (!spec.fields) { nonempty(input, "cancellation reason"); return; }
  const fields = object(input);
  keys(fields, spec.fields);
  for (const key of spec.fields) {
    if (cmd.name === "recordOwnership" && key === "members") {
      if (!Array.isArray(fields.members)) fail("Enter ownership members.");
      for (const member of fields.members) {
        const value = object(member);
        keys(value, ["name", "share"]);
        nonempty(value.name, "member name");
        if (typeof value.share !== "number" || !Number.isFinite(value.share)) fail("Enter a valid ownership interest.");
      }
    } else if (typeof fields[key] !== "string" || fields[key].length > 20000) {
      fail(`Invalid workflow field: ${key}.`);
    }
  }
}
const handlers = { ...B, ...P, ...FP, ...M, ...F, ...S, ...T, ...D, ...O, ...OR, executeRules };
function dispatch(name: string, state: Workspace, args: unknown[]) {
  const handler = handlers[name as keyof typeof handlers];
  if (typeof handler !== "function") fail("Unknown action.");
  Reflect.apply(handler, handlers, [state, ...args]);
}
function referencesHidden(value: unknown, hidden: Set<string>): boolean {
  if (typeof value === "string")
    return [...hidden].some(
      (id) =>
        value === id ||
        value.includes('"' + id + '"') ||
        value.includes('\\"' + id + '\\"'),
    );
  if (value && typeof value === "object")
    return Object.values(value).some((v) => referencesHidden(v, hidden));
  return false;
}
function requireReadableReferences(
  s: Workspace,
  cmd: WorkspaceCommand,
  a: Access,
) {
  if(!a.restricted && ["saveCompanyUnderwriters","saveApplication","recordOnboardingEvidence","addHandoff"].includes(cmd.name)) fail("Restricted onboarding access is required.",403);
  const visible = projectWorkspace(s, a),
    hidden = new Set<string>();
  for (const table of recordTables) {
    const ids = new Set(collection(visible, table).map(rowId));
    for (const row of collection(s, table))
      if (row.id && !ids.has(rowId(row))) hidden.add(row.id);
  }
  if (referencesHidden(cmd.args, hidden))
    fail("This action references a record outside your access.", 403);
  if ((OR.orchestrationActionNames as readonly string[]).includes(cmd.name)) {
    const value = typeof cmd.args[0] === "string"
      ? s.orchestration!.proposals.find(p => p.id === cmd.args[0]) : object(cmd.args[0]);
    const companyId = value?.companyId || s.orders.find(o => o.id === value?.orderId)?.companyId;
    if (typeof companyId !== "string" || !companyId || !canCompany(a, companyId)) fail("This company is outside your access.", 403);
    // A restricted historical profile can affect current selection. Do not replay
    // a command against hidden configuration that the operator could not review.
    for (const table of recordTables.filter(t => t.startsWith("orchestration.")))
      if (collection(s, table).some(r => r.companyId === companyId && hidden.has(rowId(r))))
        fail("This company's integration evidence requires restricted access.", 403);
  }
}

export function executeCommands(
  before: Workspace,
  commands: WorkspaceCommand[],
  a: Access,
): Workspace {
  if (!Array.isArray(commands) || !commands.length || commands.length > 100)
    fail("Submit between 1 and 100 actions.");
  safePayload(commands);
  const next = normalizeWorkspace(before);
  next.user = a.email;
  for (const cmd of commands) {
    object(cmd);
    if (
      typeof cmd.id !== "string" ||
      !/^[a-f\d-]{36}$/i.test(cmd.id) ||
      typeof cmd.name !== "string" ||
      !Array.isArray(cmd.args)
    )
      fail("Invalid command.");
    requireReadableReferences(next, cmd, a);
    const prior = structuredClone(next);
    const timestamp = new Date().toISOString();
    withCommandIds(cmd.id, () => {
      if (cmd.name === "editDraft") {
        if (!Array.isArray(cmd.args[0])) fail("Invalid draft edits.");
        for (const edit of cmd.args[0] as DraftEdit[])
          applyEdit(next, edit, a, prior, timestamp);
      } else if ((OR.orchestrationActionNames as readonly string[]).includes(cmd.name)) {
        const configuration = ["saveCompanyProfile", "saveExternalFieldMap", "setOrchestrationControl", "attestReadiness"].includes(cmd.name);
        permit(a, configuration ? "admin" : "production");
        if (cmd.name === "saveCompanyProfile" && !(a.role === "owner" || (a.role === "admin" && a.allCompanies)))
          fail("Organization-wide administrator access is required for company mappings.", 403);
        const targeted = ["reviewExternalProposal", "recordExternalOutcome"].includes(cmd.name);
        if (cmd.args.length !== (targeted ? 2 : 1)) fail("Invalid orchestration arguments.");
        workflowError(() => dispatch(cmd.name, next, structuredClone(cmd.args)));
      } else if (["saveFinalPreparation", "reviewFinalPreparation", "prepareFinalHandoff"].includes(cmd.name)) {
        permit(a, "production");
        const count = cmd.name === "saveFinalPreparation" || cmd.name === "reviewFinalPreparation" ? 4 : 3;
        if (cmd.args.length !== count || typeof cmd.args[0] !== "string") fail("Invalid final preparation arguments.");
        const visible = projectWorkspace(next, a);
        const order = visible.orders.find(o => o.id === cmd.args[0]);
        if (!order || !canCompany(a, order.companyId)) fail("This title file is outside your access.", 403);
        if (cmd.name === "saveFinalPreparation") {
          const input = cmd.args[1];
          if (!FP.finalPreparationInputShapeValid(input)) fail("Invalid final preparation worksheet.");
          for (const id of [input.issuingCompanyId, input.referringCompanyId])
            if (id && !visible.companies.some(c => c.id === id)) fail("This company is outside your access.", 403);
          for (const product of input.products)
            if (!visible.business?.policies.some(p => p.id === product.policyId && p.orderId === order.id))
              fail("Choose a policy product belonging to this title file.", 403);
        }
        workflowError(() => dispatch(cmd.name, next, structuredClone(cmd.args)));
      } else if (cmd.name === "loadDemoScenario") {
        permitWorkspaceAdmin(a);
        B.loadDemoScenario(next);
      } else if (cmd.name === "addHandoff") {
        permit(a, "company");
        const v = object(cmd.args[0]);
        if (
          v.kind !== "Application packet" ||
          v.orderId ||
          v.sourceId !== v.companyId
        )
          fail("Unsupported handoff creation.");
        const c = next.companies.find((c) => c.id === v.companyId);
        if (!c) fail("Choose a company.");
        const app = B.getOnboarding(next, c);
        if (app.applicationStatus === "Not started")
          fail("Prepare the application first.");
        B.addHandoff(next, {
          kind: "Application packet",
          subject: `Application packet · ${c.name}`,
          companyId: c.id,
          orderId: "",
          sourceId: c.id,
          fingerprint: B.applicationFingerprint(next, c),
        });
      } else {
        const workflow = workflowActions[cmd.name];
        const group = workflow?.group || (productionNames.includes(cmd.name)
          ? "production"
          : companyNames.includes(cmd.name)
            ? "company"
            : financeNames.includes(cmd.name)
              ? "finance"
              : publicationNames.includes(cmd.name)
                ? "publication"
                : cmd.name === "executeRules"
                  ? "admin"
                  : "");
        if (!group) fail("Unknown action.");
        permit(a, group);
        if (["saveImportTemplate", "deleteImportTemplate"].includes(cmd.name) && !a.allCompanies)
          fail("An organization-wide finance account must manage shared import templates.", 403);
        if (cmd.name === "executeRules") permitWorkspaceAdmin(a);
        if (workflow) validateWorkflowCommand(cmd);
        const args = structuredClone(cmd.args);
        if (cmd.name === "reviewCommitment") {
          const o = next.orders.find((o) => o.id === object(args[0]).id);
          if (!o) fail("File not found.");
          args[0] = o;
        }
        if (cmd.name === "saveCredential") {
          const v = object(args[0]);
          v.reviewer = a.email;
        }
        if (workflow) workflowError(() => dispatch(cmd.name, next, args));
        else dispatch(cmd.name, next, args);
        if (workflow && cmd.name.includes("Delivery")) {
          const visible = new Set(projectWorkspace(prior, a).documents.map(d => d.id));
          for (const delivery of next.deliveries || []) {
            const previous = prior.deliveries!.find(r => r.id === delivery.id);
            if (!eq(previous, delivery) && !visible.has(delivery.documentId))
              fail("The delivery source is outside your access.", 403);
          }
        }
      }
      for (const task of next.tasks) {
        const previous = prior.tasks.find(t => t.id === task.id);
        if (!previous) task.createdAt = timestamp;
        else if (task.createdAt !== previous.createdAt) fail("Task creation time cannot be changed.");
      }
      workflowError(() => recordFieldReviewChanges(prior, next, a.email, timestamp));
      B.validateBusinessMutation(prior, next);
      workflowError(() => FP.validateFinalPreparationMutation(prior, next));
      immutableHistory(prior, next);
      ensureShape(next);
      checkScope(prior, next, a);
    });
  }
  next.user = a.email;
  return next;
}

export function projectWorkspace(source: Workspace, a: Access): Workspace {
  const s = normalizeWorkspace(source);
  delete s.partnerSummary;
  s.user = a.email;
  s.activity = [];
  if (a.role === "partner") {
    const result = emptyWorkspace(a.email);
    result.rules = [];
    for (const grant of a.partnerMembers) {
      const c = s.companies.find((c) => c.id === grant.companyId);
      if (
        !c ||
        !canCompany(a, c.id) ||
        !c.members.some((m) => m.name === grant.memberName)
      )
        continue;
      const existingCompany = result.companies.find((x) => x.id === c.id);
      if (existingCompany) {
        if (!existingCompany.members.some((m) => m.name === grant.memberName))
          existingCompany.members.push(
            ...c.members.filter((m) => m.name === grant.memberName),
          );
      } else
        result.companies.push({
          ...c,
          desk: undefined,
          stage: companyDisplayStage(c),
          operatingStatus: undefined,
          contact: "",
          email: "",
          authorizations: [],
          members: c.members.filter((m) => m.name === grant.memberName),
          steps: [],
        });
      const pubs = M.partnerPublications(s, c.id, grant.memberName);
      for (const p of pubs)
        if (!result.materials!.publications.some((x) => x.id === p.id)) {
          result.materials!.publications.push({
            ...p,
            reviewNote: "",
            reviewedBy: "",
            reviewSnapshot: "",
            history: [],
            memberNames: [grant.memberName],
          });
          const doc = s.documents.find((d) => d.id === p.documentId)!;
          if (!result.documents.some((d) => d.id === doc.id))
            result.documents.push({
              id: doc.id,
              name: doc.name,
              category: doc.category,
              size: doc.size,
              mime: doc.mime,
              companyId: doc.companyId,
              date: doc.date,
              version: doc.version,
              visibility: doc.visibility,
              assetId: doc.assetId,
            });
        }
      for (const p of B.business(s).closes.filter(
        (p) => p.companyId === c.id && p.status === "Published",
      )) {
        const allocation = p.allocations.find(
          (x) => x.name === grant.memberName,
        );
        if (!allocation) continue;
        const existingClose = result.business!.closes.find(
          (x) => x.id === p.id,
        );
        if (existingClose) {
          if (
            !existingClose.allocations.some((x) => x.name === allocation.name)
          ) {
            existingClose.allocations.push(allocation);
            existingClose.members.push(
              ...p.members.filter((m) => m.name === grant.memberName),
            );
          }
          continue;
        }
        result.business!.closes.push({
          ...p,
          rows: [],
          members: p.members.filter((m) => m.name === grant.memberName),
          allocations: [allocation],
          expenses: 0,
          adjustment: 0,
          reserve: 0,
          externalPremium: 0,
          externalRemittance: 0,
          booksReference: "",
          agreementReference: "",
          sourceHash: "",
          note: "",
          reviewedBy: "",
          totals: {
            premium: 0,
            remittance: 0,
            retained: 0,
            profit: 0,
            available: 0,
          },
        });
      }
    }
    result.partnerSummary = projectPartnerSummary(source, a);
    return result;
  }
  const originalRecords = new Map(recordTables.map(table => [table, collection(s, table)]));
  for (const table of recordTables) {
    replaceCollection(s, table, collection(s, table).filter((r) => {
      const id = companyOf(source, table, r);
      return id ? canCompany(a, id) : admin(a);
    }));
  }
  const hidden = new Set<string>();
  for (const order of s.orders) {
    const input = order.finalPreparation?.input;
    if (input && [input.issuingCompanyId, input.referringCompanyId].some(id => id && !canCompany(a, id))) hidden.add(order.id);
  }
  if (productionOnlyRole(a.role)) {
    s.companies = s.companies.map(productionCompany);
    s.documents = s.documents.filter(document => productionDocument(s, document));
    s.inbox = s.inbox.filter(message => productionMessage(s, message));
    s.tasks = s.tasks.filter(task => productionTask(s, task));
    s.business!.onboarding = [];
    s.business!.credentials = [];
    s.business!.closes = [];
    s.business!.handoffs = s.business!.handoffs.filter(handoff => handoff.kind !== "Application packet" && !!handoff.orderId);
    s.ownershipHistory = [];
    s.statementDeliveries = [];
    s.materials = { version: 1, items: [], publications: [] };
    s.expansionStates = [];
    // Source snapshots and dependent production records must not carry hidden
    // agency evidence back through a different collection or asset endpoint.
    for (const table of recordTables.filter(table => table !== "companies")) {
      const visibleIds = new Set(collection(s, table).map(rowId));
      for (const row of originalRecords.get(table)!)
        if (row.id && !visibleIds.has(rowId(row))) hidden.add(row.id);
    }
  }
  if (!a.restricted) {
    for (const id of source.documents
        .filter((d) => d.visibility === "Restricted")
        .flatMap((d) => [d.id, ...(d.orderId ? [d.orderId] : [])])) hidden.add(id);
    s.documents = s.documents.filter((d) => !hidden.has(d.id));
    s.business!.onboarding = [];
    s.business!.handoffs=s.business!.handoffs.filter(h=>h.kind!=="Application packet");
  }
  if (hidden.size) {
    const integrationTables = recordTables.filter((t): t is `orchestration.${Exclude<keyof OR.OrchestrationState, "version">}` => t.startsWith("orchestration."));
    const hiddenCompanies = new Set<string>();
    // Repeat until both evidence references and complete integration histories
    // are closed over the hidden records. Each pass only removes records.
    let changed = true;
    while (changed) {
      changed = false;
      for (const table of recordTables.filter((t) => t !== "companies")) {
        replaceCollection(s, table, collection(s, table).filter((r) => {
          if (referencesHidden(r, hidden)) {
            hidden.add(rowId(r));
            changed = true;
            return false;
          }
          return true;
        }));
      }
      // A partial ledger could expose a misleading old profile or invalid
      // revision sequence. Withhold the company's complete integration history.
      for (const table of integrationTables) {
        const visibleIds = new Set(collection(s, table).map(rowId));
        for (const row of originalRecords.get(table)!)
          if (row.companyId && canCompany(a, row.companyId) && !visibleIds.has(rowId(row))) hiddenCompanies.add(row.companyId);
      }
      for (const table of integrationTables) {
        replaceCollection(s, table, collection(s, table).filter(row => {
          if (!hiddenCompanies.has(row.companyId)) return true;
          hidden.add(row.id);
          changed = true;
          return false;
        }));
      }
      // Removing another file's private evidence can remove this file's safe
      // proposal too. Never leave a file looking ready while its unresolved
      // external-change blocker exists only in the canonical server state.
      for (const proposal of source.orchestration?.proposals || []) {
        if (hiddenCompanies.has(proposal.companyId) &&
            ["Pending review", "Exception", "Approved"].includes(proposal.status) &&
            !proposal.outcome && !hidden.has(proposal.orderId)) {
          hidden.add(proposal.orderId);
          changed = true;
        }
      }
    }
  }
  if (!admin(a) && a.role !== "finance") {
    s.business!.closes = [];
    s.expenses = {};
    s.approvedReports = [];
    s.statementDeliveries = [];
    s.importTemplates = [];
  } else
    s.expenses = Object.fromEntries(
      Object.entries(s.expenses).filter(([key]) => canCompany(a, key.slice(8))),
    );
  if (!a.allCompanies) {
    s.approvedReports = [];
    s.importTemplates = [];
  }
  // Dependency pruning may have removed the file behind a generated task.
  if (productionOnlyRole(a.role)) s.tasks = s.tasks.filter(task => productionTask(s, task));
  if (!workspaceAdmin(a)) s.rules = [];
  return s;
}
export function allowedAsset(source: Workspace, a: Access, assetId: string) {
  return projectWorkspace(source, a).documents.find(
    (d) => d.assetId === assetId,
  );
}
