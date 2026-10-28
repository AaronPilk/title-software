import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { advance } from "../src/core.ts";
import type { AssistantContext, AssistantInput } from "../../../web/lib/assistant/protocol.ts";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const screen = { page: "Documents", view: "agency", surface: "page" } as const;
const scope = { workspaceId: "synthetic-workspace", companyId: "", orderId: "", purpose: "help", screen } as const;
const context = (userId = "user-a"): AssistantContext => ({
  ...scope, userId, companyName: "Product help", role: "operations", revision: 1, accessVersion: 1,
  sources: [{ id: "help:documents", label: "Documents", page: "Documents", facts: { steps: ["Open Documents."] } }],
  readableSourceIds: ["help:documents"], truncated: false,
});
const answer = { summary: "Open Documents.", findings: [{ text: "Open Documents.", sourceIds: ["help:documents"] }], nextStep: "Open Documents." };

async function bundleService(directory: string) {
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "synthetic-assistant-sdk-test",
    main: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    compatibility_date: "2026-09-13", compatibility_flags: ["nodejs_compat"],
    durable_objects: { bindings: [{ name: "PERSONAL_ASSISTANT", class_name: "PersonalAssistant" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["PersonalAssistant"] }],
  }));
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "deploy", "--config", configPath, "--dry-run", "--outdir", join(directory, "bundle"),
  ], { cwd: directory, timeout: 20000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  return readFile(join(directory, "bundle", "index.js"), "utf8");
}

function runtimeOptions(directory: string, script: string) {
  return convertV4MiniflareOptions({
    resourcePersistencePath: join(directory, "storage"),
    unsafeInspectDurableObjects: true,
    telemetry: { enabled: false }, cf: false,
    workers: [{
      name: "assistant-test", modules: true, script,
      compatibilityDate: "2026-09-13", compatibilityFlags: ["nodejs_compat"],
      bindings: { TITLE_API_URL: "https://backend.synthetic.test/title-api" },
      durableObjects: { PERSONAL_ASSISTANT: { className: "PersonalAssistant", useSQLite: true } },
      serviceBindings: { AI: "synthetic-ai" },
      outboundService: async (request: Request) => {
        assert.equal(request.url, "https://backend.synthetic.test/title-api/assistant/context");
        assert.deepEqual(await request.json(), scope);
        return Response.json(context(request.headers.get("Authorization") === "Bearer synthetic-user-b" ? "user-b" : "user-a"));
      },
    }, {
      name: "synthetic-ai", modules: true, compatibilityDate: "2026-09-13",
      script: `import { WorkerEntrypoint } from "cloudflare:workers";
        export default class SyntheticAI extends WorkerEntrypoint {
          async run() { return { response: ${JSON.stringify(answer)} }; }
        }`,
      outboundService: async () => { throw Error("The synthetic AI must not access a provider."); },
    }],
  });
}

