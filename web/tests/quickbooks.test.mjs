import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const compiled = await build({ absWorkingDir: root, entryPoints: ["lib/backend/quickbooks.ts"], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`);
const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://example.test/callback", environment: "sandbox" };
const realm = "123456789012345";
const period = { startDate: "2026-09-01", endDate: "2026-09-23", accountingMethod: "Accrual" };
const access = "synthetic-access-token";
const refresh = "synthetic-refresh-token";
const state = "synthetic_random_state_32_characters_long";
const tokens = () => ({ access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 3600, x_refresh_token_expires_in: 8726400, id_token: "DO-NOT-RETURN" });
const report = () => ({
  Header: { ReportName: "ProfitAndLoss", StartPeriod: period.startDate, EndPeriod: period.endDate, ReportBasis: "Accrual", Currency: "USD", Time: "2026-09-23T10:00:00-07:00", Option: [{ Name: "NoReportData", Value: "false" }] },
  Columns: { Column: [{ ColTitle: "", ColType: "Account" }, { ColTitle: "Total", ColType: "Money" }] },
  Rows: { Row: [{ type: "Section", Header: { ColData: [{ value: "Income" }, { value: "" }] },
    Rows: { Row: [{ type: "Data", ColData: [{ value: "Fictional revenue", id: "private-account-id" }, { value: "1250.00" }] }] },
    Summary: { ColData: [{ value: "Total Income" }, { value: "1250.00" }] },
  }] },
  private: "DO-NOT-RETURN",
});
const forbidden = () => assert.fail("Invalid input must never call a vendor");
const errorStatus = status => error => error.status === status;
const safeError = error => error.status >= 400 && ![access, refresh, config.clientSecret, "PRIVATE-VENDOR-DETAIL"].some(secret => error.message.includes(secret));

test("QuickBooks authorization URL requests accounting only and carries exact callback/state without secrets", () => {
  const url = new URL(api.quickBooksAuthorizationUrl(config, state));
  assert.equal(url.origin + url.pathname, "https://appcenter.intuit.com/connect/oauth2");
  assert.deepEqual(Object.fromEntries(url.searchParams), { client_id: config.clientId, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: config.redirectUri, state });
  assert.ok(!url.href.includes(config.clientSecret));
});

test("QuickBooks rejects invalid environment, credentials, unsafe redirects and unbound-looking states", () => {
  for (const change of [{ environment: "other" }, { clientId: "a:b" }, { clientSecret: "\r\nsecret" }, { redirectUri: "javascript:alert(1)" }, { redirectUri: "http://example.test/callback" }, { redirectUri: "https://user:password@example.test/callback" }, { redirectUri: "https://example.test/#callback" }, { redirectUri: "http://localhost/callback", environment: "production" }])
    assert.throws(() => api.quickBooksAuthorizationUrl({ ...config, ...change }, state), errorStatus(409));
  for (const badState of ["", "short", "x".repeat(513), "x".repeat(32) + "/", undefined])
    assert.throws(() => api.quickBooksAuthorizationUrl(config, badState), errorStatus(400));
  assert.equal(new URL(api.quickBooksAuthorizationUrl({ ...config, redirectUri: "http://localhost:5173/callback" }, state)).searchParams.get("redirect_uri"), "http://localhost:5173/callback");
});

test("code exchange uses fixed token endpoint, Basic client authentication and form encoding", async () => {
  let calls = 0;
  const result = await api.exchangeQuickBooksCode(config, "synthetic-code&encoded=value", async (url, init) => {
    calls++;
    assert.equal(url, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(config.clientId + ":" + config.clientSecret).toString("base64")}`);
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { grant_type: "authorization_code", code: "synthetic-code&encoded=value", redirect_uri: config.redirectUri });
    return Response.json(tokens());
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { accessToken: access, refreshToken: refresh, expiresIn: 3600, refreshExpiresIn: 8726400 });
  assert.ok(!JSON.stringify(result).includes("DO-NOT-RETURN"));
});

test("refresh returns the rotated token pair rather than retaining the submitted refresh token", async () => {
  const result = await api.refreshQuickBooksToken(config, refresh, async (url, init) => {
    assert.equal(new URL(url).hostname, "oauth.platform.intuit.com");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { grant_type: "refresh_token", refresh_token: refresh });
    return Response.json({ ...tokens(), access_token: "new-access", refresh_token: "new-refresh" });
  });
  assert.equal(result.accessToken, "new-access"); assert.equal(result.refreshToken, "new-refresh");
});

test("disconnect revokes only the supplied connection token using Intuit JSON revoke protocol", async () => {
  let calls = 0;
  await api.revokeQuickBooksToken(config, refresh, async (url, init) => {
    calls++;
    assert.equal(url, "https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
    assert.equal(init.method, "POST"); assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { token: refresh });
    assert.equal(init.redirect, "error");
    return new Response(null, { status: 200 });
  });
  assert.equal(calls, 1);
});

