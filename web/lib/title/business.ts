import { validateCompanyWorkspace, validateMemberIdentityMutation } from "./company-workspace";
import { traceMutation, commandUuid } from "./command-log";
import type {
  Workspace,
  Order,
  Company,
  OrderOutcomeKind,
  ImportTargetField,
} from "./model";
import { uid } from "./model";
import { enrichMaterials, validateMaterialsMutation } from "./materials";
import { validateStatementDeliveryMutation } from "./statement-delivery";
import { validateTaskClock } from "./task-clock";
import { validateDeliveryMutation } from "./delivery-ledger";
import { ownershipForMonth, validateOwnershipMutation } from "./ownership-history";
import { validateOrchestrationMutation } from "./orchestration";
import {
  titleFile,
  orderSources,
  finalReadiness,
  fieldDefinitions,
  referencedSourceProblems,
  validateReferencedSourcesMutation,
} from "./production";
import { allocateOwnership, round } from "./engine";

export type PolicyProduct = {
  id: string;
  orderId: string;
  kind: "Owner" | "Loan";
  insured: string;
  amount: number;
  loanReference: string;
  loanAmount: number;
  securityDocumentId: string;
  securityPage: string;
  loanReviewNote: string;
  premium: number;
  rate: number;
  form: string;
  endorsements: string;
  version: number;
  status: "Draft" | "Prepared" | "Issued" | "Delivered" | "Void";
  reviewNote: string;
  exceptions: {
    itemId: string;
    disposition: "Retain" | "Revise" | "Omit";
    wording: string;
    reason: string;
  }[];
  preparedSnapshot: string;
  policyNumber: string;
  documentId: string;
  issuedMonth: string;
  issuedAt: string;
  deliveryTo: string;
  deliveryReference: string;
  deliveredAt: string;
  remittanceReference: string;
};
export type CommitmentCase = {
  orderId: string;
  ptoDocumentId: string;
  attorneyReference: string;
  priorReview: string;
  searchReview: string;
  premiumBasis: string;
  reviewNote: string;
  version: number;
  status: "Draft" | "Prepared" | "Returned";
  snapshot: string;
  preparedAt: string;
  preparedBy: string;
  returnedReference: string;
  returnedDocumentId: string;
};
export type CPLRecord = {
  id: string;
  orderId: string;
  party: string;
  recipient: string;
  form: string;
  reason: string;
  decision: "Review required" | "Requested" | "Not requested";
  reference: string;
  documentId: string;
  version: number;
  loanReference: string;
  status: "Draft" | "Prepared" | "Returned" | "Delivered";
  snapshot: string;
  deliveryReference: string;
};
export type OnboardingEvidence = {
  step: number;
  reference: string;
  documentId: string;
  note: string;
  reviewer: string;
  reviewedAt: string;
};
export type OnboardingCase = {
  companyId: string;
  legalName: string;
  mailingAddress: string;
  contactEmail: string;
  secureApplicationReference: string;
  signatureReference: string;
  applicationStatus:
    | "Not started"
    | "Packet prepared"
    | "Awaiting return"
    | "Received"
    | "Reviewed";
  applicationNote: string;
  requiredUnderwriters: string[];
  launchSnapshot?: string;
  evidence: OnboardingEvidence[];
  launchedAt: string;
};
export type CredentialRecord = {
  id: string;
  companyId: string;
  state: string;
  kind:
    | "Agency license"
    | "Producer credential"
    | "Underwriter authority"
    | "Annual filing";
  underwriter: string;
  holder: string;
  identifier: string;
  reference: string;
  expiresOn: string;
  reviewOn: string;
  status: "Needs review" | "Verified locally";
  reviewer: string;
};
export type PolicyCorrection = {
  id: string;
  policyId: string;
  orderId: string;
  policyVersionAtRequest: number;
  issuedSnapshot: string;
  reason: string;
  requestedBy: string;
  requestReference: string;
  correctionKind:
    "Endorsement" | "Reissued policy" | "Administrative correction";
  fieldChanges: { label: string; before: string; after: string }[];
  status: "Requested" | "Reviewed" | "Recorded" | "Cancelled";
  reviewNote: string;
  reviewSnapshot: string;
  correctionReference: string;
  documentId: string;
  cancelReason: string;
  createdAt: string;
  reviewedAt: string;
  recordedAt: string;
};
export type LedgerLine = {
  id: string;
  orderId: string;
  description: string;
  premium: number;
  remittance: number;
  underwriter: string;
};
export type ClosePeriod = {
  id: string;
  companyId: string;
  companyName: string;
  month: string;
  revision: number;
  status: "Draft" | "Reviewed" | "Published" | "Superseded" | "Withdrawn";
  sourceHash: string;
  rows: LedgerLine[];
  members: { name: string; share: number }[];
  expenses: number;
  adjustment: number;
  reserve: number;
  externalPremium: number;
  externalRemittance: number;
  booksReference: string;
  agreementReference: string;
  note: string;
  totals: {
    premium: number;
    remittance: number;
    retained: number;
    profit: number;
    available: number;
  };
  allocations: { name: string; share: number; amount: number }[];
  /** Which dated ownership record governed this close, or null when current members did. */
  ownershipSource?: { recordId: string; effectiveFrom: string } | null;
  reviewedAt: string;
  reviewedBy: string;
  publishedAt: string;
};
export type Handoff = {
  id: string;
  kind:
    | "SoftPro commitment"
    | "SoftPro final policy"
    | "SoftPro CPL"
    | "SoftPro correction"
    | "Missive reply"
    | "Application packet";
  subject: string;
  companyId: string;
  orderId: string;
  sourceId: string;
  fingerprint: string;
  status: "Awaiting connection" | "Hold" | "Recorded locally";
  reference: string;
  note: string;
  createdAt: string;
};
export type BusinessState = {
  followups: import("./followups").AttorneyFollowup[];
  commitments: CommitmentCase[];
  policies: PolicyProduct[];
  cpls: CPLRecord[];
  onboarding: OnboardingCase[];
  credentials: CredentialRecord[];
  closes: ClosePeriod[];
  handoffs: Handoff[];
  corrections: PolicyCorrection[];
};
const blank = (): BusinessState => ({
  followups: [],
  commitments: [],
  policies: [],
  cpls: [],
  onboarding: [],
  credentials: [],
  closes: [],
  handoffs: [],
  corrections: [],
});
export function business(s: Workspace): BusinessState {
  return s.business || blank();
}
export function enrichBusiness(s: Workspace) {
  enrichMaterials(s);
  s.business ??= blank();
  s.business.followups ??= [];
  s.business.corrections ??= [];
  if (!s.rules.some((r) => r.id === "renewals"))
    s.rules.push({
      id: "renewals",
      name: "Prepare authority review tasks",
      description:
        "Create one task for an authority record due within 30 days, using its recorded date.",
      trigger: "Manual review of recorded authority dates",
      action: "Create review tasks",
      enabled: true,
      runs: 0,
      lastRun: "Never",
    });
  for (const c of s.companies) {
    const oc = s.business.onboarding.find((x) => x.companyId === c.id);
    if (
      oc?.launchedAt &&
      (oc.launchSnapshot !== launchFingerprint(s, c) ||
        companyProblems(s, c).length)
    ) {
      oc.launchedAt = "";
      c.steps[6] = false;
      c.stage = "Onboarding";
    }
  }
  return s;
}
const ensure = (s: Workspace) => enrichBusiness(s).business!;
const id = (prefix: string) => `${prefix}-${commandUuid()}`;
const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
const moneyValid = (n: number, positive = false) =>
  Number.isFinite(n) &&
  n >= (positive ? 0.01 : 0) &&
  n <= 100000000 &&
  Math.abs(n * 100 - Math.round(n * 100)) < 0.00001;
