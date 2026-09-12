/** Explicit opt-in integration tests. Uses isolated synthetic workspaces and no outbound email. */
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { build } from "esbuild";
const url = process.env.TITLE_TEST_SUPABASE_URL;
if (
  !url ||
  !process.env.TITLE_TEST_KEY_FILE ||
  !process.env.TITLE_TEST_ARTIFACT_DIR
)
  throw Error(
    "Set the explicit test project, secret-key file, and ignored artifact directory.",
  );
const key = (await readFile(process.env.TITLE_TEST_KEY_FILE, "utf8")).trim();
const publicKey = process.env.TITLE_TEST_PUBLIC_KEY;
const artifact = process.env.TITLE_TEST_ARTIFACT_DIR;
await mkdir(artifact, { recursive: true });
const service = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const checked = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
await build({
  entryPoints: ["lib/backend/workspace.ts"],
  outfile: artifact + "/workspace.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
});
const { emptyWorkspace } = await import(artifact + "/workspace.mjs");
const rawFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) =>
  rawFetch(u, { ...o, signal: o.signal || AbortSignal.timeout(30000) });
const runId = crypto.randomUUID(),
  manifest = {
    runId,
    url,
    users: [],
    workspaces: [],
    objects: [],
    results: [],
  };
const save = () =>
  writeFile(artifact + "/manifest.json", JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
const accounts = {};
const roles = ["owner", "operations", "viewer", "outsider", "admin"];
async function api(
  who,
  path,
  data,
  method = data === undefined ? "GET" : "POST",
  wid,
) {
  const qs = method === "GET" && wid ? "?workspaceId=" + wid : "";
  const r = await fetch(url + "/functions/v1/title-api" + path + qs, {
    method,
    headers: {
      apikey: publicKey,
      Authorization: "Bearer " + accounts[who].token,
      "Content-Type": "application/json",
    },
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({ ...data, ...(wid ? { workspaceId: wid } : {}) }),
  });
  const body = await r.json();
  if (process.env.TITLE_TEST_VERBOSE)
    console.log(who, method, path, r.status, body.error || "");
  return { status: r.status, body };
}
const edit = (table, id, value, insert = false) => ({
  id: crypto.randomUUID(),
  name: "editDraft",
  args: [[{ table, id, value, insert }]],
});
const company = (id) => ({
  id,
  name: "QA " + id,
  contact: "QA Contact",
  email: "qa@example.com",
  jurisdiction: "NC",
});
let current;
async function send(commands, who = "owner", more = {}) {
  const result = await api(
    who,
    "/commands",
    {
      expectedRevision: current.revision,
      requestId: crypto.randomUUID(),
      commands,
      ...more,
    },
    "POST",
    current.workspaceId,
  );
  if (result.status === 200) current = result.body;
  return result;
}
async function upload(wid) {
  const form = new FormData();
  form.set("workspaceId", wid);
  form.set("id", "asset-qa");
  form.set("companyId", "QA-A");
  form.set("documentId", "doc-qa");
  form.set(
    "file",
    new File(["Synthetic title backend storage verification"], "qa.txt", {
      type: "text/plain",
    }),
  );
  return fetch(url + "/functions/v1/title-api/assets/upload", {
    method: "POST",
    headers: {
      apikey: publicKey,
      Authorization: "Bearer " + accounts.owner.token,
    },
    body: form,
  });
}
async function download(who, wid) {
  return fetch(
    url +
      "/functions/v1/title-api/assets/download?workspaceId=" +
      wid +
      "&id=asset-qa",
    {
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + accounts[who].token,
      },
    },
  );
}
try {
  if (process.env.TITLE_TEST_REUSE_ACCOUNTS) {
    Object.assign(
      accounts,
      JSON.parse(await readFile(artifact + "/accounts.json", "utf8")),
    );
    manifest.users = Object.values(accounts).map((a) => a.id);
  } else
    for (const role of roles) {
      const email = `title-qa-${runId.slice(0, 8)}-${role}@example.com`,
        password = crypto.randomUUID() + "Aa!";
      const user = checked(
        await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        }),
      ).user;
      manifest.users.push(user.id);
      await save();
      const client = createClient(url, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const auth = checked(
        await client.auth.signInWithPassword({ email, password }),
      );
      accounts[role] = {
        id: user.id,
        email,
        password,
        token: auth.session.access_token,
      };
    }
  await writeFile(artifact + "/accounts.json", JSON.stringify(accounts), {
    mode: 0o600,
  });
  assert.equal((await api("outsider", "/session")).status, 200);
  for (
    let round = 1;
    round <= Number(process.env.TITLE_TEST_ROUNDS || 5);
    round++
  ) {
    const started = Date.now();
    const wid = crypto.randomUUID();
    manifest.workspaces.push(wid);
    await save();
    checked(
      await service
        .from("title_workspaces")
        .insert({
          id: wid,
          name: `QA ${runId} round ${round}`,
          state: emptyWorkspace(),
        }),
    );
    checked(
      await service
        .from("title_memberships")
        .insert(
          roles
            .filter((r) => r !== "outsider")
            .map((role) => ({
              workspace_id: wid,
              user_id: accounts[role].id,
              role,
              all_companies: role === "owner",
              restricted_access: role === "owner",
              company_ids: ["QA-A"],
            })),
        ),
    );
    let r = await api("owner", "/state", undefined, "GET", wid);
    assert.equal(r.status, 200, JSON.stringify(r));
    current = r.body;
    assert.equal(
      (
        await send([
          edit("companies", "QA-A", company("QA-A"), true),
          edit("companies", "QA-B", company("QA-B"), true),
        ])
      ).status,
      200,
    );
    assert.equal(
      (
        await send([
          edit(
            "orders",
            "QA-ORDER",
            {
              companyId: "QA-A",
              address: "Synthetic QA Property",
              client: "QA Client",
              jurisdiction: "NC",
              premium: 250,
              due: "2026-09-30",
            },
            true,
          ),
        ])
      ).status,
      200,
    );
    assert.equal(current.state.orders[0].premium, 250);
    assert.equal(
      (await api("outsider", "/state", undefined, "GET", wid)).status,
      403,
    );
    assert.equal(
      (await api("viewer", "/state", undefined, "GET", wid)).body.state
        .companies.length,
      1,
    );
    assert.equal(
      (
        await send(
          [edit("orders", "QA-ORDER", { notes: "Forbidden" })],
          "viewer",
        )
      ).status,
      403,
    );
    assert.equal(
      (await api("admin", "/members", undefined, "GET", wid)).status,
      403,
    );
    assert.equal(
      (await send([edit("orders", "QA-ORDER", { status: "Issued" })])).status,
      400,
    );
    const anonymous = await fetch(url + "/rest/v1/title_workspaces?select=*", {
      headers: { apikey: publicKey },
    });
    assert([401, 403].includes(anonymous.status));
    const direct = await fetch(url + "/rest/v1/title_workspaces?select=*", {
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + accounts.owner.token,
      },
    });
    assert([401, 403].includes(direct.status));
    const rpc = await fetch(url + "/rest/v1/rpc/title_commit", {
      method: "POST",
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + accounts.owner.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert([401, 403, 404].includes(rpc.status));
    const same = {
      expectedRevision: current.revision,
      requestId: crypto.randomUUID(),
      commands: [edit("orders", "QA-ORDER", { notes: "Exactly once" })],
    };
    r = await api("owner", "/commands", same, "POST", wid);
    assert.equal(r.status, 200, JSON.stringify(r));
    current = r.body;
    const version = current.revision;
    r = await api("owner", "/commands", same, "POST", wid);
    assert.equal(r.status, 200);
    assert.equal(r.body.revision, version);
    assert.equal(r.body.replayed, true);
    assert.equal(
      (
        await api(
          "owner",
          "/commands",
          {
            ...same,
            commands: [
              edit("orders", "QA-ORDER", { notes: "Different payload" }),
            ],
          },
          "POST",
          wid,
        )
      ).status,
      409,
    );
    const concurrent = await Promise.all(
      ["Left", "Right"].map((notes) =>
        api(
          "owner",
          "/commands",
          {
            expectedRevision: current.revision,
            requestId: crypto.randomUUID(),
            commands: [edit("orders", "QA-ORDER", { notes })],
          },
          "POST",
          wid,
        ),
      ),
    );
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    current = concurrent.find((r) => r.status === 200).body;
    r = await upload(wid);
    assert.equal(r.status, 200, await r.text());
    const asset = checked(
      await service
        .from("title_assets")
        .select("object_path")
        .eq("workspace_id", wid)
        .single(),
    );
    manifest.objects.push(asset.object_path);
    await save();
    assert.equal(
      (
        await send([
          edit(
            "documents",
            "doc-qa",
            {
              companyId: "QA-A",
              name: "qa.txt",
              category: "Other",
              visibility: "Internal",
              size: "43 B",
              assetId: "asset-qa",
              mime: "text/plain",
            },
            true,
          ),
        ])
      ).status,
      200,
    );
    let file = await download("viewer", wid);
    assert.equal(file.status, 200);
    assert.equal(
      await file.text(),
      "Synthetic title backend storage verification",
    );
    const publicFile = await fetch(
      url + "/storage/v1/object/public/title-documents/" + asset.object_path,
    );
    assert.notEqual(publicFile.status, 200);
    assert.equal(
      (await send([edit("documents", "doc-qa", { visibility: "Restricted" })]))
        .status,
      200,
    );
    assert.equal((await download("viewer", wid)).status, 403);
    assert.equal(
      (await api("viewer", "/state", undefined, "GET", wid)).body.state
        .documents.length,
      0,
    );
    assert.equal(
      (await send([edit("documents", "doc-qa", { visibility: "Internal" })]))
        .status,
      200,
    );
    const snapshot = await api("owner", "/backups", {}, "POST", wid);
    assert.equal(snapshot.status, 200, JSON.stringify(snapshot));
    const oldNote = current.state.orders[0].notes;
    assert.equal(
      (
        await send([
          edit("orders", "QA-ORDER", { notes: "After recovery point" }),
        ])
      ).status,
      200,
    );
    r = await api(
      "owner",
      "/backups/restore",
      { backupId: snapshot.body.id, expectedRevision: current.revision },
      "POST",
      wid,
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    current = r.body;
    assert.equal(current.state.orders[0].notes, oldNote);
    assert.equal((await download("owner", wid)).status, 200);
    assert.equal(
      (
        await api(
          "owner",
          "/members/revoke",
          { userId: accounts.operations.id },
          "POST",
          wid,
        )
      ).status,
      200,
    );
    assert.equal(
      (await api("operations", "/state", undefined, "GET", wid)).status,
      403,
    );
    r = await api(
      "owner",
      "/members/invite",
      {
        email: accounts.operations.email,
        role: "operations",
        companyIds: ["QA-A"],
        allCompanies: false,
        restricted: false,
      },
      "POST",
      wid,
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await api("operations", "/session")).status, 200);
    assert.equal(
      (await api("operations", "/state", undefined, "GET", wid)).status,
      200,
    );
    const counts = checked(
      await service.from("title_audit").select("id").eq("workspace_id", wid),
    );
    assert(counts.length > 5);
    manifest.results.push({
      round,
      passed: true,
      elapsedMs: Date.now() - started,
      revision: current.revision,
      auditEvents: counts.length,
    });
    await save();
    console.log(
      `Cloud round ${round}: PASS — auth, scope, denied direct access, commands, concurrency, idempotency, private files, recovery and re-invitation (${Math.round((Date.now() - started) / 1000)}s)`,
    );
  }
  if(process.env.TITLE_TEST_BOOTSTRAP==='1'){
    const prior=checked(await service.from('title_bootstrap').select('*').maybeSingle());
    if(prior)throw Error('Bootstrap testing requires an unconfigured project; existing owner configuration was left untouched.');
    checked(await service.from('title_bootstrap').insert({owner_email:accounts.owner.email}));
    const outsider=await api('outsider','/session');assert.equal(outsider.status,200);
    assert.equal(checked(await service.from('title_bootstrap').select('consumed_at').single()).consumed_at,null);
    assert.equal((await api('owner','/session')).status,200);
    const bootstrap=checked(await service.from('title_bootstrap').select('*').single());assert(bootstrap.consumed_at);manifest.bootstrapWorkspace=bootstrap.workspace_id;manifest.workspaces.push(bootstrap.workspace_id);await save();
    checked(await service.from('title_workspaces').update({name:`QA ${runId} bootstrap`}).eq('id',bootstrap.workspace_id));
    assert.equal((await api('owner','/state',undefined,'GET',bootstrap.workspace_id)).body.state.companies.length,0);
    assert.equal((await api('owner','/session')).status,200);
    assert.equal(checked(await service.from('title_bootstrap').select('workspace_id').single()).workspace_id,bootstrap.workspace_id);
    manifest.bootstrapPassed=true;await save();console.log('Verified-email owner bootstrap: PASS — outsider denied, empty workspace, one-time claim.');
  }
  console.log(
    "Fixtures saved for browser verification and targeted cleanup. No email sent.",
  );
} catch (e) {
  await save();
  console.error(e.stack);
  process.exitCode = 1;
}
