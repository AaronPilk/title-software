// Real return component and callback parser; only the backend and account context are synthetic.
import { useSyncExternalStore } from "react";
import { VendorOAuthReturn } from "../../components/title/vendor-oauth-return";
import { captureVendorCallback, pendingVendorCallback, vendorIntentKey } from "../../lib/backend/vendor-callback";
import type { Access } from "../../lib/backend/workspace";

type Context = { workspaceId: string; userId: string; version: number; mount: number };
type Seed = { intent: string | null; hold?: boolean; error?: string; context?: Partial<Context> };
type Request = { path: string; data: unknown; method: string; timeout: number | undefined; workspaceId: string | undefined; userId: string | undefined };
declare global {
  interface Window {
    oauthReturnSeed: Seed;
    oauthReturnRequests: Request[];
    oauthReturnContext: (value: Partial<Context>) => void;
    oauthReturnComplete: (error?: string) => void;
    oauthReturnSnapshot: () => { pending: ReturnType<typeof pendingVendorCallback>; stored: string | null; href: string };
  }
}
const seed = window.oauthReturnSeed;
let context: Context = { workspaceId: "workspace-one", userId: "owner-one", version: 1, mount: 1, ...seed.context };
const listeners = new Set<() => void>();
window.oauthReturnRequests = [];
window.oauthReturnContext = patch => { context = { ...context, ...patch }; listeners.forEach(listener => listener()); };
window.oauthReturnComplete = () => { throw Error("No pending synthetic request"); };
if (seed.intent !== null) sessionStorage.setItem(vendorIntentKey, seed.intent);
captureVendorCallback();
window.oauthReturnSnapshot = () => ({ pending: pendingVendorCallback(), stored: sessionStorage.getItem(vendorIntentKey), href: location.href });

export function VendorOAuthReturnFixture() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => context);
  const access: Access = { userId: current.userId, email: `${current.userId}@example.test`, role: "owner", version: current.version,
    allCompanies: true, companyIds: [], restricted: true, partnerMembers: [] };
  return <><p data-testid="current-account">{current.userId}</p><VendorOAuthReturn key={current.mount} workspaceId={current.workspaceId} access={access} /></>;
}
export async function backendRequest<T>(path: string, data?: unknown, method = "POST", timeout?: number, workspaceId?: string, userId?: string): Promise<T> {
  window.oauthReturnRequests.push({ path, data: structuredClone(data), method, timeout, workspaceId, userId });
  if (seed.hold) {
    return new Promise<T>((resolve, reject) => {
      window.oauthReturnComplete = error => { if (error) reject(new Error(error)); else resolve({ connected: true } as T); };
    });
  }
  if (seed.error) throw new Error(seed.error);
  return { connected: true } as T;
}
