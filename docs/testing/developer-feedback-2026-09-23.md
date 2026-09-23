# Developer feedback verification — September 23, 2026

Feature commit: `243be25`. Signed-in workspace users can submit a Problem, Idea or Question and follow its status and the owner's reply. The workspace owner can review all reports and update Received/In progress/Done. Other roles, including administrators, see only their own reports and cannot update replies or status. See [the usage guide](../developer-feedback.md).

## Security and retry checks

- The actual API handler requires verified identity, completed password/authenticator setup and active workspace membership. Author identity and membership version come from the server. Database functions recheck membership and its version while holding the same lifecycle lock used by access revocation.
- Non-owner cross-user reads and unauthorized cross-workspace reads and updates are denied. RLS is enabled, and browser roles have no direct table or function access. Owner updates require the version the owner reviewed; concurrent conflicting updates cannot silently overwrite one another.
- An unchanged submission retry returns the original saved report. Changed content with the same request ID conflicts. Exact owner-update retries are also idempotent. Concurrent submissions enforce the per-person limits of 10 per minute and 100 per rolling day.
- Requests reject unknown fields, client-supplied authors, arbitrary page URLs, invalid cursors and malformed text. Messages are limited to 4,000 characters, replies to 2,000, and streamed requests to 32 KiB, including missing or forged content lengths. Pagination preserves timestamp microseconds.
- Independent review reproduced an account-switch race during asynchronous session lookup. Feedback requests now check the expected account before sending; the regression verifies that a different account cannot send, read or reply using the previous account's pending action. UI tests also cover late responses after workspace/account changes, stale refreshes, permission denial and paused polling while editing.
- Feedback context includes entered text, verified author identity and fixed page/view labels. Screenshots, documents, record contents, authentication URLs and console logs are not collected automatically. Feedback and replies render as plain text; no external email or public issue is created.

## Measured verification

| Check | Result |
| --- | --- |
| Combined actual API-handler suite | **251/251 passed** |
| Feedback feature suite | **56/56 passed:** 39 HTTP, 13 component/browser, 4 client-helper tests |
| Existing workspace/company/view browser regressions | **39/39 passed** |
| Disposable PostgreSQL | **118 assertions**, **9 coordinated concurrency scenarios**, and **4 direct browser-role denial probes passed** |
| TypeScript and full lint with zero warnings allowed | Passed in final command output |
| Pilot production build and deployment dry run | Passed |

The 39 feedback HTTP tests are included in both the API and feature counts; these totals must not be added as independent tests. This verification covers the affected suites, not a fresh run of every application suite.

HTTP tests execute the real Edge handler with synthetic Auth/database transport. Component tests execute the real forms with synthetic feedback transport; client tests control session completion. External network requests are blocked. SQL checks run against disposable local PostgreSQL with fictional users and records, including transaction races with access revocation and competing updates. These tests do not establish hosted mail delivery, real staff acceptance or hosted isolation between two signed-in people.

Private command evidence is retained under ignored `.local/coordination/feedback-*-2026-09-23.log`. The saved lint log contains an earlier failure; the final passing lint and typecheck were verified in command output rather than that superseded log. The API total was also verified in command output. Build output retains framework route-classification and bundle-size warnings; passing the build does not remove those warnings. No private recipient, feedback record, credential or client-document details are included in this report.

## Release and hosted acceptance

- Database migration `20260923173707_title_developer_feedback.sql` applied; `title-api` version **18** deployed.
- Frontend version **`f355db53-2892-4633-b4d6-0d5ea081c007`** confirmed at 100% traffic.
- **Hosted owner round trip completed.** Ordinary owner submission produced a saved receipt; a full reload retained the report. Updating its status to Done and saving an owner reply succeeded, and a second full reload retained both the status and exact reply. The browser error/warning log was empty. No staff impersonation, credential changes or permission changes were used.
- A separate real non-owner walkthrough remains necessary to establish hosted own-report visibility and denial of another person's reports. No staff impersonation is part of these checks.

Repeat from `web` with `npm run test:feedback`, `npm run test:feedback:sql`, `npm run test:api`, `npm run test:workspace:views`, `npm run typecheck` and `npm run lint`.
