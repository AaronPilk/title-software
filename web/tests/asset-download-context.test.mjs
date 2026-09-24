import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const originalFetch = globalThis.fetch;
let currentUser, authCalls, onAuth, onFetch, requests;
globalThis.__downloadFixture = { auth: { getSession: async () => {
  authCalls++; if (onAuth) await onAuth(authCalls);
  return { data: { session: currentUser ? { access_token: "fictional-token", user: { id: currentUser } } : null } };
} } };
const web = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ absWorkingDir: web, stdin: { contents: 'export {downloadRemoteAsset,setActiveWorkspace} from "./lib/backend/client";', resolveDir: web },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
  define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fixture.invalid"', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"fictional-publishable"' },
  plugins: [{ name: "auth-fixture", setup(b) {
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "auth", namespace: "fixture" }));
    b.onLoad({ filter: /^auth$/, namespace: "fixture" }, () => ({ contents: "export const createClient=()=>globalThis.__downloadFixture;" }));
  } }],
});
const { downloadRemoteAsset, setActiveWorkspace } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));
const expected = { expectedWorkspaceId: "workspace-a", expectedUserId: "user-a" };
const bytes = Uint8Array.from([37,80,68,70,45,10,0,128,255]);
const response = () => new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length) } });
beforeEach(() => {
  currentUser = "user-a"; authCalls = 0; onAuth = null; onFetch = null; requests = []; setActiveWorkspace("workspace-a");
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return onFetch ? onFetch() : response(); };
});
after(() => { globalThis.fetch = originalFetch; delete globalThis.__downloadFixture; });
test("original bytes are returned with pinned workspace and user, without caching", async () => {
  const blob = await downloadRemoteAsset("asset-a", expected);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes); assert.equal(blob.type, "application/pdf");
  assert.equal(requests[0].url, "https://fixture.invalid/functions/v1/title-api/assets/download?workspaceId=workspace-a&id=asset-a");
  assert.equal(requests[0].options.cache, "no-store"); assert.equal(authCalls, 2);
});
test("an already switched workspace never requests an original", async () => {
  setActiveWorkspace("workspace-b"); await assert.rejects(downloadRemoteAsset("asset-a", expected), /changed/);
  assert.equal(authCalls, 0); assert.equal(requests.length, 0);
});
test("workspace changes while retrieving session cannot retarget the download", async () => {
  onAuth = async () => setActiveWorkspace("workspace-b");
  await assert.rejects(downloadRemoteAsset("asset-a", expected), /changed/); assert.equal(requests.length, 0);
});
test("a different account cannot start the selected download", async () => {
  currentUser = "user-b"; await assert.rejects(downloadRemoteAsset("asset-a", expected), /changed/); assert.equal(requests.length, 0);
});
for (const user of ["user-b", null]) test(`account switch or signout during download discards bytes: ${user}`, async () => {
  onFetch = () => { currentUser = user; return response(); };
  await assert.rejects(downloadRemoteAsset("asset-a", expected), /changed/);
});
test("workspace disconnect during download discards the response", async () => {
  onFetch = () => { setActiveWorkspace(""); return response(); };
  await assert.rejects(downloadRemoteAsset("asset-a", expected), /changed/);
});
test("legacy callers also pin their initial workspace", async () => {
  onAuth = async () => setActiveWorkspace("workspace-b");
  await assert.rejects(downloadRemoteAsset("asset-a"), /changed/); assert.equal(requests.length, 0);
});
test("oversized declared original is rejected before consumption", async () => {
  onFetch = () => new Response(bytes, { headers: { "Content-Length": "52428801" } });
  await assert.rejects(downloadRemoteAsset("asset-a", expected), /50 MB/);
});
test("chunked original cannot exceed the streaming byte limit", async () => {
  let count = 0; const chunk = new Uint8Array(1024 * 1024);
  onFetch = () => new Response(new ReadableStream({ pull(c) { if (++count > 51) c.close(); else c.enqueue(chunk); } }));
  await assert.rejects(downloadRemoteAsset("asset-a", expected), /50 MB/);
});
test("authorization errors do not return original bytes", async () => {
  onFetch = () => Response.json({ error: "Document is outside your access." }, { status: 403 });
  await assert.rejects(downloadRemoteAsset("asset-a", expected), /outside your access/);
});
