# Security operations preparation — September 24, 2026

The owner approved preparing and testing the antivirus host without starting paid hosting, and selected the existing Title Software Supabase organization for a future isolated recovery target. This release does not activate antivirus protection, recurring offsite backups or a managed recovery environment. No independent assessor has been engaged.

## Prepared deliverables

| Area | Implementation | Operational status |
| --- | --- | --- |
| Antivirus | Pinned ClamAV container, authenticated Cloudflare gateway, private daemon socket, bounded scans, signature updates, readiness checks and synthetic verification workflow | Prepared; hosting and required-scan policy remain off |
| Offsite archives | Encrypted upload/retrieval, separate reader/writer access, create-only objects, authenticated completion receipts and complete local verification | Tested with synthetic archives and local R2; no production archive uploaded |
| Hosted recovery checks | Read-only database, private-payload and original-byte checks with explicit source/target separation | Prepared; full managed restore, logical database parity and hosted application acceptance remain unverified |
| External assessment | Defined scope, test accounts, evidence requirements, rules of engagement and retest criteria | Ready to commission; engineering tests are not independent assessment results |

## Verified live boundary

A read-only production check during this work found the scanner policy `pending_setup`, zero clean receipts and five unscanned receipts. Uploads therefore remain unscanned. No policy change, source data export, source key retrieval or production restore occurred.

Supabase's tool quoted $0/month for an empty new project in the selected organization. That quote is not confirmation of the price or eligibility of a provider-managed clone/restore. No project was created. Creating an empty project would not resolve the missing source export credentials, key escrow or managed restore procedure.

## Steps needed to activate operations

1. **Antivirus:** approve hosting and data location, configure secrets and the approved host, then verify clean, blocked and unavailable behavior from the deployed API through every upload channel. Only after those checks should the operator enable required scanning. Set an owner and alerts for signature/update failures and scanner outages. See [scanner hosting](scanner-hosting.md).
2. **Backups:** select a dedicated destination and retention policy with independently controlled recovery access. Secure the source database/Storage credentials, archive key and verified Vault key escrow. Establish a consistent capture window before exporting; verify the retrieved copy with separate recovery credentials. A scheduled command alone does not establish consistent recovery. See [offsite backups](offsite-backups.md).
3. **Hosted drill:** obtain a provider-supported isolated restore in the selected organization, restore all original bytes and separately recover deployment configuration. Keep copied jobs, mail and vendor connections disabled. Verify exact bytes, private decryption, complete database parity, sign-in/MFA, company access, revoked access and measured recovery objectives. The automated checker explicitly leaves unproven items incomplete. See [hosted recovery checks](hosted-recovery-drill.md).
4. **Independent assessment:** select and engage an external tester, approve the scope and arrange the fictional test environment. Retain the report and independent remediation retest. Management and counsel must establish applicable organizational and contractual obligations. See [assessment scope](security-assessment-scope.md).

These are separate activation requirements, not features that become operational merely by pushing this release. The running pilot continues to display its actual scanner status.

## Verification evidence

- [Linux image verification](https://github.com/AaronPilk/title-software/actions/runs/36043354894) passed against scanner commit `ccaa69d`: actual pinned image startup, official signatures, clean bytes, EICAR directly and in ZIP, encrypted/over-limit archive rejection, authentication and route boundaries. This runner did not test Cloudflare's container egress proxy or Supabase-to-host connectivity.
- Scanner service: 20 tests; host gateway: 13 tests, including native workerd and exact 50 MiB streaming. Host typecheck and Worker-only packaging passed.
- Offsite transport: 17 tests through native workerd/local R2, including encrypted multi-chunk retrieval, tampering, wrong credentials/destination, concurrent create-only writes and stalled requests.
- Hosted verifier: 11 tests using disposable PostgreSQL and explicitly simulated Storage. Native recovery export/restore tests also passed; neither test is a hosted production recovery result.
- Existing application checks passed: 221 domain tests, 117 backend tests, 380 API tests, 32 security tests, security/scan SQL checks, typecheck, lint and Edge-function packaging.

The checked-in security workflow now includes the new transport, gateway and recovery regressions on every main-branch push and pull request. The image verification workflow is manually dispatched and has no cloud deployment or registry publication credentials.