test("company discovery isolates production and sandbox endpoints and strips sensitive provider fields", async () => {
  for (const environment of ["sandbox", "production"]) {
    const result = await api.getQuickBooksCompany({ ...config, environment }, access, realm, async (url, init) => {
      assert.equal(url, `https://${environment === "sandbox" ? "sandbox-" : ""}quickbooks.api.intuit.com/v3/company/${realm}/companyinfo/${realm}`);
      assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, `Bearer ${access}`);
      return Response.json({ CompanyInfo: { Id: "1", CompanyName: "Fictional Title", LegalName: "Fictional Title LLC", Country: "US", EmployerId: "DO-NOT-RETURN", Email: { Address: "DO-NOT-RETURN" } } });
    });
    assert.deepEqual(result, { realmId: realm, name: "Fictional Title", legalName: "Fictional Title LLC", country: "US" });
  }
});

test("company IDs cannot introduce a host, path, query, numeric truncation or mixed-company request", async () => {
  for (const badRealm of [undefined, 123456789012345, "0", "0123", "-1", "1/../2", "1?realmId=2", "1%2f..", "https://evil.test", "1\r\n", "1".repeat(31)]) {
    await assert.rejects(api.getQuickBooksCompany(config, access, badRealm, forbidden), errorStatus(400));
    await assert.rejects(api.getQuickBooksProfitAndLoss(config, access, badRealm, period, forbidden), errorStatus(400));
  }
});

