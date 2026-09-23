/** Source evidence and review preparation, never a title opinion or business mutation. */
import { checkSourceValue, FIELD_EXTRACTION_LIMITS, suggestSourceFields, type SourceFieldPage, type SourceValueKind } from "./field-extraction";

export type DocumentRole = "deed" | "security" | "title-opinion" | "prior-policy" | "policy" | "company-formation" | "tax-identification" | "ownership" | "company-application" | "other";
export type IntelligenceDocument = { id: string; name: string; version: string | number; pages: SourceFieldPage[] };
export type DocumentEvidence = { documentId: string; documentVersion: string | number; page: number; quote: string; start: number; end: number; method: SourceFieldPage["method"]; confidence?: number };
export type DocumentCandidate = { id: string; rawValue: string; evidence: DocumentEvidence; warnings: string[]; origin: "deterministic" | "proposal" };
export type DocumentField = { fieldId: string; label: string; category: "title" | "company" | "property" | "policy"; status: "missing" | "suggested" | "ambiguous"; candidates: DocumentCandidate[]; warnings: string[] };
export type DocumentClassification = { id: string; name: string; roles: DocumentRole[]; pageRoles: Array<{ page: number; method: SourceFieldPage["method"]; roles: DocumentRole[]; evidence: Array<{ role: DocumentRole; quote: string }> }> };
export type DocumentIntelligenceReview = { documents: DocumentClassification[]; fields: DocumentField[]; warnings: string[] };
type Definition = { id: string; label: string; category: DocumentField["category"]; kind: SourceValueKind | "text" | "ein" | "email" | "percent" | "ownership"; roles?: DocumentRole[]; multiple?: boolean };
const titleFields = [
  ["name", "Vesting / grantee name", "name"], ["deedDated", "Deed dated date", "date"], ["date", "Deed recording date", "date"],
  ["time", "Deed recording time", "time"], ["reference", "Deed recording reference", "reference"], ["loanAmount", "Loan amount", "amount"],
  ["dotDated", "Security instrument dated date", "date"], ["dotDate", "Security instrument recording date", "date"],
  ["dotTime", "Security instrument recording time", "time"], ["dotReference", "Security instrument recording reference", "reference"], ["trustee", "Trustee", "name"],
] as const;
const companyRoles: DocumentRole[] = ["company-formation", "tax-identification", "ownership", "company-application"];
export const DOCUMENT_FIELD_DEFINITIONS: ReadonlyArray<Definition> = [
  ...titleFields.map(([id, label, kind]) => ({ id, label, kind, category: "title" as const })),
  { id: "companyLegalName", label: "Company legal name", category: "company", kind: "name", roles: companyRoles },
  { id: "companyEin", label: "Employer identification number", category: "company", kind: "ein", roles: companyRoles },
  { id: "formationDate", label: "Formation / filing date", category: "company", kind: "date", roles: ["company-formation"] },
  { id: "formationState", label: "Formation state", category: "company", kind: "text", roles: ["company-formation", "company-application"] },
  { id: "registeredAgent", label: "Registered agent", category: "company", kind: "name", roles: ["company-formation"] },
  { id: "companyAddress", label: "Company mailing address", category: "company", kind: "text", roles: companyRoles },
  { id: "companyContact", label: "Company contact", category: "company", kind: "name", roles: ["company-application"] },
  { id: "companyEmail", label: "Company contact email", category: "company", kind: "email", roles: ["company-application"] },
  { id: "memberOwnership", label: "Member and ownership wording", category: "company", kind: "ownership", roles: ["ownership", "company-application"], multiple: true },
  { id: "propertyAddress", label: "Property address", category: "property", kind: "text" },
  { id: "propertyCounty", label: "Property county", category: "property", kind: "name" },
  { id: "parcelId", label: "Parcel / tax identifier", category: "property", kind: "text" },
  { id: "legalDescription", label: "Legal description", category: "property", kind: "text" },
  { id: "opinionAttorney", label: "Opinion attorney", category: "property", kind: "name", roles: ["title-opinion"] },
  { id: "priorPolicyNumber", label: "Policy document number", category: "policy", kind: "text", roles: ["prior-policy", "policy"] },
  { id: "priorPolicyInsured", label: "Policy document insured", category: "policy", kind: "name", roles: ["prior-policy", "policy"] },
  { id: "priorPolicyAmount", label: "Policy document amount", category: "policy", kind: "amount", roles: ["prior-policy", "policy"] },
  { id: "priorPolicyDate", label: "Policy document effective date", category: "policy", kind: "date", roles: ["prior-policy", "policy"] },
  { id: "priorPolicyUnderwriter", label: "Policy document underwriter", category: "policy", kind: "name", roles: ["prior-policy", "policy"] },
];
export const DOCUMENT_INTELLIGENCE_LIMITS = { documents: 100, pages: 1000, characters: 5_000_000, proposals: 128, candidatesPerField: 32, valueCharacters: 2_000 } as const;
const roleRules: Array<[DocumentRole, RegExp]> = [
  ["security", /\b(?:deed\s+of\s+trust|security\s+instrument|mortgage)\b/i],
  ["deed", /\b(?:(?:general|special)\s+warranty\s+deed|warranty\s+deed|quitclaim\s+deed|this\s+deed(?!\s+of\s+trust))\b|^\s*deed\s*$/im],
  ["title-opinion", /\b(?:preliminary|final)\s+(?:opinion\s+of\s+title|title\s+opinion)|\b(?:PTO|FTO)\b/i],
  ["policy", /\b(?:(?:owner[’']?s?|loan|lender[’']?s?)\s+policy\s+(?:of\s+)?title\s+insurance|title\s+insurance\s+policy)\b/i],
  ["prior-policy", /\b(?:prior|previous|existing)\s+(?:owner'?s?\s+|loan\s+|title\s+insurance\s+)?policy\b/i],
  ["company-formation", /\b(?:articles\s+of\s+(?:organization|incorporation)|certificate\s+of\s+formation)\b/i],
  ["tax-identification", /\b(?:employer\s+identification\s+number|CP\s*575|SS-4|147C)\b/i],
  ["ownership", /\b(?:operating\s+agreement|membership\s+(?:interests?|schedule)|ownership\s+(?:schedule|interests?|percentages?))\b/i],
  ["company-application", /\b(?:title\s+agency\s+application|joint\s+venture\s+application|company\s+application)\b/i],
];
const unsafeInstructions = /\b(?:ignore\s+(?:all\s+)?(?:prior|previous)\s+instructions|system\s*prompt|developer\s*message|set\s+\w+\s*=|approve\s+all\s+(?:polic|field))/i;
const literalEmpty = /^(?:unknown|none|n\/?a|tbd|not\s+(?:provided|available)|see\s+(?:attached|exhibit)|[-_]+)$/i;
const key = (text: string) => text.toLowerCase().replace(/[\s/()._–—-]+/g, " ").trim();
const labels = new Map<string, string>();
function label(field: string, values: string[]) { for (const value of values) labels.set(key(value), field); }
label("companyLegalName", ["Company legal name", "Legal company name", "Name of LLC", "Name of limited liability company", "Company name", "Legal name of entity"]);
label("companyEin", ["Employer identification number", "EIN", "Federal tax ID", "FEIN"]);
label("formationDate", ["Date of formation", "Formation date", "Date filed", "Filing date"]);
label("formationState", ["State of formation", "State of organization", "State of incorporation"]);
label("registeredAgent", ["Registered agent", "Name of registered agent"]);
label("companyAddress", ["Company mailing address", "Principal office address", "Principal business address"]);
label("companyContact", ["Company contact", "Primary contact", "Application contact"]);
label("companyEmail", ["Company email", "Primary contact email", "Contact email"]);
label("memberOwnership", ["Member ownership", "Member and ownership interest"]);
label("propertyAddress", ["Property address", "Street address of property", "Premises address"]);
label("propertyCounty", ["Property county", "County where property located"]);
label("parcelId", ["Parcel ID", "Parcel identification number", "Tax parcel number", "Tax ID of property", "PIN"]);
label("legalDescription", ["Legal description", "Description of land", "Description of property"]);
label("opinionAttorney", ["Opinion attorney", "Certifying attorney", "Examining attorney"]);
label("priorPolicyNumber", ["Prior policy number", "Policy number", "Policy no"]);
label("priorPolicyInsured", ["Name of insured", "Insured name", "Named insured", "Prior policy insured"]);
label("priorPolicyAmount", ["Amount of insurance", "Policy amount", "Prior policy amount"]);
label("priorPolicyDate", ["Date of policy", "Policy effective date", "Prior policy date"]);
label("priorPolicyUnderwriter", ["Underwriter", "Issuing title insurer", "Prior policy underwriter"]);

function validateDocuments(documents: IntelligenceDocument[]) {
  if (!Array.isArray(documents) || documents.length > DOCUMENT_INTELLIGENCE_LIMITS.documents) throw new Error("Too many or invalid source documents.");
  const ids = new Set<string>();
  let pages = 0, characters = 0;
  for (const doc of documents) {
    if (!doc || typeof doc.id !== "string" || !doc.id.trim() || doc.id.length > 300 || ids.has(doc.id) || typeof doc.name !== "string" || !doc.name.trim() || doc.name.length > 500 || !(typeof doc.version === "string" && doc.version.length > 0 && doc.version.length <= 160 || typeof doc.version === "number" && Number.isSafeInteger(doc.version) && doc.version > 0)) throw new Error("Invalid or duplicate source document identity.");
    ids.add(doc.id);
    // Reuse the production input boundary, including control characters and OCR metadata.
    if (!Array.isArray(doc.pages) || doc.pages.length > DOCUMENT_INTELLIGENCE_LIMITS.pages) throw new Error("Invalid or excessive source pages.");
    for (const page of doc.pages) suggestSourceFields([], [page]);
    const pageKeys = new Set(doc.pages.map(page => `${page.page}:${page.method}`));
    if (pageKeys.size !== doc.pages.length) throw new Error("Duplicate source page and reading method.");
    pages += doc.pages.length;
    for (const page of doc.pages) characters += page.text.length;
    if (pages > DOCUMENT_INTELLIGENCE_LIMITS.pages || characters > DOCUMENT_INTELLIGENCE_LIMITS.characters) throw new Error("Package exceeds document intelligence review limits.");
  }
}
function classifications(doc: IntelligenceDocument): DocumentClassification {
  const pageRoles = doc.pages.map(page => {
    const evidence: Array<{ role: DocumentRole; quote: string }> = [];
    for (const [role, pattern] of roleRules) {
      const match = pattern.exec(page.text);
      if (match) evidence.push({ role, quote: match[0] });
    }
    return { page: page.page, method: page.method, roles: evidence.length ? evidence.map(item => item.role) : ["other" as const], evidence };
  });
  return { id: doc.id, name: doc.name, roles: [...new Set(pageRoles.flatMap(page => page.roles))], pageRoles };
}
function validValue(def: Definition, value: string) {
  if (!value.trim() || value.length > DOCUMENT_INTELLIGENCE_LIMITS.valueCharacters || literalEmpty.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value) || unsafeInstructions.test(value)) return false;
  if (def.kind === "ein") return /^\d{2}-\d{7}$/.test(value);
  if (def.kind === "email") return /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(value) && value.length <= 254;
  if (def.kind === "percent") return /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/.test(value);
  if (def.kind === "ownership") return /\p{L}/u.test(value) && /\b(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%/.test(value) && !/\b(?:10[1-9]|1[1-9]\d|[2-9]\d{2,})\s*%/.test(value);
  if (def.kind === "text") return /[\p{L}\d]/u.test(value);
  return checkSourceValue(def.kind, value).valid || def.kind === "reference" && checkSourceValue("instrument", value).valid;
}
function addCandidate(row: DocumentField, document: IntelligenceDocument, page: SourceFieldPage, rawValue: string, quote: string, warnings: string[] = [], origin: DocumentCandidate["origin"] = "deterministic") {
  const start = page.text.indexOf(quote);
  if (start < 0 || !quote.includes(rawValue)) throw new Error("Candidate is not grounded in its source page.");
  if (row.candidates.some(item => item.rawValue === rawValue && item.evidence.documentId === document.id && item.evidence.page === page.page && item.evidence.quote === quote && item.evidence.method === page.method)) return;
  if (row.candidates.length >= DOCUMENT_INTELLIGENCE_LIMITS.candidatesPerField) { row.status = "ambiguous"; row.warnings.push("Candidate limit reached; examine the complete sources before choosing a value."); return; }
  const evidence: DocumentEvidence = { documentId: document.id, documentVersion: document.version, page: page.page, quote, start, end: start + quote.length, method: page.method, ...(page.confidence !== undefined ? { confidence: page.confidence } : {}) };
  row.candidates.push({ id: `${encodeURIComponent(document.id)}:${encodeURIComponent(String(document.version))}:${page.page}:${page.method}:${row.fieldId}:${start}:${start + quote.length}:${quote.indexOf(rawValue)}:${rawValue.length}`, rawValue, evidence, warnings: ["Review against the original. This is not an approval or legal determination.", ...warnings], origin });
  if (page.method === "ocr") {
    row.candidates.at(-1)!.warnings.push("OCR confidence is an engine estimate, not field accuracy; compare every character to the image.");
    if (page.confidence === undefined || page.confidence < 80) row.status = "ambiguous";
  }
  if (origin === "proposal") row.status = "ambiguous";
}
function finalize(fields: DocumentField[]) {
  for (const row of fields) {
    const def = DOCUMENT_FIELD_DEFINITIONS.find(item => item.id === row.fieldId)!;
    if (new Set(row.candidates.map(item => item.rawValue)).size > 1 && !def.multiple) {
      row.status = "ambiguous"; row.warnings.push("Different source values found. Resolve their document, effective date, and entity context manually.");
    }
    if (def.multiple && row.candidates.length) {
      row.status = "ambiguous";
      row.warnings.push("Review each member with its ownership wording. No ownership total, current owner, or legal conclusion has been inferred.");
    }
    if (!row.candidates.length) { row.status = "missing"; row.warnings.push("No supported explicit evidence was found; absence does not establish that the fact or requirement is absent."); }
    else if (row.status !== "ambiguous") row.status = "suggested";
    row.warnings = [...new Set(row.warnings)];
  }
}

/** Keep parser work bounded while merging every chunk into the same conflict review. */
function sourcePageChunks(pages: SourceFieldPage[]) {
  const chunks: SourceFieldPage[][] = [];
  let chunk: SourceFieldPage[] = [], characters = 0, lines = 0;
  for (const page of pages) {
    const pageLines = page.text.split(/\r\n|\r|\n/).length;
    if (chunk.length && (chunk.length >= 8 || characters + page.text.length > FIELD_EXTRACTION_LIMITS.characters || lines + pageLines > FIELD_EXTRACTION_LIMITS.lines)) { chunks.push(chunk); chunk = []; characters = 0; lines = 0; }
    chunk.push(page); characters += page.text.length; lines += pageLines;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function analyzeTitleDocuments(documents: IntelligenceDocument[]): DocumentIntelligenceReview {
  validateDocuments(documents);
  // Identical sources produce identical capped candidate sets on client and server,
  // independent of selection order or checkpoint batch arrival order.
  documents = [...documents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(doc => ({ ...doc, pages: [...doc.pages].sort((a, b) => a.page - b.page || a.method.localeCompare(b.method)) }));
  const documentsClassified = documents.map(classifications);
  const fields: DocumentField[] = DOCUMENT_FIELD_DEFINITIONS.map(def => ({ fieldId: def.id, label: def.label, category: def.category, status: "missing", candidates: [], warnings: [] }));
  const rows = new Map(fields.map(row => [row.fieldId, row]));
  for (const document of documents) {
    for (const chunk of sourcePageChunks(document.pages)) for (const suggestion of suggestSourceFields(titleFields.map(([id, label]) => ({ id, label })), chunk)) {
      const row = rows.get(suggestion.fieldId)!;
      if (suggestion.status === "ambiguous" || suggestion.warnings.some(warning => !warning.startsWith("No supported"))) row.status = "ambiguous";
      row.warnings.push(...suggestion.warnings.filter(warning => !warning.startsWith("No supported")));
      for (const candidate of suggestion.candidates) {
        const page = document.pages.find(item => item.page === candidate.page && item.method === candidate.method)!;
        addCandidate(row, document, page, candidate.rawValue, candidate.quote, candidate.warnings);
      }
    }
    for (const page of document.pages) {
      const roles = documentsClassified.find(item => item.id === document.id)!.pageRoles.find(item => item.page === page.page && item.method === page.method)!.roles;
      const accept = (fieldId: string, rawValue: string, quote: string) => {
        const def = DOCUMENT_FIELD_DEFINITIONS.find(item => item.id === fieldId)!;
        if (def.roles && !def.roles.some(role => roles.includes(role))) return;
        const row = rows.get(fieldId)!;
        if (def.category === "policy" && !roles.includes("prior-policy")) {
          row.status = "ambiguous";
          row.warnings.push("Confirm whether this policy is the applicable prior policy. The document's effective date and insured do not establish its current applicability.");
        }
        if (unsafeInstructions.test(quote)) return;
        if (fieldId === "legalDescription" && /^(?:see|refer\s+to|as\s+(?:shown|described|set\s+forth)\s+(?:in|on))\b/i.test(rawValue)) { row.status = "ambiguous"; row.warnings.push("The description points to an exhibit or another source. Capture the complete legal description from that original; the reference alone is not the description."); return; }
        if (!validValue(def, rawValue)) { row.status = "ambiguous"; row.warnings.push("An explicit value has an unsupported or uncertain format. No repair or completion was guessed."); return; }
        const ambiguity = ["date", "time"].includes(def.kind) ? checkSourceValue(def.kind as SourceValueKind, rawValue).ambiguous : undefined;
        if (ambiguity) row.status = "ambiguous";
        addCandidate(row, document, page, rawValue, quote, ambiguity ? [ambiguity] : []);
      };
      const lineMatches = [...page.text.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)].filter(match => match[0].length);
      const lines = lineMatches.map(match => match[1]);
      for (let i = 0; i < lines.length; i++) {
        const found = /^\s*([^:\r\n]{1,100}):\s*(.*)$/.exec(lines[i]);
        if (!found) continue;
        const fieldId = labels.get(key(found[1]));
        if (!fieldId) continue;
        let rawValue = found[2].trim();
        let quote = lines[i];
        if (!rawValue && lines[i + 1]?.trim() && !lines[i + 1].includes(":")) { rawValue = lines[i + 1].trim(); quote = page.text.slice(lineMatches[i].index, lineMatches[i + 1].index + lines[i + 1].length); }
        // Description continuation has no reliable end marker. Never offer a clipped legal description.
        if (fieldId === "legalDescription" && lines[i + 1]?.trim() && !lines[i + 1].includes(":")) { rows.get(fieldId)!.warnings.push("The legal description continues beyond one explicit line. Review the complete exhibit and capture it manually."); rows.get(fieldId)!.status = "ambiguous"; continue; }
        accept(fieldId, rawValue, quote);
      }
      const narrative = (pattern: RegExp, fieldId: string) => { for (const match of page.text.matchAll(pattern)) accept(fieldId, match[1].trim(), match[0]); };
      narrative(/\bthe\s+name\s+of\s+(?:the\s+)?(?:limited\s+liability\s+company|corporation|company)\s+is\s+([^;\n]{1,500})(?=;|\n|$)/gi, "companyLegalName");
      narrative(/\b(?:the\s+company\s+is\s+organized|organized)\s+under\s+the\s+laws\s+of\s+(?:the\s+State\s+of\s+)?(North Carolina|South Carolina|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?=[.;\n]|$)/g, "formationState");
      narrative(/\b(?:the\s+property|the\s+land|premises)\s+(?:is|are)\s+(?:situated|located)\s+in\s+([A-Za-z][A-Za-z .'-]{1,80})\s+County\b/gi, "propertyCounty");
      narrative(/(?:^|\n)([A-Z][^\n;:]{1,200}?\s+(?:owns?|holds?)\s+(?:a\s+)?(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%\s+(?:of\s+the\s+)?(?:membership|ownership)(?:\s+(?:interest|interests))?)(?=[.;\n]|$)/g, "memberOwnership");
    }
  }
  finalize(fields);
  return { documents: documentsClassified, fields, warnings: ["Document/page roles describe explicit text, not instrument validity or completeness. Review all original documents.", "No policy exceptions, requirements, lien priority, releases, ownership conclusions, or approvals are generated automatically."] };
}

export type DocumentProposal = { fieldId: string; rawValue: string; documentId: string; documentVersion: string | number; page: number; method: SourceFieldPage["method"]; quote: string };
/** External/model suggestions are untrusted. Literal grounding is necessary, never proof of the relationship. */
export function validateDocumentProposals(documents: IntelligenceDocument[], proposals: DocumentProposal[]): { accepted: DocumentField[]; rejected: Array<{ index: number; reason: string }> } {
  validateDocuments(documents);
  if (!Array.isArray(proposals) || proposals.length > DOCUMENT_INTELLIGENCE_LIMITS.proposals) throw new Error("Too many or invalid document proposals.");
  const accepted: DocumentField[] = [], rejected: Array<{ index: number; reason: string }> = [];
  const groundedReview = analyzeTitleDocuments(documents);
  proposals.forEach((proposal, index) => {
    const def = proposal && DOCUMENT_FIELD_DEFINITIONS.find(item => item.id === proposal.fieldId);
    const doc = proposal && documents.find(item => item.id === proposal.documentId && item.version === proposal.documentVersion);
    const page = doc?.pages.find(item => item.page === proposal.page && item.method === proposal.method);
    if (!def || !doc || !page || typeof proposal.rawValue !== "string" || typeof proposal.quote !== "string" || !proposal.quote.trim() || proposal.quote.length > FIELD_EXTRACTION_LIMITS.pageCharacters || !page.text.includes(proposal.quote) || !proposal.quote.includes(proposal.rawValue) || !validValue(def, proposal.rawValue) || unsafeInstructions.test(proposal.quote)) {
      rejected.push({ index, reason: "Unknown field, stale source, invalid format, or evidence is not an exact literal source quote/value." }); return;
    }
    // An amount present in a fee or a seller present in a deed is not enough:
    // machine proposals need the same explicit supported relationship as rules.
    const grounded = groundedReview.fields.find(row => row.fieldId === def.id)?.candidates.some(candidate => candidate.evidence.documentId === doc.id && candidate.rawValue === proposal.rawValue && candidate.evidence.page === proposal.page && candidate.evidence.method === proposal.method);
    if (!grounded) { rejected.push({ index, reason: "The source does not establish a supported explicit relationship for this field. Capture it manually against the original." }); return; }
    let row = accepted.find(item => item.fieldId === def.id);
    if (!row) { row = { fieldId: def.id, label: def.label, category: def.category, status: "ambiguous", candidates: [], warnings: [] }; accepted.push(row); }
    addCandidate(row, doc, page, proposal.rawValue, proposal.quote, ["External proposal is untrusted and requires a deliberate source review."], "proposal");
  });
  finalize(accepted);
  return { accepted, rejected };
}

export type CandidateReview = { candidateId: string; fieldId: string; disposition: "accepted" | "corrected" | "rejected"; originalValue: string; reviewedValue?: string; note: string; reviewerId: string; reviewedAt: string; evidence: DocumentEvidence };
/** Returns a review event for a caller to persist; does not approve or update business records. */
export type CandidateReviewInput = { candidateId: string; disposition: CandidateReview["disposition"]; reviewedValue?: string; note: string; reviewerId: string; reviewedAt: string };
function validateCandidateReview(review: DocumentIntelligenceReview, documents: IntelligenceDocument[], current: DocumentIntelligenceReview, input: CandidateReviewInput): CandidateReview {
  const field = review.fields.find(row => row.candidates.some(candidate => candidate.id === input.candidateId));
  const candidate = field?.candidates.find(item => item.id === input.candidateId);
  if (!field || !candidate || !["accepted", "corrected", "rejected"].includes(input.disposition) || typeof input.note !== "string" || !input.note.trim() || input.note.length > 2000 || typeof input.reviewerId !== "string" || !input.reviewerId.trim() || input.reviewerId.length > 160 || !/^\d{4}-\d{2}-\d{2}T/.test(input.reviewedAt) || !Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("A valid candidate, reviewer, review note, and timestamp are required.");
  const doc = documents.find(item => item.id === candidate.evidence.documentId && item.version === candidate.evidence.documentVersion);
  const page = doc?.pages.find(item => item.page === candidate.evidence.page && item.method === candidate.evidence.method);
  if (!page || page.text.slice(candidate.evidence.start, candidate.evidence.end) !== candidate.evidence.quote || !candidate.evidence.quote.includes(candidate.rawValue)) throw new Error("Source changed. Re-read the current document before reviewing a candidate.");
  if (input.disposition === "accepted" && input.reviewedValue !== undefined && input.reviewedValue !== candidate.rawValue) throw new Error("Use a correction when changing the extracted value.");
  const def = DOCUMENT_FIELD_DEFINITIONS.find(item => item.id === field.fieldId);
  if (!def) throw new Error("Unknown review field.");
  const grounded = current.fields.find(row => row.fieldId === field.fieldId)?.candidates.some(item => item.id === candidate.id && item.rawValue === candidate.rawValue && JSON.stringify(item.evidence) === JSON.stringify(candidate.evidence));
  if (!grounded) throw new Error("Candidate changed. Re-read the current document before reviewing.");
  if (input.disposition === "corrected" && (typeof input.reviewedValue !== "string" || !validValue(def, input.reviewedValue))) throw new Error("A correction requires a valid reviewed value and explanation.");
  return { candidateId: candidate.id, fieldId: field.fieldId, disposition: input.disposition, originalValue: candidate.rawValue, ...(input.disposition === "rejected" ? {} : { reviewedValue: input.disposition === "corrected" ? input.reviewedValue : candidate.rawValue }), note: input.note.trim(), reviewerId: input.reviewerId, reviewedAt: input.reviewedAt, evidence: { ...candidate.evidence } };
}

/** Validate a whole review submission once against current sources, avoiding repeated package parsing. */
export function recordCandidateReviews(review: DocumentIntelligenceReview, documents: IntelligenceDocument[], inputs: CandidateReviewInput[]): CandidateReview[] {
  if (!Array.isArray(inputs) || inputs.length > 1000 || inputs.some(input => !input || typeof input.candidateId !== "string") || new Set(inputs.map(input => input.candidateId)).size !== inputs.length) throw new Error("Invalid or duplicate candidate review submission.");
  const current = analyzeTitleDocuments(documents);
  return inputs.map(input => validateCandidateReview(review, documents, current, input));
}
export function recordCandidateReview(review: DocumentIntelligenceReview, documents: IntelligenceDocument[], input: CandidateReviewInput): CandidateReview {
  return recordCandidateReviews(review, documents, [input])[0];
}
