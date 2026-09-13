import type { Workspace } from "./model";

/** Match recorded names without inventing provider identifiers or aliases. */
export const underwriterKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function remittanceUnderwriters(
  workspace: Workspace,
  ledger: { underwriter: string }[],
): { key: string; name: string }[] {
  const names = new Map<string, string>();
  const add = (name: string, includeMissing = false) => {
    const label = name.trim().replace(/\s+/g, " ");
    const key = underwriterKey(label);
    if ((key || includeMissing) && !names.has(key))
      names.set(key, label || "Underwriter not recorded");
  };
  // Keep ledger obligations visible, including any legacy row lacking a carrier.
  for (const row of ledger) add(row.underwriter, true);
  const companies = new Set(workspace.companies.map((c) => c.id));
  for (const application of workspace.business?.onboarding || [])
    if (companies.has(application.companyId))
      for (const name of application.requiredUnderwriters) add(name);
  for (const credential of workspace.business?.credentials || [])
    if (companies.has(credential.companyId) && credential.kind === "Underwriter authority")
      add(credential.underwriter);
  return [...names].map(([key, name]) => ({ key, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
