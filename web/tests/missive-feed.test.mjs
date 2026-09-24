import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ stdin: { contents: "export * from './lib/backend/missive-feed'; export {missiveReader} from './lib/backend/missive';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, write: false, bundle: true, format: "esm", platform: "node", target: "es2022" });
const { missiveFeedRoutes, listMissiveFeedConversations, listMissiveFeedMessages, readMissiveFeedMessage, missiveReader } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + "\n//# sourceURL=missive-feed-test-bundle.mjs").toString("base64")}`);
const operations = { userId: "staff", email: "staff@example.test", role: "operations", companyIds: ["A"], allCompanies: false, restricted: true, version: 1, partnerMembers: [] };
const route = (companyId = "A", changes = {}) => ({ id: `route:org:team:${companyId}`, organizationId: "org", teamId: "team", teamName: "Intake", companyId, version: 1, enabled: true, productionOnly: true, approvedAt: "2026-09-23", approvedBy: "owner@example.test", ...changes });
const routing = { schemaVersion: 2, revision: 1, mappings: [route()] };
const selected = { routeId: "route:org:team:A", revision: 1 };
const selectedConversation = { ...selected, conversationId: "conversation" };
const selectedMessage = { ...selectedConversation, messageId: "message" };
const conversation = { id: "conversation", organization: { id: "org", name: "Organization" }, team: { id: "team", organization: "org" }, subject: null, latest_message_subject: "Incoming request", last_activity_at: 1789200000, users: [{ email: "HIDDEN" }], web_url: "https://HIDDEN" };
const attachment = { id: "attachment", filename: "final.pdf", media_type: "application", sub_type: "pdf", size: 123, url: "https://HIDDEN/signed-token" };
const message = { id: "message", type: "email", draft: false, subject: "Title request", preview: "<p>Please review.</p>", delivered_at: 1789200000,
  from_field: { name: "Attorney", address: "attorney@example.test" }, attachments: [attachment], conversation,
  body: '<script>HIDDEN</script><p>Please review &amp; update.</p><img src="https://HIDDEN/tracker"><style>HIDDEN</style>',
  to_fields: [{ name: "Title", address: "title@example.test" }], cc_fields: [], bcc_fields: [{ address: "HIDDEN" }], token: "HIDDEN" };
function reader(values = {}) {
  const calls = [];
  return Object.assign(async path => {
    calls.push(path);
    if (path.startsWith("/v1/conversations?")) return { conversations: values.conversations ?? [conversation] };
    if (path.startsWith("/v1/conversations/conversation/messages?")) return { messages: values.messages ?? [message] };
    if (path === "/v1/conversations/conversation") return { conversations: values.conversation === undefined ? [conversation] : values.conversation };
    if (path === "/v1/messages/message") return { messages: values.message === undefined ? message : values.message };
    assert.fail(`Unexpected Missive path: ${path}`);
  }, { calls });
}
const list = (read = reader(), config = routing, access = operations, input = selected, companies = ["A"]) => listMissiveFeedConversations(read, config, access, companies, input);
const messages = (read = reader(), config = routing, access = operations, input = selectedConversation, companies = ["A"]) => listMissiveFeedMessages(read, config, access, companies, input);
const detail = (read = reader(), config = routing, access = operations, input = selectedMessage, companies = ["A"]) => readMissiveFeedMessage(read, config, access, companies, input);
const status = expected => error => error.status === expected;

test("only production staff can discover or read the feed", async () => {
  for (const role of ["partner", "viewer", "finance", "onboarding", "unknown"]) {
    const access = { ...operations, role, allCompanies: true }, read = reader();
    assert.throws(() => missiveFeedRoutes(routing, access, ["A"]), status(403));
    for (const request of [list, messages, detail]) await assert.rejects(request(read, routing, access), status(403));
    assert.deepEqual(read.calls, []);
  }
  for (const role of ["owner", "admin", "operations"]) assert.equal(missiveFeedRoutes(routing, { ...operations, role }, ["A"]).routes.length, 1);
});

test("operations require explicit production-only approval while assigned owners and admins can read general inboxes", async () => {
  for (const productionOnly of [undefined, false]) {
    const config = { ...routing, mappings: [route("A", { productionOnly })] }, read = reader();
    assert.deepEqual(missiveFeedRoutes(config, operations, ["A"]), { revision: 1, routes: [], blockedSharedInboxes: false });
    for (const request of [list, messages, detail]) await assert.rejects(request(read, config), status(403));
    assert.deepEqual(read.calls, []);
    for (const role of ["owner", "admin"]) assert.equal((await list(reader(), config, { ...operations, role })).rows.length, 1);
  }
  for (const productionOnly of ["true", 1, null, {}]) await assert.rejects(list(reader(), { ...routing, mappings: [route("A", { productionOnly })] }), status(409));
});

test("route discovery intersects current company visibility with assigned company access", () => {
  const config = { ...routing, mappings: [route(), route("B", { id: "route:org:team-b:B", teamId: "team-b" })] };
  const result = missiveFeedRoutes(config, operations, ["A", "B"]);
  assert.deepEqual(result, { revision: 1, routes: [{ id: selected.routeId, organizationId: "org", teamId: "team", teamName: "Intake", companyId: "A" }], blockedSharedInboxes: false });
  assert.equal(missiveFeedRoutes(config, operations, ["B"]).routes.length, 0);
  assert.equal(missiveFeedRoutes(config, { ...operations, allCompanies: true }, ["A"]).routes.length, 1);
  assert.equal(missiveFeedRoutes(config, { ...operations, companyIds: [] }, ["A", "B"]).routes.length, 0);
  assert.ok(!JSON.stringify(result).includes("approved"));
});

test("shared inboxes stay hidden even for all-company admins and when other routes are paused or deleted", async () => {
  for (const enabled of [true, false]) {
    const config = { ...routing, mappings: [route(), route("B", { enabled })] };
    for (const access of [operations, { ...operations, role: "owner", allCompanies: true }]) {
      const read = reader();
      assert.deepEqual(missiveFeedRoutes(config, access, ["A"]), { revision: 1, routes: [], blockedSharedInboxes: true });
      for (const request of [list, messages, detail]) await assert.rejects(request(read, config, access), status(403));
      assert.deepEqual(read.calls, []);
    }
  }
  assert.equal(missiveFeedRoutes({ ...routing, mappings: [route("B"), route("C")] }, operations, ["A"]).blockedSharedInboxes, false);
});

test("paused, removed, inaccessible and fabricated routes never trigger vendor reads", async () => {
  for (const config of [{ ...routing, mappings: [] }, { ...routing, mappings: [route("A", { enabled: false })] }, { ...routing, mappings: [route("B")] }]) {
    const read = reader();
    for (const request of [list, messages, detail]) await assert.rejects(request(read, config), status(403));
    assert.deepEqual(read.calls, []);
  }
  const read = reader();
  await assert.rejects(list(read, routing, operations, { ...selected, routeId: "route:org:team:B" }), status(403));
  await assert.rejects(detail(read, routing, operations, selectedMessage, []), status(403));
  assert.deepEqual(read.calls, []);
});

test("legacy approved single-inbox configuration remains readable", async () => {
  const mapping = route();
  delete mapping.id;
  delete mapping.enabled;
  const page = await list(reader(), { mapping });
  assert.equal(page.route.companyId, "A");
  assert.equal(page.revision, 1);
});

test("stale or malformed routing and selections fail before issuing any GET", async () => {
  const read = reader();
  for (const revision of [0, 2, "1", null, undefined, 1.5]) {
    for (const request of [list, messages, detail]) await assert.rejects(request(read, routing, operations, { ...selectedMessage, revision }), status(409));
  }
  for (const config of [{ ...routing, revision: "1" }, { ...routing, mappings: [route(), route()] }, { ...routing, mappings: [route("A", { id: "forged" })] }, { ...routing, mappings: [route("A", { teamId: "../org" })] }])
    await assert.rejects(list(read, config), status(409));
  for (const input of [null, false, []]) await assert.rejects(list(read, routing, operations, input), status(400));
  for (const until of [0, -1, NaN, Infinity, "123", {}, 253402300799]) await assert.rejects(list(read, routing, operations, { ...selected, until }), status(400));
  for (const badId of [undefined, null, [], "../secret", "foo?all=true", "a,b", "a\nb", "x".repeat(101)]) {
    await assert.rejects(messages(read, routing, operations, { ...selectedConversation, conversationId: badId }), status(400));
    await assert.rejects(detail(read, routing, operations, { ...selectedMessage, messageId: badId }), status(400));
  }
  assert.deepEqual(read.calls, []);
});

test("conversation list uses one scoped inbox GET and returns only selected summary fields", async () => {
  const read = reader(), result = await list(read);
  assert.deepEqual(read.calls, ["/v1/conversations?team_inbox=team&limit=50"]);
  assert.deepEqual(result.rows, [{ id: "conversation", subject: "Incoming request", at: conversation.last_activity_at }]);
  assert.equal(result.until, null);
  assert.equal(result.skipped, 0);
  assert.ok(!JSON.stringify(result).includes("HIDDEN"));
});

test("limited guest conversations are skipped without exposing subjects and empty pages work", async () => {
  const result = await list(reader({ conversations: [{ id: "guest", last_activity_at: conversation.last_activity_at, subject: "HIDDEN" }] }));
  assert.deepEqual(result.rows, []); assert.equal(result.skipped, 1); assert.equal(result.until, null);
  const empty = await list(reader({ conversations: [] }));
  assert.deepEqual(empty.rows, []); assert.equal(empty.skipped, 0); assert.equal(empty.until, null);
});

test("cross-organization, cross-team and inconsistent team ownership reject entire conversation page", async () => {
  for (const changes of [{ organization: { id: "other" } }, { team: { id: "other" } }, { team: { id: "team", organization: "other" } }]) {
    const read = reader({ conversations: [conversation, { ...conversation, id: "foreign", ...changes }] });
    await assert.rejects(list(read), status(409));
    assert.equal(read.calls.length, 1);
  }
});

test("conversation pagination preserves timestamp ties, includes skipped rows, and stops equal-time pages", async () => {
  const rows = Array.from({ length: 53 }, (_, index) => ({ ...conversation, id: `c-${index}`, last_activity_at: 200 - Math.min(index, 49) }));
  rows[52] = { id: "guest", last_activity_at: 151 };
  const read = reader({ conversations: rows });
  const page = await list(read, routing, operations, { ...selected, until: 200 });
  assert.equal(page.rows.length, 52); assert.equal(page.skipped, 1); assert.equal(page.until, 151);
  assert.equal(read.calls[0], "/v1/conversations?team_inbox=team&limit=50&until=200");
  assert.equal((await list(reader({ conversations: rows.map(value => ({ ...value, last_activity_at: 100 })) }))).until, null);
});

test("malformed, duplicate, excessive and nonmonotonic conversation pages fail closed", async () => {
  const samples = [null, {}, [null], [{ ...conversation, id: "bad/id" }], [{ ...conversation, subject: {} }], [{ ...conversation, last_activity_at: 0 }],
    [conversation, conversation], [{ ...conversation, id: "older", last_activity_at: 1 }, conversation], Array.from({ length: 501 }, (_, index) => ({ ...conversation, id: `c-${index}` }))];
  for (const conversations of samples) await assert.rejects(list(async () => ({ conversations })), status(502));
  await assert.rejects(list(reader(), routing, operations, { ...selected, until: 100 }), status(502));
});

test("messages list validates conversation scope before reading metadata and never fetches full bodies", async () => {
  const read = reader({ messages: [message, { ...message, id: "outgoing", author: { id: "coworker" } }, { ...message, id: "draft", draft: true }, { ...message, id: "sms", type: "twilio_message" }] });
  const result = await messages(read);
  assert.deepEqual(read.calls, ["/v1/conversations/conversation", "/v1/conversations/conversation/messages?limit=10", "/v1/conversations/conversation"]);
  assert.equal(result.rows.length, 1); assert.equal(result.skipped, 3); assert.equal(result.rows[0].preview, "Please review.");
  assert.equal(result.rows[0].body, undefined);
  assert.deepEqual(result.rows[0].attachments, [{ id: "attachment", name: "final.pdf", mime: "application/pdf", bytes: 123, status: "not_downloaded" }]);
  assert.ok(!JSON.stringify(result).includes("HIDDEN"));
});

test("stale, merged, guest and cross-company conversation detail reads stop before message access", async () => {
  for (const value of [[], [null], [{ ...conversation, id: "merged" }], [{ ...conversation, organization: { id: "other" } }], [{ ...conversation, team: { id: "other" } }], [{ id: "conversation", last_activity_at: 123 }]]) {
    for (const request of [messages, detail]) {
      const read = reader({ conversation: value });
      await assert.rejects(request(read), error => [409, 502].includes(error.status));
      assert.deepEqual(read.calls, ["/v1/conversations/conversation"]);
    }
  }
});

test("conversation moving inboxes during message fetch blocks metadata and body before returning", async () => {
  for (const request of [messages, detail]) {
    for (const changes of [{ team: { id: "other" } }, { organization: { id: "other" } }, { id: "merged" }]) {
      const base = reader(), calls = [];
      let scopeReads = 0;
      const read = async path => {
        calls.push(path);
        if (path === "/v1/conversations/conversation" && ++scopeReads === 2) return { conversations: [{ ...conversation, ...changes }] };
        return base(path);
      };
      await assert.rejects(request(read), status(409));
      assert.equal(calls.length, 3); assert.equal(calls[2], "/v1/conversations/conversation");
    }
  }
});

test("message pagination uses every channel timestamp without advancing past tied messages", async () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ ...message, id: `m-${index}`, delivered_at: 200 - Math.min(index, 9), type: index % 2 ? "custom_email" : "email" }));
  const page = await messages(reader({ messages: rows }), routing, operations, { ...selectedConversation, until: 200 });
  assert.equal(page.rows.length, 7); assert.equal(page.skipped, 7); assert.equal(page.until, 191);
  assert.equal((await messages(reader({ messages: rows.map(value => ({ ...value, delivered_at: 100 })) }))).until, null);
});

test("message list rejects malformed channel, draft, duplicate, scope and preview data", async () => {
  for (const changes of [{ type: 3 }, { draft: "false" }, { preview: {} }, { from_field: { address: "invalid" } }, { attachments: null }, { delivered_at: Infinity }])
    await assert.rejects(messages(reader({ messages: [{ ...message, ...changes }] })), status(502));
  await assert.rejects(messages(reader({ messages: [message, message] })), status(502));
  await assert.rejects(messages(reader({ messages: [{ ...message, conversation: { ...conversation, id: "other" } }] })), status(409));
  await assert.rejects(messages(reader({ messages: Array.from({ length: 501 }, (_, index) => ({ ...message, id: `m-${index}` })) })), status(502));
  const page = await messages(reader({ messages: [{ ...message, preview: undefined }] }));
  assert.equal(page.rows[0].preview, "");
});

test("full message read checks current scope and exposes plain text, headers and attachment metadata only", async () => {
  const read = reader(), result = await detail(read);
  assert.deepEqual(read.calls, ["/v1/conversations/conversation", "/v1/messages/message", "/v1/conversations/conversation"]);
  assert.equal(result.message.body, "Please review & update.");
  assert.equal(result.message.preview, undefined); assert.equal(result.message.html, undefined);
  assert.deepEqual(result.message.to, [{ name: "Title", address: "title@example.test" }]);
  assert.deepEqual(result.message.cc, []);
  assert.ok(!JSON.stringify(result).includes("HIDDEN"));
  assert.deepEqual((await detail(reader({ message: { ...message, body: "" } }))).message.body, "");
});

test("message IDs, conversation IDs and current route scope must all agree on the final GET", async () => {
  for (const changes of [{ id: "other" }, { draft: true }, { author: { id: "coworker" } }, { type: "custom_email" },
    { conversation: { ...conversation, id: "other" } }, { conversation: { ...conversation, organization: { id: "other" } } }, { conversation: { ...conversation, team: { id: "other" } } }]) {
    const read = reader({ message: { ...message, ...changes } });
    await assert.rejects(detail(read), status(409));
    assert.equal(read.calls.length, 2);
  }
});

test("missing or excessive full bodies, invalid headers and unsafe attachment metadata are rejected", async () => {
  for (const changes of [{ body: undefined }, { body: null }, { body: "x".repeat(500001) }, { to_fields: undefined }, { to_fields: [{ address: "bad" }] },
    { attachments: [attachment, attachment] }, { attachments: [{ ...attachment, id: "../file" }] }, { attachments: [{ ...attachment, size: -1 }] },
    { attachments: [{ ...attachment, size: 1.5 }] }, { attachments: [{ ...attachment, filename: {} }] }])
    await assert.rejects(detail(reader({ message: { ...message, ...changes } })), status(502));
  for (const value of [null, [], false, "unexpected"]) await assert.rejects(detail(reader({ message: value })), status(502));
});

test("the approved server reader performs only fixed-origin GETs without redirects or write bodies", async () => {
  const config = { workspaceId: "workspace", token: "TEST-ONLY-SECRET" }, calls = [];
  const read = missiveReader(config, "workspace", { ...operations, role: "owner", allCompanies: true }, async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    assert.equal(new URL(url).origin, "https://public.missiveapp.com");
    return new Response(JSON.stringify(url.endsWith("/messages/message") ? { messages: message } : { conversations: [conversation] }));
  });
  const result = await detail(read);
  assert.deepEqual(calls, ["https://public.missiveapp.com/v1/conversations/conversation", "https://public.missiveapp.com/v1/messages/message", "https://public.missiveapp.com/v1/conversations/conversation"]);
  assert.ok(!JSON.stringify(result).includes(config.token));
  // Staff can use only the scoped feed capability; the admin configuration reader
  // itself remains inaccessible when supplied the actual staff Access.
  assert.throws(() => missiveReader(config, "workspace", operations), status(403));
});

test("vendor failures are sanitized by the bounded reader and do not partially succeed", async () => {
  const config = { workspaceId: "workspace", token: "TEST-ONLY-SECRET" };
  for (const failureStatus of [401, 403, 429, 500]) {
    let count = 0;
    const read = missiveReader(config, "workspace", { ...operations, role: "owner", allCompanies: true }, async () => {
      count++;
      return count === 1 ? new Response(JSON.stringify({ conversations: [conversation] })) : new Response(config.token, { status: failureStatus });
    });
    await assert.rejects(detail(read), error => error.status === (failureStatus === 429 ? 429 : 502) && !error.message.includes(config.token));
    assert.equal(count, 2);
  }
});

test("inbox reads do not mutate routing, access, input or provider records", async () => {
  const config = structuredClone(routing), access = structuredClone(operations), input = structuredClone(selectedMessage), before = JSON.stringify({ config, access, input, message, conversation });
  await list(reader(), config, access, input); await messages(reader(), config, access, input); await detail(reader(), config, access, input);
  assert.equal(JSON.stringify({ config, access, input, message, conversation }), before);
});
