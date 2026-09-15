// Actual title-api handler; synthetic Auth/database transport only. No live
// accounts, credentials, network requests, or shared bundle files are used.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const wid = "11111111-1111-4111-8111-111111111111", otherWid = "44444444-4444-4444-8444-444444444444";
const actor = "22222222-2222-4222-8222-222222222222", staff = "55555555-5555-4555-8555-555555555555";
const outsider = "66666666-6666-4666-8666-666666666666", revoked = "77777777-7777-4777-8777-777777777777";
const email = "owner@example.test", originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
let fixture, handler;
const ok = data => ({ data, error: null });
const membership = (userId, extra = {}) => ({ workspace_id: wid, user_id: userId, role: "operations", company_ids: ["A"],
  all_companies: false, restricted_access: false, partner_members: [], active: true, version: 1, ...extra });
const user = (id, email) => ({ id, email, phone: "PRIVATE_PHONE", user_metadata: { private: "PRIVATE_USER_METADATA" }, app_metadata: { private: "PRIVATE_APP_METADATA" } });
const client = {
  auth: {
    getUser: async () => ok({ user: { id: actor, email, email_confirmed_at: "2026-01-01T00:00:00Z" } }),
    getClaims: async () => ok({ claims: { sub: actor, session_id: "33333333-3333-4333-8333-333333333333", aal: "aal2" } }),
    admin: {
      listUsers: async () => { throw Error("The directory must never enumerate Auth users"); },
      async getUserById(id) {
        fixture.lookups.push(id); fixture.inFlight++; fixture.maxInFlight = Math.max(fixture.maxInFlight, fixture.inFlight);
        try {
          if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
          const outcome = fixture.failures.get(id);
          if (outcome === "throw") throw Error("PRIVATE_AUTH_ERROR");
          if (outcome === "error") return { data: { user: null }, error: { message: "PRIVATE_AUTH_ERROR" } };
          if (outcome === "missing") return ok({ user: null });
          return ok({ user: fixture.users.get(id) || null });
        } finally { fixture.inFlight--; }
      },
    },
  },
  async rpc(name, args) {
    assert.equal(name, "title_security_state"); assert.equal(args.p_user, actor);
    return ok({ session_valid: true, password_change_required: false, has_totp: true, session_totp: true });
  },
  from(table) {
    const query = { table, columns: "*", filters: [] }; fixture.queries.push(query);
    const selected = () => {
      let rows;
      if (table === "title_memberships") rows = fixture.memberships;
      else if (table === "title_invitations") rows = fixture.invitations;
      else throw Error(`Unexpected table ${table}`);
      return rows.filter(row => query.filters.every(([key, value]) => row[key] === value)).map(row =>
        query.columns === "*" ? structuredClone(row) : Object.fromEntries(query.columns.split(",").map(key => [key, row[key]])));
    };
    return {
      select(columns = "*") { query.columns = columns; return this; },
      eq(key, value) { query.filters.push([key, value]); return this; },
      async maybeSingle() { const rows = selected(); assert(rows.length <= 1, "Missing membership scope"); return ok(rows[0] || null); },
      then(resolve, reject) { return Promise.resolve(ok(selected())).then(resolve, reject); },
    };
  },
};
globalThis.__memberDirectoryClient = client;
globalThis.__memberIdentityClient = createClient;
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: "https://synthetic.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-only" })[name] }, serve: callback => { handler = callback; } };
globalThis.fetch = async (input, init) => {
  const target = new URL(String(input));
  assert.equal(target.origin, "https://synthetic.example.test");
  assert(target.pathname.startsWith("/auth/v1/admin/users/")); assert.equal(init.method, "GET");
  const id = target.pathname.split("/").at(-1);
  fixture.lookups.push(id); fixture.inFlight++; fixture.maxInFlight = Math.max(fixture.maxInFlight, fixture.inFlight);
  try {
    assert(init.signal instanceof AbortSignal);
    if (fixture.hang || fixture.delay) await new Promise((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); fixture.aborted++; reject(new DOMException("Synthetic request cancelled", "AbortError")); };
      const timer = setTimeout(() => { init.signal.removeEventListener("abort", aborted); resolve(); }, fixture.hang ? 30000 : fixture.delay);
      init.signal.addEventListener("abort", aborted, { once: true });
      if (init.signal.aborted) aborted();
    });
    const outcome = fixture.failures.get(id);
    if (outcome === "throw") throw Error("PRIVATE_AUTH_ERROR");
    if (outcome === "error") return new Response(JSON.stringify({ message: "PRIVATE_AUTH_ERROR" }), { status: 503 });
    return new Response(JSON.stringify({ user: outcome === "missing" ? null : fixture.users.get(id) || null }), { headers: { "Content-Type": "application/json" } });
  } finally { fixture.inFlight--; }
};
const bundled = await build({ entryPoints: [fileURLToPath(new URL("../../supabase/functions/title-api/index.ts", import.meta.url))],
  write: false, bundle: true, format: "esm", platform: "node", target: "es2022", logLevel: "silent",
  plugins: [{ name: "synthetic-directory-client", setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient = (url,key,options) => options.global?.fetch ? globalThis.__memberIdentityClient(url,key,options) : globalThis.__memberDirectoryClient;" }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
beforeEach(() => {
  fixture = {
    memberships: [membership(actor, { role: "owner", all_companies: true, company_ids: [] }), membership(staff), membership(revoked, { active: false }), membership(outsider, { workspace_id: otherWid })],
    invitations: [{ id: "pending-one", workspace_id: wid, email: "pending@example.test", role: "operations" }, { id: "pending-other", workspace_id: otherWid, email: "other-pending@example.test", role: "operations" }],
    users: new Map([[actor, user(actor, email)], [staff, user(staff, "staff@example.test")], [revoked, user(revoked, "revoked@example.test")], [outsider, user(outsider, "outsider@example.test")]]),
    lookups: [], queries: [], failures: new Map(), delay: 0, hang: false, aborted: 0, inFlight: 0, maxInFlight: 0,
  };
});
after(() => { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; delete globalThis.__memberDirectoryClient; delete globalThis.__memberIdentityClient; });
async function directory(workspaceId = wid) {
  const response = await handler(new Request(`https://synthetic.example.test/functions/v1/title-api/members?workspaceId=${workspaceId}`, { headers: { Authorization: "Bearer synthetic-session" } }));
  return { status: response.status, body: await response.json() };
}
test("workspace-scoped membership rows gain only current account email", async () => {
  const result = await directory(); assert.equal(result.status, 200);
  assert.deepEqual(result.body.members.map(m => [m.user_id, m.email]), [[actor, email], [staff, "staff@example.test"], [revoked, "revoked@example.test"]]);
  assert.deepEqual(fixture.lookups, [actor, staff, revoked]); assert.equal(result.body.members[2].active, false);
  assert.deepEqual(Object.keys(result.body.members[1]).sort(), ["user_id", "email", "role", "company_ids", "all_companies", "restricted_access", "partner_members", "active", "version"].sort());
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|outsider@example|other-pending@example/);
  assert.equal(result.body.invitations.length, 1);
  assert(fixture.queries.every(q => q.filters.some(([key, value]) => key === "workspace_id" && value === wid)));
});
test("an organization-wide admin can resolve its assigned workspace membership identities", async () => {
  fixture.memberships[0].role = "admin";
  const result = await directory(); assert.equal(result.status, 200); assert.equal(result.body.members[1].email, "staff@example.test");
});
for (const role of ["operations", "viewer", "finance", "onboarding", "partner", "scoped-admin"]) {
  test(`${role} cannot initiate a member directory or Auth identity lookup`, async () => {
    fixture.memberships[0].role = role === "scoped-admin" ? "admin" : role;
    if (role === "scoped-admin") fixture.memberships[0].all_companies = false;
    const result = await directory(); assert.equal(result.status, 403); assert.deepEqual(fixture.lookups, []);
    assert.equal(fixture.queries.length, 1); assert(!fixture.queries.some(q => q.table === "title_invitations"));
  });
}
test("an unavailable workspace never triggers any account identity lookup", async () => {
  const result = await directory(otherWid); assert.equal(result.status, 403); assert.deepEqual(fixture.lookups, []);
});
test("returned lookup errors, rejected promises and missing accounts remain explicit null emails", async () => {
  fixture.failures.set(actor, "error"); fixture.failures.set(staff, "throw"); fixture.failures.set(revoked, "missing");
  const result = await directory(); assert.equal(result.status, 200); assert(result.body.members.every(m => m.email === null));
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_/); assert.equal(result.body.invitations.length, 1);
});
test("refresh retries unavailable identities and retrieves the current email without caching", async () => {
  fixture.failures.set(staff, "error"); let result = await directory(); assert.equal(result.body.members[1].email, null);
  fixture.failures.delete(staff); fixture.users.set(staff, user(staff, "changed@example.test"));
  result = await directory(); assert.equal(result.body.members[1].email, "changed@example.test");
  assert.equal(fixture.lookups.filter(id => id === staff).length, 2);
});
test("missing email or a mismatched lookup identity is never presented as a membership email", async () => {
  fixture.users.set(staff, user(staff, " ")); fixture.users.set(revoked, user(outsider, "outsider@example.test"));
  const result = await directory(); assert.equal(result.status, 200);
  assert.equal(result.body.members[1].email, null); assert.equal(result.body.members[2].email, null);
  assert.doesNotMatch(JSON.stringify(result.body), /outsider@example/);
});
test("larger teams use bounded concurrent batches and preserve membership ordering", async () => {
  fixture.memberships = [fixture.memberships[0], ...Array.from({ length: 12 }, (_, i) => membership(`88888888-8888-4888-8888-${String(i).padStart(12, "0")}`))];
  for (const m of fixture.memberships) fixture.users.set(m.user_id, user(m.user_id, `${m.user_id}@example.test`));
  fixture.delay = 3;
  const result = await directory(); assert.equal(result.status, 200); assert.equal(result.body.members.length, 13);
  assert(fixture.maxInFlight > 1); assert(fixture.maxInFlight <= 4); assert.equal(fixture.inFlight, 0);
  assert.deepEqual(result.body.members.map(m => m.user_id), fixture.memberships.map(m => m.user_id));
});
test("a stalled identity request is cancelled before its concurrency slot is released", async () => {
  fixture.hang = true;
  const started = Date.now(), result = await directory();
  assert.equal(result.status, 200); assert(result.body.members.every(m => m.email === null));
  assert.equal(fixture.aborted, 3); assert.equal(fixture.inFlight, 0); assert(fixture.maxInFlight <= 4);
  assert(Date.now() - started < 5000);
});
test("the total enrichment deadline returns remaining members without starting more requests", async () => {
  fixture.memberships = [fixture.memberships[0], ...Array.from({ length: 20 }, (_, i) => membership(`88888888-8888-4888-8888-${String(i).padStart(12, "0")}`))];
  fixture.hang = true;
  const started = Date.now(), result = await directory();
  assert.equal(result.status, 200); assert.equal(result.body.members.length, 21); assert(result.body.members.every(m => m.email === null));
  assert.equal(fixture.inFlight, 0); assert(fixture.maxInFlight <= 4); assert(fixture.lookups.length < 21);
  assert.equal(fixture.aborted, fixture.lookups.length); assert(Date.now() - started < 10000);
});
