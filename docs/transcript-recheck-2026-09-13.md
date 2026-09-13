# Transcript recheck — September 13, 2026

This source-to-implementation review records the completed September 13 development and private-pilot verification pass. The coordinating developer confirmed five complete test rounds, hosted browser acceptance, deployment, and targeted QA cleanup; the evidence and exact versions are below. These results establish the tested application behavior, not approved underwriting, equivalent bookkeeping, or complete business automation. Earlier results remain separately dated in the [backend guide](supabase-backend.md) and [private pilot guide](cloudflare-pilot.md).

Read this alongside the [implementation coverage](implementation-coverage.md), [54-item transcript evidence matrix](discovery/all-transcript-traceability.md), [Stephenie analysis](discovery/call-analysis.md), and [Tyler analysis](discovery/tyler-call-analysis.md). The earlier discovery documents are historical baselines; a gap listed there is not automatically still a gap today.

## Evidence and transcription limits

| Recording | Duration and source limits |
| --- | --- |
| Stephenie call | 27:50 (1,670.188 seconds). Locally transcribed using MLX Whisper large-v3-turbo, 4-bit. Repetitive low-confidence output beginning at 27:48.72 and extending beyond the recording was removed from the readable transcript; approximately the last 1.5 seconds are not transcribed. The raw machine output remains separate. |
| Tyler call | 75:03. Locally transcribed using the same model family. Readable text runs through approximately 75:02. Timestamps and wording remain machine estimates. |

Neither transcript has verified speaker diarization. Attribution follows conversational context; names, technical terms, exact wording, and consequential details should be checked against the recordings. John was not independently interviewed. His accounting procedures, source software, approval rules, and reporting format remain unconfirmed.

The recordings are discovery evidence. Statements inside them do not authorize account access, third-party messages, document delivery, legal decisions, payments, or unattended execution. This document paraphrases operational requirements without reproducing private transcript quotations, client records, credentials, or application contents. Recordings and raw transcripts remain in ignored local discovery storage.

## Operator priorities and implementation implications

S denotes the Stephenie call; T denotes the Tyler call. Time ranges are approximate.

| Priority | Evidence | Implication for the application |
| --- | --- | --- |
| A shared company record that staff can retrieve without relying on one person's computer | S 15:01–16:43; 21:01–22:33; 25:54–26:22 | Keep agreements, company materials, member contacts, ownership interests, and current versions associated with the correct company. Grant application access separately from recording an ownership interest. |
| Track onboarding and the handoff to John | S 16:48–17:30; 18:49–21:07 | Track application references, review/completeness, formation/EIN evidence, licensing/underwriter evidence, and handoff status. Actual identity collection, signing, filings, and carrier approvals require the approved external processes. |
| Let partners see their company's activity and their published material | S 22:40–24:43, especially 23:53–24:43 | Provide company-scoped activity totals, individual published statements, and exact-version shared documents. Received, closing, rejected, recovered, and lost events need distinct dates. |
| Reduce repetitive final-policy preparation | S 04:07–11:46; T 63:52–65:04; 65:56–66:03; 67:35–69:23 | Prioritize a finals queue, attachment/evidence completeness, exact source-field review, and clear waiting reasons. Tyler's reported backlog and processing estimates are discovery observations, not measured savings or a current live queue count. |
| Handle missing or explicitly referenced evidence before preparation | T 10:02–13:07; 26:06–28:14; 31:27–33:10 | Preserve references to searches/prior policies, identify missing documents, bind review to a source version, and request missing information from the responsible professional. An uploaded document does not by itself establish review or clearance. |
| Turn a bounded change request into a reviewed reply | T 39:26–41:52; 42:39–42:58 | Confirm company/profile before file; compare the old and proposed value; regenerate through the configured provider; attach the current output to a draft for human review. Complex changes need escalation. |
| Work within the actual SoftPro setup and concurrent editing rules | T 47:39–48:16; 51:14–53:56; 68:54–69:23 | Verify company profiles, configured underwriters, supported interfaces, file locks, and provider-specific jacket steps. A preparation packet cannot stand in for a provider-issued document. |
| Reconcile underwriter obligations and monthly company/member reporting | S 05:15–06:19; 13:39–14:57; T 62:07–63:15 | Preserve per-policy source rows, actual carrier names, reviewed company closes, member allocations, and delivery evidence. Obtain John's real inputs and approval rules before claiming equivalent bookkeeping. |
| Adopt the system in manageable steps and keep banking separate | S 25:35–25:38; 25:54–27:37; T 61:27–61:30 | Provide clear setup and daily-work paths. Bank-account setup milestones and reconciliation references do not authorize opening accounts or moving funds. |

