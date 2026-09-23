import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const dir = ".local-api-test";
await mkdir(dir, { recursive: true });
try {
  await build({ entryPoints: ["../supabase/functions/title-api/index.ts"], outfile: `${dir}/handler.mjs`,
    bundle: true, format: "esm", platform: "node", target: "es2022",
    plugins: [{ name: "synthetic-supabase-transport", setup(build) {
      build.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({ path: "fixture", namespace: "test-client" }));
      build.onLoad({ filter: /.*/, namespace: "test-client" }, () => ({ contents: "export const createClient = () => globalThis.__titleHttpClient;", loader: "js" }));
    } }],
  });
  execFileSync(process.execPath, ["--test", "tests/title-api-http.test.mjs", "tests/password-setup-http.test.mjs", "tests/member-invitation-http.test.mjs", "tests/member-directory-http.test.mjs", "tests/invitation-email-http.test.mjs", "tests/staff-assignment-http.test.mjs", "tests/security-inputs-http.test.mjs", "tests/company-scope-http.test.mjs", "tests/developer-feedback-http.test.mjs", "tests/vendor-http.test.mjs"], { stdio: "inherit" });
} finally { await rm(dir, { recursive: true, force: true }); }
