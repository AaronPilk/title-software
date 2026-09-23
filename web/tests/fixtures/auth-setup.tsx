import { createRoot } from "react-dom/client";
import { BackendAccess } from "../../components/title/backend-access";
import { accountSecurity } from "../../lib/backend/account-security";

type Session = { access_token: string };
type Listener = (event: string, session: Session | null) => void;
type Factor = { id: string; friendly_name: string; status: string; factor_type: string };
type FactorResult = { data: { all: Factor[]; totp: Factor[] } | null; error: { message: string } | null };
const scenario = new URLSearchParams(location.search).get("scenario") || "challenge";
const listeners = new Set<Listener>();
const session = { access_token: `synthetic.${btoa(JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }))}.synthetic` };
const factor = { id: "synthetic-factor", friendly_name: "Test authenticator", status: "verified", factor_type: "totp" };
const firstSetup = ["first-login", "email-setup"].includes(scenario);
const securityFacts = { session_valid: true, password_change_required: firstSetup, has_totp: !firstSetup, session_totp: false };
const security = accountSecurity("setup-reviewer@example.test", "aal1", securityFacts);
const fixture = {
  session: firstSetup || scenario === "email-recovery-factor" ? null as Session | null : session,
  security, workspaceId: "", calls: [] as string[],
  recoveryRequests: [] as { email: string; redirectTo: string }[],
  listFailures: scenario === "factor-returned-error" ? ["returned"] : scenario === "factor-rejected-error" ? ["rejected"] : [] as string[],
  passwordFailures: [] as (string | { message: string; code: string })[],
  releaseSecurity: null as null | (() => void),
  releaseSession: null as null | (() => void),
  holdSecurity: scenario === "signout-security", holdSession: scenario === "signout-session",
  async getSession() {
    fixture.calls.push("getSession");
    const captured = fixture.session;
    if (fixture.holdSession) await new Promise<void>(done => { fixture.releaseSession = done; });
    return { data: { session: captured }, error: null };
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  },
  emit(event: string) { for (const listener of listeners) listener(event, fixture.session); },
  async signIn() {
    fixture.calls.push("signIn"); fixture.session = session; fixture.emit("SIGNED_IN");
    return { data: { session }, error: null };
  },
  async requestRecovery(email: string, options: { redirectTo: string }) {
    fixture.calls.push("resetPasswordForEmail");
    fixture.recoveryRequests.push({ email, redirectTo: options.redirectTo });
    return { data: {}, error: null };
  },
  completeRecovery() {
    fixture.calls.push("emailCallback"); fixture.session = session;
    fixture.emit("PASSWORD_RECOVERY");
  },
  async signOut() { fixture.calls.push("signOut"); fixture.session = null; fixture.emit("SIGNED_OUT"); return { error: null }; },
  async listFactors(): Promise<FactorResult> {
    fixture.calls.push("listFactors");
    const failure = fixture.listFailures.shift();
    if (failure === "rejected") throw new Error("Synthetic authenticator request interrupted");
    if (failure === "returned") return { data: null, error: { message: "Synthetic authenticator temporarily unavailable" } };
    const verifiedFactors = securityFacts.has_totp ? [factor] : [];
    return { data: { all: verifiedFactors, totp: verifiedFactors }, error: null };
  },
  async enroll() {
    fixture.calls.push("enroll");
    return { data: { id: "synthetic-enrollment", totp: { qr_code: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3C/svg%3E", secret: "SYNTHETIC-NONFUNCTIONAL-SETUP-KEY" } }, error: null };
  },
  async unenroll() { fixture.calls.push("unenroll"); return { error: null }; },
  async verify(input: { factorId: string; code: string }) {
    fixture.calls.push("verify");
    if (![factor.id, "synthetic-enrollment"].includes(input.factorId) || input.code !== "123456")
      return { data: null, error: { message: "Synthetic authenticator code was not accepted" } };
    securityFacts.has_totp = true; securityFacts.session_totp = true;
    fixture.emit("MFA_CHALLENGE_VERIFIED");
    return { data: {}, error: null };
  },
};
declare global { interface Window {
  authSetupFixture: typeof fixture;
  authSetupTransport: (path: string, data?: unknown) => Promise<unknown>;
} }
window.authSetupFixture = fixture;
window.authSetupTransport = async path => {
  fixture.calls.push(path);
  if (path === "/security/status") {
    Object.assign(fixture.security, accountSecurity(fixture.security.email, securityFacts.session_totp ? "aal2" : "aal1", securityFacts));
    const captured = structuredClone(fixture.security);
    if (fixture.holdSecurity) await new Promise<void>(done => { fixture.releaseSecurity = done; });
    return captured;
  }
  if (path === "/security/password") {
    const failure = fixture.passwordFailures.shift();
    if (failure) throw typeof failure === "string" ? new Error(failure) : Object.assign(new Error(failure.message), { code: failure.code });
    securityFacts.password_change_required = false;
    return { updated: true };
  }
  if (path === "/session") return { workspaces: [{ workspace_id: "synthetic-workspace" }] };
  if (path === "/state") return { name: "Synthetic workspace" };
  throw new Error(`Unexpected synthetic API request: ${path}`);
};
createRoot(document.getElementById("root")!).render(<BackendAccess onDemo={() => { throw new Error("Unexpected demo entry"); }}>
  {() => <h1>Authenticated synthetic workspace</h1>}
</BackendAccess>);
