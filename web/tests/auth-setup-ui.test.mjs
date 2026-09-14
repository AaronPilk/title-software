import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

let browser, context, page;
const errors = [];
before(async () => {
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ channel: "chrome", headless: true }); }
  context = await browser.newContext();
  await context.route("**/*", route => {
    if (!route.request().url().startsWith(process.env.AUTH_SETUP_ORIGIN + "/")) {
      errors.push("Unexpected external request"); return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(2000);
  page.on("pageerror", error => errors.push(error.message));
});
beforeEach(async () => { await page.goto("about:blank"); });
after(async () => { await context?.close(); await browser?.close(); });
const open = scenario => page.goto(`${process.env.AUTH_SETUP_ORIGIN}/?scenario=${scenario}`);
const verify = async () => {
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await page.getByRole("heading", { name: "Authenticated synthetic workspace", exact: true }).waitFor();
};

for (const scenario of ["signout-security", "signout-session"]) {
  test(`sign-out during ${scenario === "signout-security" ? "security lookup" : "session lookup"} restores the login form and ignores the stale result`, async () => {
    await open(scenario);
    await page.waitForFunction(() => window.authSetupFixture.releaseSecurity || window.authSetupFixture.releaseSession);
    await page.evaluate(() => window.authSetupFixture.signOut());
    await page.getByLabel("Email", { exact: true }).waitFor();
    assert.equal(await page.getByText("Connecting securely…", { exact: true }).count(), 0);
    await page.evaluate(() => { window.authSetupFixture.releaseSecurity?.(); window.authSetupFixture.releaseSession?.(); });
    await page.waitForFunction(() => !document.body.textContent.includes("Connecting securely…"));
    assert.equal(await page.getByRole("heading", { name: "Verify your sign-in", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Authenticated synthetic workspace", exact: true }).count(), 0);
  });
}

for (const scenario of ["factor-returned-error", "factor-rejected-error"]) {
  test(`MFA setup recovers from a ${scenario === "factor-returned-error" ? "returned" : "rejected"} factor request without signing out`, async () => {
    await open(scenario);
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Synthetic authenticator/);
    assert.equal(await page.getByRole("button", { name: "Verify and continue", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Retry authenticator", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("[role=alert]"));
    assert.equal(await page.evaluate(() => window.authSetupFixture.calls.filter(path => path === "listFactors").length), 2);
    await verify();
    assert.equal(await page.evaluate(() => window.authSetupFixture.calls.includes("signOut")), false);
  });
}

test("an invalid MFA code remains on the challenge and permits a corrected code", async () => {
  await open("challenge");
  await page.getByLabel("Authenticator code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /code was not accepted/);
  assert.equal(await page.evaluate(() => window.authSetupFixture.calls.includes("/session")), false);
  await verify();
});

test("first sign-in retries an ordinary password failure, then enrolls and verifies before opening records", async () => {
  await open("first-login");
  await page.getByLabel("Email", { exact: true }).fill("setup-reviewer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic initial password 123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Choose your own password", exact: true }).waitFor();
  await page.evaluate(() => window.authSetupFixture.passwordFailures.push("Synthetic password service unavailable"));
  await page.getByLabel("New password", { exact: true }).fill("Synthetic personal password 456");
  await page.getByLabel("Confirm password", { exact: true }).fill("Synthetic personal password 456");
  await page.getByRole("button", { name: "Save password and continue", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.authSetupFixture.calls.includes("/session")), false);
  await page.getByRole("button", { name: "Save password and continue", exact: true }).click();
  await page.getByRole("heading", { name: "Set up your authenticator", exact: true }).waitFor();
  await page.getByRole("button", { name: "Set up authenticator", exact: true }).click();
  await page.getByRole("img", { name: "Scan this QR code with your authenticator app", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.authSetupFixture.calls.includes("/session")), false);
  await verify();
});

test("an acknowledged password change with incomplete setup clears the submitted password and verification code", async () => {
  await open("first-login");
  await page.getByLabel("Email", { exact: true }).fill("setup-reviewer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic initial password 123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Choose your own password", exact: true }).waitFor();
  await page.evaluate(() => window.authSetupFixture.passwordFailures.push(
    { code: "reauthentication_needed", message: "Synthetic email verification required" },
    { code: "password_setup_incomplete", message: "Your password changed, but setup could not be completed. Sign out, then sign in with your new password to finish setup." },
  ));
  await page.getByLabel("New password", { exact: true }).fill("Synthetic personal password 456");
  await page.getByLabel("Confirm password", { exact: true }).fill("Synthetic personal password 456");
  await page.getByRole("button", { name: "Save password and continue", exact: true }).click();
  await page.getByLabel("Email verification code", { exact: true }).fill("synthetic-email-code");
  await page.getByRole("button", { name: "Save password and continue", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[role=alert]")?.textContent?.includes("Your password changed"));
  assert.equal(await page.getByLabel("New password", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Confirm password", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Email verification code", { exact: true }).inputValue(), "");
  assert.equal(await page.evaluate(() => window.authSetupFixture.calls.filter(path => path === "/security/password").length), 2);
  assert.equal(await page.evaluate(() => window.authSetupFixture.calls.includes("/session")), false);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).waitFor();
});

test("the actual setup forms make no external requests or unhandled runtime errors", () => { assert.deepEqual(errors, []); });
