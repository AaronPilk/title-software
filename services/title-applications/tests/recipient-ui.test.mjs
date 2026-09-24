// Browser-level recipient tests use only a local fake API and fictional identity data.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile } from "node:fs/promises";

const service = fileURLToPath(new URL("../", import.meta.url));
const web = fileURLToPath(new URL("../../../web/", import.meta.url));
const require = createRequire(`${web}package.json`);
const { build } = require("esbuild"), { chromium } = require("playwright");
const token = "A".repeat(43);
let server, browser, context, page, origin, fake, errors = [];

function blankPerson() {
  return { id: "fictional-person", name: "", email: "", phone: "", dob: "", ssn: "", driverLicense: "", currentAddress: "", ownershipType: "undecided", businessName: "", businessStatus: "not-applicable", businessReference: "", residenceHistory: [], employmentHistory: [] };
}
function state(complete = false) {
  const person = blankPerson();
  if (complete) Object.assign(person, { name: "Fictional Applicant", email: "person@example.test", phone: "7045550100", dob: "1985-01-15", ssn: "123456789", driverLicense: "FICTIONAL-DL", currentAddress: "10 Example Street", ownershipType: "individual", residenceHistory: [{ id: "residence-1", address: "10 Example Street", from: "2000-01-01", to: "" }], employmentHistory: [{ id: "employment-1", employer: "Example Company", role: "Coordinator", address: "20 Example Street", from: "2000-01-01", to: "" }] });
  return { record: { id: "fictional-request", companyName: "Example Venture", recipientName: "Invited Recipient", status: "Draft", version: 0, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), payload: { applicants: [person], logoPreferences: "", notes: "" }, attachments: [], correctionNote: "", submittedAt: null }, calls: [], sessions: new Set(), files: new Map(), sequence: 0, denied: false, failNext: null, holdNext: null, releases: [], sessionExpiryMs: 3600000, loseUpload: false };
}