export const emailValid = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function getOrder(s: Workspace, orderId: string) {
  const o = s.orders.find((o) => o.id === orderId);
  if (!o) throw new Error("Choose an existing order.");
  return o;
}
export function products(s: Workspace, orderId: string) {
  return business(s).policies.filter(
    (p) => p.orderId === orderId && p.status !== "Void",
  );
}
export function getCommitment(s: Workspace, o: Order): CommitmentCase {
  return (
    business(s).commitments.find((c) => c.orderId === o.id) || {
      orderId: o.id,
      ptoDocumentId: "",
      attorneyReference: "",
      priorReview: "",
      searchReview: "",
      premiumBasis: "Review required",
      reviewNote: "",
      version: 1,
      status: "Draft",
      snapshot: "",
      preparedAt: "",
      preparedBy: "",
      returnedReference: "",
      returnedDocumentId: "",
    }
  );
}
export function policyProblems(s: Workspace, o: Order, p: PolicyProduct) {
  const errors: string[] = [];
  if (!p.insured.trim()) errors.push("Insured party");
  if (!moneyValid(p.amount, true)) errors.push("Coverage amount");
  if (!moneyValid(p.premium)) errors.push("Premium");
  if (!Number.isFinite(p.rate) || p.rate < 0 || p.rate > 1)
    errors.push("Underwriter share");
  if (!p.form.trim()) errors.push("Approved form reference");
  if (o.jurisdiction === "SC" && p.rate < 0.4)
    errors.push(
      "SC retained commission exceeds 60% — review the entered terms",
    );
  if (p.kind === "Loan") {
    if (
      titleFile(o).financing !== "Financed" ||
      !moneyValid(p.loanAmount, true) ||
      !p.loanReference.trim()
    )
      errors.push("Reviewed loan identity and principal");
    if (p.amount < p.loanAmount)
      errors.push("Review coverage below the recorded loan principal");
    if (
      products(s, o.id).filter((x) => x.kind === "Loan").length === 1 &&
      round(p.loanAmount) !== round(titleFile(o).loanAmount)
    )
      errors.push("Loan principal must match the reviewed file amount");
    if (
      products(s, o.id).some(
        (x) =>
          x.id !== p.id &&
          x.kind === "Loan" &&
          x.loanReference.trim() === p.loanReference.trim(),
      )
    )
      errors.push("Each loan needs a distinct reference");
  }
  return errors;
}
function productInput(p: PolicyProduct) {
  return [
    p.id,
    p.version,
    p.kind,
    p.insured,
    p.amount,
    p.premium,
    p.rate,
    p.form,
    p.endorsements,
    p.loanReference,
    p.loanAmount,
    p.securityDocumentId,
    p.securityPage,
    p.loanReviewNote,
  ];
}
export function commitmentFingerprint(
  s: Workspace,
  o: Order,
  c = getCommitment(s, o),
) {
  const t = titleFile(o);
  return JSON.stringify({
    order: [o.id, o.companyId, o.address, o.jurisdiction, o.underwriter],
    ...(t.referencedSources?.length ? { referencedSources: t.referencedSources } : {}),
    file: [
      t.financing,
      t.loanAmount,
      t.purchasePrice,
      t.county,
      t.attorney,
      t.attorneyEmail,
      t.lender,
      t.seller,
      t.legalDescription,
      t.priorPolicyReference,
      t.requirements,
    ],
    source: orderSources(s, o.id)
      .filter((d) =>
        ["Preliminary opinion", "Prior policy", "Search package"].includes(
          d.sourceRole!,
        ),
      )
      .map((d) => [d.id, d.version, d.sourceRole]),
    case: [
      c.ptoDocumentId,
      c.attorneyReference,
      c.priorReview,
      c.searchReview,
      c.premiumBasis,
      c.reviewNote,
    ],
    products: products(s, o.id).map(productInput),
    cpls: business(s)
      .cpls.filter((x) => x.orderId === o.id)
      .map((x) => [x.id, x.party, x.recipient, x.form, x.reason, x.decision]),
  });
}
export function commitmentProblems(
  s: Workspace,
  o: Order,
  c = getCommitment(s, o),
) {
  const t = titleFile(o),
    errors: string[] = [];
  referencedSourceProblems(s, o).forEach(r => errors.push(`Referenced source needs review: ${r.wording}`));
  if (["Issued", "Rejected"].includes(o.status))
    errors.push("Choose an active order");
  if (
    !orderSources(s, o.id).some(
      (d) => d.id === c.ptoDocumentId && d.sourceRole === "Preliminary opinion",
    )
  )
    errors.push("Current preliminary title opinion");
  if (!c.attorneyReference.trim())
    errors.push("Signed attorney opinion review reference");
  for (const [label, value] of [
    ["County", t.county],
    ["Attorney", t.attorney],
    ["Exact legal description", t.legalDescription],
    ...(o.type === "Refinance" ? [] : [["Seller", t.seller]]),
  ])
    if (!value.trim()) errors.push(label);
  if (!emailValid(t.attorneyEmail)) errors.push("Attorney email");
  if (
    t.financing === "Financed" &&
    (!t.lender.trim() || !moneyValid(t.loanAmount, true))
  )
    errors.push("Lender and loan amount");
  if (
    t.priorPolicyReference &&
    (!c.priorReview.trim() ||
      !orderSources(s, o.id).some((d) => d.sourceRole === "Prior policy"))
  )
    errors.push("Prior policy source and tacking review");
  if (
    orderSources(s, o.id).some((d) => d.sourceRole === "Search package") &&
    !c.searchReview.trim()
  )
    errors.push("Search-package review");
  if (c.premiumBasis === "Review required")
    errors.push("Reviewed premium basis");
  if (!c.reviewNote.trim()) errors.push("Commitment review note");
  if (t.requirements.some((r) => !r.text.trim()))
    errors.push("Complete requirement and exception text");
  const ps = products(s, o.id);
  if (!ps.length) errors.push("At least one policy product");
  ps.forEach((p) =>
    policyProblems(s, o, p).forEach((e) => errors.push(`${p.kind}: ${e}`)),
  );
  const cpls = business(s).cpls.filter((x) => x.orderId === o.id);
  if (
    !cpls.length ||
    cpls.some(
      (x) =>
        x.decision === "Review required" ||
        !x.reason.trim() ||
        (x.decision === "Requested" &&
          (!x.party.trim() || !emailValid(x.recipient) || !x.form.trim())),
    )
  )
    errors.push("Reviewed CPL decision and requested-party details");
  return errors;
}
export function saveCommitment(s: Workspace, value: CommitmentCase) {
  return traceMutation(s, "saveCommitment", [value], () => {
    const o = getOrder(s, value.orderId),
      b = ensure(s),
      existing = getCommitment(s, o);
    if (["Issued", "Rejected"].includes(o.status))
      throw new Error("This file is not open for commitment preparation.");
    if (existing.version !== value.version)
      throw new Error("The commitment changed. Reopen its current version.");
    const next = {
      ...structuredClone(value),
      version: value.version + 1,
      status: "Draft" as const,
      snapshot: "",
      returnedReference: "",
      returnedDocumentId: "",
    };
    b.commitments = b.commitments.filter((x) => x.orderId !== o.id);
    b.commitments.push(next);
  });
}
export function prepareCommitment(s: Workspace, orderId: string) {
  return traceMutation(s, "prepareCommitment", [orderId], () => {
    const o = getOrder(s, orderId),
      c = getCommitment(s, o),
      errors = commitmentProblems(s, o, c);
    if (errors.length) throw new Error(`Complete: ${errors.join("; ")}.`);
    const b = ensure(s);
    if (!b.commitments.some((x) => x.orderId === orderId))
      b.commitments.push(c);
    c.status = "Prepared";
    c.snapshot = commitmentFingerprint(s, o, c);
    c.preparedAt = now();
    c.preparedBy = s.user;
    addHandoff(s, {
      kind: "SoftPro commitment",
      subject: `Prepare commitment · ${orderId}`,
      companyId: o.companyId,
      orderId,
      sourceId: `commitment-${orderId}`,
      fingerprint: c.snapshot,
    });
    return c;
  });
}
export function addPolicy(
  s: Workspace,
  orderId: string,
  kind: PolicyProduct["kind"],
) {
  return traceMutation(s, "addPolicy", [orderId, kind], () => {
    const o = getOrder(s, orderId);
    if (
      ["Issued", "Rejected"].includes(o.status) ||
      products(s, o.id).some((p) => ["Issued", "Delivered"].includes(p.status))
    )
      throw new Error("Add products before the first issuance.");
    if (kind === "Loan" && titleFile(o).financing !== "Financed")
      throw new Error("A loan policy needs a financed file.");
    const p: PolicyProduct = {
      id: id("policy"),
      orderId,
      kind,
      insured: "",
      loanReference: "",
      loanAmount: kind === "Loan" ? titleFile(o).loanAmount : 0,
      securityDocumentId: "",
      securityPage: "",
      loanReviewNote: "",
      amount:
        kind === "Loan" ? titleFile(o).loanAmount : titleFile(o).purchasePrice,
      premium: 0,
      rate: o.rate,
      form: "",
      endorsements: "",
      version: 1,
      status: "Draft",
      reviewNote: "",
      exceptions: [],
      preparedSnapshot: "",
      policyNumber: "",
      documentId: "",
      issuedMonth: "",
      issuedAt: "",
      deliveryTo: "",
      deliveryReference: "",
      deliveredAt: "",
      remittanceReference: "",
    };
    ensure(s).policies.push(p);
    return p;
  });
}
export function savePolicy(s: Workspace, value: PolicyProduct) {
  return traceMutation(s, "savePolicy", [value], () => {
    const b = ensure(s),
      p = b.policies.find((p) => p.id === value.id);
    if (
      !p ||
      p.version !== value.version ||
      ["Issued", "Delivered", "Void"].includes(p.status)
    )
      throw new Error("This policy cannot be edited in its current state.");
    const o = getOrder(s, p.orderId);
    if (value.orderId !== p.orderId || value.kind !== p.kind)
      throw new Error("Policy identity cannot change.");
    if (
      !moneyValid(value.amount, true) ||
      !moneyValid(value.premium) ||
      !Number.isFinite(value.rate) ||
      value.rate < 0 ||
      value.rate > 1
    )
      throw new Error("Enter valid coverage, premium and underwriter share.");
    Object.assign(p, {
      ...value,
      version: p.version + 1,
      status: "Draft",
      preparedSnapshot: "",
    });
    if (o.status === "Ready for jacket") o.status = "Needs review";
  });
}
export function finalProductFingerprint(
  s: Workspace,
  o: Order,
  p: PolicyProduct,
) {
  return JSON.stringify({
    order: [
      o.id,
      o.companyId,
      o.address,
      o.jurisdiction,
      o.type,
      o.underwriter,
    ],
    file: titleFile(o),
    fields: o.fields,
    product: productInput(p),
    exceptions: p.exceptions,
    sources: orderSources(s, o.id)
      .filter(
        (d) =>
          ![
            "Revised commitment",
            "Commitment output",
            "Final policy",
            "CPL",
            "Correction output",
          ].includes(d.sourceRole!),
      )
      .map((d) => [d.id, d.version, d.sourceRole]),
  });
}
export function preparePolicy(s: Workspace, policyId: string, note: string) {
  return traceMutation(s, "preparePolicy", [policyId, note], () => {
    const p = ensure(s).policies.find((p) => p.id === policyId);
    if (!p || !["Draft", "Prepared"].includes(p.status))
      throw new Error("Choose a draft policy.");
    const o = getOrder(s, p.orderId);
    if (["Rejected", "Issued"].includes(o.status))
      throw new Error("This order is no longer open for preparation.");
    if (
      !note.trim() ||
      policyProblems(s, o, p).length ||
      !finalReadiness(s, o).ready
    )
      throw new Error(
        "Complete the final source review, policy details and review note first.",
      );
    if (
      p.kind === "Loan" &&
      (!p.securityPage.trim() ||
        !p.loanReviewNote.trim() ||
        !orderSources(s, o.id).some(
          (d) =>
            d.id === p.securityDocumentId &&
            ["Mortgage", "Deed of trust"].includes(d.sourceRole!),
        ))
    )
      throw new Error(
        "Review this loan principal against its current security instrument and source page.",
      );
    if (
      titleFile(o)
        .requirements.filter((r) => r.kind === "Exception")
        .some(
          (r) =>
            !p.exceptions.some(
              (e) =>
                e.itemId === r.id &&
                e.reason.trim() &&
                (e.disposition === "Omit" || e.wording.trim()),
            ),
        )
    )
      throw new Error(
        "Map each commitment exception into this policy with a reason and final wording.",
      );
    p.reviewNote = note.trim();
    p.preparedSnapshot = finalProductFingerprint(s, o, p);
    p.status = "Prepared";
    addHandoff(s, {
      kind: "SoftPro final policy",
      subject: `${p.kind} policy · ${o.id}`,
      companyId: o.companyId,
      orderId: o.id,
      sourceId: p.id,
      fingerprint: p.preparedSnapshot,
    });
  });
}
export function issuePolicy(
  s: Workspace,
  policyId: string,
  input: { reference: string; documentId: string; month: string },
) {
  return traceMutation(s, "issuePolicy", [policyId, input], () => {
    const p = ensure(s).policies.find((p) => p.id === policyId);
    if (!p || p.status !== "Prepared")
      throw new Error("Prepare this policy before recording issuance.");
    const o = getOrder(s, p.orderId),
      d = orderSources(s, o.id).find((d) => d.id === input.documentId);
    if (["Rejected", "Issued"].includes(o.status))
      throw new Error("This order is no longer open for issuance.");
    if (
      products(s, o.id).some(
        (sibling) =>
          !["Prepared", "Issued", "Delivered"].includes(sibling.status) ||
          sibling.preparedSnapshot !== finalProductFingerprint(s, o, sibling),
      )
    )
      throw new Error(
        "Prepare every policy product against current source evidence before issuance.",
      );
    if (
      !finalReadiness(s, o).ready ||
      p.preparedSnapshot !== finalProductFingerprint(s, o, p)
    )
      throw new Error(
        "The final evidence or policy changed. Review and prepare again.",
      );
    if (!input.reference.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))
      throw new Error("Record a policy reference and valid issuance month.");
    if (
      !d ||
      d.sourceRole !== "Final policy" ||
      d.policyId !== p.id ||
      d.productionVersion !== titleFile(o).version ||
      d.policyVersion !== p.version ||
      d.preparationFingerprint !== p.preparedSnapshot
    )
      throw new Error(
        "Attach the final policy document for this product and current version.",
      );
    if (
      business(s).policies.some(
        (x) =>
          x.id !== p.id &&
          x.policyNumber === input.reference.trim() &&
          x.status !== "Void",
      )
    )
      throw new Error("That policy reference is already recorded.");
    p.policyNumber = input.reference.trim();
    p.documentId = d.id;
    p.issuedMonth = input.month;
    p.issuedAt = now();
    p.status = "Issued";
    const all = products(s, o.id);
    o.premium = round(all.reduce((n, p) => n + p.premium, 0));
    if (all.every((p) => ["Issued", "Delivered"].includes(p.status))) {
      o.status = "Issued";
      o.month = input.month;
    }
  });
}
export function deliverPolicy(
  s: Workspace,
  policyId: string,
  to: string,
  reference: string,
) {
  return traceMutation(s, "deliverPolicy", [policyId, to, reference], () => {
    const p = ensure(s).policies.find((p) => p.id === policyId);
    if (!p || p.status !== "Issued") throw new Error("Record issuance first.");
    const o = getOrder(s, p.orderId);
    if (!emailValid(to) || !reference.trim())
      throw new Error("Record the delivery recipient and evidence reference.");
    if (p.preparedSnapshot !== finalProductFingerprint(s, o, p))
      throw new Error(
        "The issued policy evidence changed. Review a correction before delivery.",
      );
    if (!orderSources(s, o.id).some((d) => d.id === p.documentId))
      throw new Error(
        "The issued document was replaced. Review the correction before delivery.",
      );
    p.deliveryTo = to;
    p.deliveryReference = reference.trim();
    p.deliveredAt = now();
    p.status = "Delivered";
    o.delivered = products(s, o.id).every((p) => p.status === "Delivered");
  });
}
/**
 * Issued and delivered policy content is otherwise frozen by
 * validateBusinessMutation. This is the sanctioned way to record that
 * something on an issued product needs to change: it keeps the original
 * issued record intact for audit and tracks the request, review and an
 * operator-reported outcome reference, the same local-evidence pattern used
 * for handoffs and attorney follow-ups elsewhere in this file. It does not
 * regenerate a jacket, pick an approved endorsement form or perform any
 * provider action.
 */
