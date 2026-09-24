// Real Edge handler and account authorization; synthetic identity/database only.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const workspaceId = "11111111-1111-4111-8111-111111111111", actorId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333", privateError = "PRIVATE_DATABASE_DETAILS";
const routeId = "route:org:team:A", path = "/integrations/missive/production-access";
const originalDeno = globalThis.Deno, originalFetch = globalThis.fetch;
let fixture, handler;
const ok = data => ({ data, error: null });
const client = {
  auth: {
    async getUser() { return fixture.authenticated ? ok({ user: { id: actorId, email: "owner@example.test", email_confirmed_at: "2026-09-01", is_anonymous: false } }) : { data: { user: null }, error: { message: "Unauthenticated" } }; },
    async getClaims() { return ok({ claims: { sub: actorId, session_id: sessionId, aal: fixture.aal } }); },
  },
  from(table) {
    assert.equal(table, "title_memberships", "Approval must not read credentials, bootstrap, or provider state");
    const filters = [];
    return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, async maybeSingle() {
      const row = { workspace_id: workspaceId, user_id: actorId, role: fixture.role, all_companies: fixture.allCompanies, company_ids: ["A"], restricted_access: false, active: fixture.active, version: 7, partner_members: [] };
      return ok(filters.every(([key, value]) => row[key] === value) ? row : null);
    } };
  },
  async rpc(name, args) {
    if (name === "title_security_state") return ok(fixture.security);
    if (name === "title_record_security_event") { fixture.denials++; return ok(null); }
    assert.equal(name, "title_missive_set_production_only", "Only the explicit local approval RPC may run");
    fixture.calls.push({ name, args: structuredClone(args) });
    assert.equal(args.p_actor, actorId); assert.equal(args.p_workspace, workspaceId); assert.equal(args.p_access_version, 7);
    if (fixture.rpcError) return { data: null, error: { code: fixture.rpcError, message: privateError } };
    if (args.p_expected !== fixture.routing.revision || args.p_route_id !== routeId) return { data: null, error: { code: "PT409", message: privateError } };
    fixture.routing.revision++; fixture.routing.mappings[0].version = fixture.routing.revision;
    fixture.routing.mappings[0].productionOnly = args.p_production_only;
    return ok(structuredClone(fixture.routing));
  },
};
globalThis.__missiveApprovalHttpClient = client;
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: "https://synthetic.example.test", SUPABASE_SERVICE_ROLE_KEY: "SYNTHETIC_SERVICE_ONLY" })[key] }, serve: fn => { handler = fn; } };
globalThis.fetch = async () => { fixture.providerCalls++; throw new Error("No provider calls are authorized in this test"); };
const bundled = await build({ entryPoints: [fileURLToPath(new URL("../../supabase/functions/title-api/index.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "es2022", logLevel: "silent",
  plugins: [{ name: "synthetic-approval-http", setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "client", namespace: "approval-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "approval-fixture" }, () => ({ contents: "export const createClient=()=>globalThis.__missiveApprovalHttpClient;" }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + "\n//# sourceURL=missive-production-access-http-test-bundle.mjs").toString("base64")}`);
beforeEach(() => {
  fixture = { authenticated: true, active: true, role: "owner", allCompanies: true, aal: "aal2", calls: [], providerCalls: 0, denials: 0, rpcError: null,
    security: { session_valid: true, password_change_required: false, has_totp: true, session_totp: true },
    routing: { schemaVersion: 2, revision: 5, mappings: [{ id: routeId, companyId: "A", organizationId: "org", teamId: "team", teamName: "Production Inbox", enabled: true, productionOnly: false, version: 5, approvedAt: "2026-09-23", approvedBy: "owner@example.test" }] } };
});
after(() => { globalThis.Deno = originalDeno; globalThis.fetch = originalFetch; delete globalThis.__missiveApprovalHttpClient; });
const valid = () => ({ workspaceId, expectedRoutingRevision: 5, mappingId: routeId, productionOnly: true, acknowledged: true });
async function request(input = valid(), method = "POST", authorization = true) {
  const response = await handler(new Request(`https://synthetic.example.test/functions/v1/title-api${path}${method === "GET" ? `?workspaceId=${workspaceId}` : ""}`, {
    method, headers: { ...(authorization ? { Authorization: "Bearer SYNTHETIC_SESSION" } : {}), "Content-Type": "application/json" },
    ...(method !== "GET" ? { body: JSON.stringify(input) } : {}),
  }));
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
}

test("owner approval sends only verified actor and exact reviewed route to local RPC", async () => {
  const result = await request();
  assert.equal(result.status, 200); assert.equal(result.cache, "no-store");
  assert.equal(result.body.routing.revision, 6); assert.equal(result.body.routing.mappings[0].productionOnly, true);
  assert.deepEqual(fixture.calls, [{ name: "title_missive_set_production_only", args: {
    p_workspace: workspaceId, p_actor: actorId, p_access_version: 7, p_expected: 5, p_route_id: routeId, p_production_only: true,
  } }]);
  assert.equal(fixture.providerCalls, 0);
});

test("organization-wide admins can approve; revocation works without decrypting or contacting Missive", async () => {
  fixture.role = "admin";
  assert.equal((await request()).status, 200);
  const result = await request({ ...valid(), expectedRoutingRevision: 6, productionOnly: false });
  assert.equal(result.status, 200); assert.equal(result.body.routing.mappings[0].productionOnly, false);
  assert.equal(fixture.calls[1].args.p_production_only, false); assert.equal(fixture.providerCalls, 0);
});

test("scoped admins and every nonadministrator role cannot invoke approval RPC", async () => {
  for (const role of ["admin", "operations", "onboarding", "finance", "viewer", "partner"]) {
    fixture.role = role; fixture.allCompanies = role !== "admin";
    const result = await request(); assert.equal(result.status, 403);
    assert.deepEqual(fixture.calls, []); assert.equal(fixture.providerCalls, 0);
  }
});

test("inactive membership, missing sign-in and insufficient account security reject before approval", async () => {
  fixture.active = false; assert.equal((await request()).status, 403);
  fixture.active = true; fixture.authenticated = false; assert.equal((await request()).status, 401);
  fixture.authenticated = true; assert.equal((await request(valid(), "POST", false)).status, 401);
  fixture.security.password_change_required = true; assert.equal((await request()).status, 403);
  assert.deepEqual(fixture.calls, []); assert.equal(fixture.providerCalls, 0);
});

test("a different workspace cannot borrow the owner's approval capability", async () => {
  const result = await request({ ...valid(), workspaceId: "44444444-4444-4444-8444-444444444444" });
  assert.equal(result.status, 403); assert.deepEqual(fixture.calls, []);
});

test("explicit consent, strict boolean, valid route and routing revision are mandatory", async () => {
  for (const changes of [{ acknowledged: false }, { acknowledged: undefined }, { acknowledged: "true" }, { productionOnly: undefined }, { productionOnly: 1 }, { productionOnly: "true" },
    { mappingId: "../other" }, { mappingId: "route:org:team" }, { mappingId: "route:org:team:A?write=true" },
    { expectedRoutingRevision: "5" }, { expectedRoutingRevision: -1 }, { expectedRoutingRevision: 5.1 }, { expectedRoutingRevision: null }]) {
    assert.equal((await request({ ...valid(), ...changes })).status, 400);
  }
  assert.deepEqual(fixture.calls, []); assert.equal(fixture.providerCalls, 0);
});

test("caller cannot supply forged actor, email, access version or arbitrary mapping properties", async () => {
  for (const changes of [{ actorId: "forged" }, { email: "forged@example.test" }, { accessVersion: 99 }, { companyId: "B" }, { teamId: "other" }, { approvedBy: "forged" }])
    assert.equal((await request({ ...valid(), ...changes })).status, 400);
  assert.deepEqual(fixture.calls, []);
});

test("GET and unsupported mutation methods cannot perform approvals", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) assert.equal((await request(valid(), method)).status, 405);
  assert.deepEqual(fixture.calls, []); assert.equal(fixture.providerCalls, 0);
});

test("stale routing or forged exact-shaped route returns conflict without retrying", async () => {
  for (const changes of [{ expectedRoutingRevision: 4 }, { mappingId: "route:org:team:B" }]) {
    const previous = fixture.calls.length;
    const result = await request({ ...valid(), ...changes });
    assert.equal(result.status, 409); assert.equal(fixture.calls.length, previous + 1);
    assert.ok(!JSON.stringify(result).includes(privateError));
  }
  assert.equal(fixture.routing.revision, 5);
});

test("database membership and route rechecks reject races and sanitize internal errors", async () => {
  for (const [code, expected] of [["42501", 403], ["PT409", 409], ["40001", 409], ["XX000", 500]]) {
    fixture.rpcError = code; const previous = fixture.calls.length;
    const result = await request(); assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result).includes(privateError)); assert.equal(fixture.calls.length, previous + 1);
  }
  assert.equal(fixture.routing.revision, 5); assert.equal(fixture.providerCalls, 0);
});
