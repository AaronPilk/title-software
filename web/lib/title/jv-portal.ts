import { newJVApplication, validateJVApplication, type JVApplication } from "./jv-application";

/** Recipient data is private and must never enter workspace snapshots or telemetry. */
export type JVRecipientPayload = Pick<JVApplication, "applicants" | "logoPreferences" | "notes">;
export type JVPortalAttachment = { id: string; name: string; mime: string; bytes: number; sha256: string };
export type JVPortalPublicRecord = {
  id: string; companyName: string; recipientName: string;
  status: "Draft" | "Submitted" | "Changes requested"; version: number; expiresAt: string;
  payload: JVRecipientPayload; attachments: JVPortalAttachment[]; correctionNote: string; submittedAt: string | null;
};
export type JVPortalStaffRecord = {
  id: string; recipientName: string; email: string;
  status: JVPortalPublicRecord["status"] | "Revoked" | "Expired";
  version: number; expiresAt: string; submittedAt: string | null;
  deliveryStatus: "not_sent" | "sending" | "sent" | "failed" | "unknown";
  appliedVersion: number | null; needsMerge: boolean; notificationStatus: string;
};
export const JV_PORTAL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const JV_PORTAL_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const JV_PORTAL_MAX_ATTACHMENTS = 10;
export function newJVRecipientPayload(): JVRecipientPayload {
  const { applicants, logoPreferences, notes } = newJVApplication();
  return { applicants, logoPreferences, notes };
}
export function validateRecipientPayload(value: unknown): JVRecipientPayload {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 3 || Reflect.ownKeys(value).some(key =>
        typeof key !== "string" || !["applicants", "logoPreferences", "notes"].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value")))
    throw new Error("Invalid recipient application.");
  const validated = validateJVApplication({ ...newJVApplication(), ...value });
  return { applicants: validated.applicants, logoPreferences: validated.logoPreferences, notes: validated.notes };
}