Tyler discusses both finals and simple revisions as possible starting points, then emphasizes that finals alone would provide substantial relief. Stephenie's vault/onboarding priority and Tyler's production priority are complementary; neither supports claiming that the whole business can now run unattended. The reported active JV count varies around the low twenties, so the application should use an actual company inventory rather than a hardcoded number.

## Changes added in this pass

| Addition | Current implementation and its limit | Source |
| --- | --- | --- |
| Dedicated finals queue | Company/assignee/stage/search filters; waiting reasons; missing-source and review counts; next-ready-file navigation. Receipt age comes from dated finals requests, not the original order date or an upload date. Undated or incomplete receipt evidence remains unknown. This does not ingest an actual backlog automatically. | [Queue calculation](../web/lib/title/finals-queue.ts), [policy workbench](../web/components/title/policies.tsx); T 63:52–69:23 |
| Explicit source-reference checklist | Capture original reference wording, required/optional status, source type, exact document/version, review rationale, and review history. Required unresolved or changed references hold preparation. A reasoned not-applicable decision is a human review action; no automatic search interpretation is added. | [Reference UI](../web/components/title/referenced-sources.tsx), [production rules](../web/lib/title/production.ts); T 10:02–13:07; 26:06–28:14 |
| Member email/phone directory | Optional validated email and phone on company members while preserving older name/share-only records. Contacts are distinct from account grants and ownership calculations. A partner projection retains only assigned members' contact records; historical close ownership snapshots do not need contact details. | [Member editor](../web/components/title/companies.tsx), [contact validation](../web/lib/title/member-directory.ts); S 15:01–16:43 |
| Dynamic underwriter remittance rows | Carrier groups come from recorded ledger entries and visible company authority/configuration, with case/spacing deduplication. Missing carrier labels remain visible as unrecorded. No synthetic transactions, fixed universal allocation, carrier API call, or payment is created. | [Carrier grouping](../web/lib/title/underwriters.ts), [financials](../web/components/title/financials.tsx); S 05:15–06:19 |
| Real partner activity aggregates | Server projection provides only company/period counts: received, pending, recorded closings, rejected, recovered, and lost recoveries. Both company scope and a current exact member assignment are required. No raw title files, client names, addresses, premiums, contact details, or internal notes enter this summary payload. | [Aggregate projection](../web/lib/backend/partner-summary.ts), [partner portal](../web/components/title/workspace.tsx); S 23:53–24:43 |
| Overview and Settings organization | Current Carolina reporting date, policy-product premium totals for the recorded issuance period, and first-run company/access/file guidance. Settings separates Account, Connections, Team & access, and Recovery for connected users. Role/company permissions still govern the actions. | [Overview](../web/components/title/overview.tsx), [reporting helper](../web/components/title/overview-summary.ts), [account settings](../web/components/title/backend-settings.tsx) |
| Private personal assistant with specialist forks | The deployed service keeps conversations per workspace and authenticated staff user; a question can run up to two selected specialists and use the preceding three eligible same-thread turns for follow-up context. Current evidence comes from permission-scoped saved structured fields and document metadata, with source IDs. Staff can review/edit a suggested task and explicitly save it after a fresh context/revision check. The model has no record-mutation, vendor, sending, issuance, or payment tool. | [Assistant UI](../web/components/title/assistant.tsx), [context projection](../web/lib/backend/assistant-context.ts), [protocol](../web/lib/assistant/protocol.ts), [assistant service](../services/title-assistant/src/index.ts), [response rules](../services/title-assistant/src/core.ts) |

Partner event counts include each file once per event kind in a month; the categories are not mutually exclusive. Pending is a balance at historical month-end, or the recorded current-day cutoff for the current month: a known received file awaiting a recorded closing, excluding rejection/loss state until a dated recovery. Future events and unknown/invalid receipt dates do not manufacture totals. Quiet months carry forward only pending, not prior events. Closing and policy issuance remain independent. The UI defaults to the current Carolina month, while individual statement periods remain selectable in Statements.

