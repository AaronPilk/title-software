import type { Company } from "./model";

export type OperatingConfirmation = {
  status: "Active";
  confirmedBy: string;
  confirmedAt: string;
  note: string;
};

const allowedFields = ["status", "confirmedBy", "confirmedAt", "note"];
const validEmail = (value: string) => value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const forbiddenControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Shape validation only. The command gateway must authorize and stamp the actor. */
export function validateOperatingConfirmation(value: unknown): OperatingConfirmation | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error("Invalid company operating confirmation.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !allowedFields.includes(key)) || row.status !== "Active" ||
      typeof row.confirmedBy !== "string" || !validEmail(row.confirmedBy.trim()) || forbiddenControl.test(row.confirmedBy) ||
      typeof row.confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.confirmedAt) ||
      !Number.isFinite(Date.parse(row.confirmedAt)) || new Date(row.confirmedAt).toISOString() !== row.confirmedAt ||
      typeof row.note !== "string" || !row.note.trim() || row.note.trim().length > 1000 || forbiddenControl.test(row.note))
    throw new Error("Record a valid confirmation actor, timestamp, and note of 1–1,000 characters.");
  return { status: "Active", confirmedBy: row.confirmedBy.trim().toLowerCase(), confirmedAt: row.confirmedAt, note: row.note.trim() };
}

/** Constructs a proposed confirmation, never an authorization or launch approval. */
export function buildOperatingConfirmation(actorEmail: string, note: string, nowIso = new Date().toISOString()): OperatingConfirmation {
  return validateOperatingConfirmation({ status: "Active", confirmedBy: actorEmail, confirmedAt: nowIso, note })!;
}

/** Operating businesses can be active while their workspace records remain incomplete. */
export function companyDisplayStage(company: Pick<Company, "stage" | "operatingStatus">): string {
  try {
    return validateOperatingConfirmation(company.operatingStatus ?? null)?.status ?? company.stage;
  } catch {
    // Legacy malformed metadata cannot manufacture an active-business display.
    return company.stage;
  }
}
