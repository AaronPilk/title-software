# Private Cloudflare pilot

Deployed September 13, 2026 at **https://title-software-pilot.aaron-9c3.workers.dev**. This is the existing Ballantyne Title application with its shared Supabase backend, not a separate copy of business records.

## Current access update — September 23

The [developer feedback release](testing/developer-feedback-2026-09-23.md) records the latest frontend/API versions and hosted owner walkthrough. Custom SMTP and explicit setup-email sending are active. The private Access policy now contains eight individually approved email addresses after the owner invited an existing staff member at an alternate address; the eight-hour session, existing identities and hostname/Worker protection remain in place. An invitation alone does not update this separate allowlist. The September 19 deployment details below are historical.

## September 19 deployment snapshot

Updated September 19 with the [staff lifecycle and daily-use release](testing/staff-lifecycle-2026-09-19.md). The earlier [hosted owner/company acceptance pass](testing/hosted-acceptance-2026-09-15.md) remains the last signed-in hosted walkthrough. The [PDF requirements implementation](REQUIREMENTS_IMPLEMENTATION.md) records the wider feature scope and earlier verification; the latest report distinguishes live checks from synthetic tests.

- Cloudflare Worker: `title-software-pilot`; current version `fbc1582d-a1d2-4ceb-b9d1-17818ec23ba9`.
- Private assistant Worker: `title-personal-assistant`; version `deaaa4ea-6e0c-412c-a9d7-46ed5c557f03`. It is reached through the application service binding, with public Worker and preview URLs disabled.
- Supabase project: `yhneskzvmtcmbsknidlt`; `title-api` version 14, JWT verification enabled; source bundle SHA-256 `3ce9efb30dfac2c72d67286cf2638b0191b54c352d0356cdca5600a6e5df45ae`. Eighteen migrations are applied. Staff access lifecycle, audited email requests and atomic staff assignment checks are included. See the [staff access guide](staff-access.md) for email activation; no sender secrets were changed and no email was sent in this release.
- Dedicated `title-missive-events` version 3 uses raw-body HMAC authentication and has JWT verification disabled for Missive's webhook delivery. Its bundle SHA-256 is `e9fd64ac43e1ae89b027c1b1ed8395b9d19013d246c8d5ac95d0c7172000c774`. The deployed receiver remains inactive until its workspace, signing secret and rule IDs are configured.
- Cloudflare Access protects the hostname and the Worker itself. The sole remaining policy allows the seven explicitly approved staff emails with an eight-hour session. Preview URLs are disabled; there are no extra routes or custom domains.
- Anonymous requests redirect to Cloudflare Access. Cloudflare's email-code gate is separate from the application's Supabase sign-in and authenticator check.
- The deployed bundle has no sample-workspace entry or account registration button. Missing hosted backend configuration fails closed. Local builds retain explicit sample mode.
- Only built web assets and application/service code are deployed. Recordings, transcripts, uploaded files, setup credentials and source context files are not part of the deployment.

The Supabase APIs are reachable independently of Cloudflare. Therefore every record, file, administration, assistant-context and Missive API route enforces verified account identity, a live Auth session, password setup, a verified TOTP factor and current membership/company permissions on the server. Cloudflare Access is an additional front door, not the backend authorization boundary.

## First sign-in

The owner is `aaron@pilk.ai`. All seven accounts received distinct temporary passwords. Every previous shared password was tested and rejected. Temporary sign-in requires choosing a personal password and enrolling an authenticator; the app does not expose records before those steps complete. Each person must scan their own authenticator QR code.

Private startup instructions and the temporary credentials are on the owner's Mac under the ignored `.local/pilot/` directory, with owner-only filesystem permissions. They must not be committed or published. No staff messages or credential emails were sent.

The owner has completed personal password/authenticator setup and has full workspace access. The workspace now contains the owner's Ballantyne Title company and one clearly labeled fictional QA company retained for staff acceptance, each with an initial onboarding task. No live client files were created by the acceptance pass. The other six accounts retain Operations roles with no company assignments until the owner grants the intended scope in Settings. The deployment does not infer company assignments from email addresses.

## Password and recovery behavior

Private credential metadata records required setup and the session cutoff after an administrator rotates an initial password. Browser roles cannot alter it. The password endpoint uses the signed-in user's Auth API, retaining Supabase's password checks and secure-change behavior. The completion RPC locks the credential row and verifies the original rotation version and session before clearing setup.

Existing verified authenticators must be challenged before a recovery password can change. Recovery intent is captured when the Supabase client starts, before React may mount, and is stored per Auth session so refreshing midway resumes the password form. Session changes, sign-out and successful completion clear that intent. The marker only controls the screen; it grants no API access.

Auth Site URL is the HTTPS pilot address. The exact allowed redirects are that address and localhost ports 5173 and 5174.

## Recovery email: final owner handoff pending

