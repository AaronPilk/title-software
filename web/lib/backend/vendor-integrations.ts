import { ApiError, type Access } from "./workspace";
import { docusignAuthorizeUrl, exchangeDocusignCode, refreshDocusignToken, listDocusignAccounts, listDocusignTemplates, createDocusignDraft, validateDocusignDraft, getDocusignEnvelope, findDocusignEnvelopeByTransactionId, type DocusignAccount } from "./docusign";
import { quickBooksAuthorizationUrl, exchangeQuickBooksCode, refreshQuickBooksToken, getQuickBooksCompany, getQuickBooksProfitAndLoss } from "./quickbooks";

export type Vendor = "docusign" | "quickbooks";
type Environment = "sandbox" | "production";
type Config = { clientId: string; clientSecret: string; redirectUri: string; environment: Environment };
export type VendorStatus = { provider: Vendor; companyId: string; configured: boolean; revision: number; generation: number; environment: Environment | null; metadata: Record<string, string>; connectedAt: string | null; expiresAt: string | null; busy: boolean };
type Credential = VendorStatus & { tokens: { accessToken: string; refreshToken: string } };
type Claim = Credential & { ok: boolean; leaseId: string; error?: string };
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type VendorContext = { workspaceId: string; access: Access; env: (name: string) => string | undefined; rpc: Rpc; fetcher?: typeof fetch };
function fail(message: string, status = 400): never { throw new ApiError(message, status); }
function text(v: unknown, max = 4096): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) fail("Invalid connection request.");
  return v as string;
}
function revision(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) fail("Refresh connection settings before continuing.", 409);
  return v as number;
}
const id = (v: unknown) => { const value = text(v, 36); if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) fail("Invalid request identifier."); return value; };
function vendor(v: unknown): Vendor { if (v !== "docusign" && v !== "quickbooks") fail("Choose a supported connection."); return v as Vendor; }
function configFor(provider: Vendor, env: VendorContext["env"]): Config | null {
  const prefix = provider.toUpperCase();
  const clientId = env(`${prefix}_CLIENT_ID`), clientSecret = env(`${prefix}_CLIENT_SECRET`), redirectUri = env("TITLE_VENDOR_REDIRECT_URI"), environment = env(`${prefix}_ENVIRONMENT`);
  if (!clientId || !clientSecret || !redirectUri || !["sandbox", "production"].includes(environment || "")) return null;
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
  } catch { return null; }
  return { clientId, clientSecret, redirectUri, environment: environment as Environment };
}
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, "0")).join("");
function tokens(result: { accessToken: string; refreshToken: string }) { return { accessToken: result.accessToken, refreshToken: result.refreshToken }; }
function account(record: Credential): DocusignAccount {
  return { accountId: record.metadata.accountId, name: record.metadata.accountName, baseUri: record.metadata.baseUri, isDefault: false };
}

