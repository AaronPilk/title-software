# In-app developer feedback

Every signed-in shared-workspace user has a **Feedback** button near the bottom-right corner. Choose Problem, Idea or Question, write a note and select **Send feedback**. The confirmation appears only after the server has saved the report.

The report includes the user's verified email, the Agency/Production/Partner view and page where the draft began. It does not automatically collect screenshots, documents, record contents, browser history, console logs or authentication URLs. The message should describe the issue without passwords or unnecessary client details. Drafts stay in memory while navigating in the same signed-in session; reloading or changing account clears them.

## Review and reply

The workspace owner opens **Feedback → Feedback inbox** to see reports, set Received/In progress/Done and write a reply. Everyone else uses **My feedback** to see only their own reports and the owner's replies. Administrators do not receive access to other users' feedback merely by being administrators.

The inbox refreshes every 15 seconds while open and the browser tab is visible. Refresh pauses while the owner edits a response; **Refresh feedback** is also available. **Load older feedback** retrieves earlier reports. There are no external emails or public GitHub issues created by this feature.

## Persistence and permissions

Feedback is stored separately from company records in Supabase. It is not part of a company backup or a document archive. Access passes through the existing verified-session, password and authenticator checks. Every database operation rechecks active workspace membership and its version; only the workspace owner can read everyone’s reports or update status and replies. Direct anonymous/authenticated table and RPC access is revoked, with RLS enabled as defense in depth.

Submissions carry an idempotency ID. Retrying the same unchanged draft after an uncertain response returns the same saved report; reusing its ID with different content conflicts. Responses use a reviewed version so one owner session cannot silently overwrite another session's update. Reports are limited to 4,000 characters, replies to 2,000, requests to 32 KiB, and submissions to 10 per minute/100 per rolling day per person per workspace.

## Verification

From `web`, run `npm run test:feedback`, `npm run test:feedback:sql`, `npm run test:api`, `npm run typecheck`, and `npm run lint`. SQL tests use a disposable local database; browser and HTTP tests use synthetic identities and blocked external transport. A hosted owner submission/reload/reply check verifies the deployed path separately without logging in as another person.
