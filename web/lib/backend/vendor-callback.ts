// Capture before Supabase initializes, so a vendor authorization code cannot be
// mistaken for a Supabase sign-in code. Codes live only in this page's memory.
export const vendorIntentKey = "title-vendor-authorization-v1";
export type VendorIntent = { state: string; provider: "docusign" | "quickbooks"; companyId: string; workspaceId: string; userId: string; accountId: string; expiresAt: string };
export type VendorCallback = { state: string; code: string; realmId: string; denied: boolean; malformed: boolean };
export function readVendorCallback(url: URL): VendorCallback | null {
  const state = url.searchParams.get("state") || "";
  if (!state.startsWith("tv1_")) return null;
  const p = url.searchParams;
  return { state, code: p.get("code") || "", realmId: p.get("realmId") || "", denied: p.has("error"),
    malformed: !/^tv1_[a-f\d]{64}$/.test(state) || (!p.has("error") && !p.get("code")) || ["state", "code", "realmId", "error"].some(k => p.getAll(k).length > 1) ||
      (p.get("code") || "").length > 4096 || (p.get("realmId") || "").length > 30 };
}
export function validVendorIntent(value: unknown, callback: VendorCallback, workspaceId: string, userId: string): value is VendorIntent {
  if (!value || typeof value !== "object") return false;
  const v = value as VendorIntent;
  return !callback.malformed && v.state === callback.state && v.workspaceId === workspaceId && v.userId === userId &&
    ["docusign", "quickbooks"].includes(v.provider) && typeof v.companyId === "string" && v.companyId.length > 0 && v.companyId.length <= 180 &&
    typeof v.accountId === "string" && v.accountId.length <= 36 && Number.isFinite(Date.parse(v.expiresAt)) && Date.parse(v.expiresAt) > Date.now();
}
let captured: VendorCallback | null = null;
export function captureVendorCallback() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href), callback = readVendorCallback(url);
  if (!callback) return;
  captured = callback;
  for (const key of ["code", "state", "realmId", "error", "error_description", "error_uri"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
export function pendingVendorCallback() { return captured; }
export function clearVendorCallback() { captured = null; }
