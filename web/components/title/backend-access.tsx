"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LogIn, ShieldCheck, RefreshCw, Cloud, LogOut } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { AccountSecuritySetup } from "./account-security";
import type { AccountSecurity } from "@/lib/backend/account-security";
import { recoveryIntent } from "@/lib/backend/recovery-intent";
import {
  backendConfigured,
  hostedPilot,
  backendRequest,
  setActiveWorkspace,
  supabase,
  type RemoteState,
} from "@/lib/backend/client";

export function BackendAccess({
  children,
  onDemo,
}: {
  children: (state: RemoteState) => ReactNode;
  onDemo: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [remote, setRemote] = useState<RemoteState | null>(null),
    [authenticated, setAuthenticated] = useState(false),
    [loading, setLoading] = useState(backendConfigured),
    [recovering, setRecovering] = useState(false);
  const [security, setSecurity] = useState<AccountSecurity | null>(null);
  const generation = useRef(0);
  const recovery = useRef(false);
  const rememberRecoverySession = useCallback((token?: string | null, mark = false) => {
    const next = recoveryIntent.read(token, mark);
    recovery.current = next;
    setRecovering(next);
  }, []);
  const invalidateConnection = useCallback(() => ++generation.current, []);
  const connect = useCallback(async () => {
    const current = invalidateConnection();
    setLoading(true);
    setError("");
    try {
      const { data } = await supabase!.auth.getSession();
      if (current !== generation.current) return;
      if (!data.session) {
        rememberRecoverySession(null);
        setRemote(null);
        setAuthenticated(false);
        setActiveWorkspace("");
        setSecurity(null);
        return;
      }
      rememberRecoverySession(data.session.access_token);
      setAuthenticated(true);
      const securityStatus = await backendRequest<AccountSecurity>("/security/status");
      if (current !== generation.current) return;
      setSecurity(securityStatus);
      if (securityStatus.step !== "ready" || recovery.current) {
        setRemote(null); setActiveWorkspace(""); return;
      }
      const session = await backendRequest<{
        workspaces: { workspace_id: string }[];
      }>("/session");
      if (current !== generation.current) return;
      if (!session.workspaces.length) {
        setError(
          "Your email is signed in, but no workspace access has been assigned yet. Ask the owner to prepare your access invitation, then refresh.",
        );
        setRemote(null);
        setActiveWorkspace("");
        return;
      }
      setActiveWorkspace(session.workspaces[0].workspace_id);
      const next = await backendRequest<RemoteState>("/state");
      if (current === generation.current && !recovery.current) setRemote(next);
    } catch (e) {
      if (current !== generation.current) return;
      setError(e instanceof Error ? e.message : "Unable to connect.");
      setRemote(null);
      setActiveWorkspace("");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [invalidateConnection, rememberRecoverySession]);
  useEffect(() => {
    if (!backendConfigured) return;
    let active = true;
    const scheduled = new Set<ReturnType<typeof setTimeout>>();
    const cancelScheduled = () => {
      for (const timer of scheduled) clearTimeout(timer);
      scheduled.clear();
    };
    // Defer Auth work outside its state-change callback and cancel it on cleanup.
    const scheduleConnect = () => {
      const timer = setTimeout(() => {
        scheduled.delete(timer);
        if (active) void connect();
      }, 0);
      scheduled.add(timer);
    };
    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        rememberRecoverySession(session?.access_token, true);
        invalidateConnection();
        setRemote(null);
        setLoading(false);
        scheduleConnect();
      } else if (event === "SIGNED_OUT") {
        cancelScheduled();
        rememberRecoverySession(null);
        invalidateConnection();
        setLoading(false);
        setPassword("");
        setSecurity(null);
        setRemote(null);
        setAuthenticated(false);
        setActiveWorkspace("");
      } else if (["SIGNED_IN", "TOKEN_REFRESHED", "MFA_CHALLENGE_VERIFIED"].includes(event)) {
        rememberRecoverySession(session?.access_token);
        scheduleConnect();
      }
    });
    scheduleConnect();
    return () => {
      active = false;
      cancelScheduled();
      subscription.unsubscribe();
      invalidateConnection();
      setActiveWorkspace("");
    };
  }, [connect, invalidateConnection, rememberRecoverySession]);
  async function submit(kind: "login" | "signup" | "reset") {
    if (!supabase) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      if (kind === "reset") {
        const result = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (result.error) throw result.error;
        setNotice(
          "If this account can receive recovery email, a recovery link has been requested.",
        );
      } else {
        const result =
          kind === "login"
            ? await supabase.auth.signInWithPassword({ email, password })
            : await supabase.auth.signUp({
                email,
                password,
                options: { emailRedirectTo: window.location.origin },
              });
        if (result.error) throw result.error;
        setPassword("");
        if (kind === "signup" && !result.data.session)
          setNotice(
            "Check your email to confirm the account. Workspace access is assigned separately by the owner.",
          );
        else await connect();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }
  if (!error && security && (security.step !== "ready" || recovering))
    return <main className="backend-entry"><AccountSecuritySetup security={security} recovering={recovering}
      onSignOut={() => void supabase!.auth.signOut()}
      onComplete={async () => {
        // A recovery session may first need its existing authenticator challenge.
        if (security.step !== "challenge") {
          recoveryIntent.clear();
          recovery.current = false; setRecovering(false);
        }
        await connect();
      }} /></main>;
  if (remote) return <>{children(remote)}</>;
  return (
    <main className="backend-entry">
      <section className="backend-login panel">
        <img
          src="/brand/ballantyne-title-logo.png"
          alt="Ballantyne Title"
          width={82}
          height={82}
        />
        <p className="eyebrow">Company operations</p>
        <h1>Welcome to Ballantyne</h1>
        <p>Sign in to your shared title workspace.</p>
        {loading ? (
          <p role="status">
            <RefreshCw size={16} /> Connecting securely…
          </p>
        ) : (
          <>
            {error && (
              <div className="notice warning" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}
            {authenticated ? (
              <div className="source-actions">
                <Button onClick={() => void connect()}>
                  <RefreshCw />
                  Refresh access
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void supabase?.auth.signOut()}
                >
                  <LogOut />
                  Sign out
                </Button>
              </div>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit("login");
                }}
              >
                <label>
                  Email
                  <Input
                    aria-label="Email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  Password
                  <Input
                    aria-label="Password"
                    type="password"
                    autoComplete="current-password"
                    minLength={12}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <Button type="submit" disabled={pending || !backendConfigured}>
                  <LogIn />
                  {pending ? "Please wait…" : "Sign in"}
                </Button>
                <div className="source-actions">
                  {!hostedPilot && <Button
                    type="button"
                    variant="outline"
                    disabled={pending || !email || password.length < 12}
                    onClick={() => void submit("signup")}
                  >
                    Create account
                  </Button>}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending || !email}
                    onClick={() => void submit("reset")}
                  >
                    Reset password
                  </Button>
                </div>
              </form>
            )}
            <p className="form-note">
              <ShieldCheck size={15} /> Access is assigned to your account and
              companies.
            </p>
            {!hostedPilot && <Button
              variant="ghost"
              onClick={() => {
                setActiveWorkspace("");
                onDemo();
              }}
            >
              Open local sample workspace
            </Button>}
          </>
        )}
      </section>
      <p className="backend-entry-caption">
        <Cloud size={16} /> Ballantyne Title Company · Shared operations
      </p>
    </main>
  );
}
