// Actual upload client/store adapter with deferred fictional auth; no external requests.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const originals = { fetch: globalThis.fetch, indexedDB: globalThis.indexedDB, localStorage: globalThis.localStorage };
let releaseSession, sessionCalls, requests, localWrites;
globalThis.__assetUploadFixture = { auth: { getSession: () => {
  sessionCalls++;
  return new Promise(resolve => { releaseSession = (user = "user-a") => resolve({ data: { session: user ? { access_token: "fictional-token", user: { id: user } } : null } }); });
} } };
const web = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  absWorkingDir: web, stdin: { contents: 'export {uploadRemoteAsset,setActiveWorkspace} from "./lib/backend/client";export {saveAsset} from "./lib/title/store";', resolveDir: web },
  write: false, bundle: true, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fixture.invalid"', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"fictional-publishable-key"' },
  plugins: [{ name: "fictional-asset-auth", setup(builder) {
    builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onLoad({ filter: /^auth$/, namespace: "fixture" }, () => ({ contents: "export const createClient=()=>globalThis.__assetUploadFixture;" }));
    builder.onResolve({ filter: /^@\/components\/title\/backend-access$/ }, () => ({ path: "unused-access", namespace: "fixture" }));
    builder.onLoad({ filter: /^unused-access$/, namespace: "fixture" }, () => ({ contents: "export const BackendAccess=()=>{throw Error('Unexpected UI render')};" }));
  } }],
});
const { uploadRemoteAsset, setActiveWorkspace, saveAsset } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const expected = { expectedUserId: "user-a", expectedWorkspaceId: "workspace-a" };
const binding = { companyId: "company-a", documentId: "document-a", ...expected };
const originalBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 128, 255]);
const file = () => new File([originalBytes], "Fictional original.pdf", { type: "application/pdf" });
const changed = error => error.status === 403 && /changed/.test(error.message);
beforeEach(() => {
  requests = []; localWrites = []; sessionCalls = 0; releaseSession = undefined; setActiveWorkspace("workspace-a");
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return Response.json({ id: "asset-a", sha256: "fictional-digest", bytes: originalBytes.length }); };
  globalThis.indexedDB = { open: () => { throw Error("Unexpected local fallback"); } };
  globalThis.localStorage = { getItem: () => "{}" };
});
after(() => {
  for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  delete globalThis.__assetUploadFixture;
});
async function exactRequest() {
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url, "https://fixture.invalid/functions/v1/title-api/assets/upload");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer fictional-token");
  assert.equal(init.body.get("workspaceId"), "workspace-a");
  assert.equal(init.body.get("id"), "asset-a");
  assert.equal(init.body.get("companyId"), "company-a");
  assert.equal(init.body.get("documentId"), "document-a");
  assert.deepEqual([...init.body.keys()].sort(), ["workspaceId", "id", "companyId", "documentId", "file"].sort());
  const savedFile = init.body.get("file");
  assert.equal(savedFile.name, "Fictional original.pdf"); assert.equal(savedFile.type, "application/pdf");
  assert.deepEqual(new Uint8Array(await savedFile.arrayBuffer()), originalBytes);
}

test("matching upload sends exact original bytes and reviewed binding using the pinned workspace", async () => {
  const pending = uploadRemoteAsset("asset-a", file(), "company-a", "document-a", expected); releaseSession();
  assert.equal((await pending).id, "asset-a"); await exactRequest();
});
test("an already different workspace fails before looking up auth or sending original bytes", async () => {
  setActiveWorkspace("workspace-b");
  await assert.rejects(uploadRemoteAsset("asset-a", file(), "company-a", "document-a", expected), changed);
  assert.equal(sessionCalls, 0); assert.deepEqual(requests, []);
});
test("account changes during auth lookup do not send the selected originals", async () => {
  const pending = uploadRemoteAsset("asset-a", file(), "company-a", "document-a", expected); releaseSession("user-b");
  await assert.rejects(pending, changed); assert.deepEqual(requests, []);
});
test("workspace changes or disconnects during auth lookup cannot retarget any caller's upload", async () => {
  for (const nextWorkspace of ["workspace-b", ""]) {
    for (const scope of [expected, undefined]) {
      setActiveWorkspace("workspace-a");
      const pending = uploadRemoteAsset("asset-a", file(), "company-a", "document-a", scope);
      setActiveWorkspace(nextWorkspace); releaseSession(); await assert.rejects(pending, changed);
    }
  }
  assert.deepEqual(requests, []);
});
test("sign-out during session lookup stops upload before fetch", async () => {
  const pending = uploadRemoteAsset("asset-a", file(), "company-a", "document-a", expected); releaseSession(null);
  await assert.rejects(pending, /Sign in to upload/); assert.deepEqual(requests, []);
});
test("existing callers without optional expectations still upload to a stable connected workspace", async () => {
  const pending = uploadRemoteAsset("asset-a", file(), "company-a", "document-a"); releaseSession();
  await pending; await exactRequest();
});
test("saveAsset forwards expected actor and workspace to the real upload client", async () => {
  let pending = saveAsset("asset-a", file(), binding); releaseSession("user-b");
  await assert.rejects(pending, changed); assert.deepEqual(requests, []);
  pending = saveAsset("asset-a", file(), binding); releaseSession(); await pending; await exactRequest();
});
test("connected saveAsset cannot silently fall back to browser storage after disconnecting", async () => {
  setActiveWorkspace(""); await assert.rejects(saveAsset("asset-a", file(), binding), changed);
  assert.equal(sessionCalls, 0); assert.deepEqual(requests, []);
});
test("legacy local asset writes retain their original namespace and bytes", async () => {
  setActiveWorkspace("");
  globalThis.localStorage = { getItem: () => JSON.stringify({ localAssetNamespace: "11111111-1111-1111-1111-111111111111" }) };
  globalThis.indexedDB = { open: () => {
    const request = { result: { close() {}, transaction: () => {
      const tx = { objectStore: () => ({ put: (bytes, key) => { localWrites.push({ bytes, key }); queueMicrotask(() => tx.oncomplete()); } }) };
      return tx;
    } } };
    queueMicrotask(() => request.onsuccess()); return request;
  } };
  await saveAsset("asset-a", file());
  assert.equal(localWrites.length, 1); assert.equal(localWrites[0].key, "11111111-1111-1111-1111-111111111111:asset-a");
  assert.deepEqual(new Uint8Array(await localWrites[0].bytes.arrayBuffer()), originalBytes);
  assert.equal(sessionCalls, 0); assert.deepEqual(requests, []);
});
