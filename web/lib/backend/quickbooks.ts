import { ApiError } from "./workspace";
import { dayNumber, isCalendarDay } from "../title/business-date";

// Server-only adapter. The caller must authorize the workspace/company and
// persist OAuth state and rotating tokens; no secrets belong in browser data.
export type QuickBooksConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
};
export type QuickBooksTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};
export type QuickBooksCompany = {
  realmId: string;
  name: string;
  legalName: string | null;
  country: string | null;
};
export type QuickBooksReportPeriod = {
  startDate: string;
  endDate: string;
  accountingMethod?: "Cash" | "Accrual";
};
export type QuickBooksProfitAndLoss = {
  realmId: string;
  startDate: string;
  endDate: string;
  currency: string;
  accountingMethod: "Cash" | "Accrual";
  generatedAt: string;
  columns: string[];
  rows: { kind: "header" | "data" | "summary"; depth: number; cells: string[] }[];
};

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";
const REPORT_MAX_BYTES = 2_000_000;

function invalidResponse(): never {
  throw new ApiError("QuickBooks returned an unexpected response. Try again or reconnect the company.", 502);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}
function displayText(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalidResponse();
  return value;
}
function secretText(value: unknown, max = 16384): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
}
function checkedConfig(config: QuickBooksConfig): QuickBooksConfig {
  if (!config || !secretText(config.clientId, 2048) || config.clientId.includes(":") || !secretText(config.clientSecret, 4096)
    || !["sandbox", "production"].includes(config.environment))
    throw new ApiError("Complete the QuickBooks app credentials and environment in server settings.", 409);
  let redirect: URL;
  try { redirect = new URL(config.redirectUri); } catch {
    throw new ApiError("Configure a valid QuickBooks callback address.", 409);
  }
  const localSandbox = config.environment === "sandbox" && redirect.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  if ((!localSandbox && redirect.protocol !== "https:") || redirect.username || redirect.password || redirect.hash
    || config.redirectUri.length > 2048)
    throw new ApiError("Configure a valid HTTPS QuickBooks callback address.", 409);
  return config;
}
function checkedToken(token: string): string {
  if (!secretText(token)) throw new ApiError("Reconnect this QuickBooks company before continuing.", 409);
  return token;
}
function checkedRealm(realmId: string): string {
  if (typeof realmId !== "string" || !/^[1-9][0-9]{0,29}$/.test(realmId))
    throw new ApiError("Select a valid connected QuickBooks company.");
  return realmId;
}
function basicAuthorization(config: QuickBooksConfig): string {
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}
function companyBase(config: QuickBooksConfig, realmId: string): string {
  checkedConfig(config);
  checkedRealm(realmId);
  const origin = config.environment === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
  return `${origin}/v3/company/${realmId}`;
}
async function cancelBody(response: Response) {
  try { await response.body?.cancel(); } catch { /* Never surface a transport error or provider payload. */ }
}
async function request(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new ApiError("QuickBooks could not be reached. Try again later.", 502);
  }
  if (!response.ok || response.redirected) {
    await cancelBody(response);
    if (response.status === 429) throw new ApiError("QuickBooks' request limit was reached. Wait before trying again.", 429);
    if ([401, 403].includes(response.status) || (response.status === 400 && [TOKEN_URL, REVOKE_URL].includes(url)))
      throw new ApiError("QuickBooks did not accept the connection. Reconnect the company and check the app credentials.", 409);
    throw new ApiError("QuickBooks could not complete the request. Try again later.", 502);
  }
  return response;
}
async function readJson(response: Response, maxBytes: number): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await cancelBody(response); invalidResponse();
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType && contentType !== "application/json") { await cancelBody(response); invalidResponse(); }
  const reader = response.body?.getReader();
  if (!reader) invalidResponse();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); invalidResponse(); }
      chunks.push(value);
    }
  } catch { invalidResponse(); } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalidResponse(); }
  return record(result);
}

