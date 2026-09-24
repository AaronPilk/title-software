import { ApiError } from "./workspace";
import type { Workspace } from "../title/model";
import { validateCompanyIntake, validCompanyDisplayName } from "../title/company-intake";
import type { MissiveCheck } from "./missive";
import { missiveRouting, type MissiveRouting } from "./missive-routing";

export type MissiveCompanyRouteProposal = {
  companyId: string; companyName: string; organizationId: string; teamId: string; teamName: string;
};
export type MissiveCompanyRouteReview = {
  revision: number; proposals: MissiveCompanyRouteProposal[]; fingerprint: string; skippedCount: number;
};

const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validName = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const malformedDirectory = (): never => { throw new ApiError("The verified Missive directory is incomplete. Check the connection again before reviewing inbox routes.", 502); };
const malformedCompany = (): never => { throw new ApiError("A saved company inbox source is incomplete. Review the company before connecting its inbox.", 409); };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Proposes local app routing only; makes no provider or database requests.
 * The caller must fetch a fresh verified directory and require an administrator
 * to confirm this exact fingerprint and revision before saving any routes.
 */
export async function proposeMissiveCompanyRoutes(state: Workspace, routing: MissiveRouting, directory: MissiveCheck): Promise<MissiveCompanyRouteReview> {
  const approved = missiveRouting(routing);
  if (!object(directory) || directory.status !== "verified" || directory.importEnabled !== true ||
    typeof directory.checkedAt !== "string" || !Number.isFinite(Date.parse(directory.checkedAt)) ||
    typeof directory.moreOrganizations !== "boolean" || typeof directory.moreTeams !== "boolean" ||
    !Array.isArray(directory.organizations) || directory.organizations.length > 200 ||
    !Array.isArray(directory.teamInboxes) || directory.teamInboxes.length > 200) return malformedDirectory();
  if (directory.moreOrganizations || directory.moreTeams)
    throw new ApiError("The Missive directory is incomplete. Review individual inbox routes before connecting companies.", 409);

  const organizations = new Set<string>();
  for (const organization of directory.organizations) {
    if (!object(organization) || !validId(organization.id) || !validName(organization.name) || organizations.has(organization.id)) return malformedDirectory();
    organizations.add(organization.id);
  }
  const teams = new Map<string, { organizationId: string; name: string }>();
  for (const team of directory.teamInboxes) {
    if (!object(team) || !validId(team.id) || !validId(team.organizationId) || !validName(team.name) ||
      !organizations.has(team.organizationId) || teams.has(team.id)) return malformedDirectory();
    teams.set(team.id, { organizationId: team.organizationId, name: team.name });
  }

  if (!object(state) || !Array.isArray(state.companies) || state.companies.length > 5000) return malformedCompany();
  const companies = new Set<string>();
  const candidates: MissiveCompanyRouteProposal[] = [];
  // Validate all provenance before excluding a record; malformed duplicate source
  // data must not make another company appear to own that inbox unambiguously.
  for (const company of state.companies) {
    if (!object(company) || typeof company.id !== "string" || !company.id || company.id.length > 150 || companies.has(company.id)) return malformedCompany();
    companies.add(company.id);
    if (company.intake === undefined) continue;
    let intake;
    try { intake = validateCompanyIntake(company.intake); } catch { return malformedCompany(); }
    if (!validId(company.id) || typeof company.name !== "string" || !validCompanyDisplayName(company.name)) return malformedCompany();
    candidates.push({ companyId: company.id, companyName: company.name,
      organizationId: intake.organizationId, teamId: intake.teamId, teamName: intake.teamName });
  }

  const sources = new Map<string, number>();
  for (const candidate of candidates) sources.set(candidate.teamId, (sources.get(candidate.teamId) ?? 0) + 1);
  const proposals: MissiveCompanyRouteProposal[] = [];
  for (const candidate of candidates) {
    const team = teams.get(candidate.teamId);
    if (!team || team.organizationId !== candidate.organizationId || sources.get(candidate.teamId) !== 1) continue;
    const existing = approved.mappings.filter(route => route.teamId === candidate.teamId);
    // A paused or stale route to another company remains part of this inbox's
    // identity. Never turn it into a supposedly company-specific feed by omission.
    if (existing.some(route => route.organizationId !== candidate.organizationId || route.companyId !== candidate.companyId || route.enabled)) continue;
    // Names label the review; only exact source IDs above establish the match.
    proposals.push({ companyId: candidate.companyId, companyName: candidate.companyName,
      organizationId: candidate.organizationId, teamId: candidate.teamId, teamName: team.name });
  }
  proposals.sort((a, b) => compare(a.organizationId, b.organizationId) || compare(a.teamId, b.teamId) || compare(a.companyId, b.companyId));
  const canonical = JSON.stringify({ revision: approved.revision, proposals });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const fingerprint = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
  return { revision: approved.revision, proposals, fingerprint, skippedCount: state.companies.length - proposals.length };
}
