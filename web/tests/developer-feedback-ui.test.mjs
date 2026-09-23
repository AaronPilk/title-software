// Real React widget, Radix focus controls and module CSS. Only account context
// and API transport are fictional. External network access is blocked.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [], external = [];
before(async () => {
  if (process.env.FEEDBACK_UI_SCREENSHOT_DIR) await mkdir(process.env.FEEDBACK_UI_SCREENSHOT_DIR, { recursive: true });
  const result = await build({ absWorkingDir: root, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", outfile: "/feedback/app.mjs", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {FeedbackFixture} from './tests/fixtures/feedback';createRoot(document.getElementById('root')).render(<FeedbackFixture/>);` },
    plugins: [{ name: "feedback-transport", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/backend\/feedback-client$/ }, () => ({ path: `${root}tests/fixtures/feedback.tsx` }));
    } }],
  });
  const js = result.outputFiles.find(file => file.path.endsWith(".mjs")), css = result.outputFiles.find(file => file.path.endsWith(".css"));
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("content-type", path === "/app.mjs" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    response.end(path === "/app.mjs" ? js.text : path === "/app.css" ? css.text : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { await context?.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });

async function open(options = {}) {
  errors = []; external = [];
  context = await browser.newContext({ viewport: options.mobile ? { width: 375, height: 667 } : { width: 1200, height: 900 } });
  await context.route("**/*", route => { if (route.request().url().startsWith(origin + "/")) return route.continue(); external.push(route.request().url()); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.getByRole("button", { name: "Feedback", exact: true }).waitFor();
  if (options.owner) await page.evaluate(() => window.setFeedbackContext({ role: "owner" }));
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
}
const message = () => page.getByLabel("Your feedback", { exact: true });
const send = () => page.getByRole("button", { name: "Send feedback", exact: true });
const row = id => page.getByRole("article", { name: `Feedback ${id.slice(0, 8)}`, exact: true });
const requests = method => page.evaluate(value => window.feedbackRequests.filter(request => request.method === value), method);
const item = (id, overrides = {}) => ({ id, workspace_id: "workspace-one", author_id: "staff-one", author_email: "staff-one@example.test", kind: "problem", message: `Fictional feedback ${id}`, page: "Companies", view: "agency", status: "new", owner_reply: "", version: 1, created_at: `2026-09-23T12:${id === "first" ? "05" : id === "second" ? "04" : id === "third" ? "03" : "02"}:00.000Z`, updated_at: "2026-09-23T12:05:00.000Z", ...overrides });
async function inbox(items, owner = false) {
  await page.evaluate(rows => { window.feedbackRows = rows; }, items);
  await page.getByRole("tab", { name: owner ? "Feedback inbox" : "My feedback", exact: true }).click();
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).waitFor();
  await page.getByText("Loading feedback…", { exact: true }).waitFor({ state: "hidden" });
}
async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test("sends chosen type with the page where the draft began and a real saved receipt", async () => {
  await open(); assert.equal(await send().isDisabled(), true);
  if (process.env.FEEDBACK_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.FEEDBACK_UI_SCREENSHOT_DIR}/feedback-desktop.png` });
  await page.getByRole("radio", { name: "Question", exact: true }).check(); await message().fill("Where should our company documents go?");
  await page.evaluate(() => window.setFeedbackContext({ page: "Documents", view: "production" }));
  await send().click(); await page.getByRole("heading", { name: "Feedback received", exact: true }).waitFor();
  const sent = await requests("submit"); assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, "staff-one");
  assert.deepEqual(Object.keys(sent[0].input).sort(), ["id", "kind", "message", "page", "view", "workspaceId"]);
  assert.equal(sent[0].input.page, "Companies"); assert.equal(sent[0].input.view, "agency"); assert.equal(sent[0].input.kind, "question");
  assert.match(sent[0].input.id, /^[a-f0-9-]{36}$/);
  await page.getByRole("button", { name: "View feedback", exact: true }).click();
  await page.getByText("Where should our company documents go?", { exact: true }).waitFor();
});

test("lost send response preserves draft, retry ID, and one saved message; edits get a new ID", async () => {
  await open(); await message().fill("The upload button is confusing.");
  await page.evaluate(() => { window.feedbackCommitThenFail = true; });
  await send().click(); await page.getByRole("alert").waitFor();
  assert.equal(await message().inputValue(), "The upload button is confusing.");
  await send().click(); await page.waitForFunction(() => window.feedbackRequests.filter(request => request.method === "submit").length === 2);
  let sent = await requests("submit"); assert.equal(sent[0].input.id, sent[1].input.id); assert.equal(await page.evaluate(() => window.feedbackRows.length), 1);
  await page.evaluate(() => { window.feedbackCommitThenFail = false; });
  await message().fill("The revised upload button is confusing."); await send().click();
  await page.getByRole("heading", { name: "Feedback received", exact: true }).waitFor();
  sent = await requests("submit"); assert.notEqual(sent[2].input.id, sent[1].input.id);
});

test("pending send blocks duplicate clicks and closing preserves the active draft", async () => {
  await open(); await message().fill("Fictional pending feedback"); await page.evaluate(() => { window.feedbackHoldNextMutation = true; });
  await send().click(); await page.waitForFunction(() => window.feedbackPendingMutations.length === 1);
  assert.equal(await page.getByRole("button", { name: "Sending…", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Close feedback", exact: true }).click();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  assert.equal(await message().inputValue(), "Fictional pending feedback"); assert.equal((await requests("submit")).length, 1);
  await page.evaluate(() => window.feedbackPendingMutations.shift()());
  await page.getByRole("heading", { name: "Feedback received", exact: true }).waitFor();
});

test("ordinary staff can follow status/replies but have no owner inbox or update controls", async () => {
  await open(); await inbox([item("first", { status: "in_progress", owner_reply: "We are working on it." })]);
  await page.getByText("We are working on it.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Feedback inbox", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Update feedback", exact: true }).count(), 0);
  assert.match(await row("first").innerText(), /In progress/); assert.equal((await requests("update")).length, 0);
});

test("owner reply submits the observed version and preserves edits when a conflict rejects it", async () => {
  await open({ owner: true }); await inbox([item("first")], true);
  await row("first").getByRole("button", { name: "Update feedback", exact: true }).click();
  await page.getByLabel("Feedback status", { exact: true }).selectOption("in_progress");
  await page.getByLabel("Reply to sender", { exact: true }).fill("I am investigating the button.");
  await page.evaluate(() => { window.feedbackRows[0].version = 2; });
  await page.getByRole("button", { name: "Save update", exact: true }).click(); await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Reply to sender", { exact: true }).inputValue(), "I am investigating the button.");
  const updates = await requests("update"); assert.equal(updates[0].input.expectedVersion, 1);
  assert.equal(updates[0].userId, "staff-one");
  assert.equal(await page.getByText(/Feedback update saved/).count(), 0);
  await page.getByRole("button", { name: "Cancel update", exact: true }).click(); await page.getByRole("button", { name: "Refresh feedback", exact: true }).click();
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).waitFor({ state: "visible" }); await settled();
  await row("first").getByRole("button", { name: "Update feedback", exact: true }).click();
  await page.getByLabel("Reply to sender", { exact: true }).fill("The upload button is clearer now.");
  await page.getByLabel("Feedback status", { exact: true }).selectOption("done"); await page.getByRole("button", { name: "Save update", exact: true }).click();
  await page.getByText("Feedback update saved. The sender can see your reply and status.", { exact: true }).waitFor();
  assert.equal((await requests("update"))[1].input.expectedVersion, 2); assert.match(await row("first").innerText(), /Done/);
});

test("owner inbox refresh retains older pages and pauses polling during editing", async () => {
  await open({ owner: true }); await page.clock.install(); await inbox([item("first"), item("second"), item("third")], true);
  await page.getByRole("button", { name: "Load older feedback", exact: true }).click(); await row("third").waitFor();
  await page.evaluate(value => window.feedbackRows.unshift(value), item("newest", { created_at: "2026-09-23T12:06:00.000Z" }));
  await page.clock.runFor(15010); await row("newest").waitFor(); assert.equal(await row("third").count(), 1);
  await row("first").getByRole("button", { name: "Update feedback", exact: true }).click();
  const count = (await requests("list")).length; await page.clock.runFor(30010);
  assert.equal((await requests("list")).length, count); assert.equal(await page.getByRole("button", { name: "Refresh feedback", exact: true }).isDisabled(), true);
});

test("stale list and mutation results cannot cross a workspace or account change", async () => {
  await open(); await inbox([item("first")]);
  await page.evaluate(() => { window.feedbackHoldNextList = true; });
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).click(); await page.waitForFunction(() => window.feedbackPendingLists.length === 1);
  await page.evaluate(() => window.setFeedbackContext({ workspaceId: "workspace-two", userId: "staff-two" }));
  await page.getByRole("dialog").waitFor({ state: "hidden" }); await page.getByRole("button", { name: "Feedback", exact: true }).click();
  assert.equal(await message().inputValue(), ""); await page.evaluate(() => window.feedbackPendingLists.shift()()); await settled();
  assert.equal(await page.getByText("Fictional feedback first", { exact: true }).count(), 0);
  await message().fill("Second workspace draft"); await page.evaluate(() => { window.feedbackHoldNextMutation = true; }); await send().click();
  await page.waitForFunction(() => window.feedbackPendingMutations.length === 1);
  await page.evaluate(() => window.setFeedbackContext({ userId: "staff-three" }));
  await page.getByRole("button", { name: "Feedback", exact: true }).click(); await message().fill("New actor draft");
  await page.evaluate(() => window.feedbackPendingMutations.shift()()); await settled();
  assert.equal(await message().inputValue(), "New actor draft"); assert.equal(await page.getByRole("heading", { name: "Feedback received", exact: true }).count(), 0);
});

test("late refresh never overwrites a newer saved owner update", async () => {
  await open({ owner: true }); await inbox([item("first")], true);
  await page.evaluate(() => { window.feedbackHoldNextList = true; });
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).click(); await page.waitForFunction(() => window.feedbackPendingLists.length === 1);
  await row("first").getByRole("button", { name: "Update feedback", exact: true }).click();
  await page.getByLabel("Reply to sender", { exact: true }).fill("Newer saved reply"); await page.getByRole("button", { name: "Save update", exact: true }).click();
  await page.getByText("Newer saved reply", { exact: true }).waitFor();
  await page.evaluate(() => window.feedbackPendingLists.shift()()); await settled();
  assert.equal(await page.getByText("Newer saved reply", { exact: true }).count(), 1);
});

test("plain text feedback cannot execute markup and mobile dialog stays within the viewport", async () => {
  await open({ mobile: true });
  const sendRect = await send().boundingBox(); assert.ok(sendRect.y + sendRect.height <= 667, "mobile send remains visible before scrolling");
  if (process.env.FEEDBACK_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.FEEDBACK_UI_SCREENSHOT_DIR}/feedback-mobile.png` });
  const markup = '<img src=x onerror="window.feedbackXss=true">' + "x".repeat(400);
  await inbox([item("first", { message: markup, owner_reply: "<script>alert('no')</script>" })]); await row("first").waitFor();
  assert.equal(await page.locator("article img, article script").count(), 0); assert.match(await row("first").innerText(), /<img src=x/);
  const geometry = await page.getByRole("dialog").evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: window.innerWidth, overflow: element.scrollWidth > element.clientWidth }));
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width); assert.equal(geometry.overflow, false);
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent === "Feedback");
  assert.equal(await page.getByRole("button", { name: "Feedback", exact: true }).evaluate(element => element === document.activeElement), true);
});

