import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ stdin: { contents: "export * from './lib/title/company-operating-status';export {createSeed} from './lib/title/model';export {buildCompanyFromCandidate} from './lib/title/company-intake';export {companyProblems,getOnboarding,enrichBusiness,recordOnboardingEvidence,validateBusinessMutation} from './lib/title/business';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, write: false, bundle: true, format: "esm", platform: "node", target: "es2022" });
const { buildOperatingConfirmation, companyDisplayStage, validateOperatingConfirmation, createSeed, buildCompanyFromCandidate, companyProblems, getOnboarding, enrichBusiness, recordOnboardingEvidence, validateBusinessMutation } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + "\n//# sourceURL=company-operating-status-test-bundle.mjs").toString("base64")}`);
const stamp = "2026-09-24T12:30:00.000Z";
const confirmation = () => buildOperatingConfirmation("owner@example.test", "Owner confirms this company is already operating.", stamp);
function fixture() {
  const state = createSeed();
  const company = buildCompanyFromCandidate({ organizationId: "fictional-org", organizationName: "Fictional agency", teamId: "fictional-team", teamName: "Fictional Existing Title LLC" }, { id: "existing-company", importedAt: stamp, importedBy: "owner@example.test" });
  state.companies.push(company);
  return { state, company };
}

test("confirmed active business display leaves profile, ownership and evidence incomplete", () => {
  const { state, company } = fixture();
  const before = JSON.stringify(company);
  const problems = companyProblems(state, company, "2026-09-24");
  assert.ok(problems.length > 0);
  const proposed = { ...company, operatingStatus: confirmation() };
  assert.equal(companyDisplayStage(proposed), "Active");
  assert.equal(JSON.stringify(company), before);
  company.operatingStatus = proposed.operatingStatus;
  assert.equal(company.stage, "Onboarding");
  assert.deepEqual(company.steps, Array(7).fill(false));
  assert.deepEqual(company.members, []);
  assert.equal(company.intake.profileStatus, "incomplete");
  assert.equal(company.intake.nameUnverified, true);
  assert.deepEqual(companyProblems(state, company, "2026-09-24"), problems);
  assert.equal(getOnboarding(state, company).launchedAt, "");
  assert.throws(() => recordOnboardingEvidence(state, company.id, { step: 6, reference: "Fictional launch", documentId: "", note: "Existing business" }), /launch checks/);
});

test("operating confirmation cannot bypass the domain launch transition guard", () => {
  const { state, company } = fixture();
  company.operatingStatus = confirmation();
  const after = structuredClone(state);
  after.companies.find(row => row.id === company.id).stage = "Active";
  assert.throws(() => validateBusinessMutation(state, after), /evidence-based launch review/);
});

test("clearing a confirmation restores the underlying workspace stage", () => {
  const { company } = fixture();
  company.operatingStatus = confirmation();
  assert.equal(companyDisplayStage(company), "Active");
  company.operatingStatus = validateOperatingConfirmation(null);
  assert.equal(companyDisplayStage(company), "Onboarding");
  delete company.operatingStatus;
  assert.equal(companyDisplayStage(company), "Onboarding");
  assert.equal(companyDisplayStage({ stage: "Active" }), "Active");
  assert.equal(companyDisplayStage({ stage: "Paused", operatingStatus: null }), "Paused");
});

test("builder returns a bounded normalized copy without mutating supplied metadata", () => {
  const input = { status: "Active", confirmedBy: " Owner@Example.test ", confirmedAt: stamp, note: "  Already operating.\nProfile documents still needed.  " };
  const snapshot = JSON.stringify(input);
  const result = validateOperatingConfirmation(input);
  assert.deepEqual(result, { status: "Active", confirmedBy: "owner@example.test", confirmedAt: stamp, note: "Already operating.\nProfile documents still needed." });
  assert.equal(JSON.stringify(input), snapshot);
  result.note = "Changed returned copy";
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(buildOperatingConfirmation("owner@example.test", "a".repeat(1000), stamp).note.length, 1000);
  assert.match(buildOperatingConfirmation("owner@example.test", "Current confirmation").confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("malformed metadata cannot create an active display and explicit validation rejects it", () => {
  const valid = confirmation();
  const invalid = [undefined, {}, [], "Active", new Date(), { ...valid, status: "active" }, { ...valid, status: "Inactive" },
    { ...valid, confirmedBy: "not-email" }, { ...valid, confirmedBy: "owner@example.test\u0000" }, { ...valid, confirmedBy: "a".repeat(255) + "@example.test" },
    { ...valid, confirmedAt: "2026-02-30T12:30:00.000Z" }, { ...valid, confirmedAt: "2026-09-24" }, { ...valid, confirmedAt: "2026-09-24T12:30:00Z" },
    { ...valid, note: "  " }, { ...valid, note: "a".repeat(1001) }, { ...valid, note: "Bad\u0000text" }, { ...valid, reviewed: true }, { ...valid, confirmedAt: 1 }, { ...valid, note: 1 }];
  for (const value of invalid) {
    assert.throws(() => validateOperatingConfirmation(value));
    assert.equal(companyDisplayStage({ stage: "Onboarding", operatingStatus: value }), "Onboarding");
  }
});

test("profile and ownership edits retain operating confirmation while reopening readiness", () => {
  const { state, company } = fixture();
  company.operatingStatus = confirmation();
  const baseline = structuredClone(state);
  company.name = "Confirmed Fictional Existing Title LLC";
  company.contact = "Fictional Contact";
  company.email = "contact@example.test";
  company.jurisdiction = "NC";
  company.operatingStates = ["NC"];
  company.members = [{ name: "Fictional Member", share: 100 }];
  validateBusinessMutation(baseline, state);
  enrichBusiness(state);
  assert.deepEqual(company.operatingStatus, confirmation());
  assert.equal(companyDisplayStage(company), "Active");
  assert.equal(company.stage, "Onboarding");
  assert.equal(getOnboarding(state, company).launchedAt, "");
  assert.ok(companyProblems(state, company, "2026-09-24").length > 0);
});
