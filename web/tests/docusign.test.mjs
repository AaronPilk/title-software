import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/backend/docusign.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "es2022" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const {
  docusignAuthorizeUrl, exchangeDocusignCode, refreshDocusignToken, listDocusignAccounts,
  listDocusignTemplates, createDocusignDraft, getDocusignEnvelope, findDocusignEnvelopeByTransactionId,
} = api;
const config = { clientId: "integration-test-only", clientSecret: "CLIENT-SECRET-TEST-ONLY", redirectUri: "https://title.example.test/", environment: "sandbox" };
const token = "ACCESS-TOKEN-TEST-ONLY";
const refreshToken = "REFRESH-TOKEN-TEST-ONLY";
const accountId = "11111111-1111-4111-8111-111111111111";
const templateId = "22222222-2222-4222-8222-222222222222";
const envelopeId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";
const account = { accountId, name: "Fictional test title", isDefault: true, baseUri: "https://demo.docusign.net" };
const draft = { templateId, emailSubject: "Fictional onboarding draft", transactionId, roles: [{ roleName: "Owner", name: "Test Owner", email: "owner@example.test" }] };
const json = (value, options) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" }, ...options });
const denied = () => assert.fail("Unexpected vendor request");
const vendorTokens = () => ({ access_token: token, refresh_token: refreshToken, token_type: "Bearer", expires_in: 28800 });
const vendorAccount = (overrides = {}) => ({ account_id: accountId, account_name: account.name, is_default: true, base_uri: account.baseUri, ...overrides });
const checkError = status => error => error.status === status && ![token, refreshToken, config.clientSecret, "PRIVATE-VENDOR-ERROR"].some(value => error.message.includes(value));

test("authorization uses fixed OAuth hosts, code grant, single-use-state input and signature extended only", () => {
  for (const environment of ["sandbox", "production"]) {
    const url = new URL(docusignAuthorizeUrl({ ...config, environment }, "a".repeat(43)));
    assert.equal(url.origin, environment === "sandbox" ? "https://account-d.docusign.com" : "https://account.docusign.com");
    assert.equal(url.pathname, "/oauth/auth");
    assert.equal(url.searchParams.get("scope"), "signature extended");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
    assert.equal(url.searchParams.get("state"), "a".repeat(43));
    assert.ok(!url.href.includes(config.clientSecret));
  }
  for (const state of ["", "small", "a".repeat(257), "a".repeat(32) + "&redirect_uri=evil", "a".repeat(32) + "\n"])
    assert.throws(() => docusignAuthorizeUrl(config, state), checkError(400));
});

test("incomplete setup and unsafe callback addresses fail before network", async () => {
  for (const candidate of [
    { ...config, clientId: "" }, { ...config, clientSecret: "" }, { ...config, clientSecret: "a\nb" },
    { ...config, clientId: "a:b" }, { ...config, environment: "custom-host" },
    { ...config, redirectUri: "https://a:b@title.example.test/" }, { ...config, redirectUri: "javascript:alert(1)" },
    { ...config, redirectUri: "http://title.example.test/" }, { ...config, redirectUri: "https://title.example.test/#token" },
    { ...config, environment: "production", redirectUri: "http://localhost:5193/" },
  ]) await assert.rejects(exchangeDocusignCode(candidate, "valid-code", denied), checkError(409));
  assert.ok(docusignAuthorizeUrl({ ...config, redirectUri: "http://localhost:5193/" }, "a".repeat(43)).startsWith("https://account-d.docusign.com/"));
});

