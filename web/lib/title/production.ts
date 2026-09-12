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
export type TitleFile = {
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
export function commitmentSnapshot(s: Workspace, o: Order) {
  const p = titleFile(o);
  return JSON.stringify({
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
  const o = s.orders.find((x) => x.id === orderId);
  const doc = s.documents.find((d) => d.id === docId);
  if (!o || !doc || doc.orderId !== o.id || doc.companyId !== o.companyId)
    throw new Error("Select a source document from this company and order.");
  if (o.status === "Issued")
    throw new Error("Issued files require a separate correction workflow.");
  const defs = neededFields(o).filter((f) => f.role === doc.sourceRole);
  if (!defs.length || defs.some((f) => !values[f.id]?.trim()) || !page.trim())
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
    id: `revision-${crypto.randomUUID()}`,
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
}
export function applyRevision(s: Workspace, id: string, confirmed: boolean) {
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
  let fileVersionAfter = p.version;
  if (loans.length > 1) {
    // No single "the loan amount" exists at the file level once a second
    // loan is active, so this path only ever touches the specific product
    // the request named — never the shared file fields or the other loan.
    const target = loans.find((l) => l.id === r.productId);
    if (!target)
      throw new Error(
        "The targeted loan is no longer active on this file. Recheck the request.",
      );
    if (target.version !== r.productVersion || target.loanAmount !== r.before)
      throw new Error(
        "This file changed after the request was captured. Recheck the current values and create a new request.",
      );
    target.loanAmount = r.proposed;
    target.version++;
    target.status = "Draft";
    target.preparedSnapshot = "";
    target.loanReviewNote = "";
  } else {
    if (p.version !== r.baseVersion || p.loanAmount !== r.before)
      throw new Error(
        "This file changed after the request was captured. Recheck the current values and create a new request.",
      );
    o.production = { ...p, loanAmount: r.proposed, version: p.version + 1 };
    fileVersionAfter = o.production.version;
    const loan = loans[0];
    if (loan) {
      loan.loanAmount = r.proposed;
      loan.version++;
      loan.status = "Draft";
      loan.preparedSnapshot = "";
      loan.loanReviewNote = "";
    }
    for (const f of o.fields) {
      f.reviewed = false;
      if (f.id === "loanAmount")
        f.current = r.proposed.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
    }
    if (o.status === "Ready for jacket") o.status = "Needs review";
  }
  r.status = "Applied";
  const draft: ReplyDraft = {
    fileVersion: fileVersionAfter,
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
}
export function recheckRevision(s: Workspace, id: string) {
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
  const loans = activeLoans(s, o.id);
  if (loans.length > 1) {
    const target = loans.find((l) => l.id === r.productId);
    if (!target)
      throw new Error(
        "The targeted loan is no longer active on this file. Recheck the request.",
      );
    r.before = target.loanAmount;
    r.productVersion = target.version;
  } else {
    r.before = titleFile(o).loanAmount;
    if (loans[0]) r.productVersion = loans[0].version;
  }
  r.baseVersion = titleFile(o).version;
  r.status = "Needs review";
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
}
