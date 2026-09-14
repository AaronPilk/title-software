# Hosted setup follow-up — September 14

The existing owner startup credential successfully passed Cloudflare Access and Supabase sign-in on the hosted pilot. The browser reached **Choose your own password**. Personal password entry and authenticator enrollment were handed to the owner; that handoff remains pending. This is not a completed hosted company/staff acceptance test.

A read-only status check confirmed one workspace, seven memberships, zero companies and zero assets. The owner still requires password setup and has no verified authenticator. No live company, invitation, staff permission, or client record was changed in this pass.

## Fixed setup problems

| Trigger | Result after the fix |
| --- | --- |
| Sign-out while the account/security lookup is still pending | The connection spinner clears and the sign-in form returns. The delayed lookup cannot reopen the old session. |
| Authenticator list request fails or returns no verified factors | The form explains the failure and offers **Retry authenticator** without requiring a page reload. |
| Auth accepts a new password but the database setup confirmation encounters a transient failure | Only the idempotent confirmation is retried, at most twice total with a four-second timeout per attempt. The original user, session and credential rotation remain bound to both attempts. |
| Setup confirmation still fails after Auth accepted the password | The API reports `password_setup_incomplete` with sign-in/recovery guidance. The form clears the submitted password and email verification code. It does not repeat the Auth password change or unlock records. |
| An existing pending invitation is resubmitted with different permissions | The API returns a clear conflict and preserves the existing grant. The form keeps the entered email and displays the error. An exact retry returns the original invitation and its actual status. |
| A non-owner administrator opens the staff invitation form | Only permitted roles are offered and an explicit company is required. Owner-only grants remain available to the owner. Pending invitations show their saved company scope and restricted-evidence flag. |

The password request has a 45-second client deadline to leave room for the existing Auth request and bounded database retries. Rotation and expired-session errors remain terminal. `same_password` and reauthentication errors never count as proof of a completed password change; Supabase documents them as separate Auth errors. [Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes).

## Verification

| Suite | Passing tests |
| --- | ---: |
| Domain | 221 |
| Backend/account/permissions | 112 |
| Missive adapters | 86 |
| Workflow helpers | 34 |
| Actual Edge HTTP handler | 51 |
| Actual account setup components | 8 |
| Actual staff invitation component | 7 |
| Missive Settings components | 11 |
| Connected workspace provider | 9 |
| **Total in this pass** | **539** |

The HTTP suites execute the actual Edge handler with synthetic Auth/database/provider transports. Thirteen new password cases and thirteen invitation cases supplement the existing twenty-five HTTP cases. Seven password regressions and six invitation regressions failed before their fixes.

The browser suites execute real React components with synthetic transport. They cover first sign-in through password/enrollment/challenge, invalid-code correction, factor retry, sign-out races, partial password completion, pending-invitation conflict/status, and owner/admin grant controls. These fixtures do not establish live password/MFA enrollment, staff access, SMTP delivery, or provider acceptance.

Typecheck, both Edge bundles, ordinary and private-pilot production builds, and deployment dry-run passed. New test files pass ESLint. The three edited UI components have the same existing diagnostics as the starting commit; this pass does not claim repository-wide lint is clean. The existing large-client-chunk warning remains.

Run the added browser suites from `web/` with `npm run test:auth:ui` and `npm run test:members:ui`. `npm run test:api` includes all three HTTP suites. Shared temporary-bundle suites should run sequentially.

## Hosted acceptance still to finish

1. Owner completes personal password and authenticator enrollment in the open pilot tab.
2. Create a clearly fictional company through the normal Companies form.
3. Prepare the intended company-scoped staff grant through Settings → Team & access.
4. The staff account holder completes their own password/authenticator setup and signs in normally.
5. Verify the assigned company is visible and unrelated company records are absent; then document the exact fixture IDs and cleanup outcome.

The current invitation feature records access for an existing verified account; it does not provision a new Auth account or send email. Pending invitation editing/revocation and multi-company selection in the staff form are separate remaining capabilities. This pass makes existing behavior accurate and reviewable without claiming those features are implemented. Company removal is also not exposed in the UI, so any live QA fixture needs an explicit, narrow cleanup plan.

Private evidence is saved under `.local/coordination/hosted-setup-2026-09-14/`. No credentials or authenticator secrets belong in this report or Git history.

## Release

Implementation commit `e3b422b` was fast-forwarded to main and pushed to GitHub. The private pilot frontend is deployed as `8e808a1e-4c7e-4305-9dab-e793d9d733a2`; `title-api` is version 12 with JWT verification enabled and bundle SHA-256 `b5b8abb3b9b6bbf933ebc54785595398f040020402962924ee16b96a49ddee61`. The event function remains version 3 and the migration count remains 15.

Cloudflare's existing seven-person Access policy protects both the hostname and Worker; preview URLs remain disabled. Anonymous requests return 302 at the pilot and 401 at the account API. These deployment checks do not replace the pending signed-in company/staff acceptance steps above.
