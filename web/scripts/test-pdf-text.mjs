import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const dir = ".local-test/pdf-text";
await mkdir(dir, { recursive: true });
try {
  await build({ entryPoints: ["lib/title/pdf-text.ts"], outfile: `${dir}/api.mjs`, bundle: true, format: "esm", platform: "node", target: "es2022", external: ["pdfjs-dist", "pdfjs-dist/*"] });
  execFileSync(process.execPath, ["--test", "tests/pdf-text.test.mjs"], { stdio: "inherit" });
} finally { await rm(dir, { recursive: true, force: true }); }
