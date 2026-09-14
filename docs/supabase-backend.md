# Shared Supabase backend

Implemented September 12, 2026 for the existing Ballantyne Title application and its recorded-call workflows. The active project is **Title Software**, `yhneskzvmtcmbsknidlt`, in **us-east-2 (Ohio)**. The frontend now also runs as a [private Cloudflare pilot](cloudflare-pilot.md), deployed September 13. No SoftPro, Missive, DocuSign, accounting, underwriter, AI or payment account is connected by this change.

## What is implemented

- Supabase Auth sign-in, account confirmation, password recovery UI, explicit owner bootstrap and prepared staff/partner access invitations.
- Owner, organization administrator, operations, onboarding, finance, viewer and partner roles. Membership is checked from the current database on every request. Company assignments and restricted-document access are independent grants.
- Shared persistence for existing company/onboarding, order, source capture, commitment, policy/CPL, correction, revision, follow-up, task/rule, materials/publication, accounting import, close and statement-delivery workflows.
- Immutable private uploads, scoped downloads, document-version history and server recovery points. An owner restore checks referenced files, preserves audit history and saves the pre-restore state atomically.
- Server-owned audit and request receipts; expected-revision writes and request deduplication prevent silent overwrites and duplicate execution after a network retry.
- A separate local sample mode preserves existing localStorage/IndexedDB work. Enabling shared mode never uploads that browser state automatically.

## Architecture and trust boundary

`supabase/functions/title-api/index.ts` authenticates the bearer token with Supabase Auth, loads the current membership and invokes `web/lib/backend/workspace.ts`. The browser sends named domain actions or narrowly allowed draft-field edits. The server independently replays the actions against its canonical state, binds the actor, validates workflow transitions, enforces company scope and protects issued/reviewed history. It never accepts an arbitrary replacement workspace from the browser.

The current application model is persisted as one versioned JSONB snapshot per workspace. Relational tables separately store membership, invitations, audit, command receipts, immutable asset metadata, recovery points and future integration/job state. This preserves the already-tested business model while making each save atomic. Workspace-wide serialization is a deliberate initial capacity limit: unrelated simultaneous edits can conflict and require refresh; it is not yet a high-volume normalized transaction store.

The public tables have RLS enabled and no browser grants or policies. This is intentional default-deny: neither anonymous clients nor signed-in users can read/write snapshots or execute privileged RPCs through the Data API. Only the authenticated, authorized Edge API uses the service role. The service key is never bundled into the frontend. The security advisor's informational “RLS Enabled No Policy” entries describe this design; they are not missing browser permissions. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

Private bucket: `title-documents`. Downloads are authorized at request time and proxied through the Edge API; no public file URLs are used. Restricted source documents also withhold dependent orders/evidence snapshots from accounts lacking that grant. Partners receive only specifically published documents and their assigned allocations, with internal fingerprints and other members' data removed.

## Local setup

From `web/`, copy `.env.example` to the ignored `.env.local` and fill the project URL and publishable key, then run `npm ci` and `npm run dev`. The Mac's main checkout is configured for the verified project. Both values are browser-safe; private credentials do not belong in these variables.

Without these settings the app opens its existing local sample mode. With them it starts at sign-in; “Open local sample workspace” is still available.

Auth Site URL is `https://title-software-pilot.aaron-9c3.workers.dev`, with exact redirects for that URL and localhost ports 5173 and 5174. Password minimum length is 12, leaked-password protection and secure password change are enabled, and secure email change remains enabled.

## First administrator and staff

The intended owner and six staff accounts are now provisioned. The bootstrap is consumed and bound to the real owner workspace. On a fresh project, a server administrator inserts the intended owner's exact email into `title_bootstrap` once. After that person verifies their account and signs in, the one-time claim creates an empty Ballantyne workspace and its owner membership. Signing in first does not make an arbitrary account an owner. Never include an owner's email or credentials in a public migration.

The owner can prepare access under Settings → Shared workspace. These invitations create access records; **they do not send email**. A verified account with the same email claims the prepared scope on sign-in. Revocation blocks subsequent API and file requests even with an existing token. Preparing a new invitation can reactivate that account with revised permissions.

Supabase's default test email service only reaches approved project-team addresses. Configure the business's custom SMTP sender before onboarding ordinary staff or partners; outgoing confirmation/recovery delivery was not tested with a real recipient. [Supabase SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp)

## Migrations and function deployment

Apply the checked-in migrations in chronological order. They include explicit follow-up fixes discovered on the actual project. `npm run backend:build` bundles the Edge entrypoint and existing domain modules into the ignored `supabase/functions/title-api/bundle.js`. Deploy that generated bundle as `title-api` with JWT verification enabled. The initial backend shipped as function version 3. Version 5 adds reviewed Missive inbox/company mapping and message-text import, described in [missive-connection.md](missive-connection.md). Nine migrations are applied. Version 7 enforces password setup and live-session TOTP; the September 13 follow-ups verify rotation races and remove completed pilot QA. See the pilot guide for current validation and cleanup evidence.

Application conflicts use the PostgREST `PT409` code. A PostgreSQL serialization code caused the gateway to keep retrying a deliberate stale-write rejection during the live race test; the explicit HTTP conflict code fixed that behavior. Do not replace it with `40001` for application-level conflicts.

