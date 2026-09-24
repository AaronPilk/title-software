# Production access and read-only Inbox — September 24, 2026

## Result

Production has its own company directory and narrowed workspace presentation. Actual operations accounts also receive a server-enforced subset: no company applications, ownership history, formation records, agency correspondence, marketing materials, accounting or staff administration. Direct hash navigation, source snapshots, asset reads and task edits enforce the boundary. Owner/admin account permissions remain unchanged.

The Missive live feed is separate from saved requests. Company routes use exact retained provider identities plus a fresh directory check; batch setup is explicitly reviewed and atomic. Whole shared inboxes are withheld. General company routes do not grant operations access; an administrator must separately approve an inbox containing only Production mail. The reader performs fixed-origin provider GETs and returns bounded incoming plain text and attachment names. It does not mutate Missive or download attachments.

Route, membership and credential changes invalidate in-flight reads. UI identity changes discard old messages/reviews. Operations uploads require a same-company title file. Hidden evidence cannot leave an apparently ready file with an unresolved external-change blocker removed from view.

## Verification

Synthetic checks completed during implementation: 221 domain tests; 129 backend tests; 384 API tests; 87 existing Missive tests plus 48 feed/HTTP/proposal tests; 65 workspace view tests; 32 daily-use tests; 54 document-allocation/storage tests including the two Production upload regressions; 20 new live-email/setup browser tests. Native disposable PostgreSQL tests cover credentials, roles, scope, route revisions, shared inbox denial and atomic route saves. Final administrator-approval checks also passed: 10 real-handler HTTP tests, 18 Settings browser scenarios, the 20 live-email/setup scenarios and the complete native SQL suite. Final typecheck, zero-warning lint, pilot build/dry run and Edge bundle passed. The new email and upload suites are included in CI.

All fixtures are fictional. Hosted owner browsing is not a substitute for Tyler's individual acceptance test. No membership/invitation changes or provider writes are part of the code release. Personal-account role confirmation remains a separate operational step.

## Release status

Hosted migration applied. New RPC execute privileges verified: service_role only; anon and authenticated denied. title-api v35 is active with JWT verification enabled. Staff Worker version 03439250-c382-4474-a0fa-6f750ddb6f20 deployed with existing bindings, keep-vars and protected host. Hosted owner verification confirms the simpler Production home, absence of agency tasks/activity there, and the dedicated 23-company Production directory without applications or ownership tabs. Owner review matched and connected 21 company inboxes by exact saved provider IDs; two companies had no unambiguous imported match and were left alone. Hosted integration is configured at routing revision22, with21enabled routes and0Production-approved whole inboxes. Real conversation lists, incoming message summaries, full plain-text message content and attachment names rendered successfully. No provider writes, attachment downloads or client-record imports were performed. No paid hosting or antivirus activation is included.

Post-migration Supabase security advisor reports only the 27 pre-existing informational RLS-without-policy notices for server-managed tables. These tables intentionally deny browser Data API access; no permissive policy was added. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Code release: `89549e4`, pushed to main. Individual Tyler role/invitation changes remain pending the user’s answer; no grant was changed. Live owner verification is evidence for administrator browsing, not proof of Tyler’s sign-in or company authorization.
