import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const b = await build({ entryPoints: [fileURLToPath(new URL("../lib/backend/vendor-callback.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const m = await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].contents).toString("base64")}`);
const state = "tv1_" + "a".repeat(64);
const url = suffix => new URL(`https://pilot.example.test/?state=${state}${suffix}`);
const intent = { state, provider: "quickbooks", companyId: "company-a", workspaceId: "workspace-a", userId: "owner-a", accountId: "", expiresAt: new Date(Date.now() + 600_000).toISOString() };
const previous = globalThis.window;
after(() => { globalThis.window = previous; });
test("vendor callback does not consume Supabase password recovery or ordinary sign-in codes", () => {
  for (const u of ["https://pilot.example.test/?code=supabase-pkce", "https://pilot.example.test/#access_token=synthetic&type=recovery", "https://pilot.example.test/?code=x&state=supabase-state"])
    assert.equal(m.readVendorCallback(new URL(u)), null);
});
test("callback extracts only fixed fields and flags duplicates/oversized/invalid state", () => {
  assert.deepEqual(m.readVendorCallback(url("&code=synthetic-code&realmId=123&ignored=discard")), { state, code: "synthetic-code", realmId: "123", denied: false, malformed: false });
  for (const suffix of ["&code=a&code=b", "&state=" + state, "&realmId=1&realmId=2", "&error=a&error=b", "&code=" + "a".repeat(4097)]) assert(m.readVendorCallback(url(suffix)).malformed);
  assert(m.readVendorCallback(new URL("https://pilot.example.test/?state=tv1_short&code=x")).malformed);
});
test("callback intent binds browser session to exact original account/workspace/company and expiry", () => {
  const callback = m.readVendorCallback(url("&code=synthetic"));
  assert(m.validVendorIntent(intent, callback, "workspace-a", "owner-a"));
  for (const v of [null, {}, {...intent, state: "tv1_"+"b".repeat(64)}, {...intent, provider: "evil"}, {...intent, companyId: ""}, {...intent, expiresAt: "invalid"}, {...intent, expiresAt: "2000-01-01"}]) assert.equal(m.validVendorIntent(v, callback, "workspace-a", "owner-a"), false);
  assert.equal(m.validVendorIntent(intent, callback, "workspace-b", "owner-a"), false);
  assert.equal(m.validVendorIntent(intent, callback, "workspace-a", "owner-b"), false);
});
test("capture removes authorization code before auth SDK initialization without persisting credentials", () => {
  let replaced;
  globalThis.window = { location: { href: url("&code=private-code&realmId=123&error_description=private#agency/settings").href }, history: { state: { key: 1 }, replaceState: (...args) => { replaced = args; } } };
  m.captureVendorCallback();
  assert.equal(replaced[2], "/#agency/settings");
  assert.equal(m.pendingVendorCallback().code, "private-code");
  m.clearVendorCallback(); assert.equal(m.pendingVendorCallback(), null);
});
