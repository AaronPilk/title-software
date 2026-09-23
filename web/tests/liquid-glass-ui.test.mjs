// Actual local app and fictional sample workspace. No account or remote mutations.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.TITLE_GLASS_TEST_URL || "http://localhost:5194";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use an isolated local sample preview");
let browser, context, page, errors = [];
before(async () => { try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ channel: "chrome", headless: true }); } });
afterEach(async () => { await context?.close();assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); });
async function open(width = 1440, media = []) {
  errors = [];context = await browser.newContext({ viewport: { width, height: 1000 } });
  page = await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror", error => errors.push(error.message));
  if (media.length) await (await context.newCDPSession(page)).send("Emulation.setEmulatedMedia", { features: media });
  await page.goto(base);await page.getByRole("button", { name: "Open local sample workspace", exact: true }).click();
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
  await name.press("Tab");assert.equal(await page.getByRole("textbox", { name: "Primary contact", exact: true }).evaluate(element => element === document.activeElement), true);
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
