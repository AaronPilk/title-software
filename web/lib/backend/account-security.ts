import { ApiError } from "./workspace";

export type SecurityFacts = {
  session_valid: boolean;
  password_change_required: boolean;
  has_totp: boolean;
  session_totp: boolean;
};
export type AccountSecurity = {
  email: string;
  passwordChangeRequired: boolean;
  step: "password" | "enroll" | "challenge" | "ready";
};

// Facts come from the current Auth tables; claims must be verified by Auth first.
export function accountSecurity(email: string, aal: unknown, facts: SecurityFacts): AccountSecurity {
  if (facts.session_valid !== true)
    throw new ApiError("Your sign-in expired. Sign in again.", 401);
  const verified = aal === "aal2" && facts.session_totp === true;
  const step = facts.has_totp && !verified ? "challenge"
    : facts.password_change_required ? "password"
    : !verified ? "enroll" : "ready";
  return { email, passwordChangeRequired: facts.password_change_required, step };
}

export function requireAccountReady(security: AccountSecurity) {
  if (security.step !== "ready")
    throw new ApiError("Finish your password and authenticator setup before opening company records.", 403);
}
