import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "lib/title/model.ts",
      "lib/title/engine.ts",
      "lib/title/csv.ts",
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
  for (const name of readdirSync(".local-test").filter((n) =>
    n.endsWith(".js"),
  )) {
    const p = ".local-test/" + name;
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        /from (["'])\.\/([^"']+)\1/g,
        (_, quote, relative) =>
          `from ${quote}./${relative.endsWith(".js") ? relative : relative + ".js"}${quote}`,
      ),
    );
  }
  execFileSync(
    process.execPath,
    [
      "--test",
      "tests/domain.test.mjs",
      "tests/business.test.mjs",
      "tests/materials.test.mjs",
      "tests/csv.test.mjs",
      "tests/revision-boundaries.test.mjs",
      "tests/statement-delivery.test.mjs",
    ],
    {
      stdio: "inherit",
    },
  );
} finally {
  rmSync(".local-test", { recursive: true, force: true });
}
