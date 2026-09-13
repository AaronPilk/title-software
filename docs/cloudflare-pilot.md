# Private Cloudflare pilot

Deployed September 13, 2026 at **https://title-software-pilot.aaron-9c3.workers.dev**. This is the existing Ballantyne Title application with its shared Supabase backend, not a separate copy of business records.

## Deployment

- Cloudflare Worker: `title-software-pilot`; current version `0658e1d0-0993-42f4-bc7a-9860c109bc50`.
- Supabase project: `yhneskzvmtcmbsknidlt`; `title-api` version 7, JWT verification enabled. Nine migrations applied. Local filenames match the remote migration versions.
- Cloudflare Access protects the hostname and the Worker itself. The sole remaining policy allows the seven explicitly approved staff emails with an eight-hour session. Preview URLs are disabled; there are no extra routes or custom domains.
- Anonymous requests redirect to Cloudflare Access. Cloudflare's email-code gate is separate from the application's Supabase sign-in and authenticator check.
- The deployed bundle has no sample-workspace entry or account registration button. Missing hosted backend configuration fails closed. Local builds retain explicit sample mode.
- Only built web assets and the Worker are deployed. Recordings, transcripts, uploaded files, setup credentials and source context files are not part of the deployment.

The Supabase APIs are reachable independently of Cloudflare. Therefore every record, file, administration and Missive API route enforces verified account identity, a live Auth session, password setup, a verified TOTP factor and current membership/company permissions on the server. Cloudflare Access is an additional front door, not the backend authorization boundary.

## First sign-in

The owner is `aaron@pilk.ai`. All seven accounts received distinct temporary passwords. Every previous shared password was tested and rejected. Temporary sign-in requires choosing a personal password and enrolling an authenticator; the app does not expose records before those steps complete. Each person must scan their own authenticator QR code.

Private startup instructions and the temporary credentials are on the owner's Mac under the ignored `.local/pilot/` directory, with owner-only filesystem permissions. They must not be committed or published. No staff messages or credential emails were sent.

The real Ballantyne workspace has no business records yet. The owner has full workspace access. The other six accounts retain operations roles with no company assignments until the owner grants the intended scope in Settings. The deployment does not infer company assignments from email addresses.

## Password and recovery behavior

Private credential metadata records required setup and the session cutoff after an administrator rotates an initial password. Browser roles cannot alter it. The password endpoint uses the signed-in user's Auth API, retaining Supabase's password checks and secure-change behavior. The completion RPC locks the credential row and verifies the original rotation version and session before clearing setup.

Existing verified authenticators must be challenged before a recovery password can change. Recovery intent is captured when the Supabase client starts, before React may mount, and is stored per Auth session so refreshing midway resumes the password form. Session changes, sign-out and successful completion clear that intent. The marker only controls the screen; it grants no API access.

Auth Site URL is the HTTPS pilot address. The exact allowed redirects are that address and localhost ports 5173 and 5174.

## Recovery email: final owner handoff pending

The existing Resend account has `pilk.ai` verified. A dedicated key form is prepared in Chrome: **Ballantyne Title — Supabase recovery**, **Sending access**, **pilk.ai**. The owner must create the key, copy it into the prepared Supabase SMTP Password field and save. The browser credential policy requires this handoff. No new Resend key has been created and SMTP has not been saved by this deployment.

| SMTP field | Prepared value |
| --- | --- |
| Sender | `noreply@pilk.ai` |
| Sender name | Ballantyne Title |
| Host | `smtp.resend.com` |
| Port | 465 (TLS) |
| Username | `resend` |
| Password | New dedicated Resend sending key; replace any browser-autofilled value |

[Resend's Supabase SMTP instructions](https://resend.com/docs/send-with-supabase-smtp) describe this connection. Supabase's built-in sender is restricted to project-team recipients; successful email delivery to ordinary staff remains unverified until custom SMTP is saved and a real recovery email is received. [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp)

## Verification evidence

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
npm run build:pilot
npm run check:pilot
npm run deploy:pilot
```

Keep the existing Access application/policy and Worker destination protection. The deployment script rejects a normal local build or enabled preview URLs. It does not recreate Access if someone deletes it. Do not use a previous unprotected version as a rollback; rebuild the desired code with the current hosted/security configuration.

For local preview:

```sh
cd web
npm run build
npm run start -- --port 5173
```

Cloudflare runs independently of the Mac. This deployment used Wrangler directly; it did not push GitHub or enable automatic Git deployments.

## Next operational dependencies

Finish SMTP and each person's authenticator enrollment, then assign staff company access. A fresh valid Missive token and reviewed inbox/company mapping remain required; the supplied token previously returned HTTP401. SoftPro/underwriter, signature and accounting connections still depend on the actual vendor accounts and supported interfaces in [integration setup](integration-setup.md).

Server recovery points reference immutable files in the same Supabase project. They are not an independent disaster-recovery copy of the Storage bucket. Configure and exercise independent retention before using real closing records.

## September 13 sign-in follow-up

A reported invalid-credentials error was investigated using the intended owner account. The current temporary credential signed in successfully and the account required personal password setup. No account reset was needed. The login form now clears its password after successful authentication and sign-out, so a later sign-in cannot reuse an obsolete temporary password retained by React state. TypeScript, nine recovery tests, production build and deployment passed.
