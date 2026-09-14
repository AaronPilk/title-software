import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

// Bundle the real sign-in and security forms. Only the Auth/API transport is
// replaced; no live accounts, passwords, authenticator factors or emails are used.
const result = await build({
  entryPoints: ["tests/fixtures/auth-setup.tsx"], write: false, bundle: true,
  platform: "browser", format: "esm", target: "es2022", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "synthetic-auth-transport", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)backend\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const backendConfigured = true, hostedPilot = true;
      export const setActiveWorkspace = id => { window.authSetupFixture.workspaceId = id; };
      export const backendRequest = (path, data) => window.authSetupTransport(path, data);
      export const supabase = { auth: {
        getSession: () => window.authSetupFixture.getSession(),
        onAuthStateChange: listener => window.authSetupFixture.subscribe(listener),
        signInWithPassword: input => window.authSetupFixture.signIn(input),
        signOut: () => window.authSetupFixture.signOut(),
        mfa: {
          listFactors: () => window.authSetupFixture.listFactors(),
          enroll: () => window.authSetupFixture.enroll(),
          unenroll: () => window.authSetupFixture.unenroll(),
          challengeAndVerify: input => window.authSetupFixture.verify(input),
        },
      } };
    ` }));
  } }],
});
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Account setup verification</title><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>';
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }
  else if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(result.outputFiles[0].contents); }
  else if (path === "/favicon.ico" || path === "/brand/ballantyne-title-logo.png") { res.writeHead(204); res.end(); }
  else { res.writeHead(404); res.end(); }
});
try {
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const exitCode = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--test", "tests/auth-setup-ui.test.mjs"], {
      stdio: "inherit", env: { ...process.env, AUTH_SETUP_ORIGIN: `http://127.0.0.1:${server.address().port}` },
    });
    child.on("error", reject); child.on("exit", done);
  });
  process.exitCode = typeof exitCode === "number" ? exitCode : 1;
} finally {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
