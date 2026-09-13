import { traceMutation, commandUuid } from "./command-log";
import type { Field, Order, VaultDoc, Workspace } from "./model";

export type SourceRole =
  | "Final opinion"
  | "Deed"
  | "Deed of trust"
  | "Mortgage"
  | "Preliminary opinion"
  | "Prior policy"
  | "Search package"
  | "Revised commitment"
  | "Commitment output"
  | "Final policy"
  | "CPL"
  | "Correction output"
  | "Other";
export const sourceRoles: SourceRole[] = [
  "Final opinion",
  "Deed",
  "Deed of trust",
  "Mortgage",
  "Preliminary opinion",
  "Prior policy",
  "Search package",
  "Revised commitment",
  "Commitment output",
  "Final policy",
  "CPL",
  "Correction output",
  "Other",
];
export type TitleRequirement = {
  id: string;
  text: string;
  kind: "Requirement" | "Exception";
  status: "Open" | "Satisfied" | "Retained" | "Excluded";
  evidence: string;
  note: string;
};
export type ReferencedSourceRole = "Prior policy" | "Search package" | "Other";
export type ReferencedSourceReview = {
  decision: "Reviewed" | "Not applicable";
  documentId: string;
  documentVersion: number;
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
};
export type ReferencedSource = {
  id: string;
  wording: string;
  role: ReferencedSourceRole;
  required: boolean;
  createdBy: string;
  createdAt: string;
  reviews: ReferencedSourceReview[];
};
export type TitleFile = {
  referencedSources?: ReferencedSource[];
  securityInstrument?: "Deed of trust" | "Mortgage";
  commitmentReview?: {
    note: string;
    snapshot: string;
    reviewer: string;
    at: string;
  };
  version: number;
  financing: "Financed" | "Cash";
  loanAmount: number;
  purchasePrice: number;
  county: string;
  attorney: string;
  attorneyEmail: string;
  lender: string;
  seller: string;
  legalDescription: string;
  commitmentReference: string;
  cplDecision: "Review required" | "Requested" | "Not requested";
  cplReference: string;
  priorPolicyReference: string;
  requirements: TitleRequirement[];
};
export type RevisionRequest = {
  id: string;
  companyId: string;
  orderId: string;
  messageId: string;
  text: string;
  before: number;
  proposed: number;
  baseVersion: number;
  /**
   * Which active Loan-kind PolicyProduct this revision targets. Empty string
   * means "no specific loan" — the legacy behavior for a file with at most
   * one active loan, where the file-level TitleFile.loanAmount stands in for
   * "the" loan amount. A file with more than one active loan has no single
   * "the loan amount", so it must name one explicitly; see activeLoans().
   */
  productId: string;
  /** The targeted product's own PolicyProduct.version at capture/recheck time, used to detect staleness scoped to that product on a multi-loan file (see applyRevision). Unused (0) when productId is empty. */
  productVersion: number;
  status: "Needs review" | "Applied" | "Needs information";
  note: string;
  createdAt: string;
};
/**
 * Commitment-level title-file fields that can be changed through a reviewed
 * field revision (see FieldRevision). Deliberately a fixed, small list: these
 * are the plain-text facts a lender/attorney routinely corrects by email.
 * Coverage, endorsements, policy forms and loan amounts are NOT here — loan
 * amount has its own numeric RevisionRequest flow, and the rest still need a
 * separate professional review.
 */
export const revisableFields = [
  { id: "lender", label: "Lender" },
  { id: "seller", label: "Seller" },
  { id: "legalDescription", label: "Legal description" },
  { id: "county", label: "County" },
  { id: "attorney", label: "Attorney" },
  { id: "attorneyEmail", label: "Attorney email" },
] as const;
export type RevisableField = (typeof revisableFields)[number]["id"];
export const revisableFieldLabel = (id: RevisableField) =>
  revisableFields.find((f) => f.id === id)!.label;
/**
 * A reviewed change to one text field of the title file — the non-amount
 * counterpart of RevisionRequest, kept as its own record type (rather than
 * overloading RevisionRequest's numeric before/proposed) so the loan-amount
 * flow and everything that reads it stay exactly as they were.
 */
