import { build } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// The actual provider, local validation, command capture and server command
// execution are bundled. Only account bootstrap and backend transport are
// replaced with a synthetic fixture: refresh() itself is never mocked.
const directory = resolve(".local-test/workspace-refresh");
await mkdir(directory, { recursive: true });
let server;
try {
  const boundaries = { name: "synthetic-provider-transport", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)backend-access$/ }, () => ({ path: "account-entry", namespace: "fixture" }));
    builder.onResolve({ filter: /(?:^|\/)backend\/client$/ }, () => ({ path: "backend-client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path === "account-entry"
      ? 'export function BackendAccess({children}) { return children(window.refreshFixture.initial); }'
      : `export const backendConfigured=true, hostedPilot=true;
         export const supabase={auth:{signOut:async()=>{window.refreshFixture.signOuts++;if(window.refreshFixture.signOutFailure)throw Error("Synthetic sign-out unavailable");}}};
         export function backendRequest(path,data){return window.refreshTransport(path,data);}
         export const activeWorkspace=()=>window.refreshFixture.initial.workspaceId;
         export function uploadRemoteAsset(){throw Error("Unexpected upload in refresh test");}
         export function downloadRemoteAsset(){throw Error("Unexpected download in refresh test");}` }));
  } };
  await build({ entryPoints: ["tests/fixtures/workspace-refresh.tsx"], outfile: `${directory}/app.mjs`, bundle: true,
    platform: "browser", format: "esm", target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [boundaries] });
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Workspace refresh verification</title><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>';
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
      if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(await readFile(`${directory}/app.mjs`)); return; }
      if (path === "/favicon.ico") { res.writeHead(204); res.end(); return; }
      res.writeHead(404); res.end();
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--test", "tests/workspace-refresh.test.mjs"], { stdio: "inherit", env: { ...process.env, WORKSPACE_REFRESH_ORIGIN: `http://127.0.0.1:${server.address().port}` } });
    child.on("error", reject); child.on("exit", done);
  });
  process.exitCode = code || 0;
} finally { if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } await rm(directory, { recursive: true, force: true }); }
