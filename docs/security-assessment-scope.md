# Independent security assessment commissioning package

Prepared 2026-09-24 against source baseline `be4f806`. This is a proposed scope and evidence checklist, not an assessment result, authorization for a third party to test, or certification. Update the tested release and hosted deployment inventory when the engagement begins.

The engineering team can build controls, reproduce failures, fix them and retain test evidence. Its own agents and automated scans are internal verification. Completion of the independent assessment requires a qualified external assessor to perform the agreed work and issue a report; management must address and accept its findings. No assessor has been engaged through this document.

## Work to commission

| Workstream | Concrete deliverable | Who completes it |
| --- | --- | --- |
| Application penetration test | Authenticated and unauthenticated manual testing, targeted code/configuration review, reproducible findings, coverage limitations and remediation retest | External security tester independent of this implementation |
| Cloud and recovery review | Configuration and privilege review of the deployed environments, secret handling, scanner deployment and observed hosted restore drill | External assessor with relevant cloud/database experience |
| Governance and legal scope | Signed applicability matrix for software operator and each participating agency/JV, approved policies, contracts and obligations | Management and qualified counsel; assessor evaluates evidence |
| SOC 2, if selected | Agreed system description, criteria and report type/period; readiness gaps and a separate examination engagement | Licensed CPA firm for the examination/report |
| ISO/IEC 27001, if selected | Defined ISMS scope, risk treatment and Statement of Applicability, internal audit/management review, then certification assessment | Management implements the ISMS; an independent certification body assesses it |
| HIPAA, only if applicable | Covered-entity/business-associate analysis, risk analysis, required agreements and an evidenced safeguard review | Counsel/privacy lead and qualified assessor |

SOC 2 is an examination/report, not a software certification. A Type 1 report addresses a specified date; Type 2 includes operating effectiveness over the agreed period. The auditor determines sampling and sufficiency of evidence, not the application's test count. [AICPA SOC resources](https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2), [AICPA report review checklist](https://assets.ctfassets.net/rb9cdnjh59cm/3xbcLlNc5rd72So4nQpNIk/7a3e8e5945c78c35fc5e116859b96e6a/SOC_2_Report_%C3%82_Review_Checklist.pdf).

ISO/IEC 27001 concerns the organization's information-security management system, including people and processes. Its certification scope must accurately name the covered organization/services; hosting on a certified provider does not certify this application. [ISO/IEC 27001](https://www.iso.org/standard/27001).