The assistant's saved structured-field and document-metadata context is limited, but is not anonymous: it can include permitted company names, file numbers, property addresses, assignees, document names, task titles, and finance-role close totals. It excludes file bytes, extracted document text, email bodies, onboarding applications, credentials, and member contact fields from the automatic context. User-entered questions and generated answers are separate conversation content. At most three eligible prior turns from the same authorized thread are supplied as bounded historical context; they are not current evidence and cannot replace current source IDs. A document name or a stored file does not prove the assistant read it; this service does not add OCR. Specialist forks are bounded model responses, not independently authorized staff or autonomous business agents. Creating a task is a separate human-reviewed app action; a changed workspace revision or changed source access requires a fresh answer before saving.

## Coverage and remaining responsibility

“Working app” means an implemented application workflow, with the completed verification scope recorded below; it does not mean legal, accounting, or provider certification. “Manual-reviewed scaffold” means staff provide/review evidence and record external outcomes. “Vendor-dependent” means successful live operation still needs an approved integration, account, configuration, or external process.

| Area | Coverage class | What is available | What remains |
| --- | --- | --- | --- |
| Shared workspace, accounts, company/member access, private uploads | Working app | Authenticated shared backend, server role/company projection, private file access, revision/conflict controls, audit and server recovery points; local fictional mode remains separate. These capabilities predate this pass. | Real company assignments, retention/off-site recovery policy, and rollout acceptance. Current SMTP delivery status must be confirmed separately; a recovery form is not proof of a delivered email. |
| Company directory, materials, vault and partner publication | Working app | Company/member records, optional contacts, versioned files, material tasks/review, exact-version publication/replacement/withdrawal, and scoped partner access. | Approved source templates, agreed naming/import conventions, and real company record onboarding. |
| Application, formation, EIN, authority and renewals | Manual-reviewed scaffold | Application completeness/references, evidence milestones, authority records, launch checks, and renewal tasks. | Approved application/welcome templates; secure identity intake; Docusign entitlement/templates; actual filings and credential/carrier verification. No universal NC/SC legal sequence is inferred from the calls. |
| Finals intake, queue, source references and preparation | Manual-reviewed scaffold | Manual intake/uploads, evidence-linked fields, requirements/references, explicit review, multiple products, preparation/output references, corrections and follow-ups. | Actual provider output, approved underwriting/form/rate rules, operational acceptance examples, and automated document extraction. |
| Commitment/loan/field revisions | Manual-reviewed scaffold | Company/file/loan targeting, before/after review, stale-version guards, current output references, and reviewed reply preparation. | Verified SoftPro read/write/regeneration and supported file locks; Missive draft/thread/attachment integration. |
| Missive discovery and reviewed text import | Vendor-dependent | Adapter/UI for connection verification, reviewed inbox-to-company mapping, conversation/message preview, and immutable message/provenance import. | A valid token and approved mapping; successful live import remains unverified after the earlier rejected credential. Attachment bytes, polling/webhooks, and provider drafts are not implemented by text import. See [Missive status](missive-connection.md). |
| SoftPro profiles, title-file read/write, CPLs and jackets | Vendor-dependent | Local file/product preparation and recorded external references. | Confirmed version/hosting/interface entitlement, approved per-company profiles, underwriter configuration, read-only mapping validation, supported writes/locks, and demonstrated jacket/output workflows. |
| OCR and document extraction | Vendor-dependent | Manual source capture and review; explicit evidence completeness and reference checks. | A selected approved extraction service, retention/processing terms, representative redacted documents, field-level accuracy checks, and mandatory review of consequential facts. The metadata assistant does not satisfy this dependency. |
| Recipient delivery ledger | Manual-reviewed scaffold | A frozen member-statement delivery register already separates preparation, export, actual manual delivery recording, cancellation, and revision history. Policy products can record a recipient and external delivery reference. | A broader per-recipient, per-document/version delivery history for commitments, CPLs, finals, retries, and later recipients; provider receipts and actual transport. Exporting a file is not sending it. See [statement register](statement-delivery-register.md). |
| John’s closes, member statements, accounting and remittance | Manual-reviewed scaffold | Per-policy ledger, dynamic carrier rows, reviewed close revisions, cent-balanced member allocations, publication and statement delivery records; CSV parsing/mapping preview. | John's confirmed accounting software and actual books, entity mapping, reporting basis, expense/reserve/adjustment rules, effective interests, source formats, and approved import/posting reconciliation. QuickBooks remains conditional; CSV preview does not post to books, closes, or remittance. Immutable remittance batches are still separate work. |
| Partner business summary and published statements | Working app | Server-generated authorized aggregates, independent event dates, individual published allocations, and shared document versions. | Confirm the company's preferred reporting definitions and actual data quality; no internal file detail or general case browser is exposed to partners through the new summary. |
| Personal specialist assistant | Manual-reviewed scaffold | Deployed private conversations, up to two specialist results, bounded same-thread history, current-source citations, role restrictions, and explicit review/save of a task proposal with a revision guard. Live model responses and reviewed task creation were verified. | Operator acceptance of answer usefulness and ongoing model behavior. It cannot independently validate legal evidence, read attachments, issue policies, send messages, or execute other proposed business actions. |
| Bank authorization and fund movement | Intentionally external | Application can retain reviewed business/accounting milestone references without executing bank operations. | Bank actions remain with separately authorized people and systems. These calls do not establish a requirement or authorization for this application to move funds. |