before(async () => {
  const built = await build({ absWorkingDir: service, entryPoints: ["src/app.tsx"], outfile: "app.js", nodePaths: [`${web}node_modules`], bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' } });
  const js = built.outputFiles.find(file => file.path.endsWith(".js")).contents, css = built.outputFiles.find(file => file.path.endsWith(".css")).contents;
  const html = await readFile(`${service}public/index.html`);
  const logo = await readFile(`${web}public/brand/ballantyne-title-logo.png`);
  server = createServer(async (req, res) => {
    try {
      res.setHeader("cache-control", "no-store");
      const send = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
      if (req.url === "/app.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(js); return; }
      if (req.url === "/app.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(css); return; }
      if (req.url.startsWith("/brand/")) { res.writeHead(200, { "content-type": "image/png" }); res.end(logo); return; }
      if (!req.url.startsWith("/api/")) { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks), action = req.url.slice(5);
      const body = action === "upload" ? await new Request("http://localhost/upload", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: raw }).formData() : JSON.parse(raw.toString());
      const session = action === "upload" ? body.get("session") : body.session;
      fake.calls.push({ action, body: action === "upload" ? { session, fileName: body.get("file").name } : structuredClone(body), referer: req.headers.referer });
      if (fake.failNext?.action === action) { const { status } = fake.failNext; fake.failNext = null; send({ error: "PRIVATE BACKEND DETAILS MUST NOT APPEAR" }, status); return; }
      if (action === "start") { send({ message: "If this link is available, a verification code has been sent." }); return; }
      if (action === "verify") {
        if (fake.denied || body.token !== token) { send({}, 403); return; }
        if (body.code !== "123456") { send({}, 401); return; }
        const nextSession = `fictional-session-${++fake.sequence}`; fake.sessions.add(nextSession);
        send({ session: nextSession, expiresAt: new Date(Date.now() + fake.sessionExpiryMs).toISOString(), application: fake.record }); return;
      }
      if (fake.denied || !fake.sessions.has(session)) { send({}, 403); return; }
      if (action === "load") { send(fake.record); return; }
      if (action === "download") { const file = fake.files.get(body.attachmentId); if (!file) { send({}, 404); return; } res.writeHead(200, { "content-type": file.mime, "content-disposition": 'attachment; filename="example.pdf"' }); res.end(file.bytes); return; }
      if (fake.record.status === "Submitted") { send({}, 409); return; }
      if (action !== "upload" && body.expectedVersion !== fake.record.version) { send({}, 409); return; }
      if (action === "save" || action === "submit") {
        fake.record = { ...fake.record, payload: structuredClone(body.payload), version: fake.record.version + 1, status: action === "submit" ? "Submitted" : fake.record.status, submittedAt: action === "submit" ? new Date().toISOString() : null };
      } else if (action === "upload") {
        const file = body.get("file"), id = `attachment-${++fake.sequence}`;
        fake.files.set(id, { mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
        fake.record = { ...fake.record, version: fake.record.version + 1, attachments: [...fake.record.attachments, { id, name: file.name, mime: file.type, bytes: file.size, sha256: "f".repeat(64) }] };
        if (fake.loseUpload) { fake.loseUpload = false; send({}, 503); return; }
      } else if (action === "remove-attachment") fake.record = { ...fake.record, version: fake.record.version + 1, attachments: fake.record.attachments.filter(file => file.id !== body.attachmentId) };
      else { send({}, 400); return; }
      if (fake.holdNext === action) { fake.holdNext = null; await new Promise(resolve => fake.releases.push(resolve)); }
      send(fake.record);
    } catch (error) { res.writeHead(500); res.end("Fake API error"); errors.push(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
});
afterEach(async () => { for (const release of fake?.releases || []) release(); await context?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function open({ complete = false, fragment = token, preserve = false, viewport = { width: 1280, height: 900 } } = {}) {
  errors = []; if (!preserve) fake = state(complete);
  await context?.close(); context = await browser.newContext({ viewport });
  await context.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(6000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/#${fragment}`);
}
async function enter() {
  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await page.getByLabel("Applicant name", { exact: true }).waitFor();
}
const section = label => page.getByRole("button", { name: new RegExp(`^\\d ${label}$`) }).click();
const save = async () => { await page.getByRole("button", { name: "Save draft", exact: true }).click(); await page.getByText("Draft saved. You can return using the original email link.", { exact: true }).waitFor(); };
const uploadFile = { name: "fictional-support.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nFictional test file") };

test("private fragment is erased before interaction; missing or malformed links collect no information", async () => {
  for (const fragment of ["", "bad-token"]) { await open({ fragment }); await page.getByRole("heading", { name: "Open your invitation to continue" }).waitFor(); assert.equal(new URL(page.url()).hash, ""); assert.equal(await page.locator("input").count(), 0); assert.deepEqual(fake.calls, []); }
  await open(); await page.getByRole("button", { name: "Send verification code" }).waitFor(); assert.equal(new URL(page.url()).hash, ""); assert.deepEqual(fake.calls, []);
  await enter(); assert.deepEqual(fake.calls.map(call => call.action), ["start", "verify"]);
  assert.deepEqual(fake.calls[0].body, { token }); assert.deepEqual(fake.calls[1].body, { token, code: "123456" }); assert.ok(fake.calls.every(call => !call.referer));
  assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
});

test("verification rejects wrong codes, does not echo backend errors, and applies resend cooldown", async () => {
  await open(); await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("000000"); await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByRole("alert").filter({ hasText: "That code could not be verified" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Resend code in/ }).isDisabled(), true);
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("alert").evaluate(node => node === document.activeElement), true);
  await page.getByLabel("Verification code").fill("123456"); await page.getByRole("button", { name: "Verify and continue" }).click(); await page.getByLabel("Applicant name", { exact: true }).waitFor();
});

test("a fresh zero-applicant draft opens one blank editor without writing until save", async () => {
  await open(); fake.record.payload.applicants = []; await enter();
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "");
  assert.equal(fake.record.payload.applicants.length, 0); assert.equal(fake.calls.filter(call => call.action === "save").length, 0);
  await page.getByLabel("Applicant name", { exact: true }).fill("Fictional First Applicant"); await save();
  assert.equal(fake.record.payload.applicants.length, 1); assert.equal(fake.record.payload.applicants[0].name, "Fictional First Applicant");
});

test("opening an invitation in the same tab restarts verification and protects unsaved entries", async () => {
  await open(); await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("Fictional Unsaved Applicant");
  page.once("dialog", dialog => dialog.dismiss()); await page.goto(`${origin}/#${token}`);
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "Fictional Unsaved Applicant");
  assert.equal(new URL(page.url()).hash, "");
  page.once("dialog", dialog => dialog.accept()); await page.goto(`${origin}/#${token}`);
  await page.getByRole("button", { name: "Send verification code", exact: true }).waitFor(); assert.equal(await page.getByLabel("Applicant name", { exact: true }).count(), 0);
  await enter(); assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "");
});

test("all form fields survive keyboard entry, steps, saves, and verified resumption", async () => {
  await open(); await enter();
  const identity = { "Applicant name": "Fictional Keyboard Applicant", Email: "fictional@example.test", Phone: "7045550111", "Date of birth": "1985-01-15", "Social Security number": "123-45-6789", "Driver’s license number": "EXAMPLE-DL", "Current address": "10 Fictional Lane" };
  for (const [label, value] of Object.entries(identity)) await page.getByLabel(label, { exact: true }).pressSequentially(value);
  for (const label of ["Date of birth", "Social Security number", "Driver’s license number"]) assert.equal(await page.getByLabel(label, { exact: true }).getAttribute("type"), "password");
  await page.getByRole("button", { name: "Show social security number", exact: true }).click(); assert.equal(await page.getByLabel("Social Security number", { exact: true }).getAttribute("type"), "text");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Ownership election").selectOption("business"); await page.getByLabel("Owner business name").fill("Fictional Owner LLC"); await page.getByLabel("Owner business status").selectOption("existing"); await page.getByLabel("Formation document or filing reference").fill("Formation reference EXAMPLE-1");
  await page.getByRole("button", { name: "Add residence", exact: true }).click(); await page.getByLabel("Residence 1 address", { exact: true }).fill("10 Fictional Lane"); await page.getByLabel("Residence 1 start date", { exact: true }).fill("2000-01-01");
  await page.getByRole("button", { name: "Add employment", exact: true }).click(); await page.getByLabel("Employment 1 employer or status", { exact: true }).fill("Self-employed"); await page.getByLabel("Employment 1 role", { exact: true }).fill("Consultant"); await page.getByLabel("Employment 1 address", { exact: true }).fill("20 Example Lane"); await page.getByLabel("Employment 1 start date", { exact: true }).fill("2000-01-01");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await page.getByLabel("Logo preferences").fill("Green lettering and a simple tree."); await page.getByLabel("Other application information").fill("Fictional reviewer context."); await save();
  assert.deepEqual(Object.keys(fake.calls.find(call => call.action === "save").body).sort(), ["expectedVersion", "payload", "session"]);
  assert.deepEqual(Object.keys(fake.record.payload).sort(), ["applicants", "logoPreferences", "notes"]);
  assert.equal(fake.record.payload.applicants[0].ssn, "123456789"); assert.equal(fake.record.payload.applicants[0].businessReference, "Formation reference EXAMPLE-1"); assert.equal(fake.record.payload.applicants[0].employmentHistory[0].role, "Consultant");
  await open({ preserve: true }); await enter();
  for (const [label, value] of Object.entries(identity)) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), label === "Social Security number" ? "123456789" : value);
  assert.equal(await page.getByLabel("Social Security number", { exact: true }).getAttribute("type"), "password");
  await section("Review & submit"); await page.getByText("All required application fields are complete.", { exact: true }).waitFor();
});

test("multiple applicants retain independent values and the limit is 20", async () => {
  await open(); await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("First Fictional Applicant");
  await page.getByRole("button", { name: "Add applicant", exact: true }).click(); await page.getByLabel("Applicant name", { exact: true }).fill("Second Fictional Applicant");
  await page.getByLabel("Current applicant").selectOption("0"); assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "First Fictional Applicant");
  for (let count = 2; count < 20; count++) await page.getByRole("button", { name: "Add applicant", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Add applicant", exact: true }).isDisabled(), true); await save(); assert.equal(fake.record.payload.applicants.length, 20); assert.equal(fake.record.payload.applicants[1].name, "Second Fictional Applicant");
});

test("incomplete application cannot submit and a readiness link opens the relevant applicant section", async () => {
  await open(); await enter(); await section("Review & submit");
  assert.equal(await page.getByRole("button", { name: "Submit application", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Applicant 1: choose individual or business ownership.", exact: true }).click();
  await page.getByLabel("Ownership election", { exact: true }).waitFor(); assert.equal(fake.calls.filter(call => call.action === "submit").length, 0);
});

test("conflicting saves preserve unsaved inputs, block overwrite, and confirm before loading latest", async () => {
  await open(); await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("Unsaved Fictional Value");
  fake.record.version++; fake.record.payload.applicants[0].name = "Latest Fictional Value";
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "A newer version" }).waitFor();
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "Unsaved Fictional Value"); assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Reload latest draft" }).click(); assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "Unsaved Fictional Value");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Reload latest draft" }).click(); await page.getByText("Latest saved application loaded.", { exact: true }).waitFor(); assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "Latest Fictional Value");
});

test("uploads save draft first and originals survive resumption, download, and removal", async () => {
  await open(); await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("Uploaded Fictional Applicant"); await section("Branding & documents"); await page.getByLabel("Logo preferences").fill("Fictional green logo");
  await page.getByLabel("Upload a supporting document").setInputFiles(uploadFile); await page.getByText("Document uploaded and draft saved.", { exact: true }).waitFor();
  assert.deepEqual(fake.calls.slice(-2).map(call => call.action), ["save", "upload"]); assert.equal(fake.record.payload.applicants[0].name, "Uploaded Fictional Applicant");
  await open({ preserve: true }); await enter(); await section("Branding & documents"); await page.getByText(uploadFile.name, { exact: true }).waitFor(); assert.equal(await page.getByLabel("Logo preferences").inputValue(), "Fictional green logo");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: `Download ${uploadFile.name}`, exact: true }).click(); assert.equal((await download).suggestedFilename(), uploadFile.name);
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: `Remove ${uploadFile.name}`, exact: true }).click(); await page.getByText("Document removed from the application.", { exact: true }).waitFor(); assert.equal(fake.record.attachments.length, 0);
});

