// Actual command HTTP handler and command executor. Only Auth/database transport is synthetic.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const wid = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333";
const otherWorkspace = "44444444-4444-4444-8444-444444444444";
const email = "owner@example.test", staffEmail = "staff@example.test";
const originalDeno = globalThis.Deno;
let fixture, handler;
const ok = data => ({ data, error: null });
const member = (userId, extra = {}) => ({ workspace_id: wid, user_id: userId, role: "operations", company_ids: ["A"], all_companies: false, restricted_access: false, partner_members: [], active: true, version: 1, ...extra });
const client = {
  auth: {
    getUser: async () => ok({ user: { id: actor, email, email_confirmed_at: "2026-01-01T00:00:00Z" } }),
    getClaims: async () => ok({ claims: { sub: actor, session_id: "55555555-5555-4555-8555-555555555555", aal: "aal2" } }),
    admin: {
      listUsers: async () => { throw Error("Auth enumeration is not allowed"); },
      getUserById: async id => { fixture.lookups.push(id); return fixture.identityFailure ? { data: { user: null }, error: { message: "PRIVATE_AUTH_FAILURE" } } : ok({ user: fixture.users.get(id) || null }); },
    },
  },
  from(table) {
    const query = { table, filters: [], columns: "*" }; fixture.queries.push(query);
    const rows = () => {
      const source = table === "title_memberships" ? fixture.memberships : table === "title_workspaces" ? [{ id: wid, name: "Synthetic assignment workspace", revision: fixture.revision, state: fixture.state }]
        : ["title_audit", "title_command_receipts", "title_assets"].includes(table) ? [] : null;
      assert.notEqual(source, null, `Unexpected table ${table}`);
      return source.filter(row => query.filters.every(([key, value]) => row[key] === value)).map(row => query.columns === "*" ? structuredClone(row) : Object.fromEntries(query.columns.split(",").map(key => [key, row[key]])));
    };
    return {
      select(columns = "*") { query.columns = columns; return this; },
      eq(key, value) { query.filters.push([key, value]); return this; },
      order() { return this; }, limit() { return this; },
      async maybeSingle() { const values = rows(); assert(values.length <= 1); return ok(values[0] || null); },
      async single() { const values = rows(); assert.equal(values.length, 1); return ok(values[0]); },
      then(resolve, reject) { return Promise.resolve(ok(rows())).then(resolve, reject); },
    };
  },
  async rpc(name, args) {
    fixture.rpcs.push({ name, args: structuredClone(args) });
    if (name === "title_security_state") return ok({ session_valid: true, password_change_required: false, has_totp: true, session_totp: true });
    assert.equal(name, "title_commit"); assert.equal(args.p_workspace, wid); assert.equal(args.p_actor, actor);
    if (fixture.commitError) return { data: null, error: fixture.commitError };
    assert.equal(args.p_expected, fixture.revision);
    fixture.state = structuredClone(args.p_state); fixture.revision++;
    return ok({ revision: fixture.revision, replayed: false });
  },
};
globalThis.__assignmentHttpClient = client;
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: "https://synthetic.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-only" })[name] }, serve: callback => { handler = callback; } };
const bundled = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `import '../supabase/functions/title-api/index.ts'; export {emptyWorkspace} from './lib/backend/workspace';` },
  write: false, bundle: true, format: "esm", platform: "node", target: "es2022", logLevel: "silent",
  plugins: [{ name: "synthetic-assignment-client", setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient=()=>globalThis.__assignmentHttpClient;" }));
  } }],
});
const { emptyWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
beforeEach(() => {
  const state = emptyWorkspace(email);
  state.companies = ["A", "B"].map(id => ({ id, name: `Fictional company ${id}`, jurisdiction: "NC", operatingStates: ["NC"], initials: id, color: "blue", contact: "Test contact", email: "contact@example.test", location: "Charlotte", stage: "Onboarding", steps: Array(7).fill(false), members: [] }));
  state.tasks = [{ id: "T", companyId: "A", title: "Legacy task", owner: "Legacy Person", due: "2026-09-21", done: false, priority: "Normal" }];
  state.orders = [{ id: "O", companyId: "A", address: "100 Fictional Road", client: "Fictional client", type: "Purchase", underwriter: "", owner: "Legacy Person", jurisdiction: "NC", status: "New", due: "2026-09-21", premium: 0, rate: .4, month: "2026-09", fields: [], notes: "", exception: "", delivered: false, remitted: false }];
  fixture = { state, revision: 1, memberships: [member(actor, { role: "owner", all_companies: true, company_ids: [], restricted_access: true }), member(target)],
    users: new Map([[actor, { id: actor, email }], [target, { id: target, email: ` ${staffEmail} `, phone: "PRIVATE_PHONE", user_metadata: { value: "PRIVATE_METADATA" }, app_metadata: { value: "PRIVATE_APP" } }]]),
    lookups: [], queries: [], rpcs: [], identityFailure: false, commitError: null };
});
after(() => { globalThis.Deno = originalDeno; delete globalThis.__assignmentHttpClient; });
const edit = (table, id, value, insert = false) => ({ id: crypto.randomUUID(), name: "editDraft", args: [[{ table, id, value, insert }]] });
async function commands(actions, expectedRevision = fixture.revision) {
  const response = await handler(new Request("https://synthetic.example.test/functions/v1/title-api/commands", { method: "POST", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: wid, requestId: crypto.randomUUID(), expectedRevision, commands: actions }) }));
  return { status: response.status, body: await response.json() };
}
const committed = () => fixture.rpcs.filter(call => call.name === "title_commit");
for (const [table, id] of [["orders", "O"], ["tasks", "T"]]) {
  test(`${table} reassignment persists canonical account identity through the HTTP command path`, async () => {
    const result = await commands([edit(table, id, { assigneeId: target, owner: "Forged client label" })]);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.revision, 2);
    const row = result.body.state[table].find(item => item.id === id);
    assert.equal(row.assigneeId, target); assert.equal(row.owner, staffEmail); assert.equal(fixture.state[table][0].assigneeId, target);
    assert.deepEqual(fixture.lookups, [target]); assert.equal(committed().length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /assignableStaff|requireStaffAssignments|PRIVATE_|Forged client label/);
    assert.deepEqual(Object.keys(result.body.access).sort(), ["userId", "email", "role", "companyIds", "allCompanies", "restricted", "version", "partnerMembers"].sort());
  });
  test(`${table} new manual records require stable account identity`, async () => {
    const value = { ...fixture.state[table][0], id: "new" };
    const denied = await commands([edit(table, "new", value, true)]); assert.equal(denied.status, 400); assert.equal(committed().length, 0);
    const saved = await commands([edit(table, "new", { ...value, assigneeId: target, owner: "Forged" }, true)]);
    assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.state[table].find(row => row.id === "new").owner, staffEmail);
  });
  test(`${table} unrelated legacy edits stay usable without resolving an assignment`, async () => {
    const result = await commands([edit(table, id, table === "tasks" ? { done: true } : { notes: "Reviewed" })]);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(fixture.lookups, []); assert.equal(result.body.state[table][0].owner, "Legacy Person");
  });
}
for (const failure of ["inactive", "different workspace", "different company", "ineligible role", "missing email", "missing identity", "mismatched identity", "identity unavailable"]) {
  test(`a ${failure} selection is denied before any commit`, async () => {
    if (failure === "inactive") fixture.memberships[1].active = false;
    if (failure === "different workspace") fixture.memberships[1].workspace_id = otherWorkspace;
    if (failure === "different company") fixture.memberships[1].company_ids = ["B"];
    if (failure === "ineligible role") fixture.memberships[1].role = "viewer";
    if (failure === "missing email") fixture.users.get(target).email = " ";
    if (failure === "missing identity") fixture.users.delete(target);
    if (failure === "mismatched identity") fixture.users.get(target).id = actor;
    if (failure === "identity unavailable") fixture.identityFailure = true;
    const result = await commands([edit("tasks", "T", { assigneeId: target })]); assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(committed().length, 0); assert.equal(fixture.revision, 1);
    assert.equal(fixture.state.tasks[0].owner, "Legacy Person"); assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_/);
    if (["inactive", "different workspace"].includes(failure)) assert.deepEqual(fixture.lookups, []);
  });
}
for (const code of ["PT409", "40001", "42501"]) test(`commit-time ${code} rejects a previously eligible assignment without returning a saved state`, async () => {
  fixture.commitError = { code, message: "The staff assignment changed before commit. Refresh and review." };
  const result = await commands([edit("orders", "O", { assigneeId: target })]); assert.equal(result.status, code === "42501" ? 403 : 409); assert.equal(result.body.state, undefined); assert.equal(fixture.state.orders[0].assigneeId, undefined); assert.equal(committed().length, 1);
});
test("an optimistic revision conflict rejects before staff identity resolution", async () => {
  const result = await commands([edit("tasks", "T", { assigneeId: target })], 0); assert.equal(result.status, 409); assert.deepEqual(fixture.lookups, []); assert.equal(committed().length, 0);
});
test("a traced automation can still create suggested display-only tasks for later assignment", async () => {
  const result = await commands([{ id: crypto.randomUUID(), name: "executeRules", args: [["onboarding"]] }]); assert.equal(result.status, 200, JSON.stringify(result.body));
  const generated = result.body.state.tasks.filter(task => task.id.startsWith("auto-onboard-")); assert.equal(generated.length, 2); assert(generated.every(task => !task.assigneeId)); assert.deepEqual(fixture.lookups, []);
});
test("new-company creation and its initial self-assigned task commit in one reviewed batch", async () => {
  const company = { ...fixture.state.companies[0], id: "NEW", name: "Fictional new agency" };
  const task = { ...fixture.state.tasks[0], id: "NEW-TASK", companyId: company.id, title: "Collect onboarding application", owner: "Forged", assigneeId: actor };
  const result = await commands([{ id: crypto.randomUUID(), name: "editDraft", args: [[{ table: "companies", id: company.id, value: company, insert: true }, { table: "tasks", id: task.id, value: task, insert: true }]] }]);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(committed().length, 1); assert(result.body.state.companies.some(row => row.id === company.id));
  const saved = result.body.state.tasks.find(row => row.id === task.id); assert.equal(saved.companyId, company.id); assert.equal(saved.assigneeId, actor); assert.equal(saved.owner, email);
});
for (const actions of [[null], [{ id: crypto.randomUUID(), name: "editDraft", args: [[null]] }]]) test(`malformed HTTP command shape returns 400 without identity lookup ${JSON.stringify(actions)}`, async () => {
  const result = await commands(actions); assert.equal(result.status, 400); assert.deepEqual(fixture.lookups, []); assert.equal(committed().length, 0);
});