test("authorization code exchange uses confidential Basic authentication and returns only validated server tokens", async () => {
  const result = await exchangeDocusignCode(config, "code-with+reserved=value", async (url, options) => {
    assert.equal(url, "https://account-d.docusign.com/oauth/token");
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`);
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("code"), "code-with+reserved=value"); assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), config.redirectUri); assert.equal(body.has("client_secret"), false);
    return json({ ...vendorTokens(), private_field: "PRIVATE-VENDOR-ERROR" });
  });
  assert.deepEqual(result, { accessToken: token, refreshToken, expiresIn: 28800 });
});

test("refresh exchanges only the refresh grant and returns the rotated token for durable replacement", async () => {
  const result = await refreshDocusignToken({ ...config, environment: "production" }, refreshToken, async (url, options) => {
    assert.equal(url, "https://account.docusign.com/oauth/token");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), refreshToken);
    assert.equal(body.has("scope"), false); assert.equal(body.has("redirect_uri"), false);
    return json({ ...vendorTokens(), refresh_token: "ROTATED-REFRESH-TEST-ONLY" });
  });
  assert.equal(result.refreshToken, "ROTATED-REFRESH-TEST-ONLY");
});

test("malformed grants, injected tokens, missing refresh tokens and invalid lifetimes are rejected", async () => {
  for (const code of ["", "has space", "a\rb", "x".repeat(16385)])
    await assert.rejects(exchangeDocusignCode(config, code, denied), checkError(400));
  for (const patch of [{ token_type: "Basic" }, { refresh_token: undefined }, { access_token: "a\rb" }, { expires_in: "28800" }, { expires_in: 0 }, { expires_in: 86401 }, { expires_in: 1.5 }, { scope: "openid" }])
    await assert.rejects(exchangeDocusignCode(config, "code", async () => json({ ...vendorTokens(), ...patch })), checkError(502));
  await assert.rejects(listDocusignAccounts(config, "a\nb", denied), checkError(409));
});

test("userinfo metadata excludes email, organization details, vendor secrets and arbitrary fields", async () => {
  const result = await listDocusignAccounts(config, token, async (url, options) => {
    assert.equal(url, "https://account-d.docusign.com/oauth/userinfo");
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return json({ email: "private@example.test", sub: "private-user", accounts: [{ ...vendorAccount(), token, organization: { secret: "PRIVATE-VENDOR-ERROR" } }] });
  });
  assert.deepEqual(result, [account]);
  assert.deepEqual(await listDocusignAccounts(config, token, async () => json({ accounts: [] })), []);
});

test("userinfo rejects arbitrary locations, sibling domains, credentials, ports and environment crossover", async () => {
  for (const base_uri of [
    "http://demo.docusign.net", "https://demo.docusign.net.attacker.test", "https://attacker.test/docusign.net",
    "https://demo.docusign.net@attacker.test", "https://user:pass@demo.docusign.net", "https://demo.docusign.net:8443",
    "https://demo.docusign.net?url=https://attacker.test", "https://demo.docusign.net/#secret", "https://127.0.0.1",
    "https://demo.docusign.net/other/api", "https://na2.docusign.net", "https://demo.docusign.net/a/../", "https://demo.docusign.net\\",
  ]) await assert.rejects(listDocusignAccounts(config, token, async () => json({ accounts: [vendorAccount({ base_uri })] })), checkError(502));
  await assert.rejects(listDocusignAccounts({ ...config, environment: "production" }, token, async () => json({ accounts: [vendorAccount()] })), checkError(502));
});

test("production account origin comes from the reviewed userinfo account and REST suffix is normalized once", async () => {
  const prod = { ...config, environment: "production" };
  for (const host of ["www", "na2", "na3", "na4", "ca", "eu", "au"]) {
    const result = await listDocusignAccounts(prod, token, async () => json({ accounts: [vendorAccount({ base_uri: `https://${host}.docusign.net/restapi/` })] }));
    assert.equal(result[0].baseUri, `https://${host}.docusign.net`);
  }
  await listDocusignTemplates(prod, token, { ...account, baseUri: "https://na3.docusign.net/restapi" }, async url => {
    assert.equal(url, `https://na3.docusign.net/restapi/v2.1/accounts/${accountId}/templates?count=100&start_position=0`);
    return json({ envelopeTemplates: [] });
  });
});

test("malformed account discovery cannot become a partial or ambiguous connection", async () => {
  for (const accounts of [null, {}, [null], [vendorAccount({ account_id: "../foreign" })], [vendorAccount({ is_default: "true" })], [vendorAccount({ account_name: "" })], [vendorAccount(), vendorAccount()], Array(101).fill(vendorAccount())])
    await assert.rejects(listDocusignAccounts(config, token, async () => json({ accounts })), checkError(502));
});

test("template listing is bounded, reports truncation and ignores nextUri and arbitrary vendor fields", async () => {
  let calls = 0;
  const result = await listDocusignTemplates(config, token, account, async (url, options) => {
    calls++; assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.equal(url, `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}/templates?count=100&start_position=0`);
    return json({ envelopeTemplates: [{ templateId, name: "Fictional onboarding", description: "Read before use", token }], totalSetSize: "2", nextUri: "https://attacker.test/steal" });
  });
  assert.deepEqual(result, { templates: [{ templateId, name: "Fictional onboarding", description: "Read before use" }], hasMore: true });
  assert.equal(calls, 1);
  for (const envelopeTemplates of [null, [null], [{ templateId, name: "" }], [{ templateId: "../envelopes", name: "bad" }], Array(101).fill({ templateId, name: "bad" })])
    await assert.rejects(listDocusignTemplates(config, token, account, async () => json({ envelopeTemplates })), checkError(502));
});

test("all account-specific methods revalidate the stored origin and ID before transmitting bearer credentials", async () => {
  for (const malicious of [{ ...account, baseUri: "https://attacker.test" }, { ...account, baseUri: "https://demo.docusign.net.evil.test" }, { ...account, accountId: "../other" }]) {
    await assert.rejects(listDocusignTemplates(config, token, malicious, denied));
    await assert.rejects(createDocusignDraft(config, token, malicious, draft, denied));
    await assert.rejects(getDocusignEnvelope(config, token, malicious, envelopeId, denied));
    await assert.rejects(findDocusignEnvelopeByTransactionId(config, token, malicious, transactionId, denied));
  }
});

test("draft creation sends exactly one bounded created envelope with the reserved transaction and explicit role fields", async () => {
  let calls = 0;
  const result = await createDocusignDraft(config, token, account, draft, async (url, options) => {
    calls++; assert.equal(url, `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}/envelopes`);
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { templateId, emailSubject: draft.emailSubject, templateRoles: draft.roles, transactionId, status: "created" });
    return json({ envelopeId, status: "created", uri: "https://attacker.test", private: token });
  });
  assert.deepEqual(result, { envelopeId, status: "created" }); assert.equal(calls, 1);
});

