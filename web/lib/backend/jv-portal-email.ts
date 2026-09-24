import type { JVPortalEmail } from "./jv-portal";
import { readRequestText } from "../shared/request-body";

export type JVPortalMailConfig = { apiKey?: string; from: string; portalUrl: string; staffUrl: string };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clean = (s: string, max: number) => typeof s === "string" && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
export function portalEmailConfigured(config: JVPortalMailConfig): boolean {
  return !!config.apiKey && clean(config.apiKey, 500) && clean(config.from, 300) && /(?:^|<)[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(config.from);
}
/** Provider acceptance is recorded as sent; this does not claim inbox delivery. */
export async function sendJvPortalEmail(job: JVPortalEmail, config: JVPortalMailConfig, fetcher: typeof fetch = fetch): Promise<{ status: "sent" | "failed" | "unknown"; providerId?: string }> {
  if (!portalEmailConfigured(config) || !clean(job.to, 254) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(job.to) ||
      !clean(job.recipientName, 200) || !clean(job.companyName, 500) || !/^[A-Za-z0-9_-]{1,200}$/.test(job.idempotencyKey)) return { status: "failed" };
  let subject: string, text: string, html: string;
  try {
    if (job.kind === "challenge") {
      if (!/^\d{6}$/.test(job.code ?? "")) return { status: "failed" };
      subject = "Your Ballantyne Title application code";
      text = `Your application verification code is ${job.code}. It expires in 10 minutes or when the application link expires, whichever comes first. Enter it only in the application you opened. If you did not request it, ignore this email.`;
      html = `<p>Your application verification code is:</p><p style="font-size:30px;letter-spacing:6px"><strong>${job.code}</strong></p><p>It expires in 10 minutes or when the application link expires, whichever comes first. Enter it only in the application you opened. If you did not request it, ignore this email.</p>`;
    } else if (job.kind === "invitation") {
      const url = new URL(job.link ?? ""), base = new URL(config.portalUrl);
      if (url.origin !== base.origin || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.username || url.password || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)) return { status: "failed" };
      subject = "Complete your joint venture application";
      text = `Hello ${job.recipientName},\n\nBallantyne Title has prepared a private application for ${job.companyName}. Open your personal link to verify this email and complete the form:\n${url.href}\n\nYou can save your progress and return through this link. The application shows when this link expires. Do not forward it or send identity details by email. The team will review your submission.`;
      html = `<p>Hello ${escape(job.recipientName)},</p><p>Ballantyne Title has prepared a private application for <strong>${escape(job.companyName)}</strong>.</p><p><a href="${escape(url.href)}">Open your private application</a></p><p>Verify this email, fill out the form and upload your supporting documents. You can save your progress and return through this link. The application shows when this link expires.</p><p>Do not forward this link or send identity details by email. The team will review your submission.</p>`;
    } else if (job.kind === "submission") {
      const url = new URL(config.staffUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search) return { status: "failed" };
      subject = "A joint venture application is ready for review";
      text = `An application for ${job.companyName} has been submitted. Sign in to your workspace and open that company's Onboarding tab to review it:\n${url.href}\n\nThis message contains no application answers or documents.`;
      html = `<p>An application for <strong>${escape(job.companyName)}</strong> has been submitted.</p><p><a href="${escape(url.href)}">Open your workspace</a>, then open the company's Onboarding tab to review it.</p><p>This message contains no application answers or documents.</p>`;
    } else return { status: "failed" };
  } catch { return { status: "failed" }; }
  try {
    const result = await fetcher("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": job.idempotencyKey }, body: JSON.stringify({ from: config.from, to: [job.to], subject, text, html }) });
    if (!result.ok) { void result.body?.cancel().catch(() => {}); return { status: result.status >= 500 || result.status === 409 ? "unknown" : "failed" }; }
    const data: unknown = JSON.parse(await readRequestText({ body: result.body, headers: result.headers, signal: AbortSignal.timeout(15_000) }, { maxBytes: 16_384 }));
    if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(data.id)) return { status: "unknown" };
    return { status: "sent", providerId: data.id };
  } catch { return { status: "unknown" }; }
}