test("refresh failure preserves visible feedback without a false empty or saved state", async () => {
  await open(); await inbox([item("first")]); await page.evaluate(() => { window.feedbackListError = "Feedback is temporarily unavailable"; });
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).click(); await page.getByRole("alert").waitFor();
  assert.equal(await row("first").count(), 1); assert.equal(await page.getByText("No feedback yet.", { exact: true }).count(), 0);
});

test("reopening an empty composer captures the new page while a written draft stays on its original page", async () => {
  await open(); await page.getByRole("button", { name: "Close feedback", exact: true }).click();
  await page.evaluate(() => window.setFeedbackContext({ page: "Documents", view: "production" }));
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByText("Production / Documents", { exact: true }).waitFor(); await message().fill("Document upload question");
  await page.getByRole("button", { name: "Close feedback", exact: true }).click(); await page.evaluate(() => window.setFeedbackContext({ page: "Settings", view: "agency" }));
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByText("Production / Documents", { exact: true }).waitFor(); await send().click();
  await page.getByRole("heading", { name: "Feedback received", exact: true }).waitFor(); assert.equal((await requests("submit"))[0].input.page, "Documents");
});

test("permission denial clears previously visible feedback and pauses automatic refresh", async () => {
  await open({ owner: true }); await page.clock.install(); await inbox([item("first")], true);
  assert.equal((await requests("list"))[0].userId, "staff-one");
  await page.evaluate(() => { window.feedbackListError = "Your access has changed"; window.feedbackListErrorStatus = 403; });
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).click(); await page.getByRole("alert").waitFor();
  assert.equal(await row("first").count(), 0); const count = (await requests("list")).length;
  await page.clock.runFor(30010); assert.equal((await requests("list")).length, count);
  assert.equal(await page.getByText("No feedback yet.", { exact: true }).count(), 0);
  await page.evaluate(() => { window.feedbackListError = ""; window.feedbackListErrorStatus = 0; });
  await page.getByRole("button", { name: "Refresh feedback", exact: true }).click(); await row("first").waitFor();
});

test("a hidden browser tab does not poll and becoming visible refreshes once", async () => {
  await open(); await page.clock.install(); await inbox([item("first")]); const before = (await requests("list")).length;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(30010); assert.equal((await requests("list")).length, before);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(count => window.feedbackRequests.filter(request => request.method === "list").length === count + 1, before);
});
