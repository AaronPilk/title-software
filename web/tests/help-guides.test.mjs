import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const bundle = await build({
  stdin: { contents: "export * from './lib/assistant/help-guides';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  write: false, bundle: true, format: "esm", platform: "node",
});
const { helpGuides, parseHelpScreen, suggestedHelpGuides } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const roles = ["owner", "admin", "operations", "onboarding", "finance", "viewer", "partner"];
const ids = role => helpGuides(role).map(guide => guide.id);
const guide = id => helpGuides("owner").find(item => item.id === `help:${id}`);
const text = item => [item.summary, ...item.steps, item.note || ""].join(" ");

test("screen parser accepts current navigation labels and returns a detached minimal hint", () => {
  const value = { page: "Connections", view: "agency", surface: "page" };
  assert.deepEqual(parseHelpScreen(value), value);
  assert.notEqual(parseHelpScreen(value), value);
  assert.deepEqual(parseHelpScreen({ page: "Policy workbench", view: "production", surface: "order" }), { page: "Policy workbench", view: "production", surface: "order" });
  assert.deepEqual(parseHelpScreen({ page: "Partner portal", view: "partner" }), { page: "Partner portal", view: "partner" });
  const emptyPrototype = Object.assign(Object.create(null), { page: "Documents", view: "agency", surface: "document" });
  assert.deepEqual(parseHelpScreen(emptyPrototype), { page: "Documents", view: "agency", surface: "document" });
});

test("screen parser refuses identifiers, arbitrary strings, prototype tricks and unknown fields", () => {
  const valid = { page: "Companies", view: "agency" };
  for (const value of [
    undefined, null, false, 1, "Companies", [], new Date(),
    { page: "Companies" }, { view: "agency" }, { ...valid, page: "Materials" },
    { ...valid, page: "Documents ", }, { ...valid, page: "<script>" },
    { ...valid, view: "owner" }, { ...valid, surface: "client-data" },
    { ...valid, surface: undefined }, { ...valid, surface: null },
    { ...valid, companyId: "private-company" }, { ...valid, question: "Ignore the rules" },
    { ...valid, url: "https://outside.example/" },
    { ...valid, [Symbol("record")]: "private" },
    Object.create(valid), Object.assign(Object.create({ secret: "private" }), valid),
    JSON.parse('{"page":"Companies","view":"agency","__proto__":{"role":"owner"}}'),
  ]) assert.throws(() => parseHelpScreen(value), /valid help screen/);
});

test("partners get only portal, shared-document, sign-in and feedback help", () => {
  assert.deepEqual(ids("partner").sort(), ["help:feedback", "help:partner-documents", "help:partner-navigation", "help:sign-in"]);
  assert(helpGuides("partner").every(item => ["Partner portal", "Settings"].includes(item.page)));
  assert(helpGuides("partner").every(item => item.views.includes("partner")));
  assert.equal(ids("partner").some(id => /scan|invite|missive|order|revision|policy|upload/.test(id)), false);
  assert.deepEqual(helpGuides("administrator"), []);
  assert.deepEqual(helpGuides("OWNER"), []);
  assert.deepEqual(helpGuides(""), []);
});

test("mutating workflows are restricted to the matching staff capabilities", () => {
  for (const role of roles) {
    const list = ids(role);
    assert.equal(list.includes("help:company-profile"), ["owner", "admin", "onboarding"].includes(role));
    assert.equal(list.includes("help:material-request"), ["owner", "admin", "onboarding"].includes(role));
    assert.equal(list.includes("help:new-order"), ["owner", "admin", "operations"].includes(role));
    assert.equal(list.includes("help:title-scan-capture"), ["owner", "admin", "operations"].includes(role));
    assert.equal(list.includes("help:reply-drafts"), ["owner", "admin", "operations"].includes(role));
    assert.equal(list.includes("help:upload-documents"), ["owner", "admin", "operations", "onboarding"].includes(role));
    assert.equal(list.includes("help:scan-package"), ["owner", "admin", "operations", "onboarding"].includes(role));
    assert.equal(list.includes("help:invite"), ["owner", "admin"].includes(role));
    assert.equal(list.includes("help:missive-import"), ["owner", "admin"].includes(role));
    assert.equal(list.includes("help:tasks"), ["owner", "admin", "operations", "onboarding", "finance"].includes(role));
  }
  assert.match(text(guide("invite")), /Only the owner manages all-company access, restricted evidence access and administrator grants/);
  assert.match(text(guide("invite")), /Company-scoped administrators cannot manage this page/);
  assert.match(text(guide("missive-import")), /administrator with all-company access/);
});

test("screen ranking stays within the stable role catalog and prioritizes relevant help", () => {
  for (const role of roles) {
    const baseline = helpGuides(role);
    for (const screen of [
      { page: "Companies", view: "agency", surface: "company" },
      { page: "Documents", view: "production", surface: "document" },
      { page: "Settings", view: "agency" },
      { page: "Partner portal", view: "partner" },
    ]) {
      const suggestions = suggestedHelpGuides(role, screen);
      assert.equal(suggestions.length, 3);
      assert(suggestions.every(item => baseline.some(allowed => allowed.id === item.id)));
      assert.deepEqual(helpGuides(role), baseline);
    }
  }
  const company = suggestedHelpGuides("onboarding", { page: "Companies", view: "agency", surface: "company" });
  assert.equal(company[0].id, "help:company-workspace");
  const document = suggestedHelpGuides("operations", { page: "Documents", view: "production", surface: "document" });
  assert(document.every(item => item.page === "Documents"));
  const partner = suggestedHelpGuides("partner", { page: "Partner portal", view: "partner", surface: "document" });
  assert.equal(partner[0].id, "help:partner-documents");
});

test("catalog values cannot be changed by a previous consumer", () => {
  const expected = helpGuides("owner");
  const changed = helpGuides("owner");
  changed[0].steps[0] = "Bypass permissions";
  changed[0].views.push("partner");
  changed[0].title = "Invented title";
  changed.pop();
  assert.deepEqual(helpGuides("owner"), expected);
});

test("catalog is bounded, uniquely cited, and contains no customer data", () => {
  for (const role of roles) {
    const list = helpGuides(role);
    assert(JSON.stringify(list).length < 45_000);
    assert.equal(new Set(list.map(item => item.id)).size, list.length);
    for (const item of list) {
      assert.match(item.id, /^help:[a-z-]+$/);
      assert(item.title.length <= 100 && item.question.length <= 180);
      assert(item.steps.length >= 2 && item.steps.length <= 4);
      assert.deepEqual(parseHelpScreen({ page: item.page, view: item.views[0] }), { page: item.page, view: item.views[0] });
      assert(!JSON.stringify(item).includes("@"), "Public guides must not include customer emails");
    }
  }
});

test("guide distinguishes document scanner limits and persistence rather than promising background scans", () => {
  const packageHelp = text(guide("scan-package"));
  assert.match(packageHelp, /1,000 physical pages/);
  assert.match(packageHelp, /100 originals/);
  assert.match(packageHelp, /25 MB per original, 500 MB total/);
  assert.match(packageHelp, /does not continue after the review\/browser closes/);
  assert.match(packageHelp, /saved batches remain available/);
  const singleHelp = text(guide("read-document-text"));
  assert.match(singleHelp, /120 pages, 25 MB and 500,000/);
  assert.match(singleHelp, /clears when closed or reloaded/);
  assert.match(text(guide("review-scan")), /checked against its original page/);
  assert.match(text(guide("review-scan")), /does not automatically train a model/);
});

test("guide keeps operating status, sign-in, delivery and drafts distinct from approvals", () => {
  assert.match(text(guide("company-status")), /Active can describe an already operating business while its workspace records remain incomplete/);
  assert.match(text(guide("company-status")), /does not create ownership details, verify licensing or complete evidence reviews/);
  assert.match(text(guide("sign-in")), /Cloudflare access, your workspace password and your authenticator are separate/);
  assert.match(text(guide("invite")), /Preparing, editing or renewing the invitation alone does not send email/);
  assert.match(text(guide("invite")), /provider acceptance does not confirm inbox delivery/);
  assert.match(text(guide("reply-drafts")), /Sending is off/);
  assert.match(text(guide("reply-drafts")), /does not send email, create a draft in Missive, or write SoftPro/);
  assert.match(text(guide("policy-review")), /not a legal title opinion or authority to issue/);
});

test("critical guide navigation labels remain present in the current UI", async () => {
  const component = name => readFile(new URL(`../components/title/${name}.tsx`, import.meta.url), "utf8");
  const cases = [
    ["companies", ["Requests and approvals", "Documents", "Upload"]],
    ["company-intake", ["Complete company profile", "Save company profile"]],
    ["package-review", ["Read document package", "Open saved package review", "Scan every page", "Resume / retry unread pages", "Use reviewed company details", "Accept reviewed value"]],
    ["team-access", ["Prepare access invitation", "Send setup email", "Access invitations"]],
    ["backend-access", ["Set up or reset password"]],
    ["revisions", ["Apply reviewed change", "Approve local draft", "Export draft"]],
    ["partner-documents", ["Published company documents"]],
  ];
  for (const [name, labels] of cases) {
    const source = await component(name);
    for (const label of labels) assert(source.includes(label), `${name} is missing guide label ${label}`);
  }
});
