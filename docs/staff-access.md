# Staff access and assignment

The owner manages staff in Settings → Team & access. Company permissions and the Agency/Production view preference are separate. Choosing Agency does not grant management or financial access.

## Prepare and maintain access

1. Choose the recipient, role and explicit company subset. Only the owner can grant admin, all-company or restricted-evidence access. For a partner, select the matching company member for every selected company.
2. Prepare the invitation. This records the proposed grant; it does not send email. The recipient must verify their account, choose a personal password and complete authenticator setup before claiming it.
3. Edit a pending invitation to correct its grant. Expired or canceled invitations require explicit renewal; accepted invitations remain historical records. Each edit uses the version the administrator reviewed. A conflicting change requires refreshing.
4. Revoke a member to deactivate the membership and cancel their outstanding invitations atomically. A later reconnect cannot reuse the canceled invitation. An intentional new invitation or renewal is a separate owner/admin action.

A failed refresh after a saved change is reported separately. Retry IDs prevent a lost response from creating another grant. Invitations for existing accounts bind to account IDs as well as email; existing usable invitations are bound only when their current email matches exactly one account; a recycled address cannot claim another account's bound invitation.

## Activate setup email delivery

The server implements explicit **Send setup email** with an audit trail. Delivery is disabled by default. Preparing, editing or renewing a grant never sends automatically.

The owner must finish these deployment settings:

- Configure a verified custom SMTP sender in Supabase Auth. The existing pilot's prepared Resend setup is described in [the deployment guide](cloudflare-pilot.md#recovery-email-final-owner-handoff-pending). Keep the SMTP key in the provider settings, never in browser source or Git.
- Allow the exact pilot URL in Supabase Auth redirect settings. Check that the invite and magic-link templates preserve the confirmation link.
- Set the server-only Edge Function secrets `TITLE_INVITATION_EMAIL_ENABLED=true` and `TITLE_INVITATION_REDIRECT_URL=https://title-software-pilot.aaron-9c3.workers.dev/` after SMTP is ready. The API rejects non-HTTPS URLs, credentials, query strings and fragments. These are configuration values, not frontend flags.
- For an address outside the current pilot allowlist, review and configure its Cloudflare Access eligibility separately. An app invitation does not change that allowlist, including when an existing staff member uses an alternate email. The recipient should use the exact invited address at both sign-in steps.
- Perform one explicitly authorized send to a consenting test recipient. Verify receipt, callback, personal password, authenticator, intended company access and denial of another company's data. Test the email callback with and without an existing Cloudflare Access session. Synthetic tests do not replace this acceptance step.

A new account receives Supabase's invite flow. An existing account receives its sign-in flow with account creation disabled. Neither operation resets a staff password. The API never returns authentication links or tokens to the operator.

**Sent** means the email provider accepted the request, not that the recipient received it. Definitive rejection is **Failed**. A timeout or uncertain response is **Unknown**. A saved delivery-attempt ID is reused when retrying an uncertain HTTP response; this may finish the original request if it never reached the server. A deliberately new attempt after an unknown result can duplicate an email, and the UI says so. Calls are rate-limited per invitation, and in-flight attempts block new sends. Cancellation/revocation cannot recall an already submitted email, but its link cannot revive the canceled grant.

## First-time sign-in

Cloudflare's email-code check opens the private site. It does not sign the recipient into their workspace. After completing that check, open the setup email's sign-in link in the same browser. The app then prompts for a personal password and authenticator setup as required.

If the recipient instead reaches the app's Email/Password screen without a password, enter the invited email and choose **Set up or reset password**; the password field can remain blank. Open the requested email link in the same browser and finish the displayed security steps. This uses the existing account recovery flow, does not create an account or change company access, and gives a generic response regardless of account eligibility. An already-enrolled authenticator must still be verified when required.

After security setup, the app automatically claims the prepared invitation. The owner can refresh Team & access to verify **Accepted** and the intended role and company scope. A successful admin sign-in does not by itself test another staff member's company restrictions.

## Staff assignments

Connected task/order pickers list eligible, active accounts for the selected company. Order assignments require production access; task assignments also support onboarding and finance. The API resolves the current account email and stores the stable account ID. The database rechecks assignment eligibility during the save, including concurrent access changes.

Historical name/email-only assignments stay visible and can receive unrelated edits. A manual reassignment requires an eligible account. Existing rule-generated suggested owners are preserved pending configurable responsibility templates; they are not proof of an active staff assignment. No account is promoted or given company access by assigning work.

## Verification

Run from `web`:

```sh
npm run test:api
npm run test:members:ui
npm run test:daily-use:ui
npm run test:staff:assignment
npm run test:staff:sql
npm run typecheck
```

The SQL runner creates a disposable local PostgreSQL cluster and uses coordinated blocking sessions for concurrency cases. It never opens a configured database. HTTP/UI tests use fictional accounts and mocked provider transport; no emails are sent. The opt-in cloud runner is separate and requires an explicitly configured test project.
