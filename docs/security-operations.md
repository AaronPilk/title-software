# Security operations and access review

This documents the security-center implementation and the remaining operational decisions. It is not a SOC 2 report, ISO 27001 certificate, legal opinion, penetration-test result or claim that the production environment is configured correctly. A successful local test is evidence of the tested code path, not evidence of a hosted deployment.

## Who can see the security center

Only an active owner or an active administrator with explicit access to all companies may load the security center, read/export security events or record an access review. A company-scoped administrator cannot view this workspace-wide information. The browser does not directly read evidence tables. Server RPCs recheck current membership and its version; the existing gateway also verifies the account, current session and required authenticator setup.

Use the staff access directory to identify the account IDs shown in the review. Review the role, company list/all-companies permission, restricted-record access, active status and membership version for every account. Enter a short outcome/follow-up note without customer information, secrets or credentials. Recording the review does not grant, revoke or approve a pending invitation. Perform any needed access change through the existing staff management workflow, then refresh and review the resulting snapshot.

The stored review includes the exact snapshot, its digest, reviewer ID, timestamp, member count and note. Company lists are canonicalized; member versions and a digest of partner assignments are included. Adding/removing a company, changing grants, deactivating an account or changing membership versions makes the previous review stale. The review transaction uses the existing staff-lifecycle lock and rejects a snapshot changed before acknowledgement. The digest detects a changed snapshot; it is not a cryptographic signature or proof that the reviewer inspected every grant. Review notes are separate from the security event stream and are visible to authorized workspace administrators.

## Event contract and response behavior

The new `title_security_events` stream accepts only fixed metadata: generated event ID/time, workspace and actor IDs, an allowlisted event/outcome, optional company and record IDs/type, and a bounded count. It has no arbitrary detail payload. Do not add filenames, storage paths, signed URLs, names, emails, document text, bank details, authentication tokens, scanner responses, request bodies or raw exceptions. Identifiers remain sensitive/linkable metadata; this is not an anonymous dataset. The older operational `title_audit` ledger is a separate existing system and does not acquire these new guarantees automatically.

Allowed events cover original-file download, workspace-export acknowledgement, backup creation/restore, access review, security-event export, authorization denial and document scan outcomes. Events describe only instrumented operations after deployment; an empty event history is not evidence that no access occurred. File downloads and exports await a successful durable audit receipt before returning successful output. File download receipts also verify the exact membership version, workspace revision and asset/company/document binding after fetching storage bytes, so a concurrent permission or document-state change prevents the response. The server necessarily reads the bytes before this final check; it must not return them on audit failure.

Denial logging is best effort: failure to record a denial must never permit the request. Denials that fail before a verified workspace/actor context exists cannot be reliably attributed to this workspace stream; monitor authentication/platform logs separately. Workspace export acknowledgements record the authorized export attempt, not proof that the user's browser finished writing a downloaded file.

Event lists use timestamp plus UUID cursors to preserve equal-timestamp boundaries. Page limits are 1–100; there is no unbounded export. JSON contains the fixed event schema and next cursor. CSV contains a fixed column set with quoting and formula-safe encoding; invalid identifiers are rejected. Downloads are private and served with `Cache-Control: no-store`. The UI exports the latest 100 events and makes that boundary explicit; use the authenticated paginated endpoint to continue older exports.

## Database boundaries and retention

Both evidence tables have RLS enabled and no browser-role grants. Direct service-role SELECT, INSERT, UPDATE, DELETE and TRUNCATE are revoked. Public RPC wrappers are invokers granted only to `service_role`; narrowly scoped private definers have a fixed search path and perform authorization/validation. UPDATE/DELETE triggers reject mutation of security events and access reviews. Access reviews and their event insert occur in one transaction: an audit failure rolls back the review.

These controls prevent ordinary application credentials from rewriting evidence. A database owner, platform administrator, compromised migration credential or restore can bypass/replace them. They are not externally immutable storage. Decide who owns event retention, periodic export to separately administered storage, alert review and deletion/legal holds. Do not add an automatic cleanup until the retention period and exceptions have been approved for each applicable agency obligation and contract. Database/security backups must include these new tables.

