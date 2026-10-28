// Actual local app and fictional sample workspace. No account or remote mutations.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";
const web = fileURLToPath(new URL("../", import.meta.url));
let base = process.env.TITLE_GLASS_TEST_URL;
if (base) assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use an isolated local sample preview");
let browser, server, context, page, errors = [];
before(async () => {
  if (!base) {
    // The real local-sample app runs with no credentials and cannot contact a hosted workspace.
    const bundle = await build({
      absWorkingDir: web, outfile: "glass-app.mjs", write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""', "process.env.NEXT_PUBLIC_TITLE_HOSTED_PILOT": '"false"' },
      stdin: { resolveDir: web, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Home from './app/page';createRoot(document.getElementById('root')).render(<Home/>);` },
    });
    const globalFile = new URL("../app/globals.css", import.meta.url);
    const compiled = await postcss([tailwindcss({ base: web })]).process(await readFile(globalFile, "utf8"), { from: fileURLToPath(globalFile) });
    const css = compiled.css + "\n" + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
    const js = bundle.outputFiles.find(file => file.path.endsWith(".mjs")).contents;
    server = createServer(async (req, res) => {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/app.mjs") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(js); }
      else if (path === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(css); }
      else if (path.startsWith("/brand/")) {
        try { res.setHeader("content-type", path.endsWith(".woff2") ? "font/woff2" : "image/png"); res.end(await readFile(new URL("../public" + path, import.meta.url))); }
        catch { res.writeHead(404); res.end(); }
      } else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
});
afterEach(async () => { await context?.close();assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open(width = 1440, media = []) {
  errors = [];context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.route("**/*", route => route.request().url().startsWith(new URL(base).origin + "/") ? route.continue() : (errors.push("Unexpected external request"), route.abort()));
  page = await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror", error => errors.push(error.message));
  if (media.length) await (await context.newCDPSession(page)).send("Emulation.setEmulatedMedia", { features: media });
  await page.goto(base);
  const sampleEntry=page.getByRole("button", { name: "Open local sample workspace", exact: true });
  if(await sampleEntry.count())await sampleEntry.click();
  await page.getByRole("heading", { name: "Agency overview", exact: true }).waitFor();
}
async function noOverflow() { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "page must fit the viewport"); }
async function screen(name) {
  if (!process.env.TITLE_GLASS_SCREENSHOTS) return;
  await mkdir(process.env.TITLE_GLASS_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: `${process.env.TITLE_GLASS_SCREENSHOTS}/${name}.png` });
}
test("glass desktop navigation opens both workspaces and keeps ordinary forms usable", async () => {
  await open();await noOverflow();await screen("agency-desktop");
  assert.notEqual(await page.locator(".topbar").evaluate(element => getComputedStyle(element).backdropFilter), "none");
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Company name", exact: true });
  await name.fill("Fictional Glass Check LLC");assert.equal(await name.inputValue(), "Fictional Glass Check LLC");
  await name.press("Tab");assert.equal(await page.getByRole("textbox", { name: "Company contact (optional)", exact: true }).evaluate(element => element === document.activeElement), true);
  await screen("company-dialog-desktop");await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Production", exact: true }).click();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("heading", { name: "Document vault", exact: true }).waitFor();
  await noOverflow();await screen("documents-desktop");
});
for (const width of [390, 320]) test(`glass mobile navigation and company dialog remain within ${width}px`, async () => {
  await open(width);await noOverflow();await screen(`agency-${width}`);
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a company", exact: true });
  assert.ok(await dialog.evaluate(element => { const rect = element.getBoundingClientRect();return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.height <= innerHeight; }));
  await page.getByRole("textbox", { name: "Company name", exact: true }).fill("Fictional Mobile Check");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Production", exact: true }).click();
  await page.getByRole("button", { name: "Production", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("heading", { name: "Document vault", exact: true }).waitFor();
  await noOverflow();await screen(`documents-${width}`);
});
for (const [name, value] of [["prefers-reduced-transparency", "reduce"], ["prefers-contrast", "more"], ["forced-colors", "active"]]) test(`${name} keeps navigation solid and controls operable`, async () => {
  await open(1440, [{ name, value }]);
  assert.equal(await page.locator(".topbar").evaluate(element => getComputedStyle(element).backdropFilter), "none");
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  await page.getByRole("textbox", { name: "Company name", exact: true }).fill("Fictional Accessible Check");
  assert.equal(await page.getByRole("textbox", { name: "Company name", exact: true }).inputValue(), "Fictional Accessible Check");
  await noOverflow();await screen(name);
});
test("reduced motion removes glass control transitions", async () => {
  await open(1440, [{ name: "prefers-reduced-motion", value: "reduce" }]);
  const duration = await page.getByRole("button", { name: "Production", exact: true }).evaluate(element => getComputedStyle(element).transitionDuration);
  assert.ok(duration.split(",").every(value => Number.parseFloat(value) <= 0.01));
  await page.getByRole("button", { name: "Production", exact: true }).click();await noOverflow();
});
