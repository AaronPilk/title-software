# Implementation coverage and verification

September 11, 2026. Read alongside the [54-item evidence matrix](discovery/all-transcript-traceability.md), [current blueprint](system-blueprint.md), [policy-production research](research/full-policy-production.md) and [company-operations research](research/full-company-operations.md).

“Implemented” below means a local, fictional-data workflow. It does not mean a live provider, authenticated review, certified accounting or legal approval. Both complete machine transcripts were analyzed: Stephenie’s 27:50 recording and Tyler’s 75:03 recording. Private transcript paths and timestamp ranges are documented in the evidence matrix. Three research/review agents covered policy production, company operations and cross-call requirements; their final reviews also identified and helped close lifecycle defects.

## Coverage by transcript requirement

| Evidence IDs | Implemented in this build | Remaining partial/deferred work |
| --- | --- | --- |
| S01 | Company creation, contact and prospect/onboarding stages | CRM deduplication and provider intake |
| S02–S04 | Application packet export, secure application/signature references, received/reviewed state and versioned handoff | Approved welcome/application templates, encrypted identity fields, Docusign and delivery |
| S05–S07 | Formation/EIN milestones, evidence documents/references, separate agency/producer/underwriter records, multiple required underwriters and operating states, launch checks, renewal tasks | Government filings, live credential verification and carrier applications; sensitive background review remains external |
| S08 | Materials evidence stage, company document vault and partner publication controls | Structured letterhead/check-stock/forms material register and approved template generation |
| S09–S10 | Company agreements in vault, editable member shares, company-scoped search/download and document versions | Effective-dated ownership, governing document extraction and full publication history |
| S11–S12 | Demo persona/partner preview and manual-first workflows with disconnected providers | Actual account provisioning, assignments, authentication and enforced permissions |
| T01–T03 | Original email/source-reference capture, company/file routing, new-order intake, multiple document links and batch upload | Automatic Missive ingestion, attachment extraction, provider profile identity and file naming conventions |
| T04–T07 | Manual source capture/page references; file property/attorney/lender/seller/legal-description context | General PTO extraction, normalized multi-party records, legal-description source linkage and transcription verification |
| T08–T09 | Prior-policy and search-package references/documents with explicit review inputs | Approved tacking decisions, title-search interpretation and reviewed jurisdiction/form-specific rules |
| T10–T12 | Separate owner/loan products, multiple loan identities/principals, product exceptions/endorsements/premiums and multiple CPL requests | Full rating engine, approved form/endorsement catalog, provider generation and transaction-specific professional review |
| T13–T14 | Conditional initial preparation with open requirements, versioned output return, attorney reference and handoff | Actual commitment assembly, approved form mapping and delivery adapter |
| F01–F03 | Finals queue, source readiness, requirement clearance, separate/combined documents and persistent attorney follow-up | Automatic triage/extraction, SLA calendar and external queue events |
| F04–F05 | Independent exact source wording, reviewed proposals, vesting/trustee fields, distinct instrument dates and recording fields, mortgage/DOT choice | Professional interpretation, OCR accuracy validation and normalized multiple-instrument recording data |
| F06 | Durable draft/owner/original message, individual outstanding items, manual send reference, waiting state, response/document receipt and reopening source review | Provider thread continuity, automated reminders and message sending |
| F07–F08 | Per-product preparation, current output attachment, simulated issuance reference/month, recipient-specific delivery record, partial-issuance locks | Actual jacket/final generation, approved forms, provider receipts, corrections after issuance |
| R01–R02 | Single-loan revision, original routing guard, before/after/version confirmation, product principal invalidation, current revised commitment and reviewed reply handoff | Loan selection on multiple-loan files, actual SoftPro regeneration and Missive draft API |
| R03–R04 | Needs-information state and note; stale/ambiguous/multiple-loan changes are blocked | Full complex-revision case workflow, external file locks, cancellation/supersession and supported desktop sessions |
| J01–J02 | Separate issued-product ledger rows, explicit new-product issuance month, illustrative terms and remittance review/export | Full premium components, effective rate agreements, immutable remittance batches and actual statement import |
| J03–J04 | Frozen per-company close, source rows/member interests, books/agreement references, expenses/adjustments/reserve, cent-balanced allocations and new revisions | John-approved accounting basis, effective interests, special allocation rules and real bookkeeping inputs |
| J05 | Published company/member statements exported from the reviewed close revision | Delivery recipients, manual delivery register, accounting report layout and sending |
| J06–J07 | Disconnected accounting plan; no bank/payment action | Confirm accounting vendor and source format; generic CSV import preview remains unimplemented |
| V01 | Latest explicitly partner-visible company documents, independent order/product filename families | Versioned audience publication records, member assignments and actual permission enforcement |
| V02–V03 | New-order receipt date; independent dated rejection/recovery/closing events; period counts; preserved outcome history and recovery tasks | Complete contacted/awaiting/lost recovery pipeline, historical receipt-date backfill and approved partner outcome wording |
| V04 | Publish/replace/withdraw reviewed close statements; company/member preview; prior snapshots remain stable | Server authorization and actual distribution approval/payment rules |
| X01 | Assigned tasks and versioned preparation handoffs; attorney follow-up tasks resolve with their items | General task-to-case deep links, waiting reasons, SLA rules and completion evidence |
| X02–X04 | Disconnected settings and explicit reviewed handoffs; no false success, shared credential automation or background execution | Verified SoftPro profile inventory, connection health/locks, durable jobs, supported auth, provider identifiers and reconciliation |
| X05 | Persistent local metadata, IndexedDB assets, source versions, snapshots, local activity and metadata export | Full binary backup/import, authenticated immutable audit, retention, multi-tab/multi-user conflicts and recovery |

