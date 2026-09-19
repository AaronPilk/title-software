/** Server-only delivery adapter. It never returns authentication links or tokens. */
type ProviderResult = { error: { status?: number } | null };
type MailClient = { auth: {
  admin: { inviteUserByEmail(email: string, options: { redirectTo: string }): Promise<ProviderResult> };
  signInWithOtp(input: { email: string; options: { shouldCreateUser: false; emailRedirectTo: string } }): Promise<ProviderResult>;
} };
export type InvitationDeliveryStatus = "sending" | "sent" | "failed" | "unknown";
export function invitationEmailRedirect(enabled: string | undefined, redirect: string | undefined): string | null {
  if (enabled !== "true" || !redirect) return null;
  try {
    const url = new URL(redirect);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}
export async function sendInvitationEmail(client: MailClient, delivery: { kind: "invite" | "magiclink"; email: string }, redirectTo: string): Promise<InvitationDeliveryStatus> {
  try {
    const result = delivery.kind === "invite"
      ? await client.auth.admin.inviteUserByEmail(delivery.email, { redirectTo })
      : await client.auth.signInWithOtp({ email: delivery.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    if (!result.error) return "sent";
    // Timeouts, transport failures and provider 5xx may follow an accepted send.
    return result.error.status && result.error.status >= 400 && result.error.status < 500 ? "failed" : "unknown";
  } catch { return "unknown"; }
}
export function invitationDeliveryMessage(status: InvitationDeliveryStatus, recorded = true) {
  if (!recorded) return "The email request finished, but its status could not be saved. Refresh before retrying; another send could duplicate the email.";
  if (status === "sent") return "The email provider accepted the setup email. Inbox delivery has not been confirmed.";
  if (status === "failed") return "The email provider rejected the request. Check the sender configuration and recipient before retrying.";
  if (status === "unknown") return "Email delivery could not be confirmed. Check with the recipient before deliberately retrying; another send could duplicate the email.";
  return "The email request is in progress. Refresh its status before taking another action.";
}
