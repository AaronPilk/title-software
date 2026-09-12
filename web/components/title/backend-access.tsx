"use client";
import { useEffect, useState, type ReactNode } from "react";
import { LogIn, ShieldCheck, RefreshCw, Cloud, LogOut } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  backendConfigured,
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
    [loading, setLoading] = useState(true),
    [recovering, setRecovering] = useState(false);
  async function connect() {
    setLoading(true);
    setError("");
    try {
      const { data } = await supabase!.auth.getSession();
      if (!data.session) {
        setRemote(null);
        setAuthenticated(false);
        setActiveWorkspace("");
        return;
      }
      setAuthenticated(true);
      const session = await backendRequest<{
        workspaces: { workspace_id: string }[];
      }>("/session");
      if (!session.workspaces.length) {
        setError(
          "Your email is signed in, but no workspace access has been assigned yet. Ask the owner to prepare your access invitation, then refresh.",
        );
        setRemote(null);
        setActiveWorkspace("");
        return;
      }
      setActiveWorkspace(session.workspaces[0].workspace_id);
      setRemote(await backendRequest<RemoteState>("/state"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect.");
      setRemote(null);
      setActiveWorkspace("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!backendConfigured) {
      setLoading(false);
      return;
    }
    void connect();
    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecovering(true);
        setRemote(null);
        setLoading(false);
      } else if (event === "SIGNED_OUT") {
        setRemote(null);
        setAuthenticated(false);
        setActiveWorkspace("");
      } else if (event === "SIGNED_IN") setTimeout(() => void connect(), 0);
    });
    return () => {
      subscription.unsubscribe();
      setActiveWorkspace("");
    };
  }, []);
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
  if (recovering)
    return (
      <main className="backend-entry">
        <section className="backend-login panel">
          <h1>Set a new password</h1>
          {error && <p role="alert">{error}</p>}
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError("");
              const result = await supabase!.auth.updateUser({ password });
              setPending(false);
              if (result.error) setError(result.error.message);
              else {
                setPassword("");
                setRecovering(false);
                await connect();
              }
            }}
          >
            <label>
              New password
              <Input
                aria-label="New password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button disabled={pending} type="submit">
              Update password
            </Button>
          </form>
        </section>
      </main>
    );
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
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || !email || password.length < 12}
                    onClick={() => void submit("signup")}
                  >
                    Create account
                  </Button>
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
            <Button
              variant="ghost"
              onClick={() => {
                setActiveWorkspace("");
                onDemo();
              }}
            >
              Open local sample workspace
            </Button>
          </>
        )}
      </section>
      <p className="backend-entry-caption">
        <Cloud size={16} /> Ballantyne Title Company · Shared operations
      </p>
    </main>
  );
}
