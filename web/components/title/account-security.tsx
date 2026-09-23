"use client";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { backendRequest, supabase } from "@/lib/backend/client";
import type { AccountSecurity } from "@/lib/backend/account-security";

export function AccountSecuritySetup({ security, recovering, onComplete, onSignOut }: {
  security: AccountSecurity; recovering: boolean; onComplete: () => Promise<void>; onSignOut: () => void;
}) {
  const step = security.step === "challenge" ? "challenge" : recovering ? "password" : security.step;
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState(""), [nonce, setNonce] = useState("");
  const [needsNonce, setNeedsNonce] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [pending, setPending] = useState(false);
  const [factors, setFactors] = useState<{ id: string; friendly_name?: string }[]>([]);
  const [factorId, setFactorId] = useState("");
  const [loadingFactors, setLoadingFactors] = useState(step === "challenge"), [factorAttempt, setFactorAttempt] = useState(0);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [factorRequest, setFactorRequest] = useState({ step, attempt: factorAttempt });
  if (factorRequest.step !== step || factorRequest.attempt !== factorAttempt) {
    setFactorRequest({ step, attempt: factorAttempt });
    setCode(""); setError(""); setEnrollment(null);
    if (step === "challenge") {
      setLoadingFactors(true); setFactors([]); setFactorId("");
    }
  }
  useEffect(() => {
    let active = true;
    if (step === "challenge") {
      void (async () => {
        try {
          const { data, error } = await supabase!.auth.mfa.listFactors();
          if (!active) return;
          if (error) throw new Error(error.message);
          if (!data.totp.length) throw new Error("No verified authenticator was found. Retry loading, or sign out and sign in again.");
          setFactors(data.totp); setFactorId(data.totp[0].id);
        } catch (e) {
          if (active) setError(e instanceof Error ? e.message : "Unable to load your authenticator. Try again.");
        } finally {
          if (active) setLoadingFactors(false);
        }
      })();
    }
    return () => { active = false; };
  }, [step, factorAttempt]);
  async function beginEnrollment() {
    setPending(true); setError("");
    try {
      // Discard abandoned, unverified enrollments; never remove a working factor.
      const listed = await supabase!.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      for (const factor of listed.data.all.filter(f => f.factor_type === "totp" && f.status === "unverified")) {
        const removed = await supabase!.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }
      const result = await supabase!.auth.mfa.enroll({ factorType: "totp", issuer: "Ballantyne Title", friendlyName: "Title workspace authenticator" });
      if (result.error) throw result.error;
      setEnrollment({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to start setup."); }
    finally { setPending(false); }
  }
  async function submit() {
    setPending(true); setError(""); setNotice("");
    try {
      if (step === "password") {
        if (password !== confirmation) throw new Error("The passwords do not match.");
        await backendRequest("/security/password", { password, nonce }, "POST", 45000);
        setPassword(""); setConfirmation(""); setNonce("");
        // Auth's user-scoped password update revokes other sessions itself.
      } else {
        const result = await supabase!.auth.mfa.challengeAndVerify({ factorId: enrollment?.id || factorId, code });
        if (result.error) throw result.error;
        setCode(""); setEnrollment(null);
      }
      await onComplete();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "reauthentication_needed" || err.code === "reauthentication_not_valid") setNeedsNonce(true);
      if (err.code === "password_setup_incomplete") {
        setPassword(""); setConfirmation(""); setNonce("");
      }
      setError(err.message || "Unable to finish setup.");
    } finally { setPending(false); }
  }
  return <section className="backend-login panel">
    <p className="eyebrow">Protect your workspace</p>
    <h1>{step === "password" ? "Choose your own password" : step === "enroll" ? "Set up your authenticator" : "Verify your sign-in"}</h1>
    <p>{security.email}</p>
    <p>{step === "password" ? "Use a unique password with at least 12 characters. Other signed-in devices will be signed out." : step === "enroll" ? "Add Ballantyne Title to your authenticator app. You will use its six-digit code when signing in." : "Enter the current six-digit code from your authenticator app."}</p>
    {error && <div className="notice warning" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <form className="form-stack" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {step === "password" ? <>
        <label>New password<Input aria-label="New password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm password<Input aria-label="Confirm password" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        {needsNonce && <>
          <Button type="button" variant="outline" disabled={pending} onClick={async () => {
            const result = await supabase!.auth.reauthenticate();
            if (result.error) setError(result.error.message); else setNotice("Enter the verification code sent to your email.");
          }}>Email a verification code</Button>
          <label>Email verification code<Input aria-label="Email verification code" autoComplete="one-time-code" required value={nonce} onChange={e => setNonce(e.target.value)} /></label>
        </>}
      </> : <>
        {step === "challenge" && loadingFactors && <p role="status">Loading authenticator…</p>}
        {step === "challenge" && !loadingFactors && !factorId && <Button type="button" variant="outline" disabled={pending} onClick={() => setFactorAttempt(attempt => attempt + 1)}>Retry authenticator</Button>}
        {step === "enroll" && !enrollment && <Button type="button" disabled={pending} onClick={() => void beginEnrollment()}>Set up authenticator</Button>}
        {enrollment && <>
          {/* eslint-disable-next-line @next/next/no-img-element -- The secret-bearing enrollment QR must stay in the browser, outside image optimization. */}
          <img src={enrollment.qr} alt="Scan this QR code with your authenticator app" width={220} height={220} style={{ background: "white", margin: "0 auto", borderRadius: 12 }} />
          <details><summary>Enter a setup key instead</summary><code style={{ overflowWrap: "anywhere" }}>{enrollment.secret}</code></details>
        </>}
        {step === "challenge" && factors.length > 1 && <label>Authenticator<select aria-label="Authenticator" value={factorId} onChange={e => setFactorId(e.target.value)}>{factors.map(f => <option key={f.id} value={f.id}>{f.friendly_name || "Authenticator"}</option>)}</select></label>}
        {(step === "challenge" || enrollment) && <label>Authenticator code<Input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label>}
      </>}
      {(step !== "enroll" || enrollment) && <Button type="submit" disabled={pending || (step === "challenge" && (loadingFactors || !factorId))}>{pending ? "Please wait…" : step === "password" ? "Save password and continue" : "Verify and continue"}</Button>}
      <Button type="button" variant="ghost" disabled={pending} onClick={onSignOut}>Sign out</Button>
    </form>
    {step === "challenge" && <p className="form-note">Lost your authenticator? Contact the workspace owner. Password recovery preserves authenticator protection.</p>}
  </section>;
}
