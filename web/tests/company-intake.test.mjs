import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({ stdin: { contents: "export * from './lib/title/company-intake'; export {createSeed} from './lib/title/model';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, write: false, bundle: true, format: "esm", platform: "node" });
const { buildCompanyFromCandidate, validateCompanyIntake, parseCompanyCandidateResponse, companyIntakeReview, companyProfileMissing, createSeed } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const candidate = (teamId = "team-1", teamName = "Fictional Cedar Title") => ({ organizationId: "org-1", organizationName: "Fictional Family Group", teamId, teamName });
const buildCompany = (source = candidate(), name = source.teamName) => buildCompanyFromCandidate(source, { id: `company-${source.teamId}`, name, importedAt: "2026-09-23T20:00:00.000Z", importedBy: "owner@example.test" });

test("Missive scaffolds preserve names and provenance without inventing company facts", () => {
  const c = buildCompany();
  assert.equal(c.name, "Fictional Cedar Title");
  for (const key of ["contact", "email", "location", "jurisdiction"]) assert.equal(c[key], "");
  assert.deepEqual(c.operatingStates, []); assert.deepEqual(c.members, []); assert.deepEqual(c.steps, Array(7).fill(false));
  assert.equal(c.formationState, undefined); assert.equal(c.stage, "Onboarding");
  assert.deepEqual(c.intake, { ...candidate(), source: "missive", importedAt: "2026-09-23T20:00:00.000Z", importedBy: "owner@example.test", nameUnverified: true, profileStatus: "incomplete" });
  assert.deepEqual(companyProfileMissing(c), ["primary contact", "contact email", "city", "operating state"]);
});

test("intake validation rejects invented actor, invalid timestamps, provider IDs, flags, and properties", () => {
  const intake = buildCompany().intake;
  assert.deepEqual(validateCompanyIntake(intake, "OWNER@example.test"), intake);
  for (const change of [
    { importedBy: "other@example.test" }, { importedAt: "2026-02-30T20:00:00.000Z" }, { organizationId: "../../private" },
    { nameUnverified: "true" }, { profileStatus: "Active" }, { profileStatus: "complete" }, { secret: "do not preserve" }, { teamName: "bad\nname" },
  ]) assert.throws(() => validateCompanyIntake({ ...intake, ...change }, "owner@example.test"));
  assert.throws(() => buildCompany(candidate(), "   "));
  assert.throws(() => buildCompany(candidate(), "x".repeat(101)));
});

test("directory responses are bounded, deduplicated by provider identity, and stripped of extra properties", () => {
  const response = { fetchedAt: "2026-09-23T20:00:00.000Z", candidates: [{ ...candidate(), token: "never-render" }], truncated: true };
  assert.deepEqual(parseCompanyCandidateResponse(response), { fetchedAt: response.fetchedAt, candidates: [candidate()], truncated: true });
  for (const candidates of [[candidate(), candidate()], [null], [{ ...candidate(), teamId: "" }], Array(501).fill(candidate())]) assert.throws(() => parseCompanyCandidateResponse({ ...response, candidates }));
  assert.throws(() => parseCompanyCandidateResponse({ ...response, fetchedAt: "nonsense" }));
});

test("already imported inboxes and equivalent selected company names cannot create duplicates", () => {
  const s = createSeed(); s.companies = [buildCompany()];
  const same = companyIntakeReview(s, [{ candidate: candidate(), name: "Renamed display" }]);
  assert.equal(same.canCreate, false); assert.equal(same.rows[0].existingSource.id, s.companies[0].id);
  s.companies = [];
  const aliases = companyIntakeReview(s, [{ candidate: candidate(), name: "Cedar Title" }, { candidate: candidate("team-2"), name: " Cedar  Title " }]);
  assert.equal(aliases.canCreate, false); assert.equal(aliases.rows[0].aliases.length, 1);
  assert.equal(companyIntakeReview(s, [{ candidate: candidate(), name: "Cedar Title" }, { candidate: candidate("team-2"), name: "Pine Title" }]).canCreate, true);
});

test("acknowledgement fingerprint tracks all names and match reasons, preserving harmless whitespace edits", () => {
  const s = createSeed(); s.companies = [buildCompany(candidate("existing", "Cedar Title LLC"))];
  const chosen = [{ candidate: candidate(), name: "Cedar Title" }];
  const first = companyIntakeReview(s, chosen);
  assert.equal(first.rows[0].matches.length, 1);
  assert.equal(first.signature, companyIntakeReview(s, [{ ...chosen[0], name: " Cedar  Title " }]).signature);
  assert.notEqual(first.signature, companyIntakeReview(s, [{ ...chosen[0], name: "Pine Title" }]).signature);
  s.companies.push(buildCompany(candidate("second", "Cedar Ridge Title")));
  assert.notEqual(first.signature, companyIntakeReview(s, chosen).signature);
});

test("profile readiness checks only confirmed basics and does not imply ownership or onboarding readiness", () => {
  const company = { ...buildCompany(), contact: "Fictional Person", email: "person@example.test", location: "Charlotte", jurisdiction: "NC" };
  assert.deepEqual(companyProfileMissing(company), []);
  assert.deepEqual(company.members, []); assert.equal(company.steps.some(Boolean), false);
  assert.deepEqual(companyProfileMissing({ ...company, email: "wrong", jurisdiction: "" }), ["contact email", "operating state"]);
});