export type FieldRevision = {
  id: string;
  companyId: string;
  orderId: string;
  messageId: string;
  text: string;
  field: RevisableField;
  before: string;
  proposed: string;
  baseVersion: number;
  status: "Needs review" | "Applied" | "Needs information";
  note: string;
  createdAt: string;
};
export type ReplyDraft = {
  fileVersion: number;
  id: string;
  orderId: string;
  revisionId: string;
  to: string;
  subject: string;
  body: string;
  attachmentId: string;
  status: "Awaiting document" | "Ready for review" | "Approved locally";
  createdAt: string;
};
export type FinalFieldDef = { id: string; label: string; role: SourceRole };
export const fieldDefinitions: FinalFieldDef[] = [
  { id: "name", label: "Vesting / grantee name", role: "Deed" },
  { id: "deedDated", label: "Deed dated date", role: "Deed" },
  { id: "date", label: "Deed recording date", role: "Deed" },
  { id: "time", label: "Deed recording time", role: "Deed" },
  { id: "reference", label: "Deed book / page", role: "Deed" },
  { id: "loanAmount", label: "Confirmed loan amount", role: "Deed of trust" },
  { id: "dotDated", label: "Deed of trust dated date", role: "Deed of trust" },
  {
    id: "dotDate",
    label: "Deed of trust recording date",
    role: "Deed of trust",
  },
  {
    id: "dotTime",
    label: "Deed of trust recording time",
    role: "Deed of trust",
  },
  {
    id: "dotReference",
    label: "Deed of trust book / page",
    role: "Deed of trust",
  },
  { id: "trustee", label: "Trustee wording", role: "Deed of trust" },
];
export function titleFile(order: Order): TitleFile {
  return (
    order.production || {
      version: 1,
      financing: "Financed",
      loanAmount: 0,
      purchasePrice: 0,
      county: "",
      attorney: "",
      attorneyEmail: "",
      lender: "",
      seller: "",
      legalDescription: "",
      commitmentReference: "",
      cplDecision: "Review required",
      cplReference: "",
      priorPolicyReference: "",
      requirements: [],
    }
  );
}
export function neededFields(order: Order) {
  return fieldDefinitions
    .filter(
      (f) =>
        (f.role !== "Deed" || order.type !== "Refinance") &&
        (f.role !== "Deed of trust" ||
          titleFile(order).financing === "Financed") &&
        (f.id !== "trustee" ||
          titleFile(order).securityInstrument !== "Mortgage"),
    )
    .map((f) =>
      f.role === "Deed of trust" &&
      titleFile(order).securityInstrument === "Mortgage"
        ? {
            ...f,
            role: "Mortgage" as SourceRole,
            label: f.label
              .replace("Deed of trust", "Mortgage")
              .replace("deed of trust", "mortgage"),
          }
        : f,
    );
}
export const outputRoles: SourceRole[] = [
  "Revised commitment",
  "Commitment output",
  "Final policy",
  "CPL",
  "Correction output",
];
export function sameDocumentFamily(a: VaultDoc, b: VaultDoc) {
  return (
    a.companyId === b.companyId &&
    a.orderId === b.orderId &&
    a.name === b.name &&
    ((!outputRoles.includes(a.sourceRole!) &&
      !outputRoles.includes(b.sourceRole!)) ||
      (a.sourceRole === b.sourceRole &&
        a.policyId === b.policyId &&
        a.cplId === b.cplId &&
        a.correctionId === b.correctionId))
  );
}
export function orderSources(s: Workspace, id: string) {
  const order = s.orders.find((o) => o.id === id);
  if (!order) return [];
  let docs = s.documents.filter(
    (d) => d.orderId === id && d.companyId === order.companyId && d.sourceRole,
  );
  docs = docs.filter(
    (d) =>
      !docs.some(
        (next) => sameDocumentFamily(next, d) && next.version > d.version,
      ),
  );
  const passes = docs.length;
  for (let i = 0; i <= passes; i++) {
    const next = docs.filter(
      (d) =>
        !d.parentDocumentId ||
        docs.some((parent) => parent.id === d.parentDocumentId),
    );
    if (next.length === docs.length) break;
    docs = next;
  }
  return docs;
}
export function productionLocked(s: Workspace, order: Order) {
  return (
    order.status === "Issued" ||
    !!s.business?.policies.some(
      (p) =>
        p.orderId === order.id && ["Issued", "Delivered"].includes(p.status),
    )
  );
}
export function referencedSourceStatus(s: Workspace, o: Order, source: ReferencedSource) {
  const review = source.reviews.at(-1);
  if (!review) return "Pending" as const;
  if (review.decision === "Not applicable") return "Not applicable" as const;
  return orderSources(s, o.id).some(d =>
    d.id === review.documentId && d.version === review.documentVersion &&
    (source.role === "Other" || d.sourceRole === source.role),
  ) ? "Reviewed" as const : "Source changed" as const;
}
export function referencedSourceProblems(s: Workspace, o: Order) {
  return (titleFile(o).referencedSources || []).filter(source =>
    source.required && ["Pending", "Source changed"].includes(referencedSourceStatus(s, o, source)),
  );
}
function referenceOrder(s: Workspace, orderId: string) {
  const o = s.orders.find(o => o.id === orderId);
  if (!o || o.status === "Rejected" || productionLocked(s, o))
    throw new Error("Choose an active, unissued file for source review.");
  return o;
}
function invalidateReferenceReview(o: Order) {
  o.production = { ...titleFile(o), version: titleFile(o).version + 1, commitmentReview: undefined };
  if (o.status === "Ready for jacket") o.status = "Needs review";
}
export function addReferencedSource(s: Workspace, orderId: string, input: {
  wording: string; role: ReferencedSourceRole; required: boolean;
}) {
  return traceMutation(s, "addReferencedSource", [orderId, input], () => {
    const o = referenceOrder(s, orderId);
    if (!input || typeof input.wording !== "string" || !input.wording.trim() || input.wording.length > 5000 ||
      !["Prior policy", "Search package", "Other"].includes(input.role) || typeof input.required !== "boolean")
      throw new Error("Record the original reference wording, source type and whether it is required.");
    const existing = titleFile(o).referencedSources || [];
    const duplicate = existing.find(r => r.wording === input.wording && r.role === input.role && r.required === input.required);
    if (duplicate) return duplicate;
    if (existing.length >= 100) throw new Error("This file already has 100 source references.");
    const source: ReferencedSource = {
      id: commandUuid(), wording: input.wording, role: input.role, required: input.required,
      createdBy: s.user, createdAt: new Date().toISOString(), reviews: [],
    };
    o.production = { ...titleFile(o), referencedSources: [...existing, source] };
    invalidateReferenceReview(o);
    return source;
  });
}
export function reviewReferencedSource(s: Workspace, orderId: string, referenceId: string, input: {
  decision: "Reviewed" | "Not applicable"; documentId: string; documentVersion: number; rationale: string;
}) {
  return traceMutation(s, "reviewReferencedSource", [orderId, referenceId, input], () => {
    const o = referenceOrder(s, orderId);
    const source = titleFile(o).referencedSources?.find(r => r.id === referenceId);
    if (!source) throw new Error("Choose a source reference from this file.");
    if (!input || !["Reviewed", "Not applicable"].includes(input.decision) ||
      typeof input.rationale !== "string" || !input.rationale.trim() || input.rationale.length > 5000)
      throw new Error("Record a review decision and rationale.");
    if (input.decision === "Reviewed" && !orderSources(s, o.id).some(d =>
      d.id === input.documentId && d.version === input.documentVersion &&
      (source.role === "Other" || d.sourceRole === source.role),
    )) throw new Error("Choose the current referenced document and version from this file.");
    const review: ReferencedSourceReview = {
      decision: input.decision,
      documentId: input.decision === "Reviewed" ? input.documentId : "",
      documentVersion: input.decision === "Reviewed" ? input.documentVersion : 0,
      rationale: input.rationale.trim(), reviewedBy: s.user, reviewedAt: new Date().toISOString(),
    };
    source.reviews.push(review);
    invalidateReferenceReview(o);
    return review;
  });
}
export function referencedSourcesShapeValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 100) return false;
  const text = (v: unknown, max = 5000) => typeof v === "string" && !!v.trim() && v.length <= max;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const ids = new Set<string>();
  return value.every(r => {
    if (!r || !text(r.id, 150) || ids.has(r.id) || !text(r.wording) ||
      !["Prior policy", "Search package", "Other"].includes(r.role) || typeof r.required !== "boolean" ||
      !text(r.createdBy, 500) || !date(r.createdAt) || !Array.isArray(r.reviews)) return false;
    ids.add(r.id);
    return r.reviews.every((review: ReferencedSourceReview) => review &&
      ["Reviewed", "Not applicable"].includes(review.decision) && text(review.rationale) &&
      text(review.reviewedBy, 500) && date(review.reviewedAt) &&
      (review.decision === "Reviewed"
        ? text(review.documentId, 150) && Number.isInteger(review.documentVersion) && review.documentVersion > 0
        : review.documentId === "" && review.documentVersion === 0));
  });
}
export function validateReferencedSourcesMutation(before: Workspace, after: Workspace) {
  if (after.orders.some(o => !referencedSourcesShapeValid(titleFile(o).referencedSources)))
    throw new Error("The referenced-source checklist contains invalid records.");
  for (const o of before.orders) {
    const current = after.orders.find(n => n.id === o.id);
    for (const old of titleFile(o).referencedSources || []) {
      const next = current && titleFile(current).referencedSources?.find(r => r.id === old.id);
      const capture = ({ reviews: _reviews, ...rest }: ReferencedSource) => rest;
      if (!next || JSON.stringify(capture(old)) !== JSON.stringify(capture(next)) ||
        JSON.stringify(next.reviews.slice(0, old.reviews.length)) !== JSON.stringify(old.reviews))
        throw new Error("Preserve the original source reference and its review history. Record a new decision instead.");
    }
  }
}
export function commitmentSnapshot(s: Workspace, o: Order) {
  const p = titleFile(o);
  return JSON.stringify({
    ...(p.referencedSources?.length ? { referencedSources: p.referencedSources } : {}),
    sources: orderSources(s, o.id)
      .filter((d) => !outputRoles.includes(d.sourceRole!))
      .map((d) => [d.id, d.version, d.sourceRole])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    requirements: p.requirements,
    commitment: p.commitmentReference,
    prior: p.priorPolicyReference,
    financing: p.financing,
    loan: p.loanAmount,
    county: p.county,
  });
}
export function reviewCommitment(s: Workspace, o: Order, note: string) {
  return traceMutation(s, "reviewCommitment", [o, note], () => {
    if (!note.trim())
      throw new Error(
        "Document the commitment review, including a no-items decision when applicable.",
      );
    o.production = {
      ...titleFile(o),
      commitmentReview: {
        note: note.trim(),
        snapshot: commitmentSnapshot(s, o),
        reviewer: s.user,
        at: new Date().toISOString(),
      },
    };
  });
}

