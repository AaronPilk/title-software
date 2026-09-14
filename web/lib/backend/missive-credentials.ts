import { ApiError, type Access } from "./workspace";
import { checkMissiveConnection, type MissiveConfig } from "./missive";

// This record is server-only. Never serialize it into an HTTP response.
export type MissiveCredential = {
  exists: boolean; revision: number; token: string | null; verifiedAt: string | null;
};
export type MissiveCredentialStatus = {
  configured: boolean; revision: number; verifiedAt: string | null;
  source: "workspace" | "environment" | "none";
};
export type MissiveCredentialMetadata = Omit<MissiveCredential, "token"> & { configured: boolean };
export function credentialStatus(record: MissiveCredential | MissiveCredentialMetadata, fallback: MissiveConfig, workspaceId: string): MissiveCredentialStatus {
  const environment = !record.exists && fallback.workspaceId === workspaceId && !!fallback.token;
  return { configured: record.exists ? "configured" in record ? record.configured : !!record.token : environment, revision: record.revision,
    verifiedAt: record.verifiedAt, source: record.exists ? "workspace" : environment ? "environment" : "none" };
}
export function workspaceMissiveConfig(record: MissiveCredential, fallback: MissiveConfig, workspaceId: string): MissiveConfig {
  // A disconnected workspace is a tombstone: never fall back to a global token.
  if (record.exists) return { workspaceId, token: record.token || undefined };
  return fallback.workspaceId === workspaceId ? fallback : { workspaceId };
}
export function credentialChange(input: unknown): { expectedRevision: number; token: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("Invalid connection settings.");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(k => !["workspaceId", "expectedRevision", "token"].includes(k)) ||
      !Number.isSafeInteger(v.expectedRevision) || (v.expectedRevision as number) < 0)
    throw new ApiError("Refresh the connection settings before saving.", 409);
  if (v.token === null) return { expectedRevision: v.expectedRevision as number, token: null };
  if (typeof v.token !== "string" || !/^[A-Za-z0-9_-]{16,4096}$/.test(v.token))
    throw new ApiError("Paste the complete Missive token, including missive_pat- when shown, without spaces or quotation marks.");
  return { expectedRevision: v.expectedRevision as number, token: v.token };
}
export async function verifyCredentialChange(input: unknown, workspaceId: string, access: Access, fetcher: typeof fetch = fetch) {
  if (access.role !== "owner" && !(access.role === "admin" && access.allCompanies))
    throw new ApiError("Organization-wide administrator access is required.", 403);
  const change = credentialChange(input);
  const check = change.token ? await checkMissiveConnection({ token: change.token, workspaceId }, workspaceId, access, fetcher) : null;
  return { change, check };
}