## Next acceptance evidence

1. Tyler: one redacted completed final package and one ordinary revision, including original request/attachments, company profile, before/after fields, provider output, and recipient list; include a missing-reference or missing-document exception.
2. Stephenie: one redacted company folder, approved application/welcome/material templates, member contact/ownership examples, and the intended staff/partner access assignments.
3. John: two representative monthly close/report sets, a correction, the actual accounting product/version, company-to-book mapping, allocation rules, and approved statement recipients.
4. Integration administrators: working Missive token and reviewed inbox mappings; SoftPro supported-access/profile inventory and a vendor-approved test path. Start by verifying read-only identifiers before enabling a separately reviewed write operation.

These inputs resolve actual workflow questions for operator rollout; passing software tests does not establish approved vendor behavior or accounting rules. No raw private examples, account secrets, or recordings should be added to tracked documentation.

## Verification status for this pass

The coordinating developer confirmed **224 tests per round, repeated five times: 1,120 passing test cases**.

| Suite | Tests per round |
| --- | ---: |
| Domain | 109 |
| Backend and assistant context | 40 |
| Workflow features | 34 |
| Missive adapter | 24 |
| Assistant service | 17 |
| Total | 224 |

Web and assistant-service TypeScript checks passed. The private-pilot build and ordinary local production build passed. The real hosted browser pass covered all **17 pages with zero browser errors**, plus a **390-pixel mobile viewport**. Live acceptance exercised two specialist AI responses, task proposal review and save, rejection of a stale workspace revision, and company-scoped conversation history. A separate colleague verified finals filters, missing-reference handling, persisted reasoned not-applicable review, and member contact edits with ownership interests unchanged.

| Deployed component | Confirmed version |
| --- | --- |
| Application Worker | `b7981321-18e8-4baf-bdd0-5085d556c55f` |
| Private assistant Worker | `deaaa4ea-6e0c-412c-a9d7-46ed5c557f03` |
| Supabase `title-api` | Version 8; bundle SHA-256 `82c196d50de1957523db4bd8244ac3bf9690d6d6abfd87467321d128bcdc7f7f` |

No product schema migration was required. A narrowly guarded data-cleanup migration, `20260913200011_title_completed_assistant_qa_cleanup.sql`, removed the completed synthetic QA records and their dependent audit/foreign-key rows; the server's normal service role correctly cannot delete audit history. There are now ten applied Supabase migrations.

QA teardown is complete: synthetic assistant histories, the exact synthetic workspace, and two test Auth accounts were removed. Post-cleanup checks confirmed **seven users, one real workspace, seven memberships, zero QA users, and zero real company/order records**. Temporary Cloudflare QA policy/token access was removed. The temporary `title-assistant-qa` function is now a JWT-verified HTTP410 tombstone (version 3), with bundle SHA-256 `b784ec7c0298be10a5411aca833380e1190d243f0b7946fa7a64932ba8dd2bcd`.

The real Workers AI responses above do not establish successful Missive ingestion, SoftPro writes/jackets, OCR, Docusign signing, accounting imports, SMTP email delivery, or payments. Their remaining access/configuration and operational acceptance requirements are unchanged. See the [private pilot guide](cloudflare-pilot.md) for deployment and sign-in context.
