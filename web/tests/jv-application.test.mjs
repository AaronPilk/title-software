import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({ stdin: { contents: "export * from './lib/title/jv-application';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, write: false, bundle: true, format: "esm", platform: "node" });
const { JV_STEPS, newJVApplicant, newJVApplication, validateJVApplication, jvReadiness, jvIntakeFingerprint } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const today = "2026-09-24";
const residence = (id, from, to = "") => ({ id, from, to, address: "101 Fictional Example Lane" });
const employment = (id, from, to = "") => ({ id, from, to, employer: "Fictional Example Company", role: "Example role", address: "202 Fictional Example Road" });
const ready = () => {
  const app = newJVApplication();
  Object.assign(app.applicants[0], {
    id: "fictional-applicant", name: "Fictional Example", email: "fictional@example.test", phone: "202-555-0100", dob: "1988-02-29",
    ssn: "123456789", driverLicense: "FICTIONAL-ONLY", currentAddress: "101 Fictional Example Lane", ownershipType: "individual",
    residenceHistory: [residence("residence-1", "2021-09-24")], employmentHistory: [employment("employment-1", "2021-09-24")],
  });
  return app;
};
const hasHistoryProblem = (app, kind, date = today) => jvReadiness(app, date).some(message => message.includes(`${kind} history covering`));

test("new intake provides independent blank applicants and all source checklist deliverables", () => {
  const first = newJVApplication(), second = newJVApplication();
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.applicants.length, 1);
  assert.equal(first.applicants[0].ownershipType, "undecided");
  assert.equal(first.applicants[0].businessStatus, "not-applicable");
  assert.notEqual(first.applicants[0].id, second.applicants[0].id);
  assert.deepEqual(first.steps.map(row => row.id), ["partnership-agreement", "domain", "secretary-of-state", "federal-tax-id", "bank-account", "nipr", "sc-insurance", "nc-insurance", "underwriters", "softpro", "website", "email", "business-cards", "accounting", "logo", "aba", "buyer-title-preference"]);
  assert.ok(first.steps.every(row => row.status === "Not started"));
  assert.deepEqual(validateJVApplication(first), first);
  first.steps[0].note = "Changed only one application";
  assert.equal(second.steps[0].note, "");
  assert.equal(newJVApplicant("custom-id").id, "custom-id");
  assert.throws(() => newJVApplicant(""));
});

test("drafts retain blanks but readiness requires original identity, contact, ownership, and full histories", () => {
  const app = newJVApplication();
  const messages = jvReadiness(app, today);
  for (const field of ["name", "email", "phone", "date of birth", "SSN", "driver's license", "current address", "individual or business", "residence history", "employment history"]) assert.ok(messages.some(message => message.includes(field)), field);
  assert.ok(messages.every(message => !message.includes(app.applicants[0].id)));
  app.applicants = [];
  assert.deepEqual(validateJVApplication(app), app);
  assert.deepEqual(jvReadiness(app, today), ["Add at least one applicant."]);
  assert.deepEqual(jvReadiness(ready(), today), []);
  const input = ready();
  const output = validateJVApplication(input);
  output.applicants[0].residenceHistory[0].address = "Another fictional address";
  assert.notEqual(output.applicants[0].residenceHistory[0].address, input.applicants[0].residenceHistory[0].address);
});

test("validation rejects audit injection and unsupported fields at every nesting level without echoing private values", () => {
  const marker = "PRIVATE-CONTENT-MUST-NOT-LEAK";
  for (const mutate of [
    app => { app.reviewedBy = marker; },
    app => { app.applicants[0].reviewedAt = marker; },
    app => { app.applicants[0].residenceHistory[0].extra = marker; },
    app => { app.applicants[0].employmentHistory[0].extra = marker; },
    app => { app.steps[0].completedBy = marker; },
    app => { app.schemaVersion = 2; },
    app => { app.applicants[0].email = marker; },
    app => { app.applicants[0].ssn = marker; },
    app => { delete app.notes; },
    app => { app[Symbol("secret")] = marker; },
    app => { Object.defineProperty(app, "notes", { enumerable: true, get() { throw new Error(marker); } }); },
  ]) {
    const app = ready(); mutate(app);
    assert.throws(() => validateJVApplication(app), error => error instanceof Error && !error.message.includes(marker));
    assert.ok(jvReadiness(app, today).every(message => !message.includes(marker)));
  }
  assert.throws(() => validateJVApplication(Object.assign(Object.create({ ignored: true }), ready())));
  assert.throws(() => validateJVApplication(null));
  assert.throws(() => validateJVApplication([]));
});

test("identity and dates are normalized and validated even on drafts", () => {
  const app = ready(); app.applicants[0].ssn = " 123-45-6789 ";
  assert.equal(validateJVApplication(app).applicants[0].ssn, "123456789");
  app.applicants[0].ssn = "123 45 6789";
  assert.equal(validateJVApplication(app).applicants[0].ssn, "123456789");
  for (const ssn of ["12345678", "1234567890", "000456789", "666456789", "900456789", "123006789", "123450000", "abc123456789", "---", "123.45.6789"]) {
    const invalid = ready(); invalid.applicants[0].ssn = ssn; assert.throws(() => validateJVApplication(invalid), ssn);
  }
  for (const dob of ["2025-02-29", "2024-02-30", "0000-01-01", "2026-13-01", "2100-01-01", "09/24/2000"]) {
    const invalid = ready(); invalid.applicants[0].dob = dob; assert.throws(() => validateJVApplication(invalid), dob);
  }
  for (const email of ["missing-at.example.test", "x@", "x@no-dot", "x y@example.test"]) {
    const invalid = ready(); invalid.applicants[0].email = email; assert.throws(() => validateJVApplication(invalid));
  }
  for (const mutate of [
    app => { app.applicants[0].residenceHistory[0].from = "2025-02-29"; },
    app => { app.applicants[0].employmentHistory[0].to = "invalid"; },
    app => { app.applicants[0].residenceHistory[0].to = "2020-01-01"; },
    app => { app.steps[0].dueDate = "2026-02-30"; },
    app => { app.applicants[0].name = "unsafe\u0000name"; },
  ]) { const invalid = ready(); mutate(invalid); assert.throws(() => validateJVApplication(invalid)); }
});

test("collections enforce all limits, supported enums, known steps, and unique IDs", () => {
  for (const mutate of [
    app => { app.applicants = Array.from({ length: 21 }, (_, index) => newJVApplicant(`applicant-${index}`)); },
    app => { app.applicants.push(structuredClone(app.applicants[0])); },
    app => { app.applicants[0].residenceHistory = Array.from({ length: 41 }, (_, index) => residence(`residence-${index}`, "2021-09-24")); },
    app => { app.applicants[0].employmentHistory = Array.from({ length: 41 }, (_, index) => employment(`employment-${index}`, "2021-09-24")); },
    app => { app.applicants[0].residenceHistory.push(structuredClone(app.applicants[0].residenceHistory[0])); },
    app => { app.applicants[0].employmentHistory.push(structuredClone(app.applicants[0].employmentHistory[0])); },
    app => { app.sourceDocumentIds = ["doc-1", "doc-1"]; },
    app => { app.sourceDocumentIds = Array.from({ length: 101 }, (_, index) => `doc-${index}`); },
    app => { app.steps[0].id = "unsupported"; },
    app => { app.steps[1].id = app.steps[0].id; },
    app => { app.steps.pop(); },
    app => { app.steps[0].status = "Approved"; },
    app => { app.applicants[0].ownershipType = "Corporation"; },
    app => { app.applicants[0].businessStatus = "approved"; },
    app => { app.applicants[0].name = "x".repeat(201); },
    app => { app.applicants[0].currentAddress = "x".repeat(1001); },
    app => { app.notes = "x".repeat(10001); },
    app => { app.sourceDocumentIds = ["../other-company"]; },
    app => { app.applicants = Array(1); },
  ]) { const invalid = ready(); mutate(invalid); assert.throws(() => validateJVApplication(invalid)); }
  const twenty = newJVApplication(); twenty.applicants = Array.from({ length: 20 }, (_, index) => newJVApplicant(`applicant-${index}`));
  assert.equal(validateJVApplication(twenty).applicants.length, 20);
  const forty = ready(); forty.applicants[0].residenceHistory = Array.from({ length: 40 }, (_, index) => residence(`residence-${index}`, "2021-09-24"));
  assert.equal(validateJVApplication(forty).applicants[0].residenceHistory.length, 40);
  const reversed = ready(); reversed.steps.reverse();
  assert.deepEqual(validateJVApplication(reversed).steps.map(row => row.id), JV_STEPS.map(row => row.id));
});

test("serialized UTF-8 limits count multibyte strings and do not allow whitespace normalization to bypass bounds", () => {
  const app = ready();
  for (const row of app.steps) row.note = "\u754c".repeat(2_000);
  assert.ok(JSON.stringify(app).length < 100_000);
  assert.ok(Buffer.byteLength(JSON.stringify(app), "utf8") > 100_000);
  assert.throws(() => validateJVApplication(app));
  for (const row of app.steps) { row.note = " ".repeat(4_000); row.reference = " ".repeat(2_000); }
  assert.throws(() => validateJVApplication(app));
});

test("five-year coverage merges overlaps, nesting, same-day joins, and adjacent inclusive days", () => {
  for (const periods of [
    [["2020-01-01", "2024-06-30"], ["2024-01-01", ""]],
    [["2024-07-01", ""], ["2021-09-24", "2024-06-30"]],
    [["2021-09-24", "2024-07-01"], ["2024-07-01", ""]],
    [["2021-09-24", ""], ["2023-01-01", "2023-01-02"]],
    [["2021-09-24", "2023-01-01"], ["2022-01-01", "2022-02-01"], ["2022-12-01", ""]],
  ]) {
    const app = ready();
    app.applicants[0].residenceHistory = periods.map(([from, to], index) => residence(`residence-${index}`, from, to));
    app.applicants[0].employmentHistory = periods.map(([from, to], index) => employment(`employment-${index}`, from, to));
    assert.deepEqual(jvReadiness(app, today), [], JSON.stringify(periods));
  }
});

test("five-year coverage catches one-day gaps, missing boundaries, and incomplete rows", () => {
  for (const periods of [
    [["2021-09-25", ""]],
    [["2021-09-24", "2026-09-23"]],
    [["2021-09-24", "2024-06-30"], ["2024-07-02", ""]],
    [["2010-01-01", "2021-09-23"], ["2027-01-01", ""]],
    [["", ""]],
    [],
  ]) {
    const app = ready();
    app.applicants[0].residenceHistory = periods.map(([from, to], index) => residence(`residence-${index}`, from, to));
    app.applicants[0].employmentHistory = periods.map(([from, to], index) => employment(`employment-${index}`, from, to));
    assert.equal(hasHistoryProblem(app, "residence"), true, JSON.stringify(periods));
    assert.equal(hasHistoryProblem(app, "employment"), true, JSON.stringify(periods));
  }
  const incomplete = ready(); incomplete.applicants[0].residenceHistory[0].address = ""; incomplete.applicants[0].employmentHistory[0].employer = "";
  assert.equal(hasHistoryProblem(incomplete, "residence"), true);
  assert.equal(hasHistoryProblem(incomplete, "employment"), true);
});

test("five-year anniversaries use calendar dates, including leap days, and reject invalid reference dates", () => {
  for (const [date, earliest] of [["2024-02-29", "2019-02-28"], ["2025-03-01", "2020-03-01"], ["2025-02-28", "2020-02-28"]]) {
    const app = ready(); app.applicants[0].residenceHistory = [residence("residence-1", earliest)]; app.applicants[0].employmentHistory = [employment("employment-1", earliest)];
    assert.deepEqual(jvReadiness(app, date), []);
    const nextDay = new Date(`${earliest}T00:00:00.000Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    app.applicants[0].residenceHistory[0].from = nextDay.toISOString().slice(0, 10);
    assert.equal(hasHistoryProblem(app, "residence", date), true);
  }
  for (const date of ["2025-02-29", "not-a-date", "0001-01-01"]) assert.deepEqual(jvReadiness(ready(), date), ["The review date is invalid."]);
});

test("business election requires a formed owner business and reference, while explicit non-employment covers history", () => {
  const app = ready(); const person = app.applicants[0]; person.ownershipType = "business"; person.businessStatus = "forming";
  assert.equal(jvReadiness(app, today).length, 3);
  person.businessName = "Fictional Example Owner LLC"; person.businessReference = "Fictional formation record";
  assert.ok(jvReadiness(app, today).some(message => message.includes("formed before the venture")));
  person.businessStatus = "existing";
  assert.deepEqual(jvReadiness(app, today), []);
  for (const employer of ["Self-employed", "Unemployed", "Retired"]) {
    Object.assign(person.employmentHistory[0], { employer, role: "", address: "" });
    assert.deepEqual(jvReadiness(app, today), []);
  }
  const second = newJVApplicant("second-applicant"); second.name = "PRIVATE SECOND NAME"; app.applicants.push(second);
  assert.ok(jvReadiness(app, today).some(message => message.startsWith("Applicant 2:")));
  assert.ok(jvReadiness(app, today).every(message => !message.includes(second.name)));
});

test("completed and inapplicable checklist statuses require evidence but pending steps do not block intake review", () => {
  for (const status of ["Complete", "Not applicable"]) {
    const app = ready(); app.steps[0].status = status;
    assert.equal(jvReadiness(app, today).length, 1);
    for (const note of ["", "Done", "!!!!!!!!!!!!"]) { app.steps[0].note = note; assert.equal(jvReadiness(app, today).length, 1); assert.throws(() => validateJVApplication(app)); }
    app.steps[0].note = "Manually confirmed using the fictional example.";
    assert.deepEqual(jvReadiness(app, today), []);
    app.steps[0].note = ""; app.steps[0].reference = "fictional-doc-1";
    assert.deepEqual(jvReadiness(app, today), []);
  }
});

test("intake fingerprints ignore checklist updates, canonicalize object keys, and preserve every intake array order", () => {
  const app = ready(); app.sourceDocumentIds = ["source-b", "source-a"];
  const baseline = jvIntakeFingerprint(app);
  const checklist = structuredClone(app); checklist.steps[0].status = "Complete"; checklist.steps[0].reference = "Example source";
  assert.equal(jvIntakeFingerprint(checklist), baseline);
  const reversed = Object.fromEntries(Object.entries(structuredClone(app)).reverse()); reversed.steps.reverse();
  assert.equal(jvIntakeFingerprint(reversed), baseline);
  const ssnFormatting = structuredClone(app); ssnFormatting.applicants[0].ssn = "123-45-6789";
  assert.equal(jvIntakeFingerprint(ssnFormatting), baseline);
  for (const mutate of [
    app => { app.applicants[0].name = "Fictional Other"; },
    app => { app.applicants[0].ssn = "123456788"; },
    app => { app.applicants[0].residenceHistory[0].address = "Other fictional address"; },
    app => { app.applicants[0].employmentHistory[0].role = "Other example role"; },
    app => { app.logoPreferences = "Fictional blue design"; },
    app => { app.notes = "Fictional notes"; },
    app => { app.sourceDocumentIds.push("source-c"); },
    app => { app.sourceDocumentIds.reverse(); },
    app => { app.applicants.push(newJVApplicant("another-applicant")); },
  ]) { const changed = structuredClone(app); mutate(changed); assert.notEqual(jvIntakeFingerprint(changed), baseline); }
  const sorted = ready(); sorted.applicants.push({ ...structuredClone(sorted.applicants[0]), id: "second-applicant" });
  sorted.applicants[0].residenceHistory.push(residence("residence-2", "2022-01-01", "2023-01-01"));
  sorted.applicants[0].employmentHistory.push(employment("employment-2", "2022-01-01", "2023-01-01"));
  const signature = jvIntakeFingerprint(sorted);
  sorted.applicants[0].residenceHistory.reverse(); sorted.applicants[0].employmentHistory.reverse(); sorted.applicants.reverse();
  assert.notEqual(jvIntakeFingerprint(sorted), signature);
});