Sensitive financial data alone does not make a title business a HIPAA covered entity or business associate. Determine applicability from actual activities and relationships. If ePHI is processed on behalf of a covered entity/business associate, assess every processor and applicable BAA before that processing. HHS does not recognize private Security Rule certifications as proof of compliance. [HHS applicability](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html), [cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html), [certification guidance](https://www.hhs.gov/hipaa/for-professionals/faq/are-we-required-to-certify-our-organizations-compliance-with-the-standards/index.html).

## Engagement boundaries and test environment

Prepare a private engagement register containing exact hostnames, project/account IDs, deployed hashes, allowed paths, test dates, named contacts and the tester's source IPs. This public repository must not contain assessor credentials, confidential findings, client originals or private recovery artifacts. The signed rules of engagement must authorize the listed systems and techniques, identify stop conditions and agree evidence retention/destruction. [NIST testing guidance](https://csrc.nist.gov/pubs/sp/800/115/final).

Default to an isolated hosted staging project with the same release, migrations, policies and scanner configuration as production. Record every difference and the production checks needed to cover it. Use fictional companies, recipients, records, documents and payment information. Set up controlled mailboxes and sandbox vendor accounts; block genuine outgoing mail, signatures, accounting writes and Missive sends. A production verification window should be limited to separately agreed, non-destructive checks.

Create at least two workspaces and two companies per workspace. Supply distinct named accounts for owner, workspace-wide administrator, company-scoped administrator, operations staff assigned to one company, unassigned staff, restricted-record allowed/denied staff, inactive/revoked staff and an unverified/MFA-incomplete account. If a role combination is unsupported, record that fact instead of silently omitting the boundary. Supply separate active, expired, canceled and already-submitted recipient invitations and sessions. Test changes to access while requests are in flight.

The rules must explicitly exclude third-party infrastructure, other customers, real inboxes, payment movement, destructive production restores and uncontrolled denial-of-service. EICAR and malformed-document tests run only in the agreed staging environment. Stop for unexpected customer data exposure, infrastructure instability or cross-tenant access; preserve the minimum proof and escalate privately. Agree request/concurrency ceilings and a way to stop the test immediately.

## Application and infrastructure coverage

Use the current [OWASP ASVS](https://github.com/OWASP/ASVS) as the verification catalogue. Proposed baseline: applicable Level 2 requirements, with a risk-based selection of stronger checks for identity, multi-company authorization, sensitive originals and recovery. This is a proposed engagement target, not a claim that a level has been achieved. Require requirement IDs/version and an explicit tested/not-tested/not-applicable matrix with reasons.

| Surface and code entry points | Required adversarial checks | Expected outcome |
| --- | --- | --- |
| Staff app gateway; `title-api` `/session`, `/security/status`, `/security/password`; `account-security.ts` | Direct API access without the browser gateway; expired/forged sessions; password setup/reset; authenticator setup and recovery; account enumeration and rate limits; revocation during an open session | Every protected operation requires the correct current identity and setup state; gateway presence is never the sole authorization control |
| `/state`, `/commands`, `/staff/assignable`, `/members` and invitation routes; `workspace.ts`; staff SQL | Swap workspace/company/order/document/user IDs; forge role/scope; nested/legacy approvals; import/restore bypasses; stale membership versions; deactivate or reassign an account during requests | No data or mutation outside the current permitted scope, including restricted records, staff directories, summaries and exports |
| `/assets/upload`, `/assets/download`, Storage permissions, document previews and OCR/package readers | Direct bucket/path access; content-type confusion, active content, Unicode filenames, unsafe HTML/SVG, malformed PDF/Office/ZIP; size/stream/time limits; cached/signed URL behavior; document moved/revoked during download | Only authorized exact originals are returned; content cannot execute in the staff origin; unsupported data fails safely; stale authority cannot release bytes |
| `document-ingestion.ts`, `document-security.ts`, scan receipt SQL, scanner service | All four channels: manual upload, Missive attachment, staff JV attachment and recipient upload; clean/EICAR/malformed/encrypted/archive expansion; missing/stale signatures; daemon loss; timeout; token failure; hash/path/company/size receipt tampering and replay | Required mode prevents storage/publication without a valid clean receipt bound to the same bytes and context; an outage cannot create a bypass; legacy files are never falsely labeled clean |
| Staff JV intake/portal routes; public recipient Worker and `title-jv-public` | Capability guessing/leaks/replay, code/session rate limits, expiration/revocation, gateway forgery, recipient crossover, upload/download before verification, duplicate submit/save races, private-payload projection | Recipient sees only its request; authority is checked at each action; general workspace state excludes private application fields; confirmation and adoption preserve linkage |
| `/integrations/missive`, webhook function, vendor OAuth/callback routes | Routing revision/company crossover, credential exposure, webhook forgery/replay, OAuth state/redirect/realm/account confusion, refresh races, untrusted attachment URLs/SSRF, draft/send boundary | Vendor credentials remain server-side; provider actions require correct workspace/company authority and intentional workflow; no real external sends during testing |
| `/assistant/context`, staff proxy and `title-personal-assistant` Durable Objects | Browser-supplied user/workspace IDs; thread crossover; changing company access mid-conversation; prompt injection in documents; private text in telemetry; model output interpreted as commands | Context is authorized by the backend; histories remain isolated; untrusted text cannot grant access or execute actions; scope loss prevents future disclosure |
| `/security/center`, events/export, access review; evidence RPCs | Role escalation, direct table/RPC writes, stale review digest, concurrent review/permission change, event injection, note handling, CSV formula injection, audit-store outage | Only all-company administrators/owner see workspace-wide evidence; history is append-only for application roles; sensitive successful reads/mutations fail closed where required |
| `/backups` and `/backups/restore`; `ops/recovery` | Backup trust/origin, imported legacy data, membership resurrection, review/restore race, rollback on audit failure, corrupted/wrong-key archive, original omissions, target mixups and partial restore | Unauthorized or corrupt restore is rejected; active permissions are protected; database/original/private data recovery is evidenced in an isolated target |
| Cloudflare, Supabase, GitHub and scanner/backup deployment | Actual grants/RLS/service-role use; API origins/CORS/cache/CSP; admin MFA; secret rotation; log payloads; deployment rights; dependency and container provenance; retention controls; drift from source configuration | Least privilege and compartmentalized credentials are demonstrable in deployed configuration; secrets and document contents are absent from public artifacts/logs |

SoftPro provider access is outside the current live integration scope. Review existing handoff code and mark future vendor read/write functionality untested until available. Do not imply that sandbox DocuSign/QuickBooks validation establishes production vendor authorization or accounting correctness.

## Evidence to give the assessor

Keep the actual packet in a restricted evidence location with an owner, collection date, covered period and immutable or separately controlled copy. Link evidence identifiers in the register; do not paste secrets into it.

| Evidence | Required content |
| --- | --- |
| System boundary and inventory | Legal operator, agencies/JVs, data classes, all processors/subprocessors, architecture/data-flow diagram, regions, exact versions and environment differences |
| Release and change controls | Source hash, deployment IDs, migration inventory, CI results, dependency findings/dispositions, branch rules, reviewer/deployer permissions, rollback records |
| Identity and authorization | Staff/privileged access review, invite/setup and revocation results, company-scope matrix, MFA evidence, offboarding example, credential rotation record |
| Scanner operation | Hosted endpoint/engine/signature evidence; clean/blocked/unavailable results through each channel; actual enforcement mode; signature update, outage alert and restart evidence; legacy-original disposition |
| Audit and detection | Event schema and coverage limits, sample metadata-only events, append-only denial tests, independent retention proof, monitored alert destination and a delivered test alert |
| Recovery | Encrypted archive inventory/hashes, independent destination/retention policy and credential separation, key custody, scheduled-run evidence, hosted restore report with private decryption and byte comparisons, measured RPO/RTO |
| Vendor and people controls | Contracts/DPAs/BAAs if applicable, vendor reports and exceptions, managed-device encryption/patching, security training, incident escalation and tabletop results |
| Legal and retention decisions | Entity-by-entity obligations, underwriter/lender contracts, retention/legal holds, incident reporting decision tree, approved risk exceptions with expiry |
| Prior engineering tests | Exact commands, release hash, environment, dates and retained logs; distinguish simulated transport/fixtures, real local engine checks and hosted observations |

Documentation of a control is not evidence that it operated. A passing unit test, empty event list, uploaded screenshot or configured secret does not establish operational coverage. Give the assessor prior results without restricting their ability to test new attack paths.

## Hosted recovery drill acceptance

The external assessor should observe or review a separately authorized drill following [disaster-recovery.md](disaster-recovery.md). Require an isolated hosted target, a verified capture consistency procedure and a recovered platform/secret inventory. Outgoing integrations stay disabled. Do not redirect production traffic or restore over the live project.

The report must include source recovery point and capture window; target project and deployment versions; exact-byte comparisons and missing-object count for the complete intended private inventory; successful decryption of fictional private JV/recipient payloads; Auth/setup behavior; memberships and cross-company/revoked/restricted-access denials; scan policy and audit permissions; measured elapsed recovery time and data loss against approved objectives; key custody; separate treatment of Durable Object history; and cleanup or retention of the target. Explicitly invalidate copied sessions/capabilities before any future production promotion. A database-only snapshot is insufficient.

If provider limitations prevent part of the drill, record an unresolved finding with a next action. Never substitute a local fixture restore or a manually typed backup reference for a hosted recovery result.

## Acceptance and remediation rules

These are proposed project release criteria for owner approval, not universal legal deadlines:

1. Receive a signed report identifying assessor, dates, exact scope/release, methodology, tests performed, exclusions, findings and data-handling completion. An automated scan report alone does not satisfy the engagement.
2. Each finding includes prerequisites, reproducible steps using fictional data, affected boundary, business impact, severity rationale, recommendation and evidence reference. Communicate critical exposure immediately rather than waiting for the report.
3. Do not close the assessment while critical/high findings remain unresolved. Require an assessor retest against the deployed fix. Lower-severity exceptions need a named owner, compensating control, deadline and expiry approved by management; retain accepted risks visibly.
4. Independently retest every tenant-boundary, credential exposure, unsafe original delivery, scan-bypass, private-field disclosure and recovery-integrity finding. Engineering tests become persistent regressions but are not a substitute for the external retest.
5. Deliver a machine-readable coverage/finding register, executive report, restricted technical report and retest letter. State residual limitations, including any untested vendors or production paths. Avoid a broad “secure” or “compliant” conclusion unsupported by the scope.
6. Select recurring assessments based on risk, material changes, customer contracts and auditor requirements. Reassess new public portals, integrations, tenant models, data processors and recovery architecture before relying on old results.

## Owner decisions that remain necessary

The owner must name the legal operator and security/incident leads, approve budget and select the external assessor/auditor, authorize test scope, choose risk/recovery/retention objectives, and approve processor and key-custody arrangements. The engineering team can prepare and implement these choices but cannot appoint external professionals, sign contracts, invent organizational evidence or attest independently to its own work.

Counsel should produce a matrix for the software operator and each agency/JV, including states, licenses, activities and relevant contracts. North Carolina §58-39-10(d) excludes certain government public-record information maintained for title-insurance purposes from that Article; it is not a blanket exclusion for mixed files containing private applicant or financial information. South Carolina's statutory exceptions must be evaluated per applicable entity and requirement. Insurance oversight and service-provider duties need that factual analysis. [North Carolina Article 39](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_58/Article_39.html), [South Carolina Chapter 99](https://www.scstatehouse.gov/code/t38c099.php).

Include [ALTA Best Practices](https://www.alta.org/policies-and-standards/best-practices/) and actual underwriter/lender requirements in the agency review. Neither an industry framework nor a cloud provider's assurance report alone establishes that this software or every participating agency complies.

Use [security-program.md](security-program.md) for the risk register, [security-operations.md](security-operations.md) for access/evidence controls, [scanner-operations.md](scanner-operations.md) for scan activation and [disaster-recovery.md](disaster-recovery.md) for recovery procedures. Those documents and this scope must be reconciled with the actual deployment evidence before the engagement starts.
