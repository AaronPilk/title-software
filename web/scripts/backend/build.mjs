import { build } from "esbuild";
await build({
  entryPoints: ["../supabase/functions/title-api/index.ts"],
  outfile: "../supabase/functions/title-api/bundle.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["npm:*"],
  minify: false,
});
await build({
  entryPoints: ["../supabase/functions/title-missive-events/index.ts"],
  outfile: "../supabase/functions/title-missive-events/bundle.js",
  bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["npm:*"],
});
