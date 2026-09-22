import type { Access } from "../backend/workspace";

type Connection = { access: Pick<Access, "role" | "allCompanies" | "restricted"> } | undefined;

/** Affordances mirror server action groups. Company scope is enforced by the server. */
const allowed = (connection: Connection, roles: Access["role"][]) =>
  !connection || ["owner", "admin", ...roles].includes(connection.access.role);

export const canManageProduction = (connection: Connection) => allowed(connection, ["operations"]);
export const canManageTasks = (connection: Connection) => allowed(connection, ["operations", "onboarding", "finance"]);
export const canManageCompanies = (connection: Connection) => allowed(connection, ["onboarding"]);
export const canManageFinance = (connection: Connection) => allowed(connection, ["finance"]);
export const canManageAutomations = (connection: Connection) =>
  !connection || connection.access.role === "owner" ||
  (connection.access.role === "admin" && connection.access.allCompanies);
export const canConfirmWorkspaceFinance = (connection: Connection) =>
  canManageFinance(connection) && (!connection || connection.access.allCompanies);
export const canViewOnboardingEvidence = (connection: Connection) => !connection || connection.access.restricted;
export const canManageOnboardingEvidence = (connection: Connection) =>
  canManageCompanies(connection) && canViewOnboardingEvidence(connection);
export const canCreateCompany = (connection: Connection) =>
  canManageCompanies(connection) && (!connection || connection.access.allCompanies);
