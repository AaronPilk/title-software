import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Compile in memory so this suite can run independently of the domain runner.
const bundle = await build({
  stdin: {
    contents: `export * from "./lib/title/member-directory.ts";
      export * from "./lib/title/underwriters.ts";
      export { emptyWorkspace, projectWorkspace } from "./lib/backend/workspace.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  normalizeMemberContacts,
  memberContactError,
  remittanceUnderwriters,
  underwriterKey,
  emptyWorkspace,
  projectWorkspace,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("legacy members and blank optional contacts retain the name/share shape", () => {
  const legacy = { name: "Member A", share: 100 };
  assert.deepEqual({ ...legacy, ...normalizeMemberContacts(legacy) }, legacy);
  assert.deepEqual(normalizeMemberContacts({ email: "  ", phone: " " }), {});
  const contact = { email: "  member@example.com  ", phone: " +1 (704) 555-0123 ext. 42 " };
  assert.deepEqual(normalizeMemberContacts(contact), {
    email: "member@example.com",
    phone: "+1 (704) 555-0123 ext. 42",
  });
  assert.equal(contact.email, "  member@example.com  ");
});

test("optional contacts validate email and international phone formatting", () => {
  for (const email of ["member", "member@", "a b@example.com", "a@example.com\nBCC: other@example.com", 123])
    assert.throws(() => normalizeMemberContacts({ email }), /email/);
  for (const phone of ["123", "1234567890123456", "call me", "704-555-0123 ext.", 7045550123])
    assert.throws(() => normalizeMemberContacts({ phone }), /phone/);
  for (const phone of ["704-555-0123", "+44 20 7946 0958", "555.0123 x21"])
    assert.equal(memberContactError({ phone }), "");
});

const company = (id, members = []) => ({
  id, name: id, initials: id, color: "blue", contact: "Staff", email: "staff@example.com",
  location: "NC", jurisdiction: "NC", stage: "Onboarding", steps: Array(7).fill(false), members,
});

test("partner projection never includes another member's contact details", () => {
  const state = emptyWorkspace();
  state.companies = [company("A", [
    { name: "Member A", share: 60, email: "a@example.com", phone: "704-555-0101" },
    { name: "Member B", share: 40, email: "secret@example.com", phone: "704-555-0199" },
  ])];
  // Older snapshots may contain the complete copied member object.
  state.business.closes = [{
    id: "close-a", companyId: "A", status: "Published",
    members: structuredClone(state.companies[0].members),
    allocations: [
      { name: "Member A", share: 60, amount: 60 },
      { name: "Member B", share: 40, amount: 40 },
    ],
  }];
  const projected = projectWorkspace(state, {
    userId: "user-a", email: "a@example.com", role: "partner", companyIds: ["A"],
    allCompanies: false, restricted: false, version: 1,
    partnerMembers: [{ id: "grant-a", companyId: "A", memberName: "Member A" }],
  });
  assert.equal(projected.companies[0].members.length, 1);
  assert.equal(projected.companies[0].members[0].name, "Member A");
  assert.equal(projected.business.closes[0].members.length, 1);
  assert.equal(JSON.stringify(projected).includes("secret@example.com"), false);
  assert.equal(JSON.stringify(projected).includes("704-555-0199"), false);
});

test("remittance carriers include recorded ledger and company configuration without inventing rows", () => {
  const state = emptyWorkspace();
  state.companies = [company("A")];
  state.business.onboarding = [
    { companyId: "A", requiredUnderwriters: ["New Carrier", "  wfg "] },
    { companyId: "outside", requiredUnderwriters: ["Hidden Carrier"] },
  ];
  state.business.credentials = [
    { companyId: "A", kind: "Underwriter authority", underwriter: "Another Carrier" },
    { companyId: "outside", kind: "Underwriter authority", underwriter: "Hidden Authority" },
    { companyId: "A", kind: "Agency license", underwriter: "Not an underwriter setting" },
  ];
  const ledger = [
    { underwriter: "WFG", premium: 100 },
    { underwriter: " wfg ", premium: 200 },
    { underwriter: "Third   Carrier", premium: 300 },
    { underwriter: "", premium: 50 },
  ];
  const before = JSON.stringify({ state, ledger });
  assert.deepEqual(remittanceUnderwriters(state, ledger), [
    { key: "another carrier", name: "Another Carrier" },
    { key: "new carrier", name: "New Carrier" },
    { key: "third carrier", name: "Third Carrier" },
    { key: "", name: "Underwriter not recorded" },
    { key: "wfg", name: "WFG" },
  ]);
  assert.equal(ledger.filter((r) => underwriterKey(r.underwriter) === "wfg").length, 2);
  assert.equal(JSON.stringify({ state, ledger }), before);
  assert.deepEqual(remittanceUnderwriters(emptyWorkspace(), []), []);
});
