import { build } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve, extname } from "node:path";
await import("./prepare-ocr-assets.mjs");
const directory = resolve(".local-test/ocr");
await mkdir(directory, { recursive: true });
let server;
try {
  const pdfUrl = { name: "worker-urls", setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "/pdf.worker.mjs", namespace: "local-url" }));
    builder.onResolve({ filter: /local-ocr\.worker\.ts\?worker&url$/ }, () => ({ path: "/local-ocr.worker.ts", namespace: "local-url" }));
    builder.onLoad({ filter: /.*/, namespace: "local-url" }, args => ({ contents: `export default ${JSON.stringify(args.path)}`, loader: "js" }));
  } };
  await build({ stdin: { contents: 'export * from "./lib/title/local-ocr.ts"; export * from "./lib/title/local-ocr-shared.ts"; export * from "./lib/title/pdf-text.ts";', resolveDir: process.cwd() }, outfile: `${directory}/api.mjs`, bundle: true, platform: "browser", format: "esm", target: "es2022", plugins: [pdfUrl] });
  await build({ entryPoints: ["lib/title/local-ocr.worker.ts"], outfile: `${directory}/local-ocr.worker.ts`, bundle: true, platform: "browser", format: "iife", target: "es2022" });
  const html = '<!doctype html><html lang="en"><title>Local OCR verification</title><body><h1>Local OCR verification</h1><script type="module">import * as api from "/api.mjs"; window.ocrApi=api;</script></body></html>';
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      let file;
      if (path === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
      if (path === "/api.mjs" || path === "/local-ocr.worker.ts") file = `${directory}${path}`;
      else if (path === "/pdf.worker.mjs") file = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
      else if (/^\/ocr\/v7-eng1\/[a-zA-Z0-9.-]+$/.test(path)) file = resolve(`public${path}`);
      else { res.writeHead(404); res.end(); return; }
      const bytes = await readFile(file);
      res.writeHead(200, { "content-type": [".mjs", ".js", ".ts"].includes(extname(file)) ? "text/javascript" : "application/octet-stream", "cache-control": "no-store" }); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--test", "tests/local-ocr.test.mjs"], { stdio: "inherit", env: { ...process.env, OCR_TEST_ORIGIN: `http://127.0.0.1:${server.address().port}` } });
    child.on("error", reject); child.on("exit", done);
  });
  process.exitCode = code || 0;
} finally { if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } await rm(directory, { recursive: true, force: true }); }
