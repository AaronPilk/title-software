import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const action = process.argv[2];
if (!["build", "deploy", "dry-run"].includes(action)) throw Error("Expected build, dry-run or deploy.");
const env = {...process.env, TITLE_CLOUDFLARE_PILOT:"true", NEXT_PUBLIC_TITLE_HOSTED_PILOT:"true"};
if (action !== "build") {
  const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
  if (config.name !== "title-software-pilot" || config.preview_urls !== false)
    throw Error("Run npm run build:pilot before deploying the private pilot.");
}
const args = action === "build" ? ["scripts/run-framework.mjs", "build"] :
  ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "deploy", "--config", "dist/server/wrangler.json", "--keep-vars", ...(action === "dry-run" ? ["--dry-run"] : [])];
const result = spawnSync(process.execPath, args, {stdio:"inherit", env});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
