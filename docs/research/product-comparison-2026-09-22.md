# Ballantyne software: current market comparison

Checked September 22, 2026. Vendor capabilities below come from official public pages, not hands-on vendor trials. Our capabilities were checked against the application source and automated tests. Account activation, purchased vendor modules and a completed staff acceptance test are separate questions. No pricing, accuracy, time savings or overall ranking is inferred.

## Where our system fits

Our strongest fit is a workspace tailored to Ballantyne's agency and joint-venture operations, with reviewed production work alongside SoftPro Select and Missive. It brings company onboarding, dated ownership, authority evidence, controlled company materials, staff tasks and member reporting together with source documents, commitments, finals and revisions.

It is not yet a replacement for a mature title/escrow production platform. The largest missing capability is a supported, live SoftPro reader/writer with verified results. OCR already reads document text, but we have not demonstrated automatic extraction of legal fields followed by safe updates to Select. Those are different capabilities.

Multiple companies, portals and AI are not unique selling points by themselves. Qualia Atlas explicitly markets multiple agencies in a deployment, isolated permissions, shared work and consolidated reporting. Our opportunity is to prove a better fit for the particular company-onboarding, ownership and production work Ballantyne performs. [Qualia Atlas](https://www.qualia.com/atlas/)

## Relevant alternatives

| Product | What its maker advertises | How it compares with our current app |
| --- | --- | --- |
| **SoftPro Select, ProInterface and SoftPro 360** | Title/closing production, trust accounting, workflow automation, documents, reporting and permissions. ProInterface provides custom-integration API/SDK capabilities; 360 connects service providers and underwriters. | This is the existing production authority, so the first step is checking licensed native features and supported integration access. Our preparation/outcome ledger does not yet read or write Select. [Select](https://www.softprocorp.com/real-estate-software-solutions/softpro-select/), [360](https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/), [custom development](https://www.softprocorp.com/software-services/custom-development/) |
| **Qualia Core / Atlas, with Connect and Clear** | Cloud production/accounting, integrations and multi-agency operations. Connect handles customer communication. Clear 2.0 describes specialized AI agents; the separate Clear Essentials suite includes support, order opening and CD processing. | A broad replacement-platform comparison. It already competes on multi-agency workflows and AI. Ask for a demonstration of our exact JV ownership and member-reporting cases rather than assuming those capabilities are absent. [Core](https://www.qualia.com/title-and-escrow/), [Atlas](https://www.qualia.com/atlas/), [Connect](https://blog.qualia.com/qualia-connect-beyond-the-portal/), [Clear 2.0](https://blog.qualia.com/introducing-qualia-clear-2-0-a-giant-step-toward-fully-automated-title/), [Clear Essentials](https://www.qualia.com/press-releases/qualia-launches-qualia-clear-essentials-bringing-ai-to-every-title-and-escrow-team/) |
| **Resware** | Configurable actions and workflows, APIs, document generation/routing, communication and escrow/trust reconciliation; current product material describes on-premises deployment. | A useful benchmark for complex production operations and configurable workflows. It belongs to Qualia, which acquired its developer Adeptive in 2020. [Product](https://www.qualia.com/resware/), [ownership](https://blog.qualia.com/qualia-acquires-adeptive-resware/) |
| **RamQuest Horizon** | Browser-based title and settlement software, accounting, templates, rate/fee calculators and dashboards. | Another broader production-system comparison, also part of Qualia. Confirm current sales availability and roadmap directly; public pages do not establish future support terms. [Horizon](https://www.ramquest.com/horizon), [2025 acquisition announcement](https://www.qualia.com/press-releases/old-republic-title-and-qualia-announce-strategic-technology-partnership/) |
| **Alanna.ai** | An AI/communication layer integrated with SoftPro Select, including order entry, document processing, texting, status updates and information collection. | A direct comparison for improving the existing stack without replacing Select. Its exact Missive compatibility, JV routing and covered fields need demonstration. [SoftPro integration](https://www.alanna.ai/softpro-integration/) |
| **Pythonic** | Document/data workflows integrated with SoftPro and Resware. SoftPro describes its CD comparison with operator selection of changes and reviewed order entry. | The closest comparison for our planned document-to-SoftPro path. We need to prove an equivalent end-to-end path; reading text alone does not do that. Confirm support for the specific SoftPro edition and module. [Integrations](https://pythonic.ai/integrations), [SoftPro CD integration](https://blog.softprocorp.com/introducing-pythonic-integration-in-softpro-360), [SoftPro order-entry description](https://blog.softprocorp.com/artificial-intelligence-part-2-6-ways-title-companies-can-harness-ai) |

These are six product comparisons, not six independent vendors: Resware and RamQuest are within Qualia. Alanna and Pythonic were selected through research; neither of the supplied requirements PDFs named competitors. Their absence from a public feature list is not evidence that a vendor lacks a capability.

## What is actually built here

| Area | Implemented | Remaining boundary |
| --- | --- | --- |
| Agency and Production views | Separate Agency and Production views over shared workspace data, company onboarding, dated ownership, authority evidence, company materials, tasks and staff assignment. | Stephenie and John still need to validate their actual daily procedures. Navigation preference does not grant permission. |
| Company and document access | Supabase authentication, server-enforced role/company scope, private assets and reviewed publication. | Automated security checks do not replace staff acceptance or an independent assessment. See the [security release](../testing/security-remediation-2026-09-22.md). |
| Production preparation | Source-linked capture/review, commitment and final preparation, multiple loans, revisions, corrections, external references and stale-work guards. | A recorded issuance/delivery reference is not an underwriter-issued policy or a sent message. |
| Documents and OCR | Original-file storage, PDF preview/text extraction, scanned-page OCR and source citations. | OCR output needs review; structured legal-field extraction and a tested Select write are not completed. |
| Financial review | Period summaries, expenses, captured close revisions, dated ownership allocations and published member statements. | This is not a general ledger, trust accounting, three-way reconciliation or payment system. Accounting CSV import currently previews/maps columns; it does not post transactions. John's acceptance is still required. |
| Missive / SoftPro coordination | Missive import/routing/attachment code; stored SoftPro profile/file links, reviewed proposals and external outcome records. | Implementation is not proof of current live account configuration. There is no supported live SoftPro connector yet. |
| Staff assistant | Scoped app-record context, specialist forks and reviewed task proposals. | It does not automatically understand all email/PDF content or perform SoftPro actions. |

## Priorities from the comparison

1. **Prove the agency workflow with staff.** Create one actual company, attach authorized original evidence, confirm ownership and staff access, then have Stephenie and John complete a small set of daily tasks. Measure confusion, missing steps and incorrect results before expanding the rollout.
2. **Request the supported Select integration now.** Ask the representative about the deployed version, ProInterface licensing/API/SDK, a test environment, permitted read/write operations, concurrency/locking, audit history and support. Keep existing 360 underwriter channels. Preparing a demonstration does not require pretending the connector already exists.
3. **Build and measure one complete production flow.** Start with one confirmed company/profile and a representative file: Missive source → correct company/file → reviewed extraction → proposed changes → confirmed Select result. Add ambiguity, multiple loans and stale changes before increasing automation.
4. **Run a fair build-versus-buy benchmark.** Compare our app, relevant SoftPro-native options, Pythonic and Alanna on the same authorized cases. A vendor trial requires separate permission to share those documents. Keep originals in the authorized private workspace; use fictional fixtures in public tests and GitHub.

## Benchmark to run with the owners

Use a straightforward request, an ambiguous JV, the same borrower in two companies, a combined scanned final package, multiple loans, a repeated revision, and a late correction. Include a company ownership change after a period statement was published.

Measure correct company/file routing, exact names/amounts/legal text, human corrections, staff time, stale-change detection, source traceability and confirmed external outcomes. Record both successful and blocked cases. No unattended write passes until it selects the correct file, preserves review, detects newer changes and verifies the result.

We have not established that our UI is easier than vendor products through public-page research. That needs observed task completion with users and comparable vendor trials. The next useful evidence is a completed staff workflow and a supported integration, not more unmeasured feature count.
