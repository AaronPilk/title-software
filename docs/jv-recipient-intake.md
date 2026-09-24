# Joint venture applications

There are two ways to complete a company's private joint venture application. Both require staff review before an application is marked reviewed. Neither grants company launch approval or sends anything to licensing agencies, underwriters, or SoftPro.

## Returned PDF or scan

1. Open the company and upload the returned original under **Documents**, category **Applications**, visibility **Restricted**.
2. Open **Onboarding → Joint venture application → Open private application**.
3. Use the application reader in **Applicants** to read the original. The reader supports whole-document scans using the existing page-processing workflow.
4. Compare suggested values with their source pages. Map each source applicant to an existing person or a new applicant. Confirm any replacement of existing history rows.
5. Apply reviewed suggestions, check the remaining sections, and save the draft. Submit it for staff review when complete.

The reader captures clearly labeled identity/contact information, explicit ownership elections, business information, residence/employment rows, branding preferences, and notes. It flags conflicting answers, uncertain OCR, ambiguous dates, incomplete histories, and unsupported layouts for manual entry. Handwriting and arbitrary forms are not guaranteed to extract accurately. The original remains the authority; uploads do not train a model automatically.

## Private recipient form

1. Open **Company → Onboarding → Joint venture application → Private application links**.
2. Enter the recipient's name and email, then choose **Prepare private link**. This does not send an email.
3. Copy the link to the intended recipient, or choose **Send email** and confirm the destination. Sending replaces any previously prepared link. “Email accepted by provider” does not guarantee inbox delivery.
4. The recipient opens the link, receives a verification code at the stored email address, fills out the four sections, saves progress, uploads supporting documents, and submits.
5. A submission fills a pristine, unchanged private application and appears in the request list. If staff have already entered application information or an original changed, the submission waits for explicit review and application. Existing setup steps and original document links are preserved.
6. Use **Review submission** to inspect answers and download originals. Identity numbers are masked initially. For conflicts, compare the current private application before acknowledging replacement and applying the submission.
7. **Request corrections** makes the recipient form editable and prepares a new private link. Copy it or explicitly send the correction invitation. **Revoke link** stops recipient access; it does not delete saved internal records.

Links initially last seven days; a verified session lasts at most one hour. Reopen the original invitation for a new code when a session expires. Codes last at most ten minutes, with limited attempts/resends. Unsaved edits are cleared on session expiry; saved drafts remain available through the invitation. Submitted applications remain reviewable by authorized staff after link expiry. Up to 20 applicants and 40 rows per history are supported. Uploads allow PDF, PNG, JPEG, and plain text, up to 10 MiB per file and 40 MiB retained per invitation. Removed originals are retained for recovery and count toward that storage limit.

## Deployment and email setup

The public recipient page is a separate Cloudflare Worker, `title-applications`. It does not expose the staff application or weaken its Cloudflare Access/MFA requirements. Its same-origin API proxy calls only `title-jv-public`. The latter uses custom authentication: a server-only gateway key plus an invitation capability and email-verified session. The staff API remains JWT/MFA protected.

Configure these **Supabase Edge Function secrets**:

- `RESEND_API_KEY`: the application's Resend sending key. The password configured for Supabase Auth SMTP is not automatically available to Edge Functions.
- `JV_PORTAL_GATEWAY_KEY`: at least 32 random bytes, shared only between the recipient Worker and the dedicated Edge Function.
- Optional `TITLE_APPLICATION_EMAIL_FROM`: defaults to `Ballantyne Title <noreply@pilk.ai>`; the sender domain must be verified in Resend.
- Optional `TITLE_APPLICATION_PORTAL_URL`: defaults to the production recipient Worker URL in the source configuration.

Install the same `JV_PORTAL_GATEWAY_KEY` as a Cloudflare Worker secret on `title-applications`. Do not use a `NEXT_PUBLIC_` variable, put secrets in git, or paste them into application answers. If configuration is missing, the UI reports setup needed and email verification fails closed.

Build and deployment commands, from the repository root:

```sh
npm --prefix web run backend:build
npm --prefix web run build:pilot
npm --prefix services/title-applications run build
npm --prefix services/title-applications run check
```

Apply the reviewed `title_jv_recipient_portal` migration before deploying `title-api` and `title-jv-public`. The new recipient function, `title-jv-public`, uses custom authentication with JWT verification disabled; `title-api` retains JWT verification. Deploy the staff pilot and recipient Worker using their respective `deploy:pilot` and `deploy` package scripts.

## Verification

```sh
npm --prefix web run test:jv
npm --prefix web run test:jv:portal
npm --prefix web run test:jv:sql
npm --prefix web run test:jv:portal:sql
npm --prefix services/title-applications test
npm --prefix web run test:api
npm --prefix web run test:backend
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix services/title-applications run typecheck
```

The SQL suites create disposable local PostgreSQL clusters with a pgcrypto-backed Vault API fixture. They never use the hosted database. The recipient end-to-end test uses real UI, proxy, protocol and PostgreSQL migrations with captured fictional email and in-memory storage. Provider adapter tests exercise mocked Resend request and response behavior. They do not prove real provider acceptance or inbox delivery. The local round trip does not prove hosted Vault configuration or Supabase Storage behavior; those need a separately authorized fictional hosted round trip after configuration.

Private payloads remain in Vault, outside general workspace snapshots, assistant context, browser storage, and application audit messages. Tokens/codes/session credentials are stored only as hashes. Every recipient operation rechecks the inviter's current authority. Attached originals are registered atomically with application population, have byte/hash checks on downloads, and remain restricted to the same company.