test("a lost upload confirmation can be recovered by reloading without duplicating the file", async () => {
  await open(); await enter(); await section("Branding & documents"); fake.loseUpload = true;
  await page.getByLabel("Upload a supporting document").setInputFiles(uploadFile); await page.getByRole("alert").filter({ hasText: "We could not confirm this action" }).waitFor();
  assert.equal(fake.record.attachments.length, 1); await page.getByRole("button", { name: "Reload latest draft" }).click(); await page.getByText(uploadFile.name, { exact: true }).waitFor(); assert.equal(fake.calls.filter(call => call.action === "upload").length, 1);
});

test("unconfirmed mutations block retries until a reload; timeouts preserve the local draft", async () => {
  await open(); await page.clock.install(); await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("Fictional Timeout Applicant");
  fake.holdNext = "save"; await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.clock.fastForward(31_000); await page.getByRole("alert").filter({ hasText: "This request took too long" }).waitFor();
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "Fictional Timeout Applicant"); assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
  for (const release of fake.releases.splice(0)) release();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Reload latest draft" }).click(); await page.getByText("Latest saved application loaded.", { exact: true }).waitFor();
  assert.equal(fake.calls.filter(call => call.action === "save").length, 1); assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), false);
});

test("file bounds are checked before any upload request", async () => {
  await open(); await enter(); await section("Branding & documents"); const count = fake.calls.length;
  await page.getByLabel("Upload a supporting document").setInputFiles({ name: "too-large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65) });
  await page.getByRole("alert").filter({ hasText: "Choose a nonempty file up to 10 MB" }).waitFor(); assert.equal(fake.calls.length, count);
});

test("expired and revoked links never expose applicant fields or backend details", async () => {
  for (const status of [403, 410]) {
    await open({ complete: true }); fake.failNext = { action: "verify", status };
    await page.getByRole("button", { name: "Send verification code" }).click(); await page.getByLabel("Verification code").fill("123456"); await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.getByRole("heading", { name: "Open your invitation to continue" }).waitFor(); assert.equal(await page.getByLabel("Applicant name", { exact: true }).count(), 0); assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE BACKEND DETAILS|Fictional Applicant/);
  }
});

test("withdrawn session permission clears private data immediately", async () => {
  await open({ complete: true }); await enter(); fake.sessions.clear();
  await page.getByRole("button", { name: "Reload latest draft" }).click(); await page.getByRole("heading", { name: "Open your invitation to continue" }).waitFor();
  assert.equal(await page.locator("input").count(), 0); assert.doesNotMatch(await page.locator("body").innerText(), /Fictional Applicant|123456789|person@example.test/);
});

test("session expiry clears an unsaved draft and requires original invitation reentry", async () => {
  await open({ complete: true }); fake.sessionExpiryMs = 1600; await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("Private Unsaved Applicant");
  await page.getByRole("alert").filter({ hasText: "Your secure session has ended" }).waitFor(); assert.equal(await page.locator("input").count(), 0); assert.doesNotMatch(await page.locator("body").innerText(), /Private Unsaved Applicant/);
});

test("ending a session ignores a late save result and warns before dropping unsaved entries", async () => {
  await open(); await enter(); await page.getByLabel("Applicant name", { exact: true }).fill("Private Pending Applicant");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "End session", exact: true }).click(); assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "Private Pending Applicant");
  fake.holdNext = "save"; await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') !== null);
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "End session", exact: true }).click(); await page.getByRole("heading", { name: "Open your invitation to continue" }).waitFor();
  for (const release of fake.releases.splice(0)) release(); await page.waitForTimeout(100); assert.equal(await page.locator("input").count(), 0); assert.doesNotMatch(await page.locator("body").innerText(), /Private Pending Applicant/);
});

