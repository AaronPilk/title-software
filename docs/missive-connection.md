# Missive connection setup

The first step is a server-only connection check, available to the owner or an organization-wide administrator in Settings → Shared workspace → Missive. This is metadata discovery, not an email importer. No messages, attachments, contacts, drafts or outgoing mail are accessed by this implementation.

## Owner setup

1. Save the personal Missive token in the [Title Software project's Edge Function Secrets](https://supabase.com/dashboard/project/yhneskzvmtcmbsknidlt/functions/secrets), named `MISSIVE_API_TOKEN`. Do not put it in a chat, frontend environment variable or committed file.
2. Supply the first administrator email so the actual Title Software workspace can be created. A server administrator then sets `MISSIVE_WORKSPACE_ID` to that workspace's exact UUID in the same secrets area. This second value binds the project-level token to one application workspace; a different workspace's administrator cannot use it.
3. Sign in and click **Check Missive connection**. The check refreshes server configuration before contacting Missive, so newly saved secrets are picked up without a frontend restart.
4. Identify the first pilot email address, Missive organization/team or relevant resource IDs, and the title company it belongs to. Shared email accounts and team triage inboxes are different concepts. Message import requires a separate implemented and tested mapping/sync step.

Supabase makes saved Edge secrets available without another deployment. [Secret management](https://supabase.com/docs/guides/functions/secrets)

## Implemented boundary

`GET /integrations/missive` reads setup status after normal Supabase authentication and current membership checks. `POST /integrations/missive/check` requires the same checks plus the exact server workspace binding. A token is never accepted from the browser. Setup/check results are not persisted as an active vendor connection.

The adapter makes two sequential, fixed HTTPS GET requests: `/v1/organizations` and `/v1/teams`, each with `limit=200&offset=0`. It blocks redirects, uses a shared 20-second timeout and caps each response at 1 MB. Vendor errors are replaced with generic messages; throttling reports the vendor's `Retry-After` interval. There is no automatic retry. Only organization IDs/names and enabled team-inbox IDs/names/organization IDs reach the browser; member lists and settings are discarded. Full pages are explicitly marked potentially incomplete. Empty directories can verify token acceptance without proving access to a particular mailbox.

Missive tokens are personal and inherit the user's account access. Application filtering does not reduce the credential's underlying permissions. The REST reference documents organization/team pagination; Resource IDs are also available in Missive Settings → API. [Authentication](https://missiveapp.com/docs/developers/rest-api), [endpoints](https://missiveapp.com/docs/developers/rest-api/endpoints), [rate limits](https://missiveapp.com/docs/developers/rest-api/rate-limits)

## Verification and next step

Run `npm run test:missive` from `web/`. The nine isolated tests use synthetic responses: role/workspace isolation, server-token format, fixed GETs, redaction, empty/full directories, vendor failures/throttling, malformed/oversized bodies, and failure of the second request. No real Missive account is contacted by these tests.

Live verification requires the user's secret and first owner/workspace setup. The next implementation is one approved incoming-work pilot with inbox/company allowlisting, message and attachment deduplication, private document storage and reviewed file matching. Webhook rules and reply-draft creation remain separate future work. Existing internal reply approval does not send mail.

Verified September 12, 2026: nine adapter tests passed in five rounds (45 cases), the existing 109 domain and 15 backend tests passed, TypeScript and the production build passed. Supabase `title-api` version 4 is active; an unauthenticated request is rejected with HTTP401. Actual-token and authenticated browser checks remain pending owner/workspace setup. The adapter has not contacted a real Missive account.
