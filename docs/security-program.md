# Security program: engineering baseline and owner decisions

This is a readiness plan, not a SOC 2 report, ISO 27001 certificate, HIPAA assessment, or legal applicability opinion. An independent assessment and evidence of operating controls are still required. The security center reports observed evidence, not a compliance percentage.

## Controls supplied in this release

- A workspace-wide administrator can review a canonical snapshot of every membership, role and company scope. Changed permissions make the saved review stale. Recording a review does not grant access.
- Security events use a fixed metadata schema. Document contents, filenames, emails, tokens, request bodies and raw errors do not belong in this ledger. Events are append-only through the application/service roles. A database owner remains privileged; off-platform log retention is a separate operational control.
- File downloads recheck authorization before releasing bytes and require durable audit evidence. Backup creation/restoration and their audit records commit together.
- Every new upload channel obtains an ingestion receipt bound to its workspace, company, object path, hash and byte count. Database triggers enforce that binding for staff originals and recipient attachments.
- The operator-controlled `pending_setup` scanning policy keeps existing uploads available and explicitly records them as unscanned. It is **not antivirus protection**. After a hosted scanner is configured, an operator activates `required`; outages, invalid receipts and blocked files then prevent storage/publication. Existing originals are not retroactively declared clean.
- An authenticated TLS scanner service performs bounded local ClamAV scans with fresh signatures, independent ZIP expansion checks, timeouts, and no document logging. See [scanner operations](scanner-operations.md).
- An operator recovery tool encrypts database material, original bytes and its manifest. It supports integrity verification and an isolated native restore drill. See [disaster recovery](disaster-recovery.md); hosted Supabase/Vault restoration still needs the provider/key plan.
- GitHub CI runs synthetic regressions without production credentials. Branch protection and required reviewers must be enabled in repository settings; adding the workflow alone does not enforce either.

## Decisions the owner must make

| Item | Decision/evidence needed | Accountable person |
| --- | --- | --- |
| Scope | Legal operator of software, participating title agencies/JVs, covered services and jurisdictions | Owner + counsel |
| Security accountability | Named incident lead and backup; contact method independent of this application | Owner |
| Scanner hosting | Approved host/region, TLS endpoint, machine/service operator, signature updates and alert destination | Owner + engineer |
| Recovery | Approved RPO/RTO, backup schedule, independently controlled encrypted backup location, retention, Vault-key escrow and restore authority | Owner + engineer |
| Retention | Record classes and agency/underwriter obligations, deletion rules, legal holds and backups | Owner + counsel |
| Devices and people | Managed devices, disk encryption, patching, password manager, named accounts/MFA, offboarding and training evidence | Owner |
| Vendors | Services used, data categories, DPAs/security reports, subprocessors and approved AI data flows | Owner + counsel |
| External assurance | Independent penetration tester, audit scope and CPA/certification body | Owner |

## Initial risk register (open until evidence is recorded)

| Risk | Existing engineering mitigation | Remaining evidence/action |
| --- | --- | --- |
| Malicious originals | Scan service and enforced-mode gates implemented and tested | Deploy approved scanner, activate policy, monitor freshness, plan review of legacy originals |
| Database or original-file loss | Encrypted export/verify and synthetic restore tooling | Run approved full hosted export and provider-backed restore drill; store backups separately |
| Wrong-company disclosure | Role/company controls, regression suites and version checks | Regular signed access review; independent testing of deployed tenant boundaries |
| Insider/privileged tampering | Append-only application evidence and least-privilege application API | Separate administrator accounts, independent retained logs and alert ownership |
| Production data in development | Synthetic CI and isolated DB tests | Provision and verify separate staging project/accounts; do not assume localhost is isolated |
| Compromised credentials | Individual accounts and MFA workflow | Rotate credentials previously shared in chat; verify vendor tokens and cloud admin MFA |
| OCR/agent mistakes | Human-reviewed field suggestions and evidence references | Representative authorized-document evaluation; no unsupported accuracy or autonomous approval claims |

## Operating cadence to approve

Review access on every staff departure or role change and at an owner-approved recurring interval. Review dependency findings promptly; record disposition and remediation evidence. Exercise incident response and restore recovery regularly against approved objectives. Keep a dated exception register with an owner and expiry for each accepted risk.

The operator should collect: release hash and test results; deployment versions; access-review snapshot; backup/export manifest and independent restore result; scanner definition age and blocked/unavailable counts; vendor approvals; employee training/offboarding records; incident exercises and corrective actions. Do not put customer data, credentials, private applications or production backup files in GitHub.

## Incident first actions

Contact the named lead, preserve logs, record UTC times and affected systems, and restrict compromised credentials or integrations. Preserve originals and evidence before destructive cleanup. Determine affected companies/data with counsel and insurers; notification deadlines and recipients must be assessed for the actual incident. Recovery requires integrity and authorization verification before reopening access. Practice this using fictional records before an emergency.