test("no caller-controlled status, notifications, tabs, documents or additional recipients can reach a draft request", async () => {
  for (const patch of [
    { status: "sent" }, { status: "created" }, { documents: [] }, { eventNotification: { url: "https://attacker.test" } },
    { roles: [{ ...draft.roles[0], tabs: {} }] }, { roles: [{ ...draft.roles[0], emailNotification: {} }] },
    { roles: [{ ...draft.roles[0], clientUserId: "embedded" }] }, { roles: [] }, { roles: Array(21).fill(draft.roles[0]) },
    { roles: [draft.roles[0], draft.roles[0]] }, { emailSubject: "x\r\nBcc: wrong@example.test" }, { transactionId: "reused/path" },
  ]) await assert.rejects(createDocusignDraft(config, token, account, { ...draft, ...patch }, denied), checkError(400));
});

test("draft recipients reject malformed and ambiguous email addresses before touching the vendor", async () => {
  for (const email of ["other@example.test,wrong@example.test", "Name <owner@example.test>", "owner@example.test\nBcc:wrong@example.test", "owner@localhost", "..owner@example.test", "owner.@example.test", "a".repeat(65) + "@example.test", "owner@-example.test"])
    await assert.rejects(createDocusignDraft(config, token, account, { ...draft, roles: [{ ...draft.roles[0], email }] }, denied), checkError(400));
});

test("an unexpected sent response is not accepted as a successful draft", async () => {
  await assert.rejects(createDocusignDraft(config, token, account, draft, async () => json({ envelopeId, status: "sent" })), checkError(502));
});

test("uncertain draft failure performs no retry, so caller can preserve its reservation and recover safely", async () => {
  for (const transport of [async () => { throw new Error(token); }, async () => new Response("PRIVATE-VENDOR-ERROR", { status: 503 })]) {
    let calls = 0;
    await assert.rejects(createDocusignDraft(config, token, account, draft, async (...args) => { calls++; return transport(...args); }), checkError(502));
    assert.equal(calls, 1);
  }
});

