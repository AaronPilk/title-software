# Database, Vault and original-file recovery

`ops/recovery/recovery.mjs` provides a read-only export plan, an encrypted database/private-object archive, streaming integrity verification, a managed recovery plan and an executable isolated native PostgreSQL restore. It uses Node built-ins and PostgreSQL executables; it has no cloud deployment or key-management write capability. A passing local drill is not evidence that production disaster recovery has been completed.

## What is captured

- A full `pg_dump --format=custom`, including Auth, memberships, workspace metadata, audit, `title_private`, JV intake/recipient records and Vault ciphertext. No decrypted-Vault view is queried. Database dumps include view definitions, not decrypted view results.
- `pg_dumpall --roles-only --no-role-passwords`, preserving role settings, ownership prerequisites and membership semantics without copying role password hashes. Custom database role passwords require independent reset/recovery.
- Every object listed in every private `storage.buckets` bucket, using `storage.objects` directly. Selection does not depend on a workspace's document list or a staff member's projection. This includes unadopted recipient originals, removed originals still retained in Storage and otherwise uncatalogued private objects. Public bucket bytes are excluded; their database metadata remains in the full database dump.
- For managed sources, an explicitly supplied 64-hex-character Vault root key, encrypted inside the archive, plus its fingerprint and an independent escrow evidence reference. The tool does not fetch or install managed keys.
- Checked-in SQL migrations, Supabase configuration and the two existing service Wrangler configurations as encrypted source evidence. These files describe the checkout; they do not establish which migrations/configuration are deployed. The configuration reference must identify the actual deployed code and provider settings.

Assistant Durable Object history, Worker/Edge secrets, SMTP credentials, provider accounts, DNS/Access configuration, role passwords and external business systems are not recovered by a PostgreSQL dump. Record their recovery procedures in the separate configuration inventory. Decide explicitly whether assistant history may be lost or needs a separate independent backup. No tool here exports assistant history or retrieves those credentials.

## Vault and managed-platform boundary

Supabase documents that Vault encryption keys are held outside database data. Current documentation says the project root key is retrievable through the Management API `pgsodium` endpoint; a manual migration into another project needs the original key installed there. Supabase's supported in-place/PITR, restore-to-new-project and branching flows preserve/copy the key. This tool neither retrieves nor installs that key, and an exported fingerprint only identifies the supplied escrow key; a target decryption test must establish that it is correct. [Supabase Vault](https://supabase.com/docs/guides/database/vault#key-portability-and-migration)

