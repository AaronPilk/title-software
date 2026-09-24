// The actual Edge handler, with synthetic Auth, service RPCs and vendor HTTP.
// Database tests separately enforce encryption, access/version locks and races.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const templateId = "55555555-5555-4555-8555-555555555555";
const envelopeId = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const otherWorkspaceId = "88888888-8888-4888-8888-888888888888";
const leaseId = "99999999-9999-4999-8999-999999999999";
const companyId = "fictional-title-company";
const realmId = "9341456789012345";
const actorEmail = "owner@example.test";
const origin = "https://synthetic.example.test/functions/v1/title-api";
const privateAccess = "ACCESS-TOKEN-SYNTHETIC-ONLY";
const privateRefresh = "REFRESH-TOKEN-SYNTHETIC-ONLY";
const privateSecret = "APP-SECRET-SYNTHETIC-ONLY";
const privateError = "PRIVATE-TRANSPORT-ERROR";
const originalDeno = globalThis.Deno, originalFetch = globalThis.fetch;
let handler, fixture;
const ok = data => ({ data, error: null });
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const appEnv = {
  SUPABASE_URL: "https://synthetic.example.test", SUPABASE_SERVICE_ROLE_KEY: "SERVICE-KEY-SYNTHETIC-ONLY",
  DOCUSIGN_CLIENT_ID: "test-integration-key", DOCUSIGN_CLIENT_SECRET: privateSecret, DOCUSIGN_ENVIRONMENT: "sandbox",
  QUICKBOOKS_CLIENT_ID: "test-client-id", QUICKBOOKS_CLIENT_SECRET: privateSecret, QUICKBOOKS_ENVIRONMENT: "sandbox",
  TITLE_VENDOR_REDIRECT_URI: "https://pilot.example.test/",
};
function status(provider) {
  return { provider, companyId, configured: fixture.configured, revision: fixture.revision, environment: fixture.environment,
    metadata: provider === "docusign" ? { accountId, accountName: "Fictional title signing", baseUri: "https://demo.docusign.net" }
      : { realmId, accountName: "Fictional title accounting" },
    connectedAt: "2026-09-23T00:00:00Z", expiresAt: fixture.expiresAt, busy: fixture.busy };
}
function credential(provider) { return { ...status(provider), tokens: structuredClone(fixture.tokens) }; }
function key(args) { return [args.p_workspace, args.p_actor, args.p_provider, args.p_company, args.p_state_hash].join("|"); }
const client = {
  auth: {
    getUser: async () => fixture.authenticated ? ok({ user: { id: actorId, email: actorEmail,
      email_confirmed_at: fixture.confirmed ? "2026-01-01T00:00:00Z" : null, is_anonymous: fixture.anonymous } }) : { data: { user: null }, error: { message: "Invalid synthetic session" } },
    getClaims: async () => ok({ claims: { sub: actorId, session_id: sessionId, aal: fixture.aal } }),
  },
  async rpc(name, args) {
    if (name === "title_security_state") return ok(fixture.security);
    if (name === 'title_record_security_event') { assert.equal(args.p_event_type, 'authorization.denied'); assert.equal(args.p_outcome, 'denied'); assert.equal(args.p_actor, actorId); return ok(null); }
    fixture.calls.push({ name, args: structuredClone(args) });
    assert.ok(name.startsWith("title_vendor_"), `Unexpected RPC ${name}`);
    assert.equal(args.p_workspace, workspaceId); assert.equal(args.p_actor, actorId); assert.equal(args.p_access_version, 7);
    if (fixture.rpcThrow === name) throw new Error(`${privateError} ${privateAccess}`);
    if (fixture.rpcErrors[name]) return { data: null, error: fixture.rpcErrors[name] };
    if (name !== "title_vendor_list" && args.p_company !== companyId)
      return { data: null, error: { code: "42501", message: privateError } };
    switch (name) {
      case "title_vendor_list": return ok([status("docusign"), status("quickbooks")]);
      case "title_vendor_start_oauth":
        fixture.states.set(key(args), args.p_environment);
        return ok({ expiresAt: new Date(Date.now() + 600000).toISOString() });
      case "title_vendor_claim_oauth": {
        const environment = fixture.states.get(key(args)); fixture.states.delete(key(args));
        return ok({ ...credential(args.p_provider), environment: environment ?? fixture.environment, ok: !!environment, leaseId });
      }
      case "title_vendor_claim_refresh": return ok({ ...credential(args.p_provider), ok: fixture.refreshClaimOk, leaseId });
      case "title_vendor_finish": {
        fixture.tokens = structuredClone(args.p_tokens); fixture.expiresAt = args.p_expires_at; fixture.revision++;
        const saved = status(args.p_provider); fixture.afterFinish?.();
        return ok(saved);
      }
      case "title_vendor_read": return ok(credential(args.p_provider));
      case "title_vendor_status": return ok(status(args.p_provider));
      case "title_vendor_release": return ok({ released: true });
      case "title_vendor_disconnect": fixture.configured = false; fixture.revision++; return ok(status(args.p_provider));
      case "title_vendor_reserve_draft": {
        const saved = fixture.drafts.get(args.p_request);
        if (saved) return saved.hash !== args.p_payload_hash ? { data: null, error: { code: "PT409", message: privateError } }
          : ok({ created: false, envelopeId: saved.envelopeId });
        fixture.drafts.set(args.p_request, { requestId: args.p_request, envelopeId: null, status: "pending", hash: args.p_payload_hash });
        return ok({ created: true });
      }
      case "title_vendor_list_drafts": return ok([...fixture.drafts.values()].map(row => ({ requestId: row.requestId, envelopeId: row.envelopeId, status: row.status })));
      case "title_vendor_claim_draft_check": {
        const draft = fixture.drafts.get(args.p_request);
        if (!draft) return { data: null, error: { code: "PT409", message: privateError } };
        if (fixture.checkClaimed) return { data: null, error: { code: "PT429", message: privateError } };
        fixture.checkClaimed = true;
        return ok({ requestId: args.p_request, envelopeId: draft.envelopeId });
      }
      case "title_vendor_finish_draft": {
        const draft = fixture.drafts.get(args.p_request); assert.ok(draft, "Only recorded requests can be completed");
        Object.assign(draft, { envelopeId: args.p_envelope, status: args.p_status });
        return ok({ requestId: args.p_request, envelopeId: args.p_envelope, status: args.p_status });
      }
      default: throw new Error(`Unexpected RPC ${name}`);
    }
  },
  from(table) {
    assert.equal(table, "title_memberships", "Vendor state must use authorized RPCs");
    const filters = []; fixture.queries.push({ table, filters });
    return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, async maybeSingle() {
      const member = { workspace_id: workspaceId, user_id: actorId, role: fixture.role,
        company_ids: [companyId], all_companies: fixture.allCompanies, restricted_access: false,
        partner_members: [], active: fixture.active, version: 7 };
      return ok(filters.every(([k, v]) => member[k] === v) ? member : null);
    } };
  },
};
function report() { return { Header: { ReportName: "ProfitAndLoss", StartPeriod: "2026-09-01", EndPeriod: "2026-09-23", ReportBasis: "Accrual", Currency: "USD", Time: "2026-09-23T12:00:00Z" },
  Columns: { Column: [{ ColTitle: "Account" }, { ColTitle: "Total" }] }, Rows: { Row: [{ type: "Data", ColData: [{ value: "Fictional income" }, { value: "10.00" }] }] } }; }
