import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "lib/title/model.ts",
      "lib/title/engine.ts",
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--outDir",
      ".local-test",
      "--skipLibCheck",
      "--noEmit",
      "false",
    ],
    { stdio: "inherit" },
  );
  const p = ".local-test/engine.js";
  writeFileSync(
    p,
    readFileSync(p, "utf8").replace(/(['"])\.\/model\1/g, '"./model.js"'),
  );
  execFileSync(process.execPath, ["--test", "tests/domain.test.mjs"], {
    stdio: "inherit",
  });
} finally {
  rmSync(".local-test", { recursive: true, force: true });
}