test("submission is read-only; a correction invalidates old sessions and reopens only after new verification", async () => {
  await open({ complete: true }); await enter(); await section("Review & submit");
  const submit = page.getByRole("button", { name: "Submit application", exact: true }); assert.equal(await submit.isDisabled(), true);
  await page.getByRole("checkbox", { name: "I have reviewed the information for every applicant and am ready to send it to Ballantyne for review.", exact: true }).check(); await submit.click();
  await page.getByText("Thank you. Your application is with the team.", { exact: true }).waitFor(); assert.equal(fake.record.status, "Submitted"); assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).count(), 0);
  await section("Applicant details"); assert.equal(await page.getByLabel("Applicant name", { exact: true }).isDisabled(), true);
  await section("Branding & documents"); assert.equal(await page.getByLabel("Upload a supporting document").count(), 0);
  fake.record = { ...fake.record, status: "Changes requested", version: fake.record.version + 1, correctionNote: "Please update the current phone number." }; fake.sessions.clear();
  await page.getByRole("button", { name: "Reload latest draft" }).click(); await page.getByRole("heading", { name: "Open your invitation to continue" }).waitFor();
  await open({ preserve: true }); await enter(); await page.getByText("Please update the current phone number.", { exact: true }).waitFor(); assert.equal(await page.getByLabel("Phone", { exact: true }).isDisabled(), false);
  await page.getByLabel("Phone", { exact: true }).fill("7045550199"); await section("Review & submit"); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Submit application", exact: true }).click(); await page.getByText("Thank you. Your application is with the team.", { exact: true }).waitFor(); assert.equal(fake.record.payload.applicants[0].phone, "7045550199");
});

test("mobile form stays within viewport and the keyboard can move through sections", async () => {
  await open({ viewport: { width: 390, height: 844 } }); await enter();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("button", { name: "2 Ownership & history", exact: true }).focus(); await page.keyboard.press("Enter"); await page.getByLabel("Ownership election").waitFor();
  assert.equal(await page.getByRole("heading", { name: "Ownership & history", exact: true }).evaluate(node => node === document.activeElement), true);
  await section("Review & submit"); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (process.env.JV_PORTAL_SCREENSHOT_DIR) {
    await mkdir(process.env.JV_PORTAL_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.JV_PORTAL_SCREENSHOT_DIR}/recipient-mobile-review.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await section("Applicant details");
    await page.screenshot({ path: `${process.env.JV_PORTAL_SCREENSHOT_DIR}/recipient-desktop-form.png`, fullPage: true });
  }
});
