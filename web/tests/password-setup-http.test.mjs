// Exercise the real Edge handler against synthetic Auth/database transports.
// No live credentials, sessions, or account changes are used by this suite.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const rotation = "2026-09-14T12:00:00Z";
const password = "Synthetic changed password 123";
const ok = { data: null, error: null, status: 204 };
const fail = (code, status = 500) => ({ data: null, error: { code, message: "Synthetic internal failure" }, status });
let handler, state;
globalThis.__titleHttpClient = {
  auth: {
    getUser: async () => ({ data: { user: { id: userId, email: "setup@example.test", email_confirmed_at: rotation } }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: userId, session_id: sessionId, aal: "aal1" } }, error: null }),
  },
  rpc(name, args) {
    state.rpcs.push({ name, args: structuredClone(args) });
    if (name === "title_security_state") return Promise.resolve({ data: {
      session_valid: true, password_change_required: true, credential_version: rotation,
      has_totp: false, session_totp: false, ...state.facts,
    }, error: null });
    assert.equal(name, "title_complete_password_change");
    const outcome = state.completions.shift() ?? ok;
    const result = {
      abortSignal(signal) { assert(signal instanceof AbortSignal); state.signals.push(signal); return this; },
      then(resolve, reject) { return (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)).then(resolve, reject); },
    };
    return result;
  },
};
globalThis.Deno = {
  env: { get: name => ({ SUPABASE_URL: "https://backend.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic", SUPABASE_ANON_KEY: "synthetic-anon" })[name] },
  serve: callback => { handler = callback; },
};
await import("../.local-api-test/handler.mjs");
beforeEach(() => {
  state = { rpcs: [], signals: [], completions: [], authCalls: [], authStatus: 200, authResult: { id: userId }, facts: {} };
  globalThis.fetch = async (url, options) => {
    state.authCalls.push({ url, options });
    state.afterAuth?.();
    return new Response(JSON.stringify(state.authResult), { status: state.authStatus, headers: { "Content-Type": "application/json" } });
  };
});
async function change(input = { password }) {
  const result = await handler(new Request("https://backend.example.test/functions/v1/title-api/security/password", {
    method: "POST", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
  return { status: result.status, body: await result.json() };
}
const completionCalls = () => state.rpcs.filter(call => call.name === "title_complete_password_change");
function exactCompletion(count) {
  assert.equal(state.authCalls.length, 1, "Never repeat the accepted Auth password update");
  assert.equal(completionCalls().length, count);
  for (const call of completionCalls()) assert.deepEqual(call.args, { p_user: userId, p_session: sessionId, p_expected_rotation: rotation });
  assert.equal(state.rpcs.filter(call => call.name === "title_security_state").length, 1, "Do not recapture a newer rotation for the retry");
}

test("an ordinary password change confirms setup once after verified Auth success", async () => {
  const result = await change();
  assert.deepEqual(result, { status: 200, body: { updated: true } });
  exactCompletion(1);
  assert.equal(state.authCalls[0].url, "https://backend.example.test/auth/v1/user");
  assert.equal(state.authCalls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(state.authCalls[0].options.body), { password });
});
test("a transient completion failure retries only the same idempotent RPC with a timeout", async () => {
  state.completions = [fail("40001"), ok];
  state.afterAuth = () => { state.facts.credential_version = "2026-09-14T12:01:00Z"; };
  assert.equal((await change()).status, 200);
  exactCompletion(2); assert.equal(state.signals.length, 2);
});
test("a lost completion response can be retried without repeating the password change", async () => {
  state.completions = [new TypeError("Synthetic fetch failed"), ok];
  assert.equal((await change()).status, 200); exactCompletion(2);
});
test("transport error responses with no database code get one bounded completion retry", async () => {
  state.completions = [fail("", 0), ok];
  assert.equal((await change()).status, 200); exactCompletion(2);
});
for (const [code, status] of [["PT409", 409], ["42501", 403]]) {
  test(`completion guard ${code} stays terminal and reports the already accepted Auth change`, async () => {
    state.completions = [fail(code), ok];
    const result = await change(); exactCompletion(1);
    assert.equal(result.status, status); assert.equal(result.body.code, "password_setup_incomplete");
    assert.match(result.body.error, /accepted.*setup could not be confirmed/);
    assert(!JSON.stringify(result.body).includes("Synthetic internal failure"));
  });
}
test("a permanent completion error is not retried or treated as completed setup", async () => {
  state.completions = [fail("23514", 400), ok];
  const result = await change(); exactCompletion(1);
  assert.equal(result.status, 503); assert.equal(result.body.code, "password_setup_incomplete");
});
test("exhausted completion retries return an honest partial-success message", async () => {
  state.completions = [fail("08006"), fail("08006"), ok];
  const result = await change(); exactCompletion(2);
  assert.equal(result.status, 503); assert.equal(result.body.code, "password_setup_incomplete");
  assert.match(result.body.error, /Sign out and sign in again/);
  assert(!JSON.stringify(result.body).includes(password));
});
for (const code of ["same_password", "reauthentication_needed", "reauthentication_not_valid"]) {
  test(`${code} cannot be used as evidence that a password change succeeded`, async () => {
    state.authStatus = 422; state.authResult = { error_code: code, msg: "Synthetic Auth rejection" };
    const result = await change({ password, nonce: "synthetic-nonce" });
    assert.equal(result.status, 422); assert.equal(result.body.code, code);
    assert.equal(completionCalls().length, 0);
    assert.deepEqual(JSON.parse(state.authCalls[0].options.body), { password, nonce: "synthetic-nonce" });
  });
}
test("an unverified Auth success response cannot complete account setup", async () => {
  state.authResult = { id: "different-user" };
  assert.equal((await change()).status, 500); assert.equal(completionCalls().length, 0);
});
test("a required authenticator challenge is preserved before password changes", async () => {
  state.facts = { has_totp: true, session_totp: false };
  assert.equal((await change()).status, 403);
  assert.equal(state.authCalls.length, 0); assert.equal(completionCalls().length, 0);
});