async function defaultVendor(url, options) {
  if (url.endsWith("/oauth/token") || url.endsWith("/tokens/bearer")) return json({ access_token: privateAccess, refresh_token: privateRefresh,
    token_type: "Bearer", expires_in: 28800, x_refresh_token_expires_in: 8640000 });
  if (url.endsWith("/oauth/userinfo")) return json({ accounts: [{ account_id: accountId, account_name: "Fictional title signing", is_default: true, base_uri: "https://demo.docusign.net" }] });
  if (url.includes("/companyinfo/")) return json({ CompanyInfo: { Id: "1", CompanyName: "Fictional title accounting" } });
  if (url.includes("/reports/ProfitAndLoss?")) return json(report());
  if (url.includes("/templates?")) return json({ envelopeTemplates: [{ templateId, name: "Fictional onboarding", description: "Approved test template" }] });
  if (url.endsWith("/envelopes") && options.method === "POST") return json({ envelopeId, status: "created" });
  if (url.includes("/envelopes?transaction_ids=")) return json({ envelopes: [{ envelopeId, status: "created" }], totalSetSize: "1" });
  if (url.endsWith(`/envelopes/${envelopeId}`)) return json({ envelopeId, status: "completed" });
  assert.fail(`Unexpected provider destination ${url}`);
}
globalThis.__vendorHttpClient = client;
globalThis.Deno = { env: { get: name => fixture ? fixture.env[name] : appEnv[name] }, serve: callback => { handler = callback; } };
globalThis.fetch = async (url, options) => {
  fixture.vendorCalls.push({ url, options: structuredClone({ ...options, signal: undefined }) });
  return fixture.vendor(url, options);
};
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../supabase/functions/title-api/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022", logLevel: "silent",
  plugins: [{ name: "synthetic-vendor-transport", setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient = () => globalThis.__vendorHttpClient;" }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
beforeEach(() => {
  fixture = { authenticated: true, confirmed: true, anonymous: false, aal: "aal2", active: true, role: "owner", allCompanies: true,
    configured: true, revision: 4, environment: "sandbox", expiresAt: new Date(Date.now() + 3600000).toISOString(), busy: false,
    tokens: { accessToken: privateAccess, refreshToken: privateRefresh }, refreshClaimOk: true,
    env: { ...appEnv }, queries: [], calls: [], states: new Map(), drafts: new Map(), vendorCalls: [], vendor: defaultVendor,
    rpcErrors: {}, rpcThrow: null,
    security: { session_valid: true, password_change_required: false, has_totp: true, session_totp: true } };
});
after(() => { globalThis.Deno = originalDeno; globalThis.fetch = originalFetch; delete globalThis.__vendorHttpClient; });
async function execute(req) { const response = await handler(req); return { status: response.status, body: await response.json() }; }
const input = (provider = "docusign", patch = {}) => ({ workspaceId, provider, companyId, expectedRevision: fixture.revision, ...patch });
const post = (operation, value = input(), raw) => execute(new Request(`${origin}/integrations/vendors/${operation}`, {
  method: "POST", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" }, body: raw ?? JSON.stringify(value),
}));
const list = (patch = {}) => execute(new Request(`${origin}/integrations/vendors?${new URLSearchParams({ workspaceId, ...patch })}`, { headers: { Authorization: "Bearer synthetic-session" } }));
const noProvider = () => assert.deepEqual(fixture.vendorCalls, []);
const noVendorRpc = () => assert.deepEqual(fixture.calls, []);
const noSecrets = value => {
  for (const secret of [privateAccess, privateRefresh, privateSecret, privateError, appEnv.SUPABASE_SERVICE_ROLE_KEY]) assert.ok(!JSON.stringify(value).includes(secret), "Private provider material leaked");
};
const draftInput = (patch = {}) => input("docusign", { requestId, reviewed: true, templateId, emailSubject: "Fictional onboarding", roles: [{ roleName: "Owner", name: "Test Owner", email: "owner@example.test" }], ...patch });
async function start(provider = "docusign", patch = {}) {
  const result = await post("start", input(provider, { accountId, ...patch }));
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body;
}
async function complete(provider = "docusign", patch = {}) {
  const started = await start(provider);
  return post("complete", input(provider, { accountId, realmId, state: started.state, code: "synthetic-code", ...patch }));
}

test("owner and organization-wide admin see safe configuration without vendor calls or token reads", async () => {
  for (const role of ["owner", "admin"]) {
    fixture.role = role;
    const result = await list(); assert.equal(result.status, 200); noSecrets(result.body);
    assert.equal(result.body.providers.length, 2); assert.equal(result.body.providers[0].appConfigured, true);
  }
  assert.ok(fixture.calls.every(call => call.name === "title_vendor_list")); noProvider();
});
for (const role of ["operations", "onboarding", "finance", "viewer", "partner", "admin"]) {
  test(`${role} without organization administrator access cannot read or change vendor credentials`, async () => {
    fixture.role = role; fixture.allCompanies = role !== "admin";
    for (const action of [() => list(), () => post("start", input("docusign", { accountId })), () => post("check"), () => post("disconnect"), () => post("draft", draftInput())])
      assert.equal((await action()).status, 403);
    noVendorRpc(); noProvider();
  });
}
for (const [name, change, expected] of [
  ["invalid login", f => { f.authenticated = false; }, 401], ["unverified email", f => { f.confirmed = false; }, 403],
  ["anonymous user", f => { f.anonymous = true; }, 403], ["expired session", f => { f.security.session_valid = false; }, 401],
  ["startup password", f => { f.security.password_change_required = true; }, 403],
  ["missing MFA", f => { f.aal = "aal1"; f.security.has_totp = false; f.security.session_totp = false; }, 403],
  ["unverified MFA", f => { f.aal = "aal1"; f.security.session_totp = false; }, 403], ["revoked membership", f => { f.active = false; }, 403],
]) test(`${name} blocks listing, connecting, callback completion and vendor operations`, async () => {
  change(fixture);
  for (const action of [() => list(), () => post("start", input("docusign", { accountId })), () => post("complete", input("docusign", { state: "tv1_" + "a".repeat(64), code: "synthetic-code", accountId })), () => post("check"), () => post("draft", draftInput())])
    assert.equal((await action()).status, expected);
  noVendorRpc(); noProvider();
});
test("another workspace never reaches vendor state or credentials", async () => {
  assert.equal((await list({ workspaceId: otherWorkspaceId })).status, 403);
  assert.equal((await post("start", input("docusign", { workspaceId: otherWorkspaceId, accountId }))).status, 403);
  noVendorRpc(); noProvider();
});
test("server membership filters and versions scope every vendor RPC to the current actor", async () => {
  await list(); await post("check");
  for (const query of fixture.queries) {
    assert.ok(query.filters.some(([key, value]) => key === "workspace_id" && value === workspaceId));
    assert.ok(query.filters.some(([key, value]) => key === "user_id" && value === actorId));
    assert.ok(query.filters.some(([key, value]) => key === "active" && value === true));
  }
  for (const call of fixture.calls) assert.equal(call.args.p_access_version, 7);
});
test("missing app credentials remain visibly setup-required and cannot begin OAuth or read saved tokens", async () => {
  for (const key of ["DOCUSIGN_CLIENT_ID", "DOCUSIGN_CLIENT_SECRET", "DOCUSIGN_ENVIRONMENT", "TITLE_VENDOR_REDIRECT_URI"]) {
    fixture.env = { ...appEnv, [key]: "" }; fixture.calls = [];
    const result = await list(); assert.equal(result.body.providers[0].appConfigured, false);
    fixture.calls = [];
    assert.equal((await post("start", input("docusign", { accountId }))).status, 409);
    assert.equal((await post("check")).status, 409); noVendorRpc(); noProvider();
  }
});
test("OAuth start stores only a hash and binds generated random state to company, provider, actor and revision", async () => {
  const one = await start(); const two = await start();
  assert.match(one.state, /^tv1_[a-f0-9]{64}$/); assert.notEqual(one.state, two.state);
  const url = new URL(one.url); assert.equal(url.origin, "https://account-d.docusign.com"); assert.equal(url.searchParams.get("state"), one.state);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(one.state))).toString("hex");
  assert.deepEqual(fixture.calls[0].args, { p_workspace: workspaceId, p_actor: actorId, p_access_version: 7, p_provider: "docusign", p_company: companyId, p_environment: "sandbox", p_expected: 4, p_state_hash: hash });
  assert.ok(!JSON.stringify(fixture.calls).includes(one.state)); noSecrets(one); noProvider();
});
test("callback claim must match the same provider/company and cannot replay a consumed state", async () => {
  const started = await start();
  const args = input("docusign", { state: started.state, code: "synthetic-code", accountId });
  assert.equal((await post("complete", { ...args, provider: "quickbooks", realmId })).status, 409); noProvider();
  assert.equal((await post("complete", { ...args, companyId: "another-company" })).status, 403); noProvider();
  assert.equal((await post("complete", args)).status, 200);
  fixture.vendorCalls = [];
  assert.equal((await post("complete", args)).status, 409); noProvider();
});
test("expired, missing and malformed OAuth states cannot exchange authorization codes", async () => {
  for (const state of ["", "tv1_" + "b".repeat(64), "tv1_" + "a".repeat(63), "tv1_" + "a".repeat(65), "tv1_" + "g".repeat(64)]) {
    const result = await post("complete", input("docusign", { state, code: "synthetic-code", accountId }));
    assert.ok([400, 409].includes(result.status));
  }
  noProvider();
});
test("DocuSign completion writes validated tokens only to the private finish RPC and exposes safe metadata", async () => {
  const result = await complete(); assert.equal(result.status, 200, JSON.stringify(result.body)); noSecrets(result.body);
  assert.equal(fixture.vendorCalls.length, 2);
  const finish = fixture.calls.find(call => call.name === "title_vendor_finish");
  assert.deepEqual(finish.args.p_tokens, { accessToken: privateAccess, refreshToken: privateRefresh });
  assert.deepEqual(finish.args.p_metadata, { accountId, accountName: "Fictional title signing", baseUri: "https://demo.docusign.net" });
  assert.equal(finish.args.p_lease, leaseId);
});
test("QuickBooks completion gets the actual selected realm's identity before persisting its mapping", async () => {
  const result = await complete("quickbooks"); assert.equal(result.status, 200, JSON.stringify(result.body)); noSecrets(result.body);
  assert.ok(fixture.vendorCalls[1].url.endsWith(`/companyinfo/${realmId}`));
  assert.deepEqual(fixture.calls.find(call => call.name === "title_vendor_finish").args.p_metadata, { realmId, accountName: "Fictional title accounting" });
});
test("cancelled approval or changed environment consumes state and releases the lease before any vendor exchange", async () => {
  for (const mode of ["denied", "environment"]) {
    const started = await start(); fixture.vendorCalls = [];
    if (mode === "environment") fixture.env.DOCUSIGN_ENVIRONMENT = "production";
    const result = await post("complete", input("docusign", { accountId, state: started.state, code: "synthetic-code", denied: mode === "denied" }));
    assert.equal(result.status, 409); noProvider(); assert.equal(fixture.calls.at(-1).name, "title_vendor_release");
    fixture.env = { ...appEnv };
  }
});
test("unauthorized signing account and provider failure cannot save a partial connection", async () => {
  const notAuthorized = await complete("docusign", { accountId: templateId }); assert.equal(notAuthorized.status, 409);
  assert.ok(!fixture.calls.some(call => call.name === "title_vendor_finish")); assert.equal(fixture.calls.at(-1).name, "title_vendor_release");
  fixture.vendor = async () => new Response(privateError, { status: 401 });
  const failed = await complete(); assert.equal(failed.status, 409); noSecrets(failed.body); assert.equal(fixture.calls.at(-1).name, "title_vendor_release");
});
test("RPC rejections and transport exceptions never echo vendor tokens, database messages or request details", async () => {
  fixture.rpcErrors.title_vendor_list = { code: "XX000", message: `${privateError} ${privateAccess}` };
  let result = await list(); assert.equal(result.status, 500); noSecrets(result.body);
  fixture.rpcErrors = {}; fixture.rpcThrow = "title_vendor_list";
  result = await list(); assert.equal(result.status, 500); noSecrets(result.body);
});
test("failed private token save attempts lease release and returns no token details", async () => {
  fixture.rpcThrow = "title_vendor_finish";
  const result = await complete(); assert.equal(result.status, 500); noSecrets(result.body);
  assert.equal(fixture.calls.at(-1).name, "title_vendor_release");
});
test("stale revisions, disconnected accounts and busy refresh leases block vendor calls", async () => {
  for (const mode of ["revision", "disconnected", "busy"]) {
    fixture.configured = mode !== "disconnected"; fixture.busy = mode === "busy";
    const result = await post("check", input("docusign", { expectedRevision: mode === "revision" ? 3 : 4 }));
    assert.equal(result.status, 409); noProvider();
  }
});
test("expired token refresh uses the private claim, atomically replaces tokens, then checks with the new revision", async () => {
  fixture.expiresAt = "2020-01-01T00:00:00Z";
  fixture.tokens.refreshToken = "OLD-REFRESH-TEST-ONLY";
  const result = await post("check", input("quickbooks")); assert.equal(result.status, 200, JSON.stringify(result.body)); noSecrets(result.body);
  const refresh = fixture.vendorCalls[0]; assert.equal(new URLSearchParams(refresh.options.body).get("refresh_token"), "OLD-REFRESH-TEST-ONLY");
  assert.equal(fixture.calls.find(call => call.name === "title_vendor_finish").args.p_tokens.refreshToken, privateRefresh);
  assert.equal(result.body.revision, 5); assert.equal(fixture.vendorCalls.length, 2);
});
test("a lost refresh claim performs no token exchange or read request", async () => {
  fixture.expiresAt = "2020-01-01T00:00:00Z"; fixture.refreshClaimOk = false;
  assert.equal((await post("check")).status, 409); noProvider();
});
test("a reconnect after token refresh cannot silently switch an already-reviewed operation to another revision", async () => {
  fixture.expiresAt = "2020-01-01T00:00:00Z"; fixture.afterFinish = () => { fixture.revision++; };
  const result = await post("check", input("quickbooks"));
  assert.equal(result.status, 409); assert.equal(fixture.vendorCalls.length, 1);
  assert.ok(fixture.vendorCalls[0].url.endsWith("/tokens/bearer"));
});
test("ordinary QuickBooks report is read-only and checked again against the company credential revision", async () => {
  const result = await post("report", input("quickbooks", { startDate: "2026-09-01", endDate: "2026-09-23", accountingMethod: "Accrual" }));
  assert.equal(result.status, 200, JSON.stringify(result.body)); noSecrets(result.body); assert.equal(result.body.report.realmId, realmId);
  assert.equal(result.body.report.rows[0].cells[1], "10.00"); assert.equal(fixture.vendorCalls.length, 1);
  assert.equal(fixture.vendorCalls[0].options.method, "GET"); assert.equal(fixture.calls.at(-1).name, "title_vendor_status");
});
test("a company disconnect while a report is in flight prevents the report from reaching the browser", async () => {
  fixture.vendor = async (...args) => { fixture.configured = false; fixture.revision++; return defaultVendor(...args); };
  const result = await post("report", input("quickbooks", { startDate: "2026-09-01", endDate: "2026-09-23", accountingMethod: "Accrual" }));
  assert.equal(result.status, 409); assert.equal(result.body.report, undefined); noSecrets(result.body);
});
test("DocuSign templates use only the saved account and fresh revision", async () => {
  const result = await post("templates", input("docusign", { accountId: templateId, baseUri: "https://attacker.test" }));
  assert.equal(result.status, 200); assert.equal(result.body.templates[0].templateId, templateId);
  assert.ok(fixture.vendorCalls[0].url.includes(`/accounts/${accountId}/`)); assert.equal(fixture.calls.at(-1).name, "title_vendor_status");
});
test("reviewed draft reservation precedes the one created-status vendor call and retry cannot send another", async () => {
  const result = await post("draft", draftInput()); assert.equal(result.status, 200, JSON.stringify(result.body));
  const reserve = fixture.calls.find(call => call.name === "title_vendor_reserve_draft");
  assert.equal(reserve.args.p_expected, 4); assert.equal(reserve.args.p_request, requestId); assert.match(reserve.args.p_payload_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(fixture.vendorCalls[0].options.body).status, "created"); assert.equal(result.body.draft.envelopeId, envelopeId);
  fixture.vendorCalls = [];
  const retry = await post("draft", draftInput()); assert.equal(retry.status, 200); assert.equal(retry.body.envelopeId, envelopeId); noProvider();
});
test("draft without explicit review cannot reserve or call DocuSign", async () => {
  const result = await post("draft", draftInput({ reviewed: false })); assert.equal(result.status, 400);
  assert.ok(!fixture.calls.some(call => call.name === "title_vendor_reserve_draft")); noProvider();
});
test("local recipient validation completes before durable draft reservation", async () => {
  for (const roles of [
    [{ roleName: "Owner", name: "Test", email: "Name<owner@example.test>" }],
    [{ roleName: "Owner", name: "Test", email: "owner@example.test,other@example.test" }],
    [{ roleName: "Owner", name: "Test", email: "a".repeat(65) + "@example.test" }],
    [{ roleName: "Owner", name: "Test", email: "owner@example.test" }, { roleName: "Owner", name: "Another", email: "another@example.test" }],
  ]) {
    const result = await post("draft", draftInput({ roles })); assert.equal(result.status, 400);
    assert.ok(!fixture.calls.some(call => call.name === "title_vendor_reserve_draft")); noProvider();
  }
});
test("an uncertain draft response leaves its reservation pending and a repeated click does not reissue POST", async () => {
  fixture.vendor = async () => { throw Error(privateError); };
  const first = await post("draft", draftInput()); assert.equal(first.status, 502); noSecrets(first.body); assert.equal(fixture.drafts.get(requestId).envelopeId, null);
  fixture.vendorCalls = []; fixture.vendor = defaultVendor;
  const retry = await post("draft", draftInput()); assert.equal(retry.status, 200); assert.equal(retry.body.pending, true); noProvider();
});
test("reusing a draft request with changed recipients fails without another vendor request", async () => {
  assert.equal((await post("draft", draftInput())).status, 200); fixture.vendorCalls = [];
  const result = await post("draft", draftInput({ emailSubject: "Changed reviewed content" })); assert.equal(result.status, 409); noProvider();
});
test("uncertain draft recovery first reserves a check and uses only a transaction lookup GET", async () => {
  fixture.drafts.set(requestId, { requestId, envelopeId: null, status: "pending" });
  const result = await post("draft-status", input("docusign", { requestId }));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.draft.envelopeId, envelopeId);
  assert.equal(fixture.calls[1].name, "title_vendor_claim_draft_check");
  assert.equal(fixture.vendorCalls.length, 1); assert.equal(fixture.vendorCalls[0].options.method, "GET");
  assert.ok(fixture.vendorCalls[0].url.includes(`transaction_ids=${requestId}`));
});
test("known envelope status checks use its recorded ID and cannot accept an arbitrary client envelope", async () => {
  fixture.drafts.set(requestId, { requestId, envelopeId, status: "created" });
  const result = await post("draft-status", input("docusign", { requestId, envelopeId: accountId }));
  assert.equal(result.status, 200); assert.equal(result.body.draft.status, "completed");
  assert.ok(fixture.vendorCalls[0].url.endsWith(`/envelopes/${envelopeId}`));
});
test("a throttled or invalid-company draft check cannot poll or update provider records", async () => {
  fixture.drafts.set(requestId, { requestId, envelopeId, status: "created" }); fixture.checkClaimed = true;
  const throttled = await post("draft-status", input("docusign", { requestId }));
  assert.equal(throttled.status, 429, JSON.stringify(throttled.body)); noSecrets(throttled.body); noProvider();
  fixture.checkClaimed = false;
  const missing = await post("draft-status", input("docusign", { requestId: accountId }));
  assert.equal(missing.status, 409); noProvider();
});
test("missing transaction recovery leaves the request pending and never prepares a replacement", async () => {
  fixture.drafts.set(requestId, { requestId, envelopeId: null, status: "pending" });
  fixture.vendor = async () => json({ envelopes: [], totalSetSize: "0" });
  const result = await post("draft-status", input("docusign", { requestId }));
  assert.equal(result.status, 200); assert.equal(result.body.pending, true);
  assert.equal(fixture.drafts.get(requestId).envelopeId, null); assert.equal(fixture.vendorCalls.length, 1);
  assert.equal(fixture.vendorCalls[0].options.method, "GET");
});
test("revoked permission while reading a provider prevents returning its result", async () => {
  fixture.vendor = async (...args) => {
    fixture.rpcErrors.title_vendor_status = { code: "42501", message: privateError };
    return defaultVendor(...args);
  };
  const result = await post("templates"); assert.equal(result.status, 403); assert.equal(result.body.templates, undefined); noSecrets(result.body);
});
test("disconnect uses the expected connection revision without deleting through a broad service table write", async () => {
  const result = await post("disconnect"); assert.equal(result.status, 200); noSecrets(result.body);
  assert.deepEqual(fixture.calls, [{ name: "title_vendor_disconnect", args: { p_workspace: workspaceId, p_actor: actorId, p_access_version: 7, p_provider: "docusign", p_company: companyId, p_expected: 4 } }]); noProvider();
});
test("malformed JSON and primitive vendor requests fail as invalid input without reading credentials", async () => {
  for (const raw of ["{", "null", "[]", '"string"']) {
    const result = await post("start", undefined, raw); assert.equal(result.status, 400, JSON.stringify({ raw, result }));
  }
  noVendorRpc(); noProvider();
});
test("unknown vendor routes and unsupported methods cannot read any private token", async () => {
  assert.equal((await post("unexpected", input())).status, 404); noVendorRpc(); noProvider();
  const result = await execute(new Request(`${origin}/integrations/vendors/check?${new URLSearchParams({ workspaceId, provider: "docusign", companyId, expectedRevision: "4" })}`, { headers: { Authorization: "Bearer synthetic-session" } }));
  assert.equal(result.status, 405); noVendorRpc(); noProvider();
});
test("vendor write bodies have a 32 KiB streaming limit even with a false Content-Length", async () => {
  let consumed = 0, canceled = false;
  const stream = new ReadableStream({ pull(controller) { consumed += 4096; controller.enqueue(new Uint8Array(4096).fill(32)); }, cancel() { canceled = true; } }, { highWaterMark: 0 });
  const result = await execute(new Request(`${origin}/integrations/vendors/complete`, { method: "POST", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json", "Content-Length": "1" }, body: stream, duplex: "half" }));
  assert.equal(result.status, 413); assert.ok(consumed <= 36864); assert.equal(canceled, true); noVendorRpc(); noProvider();
});