## Verification

On the final backend implementation:

- **109 domain tests + 15 backend tests**, repeated **five times**: all 620 test cases passed.
- **Five cloud integration rounds**: each passed verified sign-in, unauthorized/direct database denials, role/company isolation, valid commands, invalid issuance rejection, identical-request replay, changed-request rejection, concurrent saves, private upload/download, restricted file denial, snapshot recovery, membership revocation and re-invitation.
- Owner bootstrap: outsider could not claim; intended verified test owner received an empty workspace; repeated claim did not create another.
- Browser: sign-in; create company and onboarding task; full reload preserves the company; all sixteen connected routes rendered without errors after a clean reload, both populated and empty. A transient development hot-reload context error during source edits was cleared by the clean reload before this pass.
- TypeScript check and production build passed. Build retains the existing large-chunk warning; no build failure.
- Supabase security advisor: no warning/error findings. Intentional default-deny RLS entries are informational. Performance advisor only reports informational items for the singleton bootstrap, new unused indexes and current Auth connection allocation.

Run `npm test`, `npm run test:backend`, or `node scripts/backend/verify-five.mjs` from `web/`. The live suite requires explicit `TITLE_TEST_SUPABASE_URL`, `TITLE_TEST_PUBLIC_KEY`, `TITLE_TEST_KEY_FILE` and ignored `TITLE_TEST_ARTIFACT_DIR` values. It uses synthetic confirmed test accounts, never sends emails, and records exact fixture IDs for targeted cleanup. It must not be pointed at a project without authorization to create test fixtures.

All 13 temporary QA workspaces, 10 uploaded test files and five test accounts were removed after verification. That cleanup was followed by the real owner claim and six staff memberships. The real workspace is empty of business records; staff company assignments remain pending. Local verification manifests remain under ignored `.local/backend-test/`; copied privileged keys and temporary account credentials were removed.

## Remaining external dependencies

See [integration-setup.md](integration-setup.md). This implementation supplies the shared application backend; it does not replace vendor entitlement, existing templates, approved underwriting/rate rules or actual third-party credentials. Integration/job tables are a foundation, not functioning mailbox polling or signature/accounting workers. Policy and delivery records remain reviewed internal records with manual external references until those vendors are connected. Server snapshots retain immutable file references; they are not an independent off-site copy of the storage bucket. Configure separate disaster-recovery retention before live rollout.

## September 12 account and Missive continuation

Seven requested accounts were created through an expiring, narrowly scoped provisioning function using Auth Admin. Existing accounts/passwords were never overwritten. The temporary function was immediately replaced with an authenticated HTTP410 tombstone and verified. No setup email was sent. Those original shared initial passwords were superseded on September 13 by distinct temporary passwords (see the pilot guide); staff roles are operations with no companies pending assignment. Current Missive verification and outstanding dependencies are recorded in [missive-connection.md](missive-connection.md).

## September 14 connected workflow fixes (F02/F03)

Task waiting, dated ownership and per-recipient document delivery now pass through the shared backend's named action registry. The existing forms previously worked in local sample mode but their new actions were rejected by the connected gateway. The gateway replays the same reviewed domain transitions with the authenticated actor and exact input fields; arbitrary history edits remain disallowed.

| Workflow | Permitted staff roles |
| --- | --- |
| Start or resolve task waiting | Operations, onboarding, finance, owner, admin |
| Record dated ownership | Onboarding, owner, admin |
| Prepare, record, fail, retry or cancel document delivery | Operations, owner, admin |

Existing company assignments and restricted-source grants still apply. Delivery and ownership collections participate in projection and mutation-scope checks. Waiting history stays nested inside its task. Partner views omit all three internal histories.

Normal task creation now accepts the form's creation field while replacing it with the server's execution timestamp. Domain-generated tasks also receive that timestamp. Later edits cannot change it; existing tasks without a timestamp retain an unknown creation date.

Absent legacy delivery/ownership collections normalize to empty arrays on copies. Present malformed data is rejected. Validation checks history semantics, canonical company/file/document references, retry chains and preparation/outcome chronology. Historical delivery links use immutable document identity so later source-category reviews preserve the captured history; eligibility for a new retry still uses the domain's current-source rules. Backup restore invokes this validation before the database restore operation.

Verification on the combined source tree: **339/339 automated tests** (179 domain, 85 backend, 34 workflows, 24 Missive, 17 assistant); web and assistant typechecks; Edge bundle and production build. Backend coverage includes 45 new cases for command capture/replay, roles, scope, timestamps, legacy snapshots, history validation and atomic rejection. The existing assistant-context fixture now supplies its authenticated recorder instead of creating anonymous source evidence.

A production-build browser pass submitted ten command batches through the real connected provider, command capture, gateway execution and projection. It created a task, started/resolved waiting, recorded opening ownership, prepared/failed/retried/recorded delivery, cancelled another preparation and reloaded saved history, with zero console/runtime errors. Auth and API transport were intercepted with synthetic fixtures; this verifies application integration, not hosted authentication or database execution.

These September 14 fixes are committed source changes only. They require redeploying `title-api` to reach the hosted pilot. No migration, live-data changes, push or deployment was performed for this fix.