export function correctionFingerprint(s: Workspace, c: PolicyCorrection) {
  return JSON.stringify({
    policyId: c.policyId,
    orderId: c.orderId,
    policyVersionAtRequest: c.policyVersionAtRequest,
    issuedSnapshot: c.issuedSnapshot,
    reason: c.reason,
    requestedBy: c.requestedBy,
    requestReference: c.requestReference,
    correctionKind: c.correctionKind,
    fieldChanges: c.fieldChanges,
  });
}
export function openCorrection(s: Workspace, policyId: string) {
  return business(s).corrections.find(
    (c) =>
      c.policyId === policyId && ["Requested", "Reviewed"].includes(c.status),
  );
}
export function requestCorrection(
  s: Workspace,
  policyId: string,
  input: {
    reason: string;
    requestedBy: string;
    requestReference: string;
    correctionKind: PolicyCorrection["correctionKind"];
    fieldChanges: { label: string; before: string; after: string }[];
  },
) {
  return traceMutation(s, "requestCorrection", [policyId, input], () => {
    const p = ensure(s).policies.find((p) => p.id === policyId);
    if (!p || !["Issued", "Delivered"].includes(p.status))
      throw new Error(
        "Only an issued or delivered policy can have a correction request.",
      );
    const o = getOrder(s, p.orderId);
    if (openCorrection(s, policyId))
      throw new Error(
        "This policy already has an open correction request. Resolve or cancel it first.",
      );
    const changes = input.fieldChanges
      .map((f) => ({
        label: f.label.trim(),
        before: f.before.trim(),
        after: f.after.trim(),
      }))
      .filter((f) => f.label || f.before || f.after);
    if (
      !input.reason.trim() ||
      !input.requestedBy.trim() ||
      !changes.length ||
      changes.some((f) => !f.label || !f.before || !f.after)
    )
      throw new Error(
        "Record the reason, who requested it, and every corrected field with its before and after value.",
      );
    const correction: PolicyCorrection = {
      id: id("correction"),
      policyId,
      orderId: o.id,
      policyVersionAtRequest: p.version,
      issuedSnapshot: finalProductFingerprint(s, o, p),
      reason: input.reason.trim(),
      requestedBy: input.requestedBy.trim(),
      requestReference: input.requestReference.trim(),
      correctionKind: input.correctionKind,
      fieldChanges: changes,
      status: "Requested",
      reviewNote: "",
      reviewSnapshot: "",
      correctionReference: "",
      documentId: "",
      cancelReason: "",
      createdAt: now(),
      reviewedAt: "",
      recordedAt: "",
    };
    ensure(s).corrections.unshift(correction);
    return correction;
  });
}
export function reviewCorrectionRequest(
  s: Workspace,
  correctionId: string,
  reviewNote: string,
) {
  return traceMutation(
    s,
    "reviewCorrectionRequest",
    [correctionId, reviewNote],
    () => {
      const c = ensure(s).corrections.find((c) => c.id === correctionId);
      if (!c || c.status !== "Requested")
        throw new Error("Only a requested correction can be reviewed.");
      if (!reviewNote.trim())
        throw new Error(
          "Record the review note confirming this correction is warranted.",
        );
      const o = getOrder(s, c.orderId);
      c.reviewNote = reviewNote.trim();
      c.reviewSnapshot = correctionFingerprint(s, c);
      c.status = "Reviewed";
      c.reviewedAt = now();
      addHandoff(s, {
        kind: "SoftPro correction",
        subject: `${c.correctionKind} · ${o.id}`,
        companyId: o.companyId,
        orderId: o.id,
        sourceId: c.id,
        fingerprint: c.reviewSnapshot,
      });
    },
  );
}
export function recordCorrection(
  s: Workspace,
  correctionId: string,
  correctionReference: string,
  documentId: string,
) {
  return traceMutation(
    s,
    "recordCorrection",
    [correctionId, correctionReference, documentId],
    () => {
      const b = ensure(s),
        c = b.corrections.find((c) => c.id === correctionId);
      if (
        !c ||
        c.status !== "Reviewed" ||
        c.reviewSnapshot !== correctionFingerprint(s, c)
      )
        throw new Error("Review a current correction request first.");
      const doc = orderSources(s, c.orderId).find((d) => d.id === documentId);
      if (
        !correctionReference.trim() ||
        !doc ||
        doc.sourceRole !== "Correction output" ||
        doc.correctionId !== c.id ||
        doc.preparationFingerprint !== c.reviewSnapshot
      )
        throw new Error(
          "Record the correction reference and the current correction document for this request.",
        );
      c.correctionReference = correctionReference.trim();
      c.documentId = documentId;
      c.status = "Recorded";
      c.recordedAt = now();
      const job = b.handoffs.find(
        (j) => j.kind === "SoftPro correction" && j.sourceId === c.id,
      );
      if (job) {
        job.status = "Recorded locally";
        job.reference = c.correctionReference;
        job.note = "Recorded through the policy correction workflow.";
      }
    },
  );
}
export function cancelCorrection(
  s: Workspace,
  correctionId: string,
  reason: string,
) {
  return traceMutation(s, "cancelCorrection", [correctionId, reason], () => {
    const b = ensure(s),
      c = b.corrections.find((c) => c.id === correctionId);
    if (!c || !["Requested", "Reviewed"].includes(c.status))
      throw new Error("Only an open correction request can be cancelled.");
    if (!reason.trim())
      throw new Error("Record why this correction is being cancelled.");
    c.status = "Cancelled";
    c.cancelReason = reason.trim();
    const job = b.handoffs.find(
      (j) => j.kind === "SoftPro correction" && j.sourceId === c.id,
    );
    if (job && job.status === "Awaiting connection") {
      job.status = "Hold";
      job.note = "Correction request cancelled.";
    }
  });
}
export function getOnboarding(s: Workspace, c: Company): OnboardingCase {
  return (
    business(s).onboarding.find((x) => x.companyId === c.id) || {
      companyId: c.id,
      legalName: c.name,
      mailingAddress: "",
      contactEmail: c.email,
      secureApplicationReference: "",
      signatureReference: "",
      applicationStatus: "Not started",
      applicationNote: "",
      requiredUnderwriters: [],
      evidence: [],
      launchedAt: "",
    }
  );
}
/** Select business relationships without inventing approval or contact details. */
export function saveCompanyUnderwriters(s: Workspace, input: { companyId: string; names: string[]; expected: string[] }) {
  return traceMutation(s, "saveCompanyUnderwriters", [input], () => {
    const c = s.companies.find(c => c.id === input.companyId);
    if (!c || !Array.isArray(input.names) || input.names.length > 20 || input.names.some(n => typeof n !== "string" || !n.trim() || n.length > 100)) throw new Error("Choose valid company underwriters.");
    const previous = business(s).onboarding.find(row => row.companyId === c.id);
    if (JSON.stringify(previous?.requiredUnderwriters || []) !== JSON.stringify(input.expected)) throw new Error("Underwriters changed. Reopen company details.");
    const names = [...new Set(input.names.map(n => n.trim()))];
    if (JSON.stringify([...(previous?.requiredUnderwriters || [])].sort()) === JSON.stringify([...names].sort())) return;
    const next = { ...getOnboarding(s, c), requiredUnderwriters: names, launchedAt: "", launchSnapshot: "" };
    next.evidence = next.evidence.filter(e => ![0, 4, 6].includes(e.step));
    c.steps[0] = false; c.steps[4] = false; c.steps[6] = false; c.stage = "Onboarding";
    const b = ensure(s);
    b.onboarding = b.onboarding.filter(row => row.companyId !== c.id);
    b.onboarding.push(next);
  });
}
export function saveApplication(s: Workspace, input: OnboardingCase) {
  return traceMutation(s, "saveApplication", [input], () => {
    const c = s.companies.find((c) => c.id === input.companyId);
    if (!c) throw new Error("Choose a company.");
    if (!input.legalName.trim() || !emailValid(input.contactEmail))
      throw new Error("Enter legal name and valid contact email.");
    if (
      ["Received", "Reviewed"].includes(input.applicationStatus) &&
      !input.secureApplicationReference.trim()
    )
      throw new Error("Record the approved secure application reference.");
    if (
      input.applicationStatus === "Reviewed" &&
      (!input.signatureReference.trim() ||
        !input.applicationNote.trim() ||
        !input.mailingAddress.trim())
    )
      throw new Error(
        "Record mailing address, signature evidence and application review note.",
      );
    const b = ensure(s),
      previous = getOnboarding(s, c);
    const changed =
      JSON.stringify({
        ...input,
        evidence: [],
        launchedAt: "",
        launchSnapshot: "",
      }) !==
      JSON.stringify({
        ...previous,
        evidence: [],
        launchedAt: "",
        launchSnapshot: "",
      });
    const next = {
      ...structuredClone(input),
      evidence: changed
        ? previous.evidence.filter((e) => e.step !== 0 && e.step !== 6)
        : previous.evidence,
      launchedAt: changed ? "" : previous.launchedAt,
      launchSnapshot: changed ? "" : previous.launchSnapshot,
    };
    if (changed) {
      c.steps[0] = false;
      c.steps[6] = false;
      c.stage = "Onboarding";
    }
    b.onboarding = b.onboarding.filter((x) => x.companyId !== c.id);
    b.onboarding.push(next);
  });
}
export function credentialCurrent(r: CredentialRecord, date = today()) {
  return (
    r.status === "Verified locally" &&
    !!r.identifier.trim() &&
    !!r.reference.trim() &&
    !!r.holder.trim() &&
    !!r.reviewer.trim() &&
    (!r.expiresOn || r.expiresOn >= date) &&
    (!r.reviewOn || r.reviewOn >= date)
  );
}
/**
 * Duplicate-company warnings (S01). A pure, explainable comparison of a
 * draft company against the ones already on file — it only ever returns
 * matches with the reason each one matched, so the operator can review them
 * and still create a genuinely distinct JV. Nothing here merges records or
 * blocks creation; that stays a human decision in the create dialog.
 */
