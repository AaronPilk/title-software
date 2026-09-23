import type { Company, Workspace } from "./model";
import { similarCompanies } from "./business";

export type MissiveCompanyCandidate = {
  organizationId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
};
export type MissiveCompanyCandidateResponse = {
  candidates: MissiveCompanyCandidate[];
  fetchedAt: string;
  /** A bounded directory response must disclose whether there are more rows. */
  truncated?: boolean;
};
export type CompanyIntakeSource = MissiveCompanyCandidate & {
  source: "missive";
  importedAt: string;
  importedBy: string;
  nameUnverified: boolean;
  profileStatus: "incomplete" | "complete";
};
export type IntakeCompany = Company & { intake: CompanyIntakeSource };

const fields = ["source", "organizationId", "organizationName", "teamId", "teamName", "importedAt", "importedBy", "nameUnverified", "profileStatus"];
const cleanText = (value: unknown, max: number) => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const validId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Shared validation; this is metadata provenance, never an authorization grant. */
export function validateCompanyIntake(value: unknown, expectedActor?: string): CompanyIntakeSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid company intake source.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !fields.includes(key)) || row.source !== "missive" ||
      !validId(row.organizationId) || !validId(row.teamId) ||
      !cleanText(row.organizationName, 200) || !cleanText(row.teamName, 200) ||
      typeof row.importedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.importedAt) ||
      !Number.isFinite(Date.parse(row.importedAt)) || new Date(row.importedAt).toISOString() !== row.importedAt ||
      typeof row.importedBy !== "string" || !validEmail(row.importedBy) ||
      (expectedActor !== undefined && row.importedBy.toLowerCase() !== expectedActor.trim().toLowerCase()) ||
      typeof row.nameUnverified !== "boolean" || !["incomplete", "complete"].includes(String(row.profileStatus)) ||
      (row.profileStatus === "complete" && row.nameUnverified)) {
    throw new Error("Invalid company intake source.");
  }
  return { ...row } as CompanyIntakeSource;
}

export const companyCandidateKey = (candidate: Pick<MissiveCompanyCandidate, "organizationId" | "teamId">) => `${candidate.organizationId}:${candidate.teamId}`;
export function companyCandidateName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
export function validCompanyDisplayName(value: string): boolean {
  return cleanText(value, 100) && /[\p{L}\p{N}]/u.test(value);
}
export function companyProfileMissing(company: Pick<Company, "name" | "contact" | "email" | "location" | "jurisdiction">): string[] {
  const missing: string[] = [];
  if (!validCompanyDisplayName(company.name)) missing.push("company name");
  if (!company.contact.trim()) missing.push("primary contact");
  if (!validEmail(company.email.trim())) missing.push("contact email");
  if (!company.location.trim()) missing.push("city");
  if (!/^[A-Z]{2}$/.test(company.jurisdiction)) missing.push("operating state");
  return missing;
}

/** Builds only an incomplete internal profile. No inferred people or legal facts. */
export function buildCompanyFromCandidate(candidate: MissiveCompanyCandidate, input: {
  id: string; name?: string; importedAt: string; importedBy: string; color?: string;
}): IntakeCompany {
  const name = companyCandidateName(input.name ?? candidate.teamName);
  if (!validCompanyDisplayName(name)) throw new Error("Enter a company display name of 1–100 characters.");
  if (!cleanText(input.id, 150)) throw new Error("Invalid company identifier.");
  const intake = validateCompanyIntake({ ...candidate, source: "missive", importedAt: input.importedAt, importedBy: input.importedBy, nameUnverified: true, profileStatus: "incomplete" });
  return {
    id: input.id, name,
    initials: name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase(),
    color: ["teal", "blue", "violet", "amber", "rose"].includes(input.color || "") ? input.color! : "blue",
    contact: "", email: "", location: "", jurisdiction: "", operatingStates: [],
    stage: "Onboarding", steps: Array(7).fill(false), members: [], intake,
  };
}

export function parseCompanyCandidateResponse(value: unknown): MissiveCompanyCandidateResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The Missive company directory could not be read.");
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.candidates) || result.candidates.length > 500 || typeof result.fetchedAt !== "string" ||
      !Number.isFinite(Date.parse(result.fetchedAt)) || (result.truncated !== undefined && typeof result.truncated !== "boolean")) {
    throw new Error("The Missive company directory is incomplete. Refresh and try again.");
  }
  const seen = new Set<string>();
  const candidates = result.candidates.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Missive company candidate.");
    const row = value as Record<string, unknown>;
    if (!validId(row.organizationId) || !validId(row.teamId) || !cleanText(row.organizationName, 200) || !cleanText(row.teamName, 200)) throw new Error("Invalid Missive company candidate.");
    const candidate: MissiveCompanyCandidate = { organizationId: row.organizationId as string, organizationName: row.organizationName as string, teamId: row.teamId as string, teamName: row.teamName as string };
    const key = companyCandidateKey(candidate);
    if (seen.has(key)) throw new Error("Missive returned the same inbox twice. Refresh the directory before importing.");
    seen.add(key);
    return candidate;
  });
  return { candidates, fetchedAt: result.fetchedAt, ...(result.truncated ? { truncated: true } : {}) };
}

/** Fingerprints the exact names and matches the operator has actually reviewed. */
export function companyIntakeReview(workspace: Workspace, selected: { candidate: MissiveCompanyCandidate; name: string }[]) {
  const rows = selected.map(entry => {
    const name = companyCandidateName(entry.name);
    const existingSource = workspace.companies.find(company => company.intake && companyCandidateKey(company.intake) === companyCandidateKey(entry.candidate));
    const matches = similarCompanies(workspace, { name });
    const normalized = name.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const aliases = selected.filter(other => companyCandidateKey(other.candidate) !== companyCandidateKey(entry.candidate) &&
      companyCandidateName(other.name).toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim() === normalized);
    return { ...entry, name, existingSource, matches, aliases };
  });
  const signature = JSON.stringify(rows.map(row => ({
    key: companyCandidateKey(row.candidate), name: row.name,
    source: row.candidate,
    existingSource: row.existingSource?.id,
    matches: row.matches.map(match => ({ id: match.company.id, name: match.company.name, strength: match.strength, reasons: match.reasons })),
    aliases: row.aliases.map(alias => companyCandidateKey(alias.candidate)),
  })).sort((a, b) => a.key.localeCompare(b.key)));
  return { rows, signature, canCreate: rows.length > 0 && rows.every(row => validCompanyDisplayName(row.name) && !row.existingSource && !row.aliases.length) };
}