/** Called only after verified session/password/MFA and fresh workspace access checks. */
export async function vendorRequest(path: string, method: string, input: Record<string, unknown>, ctx: VendorContext): Promise<unknown> {
  const { access, rpc } = ctx, fetcher = ctx.fetcher ?? fetch;
  if (access.role !== "owner" && !(access.role === "admin" && access.allCompanies)) fail("Organization-wide administrator access is required.", 403);
  const base = { p_workspace: ctx.workspaceId, p_actor: access.userId, p_access_version: access.version };
  if (path === "/integrations/vendors" && method === "GET") {
    const connections = await rpc<VendorStatus[]>("title_vendor_list", base);
    return { connections, providers: (["docusign", "quickbooks"] as Vendor[]).map(provider => {
      const config = configFor(provider, ctx.env);
      return { provider, appConfigured: !!config, environment: config?.environment ?? null, redirectUri: config?.redirectUri ?? null };
    }) };
  }
  if (method !== "POST") fail("This connection operation requires POST.", 405);
  if (!["start", "complete", "disconnect", "check", "report", "templates", "drafts", "draft", "draft-status"].some(action => path === `/integrations/vendors/${action}`)) fail("Connection operation not found.", 404);
  const provider = vendor(input.provider), companyId = text(input.companyId, 180);
  if (!/^[-\w .:@]+$/.test(companyId)) fail("Choose an existing company.");
  const common = { ...base, p_provider: provider, p_company: companyId };
  if (path === "/integrations/vendors/disconnect") {
    return rpc("title_vendor_disconnect", { ...common, p_expected: revision(input.expectedRevision) });
  }
  const config = configFor(provider, ctx.env);
  if (!config) fail("Your developer needs to install this vendor's app credentials before you can connect an account.", 409);
  if (path === "/integrations/vendors/start") {
    // Validate account selection before navigating away; only provider-verified accounts are accepted at completion.
    if (provider === "docusign") id(input.accountId);
    const state = "tv1_" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v => v.toString(16).padStart(2, "0")).join("");
    const url = provider === "docusign" ? docusignAuthorizeUrl(config, state) : quickBooksAuthorizationUrl(config, state);
    const started = await rpc<{ expiresAt: string }>("title_vendor_start_oauth", { ...common, p_environment: config.environment, p_expected: revision(input.expectedRevision), p_state_hash: await sha256(state) });
    return { url, state, expiresAt: started.expiresAt };
  }
  if (path === "/integrations/vendors/complete") {
    const state = text(input.state, 68);
    if (!/^tv1_[a-f\d]{64}$/.test(state)) fail("Connection approval expired. Start again from Settings.", 409);
    const claim = await rpc<Claim>("title_vendor_claim_oauth", { ...common, p_state_hash: await sha256(state) });
    if (!claim.ok) fail("Connection approval expired or was already used. Start again from Settings.", 409);
    try {
      if (claim.environment !== config.environment) fail("The vendor environment changed. Start the connection again.", 409);
      if (input.denied === true) fail("Account connection was cancelled. You can try again from Settings.", 409);
      const code = text(input.code);
      const exchanged = provider === "docusign" ? await exchangeDocusignCode(config, code, fetcher) : await exchangeQuickBooksCode(config, code, fetcher);
      let metadata: Record<string, string>;
      if (provider === "docusign") {
        const accounts = await listDocusignAccounts(config, exchanged.accessToken, fetcher);
        const selected = accounts.find(a => a.accountId.toLowerCase() === id(input.accountId).toLowerCase());
        if (!selected) fail("That DocuSign account was not authorized. Check the account ID and reconnect.", 409);
        metadata = { accountId: selected.accountId, accountName: selected.name, baseUri: selected.baseUri };
      } else {
        const company = await getQuickBooksCompany(config, exchanged.accessToken, text(input.realmId, 30), fetcher);
        metadata = { realmId: company.realmId, accountName: company.name };
      }
      return await rpc("title_vendor_finish", { ...common, p_lease: claim.leaseId, p_tokens: tokens(exchanged), p_metadata: metadata, p_expires_at: new Date(Date.now() + exchanged.expiresIn * 1000).toISOString() });
    } catch (error) {
      await rpc("title_vendor_release", { ...common, p_lease: claim.leaseId }).catch(() => undefined);
      throw error;
    }
  }
  const expected = revision(input.expectedRevision);
  let record = await rpc<Credential>("title_vendor_read", common);
  // Token rotation may finish even if its HTTP response was lost. A caller can
  // adopt that newer token revision only within the exact same account consent
  // generation. Reconnect/disconnect changes generation and always fences it.
  const sameGeneration = Number.isSafeInteger(input.expectedGeneration) && input.expectedGeneration === record.generation;
  if (!record.configured || (input.expectedGeneration !== undefined && !sameGeneration) || (record.revision !== expected && (!sameGeneration || expected > record.revision)) || record.environment !== config.environment) fail("The company connection changed or needs to be reconnected. Refresh settings.", 409);
  if (record.busy) fail("This connection is being updated. Wait a moment and refresh.", 409);
  if (!record.expiresAt || Date.parse(record.expiresAt) < Date.now() + 120_000) {
    const priorMetadata = JSON.stringify(record.metadata);
    const refreshRevision = record.revision;
    const claim = await rpc<Claim>("title_vendor_claim_refresh", { ...common, p_expected: refreshRevision });
    if (!claim.ok) fail("This connection is being updated. Wait a moment and refresh.", 409);
    try {
      const refreshed = provider === "docusign" ? await refreshDocusignToken(config, claim.tokens.refreshToken, fetcher) : await refreshQuickBooksToken(config, claim.tokens.refreshToken, fetcher);
      await rpc("title_vendor_finish", { ...common, p_lease: claim.leaseId, p_tokens: tokens(refreshed), p_metadata: claim.metadata, p_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() });
    } catch (error) {
      await rpc("title_vendor_release", { ...common, p_lease: claim.leaseId }).catch(() => undefined);
      throw error;
    }
    record = await rpc<Credential>("title_vendor_read", common);
    if (!record.configured || record.environment !== config.environment || record.revision !== refreshRevision + 1 || JSON.stringify(record.metadata) !== priorMetadata || record.busy) fail("The connection changed. Refresh and try again.", 409);
  }
  const credentialRevision = record.revision;
  async function fresh() {
    const now = await rpc<VendorStatus>("title_vendor_status", common);
    if (!now.configured || now.revision !== credentialRevision || now.busy) fail("The connection changed while reading. Refresh and try again.", 409);
  }
  if (path === "/integrations/vendors/check") {
    const result = provider === "docusign" ? { accounts: (await listDocusignAccounts(config, record.tokens.accessToken, fetcher)).filter(a => a.accountId === record.metadata.accountId) }
      : await getQuickBooksCompany(config, record.tokens.accessToken, record.metadata.realmId, fetcher);
    if ("accounts" in result && !result.accounts.length) fail("The connected DocuSign account is no longer available. Reconnect.", 409);
    await fresh();
    return { verified: true, checkedAt: new Date().toISOString(), accountName: record.metadata.accountName, revision: credentialRevision };
  }
  if (path === "/integrations/vendors/report" && provider === "quickbooks") {
    if (input.accountingMethod !== "Cash" && input.accountingMethod !== "Accrual") fail("Choose Cash or Accrual accounting.");
    const report = await getQuickBooksProfitAndLoss(config, record.tokens.accessToken, record.metadata.realmId, { startDate: text(input.startDate, 10), endDate: text(input.endDate, 10), accountingMethod: input.accountingMethod }, fetcher);
    await fresh(); return { report, revision: credentialRevision };
  }
  if (path === "/integrations/vendors/templates" && provider === "docusign") {
    const result = await listDocusignTemplates(config, record.tokens.accessToken, account(record), fetcher);
    await fresh(); return { ...result, revision: credentialRevision };
  }
  if (path === "/integrations/vendors/drafts" && provider === "docusign") {
    return { drafts: await rpc("title_vendor_list_drafts", common), revision: credentialRevision };
  }
  if (path === "/integrations/vendors/draft" && provider === "docusign") {
    if (input.reviewed !== true) fail("Review the company, template and recipients before creating a draft.");
    const requestId = id(input.requestId);
    if (!Array.isArray(input.roles) || !input.roles.length || input.roles.length > 20) fail("Choose up to 20 template recipients.");
    const payload = validateDocusignDraft({ templateId: id(input.templateId), emailSubject: text(input.emailSubject, 100), roles: input.roles.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid template recipient.");
      const r = value as Record<string, unknown>;
      const email = text(r.email, 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter each recipient's email address.");
      return { roleName: text(r.roleName, 100), name: text(r.name, 100), email };
    }), transactionId: requestId });
    const reserved = await rpc<{ created: boolean; envelopeId?: string }>("title_vendor_reserve_draft", { ...common, p_expected: credentialRevision, p_request: requestId, p_payload_hash: await sha256(JSON.stringify(payload)) });
    if (!reserved.created) return { ...reserved, pending: !reserved.envelopeId, revision: credentialRevision };
    // Never automatically resend on timeout: the reservation survives. Recovery performs a GET by transaction ID.
    const draft = await createDocusignDraft(config, record.tokens.accessToken, account(record), payload, fetcher);
    const result = await rpc("title_vendor_finish_draft", { ...common, p_request: requestId, p_envelope: draft.envelopeId, p_status: draft.status });
    return { draft: result, revision: credentialRevision };
  }
  if (path === "/integrations/vendors/draft-status" && provider === "docusign") {
    const requestId = id(input.requestId);
    const saved = await rpc<{ requestId: string; envelopeId: string | null }>("title_vendor_claim_draft_check", { ...common, p_request: requestId });
    const result = saved.envelopeId ? await getDocusignEnvelope(config, record.tokens.accessToken, account(record), saved.envelopeId, fetcher)
      : await findDocusignEnvelopeByTransactionId(config, record.tokens.accessToken, account(record), requestId, fetcher);
    await fresh();
    if (!result) return { pending: true, message: "No matching envelope was found. Check DocuSign before preparing another draft; this request will not be resent automatically." };
    return { draft: await rpc("title_vendor_finish_draft", { ...common, p_request: requestId, p_envelope: result.envelopeId, p_status: result.status }), revision: credentialRevision };
  }
  fail("Connection operation not found.", 404);
}
