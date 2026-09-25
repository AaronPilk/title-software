import { validateCompanyRecords, type CompanyRecords } from "./company-records";
/** Private applicant intake. Never place these values in workspace JSON, logs, or audit metadata. */
export type JVResidence = { id: string; address: string; from: string; to: string };
export type JVEmployment = { id: string; employer: string; role: string; address: string; from: string; to: string };
export type JVApplicant = {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string;
  ssn: string;
  driverLicense: string;
  currentAddress: string;
  ownershipType: "undecided" | "individual" | "business";
  businessName: string;
  businessStatus: "existing" | "forming" | "not-applicable";
  businessReference: string;
  residenceHistory: JVResidence[];
  employmentHistory: JVEmployment[];
};
export type JVStep = {
  id: string;
  status: "Not started" | "In progress" | "Complete" | "Not applicable";
  assignee: string;
  dueDate: string;
  reference: string;
  note: string;
};
export type JVApplication = {
  companyRecords?: CompanyRecords;
  schemaVersion: 1;
  applicants: JVApplicant[];
  logoPreferences: string;
  notes: string;
  sourceDocumentIds: string[];
  steps: JVStep[];
};
export type JVRecord = {
  companyId: string;
  version: number;
  payload: JVApplication;
  status: "Draft" | "Ready for review" | "Reviewed";
  reviewNote: string;
  updatedAt: string | null;
  updatedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  sourceChanged?: boolean;
};

/** These are process deliverables, not automatic legal approval or vendor submissions. */
export const JV_STEPS = [
  { id: "partnership-agreement", title: "Partnership agreement", description: "Record the agreement and its manual review." },
  { id: "domain", title: "Domain", description: "Record the selected domain and registration reference." },
  { id: "secretary-of-state", title: "Secretary of State filing", description: "Record the venture's formation filing and reference." },
  { id: "federal-tax-id", title: "Federal tax ID", description: "Record a secure reference to the federal tax ID documentation." },
  { id: "bank-account", title: "Bank account", description: "Record a secure reference confirming bank account setup." },
  { id: "nipr", title: "NIPR", description: "Track the NIPR application and review reference." },
  { id: "sc-insurance", title: "SC insurance application", description: "Track the South Carolina insurance application." },
  { id: "nc-insurance", title: "NC insurance application", description: "Track the North Carolina insurance application." },
  { id: "underwriters", title: "Underwriter applications", description: "Record application references and the relevant underwriter decisions." },
  { id: "softpro", title: "SoftPro setup", description: "Record the SoftPro setup reference." },
  { id: "website", title: "Website", description: "Record the website and its setup reference." },
  { id: "email", title: "Email", description: "Record the business email setup reference." },
  { id: "business-cards", title: "Business cards", description: "Record approved design or order references." },
  { id: "accounting", title: "Accounting", description: "Record the accounting setup reference." },
  { id: "logo", title: "Logo", description: "Record the approved logo or design reference." },
  { id: "aba", title: "ABA", description: "Record the ABA document and its manual review reference." },
  { id: "buyer-title-preference", title: "Buyer title preference form", description: "Record the buyer title preference form and its review reference." },
] as const;

const applicationKeys = ["schemaVersion", "applicants", "logoPreferences", "notes", "sourceDocumentIds", "steps"];
const applicantKeys = ["id", "name", "email", "phone", "dob", "ssn", "driverLicense", "currentAddress", "ownershipType", "businessName", "businessStatus", "businessReference", "residenceHistory", "employmentHistory"];
const residenceKeys = ["id", "address", "from", "to"];
const employmentKeys = ["id", "employer", "role", "address", "from", "to"];
const stepKeys = ["id", "status", "assignee", "dueDate", "reference", "note"];
const dayMs = 86_400_000;
const invalid = (): never => { throw new Error("Invalid joint-venture application. Check the field formats and limits."); };

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) return invalid();
  if (keys.some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string" || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) return invalid();
  return value.trim();
}

function identifier(value: unknown): string {
  const id = text(value, 150);
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id)) return invalid();
  return id;
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) return invalid();
  return Array.from(value);
}

function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) return invalid();
  return values;
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) return invalid();
  return value as T;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function date(value: unknown): string {
  const result = text(value, 10);
  if (result && !validDate(result)) return invalid();
  return result;
}

function period(row: Record<string, unknown>): { from: string; to: string } {
  const from = date(row.from), to = date(row.to);
  if (from && to && from > to) return invalid();
  return { from, to };
}

