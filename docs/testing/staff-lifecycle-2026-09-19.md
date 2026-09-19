# Staff lifecycle and daily-use release — September 19, 2026

Implementation commit: `bc667c4`. Built in `codex/staff-lifecycle`, independently reviewed by three agents, fast-forwarded to main and pushed. No history rewriting. This batch implements the first two priorities from the September 19 readiness audit: staff access correctness and daily-use cleanup. Operator intake automation, reviewed field extraction, accounting posting and actual SoftPro execution remain later work.

## What changed

- Revocation and cancellation of outstanding grants now happen in one transaction. Claim, prepare, edit, renew and cancel use ordered locks, reviewed versions and retry-safe request identities. Existing usable invitations bind only to a uniquely matching current account; accepted/canceled/expired history is unchanged.
- Team & access supports company subsets, explicit restricted access, partner-member mapping per company, lifecycle status, edit/cancel/renew, and permission-aware controls. Saved changes remain distinct from refresh failures.
- Explicit setup-email delivery has an audited attempt ledger, new-user invitation versus existing-user sign-in, provider rejection/uncertainty handling, cooldowns and safe retry behavior. No automatic send on grant creation. Delivery is disabled by default until the owner configures the sender and server flags.
- Task/order assignments use authorized account identities and canonical emails. Database save rechecks current membership in the same transaction; concurrent revocation cannot authorize a new assignment. Company setup, manual intake-created orders and assistant-created tasks use this path. Historical suggested/display assignments remain readable.
- Updated deadlines/reporting periods use the existing Eastern business calendar. Permissions remove unusable controls and explain hidden onboarding evidence. Connected correspondence/report labels and Missive attachment status reflect actual saved data.
- A failed intake staff lookup can be refreshed without leaving its Save action stuck. Staff filters match legacy emails without overriding stable account IDs. Read-only roles make no unnecessary staff-directory requests.

## Verification

| Suite | Passed |
| --- | ---: |
| Domain | 221 |
| Backend domain/access | 112 |
| Actual HTTP handlers with synthetic transport | 147 |
| Missive | 86 |
| PDF text | 13 |
| Workflow helpers | 34 |
| Assistant | 17 |
| Local OCR | 18 |
| Auth setup UI | 8 |
| Member UI | 33 |
| Missive Settings UI | 11 |
| Workspace provider UI | 9 |
| Agency/Production/company UI | 39 |
| Daily-use UI | 29 |
| Assignment domain | 18 |
| **Automated total** | **795** |

Disposable PostgreSQL: 86 lifecycle + 62 email + 27 assignment assertions per round, five rounds = 875. Nine additional migration-backfill assertions bring the SQL total to **884**. **18 coordinated blocking-session concurrency scenarios** passed. Existing routing and shared-inbox pause suites also passed against the new migration stack. The three Missive import wrappers acquire the shared advisory lock before existing row locks, preserving their prior routing/receipt/job behavior while avoiding nested-commit lock inversions.

Typecheck, Edge bundles, ordinary build, pilot build, deployment dry-run and diff checks passed. Local browser checks confirmed a September 21 new-task deadline and January 2027 reporting selection without saving business records.

Full lint remains **48 errors, 44 warnings**, down from the audited 50 errors/62 warnings; this is not an all-green lint repository. Existing client bundle-size and framework route-classification warnings remain.

## Deployment and read-only checks

- Frontend: `fbc1582d-a1d2-4ceb-b9d1-17818ec23ba9`, confirmed at 100% traffic.
- Supabase `title-api`: version 14, active, JWT verification enabled. Retrieved deployed source exactly matches the verified bundle (SHA-256 `3ce9efb30dfac2c72d67286cf2638b0191b54c352d0356cdca5600a6e5df45ae`).
- Three new migrations applied; repository filenames align to hosted versions `20260919215301`, `20260919215303`, `20260919215304`. The original local creation timestamps changed only to match the deployment tool's migration ledger; SQL content did not change.
- Event receiver and assistant were not redeployed.
- Cloudflare Access still protects hostname and Worker, with seven approved entries and preview URLs disabled. A fresh browser visit reaches Access sign-in. Anonymous member API returns 401. New administrative RPCs remain unavailable directly to anonymous/authenticated browser roles and executable by the checked server role only.
- Business workspace remains revision 3: two companies, two tasks, zero orders; seven active memberships; one unaccepted/unrevoked invitation. Its existing recipient is now bound to the matching account. No role/company grant changes, staff impersonation, password resets or email sends. Delivery ledger contains zero attempts.

Security advisor: 13 informational RLS-without-policy notices for intentionally private server-only tables, including the new delivery ledger; no warning/error findings in that response. [Explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Performance advisor reports three existing uncovered foreign keys on bootstrap/Missive credentials, five unused indexes and the existing Auth connection-allocation notice; new invitation/delivery foreign keys have covering indexes. [Foreign-key guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Acceptance still needed

The hosted browser needs a fresh Cloudflare sign-in, so this release does **not** claim a signed-in hosted staff walkthrough. Synthetic Auth/provider/UI tests do not prove mailbox delivery, callback passage through Cloudflare Access or real non-owner company isolation.

Finish the [sender and access setup](../staff-access.md), authorize a real test email, and have each person complete their own password/authenticator enrollment. The owner must choose staff roles/company scopes. Test one real non-owner with permission to one fictional company and denial of another. No security gate was weakened to replace these steps.
