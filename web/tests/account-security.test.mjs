import test from "node:test";
import assert from "node:assert/strict";
import { accountSecurity, requireAccountReady } from "../.local-test/backend/api.mjs";
const facts = {session_valid:true,password_change_required:false,has_totp:true,session_totp:true};
test("revoked, expired and pre-rotation sessions fail even with aal2", () => {
  assert.throws(()=>accountSecurity("qa@example.com","aal2",{...facts,session_valid:false}), /expired/);
});
test("verified TOTP and current aal2 permit company access", () => {
  const status=accountSecurity("qa@example.com","aal2",facts);
  assert.equal(status.step,"ready");
  assert.doesNotThrow(()=>requireAccountReady(status));
});
test("password-only sign in cannot bypass an existing factor", () => {
  for (const aal of [undefined,"aal1","aal3",true]) {
    const status=accountSecurity("qa@example.com",aal,facts);
    assert.equal(status.step,"challenge");
    assert.throws(()=>requireAccountReady(status),/authenticator/);
  }
});
test("existing factors are challenged before a mandatory password change", () => {
  assert.equal(accountSecurity("qa@example.com","aal1",{...facts,password_change_required:true}).step,"challenge");
  assert.equal(accountSecurity("qa@example.com","aal2",{...facts,password_change_required:true}).step,"password");
});
test("first sign in replaces temporary password before enrollment", () => {
  assert.equal(accountSecurity("qa@example.com","aal1",{...facts,has_totp:false,session_totp:false,password_change_required:true}).step,"password");
  const status=accountSecurity("qa@example.com","aal1",{...facts,has_totp:false,session_totp:false});
  assert.equal(status.step,"enroll");
  assert.throws(()=>requireAccountReady(status),/authenticator/);
});
test("stale aal2 cannot survive factor deletion or use another session's enrollment", () => {
  assert.equal(accountSecurity("qa@example.com","aal2",{...facts,has_totp:false,session_totp:false}).step,"enroll");
  assert.equal(accountSecurity("qa@example.com","aal2",{...facts,session_totp:false}).step,"challenge");
});
