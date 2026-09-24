import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ stdin: { contents: "export {missiveFeedRequest} from './lib/backend/missive-feed-http'; export {ApiError} from './lib/backend/workspace';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, write: false, bundle: true, format: "esm", platform: "node", target: "es2022" });
const { missiveFeedRequest, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + "\n//# sourceURL=missive-feed-http-test-bundle.mjs").toString("base64")}`);
const secret = "missive_pat-TEST-ONLY-PRIVATE";
const mappedRoute = { id: "route:org:team:A", organizationId: "org", teamId: "team", teamName: "Intake", companyId: "A", version: 1, enabled: true, productionOnly: true, approvedAt: "2026-09-23", approvedBy: "owner@example.test" };
const input = { routeId: mappedRoute.id, revision: 1, conversationId: "conversation", messageId: "message" };
const conversation = { id: "conversation", organization: { id: "org" }, team: { id: "team", organization: "org" }, subject: "Incoming request", last_activity_at: 1789200000 };
const message = { id: "message", type: "email", draft: false, subject: "Title request", preview: "<p>Review request</p>", body: '<p>Review &amp; reply.</p><script>PRIVATE</script><img src="https://PRIVATE/track">',
  delivered_at: 1789200000, from_field: { name: "Attorney", address: "attorney@example.test" }, to_fields: [{ name: "Title", address: "title@example.test" }],
  attachments: [{ id: "attachment", filename: "final.pdf", media_type: "application", sub_type: "pdf", size: 12, url: "https://PRIVATE/signed-download" }], conversation };
function fixture() {
  const credentials = [], vendor = [];
  const stored = { exists: true, configured: true, revision: 5, verifiedAt: "2026-09-23T00:00:00Z", token: secret };
  const ctx = {
    workspaceId: "workspace", access: { userId: "staff", email: "staff@example.test", role: "operations", companyIds: ["A"], allCompanies: false, restricted: true, version: 7, partnerMembers: [] },
    state: { companies: [{ id: "A" }, { id: "B" }] }, integration: { status: "configured", config: { schemaVersion: 2, revision: 1, mappings: [structuredClone(mappedRoute)] } }, fallback: {},
    credential: async (routeId, revision, decrypt) => {
      credentials.push({ routeId, revision, decrypt });
      if (routeId !== null) { assert.equal(routeId, mappedRoute.id); assert.equal(revision, 1); }
      return { ...stored, token: decrypt ? stored.token : undefined };
    },
    fetcher: async (url, options) => {
      vendor.push({ url, options });
      assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.redirect, "error");
      assert.equal(new URL(url).origin, "https://public.missiveapp.com");
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      if (url.endsWith("/v1/conversations?team_inbox=team&limit=50") || url.endsWith("/v1/conversations/conversation")) return new Response(JSON.stringify({ conversations: [conversation] }));
      if (url.endsWith("/v1/conversations/conversation/messages?limit=10")) return new Response(JSON.stringify({ messages: [message] }));
      if (url.endsWith("/v1/messages/message")) return new Response(JSON.stringify({ messages: message }));
      assert.fail(`Unexpected Missive request ${url}`);
    },
  };
  return { ctx, credentials, vendor, stored };
}
const status = expected => error => error.status === expected;
const read = (f, path = "/missive-feed/conversations", values = input, method = "POST") => missiveFeedRequest(path, method, values, f.ctx);

test("setup uses metadata capability only, exposes no secret, and performs no vendor GET", async () => {
  const f = fixture(), result = await read(f, "/missive-feed", {}, "GET");
  assert.equal(result.status, "ready"); assert.equal(result.readOnly, true); assert.equal(result.routes.length, 1);
  assert.deepEqual(f.credentials, [{ routeId: null, revision: null, decrypt: false }]);
  assert.deepEqual(f.vendor, []); assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes("token"));
});

test("absent connection, tombstoned credential, missing route, and paused integration block mailbox reads", async () => {
  for (const setupState of ["token_required", "routing_required", "paused"]) {
    const f = fixture();
    if (setupState === "token_required") { f.stored.configured = false; f.stored.token = null; f.ctx.fallback = { workspaceId: "workspace", token: secret }; }
    if (setupState === "routing_required") f.ctx.integration.config.mappings = [];
    if (setupState === "paused") f.ctx.integration.status = "disabled";
    assert.equal((await read(f, "/missive-feed", {}, "GET")).status, setupState);
    for (const path of ["/missive-feed/conversations", "/missive-feed/messages", "/missive-feed/message"]) await assert.rejects(read(f, path), status(409));
    assert.deepEqual(f.vendor, []); assert.ok(f.credentials.every(call => !call.decrypt));
  }
  const f = fixture(); f.stored.exists = false; f.stored.configured = false; f.stored.token = null;
  f.ctx.fallback = { workspaceId: "other-workspace", token: secret };
  assert.equal((await read(f, "/missive-feed", {}, "GET")).status, "token_required");
});

test("unsupported methods and attempted Missive mutations cannot decrypt or call the vendor", async () => {
  for (const [path, method] of [["/missive-feed", "POST"], ["/missive-feed/conversations", "GET"], ["/missive-feed/message", "PATCH"],
    ["/missive-feed/message", "DELETE"], ["/missive-feed/send", "POST"], ["/missive-feed/drafts", "POST"], ["/missive-feed/archive", "POST"], ["/missive-feed/read", "POST"]]) {
    const f = fixture();
    await assert.rejects(read(f, path, input, method), status(405));
    assert.deepEqual(f.credentials, []); assert.deepEqual(f.vendor, []);
  }
});

test("nonproduction roles cannot discover setup or use the credential capability", async () => {
  for (const role of ["partner", "viewer", "finance", "onboarding"]) {
    const f = fixture(); f.ctx.access.role = role; f.ctx.access.allCompanies = true;
    await assert.rejects(read(f, "/missive-feed", {}, "GET"), status(403));
    for (const path of ["/missive-feed/conversations", "/missive-feed/messages", "/missive-feed/message"]) await assert.rejects(read(f, path), status(403));
    assert.deepEqual(f.credentials, []); assert.deepEqual(f.vendor, []);
  }
});

test("operations cannot discover or decrypt general company inboxes without production-only approval", async () => {
  for (const productionOnly of [undefined, false]) {
    const f = fixture(); f.ctx.integration.config.mappings[0].productionOnly = productionOnly;
    const setup = await read(f, "/missive-feed", {}, "GET");
    assert.equal(setup.status, "routing_required"); assert.deepEqual(setup.routes, []);
    for (const path of ["/missive-feed/conversations", "/missive-feed/messages", "/missive-feed/message"]) await assert.rejects(read(f, path), status(409));
    assert.ok(f.credentials.every(call => !call.decrypt)); assert.deepEqual(f.vendor, []);
    for (const role of ["owner", "admin"]) {
      f.ctx.access.role = role;
      assert.equal((await read(f, "/missive-feed", {}, "GET")).status, "ready");
    }
  }
});

test("unauthorized company, fabricated route and stale revision are rejected before decryption", async () => {
  const values = [{ ...input, routeId: "route:org:team:B" }, { ...input, routeId: "https://PRIVATE" }, { ...input, revision: 2 }, { ...input, revision: "1" }];
  for (const value of values) {
    const f = fixture(); await assert.rejects(read(f, "/missive-feed/conversations", value), status(409));
    assert.ok(f.credentials.every(call => !call.decrypt)); assert.deepEqual(f.vendor, []);
  }
  for (const mutate of [f => { f.ctx.access.companyIds = ["B"]; }, f => { f.ctx.state.companies = [{ id: "B" }]; }, f => { f.ctx.integration.config.mappings[0].enabled = false; },
    f => { f.ctx.integration.config.mappings.push({ ...mappedRoute, id: "route:org:team:B", companyId: "B", enabled: false }); }]) {
    const f = fixture(); mutate(f); await assert.rejects(read(f), status(409));
    assert.ok(f.credentials.every(call => !call.decrypt)); assert.deepEqual(f.vendor, []);
  }
});

test("provider reads require scoped decryption and a second capability check before returning data", async () => {
  const f = fixture(), result = await read(f);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(f.credentials, [{ routeId: null, revision: null, decrypt: false }, { routeId: input.routeId, revision: 1, decrypt: true }, { routeId: input.routeId, revision: 1, decrypt: false }]);
  assert.deepEqual(f.vendor.map(call => call.url), ["https://public.missiveapp.com/v1/conversations?team_inbox=team&limit=50"]);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("full email is returned only as plain text without attachment URLs or vendor-only fields", async () => {
  const f = fixture(), result = await read(f, "/missive-feed/message");
  assert.equal(result.message.body, "Review & reply.");
  assert.equal(result.message.html, undefined); assert.equal(result.message.attachments[0].url, undefined);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.equal(f.vendor.length, 3);
});

test("outgoing mail and drafts cannot appear in metadata or be opened as incoming messages", async () => {
  for (const changes of [{ draft: true }, { author: { id: "coworker" } }]) {
    const f = fixture(), fetcher = f.ctx.fetcher;
    f.ctx.fetcher = async (url, options) => {
      if (url.endsWith("/messages?limit=10")) { f.vendor.push({ url, options }); return new Response(JSON.stringify({ messages: [{ ...message, ...changes }] })); }
      if (url.endsWith("/v1/messages/message")) { f.vendor.push({ url, options }); return new Response(JSON.stringify({ messages: { ...message, ...changes } })); }
      return fetcher(url, options);
    };
    const result = await read(f, "/missive-feed/messages");
    assert.deepEqual(result.rows, []); assert.equal(result.skipped, 1);
    await assert.rejects(read(f, "/missive-feed/message"), status(409));
  }
});

test("credential changes during provider access discard the fetched result", async () => {
  const f = fixture(), fetcher = f.ctx.fetcher;
  f.ctx.fetcher = async (url, options) => { const response = await fetcher(url, options); f.stored.revision++; f.stored.configured = false; return response; };
  await assert.rejects(read(f), status(409));
  assert.equal(f.vendor.length, 1); assert.equal(f.credentials.length, 3);
});

test("disconnected credential fails closed even if its reported revision is unchanged", async () => {
  const f = fixture(), fetcher = f.ctx.fetcher;
  f.ctx.fetcher = async (url, options) => { const response = await fetcher(url, options); f.stored.configured = false; f.stored.token = null; return response; };
  await assert.rejects(read(f), status(409));
  assert.equal(f.vendor.length, 1);
});

test("unknown and disabled integration statuses cannot activate a configured route", async () => {
  for (const integrationStatus of ["disabled", "pending", "connected", "", "unexpected"]) {
    const f = fixture(); f.ctx.integration.status = integrationStatus;
    assert.equal((await read(f, "/missive-feed", {}, "GET")).status, "paused");
    await assert.rejects(read(f), status(409));
    assert.ok(f.credentials.every(call => !call.decrypt)); assert.deepEqual(f.vendor, []);
  }
});

test("access revocation or routing edits during provider access discard the fetched result", async () => {
  for (const revoked of ["access", "route"]) {
    const f = fixture(), credential = f.ctx.credential, fetcher = f.ctx.fetcher;
    let changed = false;
    f.ctx.fetcher = async (url, options) => { const response = await fetcher(url, options); changed = true; return response; };
    f.ctx.credential = async (...args) => {
      if (changed) throw new ApiError(revoked === "access" ? "Access changed." : "Inbox routing changed.", 409);
      return credential(...args);
    };
    await assert.rejects(read(f), status(409));
    assert.equal(f.vendor.length, 1);
  }
});

test("failed provider response cannot be returned as a partial feed or echo tokens", async () => {
  const f = fixture(); f.ctx.fetcher = async () => new Response(secret, { status: 500 });
  await assert.rejects(read(f), error => error.status === 502 && !error.message.includes(secret));
  assert.equal(f.credentials.length, 2);
});
