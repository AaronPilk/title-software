import { ApiError } from "./workspace";

/** Server-only provider transport. Callers enforce workspace access and persist OAuth state/tokens. */
export type DocusignConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
};
export type DocusignTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type DocusignAccount = { accountId: string; name: string; isDefault: boolean; baseUri: string };
export type DocusignTemplate = { templateId: string; name: string; description: string };
export type DocusignDraftInput = {
  templateId: string;
  emailSubject: string;
  roles: { roleName: string; name: string; email: string }[];
  transactionId: string;
};
export type DocusignEnvelopeStatus = { envelopeId: string; status: string; statusChangedAt: string | null };

const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TOKEN = /^[\x21-\x7e]{1,16384}$/;
const STATE = /^[A-Za-z0-9_-]{32,256}$/;
const MAX_BYTES = 1_000_000;
const PAGE_SIZE = 100;
// userinfo supplies the account's origin. Never use arbitrary provider-supplied URLs.
// A new region must be reviewed and added here before any bearer token goes to it.
const PRODUCTION_HOSTS = new Set([
  "www.docusign.net", "na2.docusign.net", "na3.docusign.net", "na4.docusign.net",
  "ca.docusign.net", "eu.docusign.net", "au.docusign.net",
]);
const ENVELOPE_STATUSES = new Set([
  "created", "sent", "delivered", "signed", "completed", "declined", "voided",
  "deleted", "timedout", "processing", "correct",
]);

function invalidResponse(): never {
  throw new ApiError("DocuSign returned an unexpected response. Check the connection before trying again.", 502);
}
function invalidInput(): never { throw new ApiError("The DocuSign request contains invalid information.", 400); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}
function responseText(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalidResponse();
  return value;
}
function inputText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalidInput();
  return value.trim();
}
function guid(value: unknown, response = false): string {
  if (typeof value !== "string" || !GUID.test(value)) {
    if (response) invalidResponse();
    invalidInput();
  }
  return value.toLowerCase();
}
function token(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value))
    throw new ApiError("Reconnect DocuSign before using this connection.", 409);
  return value;
}
function validateConfig(config: DocusignConfig): string {
  if (!config || !["sandbox", "production"].includes(config.environment)
    || typeof config.clientId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(config.clientId)
    || typeof config.clientSecret !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(config.clientSecret))
    throw new ApiError("DocuSign application setup is incomplete.", 409);
  let redirect: URL;
  try { redirect = new URL(config.redirectUri); } catch {
    throw new ApiError("DocuSign has an invalid callback address.", 409);
  }
  if (typeof config.redirectUri !== "string" || config.redirectUri.length > 2048
    || redirect.username || redirect.password || redirect.hash
    || (redirect.protocol !== "https:" && !(config.environment === "sandbox" && redirect.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname))))
    throw new ApiError("DocuSign has an invalid callback address.", 409);
  return config.environment === "sandbox" ? "https://account-d.docusign.com" : "https://account.docusign.com";
}
function baseUri(value: unknown, environment: DocusignConfig["environment"]): string {
  if (typeof value !== "string" || value.length > 300) invalidResponse();
  let url: URL;
  try { url = new URL(value); } catch { invalidResponse(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || !["/", "/restapi", "/restapi/"].includes(url.pathname)
    || value.replace(/\/restapi\/?$/, "").replace(/\/$/, "") !== url.origin
    || !(environment === "sandbox" ? url.hostname === "demo.docusign.net" : PRODUCTION_HOSTS.has(url.hostname)))
    throw new ApiError("DocuSign returned an unsupported account location. Review the account environment before connecting.", 502);
  return url.origin;
}
function accountUrl(config: DocusignConfig, account: DocusignAccount): string {
  validateConfig(config);
  if (!account || typeof account !== "object") invalidInput();
  return `${baseUri(account.baseUri, config.environment)}/restapi/v2.1/accounts/${guid(account.accountId)}`;
}

function beforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(new Error("DocuSign deadline reached."));
  }
  return new Promise((resolve, reject) => {
    const abort = () => { reject(new Error("DocuSign deadline reached.")); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

async function requestJson(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(20_000);
  let response: Response;
  try {
    response = await beforeDeadline(fetcher(url, { ...init, redirect: "error", signal, cache: "no-store" }), signal);
  } catch {
    throw new ApiError("DocuSign could not complete the request. Check the connection before trying again.", 502);
  }
  if (response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    invalidResponse();
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403)
      throw new ApiError("DocuSign did not accept this connection. Reconnect and check the account permissions.", 409);
    if (response.status === 429)
      throw new ApiError("DocuSign's request limit was reached. Wait before trying again.", 429);
    if (response.status === 404) throw new ApiError("DocuSign could not find the requested template or envelope in this account.", 404);
    if (response.status === 400 || response.status === 422)
      throw new ApiError("DocuSign rejected the request. Check the account, template roles, and connection setup.", 400);
    throw new ApiError("DocuSign could not complete the request. Check the connection before trying again.", 502);
  }
  // Content-Length is only an early guard; the decoded stream is always counted.
  const claimedSize = response.headers.get("content-length");
  if (claimedSize !== null && (!/^\d+$/.test(claimedSize) || Number(claimedSize) > MAX_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    invalidResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) invalidResponse();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await beforeDeadline(reader.read(), signal);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => undefined); invalidResponse(); }
      chunks.push(result.value);
    }
  } catch { void reader.cancel().catch(() => undefined); invalidResponse(); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
  return object(parsed);
}

