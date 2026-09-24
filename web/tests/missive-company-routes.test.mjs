import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ stdin: { contents: "export {proposeMissiveCompanyRoutes} from './lib/backend/missive-company-routes';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, write: false, bundle: true, format: "esm", platform: "node", target: "es2022" });
const { proposeMissiveCompanyRoutes } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + "\n//# sourceURL=missive-company-routes-test-bundle.mjs").toString("base64")}`);
const company = (id = "A", teamId = "team-A", changes = {}) => ({ id, name: `Company ${id}`, intake: {
  source: "missive", organizationId: "org", organizationName: "Original organization", teamId, teamName: "Original inbox name",
  importedAt: "2026-09-23T12:00:00.000Z", importedBy: "owner@example.test", nameUnverified: true, profileStatus: "incomplete",
}, ...changes });
const team = (id = "team-A", changes = {}) => ({ id, organizationId: "org", name: `Current ${id}`, ...changes });
const routing = { schemaVersion: 2, revision: 3, mappings: [] };
const directory = { status: "verified", checkedAt: "2026-09-24T12:00:00.000Z", importEnabled: true, organizations: [{ id: "org", name: "Current organization" }], teamInboxes: [team(), team("team-B")], moreOrganizations: false, moreTeams: false };
const route = (companyId = "A", teamId = "team-A", changes = {}) => ({ id: `route:org:${teamId}:${companyId}`, organizationId: "org", teamId, companyId,
  teamName: "Older name", version: 2, enabled: true, approvedAt: "2026-09-23", approvedBy: "owner@example.test", ...changes });
const propose = (companies = [company()], config = routing, verified = directory) => proposeMissiveCompanyRoutes({ companies }, config, verified);

test("proposals use exact saved inbox IDs, current company names and verified directory team names", async () => {
  const result = await propose();
  assert.deepEqual(result.proposals, [{ companyId: "A", companyName: "Company A", organizationId: "org", teamId: "team-A", teamName: "Current team-A" }]);
  assert.equal(result.revision, 3); assert.equal(result.skippedCount, 0);
  assert.equal(result.fingerprint, createHash("sha256").update(JSON.stringify({ revision: 3, proposals: result.proposals })).digest("hex"));
  assert.ok(!JSON.stringify(result).includes("importedBy")); assert.ok(!JSON.stringify(result).includes("approvedBy"));
});

test("inbox name similarity never substitutes for exact saved source identities", async () => {
  const byName = company("A", "missing", { name: "Current team-A" });
  const otherOrg = company("C"); otherOrg.intake.organizationId = "other";
  const result = await propose([byName, company("B", "missing-B"), { id: "manual", name: "Current team-A" }, otherOrg]);
  assert.deepEqual(result.proposals, []); assert.equal(result.skippedCount, 4);
});

test("duplicate company sources cannot propose a shared inbox, even under conflicting organization IDs", async () => {
  for (const otherOrg of [false, true]) {
    const second = company("B", "team-A"); if (otherOrg) second.intake.organizationId = "other";
    const result = await propose([company(), second]);
    assert.deepEqual(result.proposals, []); assert.equal(result.skippedCount, 2);
  }
});

test("enabled routes are skipped and paused same-company routes require fresh explicit review", async () => {
  assert.equal((await propose([company()], { ...routing, mappings: [route()] })).proposals.length, 0);
  const review = await propose([company()], { ...routing, mappings: [route("A", "team-A", { enabled: false })] });
  assert.equal(review.proposals.length, 1); assert.equal(review.proposals[0].teamName, "Current team-A");
});

test("another configured company prevents a proposal even if its route is paused or its company was removed", async () => {
  for (const enabled of [true, false]) {
    const result = await propose([company()], { ...routing, mappings: [route("B", "team-A", { enabled })] });
    assert.deepEqual(result.proposals, []); assert.equal(result.skippedCount, 1);
  }
  const result = await propose([company()], { ...routing, mappings: [route("A", "team-A", { id: "route:other:team-A:A", organizationId: "other", enabled: false })] });
  assert.deepEqual(result.proposals, []);
});

test("canonical review is stable across source order and changing timestamps but changes with every reviewed identity or label", async () => {
  const companies = [company("B", "team-B"), company()];
  const first = await propose(companies);
  const reordered = await propose([...companies].reverse(), routing, { ...directory, checkedAt: "2026-09-24T13:00:00.000Z", teamInboxes: [...directory.teamInboxes].reverse() });
  assert.deepEqual(first.proposals.map(row => row.companyId), ["A", "B"]); assert.equal(first.fingerprint, reordered.fingerprint);
  assert.notEqual(first.fingerprint, (await propose(companies, { ...routing, revision: 4 })).fingerprint);
  assert.notEqual(first.fingerprint, (await propose([{ ...companies[0], name: "Renamed company" }, companies[1]])).fingerprint);
  assert.notEqual(first.fingerprint, (await propose(companies, routing, { ...directory, teamInboxes: [team("team-A", { name: "Renamed inbox" }), team("team-B")] })).fingerprint);
  assert.notEqual(first.fingerprint, (await propose([companies[0]])).fingerprint);
});

test("missing directory matches are skipped without touching already configured independent inboxes", async () => {
  const result = await propose([company(), company("B", "missing"), { id: "manual", name: "Manual" }], { ...routing, mappings: [route("B", "unrelated")] });
  assert.equal(result.proposals.length, 1); assert.equal(result.skippedCount, 2);
});

test("malformed provenance fails the complete proposal rather than hiding a conflicting company", async () => {
  for (const changes of [{ organizationId: "../org" }, { teamId: "bad/id" }, { source: "guessed" }, { importedBy: "invalid" },
    { importedAt: "2026-02-30T12:00:00.000Z" }, { profileStatus: "complete" }, { teamName: "bad\nname" }, { secret: "PRIVATE" }]) {
    const bad = company("B", "team-B"); Object.assign(bad.intake, changes);
    await assert.rejects(propose([company(), bad]), error => error.status === 409 && !error.message.includes("PRIVATE"));
  }
  for (const intake of [null, [], false, "invalid"]) await assert.rejects(propose([company("A", "team-A", { intake })]), error => error.status === 409);
});

test("malformed or duplicated company identities and invalid routing fail closed", async () => {
  for (const companies of [[company(), company()], [null], [company("bad/id")], [company("A", "team-A", { name: "" })], Array.from({ length: 5001 }, (_, index) => ({ id: `c-${index}` }))])
    await assert.rejects(propose(companies), error => error.status === 409);
  await assert.rejects(propose([company()], { ...routing, mappings: [route(), route()] }), error => error.status === 409);
});

test("only complete verified directory responses with unique teams and valid organization links are accepted", async () => {
  for (const changes of [{ status: "unchecked" }, { importEnabled: false }, { checkedAt: "invalid" }, { moreTeams: undefined },
    { organizations: [directory.organizations[0], directory.organizations[0]] }, { teamInboxes: [team(), team()] },
    { teamInboxes: [team(), team("team-A", { organizationId: "other" })] }, { teamInboxes: [team("team-A", { organizationId: "missing" })] },
    { teamInboxes: [team("bad/id")] }, { teamInboxes: [team("team-A", { name: "bad\nname" })] }, { teamInboxes: [null] },
    { organizations: Array.from({ length: 201 }, (_, index) => ({ id: `org-${index}`, name: "Organization" })) }])
    await assert.rejects(propose([company()], routing, { ...directory, ...changes }), error => error.status === 502);
  for (const changes of [{ moreTeams: true }, { moreOrganizations: true }])
    await assert.rejects(propose([company()], routing, { ...directory, ...changes }), error => error.status === 409);
});

test("empty review has a stable fingerprint and no provider or state mutations", async () => {
  const state = { companies: [company()] }, config = structuredClone(routing), verified = structuredClone(directory);
  const before = JSON.stringify({ state, config, verified });
  await proposeMissiveCompanyRoutes(state, config, verified);
  assert.equal(JSON.stringify({ state, config, verified }), before);
  const empty = await propose([]);
  assert.deepEqual(empty.proposals, []); assert.equal(empty.skippedCount, 0); assert.match(empty.fingerprint, /^[a-f0-9]{64}$/);
});
