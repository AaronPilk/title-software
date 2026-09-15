# Hosted owner/company acceptance — September 15

The normal hosted owner session now opens the shared workspace after personal password setup and verified authenticator enrollment. This closes the owner handoff recorded in the [September 14 setup report](hosted-setup-2026-09-14.md).

## Live checks completed

- The existing owner session reaches the connected workspace normally, with no credential reset or bypass.
- The existing Ballantyne Title company is present and was not edited by this test.
- The Companies form created **QA Cedar Grove Title — Test Only**, using a fictional contact and `example.test` email.
- The save completed in Supabase; the company remained visible after a full page reload.
- Onboarding shows the QA case with its evidence checklist still unreviewed.
- Tasks shows the automatically created **Collect onboarding application**, assigned to the existing Stephenie display label and due September 16, the next weekday.

No orders, documents, approvals, ownership changes or provider imports were created. The QA company and its one automatic task are retained for the remaining staff test. Exact IDs and the narrow cleanup conditions are recorded only in ignored local evidence; cleanup must preserve the latest unrelated state and existing audit records.

## Staff acceptance remains pending

All six existing non-owner accounts still have Operations roles with no company assignments. They require their own personal password/authenticator setup. The owner session cannot substitute for a real non-owner acceptance check.

A proposed Operations invitation for Stephenie, limited to the fictional QA company, was filled into the hosted form for review. It has **not been submitted** and no staff permissions changed. It grants no Ballantyne Title access and sends no email. Once approved, the normal account sign-in/reconnect claims the invitation; there is no separate acceptance button. The non-owner test must then confirm that the QA company and its task are visible while the unrelated real company and its task are absent.

The browser-control tool requires action-time confirmation for staff access changes, and personal credential entry remains a user handoff. No new test credentials, privileged test routes or temporary Access bypass were created.

## Confirmed usability issue

The live Team & access list showed opaque account IDs for every colleague. The owner could not identify which person a membership belonged to when reviewing access. A bounded follow-up adds account email to the already workspace-scoped member response and displays a clear fallback when an identity cannot be resolved. It does not change roles, scopes, invitations or the existing administrator gate.

Identity requests run at most four at a time, with a three-second request timeout and an eight-second overall enrichment deadline. Failed, missing or mismatched accounts return an explicit unavailable email without hiding the membership. Requests use actual cancellation; no Auth profile metadata is returned.

## Automated verification

The final focused pass passed **417 tests**: 221 domain, 112 backend, 66 actual API handler, 10 member/invitation UI and 8 authentication UI. The 18 new directory checks include the real Supabase client against synthetic abort-aware transport and the real React component against synthetic responses. These tests do not substitute for the pending live non-owner check.

The first domain run exposed 12 date-dependent delivery fixture failures: preparation used the current system clock while recording used September 14. Freezing the test clock to the existing fixture date fixed the mismatch; an assertion now checks the prepared timestamp. Production delivery rules are unchanged.

TypeScript, focused lint, Edge bundles, ordinary and pilot production builds, deployment dry-run and whitespace checks passed. The existing repository-wide lint debt and large-client-chunk warning remain; neither is claimed resolved by this bounded pass.

## Released and checked on the hosted pilot

Commits `d1a52c7` (stable delivery fixture clock) and `be54d1c` (staff identities, regression tests and this report) were integrated fast-forward and pushed to GitHub. The deployed frontend is `33ec2e2f-1bbd-4550-ac77-e77f109103c5`; `title-api` is version 13 with JWT verification enabled, SHA-256 `4122ba57b9121fa00b9d871876ba1b4333a557c91031d3baa1e4a0180c426f3d`. The event receiver, assistant service and 15 applied migrations are unchanged.

The refreshed hosted owner session loaded the workspace and Team & access displayed all seven real account emails successfully. All six staff entries still explicitly showed **No company access assigned**. The prepared invitation remains unsubmitted; live non-owner isolation remains pending.

Cloudflare Access still protects both hostname and Worker through the existing seven-person policy; preview URLs remain disabled. Anonymous requests received HTTP 302 at the application and HTTP 401 at the member API. These checks did not create new permissions or read client documents.

Private evidence: `.local/coordination/hosted-acceptance-2026-09-15/`.