/** State must be random, short-lived, single-use, and bound to the acting user. */
export function quickBooksAuthorizationUrl(config: QuickBooksConfig, state: string): string {
  checkedConfig(config);
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{32,512}$/.test(state))
    throw new ApiError("Restart the QuickBooks connection setup.");
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", scope: ACCOUNTING_SCOPE, redirect_uri: config.redirectUri, state }).toString();
  return url.toString();
}
function expiry(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) invalidResponse();
  return value;
}
async function tokenRequest(config: QuickBooksConfig, body: URLSearchParams, fetcher: typeof fetch): Promise<QuickBooksTokens> {
  checkedConfig(config);
  const response = await request(TOKEN_URL, { method: "POST", headers: {
    Authorization: basicAuthorization(config), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
  }, body: body.toString() }, fetcher);
  const data = await readJson(response, 65_536);
  if (typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer"
    || !secretText(data.access_token) || !secretText(data.refresh_token)) invalidResponse();
  return {
    accessToken: data.access_token, refreshToken: data.refresh_token,
    expiresIn: expiry(data.expires_in, 86400),
    refreshExpiresIn: expiry(data.x_refresh_token_expires_in, 10 * 366 * 86400),
  };
}
export async function exchangeQuickBooksCode(config: QuickBooksConfig, code: string, fetcher: typeof fetch = fetch): Promise<QuickBooksTokens> {
  checkedConfig(config);
  if (!secretText(code, 512)) throw new ApiError("Restart the QuickBooks connection setup.");
  return tokenRequest(config, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }), fetcher);
}
/** Persist BOTH returned tokens atomically; do not reuse an older refresh token. */
export async function refreshQuickBooksToken(config: QuickBooksConfig, refreshToken: string, fetcher: typeof fetch = fetch): Promise<QuickBooksTokens> {
  return tokenRequest(config, new URLSearchParams({ grant_type: "refresh_token", refresh_token: checkedToken(refreshToken) }), fetcher);
}
export async function revokeQuickBooksToken(config: QuickBooksConfig, refreshToken: string, fetcher: typeof fetch = fetch): Promise<void> {
  checkedConfig(config);
  const response = await request(REVOKE_URL, { method: "POST", headers: {
    Authorization: basicAuthorization(config), "Content-Type": "application/json", Accept: "application/json",
  }, body: JSON.stringify({ token: checkedToken(refreshToken) }) }, fetcher);
  await cancelBody(response);
}
async function readCompanyApi(url: string, accessToken: string, maxBytes: number, fetcher: typeof fetch) {
  return readJson(await request(url, { method: "GET", headers: { Authorization: `Bearer ${checkedToken(accessToken)}`, Accept: "application/json" } }, fetcher), maxBytes);
}
export async function getQuickBooksCompany(config: QuickBooksConfig, accessToken: string, realmId: string, fetcher: typeof fetch = fetch): Promise<QuickBooksCompany> {
  const data = await readCompanyApi(`${companyBase(config, realmId)}/companyinfo/${realmId}`, accessToken, 256_000, fetcher);
  const company = record(data.CompanyInfo);
  // CompanyInfo.Id is an entity ID (often "1"), not the OAuth realm ID.
  return {
    realmId, name: displayText(company.CompanyName, 1024),
    legalName: company.LegalName == null ? null : displayText(company.LegalName, 1024, true),
    country: company.Country == null ? null : displayText(company.Country, 100, true),
  };
}
function checkedPeriod(period: QuickBooksReportPeriod): Required<QuickBooksReportPeriod> {
  if (!period || typeof period.startDate !== "string" || typeof period.endDate !== "string"
    || !isCalendarDay(period.startDate) || !isCalendarDay(period.endDate) || period.startDate > period.endDate
    || dayNumber(period.endDate) - dayNumber(period.startDate) > 366
    || (period.accountingMethod !== undefined && !["Cash", "Accrual"].includes(period.accountingMethod)))
    throw new ApiError("Choose valid report dates no more than one year apart and a Cash or Accrual accounting method.");
  return { startDate: period.startDate, endDate: period.endDate, accountingMethod: period.accountingMethod ?? "Accrual" };
}
/** Read-only report for review. It never posts journal entries or changes a close. */
export async function getQuickBooksProfitAndLoss(config: QuickBooksConfig, accessToken: string, realmId: string, period: QuickBooksReportPeriod, fetcher: typeof fetch = fetch): Promise<QuickBooksProfitAndLoss> {
  const { startDate, endDate, accountingMethod } = checkedPeriod(period);
  const query = new URLSearchParams({ start_date: startDate, end_date: endDate, accounting_method: accountingMethod });
  const data = await readCompanyApi(`${companyBase(config, realmId)}/reports/ProfitAndLoss?${query}`, accessToken, REPORT_MAX_BYTES, fetcher);
  const header = record(data.Header);
  if (header.ReportName !== "ProfitAndLoss" || header.StartPeriod !== startDate || header.EndPeriod !== endDate || header.ReportBasis !== accountingMethod)
    throw new ApiError("QuickBooks returned a report for a different period or accounting method. No report was imported.", 502);
  const currency = displayText(header.Currency, 3);
  if (!/^[A-Z]{3}$/.test(currency)) invalidResponse();
  const generatedAt = displayText(header.Time, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) invalidResponse();
  const rawColumns = record(data.Columns).Column;
  if (!Array.isArray(rawColumns) || rawColumns.length < 1 || rawColumns.length > 32) invalidResponse();
  const columns = rawColumns.map(column => displayText(record(column).ColTitle, 500, true));
  const rows: QuickBooksProfitAndLoss["rows"] = [];
  const add = (raw: unknown, kind: QuickBooksProfitAndLoss["rows"][number]["kind"], depth: number) => {
    if (!Array.isArray(raw) || raw.length !== columns.length || rows.length >= 5000) invalidResponse();
    rows.push({ kind, depth, cells: raw.map(cell => displayText(record(cell).value, 4000, true)) });
  };
  let visited = 0;
  const walk = (value: unknown, depth: number) => {
    if (!Array.isArray(value) || depth > 12) invalidResponse();
    for (const item of value) {
      if (++visited > 5000) invalidResponse();
      const row = record(item);
      if (row.type !== "Data" && row.type !== "Section") invalidResponse();
      if (row.Header !== undefined) add(record(row.Header).ColData, "header", depth);
      if (row.ColData !== undefined) add(row.ColData, "data", depth);
      if (row.Rows !== undefined) walk(record(row.Rows).Row ?? [], depth + 1);
      if (row.Summary !== undefined) add(record(row.Summary).ColData, "summary", depth);
      if (row.type === "Data" && row.ColData === undefined) invalidResponse();
    }
  };
  const reportRows = record(data.Rows);
  const noData = Array.isArray(header.Option) && header.Option.some(option => {
    const item = record(option); return item.Name === "NoReportData" && item.Value === "true";
  });
  if (reportRows.Row === undefined && !noData) invalidResponse();
  walk(reportRows.Row ?? [], 0);
  return { realmId, startDate, endDate, currency, accountingMethod, generatedAt, columns, rows };
}
