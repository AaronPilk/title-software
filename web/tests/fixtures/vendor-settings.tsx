// The component and CSS are real; account context and transport are fictional.
import { useSyncExternalStore } from "react";
import { VendorSettings } from "../../components/title/vendor-settings";
import type { Access } from "../../lib/backend/workspace";
import type { VendorStatus } from "../../lib/backend/vendor-integrations";

type Context = { workspaceId: string; userId: string; role: Access["role"]; version: number; allCompanies: boolean };
type Draft = { requestId: string; envelopeId: string | null; status: string; envelopeStatus: string | null; lastCheckedAt: string | null };
declare global {
  interface Window {
    vendorRequests: { path: string; data: Record<string, unknown> | undefined; method: string; workspaceId: string; userId: string | undefined; timeoutMs: number | undefined }[];
    vendorAppConfigured: boolean;
    vendorConnections: VendorStatus[];
    vendorHoldOperation: string;
    vendorPending: (() => void)[];
    vendorDraftFailures: number;
    vendorErrorOperation: string;
    vendorDrafts: Draft[];
    setVendorContext: (value: Partial<Context>) => void;
  }
}
const accountId = "10000000-0000-4000-8000-000000000001";
let context: Context = { workspaceId: "workspace-one", userId: "owner-one", role: "owner", version: 1, allCompanies: true };
const listeners = new Set<() => void>();
window.vendorRequests = [];
window.vendorAppConfigured = true;
window.vendorPending = [];
window.vendorDraftFailures = 0;
window.vendorDrafts = [];
window.vendorConnections = ["company-a", "company-b"].flatMap(companyId => ["docusign", "quickbooks"].map(provider => ({
  provider, companyId, configured: true, revision: 2, generation: 1, environment: "sandbox", metadata: provider === "docusign" ? { accountId, accountName: `Fictional signatures ${companyId}` } : { realmId: "12345", accountName: `Fictional books ${companyId}` }, connectedAt: "2026-09-23T12:00:00Z", expiresAt: "2030-01-01T12:00:00Z", busy: false,
} as VendorStatus)));
window.setVendorContext = value => { context = { ...context, ...value }; listeners.forEach(listener => listener()); };

export function VendorFixture() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => context);
  const access: Access = { userId: current.userId, email: `${current.userId}@example.test`, role: current.role, version: current.version, allCompanies: current.allCompanies, restricted: true, companyIds: [], partnerMembers: [] };
  return <VendorSettings workspaceId={current.workspaceId} access={access} companies={[{ id: "company-a", name: "Fictional Acorn Title" }, { id: "company-b", name: "Fictional Birch Title" }]} />;
}

export async function backendRequest<T>(path: string, data?: Record<string, unknown>, method = data === undefined ? "GET" : "POST", timeoutMs?: number, workspaceId = "", userId?: string): Promise<T> {
  window.vendorRequests.push({ path, data: structuredClone(data), method, workspaceId, userId, timeoutMs });
  if (userId !== context.userId) throw new Error("Account changed.");
  const operation = path.split("/").at(-1)!;
  if (window.vendorErrorOperation === operation) throw new Error("Synthetic permission denial.");
  const connection = window.vendorConnections.find(row => row.companyId === data?.companyId && row.provider === data?.provider);
  const revision = connection?.revision ?? 0;
  if (connection && !["start", "disconnect"].includes(operation)
    && (data?.expectedGeneration !== connection.generation || Number(data.expectedRevision) > revision))
    throw new Error("Synthetic connection generation changed.");
  let result: unknown;
  if (operation === "vendors") result = { providers: ["docusign", "quickbooks"].map(provider => ({ provider, appConfigured: window.vendorAppConfigured, environment: window.vendorAppConfigured ? "sandbox" : null, redirectUri: window.vendorAppConfigured ? "https://example.test/" : null })), connections: structuredClone(window.vendorConnections) };
  else if (operation === "templates") result = { templates: [{ templateId: accountId, name: "Fictional welcome template", description: "Approved fictional welcome letter." }], hasMore: false, revision };
  else if (operation === "check") result = { verified: true, revision };
  else if (operation === "report") {
    if (connection) connection.revision++;
    result = { revision: connection?.revision ?? revision, report: { realmId: "12345", startDate: data!.startDate, endDate: data!.endDate, accountingMethod: data!.accountingMethod, currency: "USD", generatedAt: "2026-09-23T12:00:00Z", columns: ["", "Total"], rows: [{ kind: "data", depth: 0, cells: [`Private report ${data!.companyId}`, "1250.00"] }] } };
  } else if (operation === "drafts") result = { drafts: structuredClone(window.vendorDrafts), revision };
  else if (operation === "draft") {
    let draft = window.vendorDrafts.find(row => row.requestId === data!.requestId);
    if (!draft) { draft = { requestId: String(data!.requestId), envelopeId: "20000000-0000-4000-8000-000000000002", status: "created", envelopeStatus: "created", lastCheckedAt: null }; window.vendorDrafts.push(draft); }
    if (window.vendorDraftFailures > 0) { window.vendorDraftFailures--; if (connection) connection.revision++; throw new Error("Synthetic connection lost after saving."); }
    result = { draft, revision };
  } else if (operation === "draft-status") {
    const draft = window.vendorDrafts.find(row => row.requestId === data!.requestId);
    if (draft) draft.lastCheckedAt = new Date().toISOString();
    result = draft ? { draft, revision } : { pending: true, revision };
  } else if (operation === "disconnect") {
    if (connection) { connection.configured = false; connection.revision++; }
    result = { revision: connection?.revision ?? revision };
  } else if (operation === "start") result = { url: data?.provider === "quickbooks" ? "https://appcenter.intuit.com/connect/oauth2?state=synthetic" : "https://account-d.docusign.com/oauth/auth?state=synthetic", state: "tv1_" + "a".repeat(64), expiresAt: new Date(Date.now() + 600_000).toISOString() };
  else throw new Error("Unexpected fixture operation.");
  const snapshot = structuredClone(result);
  if (window.vendorHoldOperation === operation) { window.vendorHoldOperation = ""; await new Promise<void>(resolve => window.vendorPending.push(resolve)); }
  return snapshot as T;
}