function residence(value: unknown): JVResidence {
  const row = record(value, residenceKeys);
  return { id: identifier(row.id), address: text(row.address, 1_000, true), ...period(row) };
}

function employment(value: unknown): JVEmployment {
  const row = record(value, employmentKeys);
  return { id: identifier(row.id), employer: text(row.employer, 200), role: text(row.role, 200), address: text(row.address, 1_000, true), ...period(row) };
}

function applicant(value: unknown): JVApplicant {
  const row = record(value, applicantKeys);
  const email = text(row.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid();
  const dob = date(row.dob);
  if (dob && dob > new Date().toISOString().slice(0, 10)) return invalid();
  const rawSsn = text(row.ssn, 32);
  if (rawSsn && !/^[\d -]+$/.test(rawSsn)) return invalid();
  const ssn = rawSsn.replace(/[ -]/g, "");
  if (rawSsn && (!/^\d{9}$/.test(ssn) || /^(000|666|9\d\d)/.test(ssn) || ssn.slice(3, 5) === "00" || ssn.slice(5) === "0000")) return invalid();
  return {
    id: identifier(row.id), name: text(row.name, 200), email, phone: text(row.phone, 50), dob, ssn,
    driverLicense: text(row.driverLicense, 100), currentAddress: text(row.currentAddress, 1_000, true),
    ownershipType: choice(row.ownershipType, ["undecided", "individual", "business"]),
    businessName: text(row.businessName, 200), businessStatus: choice(row.businessStatus, ["existing", "forming", "not-applicable"]),
    businessReference: text(row.businessReference, 2_000, true),
    residenceHistory: unique(list(row.residenceHistory, 40).map(residence), item => item.id),
    employmentHistory: unique(list(row.employmentHistory, 40).map(employment), item => item.id),
  };
}

function step(value: unknown): JVStep {
  const row = record(value, stepKeys);
  const id = identifier(row.id);
  if (!JV_STEPS.some(item => item.id === id)) return invalid();
  const result: JVStep = {
    id, status: choice(row.status, ["Not started", "In progress", "Complete", "Not applicable"]),
    assignee: text(row.assignee, 200), dueDate: date(row.dueDate), reference: text(row.reference, 2_000, true), note: text(row.note, 4_000, true),
  };
  if ((result.status === "Complete" || result.status === "Not applicable") && !result.reference &&
      !(result.note.replace(/\s+/g, " ").length >= 10 && /[\p{L}\p{N}]/u.test(result.note))) return invalid();
  return result;
}

export function newJVApplicant(id: string = crypto.randomUUID()): JVApplicant {
  return {
    id: identifier(id), name: "", email: "", phone: "", dob: "", ssn: "", driverLicense: "", currentAddress: "",
    ownershipType: "undecided", businessName: "", businessStatus: "not-applicable", businessReference: "",
    residenceHistory: [], employmentHistory: [],
  };
}

export function newJVApplication(): JVApplication {
  return {
    schemaVersion: 1, applicants: [newJVApplicant()], logoPreferences: "", notes: "", sourceDocumentIds: [],
    steps: JV_STEPS.map(item => ({ id: item.id, status: "Not started", assignee: "", dueDate: "", reference: "", note: "" })),
  };
}

/** Returns a detached, canonical shape. Blanks are permitted for drafts; unknown fields are never retained. */
export function validateJVApplication(value: unknown): JVApplication {
  try {
    const extended = !!value && typeof value === "object" && Object.hasOwn(value, "companyRecords");
    const row = record(value, extended ? [...applicationKeys, "companyRecords"] : applicationKeys);
    if (row.schemaVersion !== 1) return invalid();
    const applicants = unique(list(row.applicants, 20).map(applicant), item => item.id);
    const steps = unique(list(row.steps, JV_STEPS.length).map(step), item => item.id);
    if (steps.length !== JV_STEPS.length) return invalid();
    const result: JVApplication = {
      ...(extended ? { companyRecords: validateCompanyRecords(row.companyRecords) } : {}),
      schemaVersion: 1, applicants, logoPreferences: text(row.logoPreferences, 10_000, true), notes: text(row.notes, 10_000, true),
      sourceDocumentIds: unique(list(row.sourceDocumentIds, 100).map(identifier), id => id),
      steps: JV_STEPS.map(item => steps.find(entry => entry.id === item.id)!),
    };
    // Check the submitted representation too, so trimming cannot bypass the transport bound.
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 100_000 || new TextEncoder().encode(JSON.stringify(result)).byteLength > 100_000) return invalid();
    return result;
  } catch {
    // Even a malformed object/accessor/proxy must not get its error text into an HTTP response.
    return invalid();
  }
}

