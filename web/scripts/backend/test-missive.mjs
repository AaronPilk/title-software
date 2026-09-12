import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir(".local-test/missive", { recursive: true });
try {
  await build({
    stdin: { contents: `export * from './lib/backend/missive'; export * from './lib/backend/missive-import'; export {emptyWorkspace,executeCommands,projectWorkspace} from './lib/backend/workspace'; export {finalProductFingerprint} from './lib/title/business'; export {commitmentSnapshot} from './lib/title/production';`, resolveDir: process.cwd() },
    outfile: ".local-test/missive/api.mjs",
    bundle: true, format: "esm", platform: "node", target: "es2022",
  });
  execFileSync(process.execPath, ["--test", "tests/missive.test.mjs", "tests/missive-import.test.mjs"], { stdio: "inherit" });
} finally {
  await rm(".local-test/missive", { recursive: true, force: true });
}
