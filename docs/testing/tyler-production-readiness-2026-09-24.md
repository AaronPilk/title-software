# Tyler Production readiness — September 24, 2026

## Scope and evidence

Audit of source at `bcbf5f5`, the locally retained Tyler call, and the hosted pilot's Production overview, workbench, and inbox. Three independent reviews covered transcript alignment, extraction/final readiness, and intake/handoff integrations. Hosted inspection was read-only using the owner's existing session; it does not establish Tyler's individual access or staff-level acceptance.

The call's priority is finals first, revisions second. At 63:52–65:04 Tyler explains the roughly 80-file finals backlog and explicitly says commitment automation is not necessary for initial value. At 67:35–69:23 he describes focused processing time, saving received attachments, checking recording facts, and preparing the underwriter-specific jacket. Those historical quantities are not today's live workload.

## Built and usable with human supervision

- Finals backlog, known receipt age, company/assignee/readiness filters, missing-information reasons, and next-ready navigation.
- Original-file storage and previews, combined/separate source packages, document text/OCR, and source-linked field suggestions with quotations and page references.
- Deed/security-instrument field capture, recording facts, loan mismatch checks, requirement review, and commitment review that expires when relevant facts change.
- Missing-document requests and follow-ups; local revision review and local reply drafts tied to the current revised commitment.
- Policy preparation, external handoff tracking, and recording externally completed issuance/delivery.

This is a preparation and review workspace. The existing final export is JSON explicitly marked `notAPolicy`; it is not an insurer-issued policy jacket. Official SoftPro/underwriter reads and writes remain outside the implemented workflow, consistent with the user's instruction to defer that integration.

## Verified gaps

1. **Daily navigation:** Production starts with company/premium statistics and generic tasks. Hosted inspection showed agency tasks on this screen. The finals workflow is behind Policy workbench and split across source, details, document review, and lifecycle tabs.
2. **Intake:** a title file must already exist before uploading its package. New-file creation asks for manual property/client details before the document reader can help.
3. **Missive:** configuration and daily provider imports share an administrator-only Settings surface. An ordinary operations user cannot independently perform those imports. This audit did not recheck the live token/routing configuration. The current adapter reads from Missive; local reply approval/export does not send a message or create a provider-side draft.
4. **Field coverage:** the final source-capture flow focuses on 11 deed/security fields. Broader package suggestions do not automatically populate every title-file field. Legal-description exhibits, requirements/exceptions, and legal conclusions still require human handling.
5. **Output:** the reviewed final handoff lacks a convenient human-readable consolidated package with selected originals and the associated reply. The existing JSON/TXT exports leave assembly manual.
6. **Real-document acceptance:** the hosted pilot showed zero title files and an empty request inbox at inspection. Synthetic tests do not measure accuracy on Tyler's actual recorder scans, deeds, final opinions, exhibits, or attorney packages.

## First correction from this audit

The reader accepted `USD 250,000.00` and `US$250,000.00`, but final readiness parsed only dollar signs/commas/spaces. A correct captured principal therefore failed the loan-match gate. The correction shares a strict source-amount parser between extraction and readiness, preserving the original captured text and rejecting ambiguous/malformed amounts. Test results and landed commit are recorded in the coordination log.

## Next implementation order

1. Production home becomes a work queue: Finals, Revisions, Waiting, and Drafts. Each item has company/file context, the blocker, and a direct Continue action. Keep first-use instructions focused on bringing in one package.
2. One guided intake: choose company, upload package, review proposed file identity and document roles, confirm the destination, then open the same file-review workspace. No silent routing or duplicate-file creation.
3. One continuous final review: original page beside captured facts, requirements and missing-document actions in context, and a compact readiness checklist. Preserve current version, cross-company, ambiguity, and approval protections.
4. A useful reviewed handoff: human-readable summary, selected original documents, outstanding items, and an in-system reply draft. Keep actual provider sends separate until explicitly implemented and tested.
5. Representative acceptance: purchase, refinance, cash, multi-loan, separate/combined packages, long scans, conflicting amounts, missing recording pages, and replacement documents. Tyler supplies expected facts and confirms the results against originals; report omissions and corrections rather than claiming perfect OCR.

Keep SoftPro automation and accounting outside these first slices. Production antivirus activation and recovery verification are separate operational prerequisites before broad live-document import; paid antivirus hosting remains unapproved.

## Validation boundary

The initial extraction/readiness/package run passed 125 tests, including 16 finals workflow tests. An additional 41 capture/package UI checks passed. An independent review also reran the same 16 finals tests; do not add them again to the total.

After the currency correction, all 81 affected extraction, finals, capture-evidence, and document-intelligence tests passed. Four new regression tests cover supported prefixes on deed-of-trust and mortgage sources, original evidence and review gates, actual principal differences, malformed amounts, and cash files. The full domain and 117-test backend suites, typecheck, lint, pilot build, and backend bundle also passed. These runs overlap; their counts are not a unique combined test total.

Generated PDF/OCR fixtures establish tested mechanics and guard behavior, not real-world extraction accuracy. No client records, messages, permissions, provider settings, or paid services were changed. This source correction has not been deployed to the hosted frontend or title API as part of this audit.
