/**
 * Real React UI -> real Worker -> real public HTTP/protocol -> real migration RPCs.
 * All browser traffic is loopback. Email is a captured example.test sink, storage
 * is a bounded Map plus the real storage.objects metadata table, and PostgreSQL
 * is a new socket-only cluster destroyed after the suite. Staff identity is a
 * fictional server-resolved fixture; hosted JWT/MFA, Vault keys, provider delivery,
 * Cloudflare's edge rate limiter, and production infrastructure are not claimed.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createIsolatedPostgres, fixtureIds, literal, jsonLiteral } from "./helpers/isolated-postgres.mjs";

const service = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const web = `${repo}web/`, require = createRequire(`${web}package.json`);
const { build } = require("esbuild"), { chromium } = require("playwright");
const gatewayKey = "fictional-integrated-gateway-key-at-least-32-bytes";
const publicEndpoint = "https://yhneskzvmtcmbsknidlt.supabase.co/functions/v1/title-jv-public";
let postgres, browser, browserContext, page, server, origin, handlers, protocolContext;
const emails = [], publicResults = [], browserErrors = [], serverErrors = [], objects = new Map();
let sinkSequence = 0;

before(async () => {
  postgres = createIsolatedPostgres(repo);
  const modules = await build({ absWorkingDir: repo, stdin: { contents: `export {portalFetch} from './services/title-applications/src/worker'; export {jvPortalPublicHttp} from './web/lib/backend/jv-portal-http'; export {jvPortalStaffRequest} from './web/lib/backend/jv-portal'; export {sendJvPortalEmail} from './web/lib/backend/jv-portal-email';`, resolveDir: repo, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
  handlers = await import(`data:text/javascript;base64,${Buffer.from(modules.outputFiles[0].contents).toString("base64")}`);
  const frontend = await build({ absWorkingDir: service, entryPoints: ["src/app.tsx"], outfile: "app.js", nodePaths: [`${web}node_modules`], bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' } });
  const assets = new Map([
    ["/", { content: await readFile(`${service}public/index.html`), mime: "text/html" }],
    ["/app.js", { content: frontend.outputFiles.find(file => file.path.endsWith(".js")).contents, mime: "text/javascript" }],
    ["/app.css", { content: frontend.outputFiles.find(file => file.path.endsWith(".css")).contents, mime: "text/css" }],
    ["/brand/ballantyne-title-logo.png", { content: await readFile(`${web}public/brand/ballantyne-title-logo.png`), mime: "image/png" }],
  ]);
  protocolContext = {
    rpc: postgres.rpc, portalUrl: "https://applications.example.test", mailConfigured: true,
    sendEmail: async job => {
      assert.match(job.to, /@example\.test$/);
      return handlers.sendJvPortalEmail(job, { apiKey: "fictional-email-key", from: "Ballantyne Title <noreply@example.test>", portalUrl: "https://applications.example.test", staffUrl: "https://workspace.example.test/#agency/companies" }, async (url, init) => {
        assert.equal(url, "https://api.resend.com/emails");
        const message = JSON.parse(init.body); assert.ok(message.to.every(address => address.endsWith("@example.test")));
        emails.push({ kind: job.kind, job: structuredClone(job), message });
        return Response.json({ id: `fictional-email-${++sinkSequence}` });
      });
    },
    storage: {
      async upload(path, bytes, mime) {
        assert.ok(bytes.length > 0 && bytes.length <= 10 * 1024 * 1024);
        assert.ok([...objects.values()].reduce((sum, file) => sum + file.bytes.length, 0) + bytes.length <= 40 * 1024 * 1024);
        assert.equal(objects.has(path), false); objects.set(path, { bytes: new Uint8Array(bytes), mime });
        postgres.sql(`insert into storage.objects(bucket_id,name,metadata) values('title-documents',${literal(path)},${jsonLiteral({ size: bytes.length, mimetype: mime })});`);
      },
      async download(path) { const entry = objects.get(path); if (!entry) throw new Error("Fictional object unavailable."); assert.ok(entry.bytes.length <= 10 * 1024 * 1024); return new Uint8Array(entry.bytes); },
      async remove(path) { objects.delete(path); postgres.sql(`delete from storage.objects where bucket_id='title-documents' and name=${literal(path)};`); },
    },
  };
  const env = {
    JV_PORTAL_GATEWAY_KEY: gatewayKey, JV_PUBLIC_ENDPOINT: publicEndpoint,
    PORTAL_REQUESTS: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async request => { const asset = assets.get(new URL(request.url).pathname); return asset ? new Response(asset.content, { headers: { "Content-Type": asset.mime } }) : new Response(null, { status: 404 }); } },
  };
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key, value);
      // Simulate only the edge-managed source-IP header; recipient headers and
      // payloads otherwise traverse the actual Worker and public HTTP handlers.
      headers.set("CF-Connecting-IP", "192.0.2.47");
      const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handlers.portalFetch(request, env, async (url, init) => {
        assert.ok(url.startsWith(`${publicEndpoint}/`));
        const result = await handlers.jvPortalPublicHttp(new Request(url, init), { gatewayKey, context: protocolContext });
        if (result.headers.get("Content-Type")?.includes("application/json")) publicResults.push({ action: url.slice(publicEndpoint.length + 1), status: result.status, data: await result.clone().json() });
        return result;
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { serverErrors.push(error.message); outgoing.writeHead(500); outgoing.end("Integrated fixture failure."); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true }); } catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
  browserContext = await browser.newContext();
  await browserContext.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  page = await browserContext.newPage(); page.setDefaultTimeout(10_000); page.on("pageerror", error => browserErrors.push(error.message));
});
after(async () => {
  try { await browserContext?.close(); await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
  finally { postgres?.stop(); }
});

async function staff(action, details = {}) {
  const { workspace, staff: userId, company } = fixtureIds;
  return handlers.jvPortalStaffRequest(action, { workspaceId: workspace, companyId: company, ...details }, {
    ...protocolContext, workspaceId: workspace,
    access: { userId, email: "staff@example.test", role: "onboarding", companyIds: [company], allCompanies: false, restricted: true, version: 1, partnerMembers: [] },
    state: { companies: [{ id: company, name: "Fictional Integrated Venture" }], documents: [] },
  });
}
const emailInvitationLink = entry => entry.message.text.match(/https:\/\/applications\.example\.test\/#[A-Za-z0-9_-]{43}/)?.[0];
async function invitation(link, rejectWrongCode = false) {
  const url = new URL(link); assert.equal(url.origin, "https://applications.example.test");
  await page.goto(`${origin}/${url.hash}`);
  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  const email = emails.filter(entry => entry.kind === "challenge").at(-1); assert.ok(email);
  const code = email.message.text.match(/verification code is (\d{6})\./)?.[1]; assert.match(code, /^\d{6}$/);
  if (rejectWrongCode) {
    await page.getByLabel("Verification code", { exact: true }).fill(String((Number(code) + 1) % 1_000_000).padStart(6, "0"));
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "That code could not be verified" }).waitFor();
    assert.equal(await page.getByLabel("Applicant name", { exact: true }).count(), 0);
    assert.equal(publicResults.filter(entry => entry.action === "verify").at(-1).status, 401);
  }
  await page.getByLabel("Verification code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await page.getByLabel("Current applicant", { exact: true }).waitFor();
}
const section = label => page.getByRole("button", { name: new RegExp(`^\\d ${label}$`) }).click();
async function saveDraft() { await page.getByRole("button", { name: "Save draft", exact: true }).click(); await page.getByText("Draft saved. You can return using the original email link.", { exact: true }).waitFor(); }
async function submit() {
  await section("Review & submit"); await page.getByText("All required application fields are complete.", { exact: true }).waitFor();
  await page.getByRole("checkbox", { name: "I have reviewed the information for every applicant and am ready to send it to Ballantyne for review.", exact: true }).check();
  await page.getByRole("button", { name: "Submit application", exact: true }).click();
  await page.getByText("Thank you. Your application is with the team.", { exact: true }).waitFor();
}

test("recipient completes and corrects a real PostgreSQL application through the real public handlers", async () => {
  const prepared = await staff("create", { requestId: crypto.randomUUID(), recipientName: "Fictional Invited Recipient", email: "recipient@example.test" });
  assert.equal(prepared.request.status, "Draft"); assert.match(prepared.link, /#[A-Za-z0-9_-]{43}$/); assert.equal(emails.length, 0);
  const sent = await staff("send", { id: prepared.request.id, expectedVersion: prepared.request.version }); assert.equal(sent.deliveryStatus, "sent");
  const initialLink = emailInvitationLink(emails.find(entry => entry.kind === "invitation"));
  await invitation(initialLink, true);
  assert.deepEqual(publicResults.find(entry => entry.action === "start").data, { message: "If this link is available, a verification code has been sent." });
  const verified = publicResults.filter(entry => entry.action === "verify" && entry.status === 200).at(-1).data;
  assert.deepEqual(Object.keys(verified.application).sort(), ["attachments", "companyName", "correctionNote", "expiresAt", "id", "payload", "recipientName", "status", "submittedAt", "version"]);
  assert.deepEqual(verified.application.payload, { applicants: [], logoPreferences: "", notes: "" });
  await page.getByLabel("Applicant name", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), "");
  assert.equal(publicResults.filter(entry => entry.action === "save").length, 0);
  const identity = { "Applicant name": "Fictional Integrated Applicant", Email: "applicant@example.test", Phone: "7045550100", "Date of birth": "1985-01-15", "Social Security number": "123-45-6789", "Driver’s license number": "FICTIONAL-INTEGRATED-DL", "Current address": "10 Fictional Integrated Lane" };
  for (const [label, value] of Object.entries(identity)) await page.getByLabel(label, { exact: true }).fill(value);
  await section("Ownership & history"); await page.getByLabel("Ownership election").selectOption("individual");
  await page.getByRole("button", { name: "Add residence", exact: true }).click(); await page.getByLabel("Residence 1 address", { exact: true }).fill(identity["Current address"]); await page.getByLabel("Residence 1 start date", { exact: true }).fill("2000-01-01");
  await page.getByRole("button", { name: "Add employment", exact: true }).click(); await page.getByLabel("Employment 1 employer or status", { exact: true }).fill("Fictional Example Employer"); await page.getByLabel("Employment 1 start date", { exact: true }).fill("2000-01-01");
  await section("Branding & documents"); await page.getByLabel("Logo preferences").fill("Fictional navy lettering."); await page.getByLabel("Other application information").fill("FICTIONAL_INTEGRATED_PRIVATE_NOTE"); await saveDraft();
  const content = Buffer.from("Fictional supporting document for local integration verification.\n");
  await page.getByLabel("Upload a supporting document").setInputFiles({ name: "fictional-support.txt", mimeType: "text/plain", buffer: content }); await page.getByText("Document uploaded and draft saved.", { exact: true }).waitFor();
  assert.equal(objects.size, 1);
  assert.equal(postgres.sql("select count(*) from title_private.jv_portal_attachments where state='ready';").trim(), "1");
  // Resume with another verification; advance only the test database's resend
  // cooldown timestamp to avoid making the suite sleep for a real minute.
  postgres.sql(`update title_private.jv_portal_invites set challenge_started_at=now()-interval '61 seconds' where id=${literal(prepared.request.id)};`);
  await invitation(initialLink); assert.equal(await page.getByLabel("Applicant name", { exact: true }).inputValue(), identity["Applicant name"]);
  await section("Branding & documents"); await page.getByText("fictional-support.txt", { exact: true }).waitFor();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download fictional-support.txt", exact: true }).click(); const download = await downloaded;
  assert.deepEqual(await readFile(await download.path()), content);
  await submit(); assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).count(), 0);
  const reviewed = await staff("load-submission", { id: prepared.request.id }); assert.equal(reviewed.request.status, "Submitted"); assert.equal(reviewed.payload.applicants[0].ssn, "123456789"); assert.equal(reviewed.attachments.length, 1);
  const original = await staff("download-attachment", { id: prepared.request.id, attachmentId: reviewed.attachments[0].id }); assert.deepEqual(Buffer.from(original.bytes), content);
  const { workspace, staff: actor, company } = fixtureIds;
  const internal = await postgres.rpc("title_jv_intake", { p_workspace: workspace, p_actor: actor, p_access_version: 1, p_company: company, p_action: "load", p_input: {} });
  assert.equal(internal.status, "Ready for review"); assert.equal(internal.payload.applicants[0].ssn, "123456789"); assert.equal(internal.payload.steps.length, 17); assert.equal(internal.payload.sourceDocumentIds.length, 1);
  const documents = JSON.parse(postgres.sql(`select state->'documents' from public.title_workspaces where id=${literal(workspace)};`).trim()); assert.equal(documents[0].visibility, "Restricted"); assert.equal(documents[0].category, "Applications");
  const submissionEmail = emails.filter(entry => entry.kind === "submission").at(-1); assert.deepEqual(submissionEmail.message.to, ["staff@example.test"]); assert.doesNotMatch(JSON.stringify(submissionEmail.message), /123456789|1985-01-15|FICTIONAL-INTEGRATED-DL|FICTIONAL_INTEGRATED_PRIVATE_NOTE/);
  const correction = await staff("request-changes", { id: prepared.request.id, expectedVersion: reviewed.request.version, note: "Please update your current phone number." }); assert.equal(correction.request.status, "Changes requested");
  await page.getByRole("button", { name: "Reload latest draft", exact: true }).click(); await page.getByRole("heading", { name: "Open your invitation to continue", exact: true }).waitFor(); assert.equal(await page.locator("input").count(), 0);
  await staff("send", { id: prepared.request.id, expectedVersion: correction.request.version }); const correctionLink = emailInvitationLink(emails.filter(entry => entry.kind === "invitation").at(-1)); assert.notEqual(correctionLink, initialLink);
  postgres.sql(`update title_private.jv_portal_invites set challenge_started_at=now()-interval '61 seconds' where id=${literal(prepared.request.id)};`);
  await invitation(correctionLink); await page.getByText("Please update your current phone number.", { exact: true }).waitFor(); await page.getByLabel("Phone", { exact: true }).fill("7045550199"); await submit();
  const corrected = await staff("load-submission", { id: prepared.request.id }); assert.equal(corrected.payload.applicants[0].phone, "7045550199"); assert.equal(corrected.request.status, "Submitted");
  assert.equal(corrected.attachments.length, 1); assert.equal(objects.size, 1); assert.equal(postgres.sql("select count(*) from public.title_assets;").trim(), "1");
  assert.equal(postgres.sql("select count(*) from vault.secrets where secret like '%FICTIONAL_INTEGRATED_PRIVATE_NOTE%' or secret like '%123456789%';").trim(), "0");
  for (const table of ["title_private.jv_portal_events", "public.title_audit"]) assert.equal(postgres.sql(`select count(*) from ${table} t where row_to_json(t)::text like '%FICTIONAL_INTEGRATED_PRIVATE_NOTE%' or row_to_json(t)::text like '%123456789%';`).trim(), "0");
  assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
  await staff("revoke", { id: prepared.request.id, expectedVersion: corrected.request.version }); await page.getByRole("button", { name: "Reload latest draft", exact: true }).click(); await page.getByRole("heading", { name: "Open your invitation to continue", exact: true }).waitFor();
  assert.equal(await page.locator("input").count(), 0); assert.doesNotMatch(await page.locator("body").innerText(), /Fictional Integrated Applicant|123456789/);
  assert.deepEqual(browserErrors, []); assert.deepEqual(serverErrors, []);
});