test("envelope status requires the requested identity and discards recipient/document/email details", async () => {
  const result = await getDocusignEnvelope(config, token, account, envelopeId, async (url, options) => {
    assert.equal(url, `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}`);
    assert.equal(options.method, "GET");
    return json({ envelopeId, status: "completed", statusChangedDateTime: "2026-09-23T12:34:56.1234567Z", recipients: ["private"], documents: ["private"], token });
  });
  assert.deepEqual(result, { envelopeId, status: "completed", statusChangedAt: "2026-09-23T12:34:56.123Z" });
  for (const patch of [{ envelopeId: accountId }, { status: "unknown-future-state" }, { statusChangedDateTime: "yesterday" }, { statusChangedDateTime: "2026-09-23" }])
    await assert.rejects(getDocusignEnvelope(config, token, account, envelopeId, async () => json({ envelopeId, status: "created", ...patch })), checkError(502));
});

test("transaction recovery is one fixed GET and can report a manually sent envelope without creating another draft", async () => {
  let calls = 0;
  const result = await findDocusignEnvelopeByTransactionId(config, token, account, transactionId, async (url, options) => {
    calls++; assert.equal(url, `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}/envelopes?transaction_ids=${transactionId}&count=2&start_position=0`);
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
    return json({ envelopes: [{ envelopeId, status: "sent" }], totalSetSize: "1" });
  });
  assert.deepEqual(result, { envelopeId, status: "sent", statusChangedAt: null }); assert.equal(calls, 1);
  for (const response of [{ envelopes: [], totalSetSize: "0" }, { resultSetSize: "0" }])
    assert.equal(await findDocusignEnvelopeByTransactionId(config, token, account, transactionId, async () => json(response)), null);
  for (const response of [{}, { envelopes: [{ envelopeId, status: "created" }, { envelopeId: accountId, status: "created" }] }, { envelopes: [], totalSetSize: "1" }])
    await assert.rejects(findDocusignEnvelopeByTransactionId(config, token, account, transactionId, async () => json(response)), checkError(502));
});

test("vendor errors and network exceptions are sanitized across status classes with no redirect or retries", async () => {
  for (const [status, expected] of [[302, 502], [400, 400], [401, 409], [403, 409], [404, 404], [422, 400], [429, 429], [500, 502]]) {
    let calls = 0;
    await assert.rejects(listDocusignAccounts(config, token, async (_url, options) => {
      calls++; assert.equal(options.redirect, "error");
      return new Response(`PRIVATE-VENDOR-ERROR ${token}`, { status, headers: { location: "https://attacker.test" } });
    }), checkError(expected));
    assert.equal(calls, 1);
  }
  await assert.rejects(listDocusignAccounts(config, token, async () => { throw new Error(config.clientSecret); }), checkError(502));
});

test("metadata responses enforce byte limits against lying or missing Content-Length and cancel oversized streams", async () => {
  let canceled = false;
  await assert.rejects(listDocusignAccounts(config, token, async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(600000)); },
    cancel() { canceled = true; },
  }), { headers: { "content-length": "1" } })), checkError(502));
  assert.equal(canceled, true);
  await assert.rejects(listDocusignAccounts(config, token, async () => new Response("x".repeat(1000001))), checkError(502));
  await assert.rejects(listDocusignAccounts(config, token, async () => json({ accounts: [] }, { headers: { "content-length": "1000001" } })), checkError(502));
});

test("invalid UTF-8, truncated streams, absent body, arrays and malformed JSON cannot become verified responses", async () => {
  for (const response of [new Response("no JSON"), new Response("[]"), new Response("null"), new Response(null), new Response(new Uint8Array([0xff, 0xfe])), new Response(new ReadableStream({ start(controller) { controller.error(new Error(token)); } }))])
    await assert.rejects(listDocusignAccounts(config, token, async () => response), checkError(502));
});

test("the shared 20-second deadline bounds both an unresponsive transport and a stalled response body", async () => {
  const originalTimeout = AbortSignal.timeout;
  try {
    let controller;
    AbortSignal.timeout = milliseconds => {
      assert.equal(milliseconds, 20000);
      controller = new AbortController(); return controller.signal;
    };
    await assert.rejects(listDocusignAccounts(config, token, async () => {
      queueMicrotask(() => controller.abort());
      return new Promise(() => {});
    }), checkError(502));
    let canceled = false;
    await assert.rejects(listDocusignAccounts(config, token, async () => new Response(new ReadableStream({
      pull() { queueMicrotask(() => controller.abort()); return new Promise(() => {}); },
      cancel() { canceled = true; },
    }))), checkError(502));
    assert.equal(canceled, true);
  } finally { AbortSignal.timeout = originalTimeout; }
});
