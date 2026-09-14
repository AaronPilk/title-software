# Reviewed Missive import

**September 14 source update:** Connections, reviewed attachment bytes, signed event intake and local PDF text review are implemented and described in the [requirements implementation guide](REQUIREMENTS_IMPLEMENTATION.md). Its release status supersedes feature-status statements below; earlier hosted verification remains historical.

Settings → Shared workspace → Missive now supports a manual incoming-email pilot: verify the connection, approve one team inbox → company mapping, browse conversations, preview a message, choose an existing open title file and request type, and import after review. The backend is deployed as `title-api` version 5.

## Current live status — September 12, 2026

The seven requested accounts and the real owner workspace have been created. All seven logins and the staff company-scope restrictions were verified. The supplied Missive credential was tested once against the official organizations endpoint and returned **HTTP401**; no real mail was read. The rejected credential was not installed as a server secret. A replacement token and an approved inbox/company mapping remain pending.

Save a working REST API token as `MISSIVE_API_TOKEN` in [Title Software Edge Function Secrets](https://supabase.com/dashboard/project/yhneskzvmtcmbsknidlt/functions/secrets). The server binds it to the consumed owner-bootstrap workspace automatically. `MISSIVE_WORKSPACE_ID` is an optional explicit server override for a reviewed workspace move. Another workspace cannot use the global token. Saved secrets are picked up without a frontend rebuild. [Supabase secret management](https://supabase.com/docs/guides/functions/secrets)

After saving the token, sign in as the owner, create or select the actual company and title file, and complete the mapping and message review in Settings. Staff company access is assigned separately; default staff accounts currently have no company assignments. Initial account details remain in the private local handoff, outside Git.

## Preserved records and boundaries

- The inbox stores display text, immutable provider provenance, confirmed company/file, request kind, import actor/time, mapping version and source fingerprint.
- One immutable JSON source document retains the full HTML body and normalized sender/recipient/reply headers, raw subject, provider Message-ID/references, timestamps and attachment metadata. It is a retained message snapshot, not an RFC822 export. HTML is never rendered or used to load remote images. Long display text points to the complete source snapshot.
- **Attachment bytes are not downloaded yet.** Each provider attachment is explicitly `not_downloaded` and remains outside the document/evidence list. No placeholder document or fake download is created. Originals may be uploaded through the normal file-upload workflow; that is a separate reviewed source, not a claimed Missive download.
- The raw snapshot has no production source role. Importing text does not make a commitment/final policy stale or satisfy title evidence requirements. The snapshot cannot be promoted to a production evidence role.
- Imported routing is immutable. Capture a separate request if the original destination needs correction. Generic browser edits cannot create provider provenance, change it, or use the reserved source-ID namespace.
- Existing issued/locked files are excluded. Incoming commitment, revision and finals requests require explicit classification. Outgoing/author-present records and drafts are excluded. No auto-extraction, production transition, provider draft, outbound email or scheduled sync is triggered.

## Server behavior

All endpoints require confirmed Supabase authentication and current organization-wide administrator access. The token stays in Edge secrets. Provider calls use fixed HTTPS GET destinations, no redirects, a shared 20-second timeout per operation and a 1 MB response limit; errors and rate-limit responses are sanitized. There are no automatic retries.

Connection discovery reads the first 200 organizations/teams and flags incomplete directories. Conversation/message pages preserve every timestamp tie before advancing a cursor. Guest conversations without scope are omitted with a count; explicit scope mismatches fail. Merged conversations are checked against the current organization/team. Message preview and import both re-fetch and verify scope. A fingerprint change requires a fresh review.

The mapping RPC checks current membership, company existence and mapping version. The import RPC locks membership → workspace → integration, rechecks mapping and access, then calls the existing atomic revision/receipt/audit transaction. Two imports racing against one revision cannot both commit. Provider identity is deduplicated against canonical workspace provenance; the same message cannot silently move to another file. Request IDs remain bound to their exact input and actor.

An older backup can intentionally remove an imported record. A new reviewed import can restore it using a new request ID; existing receipts and append-only audit remain preserved. Imported records already present in a restored snapshot still deduplicate normally.

A team inbox is a current triage queue, not complete email-account history. Assigned/archived conversations can disappear, and merged conversations can contain several threads. Review the actual sender, recipients and body rather than assuming every message in a team came from one email address. [Missive API](https://missiveapp.com/docs/developers/rest-api), [endpoint reference](https://missiveapp.com/docs/developers/rest-api/endpoints), [rate limits](https://missiveapp.com/docs/developers/rest-api/rate-limits)

## Verification

- `npm run test:missive`: 24 adapter/domain cases × 5 rounds, all 120 passed.
- Existing 109 domain and 15 backend tests passed; TypeScript and production build passed.
- Migration transaction assertions ran five times against the real project. Mapping/revision conflicts, request replay/collision, wrong-company mapping and revoked access were tested. Every fixture rolled back; the database retains exactly one real workspace and seven memberships.
- Five live gateway rounds verified owner state, token-required status and blocked unconfigured connection/import requests. All six staff logins, empty company scopes and administrator-only integration access passed separately.
- Actual browser: owner login and live Settings/token-required state passed. An isolated synthetic harness exercised the real Missive component through mapping → queue → preview → file/type review → import, verified confirmation clears after a file change, and saved exactly one message/source while showing the attachment pending. No console errors.
- Supabase security advisor has no warning/error findings. The informational no-policy notices reflect intentional server-only tables with browser grants revoked. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

Live successful Missive discovery/import remains unverified because the token was rejected. Attachment ingestion, mailbox polling/webhooks and outbound drafts remain future work. The frontend stays on localhost; nothing was pushed to GitHub.