This table covers all 54 evidence IDs without claiming that every production dependency is implemented. The application is deliberately usable for local evaluation before credentials or backend decisions are needed.

## Acceptance stories and evidence

| Story | Local result and validation |
| --- | --- |
| New company to launch | Reviewed application, milestone evidence and current authority gate launch; changes and expiry reopen it. Domain tests cover activation, unchanged save, ownership change, cross-company authority and expiry on hydration. |
| PTO to commitment | A conditional commitment allows open requirements. Current outputs bind to preparation; earlier output fails even at the same case version. Refinance does not invent a seller requirement. |
| Finals to multiple products | Each loan retains its own identity; mortgage drops DOT-specific trustee requirement. All products must be prepared before first issuance. Identical output filenames remain separate. Partial issuance locks shared inputs. |
| Missing information | Saved requests survive serialization/hydration; duplicate save is idempotent; each item resolves separately; foreign file evidence fails; resolution reopens review and does not approve the policy. |
| CPL preparation | Cash does not imply a CPL is unnecessary. Returned documents bind to the current preparation. Property or loan changes invalidate delivery eligibility. |
| Loan revision | Company/file/amount/version checked; original route cannot silently move; sole product principal updates; multiple-loan action is blocked; revised commitment attachment must match the file version. |
| Company close and partner statement | Frozen rows and ownership, exact-cent reconciliation, source-change checks, immutable published allocations, older-publication rollback prevention and zero-payment loss periods are covered. |
| Period business | Receipt/rejection/recovery/closing dates remain independent when issuance month changes. Legacy unknown receipts are excluded with a visible note. |
| Repeated operations | Intake, onboarding, rejection and authority tasks deduplicate; guided sample loading is isolated/idempotent. |

## Local walkthrough

1. Open [localhost](http://localhost:5173) and select **Commitments → Load sample case**.
2. Use **File details** and **Source documents** to inspect the fictional inputs. Complete the commitment references and product/CPL decisions, then prepare the packet.
3. Open **Policy workbench** for final source capture and review. Use **Draft missing-document request → Save follow-up with this file** to try durable attorney requests.
4. Open **Policy products** for separate owner/loan preparation, output upload and local issuance/delivery references. The UI identifies missing evidence.
5. Open **Onboarding** to work Stephenie’s application/evidence case and **Authority & renewals** to record company/state/underwriter evidence.
6. Open **Financials → Company closes**, create/reconcile/review a revision, and publish it. Preview it in **Partner portal → Statements**.
7. Open **Handoffs** to see preparations and their current/stale state. No provider operation is executed.

Built-in and guided records are fictional. Use redacted/synthetic attachments. Text exports are preparation artifacts; they are not approved policy forms. Separately uploaded binary assets are absent from metadata export.

## Verification record

- Domain suite: **47 passing tests**, covering original workflows and expanded lifecycle regressions.
- TypeScript checking: passed. Required Sites production build: passed (Vinext client, server and SSR bundles). Retained localhost server: HTTP 200.
- WebMCP: both registered tool schemas/annotations inspected; valid search and navigation to Policy products, Handoffs and Commitments succeeded; invalid query/page inputs rejected; focused navigation readback confirmed the new pages. No record mutation was performed by these tools.
- Earlier broad browser checks cover the original MVP only. The expansion has domain/type/build validation and focused navigation/tool checks; it has not had a full user-interaction browser acceptance pass.
- No real API, multi-user access, provider issuance, legal decision, document extraction or financial system has been certified.

## Next implementation boundary

Start production integration with representative redacted company/file examples and approved rules, then add identity/storage/audit before shared use. Verify actual SoftPro Select capabilities and Missive access; use read/import and draft-only pilots first. Obtain John’s books and agreements before automating close calculations. These inputs determine provider adapters and production rules; choosing every vendor in advance would not resolve them.