The existing Resend account has `pilk.ai` verified. The earlier owner handoff prepared a dedicated key form in Chrome: **Ballantyne Title — Supabase recovery**, **Sending access**, **pilk.ai**. The owner still needs to create the dedicated key, enter it in the Supabase SMTP Password field and save; recheck the setup fields before doing so. The browser credential policy requires this handoff. No new Resend key has been created and SMTP has not been saved by this deployment.

| SMTP field | Prepared value |
| --- | --- |
| Sender | `noreply@pilk.ai` |
| Sender name | Ballantyne Title |
| Host | `smtp.resend.com` |
| Port | 465 (TLS) |
| Username | `resend` |
| Password | New dedicated Resend sending key; replace any browser-autofilled value |

[Resend's Supabase SMTP instructions](https://resend.com/docs/send-with-supabase-smtp) describe this connection. Supabase's built-in sender is restricted to project-team recipients; successful email delivery to ordinary staff remains unverified until custom SMTP is saved and a real recovery email is received. [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp)

## September 13 workflow and assistant verification

The [transcript recheck](transcript-recheck-2026-09-13.md) records the requirements, newly added features, and vendor boundaries. The completed combined suite ran **224 tests per round × five rounds = 1,120 passing cases**: 109 domain, 40 backend/context, 34 workflow, 24 Missive, and 17 assistant tests per round. Web and assistant-service TypeScript checks, private-pilot build, and ordinary local production build passed.

The real hosted browser pass covered **17 pages with zero browser errors** and a **390-pixel mobile viewport**. Live Workers AI acceptance exercised two specialist responses, explicit task proposal review/save, the stale-revision guard, and company-scoped conversation history. A separate colleague verified finals filters, missing-reference handling, persistence of a reasoned not-applicable decision, and member contact edits without changing ownership interests.

The staff assistant keeps personal conversations within the authenticated workspace/user and selected company/file. It runs at most two specialized forks and uses up to three eligible prior same-thread turns as bounded historical context. Current evidence is limited to permitted saved structured fields and document metadata; original file contents, OCR, email bodies, sensitive applications, and credentials are not read. Staff may edit and save a proposed task through the normal authorized app update only after context and revision checks. The model cannot send messages, issue policies, operate vendors, or move money.

QA teardown completed after the final acceptance pass. Synthetic assistant histories, the exact synthetic workspace, and two test Auth accounts were deleted. Post-cleanup checks confirmed **seven users, one real workspace, seven memberships, zero QA users, and zero company/order records in the real workspace**. Temporary Cloudflare QA policy/token access was deleted. The temporary `title-assistant-qa` function is a JWT-verified HTTP410 tombstone, version 3, bundle SHA-256 `b784ec7c0298be10a5411aca833380e1190d243f0b7946fa7a64932ba8dd2bcd`.

Cleanup required `20260913200011_title_completed_assistant_qa_cleanup.sql`, a narrowly guarded data-cleanup migration for the exact completed QA fixture and its audit/foreign-key children. The normal service role correctly cannot delete audit records. This brings the applied migration count to ten without changing the product schema. The ordinary local build was restored and the preview restarted on port 5173. HTTP 200, local sample navigation, and the truthful connected-pilot assistant invitation passed a fresh browser check with no runtime/console errors.

These results do not establish successful Missive mail ingestion, SoftPro operations, OCR, Docusign delivery, accounting posting, SMTP delivery, or payments. Those dependencies remain listed below.

## Earlier pilot verification evidence

The following results and cleanup counts describe the earlier pilot version, not the newly completed workflow/assistant pass above.

- Final local suite: **109 domain + 30 backend/security/recovery tests**, repeated **five times**: 695 passing cases. The separate **24 Missive tests** also passed.
- Five live backend rounds covered anonymous/direct database denials, company isolation, persisted edits, private uploads/downloads, restricted-file denial and snapshot restore.
- Five live password updates passed against the final version 7 endpoint. Five rolled-back SQL probes verified that a stale rotation version cannot clear a newer setup requirement and an unrelated session cannot complete setup.
- Hosted browser: sign-in, TOTP challenge, all **16 workspace pages**, and persistence after refresh. No browser errors in the navigation pass.
- Actual Auth recovery callback on a disposable account: authenticator challenge → password form → refresh while on that form → change password → workspace. This used an Auth Admin-generated test link without sending email; it does not establish SMTP delivery.
- TypeScript, hosted production build/deploy, and ordinary local production build passed. The existing large-chunk build warning remains.
- Supabase security advisor reports no warning/error findings. Its 11 informational RLS-without-policy entries are intentional: browser roles have no table/RPC access. [RLS advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- Performance advisor reports only informational items: the singleton bootstrap FK and Auth's fixed connection allocation. [FK advisory](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [Auth connection guidance](https://supabase.com/docs/guides/deployment/going-into-prod).

The disposable workspace, three test accounts and five uploaded test files were removed. The temporary Cloudflare service token and its policy were deleted. The provisioning function is an authenticated HTTP410 tombstone (version 7). Post-cleanup checks confirmed seven real memberships, zero QA users/assets, only the real empty workspace, anonymous HTTP302 and rejected temporary deployment access. Ephemeral keys, sessions, test passwords, TOTP secrets and the obsolete shared-password file were removed locally.

Non-secret verification manifests remain under ignored `.local/pilot/` and `.local/backend-verification/`.

## Rebuild and redeploy

From this repository, with the correct Cloudflare account authenticated and the ignored public Supabase frontend settings present:

```sh
cd web
npm run typecheck
npm test
npm run test:backend
npm run test:missive
npm run test:workflows
npm run test:assistant
npm --prefix ../services/title-assistant run typecheck
npm run build:pilot
npm run check:pilot
npm run deploy:pilot
```

The assistant is a separate service deployment: when its source changes, run its tests/typecheck and deploy from `services/title-assistant` before publishing the application that binds to it. Backend changes require the separately reviewed `title-api` build/deployment; the frontend deployment command does not deploy that API.

Keep the existing Access application/policy and Worker destination protection. The deployment script rejects a normal local build or enabled preview URLs. It does not recreate Access if someone deletes it. Do not use a previous unprotected version as a rollback; rebuild the desired code with the current hosted/security configuration.

For local preview:

```sh
cd web
npm run build
npm run start -- --port 5173
```

Cloudflare runs independently of the Mac. This deployment used Wrangler directly; it did not push GitHub or enable automatic Git deployments.

## Next operational dependencies

Finish SMTP and each person's authenticator enrollment, then assign staff company access. The supplied Missive token now verifies after restoring its missing `missive_pat-` prefix. It still needs saving in the deployed Settings form, followed by reviewed company/inbox routes. No live mail has been imported. SoftPro/underwriter, signature and accounting connections still depend on the actual vendor accounts and supported interfaces in [integration setup](integration-setup.md).

Server recovery points reference immutable files in the same Supabase project. They are not an independent disaster-recovery copy of the Storage bucket. Configure and exercise independent retention before using real closing records.

## September 13 sign-in follow-up

A reported invalid-credentials error was investigated using the intended owner account. The current temporary credential signed in successfully and the account required personal password setup. No account reset was needed. The login form now clears its password after successful authentication and sign-out, so a later sign-in cannot reuse an obsolete temporary password retained by React state. TypeScript, nine recovery tests, production build and deployment passed.

## September 14 follow-up regression release

The deployed frontend includes scan orientation controls, Missive stale-response/conflict recovery and accurate saved-versus-refresh-failed messages. The matching API/event functions are versions 11/3, with 15 applied migrations. The follow-up pass passed 546 tests plus disposable database transaction rounds. Existing repository-wide lint debt remains (52 baseline errors); see the [regression report](testing/release-regressions-2026-09-14.md). Owner Missive activation and a signed-in staff acceptance case remain pending.

## September 14 hosted setup follow-up

The subsequent setup release is frontend `8e808a1e-4c7e-4305-9dab-e793d9d733a2`, API version 12, event version 3, with the same 15 migrations. It fixes connection/MFA recovery, partial password completion feedback and conflicting pending-invitation feedback. The [setup report](testing/hosted-setup-2026-09-14.md) records 539 passing tests, deployment checks and the exact acceptance boundary: the real owner credential signs in, but the owner must finish personal password and authenticator setup before the live company/staff walkthrough continues. No live business records or staff permissions were changed in this pass.

## September 15 owner/company acceptance

The owner has completed password and authenticator setup. The actual hosted walkthrough created one fictional QA company, verified persistence after reload, and checked its onboarding case and automatic task. The owner's existing Ballantyne Title company was preserved. Aaron subsequently prepared Stephenie's QA-only invitation himself. It remains unclaimed while she is unavailable for personal password/authenticator setup; the six staff memberships still have no company scope.

The current release fixes the Team & access directory displaying opaque account IDs. A live check on the deployed build resolved all seven account emails. The [acceptance report](testing/hosted-acceptance-2026-09-15.md) records 417 passing focused tests, release versions and the remaining real non-owner isolation test. No complete staff acceptance or live provider integration is claimed.

## September 15 Agency and Production views

The current frontend adds Agency and Production navigation and separate home screens, following both call transcripts and Aaron's confirmed preference: Stephenie and John start in Agency, Tyler in Production, and internal staff can switch views. Preferences are separate per workspace/account. Existing records and backend permissions are shared; current Operations memberships have not been promoted to management roles.

The [workspace view report](testing/agency-production-2026-09-15.md) records 371 passing tests, desktop/mobile checks and real hosted owner acceptance. It also covers permission-aware company creation controls and accurate handling of application evidence hidden from an account. The backend, event receiver and migration count are unchanged.
