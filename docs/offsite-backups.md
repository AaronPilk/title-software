# Encrypted offsite backup transport

**Status: implemented and tested locally; no hosted bucket, upload, scheduled backup or hosted recovery drill has been activated.** The user deferred paid scanner hosting; this backup destination still requires the account, retention and key-custody decisions below. A successful transport receipt is not evidence that production disaster recovery or immutable retention is complete.

`ops/recovery/offsite.mjs` transfers archives created by the [recovery tool](disaster-recovery.md) to a dedicated private R2 bucket through `services/title-backups`. All database dumps, original documents, Vault key escrow and private manifests remain encrypted. The Worker never receives the archive encryption key. Transport metadata contains random archive/destination IDs, encrypted file names, ciphertext sizes and hashes; it contains no original filenames, company names, emails or document contents.

## Account and retention boundary

Use a separately administered backup account with independent MFA, recovery contacts and credential custody. A bucket in the application's existing Cloudflare account is an **additional copy**, not independent account recovery. The configuration requires an explicit `same-account` or `independent-account` declaration and displays that boundary in every result. It cannot independently establish who controls the account.

Configure bucket locks before uploading and retain the provider settings/evidence outside the source account. Cloudflare [bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) block changes/deletion during their retention window, but authorized administrators can remove lock rules. They must not be represented as administrator-proof WORM storage, SOC 2 evidence by themselves or regulatory compliance-mode Object Lock. If that stronger immutability is required, select an appropriate independently controlled destination before activation.

This Worker offers no delete, overwrite, list, browser/CORS or public-download interface. Separate random writer and reader tokens restrict its operator API; conditional R2 writes prevent overwriting existing objects. Those controls do not prevent a Cloudflare account administrator, another bucket credential or a modified Worker deployment from altering the bucket. Limit account permissions and periodically review them. The transport reports `retentionVerifiedByTool: false` rather than treating a typed policy reference as proof.

## Deploy preparation

1. Approve the account, region/jurisdiction, retention duration, legal retention obligations, recovery owner, RPO and RTO. Create a dedicated **private** bucket; disable its public `r2.dev` endpoint/custom public domain. Do not reuse an application or unrelated product bucket.
2. Apply bucket retention rules and independent deletion controls. Save the settings and an actual blocked-overwrite/delete test using a fictional object. Review lifecycle rules for compatibility.
3. Copy `services/title-backups/wrangler.jsonc` to the approved deployment configuration. Replace the bucket placeholder and `BACKUP_SOURCE_ID` with the exact source project. Generate a random UUID as `BACKUP_DESTINATION_ID`, then set the account boundary honestly. Set the intended account and private operator route. The checked-in configuration has no live account, `workers_dev: false`, and rejects the placeholder values.
4. Set **different**, cryptographically random, 32-byte hex `BACKUP_WRITE_TOKEN` and `BACKUP_READ_TOKEN` secrets. Keep reader/recovery access outside the writer's normal credentials. Use an approved secret manager; do not paste credentials into source, command arguments, logs or chat. Deploy using the reviewed account and configuration. No deployment command is run by the transport tool.
5. Test fictional encrypted archives on the hosted endpoint: correct source/destination, writer/read separation, invalid digest, conditional overwrite rejection, bucket retention, interrupted upload and full download verification. Do not activate recurring production exports until the database/Storage consistency and recovery plan below is complete.

Worker requests are bounded to 8 MiB, so multi-gigabyte dump entries are split into sequential encrypted chunks. The Worker verifies request bytes before R2 storage. Each chunk and final receipt uses [R2 conditional create](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/); retries check the existing object's stored digest/size and never overwrite it. The Worker buffers at most one bounded chunk per request, caps body reception at 30 seconds, and logs only a generic failure code. Add account-level rate/cost alerts and an operator access policy when activating; this source does not claim a configured WAF or cost limit.

## Operator configuration and commands

Add this non-secret section to the private recovery configuration. It contains environment variable **names**, not credential values:

```json
{
  "offsite": {
    "endpoint": "https://approved-backup-operator-host.example",
    "destinationId": "REPLACE with the destination UUID configured on the Worker",
    "accountBoundary": "independent-account",
    "writerTokenEnv": "TITLE_BACKUP_WRITE_TOKEN",
    "readerTokenEnv": "TITLE_BACKUP_READ_TOKEN",
    "maxCiphertextBytes": 118111600640,
    "retentionEvidence": "REPLACE with independently verified bucket lock, account custody and retention evidence"
  }
}
```