## What the status cards establish

Cards report observed rows, timestamps, latest snapshot match and missing external verification. They do not calculate a compliance percentage. A stored workspace snapshot does not prove recovery of original files, Auth accounts, deployment configuration, credentials or encryption keys. Follow [Disaster recovery](disaster-recovery.md) for the separate recovery exercise and evidence requirements.

Document scanning is a separate database-owned policy. `pending_setup` is intentionally shown as **NOT ACTIVATED**: uploads may still enter without a clean scan, and a legacy/unscanned count remains visible. Configured URL/token presence does not establish scanner health. Before activating required scanning, deploy the scanner to a suitable managed host, establish its authenticated transport and updates, test clean/blocked/unavailable outcomes through each ingestion channel, and confirm operational ownership. Required mode must reject absent, failed or non-clean scans; callers cannot choose a request-level bypass. See [Scanner operations](scanner-operations.md). Existing files require a separately planned rescan; never mark them clean from configuration alone.

## Assign before broader rollout

Record these decisions in an operating register with the responsible person, date and evidence link:

- Name a security owner and a backup incident contact. Choose monitored intake and escalation channels, response coverage and external forensic/counsel contacts. This repository does not appoint an on-call team or send alerts.
- Set review cadence for accounts, privileged access, new agencies, vendors, offboarding and security events. Establish alert thresholds and ownership for missed reviews, repeated denials, scan failures and audit-write failures.
- Complete and approve a written information-security program, asset/data inventory, risk assessment, incident response plan, retention/deletion policy, vendor review and recovery objectives. Train staff, including wire-instruction verification and fraud escalation.
- Document the entity/regulatory matrix: each agency/JV and the software operator, licenses, activities, ownership/control, employees/contractors, data flows and states served. Have qualified counsel determine direct obligations and contract requirements; shared ownership is not an exemption.
- Review software, underwriter, lender and cloud/scanner agreements for confidentiality, service-provider safeguards, incident reporting, subprocessors, audit rights, recovery and data return/deletion. Verify cyber/technology insurance and exclusions with the broker.
- Commission an independent security review/penetration test before expanding access or selling externally. Use the prepared [assessment scope and acceptance criteria](security-assessment-scope.md) to obtain a concrete engagement. Choose SOC 2 scope/timing and any ISO 27001 requirement based on customer demands and assurance needs, then retain operating evidence. Certificates do not replace controls or legal duties.

North Carolina's existing [Customer Information Safeguards Act](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_58/Article_39.html) and South Carolina's [Insurance Data Security Act](https://www.scstatehouse.gov/code/t38c099.php) require entity-specific assessment. South Carolina's under-ten-employee provision, which includes independent contractors, limits particular program duties; it does not erase incident investigation/reporting duties. Do not apply that exception to every JV or import it into North Carolina. [GLBA regulator allocation](https://uscode.house.gov/view.xhtml?req=%28title%3A15+section%3A6805+edition%3Aprelim%29) distinguishes insurance authorities from FTC jurisdiction. [ALTA Best Practices](https://www.alta.org/policies-and-standards/best-practices/) is a voluntary industry framework that can become a contractual requirement; it does not itself certify the software.

## Local verification

Run from `web/`:

```sh
node --test tests/security-center.test.mjs tests/security-center-client.test.mjs tests/security-center-ui.test.mjs tests/security-center-http.test.mjs
node scripts/backend/test-security-center-sql.mjs
```

The SQL runner starts and destroys its own PostgreSQL cluster using only a temporary local socket and fictional records. It does not load a configured database URL or contact a hosted database. Tests cover role/scope isolation, fresh membership checks, stale/concurrent review rejection, append-only permissions, review/event rollback, validated metadata, cursor pagination, browser identity changes, denied access and fail-closed download/export behavior. Live provider and deployment checks remain separate release work.