export function requiredSources(order: Order): SourceRole[] {
  return [
    "Final opinion",
    ...(order.type !== "Refinance" ? ["Deed" as const] : []),
    ...(titleFile(order).financing === "Financed"
      ? [titleFile(order).securityInstrument || "Deed of trust"]
      : []),
  ];
}
export function finalReadiness(s: Workspace, order: Order) {
  const sources = orderSources(s, order.id);
  const missingSources = requiredSources(order).filter(
    (role) => !sources.some((d) => d.sourceRole === role),
  );
  const pendingFields = neededFields(order).filter((def) => {
    const f = order.fields.find((x) => x.id === def.id);
    return (
      !f ||
      !f.proposed.trim() ||
      !f.reviewed ||
      !f.documentId ||
      !sources.some((d) => d.id === f.documentId && d.sourceRole === def.role)
    );
  });
  const p = titleFile(order);
  const missingContext = [
    ...referencedSourceProblems(s, order).map(r => `referenced source: ${r.wording}`),
    ...((s.business?.followups || []).some(
      (r) =>
        r.orderId === order.id && !["Resolved", "Cancelled"].includes(r.status),
    )
      ? ["outstanding attorney follow-up"]
      : []),
    ...(!p.county.trim() ? ["county"] : []),
    ...(!p.attorney.trim() ? ["attorney"] : []),
    ...(!p.commitmentReference.trim() ? ["commitment reference"] : []),
    ...(!p.commitmentReview?.note.trim() ||
    p.commitmentReview.snapshot !== commitmentSnapshot(s, order)
      ? ["commitment review"]
      : []),
    ...(p.financing === "Financed" && (!p.lender.trim() || p.loanAmount <= 0)
      ? ["lender and positive loan amount"]
      : []),
  ];
  const sourceLoan =
    order.fields.find((f) => f.id === "loanAmount")?.proposed || "";
  const parsedLoan = Number(sourceLoan.replace(/[$,\s]/g, ""));
  const loanMismatch =
    p.financing === "Financed" &&
    (!sourceLoan.trim() ||
      !Number.isFinite(parsedLoan) ||
      Math.abs(parsedLoan - p.loanAmount) > 0.005);
  const unresolved = p.requirements.filter(
    (r) =>
      !r.text.trim() ||
      (r.kind === "Requirement"
        ? r.status !== "Satisfied" || !r.evidence.trim()
        : r.status === "Open" || !r.note.trim()),
  );
  return {
    missingSources,
    pendingFields,
    unresolved,
    missingContext,
    loanMismatch,
    ready:
      !missingSources.length &&
      !pendingFields.length &&
      !unresolved.length &&
      !missingContext.length &&
      !loanMismatch &&
      !order.exception,
  };
}
export function replaceSourceFields(
  s: Workspace,
  orderId: string,
  docId: string,
  values: Record<string, string>,
  page: string,
) {
  return traceMutation(
    s,
    "replaceSourceFields",
    [orderId, docId, values, page],
    () => {
      const o = s.orders.find((x) => x.id === orderId);
      const doc = s.documents.find((d) => d.id === docId);
      if (!o || !doc || doc.orderId !== o.id || doc.companyId !== o.companyId)
        throw new Error(
          "Select a source document from this company and order.",
        );
      if (o.status === "Issued")
        throw new Error("Issued files require a separate correction workflow.");
      const defs = neededFields(o).filter((f) => f.role === doc.sourceRole);
      if (
        !defs.length ||
        defs.some((f) => !values[f.id]?.trim()) ||
        !page.trim()
      )
        throw new Error("Capture every source value and a page reference.");
      for (const def of defs) {
        const prior = o.fields.find((f) => f.id === def.id);
        const field: Field = {
          id: def.id,
          label: def.label,
          current: prior?.current || "Not captured",
          proposed: values[def.id].trim(),
          sourceValue: values[def.id].trim(),
          source: `${doc.name} · ${page.trim()}`,
          documentId: doc.id,
          sourcePage: page.trim(),
          reviewed: false,
          confidence: "Human captured",
        };
        o.fields = o.fields.filter((f) => f.id !== def.id);
        o.fields.push(field);
      }
      o.status = "Needs review";
      o.production = { ...titleFile(o), version: titleFile(o).version + 1 };
    },
  );
}
export function createRevision(
  s: Workspace,
  input: {
    companyId: string;
    orderId: string;
    messageId: string;
    text: string;
    proposed: number;
    /** Required when the file has more than one active loan (see activeLoans). Ignored otherwise — the sole loan, if any, is targeted automatically. */
    productId?: string;
  },
): RevisionRequest {
  return traceMutation(s, "createRevision", [input], () => {
    const o = s.orders.find(
      (o) => o.id === input.orderId && o.companyId === input.companyId,
    );
    if (!o) throw new Error("Confirm the company and matching file.");
    assertRevisionContext(s, o, input.messageId);
    if (
      ["Issued", "Rejected"].includes(o.status) ||
      titleFile(o).financing === "Cash"
    )
      throw new Error("Choose an active financed order.");
    if (
      !input.text.trim() ||
      !Number.isFinite(input.proposed) ||
      input.proposed <= 0 ||
      input.proposed > 100000000
    )
      throw new Error("Enter the source request and a valid loan amount.");
    if (
      input.messageId &&
      s.revisions.some(
        (r) =>
          r.messageId === input.messageId && r.status !== "Needs information",
      )
    )
      throw new Error("This message already has a revision request.");
    const loans = activeLoans(s, o.id);
    let productId = "";
    let before = titleFile(o).loanAmount;
    let productVersion = 0;
    if (loans.length > 1) {
      const target = loans.find((l) => l.id === input.productId);
      if (!target)
        throw new Error(
          "Multiple loans are active on this file. Choose which loan this revision applies to.",
        );
      productId = target.id;
      before = target.loanAmount;
      productVersion = target.version;
    } else if (loans[0]) {
      productId = loans[0].id;
      before = loans[0].loanAmount;
      productVersion = loans[0].version;
    }
    const p = titleFile(o);
    const request: RevisionRequest = {
      ...input,
      id: `revision-${commandUuid()}`,
      productId,
      productVersion,
      before,
      baseVersion: p.version,
      status: "Needs review",
      note: "",
      createdAt: new Date().toISOString(),
    };
    s.revisions.unshift(request);
    return request;
  });
}
export function applyRevision(s: Workspace, id: string, confirmed: boolean) {
  return traceMutation(s, "applyRevision", [id, confirmed], () => {
    const r = s.revisions.find((r) => r.id === id);
    if (!r || r.status !== "Needs review" || !confirmed)
      throw new Error("Review and confirm the request first.");
    const o = s.orders.find(
      (o) => o.id === r.orderId && o.companyId === r.companyId,
    );
    if (!o || ["Issued", "Rejected"].includes(o.status))
      throw new Error(
        "This file is no longer available for a commitment revision.",
      );
    const p = titleFile(o);
    assertRevisionContext(s, o, r.messageId);
    if (p.financing !== "Financed")
      throw new Error("Choose an active financed order.");
    const loans = activeLoans(s, o.id);
    const target = resolveRevisionTarget(loans, r);
    // The file's commitment version must be the one the request was captured
    // against, whatever the loan situation — and the named loan itself must be
    // unchanged too. Checking both (rather than one or the other depending on
    // how many loans happen to be active right now) is what keeps a request
    // from being applied against a file that moved underneath it.
    const stale =
      p.version !== r.baseVersion ||
      (target
        ? target.version !== r.productVersion || target.loanAmount !== r.before
        : p.loanAmount !== r.before);
    if (stale)
      throw new Error(
        "This file changed after the request was captured. Recheck the current values and create a new request.",
      );
    // The file-level loanAmount/fields mirror "the" loan only while the file has
    // at most one active loan. With two or more, there is no single file-level
    // amount to update, so only the named product changes — but the file's
    // commitment version still advances either way, because the revised
    // commitment that goes back out is a new version of the file's output and
    // every version-bound attachment, reply draft and handoff must go stale.
    const mirrorsFile = loans.length <= 1;
    const nextVersion = p.version + 1;
    // A version bump alone does not invalidate the final-review snapshot for
    // product-only revisions, so every applied revision reopens that approval.
    o.production = mirrorsFile
      ? {
          ...p,
          loanAmount: r.proposed,
          version: nextVersion,
          commitmentReview: undefined,
        }
      : { ...p, version: nextVersion, commitmentReview: undefined };
    if (target) {
      target.loanAmount = r.proposed;
      target.version++;
      target.status = "Draft";
      target.preparedSnapshot = "";
      target.loanReviewNote = "";
    }
    if (mirrorsFile)
      for (const f of o.fields) {
        f.reviewed = false;
        if (f.id === "loanAmount")
          f.current = r.proposed.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          });
      }
    if (o.status === "Ready for jacket") o.status = "Needs review";
    r.status = "Applied";
    const draft: ReplyDraft = {
      fileVersion: nextVersion,
      id: `draft-${r.id}`,
      orderId: o.id,
      revisionId: r.id,
      to: p.attorneyEmail,
      subject: `Re: ${o.id} · revised commitment`,
      body: `Good afternoon,\n\nPlease find the revised commitment for ${o.address} attached. The loan amount has been updated to ${r.proposed.toLocaleString("en-US", { style: "currency", currency: "USD" })}.\n\nThank you,\n${s.user}`,
      attachmentId: "",
      status: "Awaiting document",
      createdAt: new Date().toISOString(),
    };
    s.replyDrafts.unshift(draft);
    return draft;
  });
}
export function recheckRevision(s: Workspace, id: string) {
  return traceMutation(s, "recheckRevision", [id], () => {
    const r = s.revisions.find((x) => x.id === id);
    const o =
      r &&
      s.orders.find((o) => o.id === r.orderId && o.companyId === r.companyId);
    if (!r || !o || r.status === "Applied")
      throw new Error("This request cannot be reopened.");
    assertRevisionContext(s, o, r.messageId);
    if (
      ["Issued", "Rejected"].includes(o.status) ||
      titleFile(o).financing !== "Financed"
    )
      throw new Error("Choose an active financed order.");
    // Recheck only refreshes the comparison baseline for the SAME loan (or the
    // file, for a no-specific-loan request) — it never retargets a request to
    // a different loan. That would be a materially different instruction and
    // should go through a new request instead.
    const target = resolveRevisionTarget(activeLoans(s, o.id), r);
    r.before = target ? target.loanAmount : titleFile(o).loanAmount;
    r.productVersion = target ? target.version : 0;
    r.baseVersion = titleFile(o).version;
    r.status = "Needs review";
  });
}
/**
 * The loan a revision request is about, resolved from the request's own
 * stored productId — never from however many loans happen to be active at
 * the moment. A request that named a loan which has since been voided is
 * rejected outright rather than silently falling through to whichever loan
 * survived; a legacy request that named no loan is rejected once a choice
 * would be needed (two or more active loans) and otherwise resolves to the
 * sole active loan, if any.
 */
