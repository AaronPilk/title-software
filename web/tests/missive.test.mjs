import test from "node:test";
import assert from "node:assert/strict";
import { missiveSetup, checkMissiveConnection } from "../.local-test/missive/api.mjs";

const config = { token: "missive_pat-TEST-ONLY", workspaceId: "workspace-A" };
const owner = { role: "owner", allCompanies: true };
const organization = { id: "org-1", name: "Test Title" };
const team = { id: "team-1", name: "Finals", organization: "org-1", team_inbox_enabled: true };
const json = value => new Response(JSON.stringify(value));
const stub = async url => json(url.includes("/organizations?")
  ? { organizations: [organization] } : { teams: [team] });
test("disallowed roles cannot inspect connection setup or issue vendor requests", async () => {
  for (const access of [
    { role: "viewer", allCompanies: true }, { role: "partner", allCompanies: true },
    { role: "operations", allCompanies: true }, { role: "finance", allCompanies: true },
    { role: "admin", allCompanies: false },
  ]) {
    assert.throws(() => missiveSetup(config, "workspace-A", access), error => error.status === 403);
    await assert.rejects(checkMissiveConnection(config, "workspace-A", access, () => assert.fail("vendor called")), error => error.status === 403);
  }
});
test("global token is bound to exactly one workspace and setup hides its presence elsewhere", async () => {
  for (const candidate of [config, { workspaceId: "workspace-A" }, {}]) {
    assert.deepEqual(missiveSetup(candidate, "workspace-B", owner), { status: "workspace_required", importEnabled: false });
    await assert.rejects(checkMissiveConnection(candidate, "workspace-B", owner, () => assert.fail("vendor called")), error => error.status === 409);
  }
  assert.equal(missiveSetup({workspaceId: "workspace-A"}, "workspace-A", owner).status, "token_required");
});
test("valid check uses fixed GET destinations with redirects disabled and returns only safe metadata", async () => {
  const calls = [];
  const check = await checkMissiveConnection(config, "workspace-A", {role: "admin", allCompanies: true}, async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    assert.ok(options.signal); assert.equal(options.body, undefined);
    return json(url.includes("/organizations?")
      ? {organizations: [{...organization, token: "HIDDEN"}], extra: "HIDDEN"}
      : {teams: [{...team, active_members: ["HIDDEN"], observers: ["HIDDEN"]}, {...team, id: "chat", team_inbox_enabled: false}]});
  });
  assert.deepEqual(calls, ["https://public.missiveapp.com/v1/organizations?limit=200&offset=0", "https://public.missiveapp.com/v1/teams?limit=200&offset=0"]);
  assert.deepEqual(check.teamInboxes, [{id: "team-1", name: "Finals", organizationId: "org-1"}]);
  assert.deepEqual(check.organizations, [organization]);
  assert.equal(check.importEnabled, false); assert.equal(check.status, "verified");
  assert.ok(!JSON.stringify(check).includes("HIDDEN")); assert.ok(!JSON.stringify(check).includes(config.token));
});
test("empty successful directory is valid and complete; full page is explicitly incomplete", async () => {
  const empty = await checkMissiveConnection(config, "workspace-A", owner, async url => json(url.includes("/organizations?") ? {organizations: []} : {teams: []}));
  assert.equal(empty.status, "verified"); assert.deepEqual(empty.teamInboxes, []); assert.equal(empty.moreTeams, false);
  const full = await checkMissiveConnection(config, "workspace-A", owner, async url => json(url.includes("/organizations?") ? {organizations: Array(200).fill(organization)} : {teams: Array(200).fill(team)}));
  assert.equal(full.moreTeams, true); assert.equal(full.moreOrganizations, true);
});
test("vendor errors are sanitized and never log or echo the secret", async () => {
  for (const status of [301, 401, 403, 500]) {
    let calls = 0;
    await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async () => {
      calls++; return new Response(config.token, {status});
    }), error => error.status === 502 && !error.message.includes(config.token));
    assert.equal(calls, 1);
  }
});
test("rate limits honor vendor retry seconds without automatically retrying", async () => {
  let calls = 0;
  await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async () => {
    calls++; return new Response("private error", {status: 429, headers: {"Retry-After": "900"}});
  }), error => error.status === 429 && error.message.includes("15 minutes"));
  assert.equal(calls, 1);
});
test("malformed or excessive responses are rejected", async () => {
  for (const value of [null, {}, {organizations: {}}, {organizations: [null]}, {organizations: [{id: "x"}]}, {organizations: Array(201).fill(organization)}])
    await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async () => json(value)), error => error.status === 502);
  await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async () => new Response("bad json")), error => error.status === 502);
  await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async () => new Response("x".repeat(1_000_001))), error => error.status === 502);
  await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async url => url.includes("/organizations?") ? json({organizations: [organization]}) : json({teams: [{...team, team_inbox_enabled: "yes"}]})), error => error.status === 502);
});
test("network exceptions and invalid token formatting do not expose secrets", async () => {
  await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async () => { throw new Error(config.token); }), error => error.status === 502 && !error.message.includes(config.token));
  await assert.rejects(checkMissiveConnection({...config, token: "x\ny"}, "workspace-A", owner, () => assert.fail("vendor called")), error => error.status === 409);
});
test("second metadata request failure cannot produce a partial success", async () => {
  let count = 0;
  await assert.rejects(checkMissiveConnection(config, "workspace-A", owner, async url => {
    count++; return count === 1 ? stub(url) : new Response("unavailable", {status: 503});
  }), error => error.status === 502);
  assert.equal(count, 2);
});
