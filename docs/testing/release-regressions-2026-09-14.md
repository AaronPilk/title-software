# September 14 follow-up regression report

This pass investigated the released multi-company routing, workspace Missive connection and browser OCR features. All business examples, document fixtures and browser transports in automated tests are synthetic. No live email or title data was imported.

## Confirmed problems and fixes

| Trigger | Fixed behavior |
| --- | --- |
| Disconnect or replace the token while an earlier check/preview is pending | Request generations discard the delayed result; old connection data cannot return to the screen. |
| Another administrator changes the token before the current form saves | The API rejects the stale revision before provider verification. The UI clears entered secrets/confirmation, reloads current metadata, and requires a new action. SQL still enforces the final concurrency check. |
| Initial connection metadata cannot load | An explicit metadata refresh recovers without remounting the page. |
| Workspace records change after a message/file acknowledgement | Acknowledgement expires with its captured revision. Closed/deleted or different-company files cannot remain a valid destination. |
| An import commits, then fetching the new workspace fails | Import success remains visible. The workspace banner distinguishes a failed read from an unsaved command; a pre-existing failed write remains visible until resolved. |
| Credential decryption is unavailable | Settings metadata, stored events, receipt replay and route pausing do not require decryption. Provider reads still require the actual credential and existing authorization checks. |
| Inbox serves companies A/B, then A is paused before receiving an event | New source context retains both configured companies and no automatic company assignment. Active routes alone are offered; re-enabling A restores that choice. Historical single-company/imported events are preserved. |
| An ordinary scanned document is sideways or upside down | Staff can rotate the OCR raster by 90/180/270 degrees. Citations retain the applied orientation; changing orientation clears review acknowledgement. Original bytes stay unchanged. |

The final production-build smoke found and fixed a further mobile navigation issue: selecting a page left the sidebar drawer covering the destination. The sidebar provider now exposes its close action to shared navigation, including same-page choices, Settings, the brand button and hash changes. The rebuilt app passed 18 desktop routes, eight mobile routes at 390 × 844, the sample-case flow and five drawer navigation cases, with no runtime/console errors, failed local requests or horizontal document overflow. This supplements the 546 tests below. Typecheck, production/pilot builds and deployment dry-run passed again after this UI fix.

## Automated verification

All commands run from `web/`; shared temporary-bundle suites run sequentially.

| Command | Passing tests |
| --- | ---: |
| `npm test` | 221 |
| `npm run test:backend` | 112 |
| `npm run test:missive` | 86 |
| `npm run test:api` | 25 |
| `npm run test:pdf` | 13 |
| `npm run test:workflows` | 34 |
| `npm run test:assistant` | 17 |
| `npm run test:ocr` | 18 |
| `npm run test:missive:ui` | 11 |
| `npm run test:workspace:ui` | 9 |
| **Total for the combined follow-up pass** | **546** |

`npm run test:api` bundles the actual Edge handler and replaces only external transport. Its four initial regressions failed before the API patch and passed after. The expanded fixture enforces workspace filters and exercises the actual preview/import/receipt path. Credential provider failures, conflicting revisions, disabled/paused queues, retained single-company provenance and existing-source replay are covered.

The Missive UI runner uses real React Settings components and the real authenticated HTTP client with synthetic Auth/API/workspace responses. The workspace runner uses the actual connected provider, command capture, validation and server command execution with synthetic bootstrap/transport. These independently exercise delayed requests, failed reads, failed writes and committed imports.

The OCR suite executes real browser rasterization and Tesseract workers against synthetic PNG/PDF examples. A production Documents-route walkthrough also checked pending-read cancellation, closing and switching files, page/orientation review reset, clipboard source citations, and absence of runtime errors or leaked workers.

`npm run test:missive:sql` passed the existing 224 assertions across five rounds, plus five rounds each for multi-company routing, credential changes, and shared-inbox pause/re-enable. It starts and removes a disposable local PostgreSQL instance. Its Vault API stub verifies transaction behavior, not production cryptography.

Web and assistant TypeScript checks, both Edge bundles, production/pilot builds, and deployment dry-run passed. Focused lint on the new UI/test files passed. Repository-wide source lint has **52 errors and 68 warnings**; a clean archive of the preceding release has the same 52 errors and no newly introduced error category. Remaining errors include existing dynamic `any` annotations, React effect/ref rules and unescaped display text. Generated test bundles and pinned OCR vendor assets are excluded rather than linted as authored source. The existing large-client-chunk build warning remains.

## Deployment and live checks

- Cloudflare pilot: `7f29f5e4-6f4c-4c3a-be42-9865575b5c2d`.
- Supabase `title-api`: version 11, JWT verification enabled.
- Supabase `title-missive-events`: version 3, existing custom signed-event authentication retained.
- Migration: `20260914222408_title_preserve_shared_inbox_context.sql`; 15 migrations applied.
- Existing Access policy: seven approved staff, both hostname and Worker protected, preview URLs disabled.
- Anonymous pilot GET: 302. Credential API without a session: 401. Event GET: 405; POST: 503 while intake is unconfigured.
- Database advisor: twelve unchanged informational RLS-without-policy notices for intentionally server-only tables, no warning/error findings. [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Hosted counts: one workspace, seven memberships, zero assets/jobs and zero installed workspace Missive credentials.

The verified Missive token still needs owner installation through Settings, followed by approved inbox/company routing, attachment origins and signed-event configuration. A signed-in hosted staff acceptance case remains outstanding. Actual SoftPro operations still require supported vendor access. This report does not claim production email ingestion, production encryption acceptance or a completed SoftPro connector.