function resolveRevisionTarget(
  loans: ReturnType<typeof activeLoans>,
  r: Pick<RevisionRequest, "productId">,
) {
  if (r.productId) {
    const target = loans.find((l) => l.id === r.productId);
    if (!target)
      throw new Error(
        "The loan this request named is no longer active on this file. Capture a new request for the current loans.",
      );
    return target;
  }
  if (loans.length > 1)
    throw new Error(
      "Multiple loans are now active on this file. Capture a new request naming which loan this applies to.",
    );
  return loans[0];
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fieldRevisionOrder(s: Workspace, r: FieldRevision) {
  const o = s.orders.find(
    (o) => o.id === r.orderId && o.companyId === r.companyId,
  );
  if (!o || ["Issued", "Rejected"].includes(o.status))
    throw new Error(
      "This file is no longer available for a commitment revision.",
    );
  assertRevisionContext(s, o, r.messageId);
  if (r.field === "lender" && titleFile(o).financing === "Cash")
    throw new Error("A cash file has no lender to revise.");
  return o;
}
export function createFieldRevision(
  s: Workspace,
  input: {
    companyId: string;
    orderId: string;
    messageId: string;
    text: string;
    field: RevisableField;
    proposed: string;
  },
): FieldRevision {
  return traceMutation(s, "createFieldRevision", [input], () => {
    const o = s.orders.find(
      (o) => o.id === input.orderId && o.companyId === input.companyId,
    );
    if (!o) throw new Error("Confirm the company and matching file.");
    assertRevisionContext(s, o, input.messageId);
    if (["Issued", "Rejected"].includes(o.status))
      throw new Error("Choose an active order.");
    if (!revisableFields.some((f) => f.id === input.field))
      throw new Error("Choose which commitment field is changing.");
    const p = titleFile(o);
    if (input.field === "lender" && p.financing === "Cash")
      throw new Error("A cash file has no lender to revise.");
    const proposed = input.proposed.trim();
    if (!input.text.trim() || !proposed)
      throw new Error("Enter the source request and the requested value.");
    if (input.field === "attorneyEmail" && !EMAIL.test(proposed))
      throw new Error("Enter a valid attorney email address.");
    const before = p[input.field] || "";
    if (proposed === before)
      throw new Error(
        "The requested value already matches the file — nothing to revise.",
      );
    if (
      input.messageId &&
      (s.fieldRevisions || []).some(
        (r) =>
          r.messageId === input.messageId &&
          r.field === input.field &&
          r.status !== "Needs information",
      )
    )
      throw new Error("This message already has a request for that field.");
    const request: FieldRevision = {
      id: `field-revision-${commandUuid()}`,
      companyId: o.companyId,
      orderId: o.id,
      messageId: input.messageId,
      text: input.text,
      field: input.field,
      before,
      proposed,
      baseVersion: p.version,
      status: "Needs review",
      note: "",
      createdAt: new Date().toISOString(),
    };
    s.fieldRevisions ??= [];
    s.fieldRevisions.unshift(request);
    return request;
  });
}
/**
 * Applies a reviewed field revision to the local title file only: sets that
 * one field, bumps the file version (so every version-bound preparation,
 * output and reply draft goes stale through the existing checks), clears the
 * previous commitment approval and sends a Ready-for-jacket file back to
 * review. Captured source-document field reviews are left alone — a lender
 * or seller name change doesn't invalidate
 * what was read off a recorded deed. Prepares the same reply-draft handoff
 * the loan-amount flow does; nothing external is changed.
 */
export function applyFieldRevision(
  s: Workspace,
  id: string,
  confirmed: boolean,
) {
  return traceMutation(s, "applyFieldRevision", [id, confirmed], () => {
    const r = (s.fieldRevisions || []).find((r) => r.id === id);
    if (!r || r.status !== "Needs review" || !confirmed)
      throw new Error("Review and confirm the request first.");
    const o = fieldRevisionOrder(s, r);
    const p = titleFile(o);
    if (p.version !== r.baseVersion || (p[r.field] || "") !== r.before)
      throw new Error(
        "This file changed after the request was captured. Recheck the current values and create a new request.",
      );
    const next: TitleFile = {
      ...p,
      version: p.version + 1,
      commitmentReview: undefined,
    };
    next[r.field] = r.proposed;
    o.production = next;
    if (o.status === "Ready for jacket") o.status = "Needs review";
    r.status = "Applied";
    const label = revisableFieldLabel(r.field).toLowerCase();
    const draft: ReplyDraft = {
      fileVersion: o.production.version,
      id: `draft-${r.id}`,
      orderId: o.id,
      revisionId: r.id,
      to: o.production.attorneyEmail,
      subject: `Re: ${o.id} · revised commitment`,
      body: `Good afternoon,\n\nPlease find the revised commitment for ${o.address} attached. The ${label} has been updated to: ${r.proposed}\n\nThank you,\n${s.user}`,
      attachmentId: "",
      status: "Awaiting document",
      createdAt: new Date().toISOString(),
    };
    s.replyDrafts.unshift(draft);
    return draft;
  });
}
export function recheckFieldRevision(s: Workspace, id: string) {
  return traceMutation(s, "recheckFieldRevision", [id], () => {
    const r = (s.fieldRevisions || []).find((x) => x.id === id);
    if (!r || r.status === "Applied")
      throw new Error("This request cannot be reopened.");
    const o = fieldRevisionOrder(s, r);
    const p = titleFile(o);
    r.before = p[r.field] || "";
    r.baseVersion = p.version;
    r.status = "Needs review";
  });
}
function activeLoans(s: Workspace, orderId: string) {
  return (
    s.business?.policies.filter(
      (p) => p.orderId === orderId && p.kind === "Loan" && p.status !== "Void",
    ) || []
  );
}
function assertRevisionContext(s: Workspace, o: Order, messageId: string) {
  if (productionLocked(s, o))
    throw new Error("Issued files require a separate correction workflow.");
  const message = s.inbox.find((m) => m.id === messageId);
  if (
    message &&
    (message.orderId !== o.id ||
      (message.companyId && message.companyId !== o.companyId))
  )
    throw new Error(
      "The source message is routed to another file. Review its routing before applying this request.",
    );
}
export function missingDocumentDraft(s: Workspace, o: Order) {
  const missing = finalReadiness(s, o).missingSources;
  return `Good afternoon,\n\nFor ${o.id} — ${o.address}, please provide ${missing.length ? missing.join(", ") : "the missing or clarified recording information noted below"}. Please confirm that the final opinion addresses the commitment requirements.\n\nThank you,\n${s.user}`;
}

/** Add the new workflow model without discarding previous local companies or edits. */
export function enrichWorkspace(s: Workspace): Workspace {
  s.revisions ??= [];
  for (const r of s.revisions) {
    r.productId ??= "";
    r.productVersion ??= 0;
  }
  s.replyDrafts ??= [];
  s.fieldRevisions ??= [];
  s.expenses ??= {};
  s.expansionStates ??= [];
  s.importTemplates ??= [];
  for (const o of s.orders) {
    if (o.production) continue;
    const sample = [
      "T-2026-1048",
      "T-2026-1047",
      "T-2026-1046",
      "T-2026-1045",
    ].includes(o.id);
    o.production = {
      ...titleFile(o),
      ...(sample
        ? {
            loanAmount: 320000,
            purchasePrice: 400000,
            county: o.jurisdiction === "NC" ? "Mecklenburg" : "Charleston",
            attorney: "Morgan & Reed Law",
            attorneyEmail: "closings@example.com",
            lender: "Cedar Bank — demo",
            seller: "Morgan Avery — demo",
            commitmentReference: `DEMO-${o.id}-C1`,
            legalDescription:
              "Illustrative Lot 12, Block B. Replace with exact approved property description.",
            requirements: [
              {
                id: `req-${o.id}`,
                kind: "Requirement" as const,
                text: "Recorded release or other approved evidence for the existing deed of trust.",
                status: "Open" as const,
                evidence: "",
                note: "",
              },
              {
                id: `exc-${o.id}`,
                kind: "Exception" as const,
                text: "Recorded utility easement referenced in the preliminary opinion.",
                status: "Open" as const,
                evidence: "",
                note: "",
              },
            ],
          }
        : {}),
    };
    if (sample && o.fields.length) {
      const demoValues: Record<string, string> = {
        deedDated: "September 8, 2026",
        loanAmount: "$320,000.00",
        dotDated: "September 8, 2026",
        dotDate: "September 9, 2026",
        dotTime: "2:43 PM",
        dotReference: "Book 1842 · Page 321",
      };
      for (const role of requiredSources(o)) {
        const id = `source-${o.id}-${role.replaceAll(" ", "-")}`;
        const excerpt = neededFields(o)
          .filter((f) => f.role === role)
          .map(
            (f) =>
              `${f.label}: ${o.fields.find((field) => field.id === f.id)?.sourceValue || demoValues[f.id] || "Review source"}`,
          )
          .join("\n");
        if (!s.documents.some((d) => d.id === id))
          s.documents.push({
            id,
            companyId: o.companyId,
            orderId: o.id,
            sourceRole: role,
            name: `${o.id} — sample ${role.toLowerCase()}.txt`,
            category: "Policy documents",
            visibility: "Internal",
            date: "2026-09-09",
            size: "2 KB",
            version: 1,
            text: `FICTIONAL ${role.toUpperCase()} — LOCAL DEMO ONLY\n\nFile: ${o.id}\nProperty: ${o.address}\n${excerpt || "Final-opinion workflow fixture. Review all commitment requirements and exceptions separately; this sample supplies no clearance evidence."}\n\nThis source is a synthetic workflow fixture, not a signed opinion or recorded instrument.`,
          });
      }
      for (const def of neededFields(o)) {
        const doc = s.documents.find(
          (d) => d.orderId === o.id && d.sourceRole === def.role,
        )!;
        const existing = o.fields.find((f) => f.id === def.id);
        if (existing) {
          existing.label = def.label;
          existing.documentId = doc.id;
          existing.sourcePage = "1";
          existing.source = `${doc.name} · page 1`;
          existing.reviewed = false;
        } else
          o.fields.push({
            id: def.id,
            label: def.label,
            current: "Not captured",
            proposed: demoValues[def.id] || "Review source",
            sourceValue: demoValues[def.id] || "Review source",
            source: `${doc.name} · page 1`,
            documentId: doc.id,
            sourcePage: "1",
            reviewed: false,
            confidence: "Sample",
          });
      }
      if (o.status === "Ready for jacket") o.status = "Needs review";
    }
  }
  if (!s.inbox.some((m) => m.id === "tyler-revision-demo"))
    s.inbox.unshift({
      id: "tyler-revision-demo",
      from: "Morgan & Reed Law",
      email: "closings@example.com",
      subject: "Loan amount revision · T-2026-1045",
      body: "Hi Tyler,\n\nFor Evergreen Title, file T-2026-1045 at 730 Parkside Drive, please revise the loan amount from $320,000 to $340,000 and return an updated commitment.\n\nThank you.",
      time: "10:15 AM",
      orderId: "T-2026-1045",
      status: "New",
      attachments: [],
      kind: "Revision",
    });
  return s;
}

export function approveReplyDraft(s: Workspace, id: string) {
  return traceMutation(s, "approveReplyDraft", [id], () => {
    const d = s.replyDrafts.find((x) => x.id === id);
    if (!d) throw new Error("Reply draft not found.");
    const o = s.orders.find((x) => x.id === d.orderId);
    if (!o || d.fileVersion !== titleFile(o).version)
      throw new Error("The title file changed. Prepare a new draft.");
    const doc = orderSources(s, o.id).find(
      (x) =>
        x.id === d.attachmentId &&
        x.companyId === o.companyId &&
        x.sourceRole === "Revised commitment" &&
        x.productionVersion === d.fileVersion,
    );
    if (!doc)
      throw new Error(
        "Attach the revised commitment prepared for this file version.",
      );
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to) ||
      !d.subject.trim() ||
      !d.body.trim()
    )
      throw new Error("Review the recipient, subject, and reply body.");
    d.status = "Approved locally";
  });
}