function fiveYearsEarlier(today: string): string {
  const year = Number(today.slice(0, 4)) - 5;
  if (year < 1) return invalid();
  const candidate = `${String(year).padStart(4, "0")}${today.slice(4)}`;
  // The anniversary of Feb 29 falls on Feb 28 in a non-leap year.
  return validDate(candidate) ? candidate : `${String(year).padStart(4, "0")}-02-28`;
}

function coversFiveYears(rows: { from: string; to: string }[], today: string): boolean {
  const start = Date.parse(`${fiveYearsEarlier(today)}T00:00:00.000Z`);
  const end = Date.parse(`${today}T00:00:00.000Z`);
  const ranges = rows.filter(row => row.from).map(row => ({
    from: Math.max(start, Date.parse(`${row.from}T00:00:00.000Z`)),
    to: Math.min(end, Date.parse(`${row.to || today}T00:00:00.000Z`)),
  })).filter(row => row.from <= row.to).sort((a, b) => a.from - b.from || a.to - b.to);
  let nextUncoveredDay = start;
  for (const range of ranges) {
    if (range.from > nextUncoveredDay) return false;
    nextUncoveredDay = Math.max(nextUncoveredDay, range.to + dayMs);
    if (nextUncoveredDay > end) return true;
  }
  return false;
}

/** Completeness for a human review only. A clear result never grants company launch or legal approval. */
export function jvReadiness(payload: JVApplication, today = new Date().toISOString().slice(0, 10)): string[] {
  let app: JVApplication;
  try {
    app = validateJVApplication(payload);
    if (!validDate(today) || Number(today.slice(0, 4)) < 6) return ["The review date is invalid."];
  } catch {
    return ["The application contains invalid fields. Check dates, email, SSN, and field limits."];
  }
  const problems: string[] = [];
  if (!app.applicants.length) problems.push("Add at least one applicant.");
  app.applicants.forEach((person, index) => {
    const label = `Applicant ${index + 1}`;
    const required = [
      ["name", person.name], ["email", person.email], ["phone", person.phone], ["date of birth", person.dob],
      ["SSN", person.ssn], ["driver's license number", person.driverLicense], ["current address", person.currentAddress],
    ];
    for (const [field, value] of required) if (!value) problems.push(`${label}: enter ${field}.`);
    if (person.dob && person.dob > today) problems.push(`${label}: date of birth must not be after the review date.`);
    if (person.phone && person.phone.replace(/\D/g, "").length < 7) problems.push(`${label}: enter a complete phone number.`);
    if (person.ownershipType === "undecided") problems.push(`${label}: choose individual or business ownership.`);
    if (person.ownershipType === "business") {
      if (!person.businessName) problems.push(`${label}: enter the owner business name.`);
      if (person.businessStatus !== "existing") problems.push(`${label}: confirm the owner business is formed. Company process requires the owner LLC to be formed before the venture.`);
      if (!person.businessReference) problems.push(`${label}: add a formation reference for the owner business.`);
    }
    if (person.residenceHistory.some(row => !row.address || !row.from)) problems.push(`${label}: each residence history row needs an address and start date.`);
    if (!coversFiveYears(person.residenceHistory.filter(row => row.address && row.from), today)) problems.push(`${label}: provide residence history covering the full last five years without gaps.`);
    if (person.employmentHistory.some(row => !row.employer || !row.from)) problems.push(`${label}: each employment history row needs an employer or explicit employment status and start date.`);
    if (!coversFiveYears(person.employmentHistory.filter(row => row.employer && row.from), today)) problems.push(`${label}: provide employment history covering the full last five years without gaps; include self-employment, unemployment, or retirement where applicable.`);
  });
  return problems;
}

/** Private comparison value only; this includes sensitive data and is not a hash or an approval token. */
export function jvIntakeFingerprint(payload: JVApplication): string {
  const app = validateJVApplication(payload);
  return JSON.stringify({
    schemaVersion: app.schemaVersion,
    ...(app.companyRecords ? { companyRecords: app.companyRecords } : {}),
    applicants: app.applicants,
    logoPreferences: app.logoPreferences, notes: app.notes, sourceDocumentIds: app.sourceDocumentIds,
  });
}
