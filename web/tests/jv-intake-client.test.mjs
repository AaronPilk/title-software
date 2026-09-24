import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const web = process.env.JV_WEB_ROOT || fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(`${web}/package.json`), { build } = require("esbuild");
const originalFetch = globalThis.fetch;
const requests = [];
let releaseSession, replyCompany = "company-fictional", releaseFetch;
globalThis.__jvClient = { auth: { getSession: () => new Promise(resolve => { releaseSession = (id = "staff-fictional") => resolve({ data: { session: { access_token: "fictional-session", user: { id } } } }); }) } };
globalThis.fetch = async (url, init) => {
  assert.equal(new URL(url).origin, "https://fictional.example.test");
  requests.push({ url: String(url), init });
  if (globalThis.__holdJvFetch) { globalThis.__holdJvFetch = false; await new Promise(resolve => { releaseFetch = resolve; }); }
  return Response.json({ companyId: replyCompany, version: 1, payload: {}, status: "Draft", reviewNote: "", updatedAt: null, updatedBy: null, reviewedAt: null, reviewedBy: null });
};
after(() => { globalThis.fetch = originalFetch; delete globalThis.__jvClient; delete globalThis.__holdJvFetch; });
const bundle = await build({ absWorkingDir: web, nodePaths: [`${web}/node_modules`], write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  stdin: { contents: 'export * from "./lib/backend/jv-intake-client";export {setActiveWorkspace} from "./lib/backend/client";', resolveDir: web },
  define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fictional.example.test"', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"fictional-key"' },
  plugins: [{ name: "fictional-private-client", setup(b) {
    if (process.env.JV_CLIENT_SOURCE) {
      b.onResolve({ filter: /^\.\/lib\/backend\/jv-intake-client$/ }, () => ({ path: process.env.JV_CLIENT_SOURCE }));
      b.onResolve({ filter: /^\.\/client$/ }, () => ({ path: `${web}/lib/backend/client.ts` }));
    }
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "auth", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const createClient=()=>globalThis.__jvClient;" }));
  } }],
});
const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const context = { workspaceId: "workspace-fictional", userId: "staff-fictional", companyId: "company-fictional" };
test("private requests refuse an already changed workspace before looking up a session", async () => {
  client.setActiveWorkspace("other-workspace"); const count = requests.length;
  await assert.rejects(client.jvIntakeClientRequest(context, "load"), error => error.status === 403);
  assert.equal(requests.length, count);
});
test("private requests use POST and the captured company, workspace, user and version", async () => {
  client.setActiveWorkspace(context.workspaceId);
  const pending = client.jvIntakeClientRequest(context, "save", { expectedVersion: 7, payload: { fictional: true }, workspaceId: "cannot-override", companyId: "cannot-override" });
  releaseSession(); await pending;
  const request = requests.at(-1);
  assert.equal(new URL(request.url).pathname, "/functions/v1/title-api/jv-intake/save");
  assert.equal(new URL(request.url).search, ""); assert.equal(request.init.method, "POST"); assert.equal(request.init.cache, "no-store");
  assert.deepEqual(JSON.parse(request.init.body), { expectedVersion: 7, payload: { fictional: true }, workspaceId: context.workspaceId, companyId: context.companyId });
});
test("a different signed-in account cannot send the old account's applicant intent", async () => {
  client.setActiveWorkspace(context.workspaceId); const count = requests.length;
  const pending = client.jvIntakeClientRequest(context, "save", { expectedVersion: 0, payload: { fictional: true } });
  releaseSession("other-staff"); await assert.rejects(pending, error => error.status === 403);
  assert.equal(requests.length, count);
});
test("a response arriving after a workspace switch is never returned to the caller", async () => {
  client.setActiveWorkspace(context.workspaceId); globalThis.__holdJvFetch = true;
  const pending = client.jvIntakeClientRequest(context, "load"); releaseSession();
  await new Promise(resolve => setImmediate(resolve)); client.setActiveWorkspace("other-workspace"); releaseFetch();
  await assert.rejects(pending, error => error.status === 403);
});
test("a mismatched company response is rejected without echoing its private data", async () => {
  client.setActiveWorkspace(context.workspaceId); replyCompany = "other-company";
  const pending = client.jvIntakeClientRequest(context, "load"); releaseSession();
  await assert.rejects(pending, error => /could not be loaded/.test(error.message) && !error.message.includes(replyCompany));
});
