import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const originalFetch = globalThis.fetch;
let releaseSession, workspace, response, requests, sessionCalls, currentUser;
globalThis.__helpClientFixture = {
  activeWorkspace: () => workspace,
  supabase: { auth: { getSession: () => ++sessionCalls > 1
    ? Promise.resolve({ data: { session: currentUser ? { user: { id: currentUser } } : null } })
    : new Promise(resolve => {
    releaseSession = (id = "user-a") => resolve({ data: { session: { access_token: "synthetic", user: { id } } } });
  }) } },
};
const bundle = await build({
  stdin: { contents: 'export * from "./lib/assistant/client";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  define: { "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"synthetic-key"' },
  plugins: [{ name: "help-client-fixture", setup(build) {
    build.onResolve({ filter: /^@\/lib\/backend\/client$/ }, () => ({ path: "fixture", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const {activeWorkspace,supabase}=globalThis.__helpClientFixture;" }));
  } }],
});
const { assistantRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const screen = { page: "Companies", view: "agency", surface: "company" };
const input = { action: "send", purpose: "help", screen, question: "How do I upload?", requestId: "synthetic-request", specialists: ["Product guide"] };
const scope = { companyId: "", orderId: "", userId: "user-a", workspaceId: "workspace-a", accessVersion: 3 };
beforeEach(() => {
  workspace = "workspace-a"; requests = []; sessionCalls = 0; currentUser = "user-a";
  response = { threads: [], model: "synthetic", remaining: 29, context: { ...scope, purpose: "help", screen, sources: [] } };
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return Response.json(response); };
});
after(() => { globalThis.fetch = originalFetch; delete globalThis.__helpClientFixture; });

test("product help sends only its question and bounded screen hint to the same-origin service", async () => {
  const pending = assistantRequest(input, scope); releaseSession(); const result = await pending;
  assert.equal(result.context.purpose, "help"); assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/assistant");
  assert.deepEqual(JSON.parse(requests[0].init.body), { ...input, workspaceId: "workspace-a", companyId: "", orderId: "" });
  assert.equal(requests[0].init.credentials, "same-origin");
});
test("a different account resolving session lookup cannot receive the previous user's question", async () => {
  const pending = assistantRequest(input, scope); releaseSession("user-b");
  await assert.rejects(pending, error => error.status === 403); assert.equal(requests.length, 0);
});
test("workspace changes before or during session lookup prevent disclosure", async () => {
  workspace = "workspace-b"; await assert.rejects(assistantRequest(input, scope), error => error.name === "AbortError");
  workspace = "workspace-a"; const pending = assistantRequest(input, scope); workspace = "workspace-b"; releaseSession();
  await assert.rejects(pending, error => error.name === "AbortError"); assert.equal(requests.length, 0);
});
test("closing or replacing the request during authentication aborts before any network call", async () => {
  const controller = new AbortController(), pending = assistantRequest(input, scope, controller.signal);
  controller.abort(); releaseSession(); await assert.rejects(pending, error => error.name === "AbortError"); assert.equal(requests.length, 0);
});
test("wrong purpose, screen, role revision and mixed histories are rejected before UI display", async () => {
  const original = structuredClone(response);
  for (const change of [
    result => { delete result.context.purpose; },
    result => { result.context.screen.page = "Orders"; },
    result => { result.context.accessVersion = 4; },
    result => { result.context.userId = "user-b"; },
    result => { result.context.workspaceId = "workspace-b"; },
    result => { result.threads = [{ companyId: "", orderId: "", accessVersion: 3, turns: [] }]; },
  ]) {
    response = structuredClone(original); change(response);
    sessionCalls = 0;
    const pending = assistantRequest(input, scope); releaseSession(); await assert.rejects(pending, error => error.status === 409);
  }
});
test("legacy record-review responses still work without a help purpose", async () => {
  delete response.context.purpose; delete response.context.screen;
  const pending = assistantRequest({ action: "list" }, scope); releaseSession();
  assert.equal((await pending).threads.length, 0);
});
test("an account change or sign-out during fetch suppresses the old private conversation", async () => {
  for (const nextUser of ["user-b", null]) {
    sessionCalls = 0;
    globalThis.fetch = async () => { currentUser = nextUser; return Response.json(response); };
    const pending = assistantRequest(input, scope); releaseSession();
    await assert.rejects(pending, error => error.status === 403);
  }
});
