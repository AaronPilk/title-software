# Read-only hosted recovery acceptance

`ops/recovery/hosted-drill.mjs` checks an already restored, explicitly separate managed Supabase target against an authenticated encrypted recovery archive. It performs database reads and private Storage downloads only. It never clones/restores a project, installs a Vault key, edits rows, changes grants, activates scanning, changes provider settings or sends email. It does not read a source database credential or contact the source project.

The result is deliberately `incomplete`, with `productionReady: false` and `hostedRecoveryProven: false`. Passing these checks is useful evidence for the larger drill, not a declaration of complete recovery. See [the full recovery procedure](disaster-recovery.md) and [independent assessment scope](security-assessment-scope.md).

## Before running

An authorized operator must already have completed the provider-supported database/Vault restore and restoration of all intended private Storage objects to an isolated nonproduction target. Disable outbound email, webhooks, scheduled jobs and vendor integrations in that target before restoring or starting any application runtime. Restrict network and user access. A restored production cron job or capability must not become active merely because its database was copied. Record actual target isolation, configuration, key custody and source/target write-freeze evidence in a private register.

Supabase database backups cover Storage metadata, not the object bytes. Vault decryption also depends on a key outside the dump; a copied database with the wrong target key is insufficient. Use the documented provider-supported restore/key procedure and verify decryption afterward. This verifier does not retrieve or install root keys. [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Vault key portability](https://supabase.com/docs/guides/database/vault#key-portability-and-migration).

Use a trusted operator host, supported Node and `psql` with TLS support; the target must run PostgreSQL 16 or later for soft JSON input validation. Supply the target's direct database URL in an environment variable, with database `postgres`, port `5432`, exact hostname `db.<target-ref>.supabase.co`, a named operator identity and password, and no connection-string query parameters. Poolers, arbitrary hostnames, a source-project target and weaker TLS modes are rejected. Download and verify the target database root certificate through the provider dashboard; give its absolute file path in `sslRootCertPath`. The command pins `verify-full`, that CA file, and read-only transactions; it does not inherit arbitrary libpq configuration from the calling shell. [Supabase database TLS](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl), [PostgreSQL certificate verification](https://www.postgresql.org/docs/current/libpq-ssl.html).

The account needs sufficient read access to Auth, application/private/Storage metadata, relevant system catalogs and the linked `vault.decrypted_secrets` rows. The command does not grant itself access. Use a separately scoped target server Storage key in another environment variable. Archive decryption uses the original archive key, also through an environment variable. Do not paste credentials, keys or private application contents into configuration, command arguments, shell history, source control or chat.

## Configuration

Save this structure in a private operator file. Values below are placeholders, not verified operating evidence. Evidence references must match `EVIDENCE-` followed by 3–120 letters, numbers, underscores or hyphens and resolve to real records in the private register. The source write-freeze reference must exactly match the authenticated archive. Create exports with that evidence identifier; do not relabel an old archive to invent missing evidence.

```json
{
  "archiveKeyEnv": "TITLE_RECOVERY_ARCHIVE_KEY",
  "sslMode": "verify-full",
  "maxEntryBytes": 10737418240,
  "maxTotalBytes": 107374182400,
  "pgBin": "/absolute/path/to/postgresql/bin",
  "sourceProjectRef": "aaaaaaaaaaaaaaaaaaaa",
  "target": {
    "kind": "managed-supabase",
    "environment": "isolated-nonproduction",
    "projectRef": "bbbbbbbbbbbbbbbbbbbb",
    "databaseUrlEnv": "TITLE_RECOVERY_TARGET_DATABASE_URL",
    "storageUrl": "https://bbbbbbbbbbbbbbbbbbbb.supabase.co/",
    "serviceKeyEnv": "TITLE_RECOVERY_TARGET_STORAGE_KEY",
    "sslRootCertPath": "/secure/target-database-root.crt",
    "isolationEvidenceReference": "EVIDENCE-target-isolation",
    "configurationEvidenceReference": "EVIDENCE-target-configuration",
    "outboundDisabledEvidenceReference": "EVIDENCE-disabled-outbound",
    "targetWriteFreezeEvidenceReference": "EVIDENCE-target-freeze"
  },
  "drill": {
    "captureStartedAt": "2026-09-24T17:00:00.000Z",
    "sourceRecoveryPointAt": "2026-09-24T17:01:00.000Z",
    "captureCompletedAt": "2026-09-24T17:03:00.000Z",
    "recoveryStartedAt": "2026-09-24T17:04:00.000Z",
    "providerRestoreCompletedAt": "2026-09-24T17:20:00.000Z",
    "sourceWriteFreezeEvidenceReference": "EVIDENCE-source-freeze",
    "providerRestoreEvidenceReference": "EVIDENCE-provider-restore",
    "objectivesEvidenceReference": "EVIDENCE-approved-objectives",
    "keyCustodyEvidenceReference": "EVIDENCE-key-custody",
    "rpoMinutes": 60,
    "rtoMinutes": 240
  }
}
```

Replace the timestamps with the actual capture/recovery record. The authenticated archive's creation time must fall within the capture window. `sourceRecoveryPointAt` is the recoverable source point established by that consistent capture, not a guessed time copied from a successful download. `recoveryStartedAt` is the documented simulated incident/recovery start. Provider restore completion must precede the verifier. Objectives must equal the archived values and have management approval. Entering a reference or timestamp does not prove it; the report retains that distinction.

Run from the repository root:

```sh
node ops/recovery/hosted-drill.mjs verify /secure/title-hosted-drill.json /secure/backups/title-recovery-bundle
```

Output contains fixed check identifiers, statuses, generic explanations and timing metrics. It excludes host/project IDs, object paths, filenames, staff emails, document values, credentials and subprocess/provider errors. Private Storage bytes are hashed in memory as a bounded stream and not written to disk. Decrypted JV/recipient values remain inside SQL expressions; the client receives aggregate booleans only. Keep operator evidence and any report in restricted storage even when the report contains no payload data.

Exit `1` means invalid inputs, an operation stopped, or a reported failed check. Exit `2` means the verifier completed but required acceptance evidence remains incomplete/unverified. This command intentionally never returns an exit code that declares full hosted recovery success. Consumers must inspect each check, not convert exit `2` or `automatedChecksPassed` into a recovery claim.

## What the verifier establishes

- Every archive entry passed the existing `verifyBundle` authenticated decryption and digest checks before any target connection.
- Explicit source/target project references and exact managed endpoints differ; no source connection is made. TLS validates the target database hostname and certificate.
- Fixed, bounded SQL checks examine required structures, actual Auth/workspace/membership linkage, current document-to-asset/company binding, linked private JV/recipient decryption, browser role/table/schema/RPC privileges, RLS, evidence-table restrictions and scanner policy. Missing representative private data produces `unverified`, never a vacuous decryption pass.
- Retained, superseded and unfinalized asset rows are allowed without a current workspace document. Current documents with an `assetId` must resolve to the exact workspace/company/document asset. All private objects remain in the byte comparison, including unadopted/removed recipient files and uncatalogued originals.
- The complete target private Storage inventory must match the archive's names, byte sizes and registered reference hashes. Each actual target object is downloaded from the authenticated target origin and hashed against its archive entry; redirects, extra/missing/corrupt objects and byte bounds fail. Inventory versions/timestamps are compared before and after reads to detect changes. This comparison is not a distributed write lock.
- The verifier measures its real start/end and elapsed time. It calculates recovery-point lag from the supplied source point/recovery start and elapsed time since that start against the approved objectives. These figures are provisional because the source timing records and complete functional recovery still need validation.

## What remains outside this command

The current archive has no independent logical table digest/baseline that this reader can compare without restoring or interpreting the encrypted PostgreSQL dump. The tool therefore cannot establish complete database row equality, the exact correctness of decrypted fields, or absence of omitted Auth/business records. It also does not verify actual hosted login/MFA, token/capability invalidation, current cross-company/restricted/revoked access behavior, scanner reachability/signature freshness, outbound isolation, platform settings, external secret custody, monitoring, worker deployment or Durable Object history.

Those items remain explicitly `unverified`. Complete the separate hosted functional acceptance, provider/configuration review and independent evidence review before declaring recovery. Do not restore over production to make a check easier. Do not promote the target from this command.

## Verification of this tooling

```sh
node --check ops/recovery/hosted-drill.mjs
node --test ops/recovery/tests/hosted-drill.test.mjs
```

The tests start a temporary local PostgreSQL cluster with real application migrations and an existing pgcrypto-backed Vault fixture. They exercise actual encrypted payload decryption, linkage and grants; authenticate a real encrypted archive; and use explicitly simulated Storage transport for exact-byte comparisons and failure cases. The fixture includes current, superseded, unfinalized, unadopted, removed and uncatalogued originals. Negative cases cover source/target/TLS/evidence mistakes, corrupt archives/keys, grant/RLS changes, broken decryption, missing records, changed inventories and corrupt/unauthorized/redirected object responses. Tests do not contact a hosted project, read real credentials, establish hosted Vault cryptography or prove a real disaster-recovery drill. Injected transports are visibly labeled `simulated-transport` in results.