/** The caller must generate, bind, expire, and consume state once before exchanging the code. */
export function docusignAuthorizeUrl(config: DocusignConfig, state: string): string {
  const origin = validateConfig(config);
  if (typeof state !== "string" || !STATE.test(state)) invalidInput();
  const url = new URL(`${origin}/oauth/auth`);
  url.search = new URLSearchParams({
    response_type: "code", scope: "signature extended", client_id: config.clientId,
    redirect_uri: config.redirectUri, state,
  }).toString();
  return url.toString();
}
async function exchange(config: DocusignConfig, grant: "authorization_code" | "refresh_token", value: string, fetcher: typeof fetch): Promise<DocusignTokens> {
  const origin = validateConfig(config);
  if (typeof value !== "string" || !TOKEN.test(value)) invalidInput();
  const body = new URLSearchParams({ grant_type: grant, [grant === "authorization_code" ? "code" : "refresh_token"]: value });
  if (grant === "authorization_code") body.set("redirect_uri", config.redirectUri);
  const result = await requestJson(`${origin}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}` },
    body: body.toString(),
  }, fetcher);
  if (typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer"
    || typeof result.access_token !== "string" || !TOKEN.test(result.access_token)
    || typeof result.refresh_token !== "string" || !TOKEN.test(result.refresh_token)
    || typeof result.expires_in !== "number" || !Number.isSafeInteger(result.expires_in)
    || result.expires_in < 1 || result.expires_in > 86_400) invalidResponse();
  if (result.scope !== undefined && (typeof result.scope !== "string" || result.scope.length > 1000
    || !result.scope.split(/\s+/).includes("signature"))) invalidResponse();
  return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in };
}
export async function exchangeDocusignCode(config: DocusignConfig, code: string, fetcher: typeof fetch = fetch): Promise<DocusignTokens> {
  return exchange(config, "authorization_code", code, fetcher);
}
export async function refreshDocusignToken(config: DocusignConfig, refreshToken: string, fetcher: typeof fetch = fetch): Promise<DocusignTokens> {
  return exchange(config, "refresh_token", refreshToken, fetcher);
}
function authorization(accessToken: string): Record<string, string> {
  return { Accept: "application/json", Authorization: `Bearer ${token(accessToken)}` };
}
export async function listDocusignAccounts(config: DocusignConfig, accessToken: string, fetcher: typeof fetch = fetch): Promise<DocusignAccount[]> {
  const result = await requestJson(`${validateConfig(config)}/oauth/userinfo`, { method: "GET", headers: authorization(accessToken) }, fetcher);
  if (!Array.isArray(result.accounts) || result.accounts.length > 100) invalidResponse();
  const accounts = result.accounts.map(value => {
    const row = object(value);
    if (typeof row.is_default !== "boolean") invalidResponse();
    return { accountId: guid(row.account_id, true), name: responseText(row.account_name, 500), isDefault: row.is_default, baseUri: baseUri(row.base_uri, config.environment) };
  });
  if (new Set(accounts.map(account => account.accountId)).size !== accounts.length) invalidResponse();
  return accounts;
}
export async function listDocusignTemplates(config: DocusignConfig, accessToken: string, account: DocusignAccount, fetcher: typeof fetch = fetch): Promise<{ templates: DocusignTemplate[]; hasMore: boolean }> {
  const result = await requestJson(`${accountUrl(config, account)}/templates?count=${PAGE_SIZE}&start_position=0`, { method: "GET", headers: authorization(accessToken) }, fetcher);
  if (!Array.isArray(result.envelopeTemplates) || result.envelopeTemplates.length > PAGE_SIZE) invalidResponse();
  const templates = result.envelopeTemplates.map(value => {
    const row = object(value);
    return { templateId: guid(row.templateId, true), name: responseText(row.name, 500), description: row.description === undefined ? "" : responseText(row.description, 10000, true) };
  });
  if (new Set(templates.map(template => template.templateId)).size !== templates.length) invalidResponse();
  let hasMore = templates.length === PAGE_SIZE;
  if (result.totalSetSize !== undefined) {
    if (!/^(0|[1-9][0-9]{0,8})$/.test(String(result.totalSetSize)) || Number(result.totalSetSize) < templates.length) invalidResponse();
    hasMore = Number(result.totalSetSize) > templates.length;
  }
  // Never follow nextUri: it is vendor-controlled and may be an absolute URL.
  return { templates, hasMore };
}
function envelope(value: unknown): DocusignEnvelopeStatus {
  const row = object(value);
  if (typeof row.status !== "string" || !ENVELOPE_STATUSES.has(row.status.toLowerCase())) invalidResponse();
  let statusChangedAt: string | null = null;
  if (row.statusChangedDateTime !== undefined && row.statusChangedDateTime !== null && row.statusChangedDateTime !== "") {
    const date = responseText(row.statusChangedDateTime, 50);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) invalidResponse();
    statusChangedAt = new Date(date).toISOString();
  }
  return { envelopeId: guid(row.envelopeId, true), status: row.status.toLowerCase(), statusChangedAt };
}
/** Call before reserving the request, so invalid local input never becomes an uncertain vendor draft. */
export function validateDocusignDraft(input: DocusignDraftInput): DocusignDraftInput {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["templateId", "emailSubject", "roles", "transactionId"].includes(key))
    || !Array.isArray(input.roles) || input.roles.length < 1 || input.roles.length > 20) invalidInput();
  const roles = input.roles.map(role => {
    if (!role || typeof role !== "object" || Array.isArray(role) || Object.keys(role).some(key => !["roleName", "name", "email"].includes(key))) invalidInput();
    const email = inputText(role.email, 254);
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(email)
      || email.split("@")[0].length > 64 || email.startsWith(".") || email.includes("..") || email.includes(".@")) invalidInput();
    return { roleName: inputText(role.roleName, 100), name: inputText(role.name, 100), email };
  });
  if (new Set(roles.map(role => role.roleName)).size !== roles.length) invalidInput();
  return {
    templateId: guid(input.templateId), emailSubject: inputText(input.emailSubject, 100),
    roles, transactionId: guid(input.transactionId),
  };
}
/** Creates a vendor draft only. The caller reserves transactionId durably before invoking it. */
export async function createDocusignDraft(config: DocusignConfig, accessToken: string, account: DocusignAccount, input: DocusignDraftInput, fetcher: typeof fetch = fetch): Promise<{ envelopeId: string; status: "created" }> {
  const url = `${accountUrl(config, account)}/envelopes`;
  const validated = validateDocusignDraft(input);
  const body = { templateId: validated.templateId, emailSubject: validated.emailSubject, templateRoles: validated.roles,
    transactionId: validated.transactionId, status: "created" };
  const result = envelope(await requestJson(url, {
    method: "POST", headers: { ...authorization(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, fetcher));
  if (result.status !== "created") invalidResponse();
  return { envelopeId: result.envelopeId, status: "created" };
}
export async function getDocusignEnvelope(config: DocusignConfig, accessToken: string, account: DocusignAccount, envelopeId: string, fetcher: typeof fetch = fetch): Promise<DocusignEnvelopeStatus> {
  const id = guid(envelopeId);
  const result = envelope(await requestJson(`${accountUrl(config, account)}/envelopes/${id}`, { method: "GET", headers: authorization(accessToken) }, fetcher));
  if (result.envelopeId !== id) invalidResponse();
  return result;
}
/** Recovery lookup only. A missing result never proves that an uncertain POST can be retried safely. */
export async function findDocusignEnvelopeByTransactionId(config: DocusignConfig, accessToken: string, account: DocusignAccount, transactionId: string, fetcher: typeof fetch = fetch): Promise<DocusignEnvelopeStatus | null> {
  const result = await requestJson(`${accountUrl(config, account)}/envelopes?transaction_ids=${guid(transactionId)}&count=2&start_position=0`, { method: "GET", headers: authorization(accessToken) }, fetcher);
  // DocuSign may omit the envelopes array when the result count is zero.
  const rows = result.envelopes === undefined && String(result.resultSetSize) === "0" ? [] : result.envelopes;
  if (!Array.isArray(rows) || rows.length > 1 || (result.totalSetSize !== undefined && Number(result.totalSetSize) !== rows.length)) invalidResponse();
  return rows.length === 0 ? null : envelope(rows[0]);
}
