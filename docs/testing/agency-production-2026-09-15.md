# Agency and Production workspaces

The application now offers two connected work areas over the same permitted company and file records. Aaron confirmed that Stephenie and John should start in Agency and be able to switch into Production when helping Tyler. Tyler starts in Production. This is a presentation preference; account roles, company scopes and backend permissions are unchanged.

## Workflow split

| Agency | Production |
| --- | --- |
| Company/JV portfolio and ownership records | Incoming requests and file intake |
| Applications, formation records and onboarding | Orders, commitments and policy preparation |
| Licensing/underwriter handoffs | Revisions, finals and source review |
| Company documents and materials | File documents, tasks and follow-ups |
| Monthly company closes and partner reports, for permitted roles | Existing production controls and review gates |

The Agency home shows the available company portfolio, current onboarding next steps, recorded credentials needing review, ownership gaps and shared company follow-ups. It derives readiness from existing domain helpers and respects withheld application evidence: an inaccessible case is not described as missing or unreviewed. Production keeps the existing file dashboard and workflow screens with its own navigation.

The original Stephenie transcript supports company/member reports and the vault at 13:39–16:43; application → formation/EIN → John at 18:15–21:27; reusable company materials at 21:35–22:33. Tyler describes selecting the correct JV/profile before file work at 39:26–41:52, finals backlog at 63:52–65:04 and the attachment-to-policy workflow at 68:03–69:23. Stephenie also describes helping with finals at 06:34–08:20. See [transcript traceability](../discovery/all-transcript-traceability.md). Original transcript files remain local and ignored; no filings, policy issuance, messages or payments are automated by this UI change.

## Navigation and access

- The Agency/Production switch is available to internal staff. Partners keep their existing portal and account screens.
- The team's starting screens are configured from the named accounts in Aaron's request. Other accounts use their existing role as a starting suggestion. An explicit choice overrides that suggestion in the current browser.
- Preferences are stored separately per workspace and account; local demo personas have separate keys. Unavailable browser storage does not stop navigation.
- Routes include the area, such as `#agency/overview` and `#production/orders`. Existing links such as `#revisions` continue to work. Shared pages retain the current area; links into a page exclusive to the other area switch automatically.
- Initial demo hydration preserves incoming links. A later account/persona change restores that person's own starting view or saved preference.
- Company creation controls match the existing server rule: owner/admin/onboarding with all-company scope, or local demo. Operations users do not see an unusable Add company action. An open form disappears if that permission changes.
- Finance shortcuts/navigation follow existing finance roles. Partner search no longer offers internal company/order detail panels. Server enforcement remains authoritative.

Stephenie and John's current hosted accounts still have Operations roles. An Agency starting screen does not grant company-management, financial or restricted-record permissions. Their intended management roles and legal-company scopes must be assigned separately through the normal owner workflow.

## Verification

**371 tests passed:** 221 domain, 112 backend, and 38 real-component browser checks (15 company creation controls, 7 Agency dashboard, 16 view/navigation). Browser test transports and identities are synthetic; these do not establish real staff sign-in acceptance. The checks include defaults, reload, user/workspace isolation, legacy and explicit links, back/forward, unavailable storage, hydration, partner handling, visible evidence, permitted creation and role/scope changes.

Typecheck, focused new/changed-code lint, normal build, pilot build and deployment dry-run passed. Existing unused-symbol/image warnings and wider repository lint debt are not claimed resolved. The two existing shell ref-during-render errors were removed by moving optional demo-tool ref synchronization into an effect.

The actual locally running app was checked in desktop and 390-pixel mobile views: Agency dashboard, Production switch/navigation, and mobile drawer dismissal after switching. The mobile page had no horizontal overflow; captured console warning/error logs were empty. No real company or staff permissions were changed during this UI pass.

Stephenie's real account test remains paused because she is unavailable. Her valid QA-only invitation is saved but unclaimed; personal password/authenticator setup is still required. See the [hosted acceptance report](hosted-acceptance-2026-09-15.md).

## Release

Implementation commits `13d1c56` (company creation controls) and `d7be208` (Agency/Production views) were integrated fast-forward and pushed. Frontend version `58014f64-1360-49ca-a6ea-9a2e615fd1de` is deployed. The refreshed hosted owner session opened both Agency and Production successfully over the same two companies. The backend remains `title-api` 13, events 3, with 15 migrations; no backend redeployment was needed.

Cloudflare Access continues to protect the hostname and Worker for seven staff, preview URLs remain disabled, and anonymous application access redirects with HTTP 302. Main's ordinary local build was restored and the Codex preview on port 5175 restarted; its saved sample records still load under the new navigation. Temporary test browser tabs and the 5176 preview were closed. Hosted and local review tabs were left on Agency overview.
