import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; delete globalThis.__feedbackClient; });
const requests = [];
const userId = "40000000-0000-4000-8000-000000000001";
let releaseSession;
globalThis.__feedbackClient = { auth: {
  getSession: () => new Promise(resolve => { releaseSession = (id = userId) => resolve({ data: { session: { access_token: "synthetic-session", user: { id } } } }); }),
} };
globalThis.fetch = async (url, init) => {
  assert.equal(new URL(url).origin, "https://synthetic.example.test");
  requests.push({ url: String(url), init });
  return Response.json({ items: [], nextCursor: null });
};
const bundle = await build({ absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
  stdin: { contents: 'export * from "./lib/backend/feedback-client"; export {backendRequest,setActiveWorkspace} from "./lib/backend/client";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://synthetic.example.test"', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"synthetic-key"' },
  plugins: [{ name: "synthetic-auth", setup(b) {
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "auth", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient=()=>globalThis.__feedbackClient;" }));
  } }],
});
const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const workspace = "10000000-0000-4000-8000-000000000001";
const otherWorkspace = "20000000-0000-4000-8000-000000000001";

test("feedback pagination keeps its explicit workspace and exact timestamp through asynchronous session lookup", async () => {
  client.setActiveWorkspace(otherWorkspace);
  const cursor = { createdAt: "2026-09-23T17:01:02.123456+00:00", id: "30000000-0000-4000-8000-000000000001" };
  const pending = client.listFeedback(workspace, cursor, userId);
  client.setActiveWorkspace("another-workspace");
  releaseSession(); await pending;
  const query = new URL(requests.at(-1).url).searchParams;
  assert.deepEqual(query.getAll("workspaceId"), [workspace]);
  assert.equal(query.get("before"), cursor.createdAt);
  assert.equal(query.get("beforeId"), cursor.id);
});
test("ordinary backend GET captures workspace before waiting for the session", async () => {
  client.setActiveWorkspace(workspace);
  const pending = client.backendRequest("/members");
  client.setActiveWorkspace(otherWorkspace);
  releaseSession(); await pending;
  assert.deepEqual(new URL(requests.at(-1).url).searchParams.getAll("workspaceId"), [workspace]);
});
test("feedback mutations send only the explicit payload and no ambient workspace query", async () => {
  const input = { workspaceId: workspace, id: "30000000-0000-4000-8000-000000000001", kind: "question", message: "Where is the fictional company setup?", page: "Companies", view: "agency" };
  let pending = client.submitFeedback(input, userId);
  releaseSession(); await pending;
  assert.equal(new URL(requests.at(-1).url).pathname, "/functions/v1/title-api/feedback");
  assert.equal(new URL(requests.at(-1).url).search, "");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), input);
  const update = { workspaceId: workspace, id: input.id, expectedVersion: 1, status: "in_progress", reply: "Checking the setup guidance." };
  pending = client.updateFeedback(update, userId);
  releaseSession(); await pending;
  assert.equal(new URL(requests.at(-1).url).pathname, "/functions/v1/title-api/feedback/update");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), update);
});

test("a different account resolving the session cannot send, read, or reply using the prior account's intent", async () => {
  for (const request of [
    () => client.submitFeedback({ workspaceId: workspace, id: "30000000-0000-4000-8000-000000000001", kind: "idea", message: "Private draft from the prior account", page: "Companies", view: "agency" }, userId),
    () => client.listFeedback(workspace, undefined, userId),
    () => client.updateFeedback({ workspaceId: workspace, id: "30000000-0000-4000-8000-000000000001", expectedVersion: 1, status: "done", reply: "Private reply from the prior account" }, userId),
  ]) {
    const count = requests.length;
    const pending = request();
    releaseSession("40000000-0000-4000-8000-000000000002");
    await assert.rejects(pending, error => error.status === 403 && /account changed/.test(error.message));
    assert.equal(requests.length, count, "no network request or feedback disclosure after an account switch");
  }
});