export type CompanyMatch = {
  company: Company;
  strength: "exact" | "likely";
  reasons: string[];
};
// Words that appear in nearly every title-company name and so say nothing
// about whether two names refer to the same business.
const companyNoise = new Set([
  "title",
  "titles",
  "llc",
  "inc",
  "co",
  "company",
  "corp",
  "corporation",
  "agency",
  "services",
  "service",
  "group",
  "the",
  "and",
  "of",
  "a",
  "an",
  "jv",
  "joint",
  "venture",
  "insurance",
  "ltd",
  "closing",
  "closings",
]);
// Email domains shared by unrelated businesses; a match there means nothing.
const sharedEmailDomains = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "example.com",
  "example.org",
  "test.com",
]);
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);
const cityOf = (location: string) =>
  location.split(",")[0].trim().toLowerCase();
export function similarCompanies(
  s: Workspace,
  draft: { name: string; contact?: string; email?: string; location?: string },
  excludeId = "",
): CompanyMatch[] {
  const allTokens = words(draft.name);
  const tokens = allTokens.filter((w) => !companyNoise.has(w));
  const contact = words(draft.contact || "").join(" ");
  const email = (draft.email || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  const city = cityOf(draft.location || "");
  const out: CompanyMatch[] = [];
  for (const c of s.companies) {
    if (c.id === excludeId) continue;
    const reasons: string[] = [];
    let strength: CompanyMatch["strength"] = "likely";
    const theirAll = words(c.name);
    const theirs = theirAll.filter((w) => !companyNoise.has(w));
    let nameMatch: "exact" | "similar" | null = null;
    if (tokens.length && theirs.length) {
      const a = new Set(tokens),
        b = new Set(theirs);
      const shared = [...a].filter((w) => b.has(w)).length;
      const dice = (2 * shared) / (a.size + b.size);
      if (dice === 1) nameMatch = "exact";
      else if (
        dice >= 0.5 ||
        (shared > 0 && (shared === a.size || shared === b.size))
      )
        nameMatch = "similar";
    } else if (allTokens.length && allTokens.join(" ") === theirAll.join(" "))
      // Names made only of generic words ("Title Company") match only when
      // they are the same words in the same order.
      nameMatch = "exact";
    if (nameMatch === "exact") {
      reasons.push(
        c.name.trim().toLowerCase() === draft.name.trim().toLowerCase()
          ? "Same name"
          : `Same name once generic words are ignored ("${c.name}")`,
      );
      strength = "exact";
    } else if (nameMatch === "similar")
      reasons.push(`Similar name ("${c.name}")`);
    if (email && c.email.trim().toLowerCase() === email) {
      reasons.push(`Same contact email (${c.email})`);
      strength = "exact";
    } else if (
      domain &&
      !sharedEmailDomains.has(domain) &&
      c.email
        .trim()
        .toLowerCase()
        .endsWith("@" + domain)
    )
      reasons.push(`Same email domain (@${domain})`);
    if (contact && words(c.contact).join(" ") === contact)
      reasons.push(`Same primary contact (${c.contact})`);
    // Same city on its own is not evidence — plenty of distinct JVs share
    // one — but alongside a name or contact match it strengthens the case.
    if (reasons.length && city && cityOf(c.location) === city)
      reasons.push(`Same city (${c.location})`);
    if (reasons.length) out.push({ company: c, strength, reasons });
  }
  return out.sort((a, b) =>
    a.strength === b.strength ? 0 : a.strength === "exact" ? -1 : 1,
  );
}
export function companyProblems(s: Workspace, c: Company, date = today()) {
  const oc = getOnboarding(s, c),
    errors: string[] = [];
  if (oc.applicationStatus !== "Reviewed") errors.push("Reviewed application");
  for (let i = 0; i < 6; i++)
    if (
      !evidenceCurrent(
        s,
        c.id,
        oc.evidence.find((e) => e.step === i),
      )
    )
      errors.push(
        [
          "Application evidence",
          "Formation evidence",
          "EIN evidence",
          "Licensing review",
          "Underwriter approval",
          "Company materials",
        ][i],
      );
  if (!oc.requiredUnderwriters.length) errors.push("Selected underwriter");
  for (const state of c.operatingStates || [c.jurisdiction]) {
    for (const kind of ["Agency license", "Producer credential"])
      if (
        !business(s).credentials.some(
          (r) =>
            r.companyId === c.id &&
            r.state === state &&
            r.kind === kind &&
            credentialCurrent(r, date),
        )
      )
        errors.push(`${state} ${kind}`);
    for (const uw of oc.requiredUnderwriters)
      if (
        !business(s).credentials.some(
          (r) =>
            r.companyId === c.id &&
            r.state === state &&
            r.kind === "Underwriter authority" &&
            r.underwriter === uw &&
            credentialCurrent(r, date),
        )
      )
        errors.push(`${state} ${uw} authority`);
  }
  if (
    !c.members.length ||
    Math.abs(c.members.reduce((n, m) => n + m.share, 0) - 100) > 0.00001
  )
    errors.push("Ownership totaling 100%");
  return errors;
}
export function evidenceCurrent(
  s: Workspace,
  companyId: string,
  e?: OnboardingEvidence,
) {
  return (
    !!e &&
    !!e.reference.trim() &&
    !!e.note.trim() &&
    (!e.documentId ||
      s.documents.some(
        (d) =>
          d.id === e.documentId &&
          d.companyId === companyId &&
          !s.documents.some(
            (n) =>
              n.companyId === companyId &&
              n.orderId === d.orderId &&
              n.name === d.name &&
              n.version > d.version,
          ),
      ))
  );
}
export function recordOnboardingEvidence(
  s: Workspace,
  companyId: string,
  input: Omit<OnboardingEvidence, "reviewer" | "reviewedAt">,
) {
  return traceMutation(
    s,
    "recordOnboardingEvidence",
    [companyId, input],
    () => {
      const c = s.companies.find((c) => c.id === companyId);
      if (!c) throw new Error("Choose a company.");
      const b = ensure(s);
      let oc = b.onboarding.find((x) => x.companyId === companyId);
      if (!oc) {
        oc = getOnboarding(s, c);
        b.onboarding.push(oc);
      }
      if (
        input.step < 0 ||
        input.step > 6 ||
        !Number.isInteger(input.step) ||
        !input.reference.trim() ||
        !input.note.trim()
      )
        throw new Error("Record evidence and a review note.");
      if (
        input.documentId &&
        !evidenceCurrent(s, c.id, {
          ...input,
          reviewer: s.user,
          reviewedAt: now(),
        })
      )
        throw new Error("Choose a current document from this company.");
      if (
        input.step === 2 &&
        !evidenceCurrent(
          s,
          c.id,
          oc.evidence.find((e) => e.step === 1),
        )
      )
        throw new Error(
          "Record formation or existing-entity evidence before the EIN step.",
        );
      if (input.step === 0 && oc.applicationStatus !== "Reviewed")
        throw new Error("Review the application before completing this step.");
      if (input.step === 6 && companyProblems(s, c).length)
        throw new Error(
          `Complete launch checks: ${companyProblems(s, c).join("; ")}.`,
        );
      oc.evidence = oc.evidence.filter((e) => e.step !== input.step);
      oc.evidence.push({ ...input, reviewer: s.user, reviewedAt: now() });
      c.steps[input.step] = true;
      if (input.step === 6) {
        c.stage = "Active";
        oc.launchedAt = now();
        oc.launchSnapshot = launchFingerprint(s, c);
      } else {
        oc.evidence = oc.evidence.filter((e) => e.step !== 6);
        c.steps[6] = false;
        c.stage = "Onboarding";
        oc.launchedAt = "";
      }
    },
  );
}
export function saveCredential(s: Workspace, r: CredentialRecord) {
  return traceMutation(s, "saveCredential", [r], () => {
    const c = s.companies.find((c) => c.id === r.companyId);
    if (!c || !(c.operatingStates || [c.jurisdiction]).includes(r.state))
      throw new Error("Choose an operating state for this company.");
    if (r.kind === "Underwriter authority" && !r.underwriter.trim())
      throw new Error("Name the underwriter for this authority.");
    for (const date of [r.expiresOn, r.reviewOn])
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error("Enter a valid date.");
    if (r.status === "Verified locally" && !credentialCurrent(r))
      throw new Error(
        "Verified records need holder, identifier, evidence, reviewer and current dates.",
      );
    const b = ensure(s);
    if (b.credentials.some((x) => x.id === r.id && x.companyId !== r.companyId))
      throw new Error("An authority record cannot move to another company.");
    b.credentials = b.credentials.filter((x) => x.id !== r.id);
    b.credentials.push({ ...r, id: r.id || id("credential") });
    const oc = b.onboarding.find((x) => x.companyId === c.id);
    if (oc) {
      oc.launchedAt = "";
      oc.evidence = oc.evidence.filter((e) => e.step !== 6);
    }
    c.steps[6] = false;
    c.stage = "Onboarding";
  });
}
export function ledgerLines(
  s: Workspace,
  companyId: string,
  month: string,
): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const o of s.orders.filter((o) => o.companyId === companyId)) {
    const ps = products(s, o.id);
    if (ps.length)
      for (const p of ps.filter(
        (p) =>
          ["Issued", "Delivered"].includes(p.status) && p.issuedMonth === month,
      ))
        lines.push({
          id: p.id,
          orderId: o.id,
          description: `${o.address} · ${p.kind}`,
          premium: p.premium,
          remittance: round(p.premium * p.rate),
          underwriter: o.underwriter,
        });
    else if (o.status === "Issued" && o.month === month)
      lines.push({
        id: o.id,
        orderId: o.id,
        description: `${o.address} · legacy demo total`,
        premium: o.premium,
        remittance: round(o.premium * o.rate),
        underwriter: o.underwriter,
      });
  }
  return lines.sort((a, b) => a.id.localeCompare(b.id));
}
export function closeFingerprint(s: Workspace, c: Company, month: string) {
  return JSON.stringify({
    rows: ledgerLines(s, c.id, month),
    // The ownership that governs this reporting period, which is today's
    // member list only when no dated record covers the month. Editing current
    // members therefore no longer disturbs a close governed by an earlier
    // dated record — but a new record that changes which one governs does.
    members: ownershipForMonth(s, c, month).members,
    expense: s.expenses[`${month}:${c.id}`] || 0,
  });
}
export function newClose(s: Workspace, companyId: string, month: string) {
  return traceMutation(s, "newClose", [companyId, month], () => {
    const c = s.companies.find((c) => c.id === companyId);
    if (!c || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new Error("Choose company and reporting month.");
    const b = ensure(s);
    if (
      b.closes.some(
        (x) =>
          x.companyId === companyId &&
          x.month === month &&
          x.status === "Draft",
      )
    )
      throw new Error("Finish or update the existing draft for this period.");
    const rows = ledgerLines(s, c.id, month),
      premium = round(rows.reduce((n, r) => n + r.premium, 0)),
      remittance = round(rows.reduce((n, r) => n + r.remittance, 0));
    const governing = ownershipForMonth(s, c, month);
    const p: ClosePeriod = {
      id: id("close"),
      companyId,
      companyName: c.name,
      month,
      revision:
        Math.max(
          0,
          ...b.closes
            .filter((x) => x.companyId === companyId && x.month === month)
            .map((x) => x.revision),
        ) + 1,
      status: "Draft",
      sourceHash: closeFingerprint(s, c, month),
      rows: structuredClone(rows),
      members: governing.members,
      ownershipSource: governing.record
        ? { recordId: governing.record.id, effectiveFrom: governing.record.effectiveFrom }
        : null,
      expenses: s.expenses[`${month}:${companyId}`] || 0,
      adjustment: 0,
      reserve: 0,
      externalPremium: premium,
      externalRemittance: remittance,
      booksReference: "",
      agreementReference: "",
      note: "",
      totals: {
        premium,
        remittance,
        retained: round(premium - remittance),
        profit: 0,
        available: 0,
      },
      allocations: [],
      reviewedAt: "",
      reviewedBy: "",
      publishedAt: "",
    };
    b.closes.unshift(p);
    return p;
  });
}
export function closeCalculations(p: ClosePeriod) {
  const premium = round(p.rows.reduce((n, r) => n + r.premium, 0)),
    remittance = round(p.rows.reduce((n, r) => n + r.remittance, 0)),
    retained = round(premium - remittance),
    profit = round(retained - p.expenses + p.adjustment),
    available = round(Math.max(0, profit - p.reserve));
  return { premium, remittance, retained, profit, available };
}
export function reviewClose(s: Workspace, input: ClosePeriod) {
  return traceMutation(s, "reviewClose", [input], () => {
    const p = ensure(s).closes.find((p) => p.id === input.id),
      c = s.companies.find((c) => c.id === p?.companyId);
    if (!p || !c || p.status !== "Draft")
      throw new Error("Only a draft close can be reviewed.");
    if (
      input.sourceHash !== p.sourceHash ||
      input.revision !== p.revision ||
      p.sourceHash !== closeFingerprint(s, c, p.month)
    )
      throw new Error(
        "Source records changed. Refresh this draft before reviewing.",
      );
    for (const n of [
      input.expenses,
      input.reserve,
      input.externalPremium,
      input.externalRemittance,
    ])
      if (!moneyValid(n)) throw new Error("Enter valid nonnegative amounts.");
    if (
      !Number.isFinite(input.adjustment) ||
      Math.abs(input.adjustment) > 100000000
    )
      throw new Error("Enter a valid adjustment.");
    if (
      !input.booksReference.trim() ||
      !input.agreementReference.trim() ||
      !input.note.trim()
    )
      throw new Error("Record books, allocation agreement and review note.");
    const approved = {
      ...p,
      expenses: input.expenses,
      reserve: input.reserve,
      adjustment: round(input.adjustment),
      externalPremium: input.externalPremium,
      externalRemittance: input.externalRemittance,
      booksReference: input.booksReference,
      agreementReference: input.agreementReference,
      note: input.note,
    };
    const totals = closeCalculations(approved);
    if (
      round(input.externalPremium) !== totals.premium ||
      round(input.externalRemittance) !== totals.remittance
    )
      throw new Error(
        "Reconcile premium and remittance differences before approval.",
      );
    const allocations = allocateOwnership(totals.available, p.members);
    if (allocations.length !== p.members.length || !allocations.length)
      throw new Error("Review ownership interests totaling 100%.");
    Object.assign(p, approved, {
      totals,
      allocations,
      status: "Reviewed",
      reviewedAt: now(),
      reviewedBy: s.user,
    });
  });
}
export function refreshClose(s: Workspace, closeId: string) {
  return traceMutation(s, "refreshClose", [closeId], () => {
    const p = ensure(s).closes.find((p) => p.id === closeId),
      c = s.companies.find((c) => c.id === p?.companyId);
    if (!p || !c || p.status !== "Draft")
      throw new Error("Only draft source records can be refreshed.");
    p.rows = structuredClone(ledgerLines(s, c.id, p.month));
    // One resolution drives the captured members, the recorded provenance and
    // the hash. Copying c.members here instead would leave the draft holding
    // today's ownership behind a hash that says the period's ownership is
    // current, and review and publication would then accept it.
    const governing = ownershipForMonth(s, c, p.month);
    p.members = governing.members;
    p.ownershipSource = governing.record
      ? { recordId: governing.record.id, effectiveFrom: governing.record.effectiveFrom }
      : null;
    p.sourceHash = closeFingerprint(s, c, p.month);
    p.expenses = s.expenses[`${p.month}:${c.id}`] || 0;
    p.totals = closeCalculations(p);
  });
}
export function publishClose(s: Workspace, closeId: string) {
  return traceMutation(s, "publishClose", [closeId], () => {
    const b = ensure(s),
      p = b.closes.find((p) => p.id === closeId),
      c = s.companies.find((c) => c.id === p?.companyId);
    if (!p || !c || p.status !== "Reviewed")
      throw new Error("Review this close before publishing.");
    if (p.sourceHash !== closeFingerprint(s, c, p.month))
      throw new Error(
        "The source records changed. Create and review a revised close.",
      );
    if (
      b.closes.some(
        (x) =>
          x.companyId === p.companyId &&
          x.month === p.month &&
          x.status === "Published" &&
          x.revision > p.revision,
      )
    )
      throw new Error("A newer close revision is already published.");
    for (const prior of b.closes)
      if (
        prior.companyId === p.companyId &&
        prior.month === p.month &&
        prior.status === "Published"
      )
        prior.status = "Superseded";
    p.status = "Published";
    p.publishedAt = now();
  });
}
export function addHandoff(
  s: Workspace,
  input: Pick<
    Handoff,
    "kind" | "subject" | "companyId" | "orderId" | "sourceId" | "fingerprint"
  >,
) {
  return traceMutation(s, "addHandoff", [input], () => {
    const b = ensure(s);
    for (const prior of b.handoffs)
      if (
        prior.kind === input.kind &&
        prior.sourceId === input.sourceId &&
        prior.fingerprint !== input.fingerprint &&
        prior.status === "Awaiting connection"
      ) {
        prior.status = "Hold";
        prior.note = "Superseded by a later preparation.";
      }
    const old = b.handoffs.find(
      (j) =>
        j.kind === input.kind &&
        j.sourceId === input.sourceId &&
        j.fingerprint === input.fingerprint,
    );
    if (old) return old;
    const next: Handoff = {
      ...input,
      id: id("handoff"),
      status: "Awaiting connection",
      reference: "",
      note: "",
      createdAt: now(),
    };
    b.handoffs.unshift(next);
    return next;
  });
}
export function saveCPL(s: Workspace, input: CPLRecord) {
  return traceMutation(s, "saveCPL", [input], () => {
    const o = getOrder(s, input.orderId);
    if (["Issued", "Rejected"].includes(o.status))
      throw new Error("This file is no longer open for CPL planning.");
    if (input.decision !== "Review required" && !input.reason.trim())
      throw new Error("Record the reason for this CPL decision.");
    const b = ensure(s);
    const prior = b.cpls.find((x) => x.id === input.id);
    if (
      prior &&
      (prior.orderId !== input.orderId ||
        prior.version !== input.version ||
        ["Returned", "Delivered"].includes(prior.status))
    )
      throw new Error("This CPL record cannot be edited.");
    b.cpls = b.cpls.filter((x) => x.id !== input.id);
    b.cpls.push({
      ...input,
      id: input.id || id("cpl"),
      version: (prior?.version || 0) + 1,
      status: "Draft",
      snapshot: "",
      reference: "",
      documentId: "",
      deliveryReference: "",
    });
  });
}
export function recordCommitmentReturn(
  s: Workspace,
  orderId: string,
  reference: string,
  documentId: string,
) {
  return traceMutation(
    s,
    "recordCommitmentReturn",
    [orderId, reference, documentId],
    () => {
      const o = getOrder(s, orderId),
        c = getCommitment(s, o),
        doc = orderSources(s, orderId).find((d) => d.id === documentId);
      if (
        c.status !== "Prepared" ||
        c.snapshot !== commitmentFingerprint(s, o, c)
      )
        throw new Error("Review and prepare the current commitment first.");
      if (
        !reference.trim() ||
        !doc ||
        doc.sourceRole !== "Commitment output" ||
        doc.productionVersion !== titleFile(o).version ||
        doc.commitmentVersion !== c.version ||
        doc.preparationFingerprint !== c.snapshot
      )
        throw new Error(
          "Record the SoftPro reference and current commitment document.",
        );
      c.returnedReference = reference.trim();
      c.returnedDocumentId = documentId;
      c.status = "Returned";
    },
  );
}
export function handoffCurrent(s: Workspace, j: Handoff) {
  const o = s.orders.find((o) => o.id === j.orderId);
  if (j.kind === "SoftPro commitment")
    return (
      !!o &&
      getCommitment(s, o).status !== "Draft" &&
      j.fingerprint === commitmentFingerprint(s, o)
    );
  if (j.kind === "SoftPro final policy") {
    const p = business(s).policies.find((p) => p.id === j.sourceId);
    return (
      !!o &&
      !!p &&
      ["Prepared", "Issued", "Delivered"].includes(p.status) &&
      (p.status !== "Prepared" || finalReadiness(s, o).ready) &&
      j.fingerprint === finalProductFingerprint(s, o, p)
    );
  }
  if (j.kind === "SoftPro CPL") {
    const cpl = business(s).cpls.find((x) => x.id === j.sourceId);
    return (
      !!o &&
      !!cpl &&
      ["Prepared", "Returned", "Delivered"].includes(cpl.status) &&
      j.fingerprint === cplFingerprint(s, cpl)
    );
  }
  if (j.kind === "SoftPro correction") {
    const c = business(s).corrections.find((x) => x.id === j.sourceId);
    return (
      !!o &&
      !!c &&
      c.status === "Reviewed" &&
      j.fingerprint === correctionFingerprint(s, c)
    );
  }
  if (j.kind === "Missive reply") {
    const r = s.replyDrafts.find((r) => r.id === j.sourceId);
    return (
      !!o &&
      !!r &&
      r.status === "Approved locally" &&
      r.fileVersion === titleFile(o).version &&
      j.fingerprint === JSON.stringify(r) &&
      orderSources(s, o.id).some((d) => d.id === r.attachmentId)
    );
  }
  const c = s.companies.find((c) => c.id === j.companyId);
  return !!c && j.fingerprint === applicationFingerprint(s, c);
}
export function applicationFingerprint(s: Workspace, c: Company) {
  const a = getOnboarding(s, c);
  return JSON.stringify([
    a.legalName,
    a.contactEmail,
    a.mailingAddress,
    a.requiredUnderwriters,
    c.operatingStates || [c.jurisdiction],
  ]);
}
export function validateBusinessMutation(before: Workspace, after: Workspace) {
  validateCompanyWorkspace(after);
  validateMemberIdentityMutation(before, after);
  validateReferencedSourcesMutation(before, after);
  validateStatementDeliveryMutation(before, after);
  validateMaterialsMutation(before, after);
  validateTaskClock(before, after);
  validateDeliveryMutation(before, after);
  validateOwnershipMutation(before, after);
  validateOrchestrationMutation(before, after);
  for (const r of business(before).followups || []) {
    for (const messageId of [
      r.messageId,
      ...r.items.map((i) => i.responseMessageId),
    ].filter(Boolean)) {
      const original = before.inbox.find((m) => m.id === messageId),
        current = after.inbox.find((m) => m.id === messageId);
      if (
        original &&
        (!current ||
          original.orderId !== current.orderId ||
          original.companyId !== current.companyId)
      )
        throw new Error(
          "This message is evidence for an attorney follow-up. Preserve its file routing and capture a separate corrected request.",
        );
    }
  }
  // Field revisions carry the same routing guarantee as loan-amount ones: a
  // message that produced a revision request keeps its original file routing.
  for (const r of [...before.revisions, ...(before.fieldRevisions || [])]) {
    const original = before.inbox.find((m) => m.id === r.messageId);
    const current = after.inbox.find((m) => m.id === r.messageId);
    if (
      original &&
      current &&
      (original.orderId !== current.orderId ||
        original.companyId !== current.companyId ||
        original.kind !== current.kind)
    )
      throw new Error(
        "This message has a linked revision. Preserve its original routing and capture a separate corrected request.",
      );
  }
  for (const p of business(before).policies.filter((p) =>
    ["Issued", "Delivered"].includes(p.status),
  )) {
    const oldOrder = before.orders.find((o) => o.id === p.orderId),
      newOrder = after.orders.find((o) => o.id === p.orderId),
      next = business(after).policies.find((x) => x.id === p.id);
    if (
      !oldOrder ||
      !newOrder ||
      !next ||
      finalProductFingerprint(before, oldOrder, p) !==
        finalProductFingerprint(after, newOrder, next)
    )
      throw new Error(
        "A policy on this file has already issued. Shared source and coverage changes require a separate correction workflow.",
      );
  }
  for (const c of business(before).corrections.filter(
    (c) => c.status !== "Requested",
  )) {
    const next = business(after).corrections.find((x) => x.id === c.id);
    if (
      !next ||
      correctionFingerprint(before, c) !== correctionFingerprint(after, next)
    )
      throw new Error(
        "A reviewed correction's request evidence cannot change. Cancel it and capture a new request instead.",
      );
  }
  for (const o of after.orders) {
    const ps = products(after, o.id);
    if (o.delivered && ps.length && ps.some((p) => p.status !== "Delivered"))
      throw new Error(
        "Record delivery for each policy product before completing order delivery.",
      );
    if (
      o.status === "Issued" &&
      ps.length &&
      ps.some((p) => !["Issued", "Delivered"].includes(p.status))
    )
      throw new Error(
        "Record issuance for every policy product before completing the order.",
      );
  }
  for (const c of after.companies) {
    const previous = before.companies.find((x) => x.id === c.id);
    let oc = business(after).onboarding.find((x) => x.companyId === c.id);
    if (
      previous &&
      JSON.stringify([
        previous.formationState,
        previous.jurisdiction,
        previous.operatingStates,
        previous.members.map(({ name, share }) => ({ name, share })),
      ]) !==
        JSON.stringify([
          c.formationState,
          c.jurisdiction,
          c.operatingStates,
          c.members.map(({ name, share }) => ({ name, share })),
        ])
    ) {
      if (!oc) {
        oc = getOnboarding(after, c);
        ensure(after).onboarding.push(oc);
      }
      oc.evidence = oc.evidence.filter(
        (e) => ![0, 1, 3, 4, 6].includes(e.step),
      );
      oc.applicationStatus =
        oc.applicationStatus === "Reviewed" ? "Received" : oc.applicationStatus;
      c.steps = c.steps.map((v, i) =>
        [0, 1, 3, 4, 6].includes(i) ? false : v,
      );
      c.stage = "Onboarding";
      oc.launchedAt = "";
      if (
        (c.operatingStates || [c.jurisdiction]).includes("SC") &&
        !after.tasks.some(
          (t) =>
            t.companyId === c.id &&
            !t.done &&
            t.title === "Review changed financial interests and authority",
        )
      )
        after.tasks.unshift({
          id: id("task"),
          companyId: c.id,
          title: "Review changed financial interests and authority",
          scope: "agency",
          owner: "John",
          due: today(),
          priority: "High",
          done: false,
        });
    }
    if (
      previous?.stage !== "Active" &&
      c.stage === "Active" &&
      (!oc?.launchedAt || companyProblems(after, c).length)
    )
      throw new Error(
        "Complete the evidence-based launch review before activating this company.",
      );
    if (
      oc?.launchedAt &&
      (oc.launchSnapshot !== launchFingerprint(after, c) ||
        companyProblems(after, c).length ||
        !evidenceCurrent(
          after,
          c.id,
          oc.evidence.find((e) => e.step === 6),
        ))
    ) {
      oc.launchedAt = "";
      c.steps[6] = false;
      c.stage = "Onboarding";
    }
  }
  for (const reply of after.replyDrafts)
    if (
      reply.status === "Approved locally" &&
      before.replyDrafts.find((r) => r.id === reply.id)?.status !==
        "Approved locally"
    ) {
      const o = after.orders.find((o) => o.id === reply.orderId);
      if (o)
        addHandoff(after, {
          kind: "Missive reply",
          subject: `Reply draft · ${o.id}`,
          companyId: o.companyId,
          orderId: o.id,
          sourceId: reply.id,
          fingerprint: JSON.stringify(reply),
        });
    }
  for (const j of business(after).handoffs)
    if (j.status === "Awaiting connection" && !handoffCurrent(after, j)) {
      j.status = "Hold";
      j.note = "Source changed. Prepare a current handoff after review.";
    }
}
export function recordHandoff(
  s: Workspace,
  handoffId: string,
  reference: string,
  note: string,
) {
  return traceMutation(s, "recordHandoff", [handoffId, reference, note], () => {
    const j = ensure(s).handoffs.find((j) => j.id === handoffId);
    if (!j || !handoffCurrent(s, j))
      throw new Error(
        "The handoff source changed. Prepare the current version.",
      );
    if (!reference.trim() || !note.trim())
      throw new Error("Record the external outcome reference and review note.");
    j.reference = reference.trim();
    j.note = note.trim();
    j.status = "Recorded locally";
  });
}

export function launchFingerprint(s: Workspace, c: Company) {
  const oc = getOnboarding(s, c);
  return JSON.stringify({
    company: [
      c.name,
      c.formationState || c.jurisdiction,
      c.operatingStates || [c.jurisdiction],
      c.members.map(({ name, share }) => ({ name, share })),
    ],
    application: [
      oc.legalName,
      oc.mailingAddress,
      oc.contactEmail,
      oc.secureApplicationReference,
      oc.signatureReference,
      oc.requiredUnderwriters,
    ],
    evidence: oc.evidence.filter((e) => e.step !== 6),
    credentials: business(s).credentials.filter((r) => r.companyId === c.id),
  });
}

export function voidDraftPolicy(s: Workspace, policyId: string) {
  return traceMutation(s, "voidDraftPolicy", [policyId], () => {
    const p = ensure(s).policies.find((p) => p.id === policyId);
    if (!p || !["Draft", "Prepared"].includes(p.status))
      throw new Error("Only unissued draft products can be removed.");
    p.status = "Void";
    const o = getOrder(s, p.orderId),
      remaining = products(s, o.id);
    if (
      remaining.length &&
      remaining.every((p) => ["Issued", "Delivered"].includes(p.status))
    ) {
      o.status = "Issued";
      o.premium = round(remaining.reduce((n, p) => n + p.premium, 0));
    }
  });
}

export function cplFingerprint(s: Workspace, c: CPLRecord) {
  const o = getOrder(s, c.orderId);
  return JSON.stringify([
    o.id,
    o.companyId,
    o.jurisdiction,
    o.underwriter,
    o.address,
    titleFile(o).county,
    products(s, o.id)
      .filter((p) => p.kind === "Loan")
      .map((p) => [p.id, p.loanReference, p.loanAmount, p.insured, p.amount]),
    titleFile(o).financing,
    titleFile(o).loanAmount,
    c.id,
    c.version,
    c.party,
    c.recipient,
    c.form,
    c.reason,
    c.decision,
    c.loanReference,
  ]);
}
export function prepareCPL(s: Workspace, cplId: string) {
  return traceMutation(s, "prepareCPL", [cplId], () => {
    const c = ensure(s).cpls.find((c) => c.id === cplId);
    if (
      !c ||
      !["Draft", "Prepared"].includes(c.status) ||
      c.decision !== "Requested" ||
      !c.party.trim() ||
      !emailValid(c.recipient) ||
      !c.form.trim() ||
      !c.reason.trim()
    )
      throw new Error(
        "Save the requested party, recipient, form and decision reason first.",
      );
    const o = getOrder(s, c.orderId);
    if (["Issued", "Rejected"].includes(o.status))
      throw new Error("This file is no longer open for CPL preparation.");
    c.snapshot = cplFingerprint(s, c);
    c.status = "Prepared";
    addHandoff(s, {
      kind: "SoftPro CPL",
      subject: `CPL · ${c.party}`,
      companyId: o.companyId,
      orderId: o.id,
      sourceId: c.id,
      fingerprint: c.snapshot,
    });
  });
}
export function returnCPL(
  s: Workspace,
  cplId: string,
  reference: string,
  documentId: string,
) {
  return traceMutation(s, "returnCPL", [cplId, reference, documentId], () => {
    const c = ensure(s).cpls.find((c) => c.id === cplId);
    if (!c || c.status !== "Prepared" || c.snapshot !== cplFingerprint(s, c))
      throw new Error("Prepare a current CPL request first.");
    const o = getOrder(s, c.orderId),
      doc = orderSources(s, o.id).find((d) => d.id === documentId);
    if (
      !reference.trim() ||
      !doc ||
      doc.sourceRole !== "CPL" ||
      doc.cplId !== c.id ||
      doc.cplVersion !== c.version ||
      doc.preparationFingerprint !== c.snapshot
    )
      throw new Error(
        "Record the returned CPL reference and current recipient document.",
      );
    c.reference = reference.trim();
    c.documentId = documentId;
    c.status = "Returned";
  });
}
export function deliverCPL(s: Workspace, cplId: string, reference: string) {
  return traceMutation(s, "deliverCPL", [cplId, reference], () => {
    const c = ensure(s).cpls.find((c) => c.id === cplId);
    if (
      !c ||
      c.status !== "Returned" ||
      !reference.trim() ||
      c.snapshot !== cplFingerprint(s, c) ||
      !orderSources(s, c.orderId).some((d) => d.id === c.documentId)
    )
      throw new Error("Review the current returned CPL and delivery evidence.");
    c.deliveryReference = reference.trim();
    c.status = "Delivered";
  });
}
export function saveCloseDraft(s: Workspace, input: ClosePeriod) {
  return traceMutation(s, "saveCloseDraft", [input], () => {
    const p = ensure(s).closes.find((p) => p.id === input.id);
    if (!p || p.status !== "Draft" || p.sourceHash !== input.sourceHash)
      throw new Error("Reload the current draft before saving.");
    for (const n of [
      input.expenses,
      input.reserve,
      input.externalPremium,
      input.externalRemittance,
    ])
      if (!moneyValid(n)) throw new Error("Enter valid nonnegative amounts.");
    if (
      !Number.isFinite(input.adjustment) ||
      Math.abs(input.adjustment) > 100000000
    )
      throw new Error("Enter a valid adjustment.");
    Object.assign(p, {
      expenses: input.expenses,
      reserve: input.reserve,
      externalPremium: input.externalPremium,
      externalRemittance: input.externalRemittance,
      adjustment: round(input.adjustment),
      booksReference: input.booksReference,
      agreementReference: input.agreementReference,
      note: input.note,
    });
    p.totals = closeCalculations(p);
  });
}
export function loadDemoScenario(s: Workspace) {
  return traceMutation(s, "loadDemoScenario", [], () => {
    const orderId = "DEMO-COMPLETE-001";
    if (s.orders.some((o) => o.id === orderId)) return orderId;
    const companyId = "demo-training-company";
    if (!s.companies.some((c) => c.id === companyId))
      s.companies.push({
        id: companyId,
        name: "Training Title",
        initials: "TT",
        color: "blue",
        contact: "Avery Example",
        email: "avery@example.com",
        location: "Charlotte, NC",
        jurisdiction: "NC",
        formationState: "NC",
        operatingStates: ["NC"],
        stage: "Onboarding",
        steps: Array(7).fill(false),
        members: [
          { name: "Avery Example", share: 60 },
          { name: "Title Group — sample", share: 40 },
        ],
      });
    const values: Record<string, string> = {
      name: "Jordan Demo, a single person",
      deedDated: "September 8, 2026",
      date: "September 9, 2026",
      time: "2:43 PM",
      reference: "Book DEMO-100 · Page 10",
      loanAmount: "$320,000.00",
      dotDated: "September 8, 2026",
      dotDate: "September 9, 2026",
      dotTime: "2:45 PM",
      dotReference: "Book DEMO-100 · Page 20",
      trustee: "Example Trustee",
    };
    const o: Order = {
      receivedAt: today(),
      id: orderId,
      companyId,
      address: "100 Demonstration Avenue",
      client: "Jordan Demo",
      type: "Purchase",
      underwriter: "WFG",
      owner: "Tyler",
      jurisdiction: "NC",
      status: "New",
      due: today(),
      month: today().slice(0, 7),
      rate: 0.4,
      delivered: false,
      remitted: false,
      premium: 0,
      notes:
        "Fictional end-to-end training case. Review each step; no external system is connected.",
      exception: "",
      fields: fieldDefinitions.map((f) => ({
        id: f.id,
        label: f.label,
        current: "Not captured",
        proposed: values[f.id],
        sourceValue: values[f.id],
        source: "Demo source",
        reviewed: false,
        confidence: "Sample",
      })),
    };
    o.production = {
      ...titleFile(o),
      version: 1,
      securityInstrument: "Deed of trust",
      financing: "Financed",
      loanAmount: 320000,
      purchasePrice: 400000,
      county: "Mecklenburg",
      commitmentReview: undefined,
      attorney: "Example Closing Counsel",
      attorneyEmail: "closings@example.com",
      seller: "Example Seller",
      lender: "Example Lender",
      legalDescription:
        "FICTIONAL: Lot 1 of Demonstration Subdivision. This is not a legal property description.",
      commitmentReference: "DEMO-COMMITMENT-001",
      requirements: [
        {
          id: "demo-requirement",
          kind: "Requirement",
          text: "Review the documented satisfaction of the prior lien.",
          status: "Open",
          evidence: "",
          note: "",
        },
        {
          id: "demo-exception",
          kind: "Exception",
          text: "Illustrative utility easement referenced by the opinion.",
          status: "Open",
          evidence: "",
          note: "",
        },
      ],
    };
    o.production.requirements = o.production.requirements.map((r) => ({
      ...r,
      id: id("requirement"),
      status: "Open",
      evidence: "",
      note: "",
    }));
    s.orders.unshift(o);
    for (const role of [
      "Preliminary opinion",
      "Final opinion",
      "Deed",
      "Deed of trust",
    ] as const) {
      const docId = id("sample-doc");
      const defs = o.fields.filter((f) =>
        role === "Deed"
          ? ["name", "deedDated", "date", "time", "reference"].includes(f.id)
          : role === "Deed of trust"
            ? !["name", "deedDated", "date", "time", "reference"].includes(f.id)
            : false,
      );
      for (const f of defs) {
        f.documentId = docId;
        f.sourcePage = "1";
        f.reviewed = false;
        if (f.id === "name") {
          f.current = "Jordan Demo";
          f.proposed = "Jordan Demo, a single person";
          f.sourceValue = f.proposed;
        }
        f.source = `${role} — fictional sample · page 1`;
      }
      s.documents.push({
        id: docId,
        companyId: o.companyId,
        orderId,
        sourceRole: role,
        name: `DEMO ${role}.txt`,
        category: "Policy documents",
        visibility: "Internal",
        date: today(),
        size: "2 KB",
        version: 1,
        text: `FICTIONAL ${role.toUpperCase()} — NOT A LEGAL DOCUMENT\n\nFile: ${orderId}\nProperty: ${o.address}\n${defs.map((f) => `${f.label}: ${f.sourceValue}`).join("\n")}\n\nSource and legal sufficiency need human review. The requirements in this example start unresolved. No attorney signature, public recording or insurer approval is represented.`,
      });
    }
    const owner = addPolicy(s, orderId, "Owner");
    savePolicy(s, {
      ...owner,
      insured: "Jordan Demo, a single person",
      amount: 400000,
      premium: 1000,
      form: "DEMO owner form — verify actual selection",
      endorsements: "None selected in this example",
    });
    const loan = addPolicy(s, orderId, "Loan");
    savePolicy(s, {
      ...loan,
      insured: "Example Lender",
      loanReference: "DEMO primary loan",
      loanAmount: 320000,
      amount: 320000,
      premium: 250,
      form: "DEMO loan form — verify actual selection",
    });
    const c = getCommitment(s, o);
    saveCommitment(s, {
      ...c,
      ptoDocumentId: orderSources(s, orderId).find(
        (d) => d.sourceRole === "Preliminary opinion",
      )!.id,
    });
    saveCPL(s, {
      id: id("cpl"),
      orderId,
      party: "Example Lender",
      recipient: "closings@example.com",
      form: "",
      reason: "",
      decision: "Review required",
      reference: "",
      documentId: "",
      version: 1,
      loanReference: "DEMO primary loan",
      status: "Draft",
      snapshot: "",
      deliveryReference: "",
    });
    s.inbox.unshift({
      id: id("mail"),
      companyId: o.companyId,
      kind: "Commitment",
      from: "Example Closing Counsel",
      email: "closings@example.com",
      subject: `Preliminary opinion · ${orderId}`,
      body: "Fictional training request: please review the preliminary opinion and prepare a commitment for the owner and lender products. All documents in this case are demonstration fixtures.",
      orderId,
      time: "Sample",
      status: "New",
      attachments: ["DEMO Preliminary opinion.txt"],
      documentIds: [getCommitment(s, o).ptoDocumentId],
    });
    return orderId;
  });
}
export function recordOrderOutcome(
  s: Workspace,
  orderId: string,
  kind: OrderOutcomeKind,
  date: string,
  note: string,
) {
  return traceMutation(
    s,
    "recordOrderOutcome",
    [orderId, kind, date, note],
    () => {
      const o = getOrder(s, orderId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !note.trim())
        throw new Error("Record an event date and supporting reason.");
      if (kind === "Rejected") {
        if (
          o.status === "Issued" ||
          products(s, o.id).some((p) =>
            ["Issued", "Delivered"].includes(p.status),
          )
        )
          throw new Error("Issued files need a separate correction workflow.");
        o.status = "Rejected";
        o.exception = note.trim();
      }
      if (kind === "Recovered") {
        if (o.status !== "Rejected")
          throw new Error("Only a rejected order can be recovered.");
        o.status = o.fields.length ? "Needs review" : "New";
        o.exception = "";
      }
      // Contacted/Recovery lost are recovery-pipeline checkpoints, not status
      // changes — the order stays Rejected either way. A later "Contacted" is
      // still allowed after a "Recovery lost" (recoveryStage below reads
      // whichever of the two happened most recently), since a contact that
      // seemed lost can genuinely resume later.
      if (
        (kind === "Contacted" || kind === "Recovery lost") &&
        o.status !== "Rejected"
      )
        throw new Error(
          "Only a rejected file has an active recovery to track.",
        );
      o.outcomes ??= [];
      o.outcomes.push({ kind, date, note: note.trim(), actor: s.user });
    },
  );
}
export type RecoveryStage = "Not yet contacted" | "Awaiting response" | "Lost";
/**
 * The outcome log in event-date order (oldest first), independent of the
 * order the events were typed in. A call that happened on the 5th can be
 * entered on the 12th; it still belongs on the 5th. Same-date events keep
 * their entry order, so the one entered later is treated as the later one —
 * a stable, predictable tie rule.
 */
export function outcomesByDate(o: Order) {
  return (o.outcomes || [])
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
    .map((x) => x.e);
}
/**
 * Derived, not stored: reads the outcome log in event-date order (not entry
 * order — see outcomesByDate) and returns the stage implied by whichever of
 * Rejected/Contacted/Recovery lost happened last. Returns null once the
 * order is no longer Rejected (recovered, or never rejected) — there's no
 * active recovery to report on.
 */
export function recoveryStage(o: Order): RecoveryStage | null {
  if (o.status !== "Rejected") return null;
  const log = outcomesByDate(o);
  for (let i = log.length - 1; i >= 0; i--) {
    const k = log[i].kind;
    if (k === "Contacted") return "Awaiting response";
    if (k === "Recovery lost") return "Lost";
    if (k === "Rejected") return "Not yet contacted";
  }
  return "Not yet contacted";
}
/**
 * Fills in a receipt date for a legacy order that never had one — see
 * "Legacy records with unknown receipt dates are visibly excluded from
 * receipt counts" in the blueprint. Deliberately backfill-only (an existing
 * date is left alone): correcting a wrong-but-present date would let a
 * report period move after the fact, which is a different, more sensitive
 * change than filling in a genuinely missing one.
 */
export function backfillReceivedDate(
  s: Workspace,
  orderId: string,
  date: string,
) {
  return traceMutation(s, "backfillReceivedDate", [orderId, date], () => {
    const o = getOrder(s, orderId);
    if (o.receivedAt)
      throw new Error(
        "This file already has a receipt date — backfill is only for one that's missing.",
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today())
      throw new Error("Enter a valid, non-future receipt date.");
    o.receivedAt = date;
  });
}
/**
 * Saves (or, matched case-insensitively by name, replaces) a reusable
 * column-mapping template for the accounting CSV import scaffold — see
 * `components/title/accounting-import.tsx`. This only remembers "column X
 * in a file shaped like this means Y" for next time; it never touches a
 * close, ledger or remittance record.
 */
export function saveImportTemplate(
  s: Workspace,
  name: string,
  columnMap: Record<string, ImportTargetField>,
) {
  return traceMutation(s, "saveImportTemplate", [name, columnMap], () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name this mapping before saving it.");
    if (!Object.keys(columnMap).length)
      throw new Error("Map at least one column before saving.");
    s.importTemplates ??= [];
    const existing = s.importTemplates.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) existing.columnMap = columnMap;
    else
      s.importTemplates.push({
        id: uid("import"),
        name: trimmed,
        createdAt: today(),
        columnMap,
      });
  });
}
export function deleteImportTemplate(s: Workspace, id: string) {
  return traceMutation(s, "deleteImportTemplate", [id], () => {
    s.importTemplates = (s.importTemplates || []).filter((t) => t.id !== id);
  });
}
