import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
async function loadBundle(options) {
  const result = await build({
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    ...options,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { createRecoveryIntent } = await loadBundle({
  entryPoints: [fileURLToPath(new URL("../lib/backend/recovery-intent.ts", import.meta.url))],
});
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const marker = (id) => `titleos.password-recovery.${id}`;
const token = (id, extra = {}) => `header.${Buffer.from(JSON.stringify({ session_id: id, ...extra })).toString("base64url")}.signature`;
function storageFixture() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("recovery survives reload and token/MFA refresh within its session", () => {
  const storage = storageFixture();
  const intent = createRecoveryIntent(() => storage);
  assert.equal(intent.observe("PASSWORD_RECOVERY", token(a)), true);
  assert.equal(storage.getItem(marker(a)), "pending");
  const reloaded = createRecoveryIntent(() => storage);
  assert.equal(reloaded.read(token(a)), true);
  assert.equal(reloaded.observe("TOKEN_REFRESHED", token(a, { exp: 99999 })), true);
  assert.equal(reloaded.observe("MFA_CHALLENGE_VERIFIED", token(a, { aal: "aal2" })), true);
});

test("another session does not inherit recovery and abandons the old marker", () => {
  const storage = storageFixture();
  const intent = createRecoveryIntent(() => storage);
  intent.observe("PASSWORD_RECOVERY", token(a));
  assert.equal(intent.observe("SIGNED_IN", token(b)), false);
  assert.equal(storage.getItem(marker(a)), null);
  assert.equal(intent.read(token(a)), false);
});

test("switching sessions restores only that session's existing recovery marker", () => {
  const storage = storageFixture();
  const intent = createRecoveryIntent(() => storage);
  intent.read(token(a));
  storage.setItem(marker(b), "pending");
  assert.equal(intent.read(token(b)), true);
});

test("blocked browser storage retains recovery only in the same session", () => {
  const intent = createRecoveryIntent(() => { throw new Error("SecurityError"); });
  assert.equal(intent.observe("PASSWORD_RECOVERY", token(a)), true);
  assert.equal(intent.read(token(a, { exp: 99999 })), true);
  assert.equal(intent.observe("SIGNED_IN", token(b)), false);
  assert.equal(intent.read(token(a)), false);
});

test("failed writes preserve in-memory recovery and completion clears it", () => {
  const storage = storageFixture();
  const intent = createRecoveryIntent(() => ({
    getItem: storage.getItem,
    setItem() { throw new Error("QuotaExceededError"); },
    removeItem: storage.removeItem,
  }));
  assert.equal(intent.observe("PASSWORD_RECOVERY", token(a)), true);
  assert.equal(intent.read(token(a)), true);
  intent.clear();
  assert.equal(intent.read(token(a)), false);
});

test("completion does not resurrect a marker if storage removal fails", () => {
  const storage = storageFixture();
  const intent = createRecoveryIntent(() => ({
    ...storage,
    removeItem() { throw new Error("SecurityError"); },
  }));
  intent.observe("PASSWORD_RECOVERY", token(a));
  intent.clear();
  assert.equal(intent.read(token(a)), false);
});

test("missing or malformed sessions clear recovery without creating undefined markers", () => {
  for (const invalid of [null, undefined, "invalid", token(undefined), token("not-a-session")]) {
    const storage = storageFixture();
    const intent = createRecoveryIntent(() => storage);
    intent.observe("PASSWORD_RECOVERY", token(a));
    assert.equal(intent.read(invalid), false);
    assert.equal(intent.observe("PASSWORD_RECOVERY", invalid), false);
    assert.equal(storage.values.size, 0);
    assert.equal(intent.read(token(a)), false);
  }
});

test("sign-out clears recovery even if an event includes the previous token", () => {
  const storage = storageFixture();
  const intent = createRecoveryIntent(() => storage);
  intent.observe("PASSWORD_RECOVERY", token(a));
  assert.equal(intent.observe("SIGNED_OUT", token(a)), false);
  assert.equal(intent.read(token(a)), false);
  assert.equal(createRecoveryIntent(() => storage).read(token(a)), false);
});

test("client initialization captures recovery before the UI subscribes", async () => {
  const storage = storageFixture();
  const originalWindow = globalThis.window;
  globalThis.window = { sessionStorage: storage };
  try {
    const client = await loadBundle({
      stdin: {
        contents: 'export {supabase} from "./lib/backend/client"; export {recoveryIntent} from "./lib/backend/recovery-intent";',
        resolveDir: webRoot,
        loader: "ts",
      },
      define: {
        "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://example.supabase.co"',
        "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"public-test-key"',
        "process.env.NEXT_PUBLIC_TITLE_HOSTED_PILOT": '"true"',
      },
      plugins: [{
        name: "auth-initialization-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "auth", namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export function createClient() {
              const listeners = [];
              queueMicrotask(() => listeners.forEach(listener => listener("PASSWORD_RECOVERY", { access_token: ${JSON.stringify(token(a))} })));
              return { auth: { onAuthStateChange(listener) { listeners.push(listener); return { data: { subscription: { unsubscribe() {} } } }; } } };
            }`,
          }));
        },
      }],
    });
    assert.ok(client.supabase);
    assert.equal(client.recoveryIntent.read(token(a)), true);
    assert.equal(storage.getItem(marker(a)), "pending");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
