import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir(".local-test", { recursive: true });
try {
  await writeFile(
    ".local-test/backend-entry.ts",
    `export * from '../lib/backend/workspace'; export * from '../lib/backend/assistant-context'; export * from '../lib/backend/account-security'; export * from '../lib/title/command-log'; export {createSeed} from '../lib/title/model'; export * as B from '../lib/title/business'; export * as P from '../lib/title/production'; export * as M from '../lib/title/materials'; export * as D from '../lib/title/delivery-ledger'; export * as T from '../lib/title/task-clock'; export * as O from '../lib/title/ownership-history'; export * as OR from '../lib/title/orchestration';`,
  );
  await build({
    entryPoints: [".local-test/backend-entry.ts"],
    outfile: ".local-test/backend/api.mjs",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
  });
  execFileSync(process.execPath, ["--test", "tests/backend.test.mjs", "tests/account-security.test.mjs", "tests/recovery-intent.test.mjs", "tests/assistant-context.test.mjs", "tests/connected-workflow-actions.test.mjs", "tests/connected-workflow-projection.test.mjs", "tests/orchestration-backend.test.mjs"], {
    stdio: "inherit",
  });
} finally {
  await rm(".local-test/backend-entry.ts", { force: true });
  await rm(".local-test/backend", { recursive: true, force: true });
}