test("report is one dated GET and preserves hierarchy/display precision without provider IDs", async () => {
  let calls = 0;
  const result = await api.getQuickBooksProfitAndLoss(config, access, realm, period, async (url, init) => {
    calls++;
    const target = new URL(url);
    assert.equal(target.origin + target.pathname, `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}/reports/ProfitAndLoss`);
    assert.deepEqual(Object.fromEntries(target.searchParams), { start_date: period.startDate, end_date: period.endDate, accounting_method: "Accrual" });
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    return Response.json(report());
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { realmId: realm, startDate: period.startDate, endDate: period.endDate, currency: "USD", accountingMethod: "Accrual", generatedAt: "2026-09-23T10:00:00-07:00", columns: ["", "Total"], rows: [
    { kind: "header", depth: 0, cells: ["Income", ""] },
    { kind: "data", depth: 1, cells: ["Fictional revenue", "1250.00"] },
    { kind: "summary", depth: 0, cells: ["Total Income", "1250.00"] },
  ] });
  assert.ok(!JSON.stringify(result).includes("private-account-id"));
});

test("report requests reject nonexistent, reversed, overlong, injected dates and invalid accounting methods before fetch", async () => {
  for (const changes of [{ startDate: "2026-02-29" }, { endDate: "2026-09-31" }, { startDate: "2026-09-24" }, { startDate: "2024-01-01" }, { startDate: "2026-09-01&account=private" }, { startDate: undefined }, { accountingMethod: "cash" }, { accountingMethod: "all" }])
    await assert.rejects(api.getQuickBooksProfitAndLoss(config, access, realm, { ...period, ...changes }, forbidden), errorStatus(400));
});

test("report rejects provider period/basis mismatch instead of presenting it under requested labels", async () => {
  for (const changes of [{ StartPeriod: "2026-08-01" }, { EndPeriod: "2026-09-22" }, { ReportBasis: "Cash" }, { ReportName: "BalanceSheet" }]) {
    const data = report(); Object.assign(data.Header, changes);
    await assert.rejects(api.getQuickBooksProfitAndLoss(config, access, realm, period, async () => Response.json(data)), errorStatus(502));
  }
});

test("empty reports require valid metadata and retain explicit accounting basis", async () => {
  const data = report(); data.Header.ReportBasis = "Cash"; data.Header.Option[0].Value = "true"; data.Rows = {};
  const result = await api.getQuickBooksProfitAndLoss(config, access, realm, { ...period, accountingMethod: "Cash" }, async () => Response.json(data));
  assert.deepEqual(result.rows, []); assert.equal(result.accountingMethod, "Cash");
  data.Header.Option[0].Value = "false";
  await assert.rejects(api.getQuickBooksProfitAndLoss(config, access, realm, { ...period, accountingMethod: "Cash" }, async () => Response.json(data)), errorStatus(502));
});

test("provider reports cannot silently truncate malformed, overly nested or excessive rows", async () => {
  const variants = [];
  let data = report(); data.Rows.Row[0].Rows.Row[0].ColData.pop(); variants.push(data);
  data = report(); data.Rows.Row[0].Rows.Row[0].ColData[1].value = 1250; variants.push(data);
  data = report(); data.Rows.Row = "bad"; variants.push(data);
  data = report(); data.Rows.Row[0].type = "Unexpected"; variants.push(data);
  data = report(); data.Columns.Column = Array(33).fill({ ColTitle: "Total" }); variants.push(data);
  data = report(); data.Header.Currency = "EUR-extra"; variants.push(data);
  data = report(); data.Header.Time = "not a timestamp"; variants.push(data);
  data = report(); data.Rows.Row = Array(5001).fill({ type: "Data", ColData: [{ value: "Account" }, { value: "0.00" }] }); variants.push(data);
  data = report(); let nested = { type: "Data", ColData: [{ value: "Account" }, { value: "0.00" }] };
  for (let i = 0; i < 14; i++) nested = { type: "Section", Rows: { Row: [nested] } };
  data.Rows.Row = [nested]; variants.push(data);
  for (const candidate of variants)
    await assert.rejects(api.getQuickBooksProfitAndLoss(config, access, realm, period, async () => Response.json(candidate)), errorStatus(502));
});

test("all provider failures are sanitized and never retried or allowed to redirect", async () => {
  const operations = [
    fetcher => api.exchangeQuickBooksCode(config, "code", fetcher),
    fetcher => api.refreshQuickBooksToken(config, refresh, fetcher),
    fetcher => api.revokeQuickBooksToken(config, refresh, fetcher),
    fetcher => api.getQuickBooksCompany(config, access, realm, fetcher),
    fetcher => api.getQuickBooksProfitAndLoss(config, access, realm, period, fetcher),
  ];
  for (const operation of operations) {
    for (const status of [302, 400, 401, 403, 429, 500]) {
      let calls = 0;
      await assert.rejects(operation(async (_url, init) => {
        calls++; assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
        return new Response(`PRIVATE-VENDOR-DETAIL ${access} ${refresh} ${config.clientSecret}`, { status, headers: { Location: "https://evil.test" } });
      }), error => safeError(error) && (status !== 429 || error.status === 429));
      assert.equal(calls, 1);
    }
    await assert.rejects(operation(async () => { throw new Error(`PRIVATE-VENDOR-DETAIL ${access}`); }), safeError);
  }
});

test("token inputs and incomplete token responses never produce a usable connection", async () => {
  for (const token of ["", "a\nb", "x".repeat(16385)]) {
    await assert.rejects(api.refreshQuickBooksToken(config, token, forbidden), errorStatus(409));
    await assert.rejects(api.revokeQuickBooksToken(config, token, forbidden), errorStatus(409));
    await assert.rejects(api.getQuickBooksCompany(config, token, realm, forbidden), errorStatus(409));
  }
  for (const code of ["", "x".repeat(513), "space code"])
    await assert.rejects(api.exchangeQuickBooksCode(config, code, forbidden), errorStatus(400));
  for (const change of [{ access_token: "" }, { refresh_token: null }, { token_type: "mac" }, { expires_in: "3600" }, { expires_in: -1 }, { expires_in: 1.5 }, { x_refresh_token_expires_in: 0 }, { access_token: "header\r\ninjection" }])
    await assert.rejects(api.exchangeQuickBooksCode(config, "code", async () => Response.json({ ...tokens(), ...change })), errorStatus(502));
});

test("malformed JSON, non-JSON, wrong top-level shape and invalid text do not escape normalization", async () => {
  for (const makeResponse of [() => new Response("{", { headers: { "Content-Type": "application/json" } }), () => new Response("<html>private</html>"), () => Response.json([]), () => Response.json(null), () => Response.json({ CompanyInfo: {} }), () => Response.json({ CompanyInfo: { CompanyName: "Control\u0000character" } })])
    await assert.rejects(api.getQuickBooksCompany(config, access, realm, makeResponse), errorStatus(502));
});

test("streamed responses stop at byte limits even without a trustworthy Content-Length", async () => {
  let canceled = false;
  let pulls = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(40_000).fill(65)); }, cancel() { canceled = true; } });
  await assert.rejects(api.exchangeQuickBooksCode(config, "code", async () => new Response(stream, { headers: { "Content-Type": "application/json", "Content-Length": "1" } })), errorStatus(502));
  assert.equal(canceled, true); assert.ok(pulls <= 4);
  await assert.rejects(api.getQuickBooksProfitAndLoss(config, access, realm, period, async () => new Response("", { headers: { "Content-Type": "application/json", "Content-Length": "2000001" } })), errorStatus(502));
});

test("stream read exceptions do not leak transport diagnostics", async () => {
  await assert.rejects(api.exchangeQuickBooksCode(config, "code", async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(`PRIVATE-VENDOR-DETAIL ${refresh}`)); } }), { headers: { "Content-Type": "application/json" } })), safeError);
});