The existing `archiveKeyEnv`, byte bounds and exact `source.id` remain in the recovery configuration. The tool verifies the complete authenticated AES archive **before any network request**, checks source/destination/account binding against the endpoint and checks every uploaded chunk. It signs the completion receipt locally with the archive key using a separate HMAC domain. The receipt is published only after every chunk passed the server's hash checks. It is bound to the archive UUID, source project, destination UUID, account boundary and full ciphertext inventory. Keep the archive UUID/destination recovery inventory in separate escrow so a lost operator machine does not make archives undiscoverable. There is deliberately no remote listing endpoint.

```sh
node ops/recovery/offsite.mjs plan /secure/title-recovery.json /secure/backups/title-archive
node ops/recovery/offsite.mjs upload /secure/title-recovery.json /secure/backups/title-archive
node ops/recovery/offsite.mjs fetch /secure/title-recovery.json ACTUAL_ARCHIVE_UUID /secure/recovered/new-archive
node ops/recovery/recovery.mjs verify /secure/title-recovery.json /secure/recovered/new-archive
```

`plan` performs local encrypted verification and opens no connection. `upload` needs only the writer token plus archive encryption key; `fetch` needs the separately held reader token plus archive key. HTTP redirects are refused so credentials cannot follow a moved endpoint. Source/destination mismatches, invalid HMAC receipts, wrong keys, missing/changed chunks and over-limit data abort.

`fetch` reassembles encrypted files in a private staging directory, verifies each ciphertext hash, then invokes the existing full AES/manifest verifier. Only a verified complete archive is published into an exclusively created new destination (0700 directory, 0600 files). Existing destinations are never replaced. An interruption marker blocks normal archive verification while files are being published; a handled failure removes this run's staging/new output. After a machine/process crash, discard any `.offsite-encrypted-*` directory or output containing `.offsite-incomplete`; do not treat it as complete. No database or original document is restored/decrypted to persistent files by this command.

Bounds: at most 100,000 chunks, each up to 8 MiB, with an explicit configured total ciphertext limit; the signed transport receipt is at most 8 MiB. An archive exceeding these limits is rejected before transfer, not silently split into inconsistent backups. Chunks without a final receipt are incomplete and may require operator cleanup after the retention window. The CLI does not delete them.

## Requirements before recurring backups and a hosted drill

The export requires a verified freeze covering all database and object writers. The existing inventory comparison does not implement that freeze. A scheduled job calling export without a real freeze or a reviewed versioned/consistent snapshot mechanism is not a valid recovery system. No scheduled production job is included here.

1. Configure the direct source database URL, source Storage key, independently escrowed Vault root key and archive key under the [recovery runbook](disaster-recovery.md). Verify export permissions and key correctness using an isolated target. No secrets were retrieved during this implementation.
2. Prefer Supabase's supported [restore to a new project](https://supabase.com/docs/guides/platform/clone-project) to exercise managed database/Auth/roles recovery without modifying production. It requires the source's paid/physical-backup eligibility and creates a separately billed project. Confirm account access and cost before creation.
3. Supabase's clone preserves the Vault root key, but [manual dump migration requires the original root key](https://supabase.com/docs/guides/database/vault#key-portability-and-migration). A database copy alone does not prove the separately escrowed offsite archive can recover after loss of the source account. That independent managed-archive restore path still needs implementation/provider validation; `restore-native` continues to reject managed-source archives.
4. Supabase [database backups exclude Storage object bytes](https://supabase.com/docs/guides/platform/backups). Restore the verified offsite original bytes into the isolated target, including unadopted recipient and retained removed files. Match every byte count/hash and database linkage. Bucket settings, Edge Functions and Auth/API settings need separate reconstruction.
5. Disable copied `pg_cron`, database webhooks and other external operations before permitting the isolated target to act. Keep outgoing email, Missive, DocuSign and accounting integrations disabled. Verify private-payload decryption, staff access boundaries, original downloads and audit persistence against the isolated target. Invalidate recovered sessions and portal capabilities before any future promotion.
6. Record measured RPO/RTO, archive/source/destination bindings, exact-byte checks, missing count zero and approval in an independently retained drill record. Only then activate monitored scheduling and document escalation for overdue/failed archives.

The preexisting native PostgreSQL drill covers database restoration locally. The new transport tests use authenticated encrypted **synthetic payloads**, native workerd and a real local R2 implementation; they prove transport integrity, not a hosted PostgreSQL restore or production retention policy.

## Verification

From repository root after installing the existing locked `web` dependencies:

```sh
node --test services/title-backups/tests/worker.test.mjs ops/recovery/tests/offsite.test.mjs
cd services/title-backups
npm run check
```

Tests cover multi-chunk round trips, reader/writer separation, concurrent create-only writes, signed receipt/source/destination binding, pre-upload AES verification, wrong keys, missing/corrupt chunks, capacity and streaming body bounds, existing-output protection, retry without replacement and no plaintext key/payload in stored transport objects. All provider resources in these tests are local/disposable.
