import { newJVApplicant, validateJVApplication, type JVApplication } from "./jv-application";
import type { JVApplicationFillPatch } from "./jv-extraction";

/** Apply only reviewed suggestions, with explicit person mapping and no approval changes. */
export function applyJVApplicationFill(current: JVApplication, patch: JVApplicationFillPatch, sourceDocumentId: string): JVApplication {
  const next = validateJVApplication(current);
  const targets = new Set<string>(), sources = new Set<string>();
  for (const entry of patch.applicants) {
    if (sources.has(entry.sourceApplicantKey)) throw new Error("Choose each source applicant once.");
    sources.add(entry.sourceApplicantKey);
    if (entry.targetApplicantId && targets.has(entry.targetApplicantId)) throw new Error("Map each source applicant to a different person.");
    const index = entry.targetApplicantId ? next.applicants.findIndex(person => person.id === entry.targetApplicantId) : -1;
    if (entry.targetApplicantId && index < 0) throw new Error("The selected applicant changed. Review the mapping again.");
    if (entry.targetApplicantId) targets.add(entry.targetApplicantId);
    const person = index < 0 ? newJVApplicant() : next.applicants[index];
    const updated = { ...person, ...entry.patch, id: person.id };
    if (index < 0) next.applicants.push(updated); else next.applicants[index] = updated;
  }
  if (patch.logoPreferences !== undefined) next.logoPreferences = patch.logoPreferences;
  if (patch.notes !== undefined) next.notes = patch.notes;
  for (const note of patch.sourceNotes || []) {
    if (!next.notes.includes(note)) next.notes = [next.notes, note].filter(Boolean).join("\n\n");
  }
  next.sourceDocumentIds = [...new Set([...next.sourceDocumentIds, sourceDocumentId])];
  return validateJVApplication(next);
}