async function call(runtime: InstanceType<typeof Miniflare>, action: string, extra: Record<string, unknown> = {}, user = "a") {
  const response = await runtime.dispatchFetch("https://assistant.synthetic.test/assistant", {
    method: "POST", headers: { Authorization: `Bearer synthetic-user-${user}`, apikey: "synthetic-public-key", "Content-Type": "application/json" },
    body: JSON.stringify({ ...scope, action, ...extra }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function completedHistory(runtime: InstanceType<typeof Miniflare>) {
  let history = await call(runtime, "list");
  for (let i = 0; i < 100 && history.threads[0].turns[0].forks[0].status === "Running"; i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    history = await call(runtime, "list");
  }
  assert.equal(history.threads[0].turns[0].forks[0].status, "Complete");
  return history;
}

// Exercise the installed SDK and SQLite-backed Durable Object, not the Agent
// substitute used by the fast HTTP tests. Every outbound request terminates in
// a local fixture; no credentials, backend or AI provider are used.
test("installed SDK persists private assistant history across restart and separates users", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "title-assistant-sdk-"));
  let runtime: InstanceType<typeof Miniflare> | undefined;
  try {
    const options = runtimeOptions(directory, await bundleService(directory));
    runtime = new Miniflare(options);
    assert.deepEqual((await call(runtime, "list")).threads, []);
    const sent = await call(runtime, "send", { requestId: crypto.randomUUID(), question: "How do I add a document?", specialists: ["Product guide"] });
    assert.equal(sent.threads.length, 1);
    assert.equal(sent.remaining, 29);
    const history = await completedHistory(runtime);
    assert.equal(history.threads[0].turns[0].forks[0].result.summary, "Open Documents.");
    assert.deepEqual((await call(runtime, "list", {}, "b")).threads, []);
    await runtime.dispose();
    runtime = new Miniflare(options);
    const restored = await call(runtime, "list");
    assert.deepEqual(restored.threads, history.threads);
    assert.equal(restored.remaining, 29);
    assert.deepEqual((await call(runtime, "list", {}, "b")).threads, []);
    assert.deepEqual((await call(runtime, "delete", { threadId: sent.threads[0].id })).threads, []);
    assert.equal((await call(runtime, "list")).remaining, 29);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

// agents 0.23.0 stores schema version 11 and JSON application state in these
// rows. 0.31 moves the schema version to cf_agents:schema_version in KV while
// retaining cf_state_row_id. Seed the deployed layout before the new SDK ever
// opens the object; a fresh-then-restart test cannot cover this upgrade path.
const legacySeeder = `import { DurableObject } from "cloudflare:workers";
  export class PersonalAssistant extends DurableObject {
    async seed(state) {
      this.ctx.storage.sql.exec("CREATE TABLE cf_agents_state (id TEXT PRIMARY KEY NOT NULL, state TEXT)");
      this.ctx.storage.sql.exec("INSERT INTO cf_agents_state (id, state) VALUES (?, ?)", "cf_schema_version", "11");
      this.ctx.storage.sql.exec("INSERT INTO cf_agents_state (id, state) VALUES (?, ?)", "cf_state_row_id", JSON.stringify(state));
      this.ctx.storage.sql.exec("CREATE TABLE cf_agents_runs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, snapshot TEXT, created_at INTEGER NOT NULL)");
      return true;
    }
  }
  export default { async fetch(request, env) {
    const payload = await request.json();
    const agent = env.PERSONAL_ASSISTANT.get(env.PERSONAL_ASSISTANT.idFromName(payload.name));
    return Response.json(await agent.seed(payload.state));
  }};`;

test("installed SDK migrates legacy 0.23 state without losing history, quota or identity", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "title-assistant-legacy-"));
  let runtime: InstanceType<typeof Miniflare> | undefined;
  try {
    const script = await bundleService(directory);
    const input: AssistantInput = { action: "send", purpose: "help", screen, requestId: crypto.randomUUID(), question: "Where are my documents?", specialists: ["Product guide"] };
    const legacy = advance({ threads: [], day: "", runs: 0 }, context(), input).state;
    legacy.runs = 7; // Prior deleted questions must still count against the quota.
    legacy.threads[0].turns[0].forks[0] = { ...legacy.threads[0].turns[0].forks[0], status: "Complete", result: answer };
    const otherUser = { threads: [], day: legacy.day, runs: 3 };
    runtime = new Miniflare(runtimeOptions(directory, legacySeeder));
    for (const [userId, state] of [["user-a", legacy], ["user-b", otherUser]]) {
      const response = await runtime.dispatchFetch("https://assistant.synthetic.test/seed", {
        method: "POST", body: JSON.stringify({ name: `${scope.workspaceId}:${userId}`, state }),
      });
      assert.equal(response.status, 200);
      assert.equal(await response.json(), true);
    }
    const oldStorage = await runtime.unsafeGetDurableObjectStorage("assistant-test", "PersonalAssistant", { name: `${scope.workspaceId}:user-a` });
    assert.deepEqual(await oldStorage.exec("SELECT state FROM cf_agents_state WHERE id = 'cf_schema_version'"), [{ state: "11" }]);
    await runtime.dispose();
    runtime = new Miniflare(runtimeOptions(directory, script));
    const migrated = await call(runtime, "list");
    assert.deepEqual(migrated.threads, legacy.threads);
    assert.equal(migrated.remaining, 23);
    assert.equal(migrated.context.userId, "user-a");
    const other = await call(runtime, "list", {}, "b");
    assert.deepEqual(other.threads, []);
    assert.equal(other.remaining, 27);
    const migratedStorage = await runtime.unsafeGetDurableObjectStorage("assistant-test", "PersonalAssistant", { name: `${scope.workspaceId}:user-a` });
    assert.deepEqual(await migratedStorage.exec("SELECT state FROM cf_agents_state WHERE id = 'cf_schema_version'"), []);
    const columns = await migratedStorage.exec("PRAGMA table_info(cf_agents_runs)");
    assert(columns.some((column: { name: string }) => column.name === "completed_at"));
    // A retried pre-upgrade request remains idempotent, with no extra model run.
    const retried = await call(runtime, "send", input as unknown as Record<string, unknown>);
    assert.deepEqual(retried.threads, legacy.threads);
    assert.equal(retried.remaining, 23);
    await runtime.dispose();
    runtime = new Miniflare(runtimeOptions(directory, script));
    assert.deepEqual((await call(runtime, "list")).threads, legacy.threads);
    assert.equal((await call(runtime, "list")).remaining, 23);
    assert.deepEqual((await call(runtime, "delete", { threadId: legacy.threads[0].id })).threads, []);
    assert.equal((await call(runtime, "list")).remaining, 23);
    assert.equal((await call(runtime, "list", {}, "b")).remaining, 27);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