Supabase database backups contain Storage metadata rather than object bytes. A database recovery cannot bring back a missing original on its own. [Supabase backups](https://supabase.com/docs/guides/platform/backups)

The managed export requires the exact source project database hostname (`db.<project-ref>.supabase.co`), database `postgres`, matching Storage origin and explicit key-escrow prerequisite. Connection poolers and arbitrary hosts are rejected to avoid mixing different projects. Use a direct read-capable database credential and the matching server-side Storage key through an approved secret manager. If the role cannot dump managed schemas or role definitions, the operation fails and leaves no completed archive; do not remove schemas to make it pass. Arrange an appropriate provider-supported export or credential instead.

`restore-native` refuses managed-source archives. A fresh Supabase project has provider-managed schemas, roles and extensions; blindly replaying a full native dump into those structures is not a supported implementation here. `restore-plan` lists the prerequisites for a separately authorized provider-assisted nonproduction recovery. No managed SQL/key restore, production data export or hosted restore drill was run in developing this tool.

## Before an export

Assign an accountable operator, approved retention location, maximum recoverable data loss (RPO) and recovery-time objective (RTO). The example's 60/240-minute values are examples for replacement and approval, not measured service guarantees.

Store the backup in an independent account/location with immutable retention or object lock, narrowly scoped write access, separately controlled deletion and periodic access review. Keep the archive-encryption key and Vault root-key escrow recoverable outside the source project and outside the backup writer's routine credentials. Record custody and recovery access. This CLI creates a local encrypted artifact; it does not upload, schedule, enforce immutable retention, rotate keys or verify a third-party retention policy.

Use a protected operator machine and a private output directory. Copy `ops/recovery/config.example.json` to an approved location, replace all placeholders and set only environment-variable **names** in the JSON. Obtain actual credential/key values through the approved secret manager without putting them in shell history, arguments, source control, a run log or the configuration file. The archive key must be 32 cryptographically random bytes encoded as 64 lowercase hex characters. Password-derived hex strings are not acceptable.

Pause every application writer, recipient upload path, scheduled job, integration and direct operator write for the complete capture window. Record the freeze procedure/run reference in `source.writeFreezeReference`. The tool does not impose a distributed write lock. PostgreSQL's dump is internally consistent, but database/object cross-system consistency requires this external freeze. Storage name/size/version/update-time inventories are compared before and after capture and a changed inventory aborts; that check cannot prove nobody modified unrelated database state. Never substitute an arbitrary label for a verified freeze.

The source environment variable is a PostgreSQL URL with no query string. TLS defaults to certificate/hostname verification; only the isolated loopback fixtures may disable it. PostgreSQL passwords are passed through child-process environment variables, never command arguments. Child stderr is discarded because errors can contain private SQL/values. Output contains only generic statuses/counts, archive ID and the non-secret operator plan.

## Plan, export and verify

Run from the repository root with a supported Node runtime and matching PostgreSQL tools (`psql`, `pg_dump`, `pg_dumpall`, `pg_restore`). Optional `pgBin` selects an explicit executable directory. The database server and client compatibility must be verified by the operator; native drills require the same server major version.

```sh
node ops/recovery/recovery.mjs plan /secure/title-recovery.json
node ops/recovery/recovery.mjs export /secure/title-recovery.json /secure/backups/title-2026-09-24 'EXPORT aaaaaaaaaaaaaaaaaaaa'
node ops/recovery/recovery.mjs verify /secure/title-recovery.json /secure/backups/title-2026-09-24
node ops/recovery/recovery.mjs restore-plan /secure/title-recovery.json /secure/backups/title-2026-09-24
```

Replace the example project identifier and paths before running. `plan` opens no connection and writes no output file. `export` requires exact source confirmation; it never creates or changes source records. Existing output paths are rejected. Successful export is an operator action, not an automatic scheduled backup.

Every archive entry uses AES-256-GCM with a fresh random nonce and archive-ID/entry-name associated data. The encrypted manifest contains original paths, object inventory, byte counts, SHA-256 digests, source references and recovery dependencies. Its metadata is confidential as well as authenticated. Only format and random archive ID are plaintext in `bundle.json`. Database/role dumps stream directly into encryption, with no persistent plaintext dump or manifest file. Schema/config input files are read into bounded memory and immediately encrypted.

The staging directory is mode 0700 and encrypted files are mode 0600. A successful export is published by renaming that complete directory; ordinary failure removes its encrypted staging directory. Process/host crashes can leave an encrypted `.recovery-encrypted-*` directory without a completed manifest. Treat it as incomplete and remove it through the retention procedure. A completed archive is valid only after verification. Filesystem/storage durability beyond the local write depends on the approved destination and replication procedure; copy the entire directory without modification and verify again after transfer.

Verification authenticates the manifest and every encrypted entry, rejects duplicate/unsafe paths, unexpected files, wrong keys, corruption, missing bytes and configured byte/count limits. Export also checks originals against registered asset/recipient SHA-256 and size references where present; conflicting registrations or different source bytes abort. It does not execute SQL, mutate storage, prove file safety or prove that the escrowed managed root key matches the source ciphertext. Increase configured size bounds only after reviewing capacity; default example bounds are 10 GiB per entry and 100 GiB total. The implementation caps a single entry at 1 TiB, total at 10 TiB, metadata at 16 MiB and private object count at 100,000. Larger portfolios need a reviewed extension; silently splitting a cross-system snapshot is not implemented.

## Isolated restore and acceptance

The executable `restore-native` is deliberately limited to `isolated-fixture` archives and a disposable loopback PostgreSQL cluster. It requires a distinct source/target listener hostname (identical hostnames and DNS aliases resolving to the source address are rejected), a new database named `title_recovery_*` and a new object directory. The target cluster must contain only its bootstrap role, with the same name as the source bootstrap role. PostgreSQL distinguishes its OID-10 bootstrap grantor from other superusers; using a different bootstrap name can break restored role grants. Only the exact bootstrap `CREATE ROLE` line is omitted from the authenticated role script; SQL errors are never ignored. The test suite uses separate IPv4 and IPv6 loopback clusters on one machine; it never connects to configured application credentials.

Add an explicit target to a private fixture configuration:

```json
{
  "target": {
    "kind": "isolated-native",
    "environment": "nonproduction",
    "databaseUrlEnv": "TITLE_RECOVERY_TARGET_DATABASE_URL",
    "databaseName": "title_recovery_drill",
    "objectDirectory": "/secure/isolated-drill/restored-originals"
  }
}
```

Then use the actual archive ID printed by verification:

```sh
node ops/recovery/recovery.mjs restore-native /secure/fixture-recovery.json /secure/backups/fixture 'RESTORE actual-archive-uuid INTO title_recovery_drill'
```

The whole archive is verified before writes. Roles are restored from the encrypted role dump in bounded memory, with source roles other than the target bootstrap forced to `NOLOGIN`; passwords are not restored. A new empty database is created, and `pg_restore --single-transaction --exit-on-error` runs directly from the decrypting stream. Ownership, ACLs, RLS, Auth/membership records and private data are retained. The restored database object inventory must match the archive before originals are written. Original bytes are intentionally plaintext in the explicitly selected isolated recovery destination, protected by 0700 directories/0600 files; no plaintext database dump is created. `RECOVERY-COMPLETE.json` marks the completed object set.

On a handled restore error, the tool removes its newly created database and its own object directory; it never drops a preexisting target. Restored global roles can remain after failure. A crash can also leave an incomplete database or partial destination. Keep the cluster offline, discard the entire disposable cluster and destination, and start a new drill. Do not reuse or promote a failed target. The command does not promote a deployment, enable logins, send mail or connect external vendors.

For a managed recovery, a separately authorized operator must use the provider plan, preserve/install the correct root key, recover all database/private-object dependencies and reconcile the expected inventory on an isolated hosted project. Demonstrate all of the following before declaring operational recovery:

1. Exact hashes and byte counts for representative originals, including a recipient original not yet adopted and a retained removed original; demonstrate coverage of the complete private inventory.
2. Successful private JV and recipient payload decryption, unchanged application linkage/version/status and no identity values in general workspace output.
3. Auth/account setup, company memberships, revoked access, restricted-source checks, direct browser-role denial and durable audit permissions.
4. Configured secrets and provider settings recovered from their separate inventory, with integrations/email disabled until intentionally tested. Invalidate recovered staff sessions, portal capabilities and outstanding codes before production promotion according to the approved incident procedure.
5. Measured elapsed recovery time and recoverable timestamp versus approved RTO/RPO, missing-object count zero, approver/sign-off and immutable evidence location.

## Local verification

```sh
node --check ops/recovery/recovery.mjs
node --test ops/recovery/tests/recovery.test.mjs
```

The tests initialize disposable native PostgreSQL clusters and load real foundation, staff lifecycle, JV and recipient migrations. They reuse the existing pgcrypto-backed Vault API fixture, recover actual encrypted private payloads and original bytes, and check Auth/membership rows, RLS/ACL denials and durable audit restrictions. Controlled Storage/managed-source transport tests verify encrypted key inclusion and fail-closed managed restore; they do not prove hosted Supabase permissions, Vault cryptography, Management API operation or Storage delivery. Failure cases cover missing original bytes, over-limit streams, path traversal, symlink entries, archive tampering, wrong keys, changed inventories, forbidden targets, duplicate outputs and injected `pg_restore` failure.

No production export, production key read, managed key change, live data mutation or hosted recovery was performed by this test suite. Retain separate receipts for authorized real exports and hosted drills rather than presenting these fixtures as production evidence.
