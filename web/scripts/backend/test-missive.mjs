import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir(".local-test/missive", { recursive: true });
try {
  await build({
    entryPoints: ["lib/backend/missive.ts"],
    outfile: ".local-test/missive/api.mjs",
    bundle: true, format: "esm", platform: "node", target: "es2022",
  });
  execFileSync(process.execPath, ["--test", "tests/missive.test.mjs"], { stdio: "inherit" });
} finally {
  await rm(".local-test/missive", { recursive: true, force: true });
}
