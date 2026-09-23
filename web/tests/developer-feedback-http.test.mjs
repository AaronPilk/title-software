// Execute the actual Edge handler with synthetic Auth/database transport. SQL
// tests separately verify ownership filters, transaction races and rate limits.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const feedbackId = "44444444-4444-4444-8444-444444444444";
const otherWorkspaceId = "55555555-5555-4555-8555-555555555555";
const actorEmail = "feedback-reviewer@example.test";
const origin = "https://synthetic.example.test/functions/v1/title-api";
const bodyLimit = 32 * 1024;
const originalDeno = globalThis.Deno, originalFetch = globalThis.fetch;
let fixture, handler;
const ok = data => ({ data, error: null });
const submission = (patch = {}) => ({ workspaceId, id: feedbackId, kind: "problem",
  message: "Fictional feedback: the company list lost my filter.", page: "Companies", view: "agency", ...patch });
const update = (patch = {}) => ({ workspaceId, id: feedbackId, expectedVersion: 3,
  status: "in_progress", reply: "I can reproduce this with a fictional company.", ...patch });
const client = {
  auth: {
    getUser: async () => fixture.authenticated
      ? ok({ user: { id: actorId, email: actorEmail, email_confirmed_at: fixture.confirmed ? "2026-01-01T00:00:00Z" : null, is_anonymous: fixture.anonymous } })
      : { data: { user: null }, error: { message: "Synthetic invalid session" } },
    getClaims: async () => ok({ claims: { sub: actorId, session_id: sessionId, aal: fixture.aal } }),
  },
  async rpc(name, args) {
    if (name === "title_security_state") {
      assert.deepEqual(args, { p_user: actorId, p_session: sessionId });
      fixture.securityReads++;
      return ok(fixture.security);
    }
    assert(["title_list_feedback", "title_submit_feedback", "title_update_feedback"].includes(name), `Unexpected RPC ${name}`);
    fixture.calls.push({ name, args: structuredClone(args) });
    if (fixture.rpcError) return { data: null, error: fixture.rpcError };
    return ok(name === "title_list_feedback" ? [{ id: feedbackId, message: "Fictional saved feedback", version: 3 }] : { id: feedbackId, version: 4 });
  },
  from(table) {
    assert.equal(table, "title_memberships", "Feedback must use its scoped RPC, not read/write feedback rows directly");
    const filters = []; fixture.queries.push({ table, filters });
    return {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      async maybeSingle() {
        const membership = { workspace_id: workspaceId, user_id: actorId, role: fixture.role,
          company_ids: [], all_companies: fixture.allCompanies, restricted_access: false,
          partner_members: [], active: fixture.active, version: 7 };
        return ok(filters.every(([key, value]) => membership[key] === value) ? membership : null);
      },
      insert() { throw Error("Feedback writes must use a transaction RPC"); },
      update() { throw Error("Feedback writes must use a transaction RPC"); },
    };
  },
};
globalThis.__developerFeedbackClient = client;
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: "https://synthetic.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-only" })[name] }, serve: callback => { handler = callback; } };
globalThis.fetch = async () => { throw Error("No external requests are permitted in feedback tests"); };
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../../supabase/functions/title-api/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022", logLevel: "silent",
  plugins: [{ name: "synthetic-feedback-transport", setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient = () => globalThis.__developerFeedbackClient;" }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
beforeEach(() => {
  fixture = { authenticated: true, confirmed: true, anonymous: false, aal: "aal2", active: true,
    role: "operations", allCompanies: false, queries: [], calls: [], securityReads: 0, rpcError: null,
    security: { session_valid: true, password_change_required: false, has_totp: true, session_totp: true } };
});
after(() => { globalThis.Deno = originalDeno; globalThis.fetch = originalFetch; delete globalThis.__developerFeedbackClient; });

async function execute(request) {
  const response = await handler(request);
  return { status: response.status, body: await response.json() };
}
const post = (path, input, options = {}) => execute(new Request(`${origin}${path}`, {
  method: "POST", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json", ...options.headers },
  body: options.raw === undefined ? JSON.stringify(input) : options.raw,
}));
const submit = input => post("/feedback", input ?? submission());
const revise = input => post("/feedback/update", input ?? update());
const list = (query = {}) => execute(new Request(`${origin}/feedback?${new URLSearchParams({ workspaceId, ...query })}`, {
  headers: { Authorization: "Bearer synthetic-session" },
}));
const noFeedbackRpc = () => assert.deepEqual(fixture.calls, []);
const assertMembershipScope = () => {
  assert(fixture.queries.length > 0);
  for (const query of fixture.queries) {
    assert(query.filters.some(([key, value]) => key === "workspace_id" && value === workspaceId));
    assert(query.filters.some(([key, value]) => key === "user_id" && value === actorId));
    assert(query.filters.some(([key, value]) => key === "active" && value === true));
  }
};

for (const role of ["owner", "admin", "operations", "onboarding", "finance", "viewer", "partner"]) {
  test(`${role} can list and submit feedback using the current server identity without company grants`, async () => {
    fixture.role = role;
    assert.equal((await list()).status, 200);
    assert.equal((await submit()).status, 200);
    assert.deepEqual(fixture.calls, [
      { name: "title_list_feedback", args: { p_workspace: workspaceId, p_actor: actorId, p_actor_version: 7,
        p_limit: 50, p_before: null, p_before_id: null } },
      { name: "title_submit_feedback", args: { p_workspace: workspaceId, p_actor: actorId, p_email: actorEmail,
        p_actor_version: 7, p_id: feedbackId, p_kind: "problem", p_message: submission().message, p_page: "Companies", p_view: "agency" } },
    ]);
    assertMembershipScope();
  });
}

test("feedback accepts each category/view and preserves freeform links as ordinary text", async () => {
  for (const [kind, view, page] of [["problem", "agency", "Companies"], ["idea", "production", "Orders"], ["question", "partner", "Partner portal"]]) {
    const input = submission({ kind, view, page, message: "Example text <b>not markup</b>; see https://example.test/fictional" });
    const result = await submit(input); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(fixture.calls.at(-1).args.p_message, input.message);
    assert.equal(fixture.calls.at(-1).args.p_kind, kind); assert.equal(fixture.calls.at(-1).args.p_view, view);
  }
});

test("owner update forwards the reviewed version and server access version", async () => {
  fixture.role = "owner";
  for (const status of ["new", "in_progress", "done"]) {
    const result = await revise(update({ status })); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(fixture.calls.at(-1), { name: "title_update_feedback", args: { p_workspace: workspaceId,
      p_actor: actorId, p_actor_version: 7, p_id: feedbackId, p_expected_version: 3, p_status: status, p_reply: update().reply } });
  }
  assertMembershipScope();
});

for (const role of ["admin", "operations", "onboarding", "finance", "viewer", "partner"]) {
  test(`${role} cannot change feedback status or the owner's reply`, async () => {
    fixture.role = role; fixture.allCompanies = true;
    assert.equal((await revise()).status, 403); noFeedbackRpc();
  });
}

const deniedRequests = () => [() => list(), () => submit(), () => revise()];
for (const [name, change, status] of [
  ["invalid authentication", f => { f.authenticated = false; }, 401],
  ["unverified email", f => { f.confirmed = false; }, 403],
  ["anonymous account", f => { f.anonymous = true; }, 403],
  ["expired session", f => { f.security.session_valid = false; }, 401],
  ["required password setup", f => { f.security.password_change_required = true; }, 403],
  ["missing authenticator", f => { f.aal = "aal1"; f.security.has_totp = false; f.security.session_totp = false; }, 403],
  ["unverified authenticator session", f => { f.aal = "aal1"; f.security.session_totp = false; }, 403],
  ["inactive membership", f => { f.active = false; }, 403],
]) test(`${name} blocks every feedback route before its RPC`, async () => {
  fixture.role = "owner"; change(fixture);
  for (const request of deniedRequests()) assert.equal((await request()).status, status);
  noFeedbackRpc();
});

test("another workspace cannot be listed, submitted to or updated without its active membership", async () => {
  fixture.role = "owner";
  for (const request of [() => list({ workspaceId: otherWorkspaceId }), () => submit(submission({ workspaceId: otherWorkspaceId })),
    () => revise(update({ workspaceId: otherWorkspaceId }))]) assert.equal((await request()).status, 403);
  noFeedbackRpc();
});

test("missing authorization rejects feedback before looking up any membership", async () => {
  const result = await execute(new Request(`${origin}/feedback?workspaceId=${workspaceId}`));
  assert.equal(result.status, 401); assert.equal(fixture.securityReads, 0); assert.deepEqual(fixture.queries, []); noFeedbackRpc();
});

test("submission rejects malformed identifiers, enums, messages and page URLs before writing", async () => {
  for (const patch of [
    { id: "bad-id" }, { id: "-".repeat(36) }, { workspaceId: "bad-workspace" },
    { kind: "bug" }, { kind: null }, { message: "" }, { message: " \n " }, { message: "x".repeat(4001) }, { message: "embedded\u0000control" }, { message: { text: "wrong type" } },
    { page: "https://example.test/private/path?client=fictional" }, { page: "not-a-page" }, { page: null },
    { view: "admin" }, { view: "https://example.test/" }, { view: null },
  ]) {
    const result = await submit(submission(patch)); assert.equal(result.status, 400, JSON.stringify({ patch, response: result.body }));
  }
  noFeedbackRpc();
});

test("submission never accepts client author, account, delivery or URL metadata", async () => {
  for (const key of ["authorId", "userId", "email", "role", "actorVersion", "status", "reply", "url", "href", "attachments", "extra"]) {
    const result = await submit(submission({ [key]: "CLIENT_SUPPLIED" }));
    assert.equal(result.status, 400, `${key}: ${JSON.stringify(result.body)}`);
  }
  noFeedbackRpc();
});

test("owner updates reject unknown keys, malformed status and oversized replies", async () => {
  fixture.role = "owner";
  for (const patch of [
    { id: "-".repeat(36) }, { status: "closed" }, { status: null },
    { reply: "x".repeat(2001) }, { reply: "embedded\u0000control" }, { reply: { text: "wrong type" } }, { message: "rewrite author" }, { authorId: actorId }, { url: "https://example.test" },
  ]) {
    const result = await revise(update(patch)); assert.equal(result.status, 400, JSON.stringify({ patch, response: result.body }));
  }
  noFeedbackRpc();
});

test("invalid reviewed versions require a refresh before any owner update RPC", async () => {
  fixture.role = "owner";
  for (const expectedVersion of [0, -1, 1.5, "3", null, 2147483648]) {
    const result = await revise(update({ expectedVersion }));
    assert.equal(result.status, 409, JSON.stringify({ expectedVersion, response: result.body }));
  }
  noFeedbackRpc();
});

test("maximum message/reply lengths and an empty reply remain usable", async () => {
  assert.equal((await submit(submission({ message: "x".repeat(4000) }))).status, 200);
  fixture.role = "owner";
  for (const reply of ["x".repeat(2000), ""]) assert.equal((await revise(update({ reply }))).status, 200);
});

test("list forwards paired cursor precision and a bounded limit without truncating microseconds", async () => {
  for (const before of ["2026-09-23T15:10:11.123456Z", "2026-09-23T11:10:11.123456-04:00"]) {
    const result = await list({ before, beforeId: feedbackId, limit: "13" }); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(fixture.calls.at(-1), { name: "title_list_feedback", args: { p_workspace: workspaceId,
      p_actor: actorId, p_actor_version: 7, p_limit: 13, p_before: before, p_before_id: feedbackId } });
  }
});

test("invalid, incomplete and unknown list cursors never reach the feedback RPC", async () => {
  for (const query of [
    { before: "2026-09-23T15:10:11Z" }, { beforeId: feedbackId },
    { before: "2026-09-23", beforeId: feedbackId }, { before: "2026-09-23T15:10:11", beforeId: feedbackId },
    { before: "2026-13-23T15:10:11Z", beforeId: feedbackId }, { before: "2026-09-23T15:10:11.1234567Z", beforeId: feedbackId },
    { before: "2026-09-23T15:10:11Z", beforeId: "-".repeat(36) },
    { limit: "0" }, { limit: "51" }, { limit: "1.5" }, { limit: "all" }, { authorId: actorId }, { url: "https://example.test" },
  ]) {
    const result = await list(query); assert.equal(result.status, 400, JSON.stringify({ query, response: result.body }));
  }
  noFeedbackRpc();
});

test("malformed JSON, non-object bodies and invalid UTF-8 reject both write endpoints", async () => {
  fixture.role = "owner";
  for (const path of ["/feedback", "/feedback/update"]) {
    for (const raw of ["{", "null", "[]", '"string"', new Uint8Array([0xc3, 0x28])]) {
      const result = await post(path, null, { raw }); assert.equal(result.status, 400, JSON.stringify(result.body));
    }
  }
  noFeedbackRpc();
});

function oversizedStream(path, declared) {
  let bytesRead = 0, canceled = false;
  const total = bodyLimit * 4, chunk = 4096;
  const stream = new ReadableStream({
    pull(controller) {
      if (bytesRead >= total) { controller.close(); return; }
      bytesRead += chunk; controller.enqueue(new Uint8Array(chunk).fill(32));
    },
    cancel() { canceled = true; },
  }, { highWaterMark: 0 });
  const request = new Request(`${origin}${path}`, { method: "POST", headers: { Authorization: "Bearer synthetic-session",
    "Content-Type": "application/json", ...(declared === undefined ? {} : { "Content-Length": declared }) }, body: stream, duplex: "half" });
  return { request, get bytesRead() { return bytesRead; }, get canceled() { return canceled; } };
}

test("the 32 KiB cap cancels oversized streams with absent or forged lengths before writing", async () => {
  fixture.role = "owner";
  for (const path of ["/feedback", "/feedback/update"]) for (const declared of [undefined, "1"]) {
    const input = oversizedStream(path, declared), result = await execute(input.request);
    assert.equal(result.status, 413, JSON.stringify(result.body)); assert.equal(input.canceled, true);
    assert(input.bytesRead <= bodyLimit + 4096); assert(input.bytesRead < bodyLimit * 4);
  }
  noFeedbackRpc();
});

test("declared excess is rejected without consuming the feedback stream", async () => {
  fixture.role = "owner";
  for (const path of ["/feedback", "/feedback/update"]) {
    const input = oversizedStream(path, String(bodyLimit + 1));
    assert.equal((await execute(input.request)).status, 413); assert.equal(input.bytesRead, 0); assert.equal(input.canceled, true);
  }
  noFeedbackRpc();
});

test("exact 32 KiB requests succeed while multibyte overrun is counted in bytes", async () => {
  fixture.role = "owner";
  for (const [path, input] of [["/feedback", submission()], ["/feedback/update", update()]]) {
    const result = await post(path, null, { raw: JSON.stringify(input).padEnd(bodyLimit, " ") });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  fixture.calls = [];
  const raw = JSON.stringify(submission({ message: "é".repeat(4000) })).padEnd(bodyLimit, " ");
  assert.equal(raw.length, bodyLimit); assert(Buffer.byteLength(raw) > bodyLimit);
  assert.equal((await post("/feedback", null, { raw })).status, 413); noFeedbackRpc();
});

for (const [code, status] of [["PT429", 429], ["PT409", 409], ["42501", 403]]) {
  test(`${code} from feedback transaction maps to HTTP ${status}`, async () => {
    fixture.rpcError = { code, message: "Synthetic feedback transaction rejection" };
    const result = await submit(); assert.equal(result.status, status); assert.equal(fixture.calls.length, 1);
  });
}
