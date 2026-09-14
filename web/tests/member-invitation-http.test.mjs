// Actual title-api handler, with synthetic Auth/database transport only.
// This test builds in memory and never opens a network connection or local DB.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const otherWorkspaceId = "44444444-4444-4444-8444-444444444444";
const actorEmail = "owner@example.test", inviteEmail = "staff@example.test";
const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
let fixture, handler;
const ok = data => ({ data, error: null });
const grant = (extra = {}) => ({ email: inviteEmail, role: "operations", companyIds: ["A"], allCompanies: false, restricted: false, partnerMembers: [], ...extra });
function pending(input = grant(), extra = {}) {
  return { id: "pending-fixture", workspace_id: workspaceId, email: input.email.toLowerCase(),
    role: input.role, company_ids: input.companyIds, all_companies: input.allCompanies,
    restricted_access: input.restricted, partner_members: input.partnerMembers,
    accepted_at: null, revoked_at: null, expires_at: "2099-01-01T00:00:00Z", ...extra };
}
const client = {
  auth: {
    getUser: async () => ok({ user: { id: actorId, email: actorEmail, email_confirmed_at: "2026-01-01T00:00:00Z" } }),
    getClaims: async () => ok({ claims: { sub: actorId, session_id: "33333333-3333-4333-8333-333333333333", aal: "aal2" } }),
  },
  async rpc(name, args) {
    assert.equal(name, "title_security_state"); assert.equal(args.p_user, actorId);
    return ok({ session_valid: true, password_change_required: false, has_totp: true, session_totp: true });
  },
  from(table) {
    const query = { table, filters: [], columns: "*", inserted: null }; fixture.queries.push(query);
    const rows = () => {
      if (query.inserted) return query.inserted;
      if (table === "title_memberships") return [{ workspace_id: workspaceId, user_id: actorId, role: fixture.role,
        all_companies: true, company_ids: [], restricted_access: true, partner_members: [], active: true, version: 1 }];
      if (table === "title_workspaces") return [{ id: workspaceId, state: { companies: ["A", "B"].map(id => ({ id, members: [{ name: "Member One" }, { name: "Member Two" }] })) } }];
      if (table === "title_invitations") return fixture.invitations;
      throw Error(`Unexpected table ${table}`);
    };
    const selected = () => rows().filter(row => query.filters.every(([method, key, value]) => method === "gt" ? row[key] > value : row[key] === value))
      .map(row => query.columns === "*" ? structuredClone(row) : Object.fromEntries(query.columns.split(",").map(key => [key, row[key]])));
    return {
      select(columns = "*") { query.columns = columns; return this; },
      eq(key, value) { query.filters.push(["eq", key, value]); return this; },
      is(key, value) { query.filters.push(["is", key, value]); return this; },
      gt(key, value) { query.filters.push(["gt", key, value]); return this; },
      insert(input) {
        assert(["title_invitations", "title_audit"].includes(table));
        fixture.writes.push({ table, input: structuredClone(input) });
        query.inserted = [{ ...input, id: "created-fixture" }]; return this;
      },
      async maybeSingle() { const values = selected(); assert(values.length <= 1, "Expected exactly scoped pending invitation"); return ok(values[0] || null); },
      async single() { const values = selected(); assert.equal(values.length, 1); return ok(values[0]); },
      then(resolve, reject) { return Promise.resolve(ok(selected())).then(resolve, reject); },
    };
  },
};
globalThis.__titleInvitationClient = client;
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: "https://synthetic.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-only" })[name] }, serve: callback => { handler = callback; } };
globalThis.fetch = async () => { throw Error("Invitation tests must not make network requests"); };
const bundled = await build({ entryPoints: [fileURLToPath(new URL("../../supabase/functions/title-api/index.ts", import.meta.url))],
  write: false, bundle: true, format: "esm", platform: "node", target: "es2022", logLevel: "silent",
  plugins: [{ name: "synthetic-invitation-client", setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient = () => globalThis.__titleInvitationClient;" }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
beforeEach(() => { fixture = { role: "owner", invitations: [], queries: [], writes: [] }; });
after(() => { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; delete globalThis.__titleInvitationClient; });
async function invite(input = grant()) {
  const response = await handler(new Request("https://synthetic.example.test/functions/v1/title-api/members/invite", {
    method: "POST", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, ...input }),
  }));
  return { status: response.status, body: await response.json() };
}

test("new invitation creates the requested grant and reports no email sent", async () => {
  const result = await invite(grant({ email: "STAFF@example.test" }));
  assert.equal(result.status, 200); assert.match(result.body.status, /prepared; no email sent/);
  assert.equal(fixture.writes.length, 2);
  assert.deepEqual(fixture.writes[0].input, { workspace_id: workspaceId, email: inviteEmail, role: "operations",
    company_ids: ["A"], all_companies: false, restricted_access: false, partner_members: [], created_by: actorId });
});
test("retrying the same pending grant reuses its ID without writes", async () => {
  fixture.invitations = [pending()];
  const result = await invite(); assert.equal(result.status, 200); assert.equal(result.body.id, "pending-fixture");
  assert.match(result.body.status, /already prepared; no email sent/); assert.deepEqual(fixture.writes, []);
});
for (const [name, change] of Object.entries({ role: { role: "viewer" }, company: { companyIds: ["B"] },
  "company set": { companyIds: ["A", "B"] }, "all-company access": { allCompanies: true }, "restricted access": { restricted: true } })) {
  test(`a pending invitation with different ${name} returns a clear conflict and preserves the original`, async () => {
    fixture.invitations = [pending()]; const original = structuredClone(fixture.invitations);
    const result = await invite(grant(change)); assert.equal(result.status, 409);
    assert.match(result.body.error, /pending invitation.*different.*(role|company|access)/i);
    assert.match(result.body.error, /not changed/i);
    assert.deepEqual(fixture.invitations, original); assert.deepEqual(fixture.writes, []);
  });
}
test("company order and duplicate IDs do not change an existing grant", async () => {
  fixture.invitations = [pending(grant({ companyIds: ["A", "B"] }))];
  const result = await invite(grant({ companyIds: ["B", "A", "B"] }));
  assert.equal(result.status, 200); assert.equal(result.body.id, "pending-fixture"); assert.deepEqual(fixture.writes, []);
});
test("partner grant comparison ignores generated IDs, ordering and duplicate assignments", async () => {
  const first = { companyId: "A", memberName: "Member One" }, second = { companyId: "B", memberName: "Member Two" };
  fixture.invitations = [pending(grant({ role: "partner", companyIds: ["A", "B"], partnerMembers: [{ ...first, id: "old-one" }, { ...second, id: "old-two" }] }))];
  const result = await invite(grant({ role: "partner", companyIds: ["B", "A"], partnerMembers: [second, first, second] }));
  assert.equal(result.status, 200); assert.equal(result.body.id, "pending-fixture"); assert.deepEqual(fixture.writes, []);
});
test("a changed partner identity is a different grant even in the same company", async () => {
  fixture.invitations = [pending(grant({ role: "partner", partnerMembers: [{ id: "old-one", companyId: "A", memberName: "Member One" }] }))];
  const result = await invite(grant({ role: "partner", partnerMembers: [{ companyId: "A", memberName: "Member Two" }] }));
  assert.equal(result.status, 409); assert.deepEqual(fixture.writes, []);
});
test("only the pending invitation for this workspace and email participates in comparison", async () => {
  fixture.invitations = [pending(grant({ role: "viewer" }), { workspace_id: otherWorkspaceId }),
    pending(grant({ role: "viewer", email: "other@example.test" })),
    pending(grant({ role: "viewer" }), { accepted_at: "2026-01-01T00:00:00Z" }),
    pending(grant({ role: "viewer" }), { revoked_at: "2026-01-01T00:00:00Z" }),
    pending(grant({ role: "viewer" }), { expires_at: "2000-01-01T00:00:00Z" })];
  const result = await invite(); assert.equal(result.status, 200); assert.equal(result.body.id, "created-fixture");
  const query = fixture.queries.find(q => q.table === "title_invitations" && !q.inserted);
  for (const filter of [["eq", "workspace_id", workspaceId], ["eq", "email", inviteEmail], ["is", "accepted_at", null], ["is", "revoked_at", null]])
    assert(query.filters.some(value => JSON.stringify(value) === JSON.stringify(filter)));
  assert(query.filters.some(([method, key]) => method === "gt" && key === "expires_at"));
});
test("an organization-wide admin can prepare a scoped ordinary staff invitation", async () => {
  fixture.role = "admin"; const result = await invite(); assert.equal(result.status, 200); assert.equal(fixture.writes.length, 2);
});
test("the existing owner-only elevated grant rule remains enforced", async () => {
  fixture.role = "admin";
  for (const change of [{ allCompanies: true }, { restricted: true, role: "onboarding" }, { role: "admin" }]) {
    const result = await invite(grant(change)); assert.equal(result.status, 403); assert.match(result.body.error, /Only the owner/);
  }
  assert.deepEqual(fixture.writes, []);
});
