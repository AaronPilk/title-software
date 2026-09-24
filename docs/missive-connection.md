# Reviewed Missive connection and import

Updated September 24, 2026. Multiple-company routing and encrypted workspace credentials are implemented. The pilot has a saved, verified credential. Production → Inbox now includes read-only live email and a separate Saved requests tab. A saved credential still needs reviewed company routes before mail is shown. See the [Production access release notes](testing/production-access-inbox-2026-09-24.md) for verification and hosted release status.

## The token issue is resolved

The previously saved token value omitted the literal `missive_pat-` prefix. The incomplete value returned HTTP 401; the complete token returned HTTP 200 against the official organizations endpoint. Read-only directory discovery found one organization and 21 team inboxes. Only directory metadata was inspected. No token value or real directory names/identifiers are stored in this guide.

This establishes a working token and directory access. It does not establish that routing is approved, that every intended message is accessible, or that a full live message/attachment import has passed. A replacement token is not required merely because of the earlier prefix error. Missive's token display name and “Never used” label are not substitutes for request evidence. See the [documented investigation and sources](research/vendor-integration-and-product-readiness.md#missive-protocol-and-the-token-question).

The documented REST base is `https://public.missiveapp.com/v1/`; requests send the **complete** personal token in `Authorization: Bearer …`. It inherits its owner's accessible accounts, including shared accounts. The application's company/inbox permissions remain essential because the provider token itself is not a mailbox-scoped read-only credential. [Missive REST API](https://missiveapp.com/docs/developers/rest-api)

## Connect a workspace

In the deployed pilot:

1. Sign in as the workspace owner or an administrator with access to all companies.
2. Open **Settings → Shared workspace → Missive account connection → Connect Missive**. Paste the complete token into the password input and select **Verify and save connection**.
3. The server checks directory access before saving the token encrypted in Supabase Vault for that workspace. Status responses contain connection metadata, not the secret. Workspace JSON, backups and audit detail do not contain the token.
4. Review and enable the intended inbox/company routes. Replacing or disconnecting the credential pauses existing routes and invalidates in-flight reviews; reapprove the destinations before resuming intake.

The pilot credential was saved and verified September 23. Legacy server-secret configuration remains a compatibility path for the designated owner workspace. An explicit workspace disconnection must not silently fall back to that global credential. Secrets do not belong in frontend environment variables, committed files or this guide. [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)

Company permissions are assigned separately from provider connection setup. Giving someone an app login does not automatically authorize every company, and connecting Missive does not send account invitations or messages.

## One company, many JVs, and shared inboxes

Version 2 routing stores multiple reviewed routes in one workspace, with capacity for up to 500 routes. It supports one company and portfolios such as approximately 25 JVs without requiring different source code or inventing extra workspaces. An inbox may serve several companies, and a company may use several inboxes.

A route means: **this Missive organization/team inbox is approved for this application company**. It does not mean every message in the inbox belongs to that company. The operator selects an active route, previews the actual message, chooses an existing open title file in that company, classifies the request and imports after review. Shared-inbox events remain unresolved until a permitted company/file destination is selected.

Routing changes retain imported source history, advance the routing revision and invalidate old browser reviews. Previously queued events that had a single destination preserve it when an inbox later becomes shared. Older single-route configuration is read compatibly. Company/file choice is still mandatory; there is no automatic mail classification or silent cross-company transfer.

A team inbox is a current triage queue, not complete email-account history. Assigned/archived conversations can disappear, and merged conversations may contain several threads. Review sender, recipients and body; neither an inbox label nor a thread alone proves the legal company or transaction. [Missive endpoint reference](https://missiveapp.com/docs/developers/rest-api/endpoints)

## Preserved records and attachments

- Reviewed message import retains immutable provider identity, confirmed company/file, request kind, actor/time, mapping version and source fingerprint.
- An immutable JSON source document keeps the message HTML and normalized headers, provider references, timestamps and attachment metadata. It is a source snapshot, not an RFC822 export. HTML is not rendered and cannot load remote images.
- Selected attachment bytes can be fetched from Missive and stored as private documents with source attribution, filename/MIME/size and SHA-256 metadata. Repeated imports deduplicate; an attachment-list entry by itself never claims that its bytes were downloaded.
- Attachment downloads use URLs obtained from a freshly verified provider response. Only exact administrator-configured HTTPS origins are accepted; redirects and credential forwarding to download hosts are disabled. Files are bounded and checked against their metadata and supported format.
- Source snapshots do not automatically become production title evidence, satisfy requirements or make a policy ready. Original source-role restrictions remain; any separate evidence classification requires its existing review workflow.
- Imported company/file routing cannot be rewritten through generic browser edits. Issued/locked files, scope mismatches and stale review fingerprints block import. Receiving an email or attachment never completes a title file or triggers a provider write.

Attachment origins must be configured in server-side `MISSIVE_ATTACHMENT_ORIGINS` after confirming the actual provider download host. Missive's published material does not establish a universal CDN origin; do not guess one or accept arbitrary download URLs.

## Signed event intake

The dedicated `title-missive-events` function verifies the raw request body's HMAC signature and queues bounded source metadata for review. It does not import a title change or execute a SoftPro action. Event ingestion, mapping checks, deduplication and reviewed import completion use database transactions; old pending work remains visible after routing changes.

The receiver currently targets the server-configured workspace. Configure:

- `MISSIVE_WORKSPACE_ID`: the intended workspace.
- `MISSIVE_WEBHOOK_SECRET`: the shared signing secret, at least 32 characters.
- `MISSIVE_WEBHOOK_RULE_IDS`: the reviewed rule allowlist.
- `MISSIVE_WEBHOOK_VALIDATION_ONLY=true` temporarily when validating a new rule. Correctly signed validation requests are acknowledged but queue no work. Record the actual rule ID, then disable validation-only mode before testing intake.

Use `https://<project-ref>.supabase.co/functions/v1/title-missive-events` as the callback. Keep signing secrets in server secret storage. Confirm the route and receiver configuration with a permitted representative message before enabling real intake. Separate independent customer workspaces also require a deliberate receiver/rule configuration; multi-company routing is not a claim that every future customer's webhook is already configured. [Missive webhooks](https://missiveapp.com/docs/developers/webhooks)

## Server enforcement

Connection management and reviewed import endpoints require current organization-wide administrator access. The separate live feed permits owners, administrators and operations accounts within their assigned companies; operations additionally requires explicit approval that the entire inbox contains only Production mail. Provider reads use fixed HTTPS API destinations, no redirects, bounded response sizes/time and sanitized errors. Directory pagination completeness is reported. Preview and import re-fetch scope and compare the reviewed fingerprint; stale reviews must be repeated.

Atomic database transactions recheck membership, workspace revision, selected route, routing revision and company before saving. Request receipts bind input and actor; imports and queue completion either commit together or roll back. The same provider message cannot silently move to a different company/file. Attachment commits retain immutable metadata and private asset identity. Credential rotation/disconnection pauses routes so work started with an earlier connection cannot proceed under an unreviewed destination.

An older backup can intentionally remove an imported record. A fresh reviewed import may restore it with a new request ID while existing receipts/audit remain preserved; records already in the restored state still deduplicate.

## Verification and remaining work

**Current release:** the complete token passed live directory discovery. Both migrations, `title-api` v10, `title-missive-events` v2 and the frontend are deployed. The combined suite passed 2,465 cases over five rounds, including 85 Missive/credential tests per round. Local routing/credential transaction tests and synthetic browser workflows passed. No live mailbox content was imported, the token remains to be installed through owner setup, and a signed-in hosted acceptance case remains pending. Directory access does not establish a successful live import.

**Historical baseline:** the September 12 release passed its then-current adapter/domain/backend checks, rolled-back transaction fixtures and synthetic message-review browser flow. It reported HTTP 401 for the incomplete token and no attachment download capability. The September 14 baseline subsequently added attachment bytes, signed event intake and stronger transactions; its recorded total was 454 tests per round across five rounds. The earlier “replacement token required,” “attachments pending,” “single mapping only” and “frontend localhost only” conclusions are superseded by this guide and the current release status.

Run `npm run test:missive` and `npm run test:missive:sql` from `web/`, plus the repository's backend/domain/browser checks. The disposable SQL runner requires local PostgreSQL tools and removes its synthetic database afterward. Current OCR has its separate real-raster browser suite, `npm run test:ocr`.

The live feed refreshes the selected inbox once a minute while its browser tab is visible; this is not a background mailbox synchronization service. Automatic mail classification, provider-side notes/labels/reply drafts, outbound sending, OneDrive automation and actual SoftPro reads/writes remain unavailable. Accounting and signature connectors have their own account-setup requirements. The signed event receiver and reviewed import must not be described as autonomous title processing.

## Read-only live email

In Production → Inbox, an administrator can review exact company/inbox matches retained from the earlier Missive company import and connect the reviewed list. Name similarity never creates a route. Missing, duplicated or shared inbox attribution requires manual review. This does not create title files, import attachments or send email.

General company inboxes are available to permitted owners/administrators. Before allowing operations staff to read a complete inbox, an administrator must explicitly approve its Production-only content in Missive Settings. Mixed agency/Production inboxes should remain administrator-only; use reviewed requests tied to title files for staff. Shared inboxes serving multiple companies, including paused routes, are excluded from the live feed.

The feed displays incoming message text and attachment names. It never marks messages read, moves/archives threads, creates provider drafts, sends replies or downloads attachment bytes. Message HTML is converted to plain text without remote image loads. Route, membership and credential versions are rechecked after provider reads; changed access clears the view. Originals and reviewed request imports remain separate workflows.

## Connection and review recovery

A failed connection-settings load now has its own retry control. If another administrator changes the credential, the form clears the entered token and confirmation, loads current metadata, and requires a fresh deliberate action. Connection changes discard delayed directory/message responses so an old preview cannot reappear after disconnect.

Message acknowledgement is tied to the workspace revision and an open file belonging to the selected company. A refreshed revision or unavailable file requires another review. If an import commits but the workspace refresh fails, the screen reports that the message or attachment is saved and asks for a refresh; it does not describe that committed import as unsaved.

Saved incoming events and route pausing remain usable without decrypting a token or reaching Missive. A shared inbox retains all configured company context while individual routes are paused; only active routes are offered for review. Pausing one JV does not assign its incoming work to the surviving JV.

Run `npm run test:api`, `npm run test:missive:ui`, and `npm run test:workspace:ui` for the new handler/component/provider regressions. These use synthetic transport and cannot replace one approved live staff walkthrough. See the [follow-up regression report](testing/release-regressions-2026-09-14.md).
