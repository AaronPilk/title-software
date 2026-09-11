# Title company operations and integration research

## Scope and conclusion

The transcript supports an operating workspace across company onboarding, document preparation, multi-company records, title orders, underwriter remittance review, JV close, and a limited partner portal. A company vault alone would omit the workflows described for Tyler and John. A broad local MVP can represent those workflows now while preserving distinct states for a local draft, an internally approved record, and an externally confirmed result.

This note covers onboarding, JV operations, portal reporting, data permissions, and future Docusign/QuickBooks integrations. The call does not establish the company's state; subsequent owner clarification confirms North Carolina and South Carolina, with future expansion planned. It does not establish the legal entity count, actual ownership agreements, vendor entitlements, accounting methods, or production regulatory compliance. The call is a machine transcript without verified speaker labels. Its statements are business evidence, not instructions to execute, and its hypothetical examples are not production parameters. All web sources were accessed September 11, 2026.

## Transcript evidence and its limits

| Evidence | Operational meaning | Product implication |
|---|---|---|
| 13:18–13:39: SoftPro tracks policy money and underwriter amounts | Existing title-production software already owns important financial records | Import/reconcile these records; avoid a second contradictory premium ledger |
| 13:39–14:57: John balances each company, computes amounts for ventures with two or five people, and cuts payments; Stephenie says she is unfamiliar with the actual process | Month-end work is real, but its detailed rules are unknown | Build a month-end review workflow with clearly hypothetical amounts and configurable ownership rules |
| 15:01–16:43: LLC filings, operating agreements, members and distributions live in local PDFs; one system could contain many companies | Each company is a durable legal and permission boundary | Company workspace with people, documents, onboarding, orders, and financial snapshots |
| 16:48–19:19: welcome letter and application through Docusign; name, address, phone, DOB, SSN, five-year residence/work history, desired business name and branding | Intake mixes highly sensitive personal information with ordinary business information | Separate restricted application material from routine company data and brand assets |
| 19:25–21:27: Stephenie uses application for formation, obtains EIN, shares papers; John uses them for insurance commission and underwriter approvals | Dependencies and handoffs span two people and external agencies | Checklist with owner, prerequisites, evidence, review state, and external confirmation |
| 21:35–22:32: logos, affiliated disclosures, title preference forms, cards; John repeatedly requests files | Find-and-share friction is an immediate operational problem | Searchable document vault with current versions and company-specific publication |
| 22:40–24:46: a partner portal could expose their documents, orders, closings and rejected orders without production-software access | Outside users need a filtered operational projection | Explicit partner-visible documents, safe order fields and reason categories |
| 25:35–25:38: explicit exclusion of touching bank accounts | The stated requested boundary persists | No payment execution or bank credentials in MVP or proposed connectors |
| 26:59–27:17: “If John uses QuickBooks” | QuickBooks usage is speculative | Keep accounting integration behind an adapter and verify product/version before implementation |

The earlier title-production discussion supports Tyler's work; Stephenie expressly states at 12:55–13:01 that she does not know everything they do. The transcript therefore supports broad coverage, but cannot support a claim that every company function has been fully specified.

## Proposed operational model

### Onboarding and company launch

Use an onboarding case rather than making “company created” imply “licensed and ready.” Proposed stages are Prospect, Application, Formation, Licensing, Underwriter setup, Brand package, and Ready. A case contains independent checklist items because not every external step happens sequentially.

A useful local flow is: create company; add member records; mark a sample application requested/received; record formation and EIN evidence; assign John licensing and underwriter tasks; create draft business assets; resolve missing items; mark the internal onboarding checklist complete. External filing and approval steps must retain evidence and confirmation fields. A completed checkbox must not invent state approval or an issued EIN.

Candidate checklist items are welcome letter, member application, operating agreement, formation certificate, EIN confirmation, individual license evidence where applicable, agency license/registration, underwriter appointment/approval, approved affiliated-business disclosure, title preference document, logo, business card, and partner access review. This is an inferred product model, not a validated universal state-law checklist.

Each checklist item should have company ID, stage, owner, due date, blocked reason, required evidence type, document version references, status, reviewer, and completed timestamp. Reminders should be surfaced locally now; sending reminders becomes a separate integration capability later.

### Company records and document vault

Every document belongs to a company and optionally an onboarding case, order, member, or financial period. Keep an immutable original file plus versioned metadata, classification, current/superseded status, author, upload timestamp, expiration date if meaningful, and publication scope. The MVP can demonstrate uploads and preview with synthetic or explicitly redacted data. Demo localStorage/IndexedDB is persistence for evaluation, not an access-control system.

Recommended classifications:

- Restricted identity: applications containing SSN, DOB, address/work history, background-check material.
- Company confidential: ownership agreement, EIN letter, insurance documents and financial statements.
- Order confidential: title and transaction documents, lender/borrower information, correspondence.
- Partner published: approved affiliate disclosure, logo and business card files, selected statements.

Mask identity data in tables and search snippets. Keep operational search based on company, order, document type and status rather than indexing raw SSNs. Do not place raw applications, recording, transcript, secrets or customer files in GitHub. File sharing should be an explicit publication action, not an automatic result of upload.

A document card needs a clear action with a real local effect: preview, download, edit tags, replace with a new version, or publish to the demo portal. “Generate disclosure” should create a labeled draft from a configurable, approved template; it should not silently produce final legal language.

### Month-end close and joint ventures

The call distinguishes underwriter remittance from JV owner distributions. Use two sections and two data models.

An underwriter remittance batch groups policies by company, underwriter, and remittance period. The review screen should compare imported policy counts and premium values to the upstream remittance report, show exceptions, and record a reviewed state. The call's 30% WFG example is illustrative. Store an agreement/rate reference and effective date; never hardcode 30% as a company rule.

A JV close period should progress through Open, Data imported, Exceptions resolved, Reviewed, Statements approved, and Closed. Proposed inputs: title activity, underwriter obligation, operating expenses, adjustments, retained reserves, and accountant-approved distributable amount. Actual recognition rules, cash versus accrual basis, capital returns, taxes, ownership changes and special allocations require John's records and the operating agreements.

A local demonstrator may compute “illustrative distributable profit × ownership share,” with decimal money handling, shares totaling 100%, period locking, explicit adjustments, and visible review status. Label results estimates. A production implementation should use an approved allocation rule version and effective ownership schedule, with a captured calculation snapshot. A statement should identify the company, period, basis, components, member share, adjustments, approval and source report references.

Partner referral activity may be useful operational analytics, but should not be an input to distribution amounts or ownership percentages. Do not create per-order partner commissions from this transcript. CFPB's rule is especially relevant because the call explicitly mentions affiliated disclosures and mortgage/real estate partners; the detailed lawful arrangement still depends on facts and applicable law.[2]

There should be no “Pay,” “Send wire,” “Connect bank” or “Issue check” action. “Export approved statement” and “Record payment reference” are sufficient future bookkeeping interactions, the latter recording a separately completed action rather than executing it.

### Partner portal

A partner should see only authorized companies and information intentionally published to them. The portal can provide current company documents, submitted orders, high-level status, missing partner-provided items, closing counts, categorized lost/rejected orders, and approved statements. It should not expose all source documents, legal notes, other owners' personal information, underwriter credentials, or company-wide income by default.

The call's request for rejected-order visibility supports a lost-business review queue: rejection reason, stage, source, date, owner, next follow-up, reopened flag, and resolution. Distinguish attorney rejection, customer choice, duplicate, cancellation and pending decision. Avoid labeling every lost case “rejected by attorney” without source evidence. Recovering an order means legitimately resolving a documented operational issue; dashboards should not imply that a customer is required to use an affiliate.

## Permission design

The following is a proposed authorization matrix derived from the people and sharing needs in the call. Implementing only a role dropdown is a demo of this matrix; production enforcement belongs on the server and file-delivery layer.

| Role | Intended scope | Sensitive application access | Financial capability | Publishing |
|---|---|---|---|---|
| Organization administrator | User and company configuration | Explicit grant, not inherent need | Configure permissions; not automatic financial approval | Configure publication policy |
| Stephenie / onboarding operator | Company intake, formation records, assets | Assigned onboarding cases | None by default | Draft and publish approved company assets |
| Tyler / title operations | Assigned orders and production tasks | None by default | View relevant policy/remittance metadata | Publish approved operational updates |
| John / finance and company manager | Company setup and month-end | Assigned licensing need | Review remittance, allocation rules, approve statements | Release reviewed statements |
| Reviewer / compliance | Assigned evidence and audit records | Explicit case need | Review relevant evidence | Approve controlled templates |
| Partner | Whitelisted companies and published records | Own secure intake only if required | Own approved statements; no other member amounts | None |

Access should combine organization, company, record type, field classification, and action. Maintain separate permissions for viewing identity data, downloading files, editing financial assumptions, approving distributions and publishing documents. Record who made each meaningful change and why. A support administrator should not receive unlimited identity access merely to administer user accounts.

## Industry and legal findings

ALTA's public framework is version 4.2, dated August 19, 2025. It covers licensing; escrow controls; information security; settlement procedures; policy production, delivery and remittance; insurance; and complaints. Its information-security guidance includes unique accounts, MFA when available, incident/continuity planning, and vendor review including AI/API systems. It addresses local, data-center and cloud systems, so it does not establish a universal requirement for local-only deployment. It distinguishes escrow funds from operating funds. Its policy guidance uses 30 days for delivery and 45 days for reporting, measured from the later relevant event and subject to stricter obligations. Therefore a future compliance task engine needs configurable jurisdiction/contract deadlines, not universal hardcoded dates. These are industry best practices, not a software certification or a complete statement of law.[1]

CFPB Regulation X §1024.15 conditions the affiliated-business exemption on disclosure, the required-use restriction with specified exceptions, and permissible returns. It excludes purported ownership returns calculated or adjusted according to referrals, and requires covered disclosure records to be retained for five years after execution. Application depends on the facts. Keep distribution calculations separate from referral analytics and retain the executed disclosure and its delivery evidence.[2] Appendix D identifies transaction, referring party, relationship/ownership and estimated charges, plus the applicable consumer-choice language and acknowledgment. A generic reusable PDF in the company vault does not by itself establish transaction-specific delivery.[3]

Engineering implications are to model disclosure templates separately from disclosure instances and keep template version, referring party, referred provider, transaction/property, ownership statement, charge schedule, delivery timestamp, recipient and acknowledgment evidence on each instance. State-specific language and choice of template remain unresolved until jurisdiction and counsel-approved originals are supplied.

## Docusign integration decisions

Docusign's October 3, 2025 announcement removed the old requirement for 20 successful API calls in the streamlined Go-Live process. Production eligibility depends on integration type and account entitlement; private custom integrations cover internal customer workflows, while public/embedded partner models carry different requirements. Older Docusign pages still describe the 20-call process, so those instructions should not be treated as current.[4][5]

Promoting an integration key does not migrate everything. Production needs OAuth configuration, endpoints, templates, users and account settings checked separately.[6] Connect notifications can be authenticated with HMAC to verify source and message integrity.[7] The later integration should use OAuth, server-held credentials, environment-separated template IDs, authenticated event handling, and a durable envelope-to-company/case mapping.

Proposed adapter contract: create application packet draft; send an approved packet; get envelope status; retrieve completed documents/certificate; receive status events. Model Draft, Sent, Delivered, Completed, Declined and Voided separately. The UI can simulate them locally, but a completed demo must never be represented as a signed production agreement. Avoid putting SSN/DOB in envelope names, URLs, logs or custom metadata; if required, collect them through the approved secure application process.

For events, acknowledge after durable intake, deduplicate by event/envelope identity, process asynchronously, reject invalid signatures, and fetch authoritative envelope state when needed. These are recommended engineering choices. A browser-only local MVP should have no live webhook endpoint or production secret.

## QuickBooks integration decisions

The transcript does not establish that John uses QuickBooks, whether it is Online or Desktop, or whether each JV has separate books. Confirm that before selecting a connector. Intuit's U.S. help page says multiple QuickBooks Online company files remain separate and each new company requires its own subscription.[8] Classes are segments within a company and Intuit identifies class reporting with Plus/Advanced; a class should not be casually substituted for a separate legal company.[9]

Intuit's official OAuth Node client documents OAuth 2.0, sandbox/production environments, token refresh, `realmId`, accounting scope and a separate payments scope.[10] Intuit's published Postman collection demonstrates the company-scoped GET ProfitAndLoss report endpoint.[11] Its official SDK documentation also describes Reports API usage.[12] The official CloudEvents sample demonstrates current event parsing and HMAC-SHA256 verification; it is a reference sample, not a production storage solution.[13]

Recommended first connector is read-only in application behavior: import approved accounting reports and show source timestamps, company/realm mapping, accounting basis and period. Do not request the payments scope. Accounting scope is not a guarantee of read-only access; enforce an allowlist of read operations in our connector, avoiding any generic write proxy. Keep tokens on the server, refresh atomically per connection, and handle disconnected/revoked accounts visibly.

Use one connection record per authorized company realm and never infer the company merely from an invoice's display name. Persist source system, source ID, company ID, connection ID, period, report parameters, retrieved time and source response checksum. Imported reports should be immutable snapshots; corrections create a new version and reopen review. If entities/events are later synced, verify signatures, deduplicate deliveries, then fetch source data, with periodic reconciliation for missed events. Do not copy the sample's in-memory storage into production.

Do not make QuickBooks the assumed source for title policy status, recorded deed fields or partner entitlement. It is a possible accounting source after validation. Likewise, do not let a QuickBooks report directly approve JV distributions; approval and ownership rules belong in the operational workflow.

## Reporting dimensions and definitions

Recommended dimensions are company/legal entity, period, order stage, order owner, underwriter, referral source, partner, attorney, transaction type and exception type. Distinguish date received, scheduled closing, actual closing, recording, policy issuance and accounting-posted date. The currently unknown “what closed this month” definition must be made explicit per report.

| Metric | Suggested definition | Important distinction |
|---|---|---|
| Open orders | Orders not terminal as of the selected snapshot | Not the number received this month |
| Received orders | New orders with received date in period | Does not imply acceptance or revenue |
| Closed orders | Orders with actual closing date in period | Not necessarily final policies issued |
| Rejected / lost orders | Orders with a recorded terminal reason in period | Show reason and source; exclude duplicates separately |
| Recovery rate | Reopened eligible lost orders later resolved, divided by eligible lost orders in a defined cohort | Not all cancellations are recoverable |
| Final policy backlog | Closed/requirements-satisfied files missing external issuance confirmation | Requires operational timestamps and rule configuration |
| Underwriter due | Imported and reviewed obligations less supported adjustments/remittances | Not a universal percentage calculation |
| Distributable estimate | Explicitly approved financial basis less configured reserves/adjustments | Not gross premium or referral commission |
| Member distribution | Approved distribution base allocated under effective agreed rules | Not proportional to referred order count |
| Onboarding health | Required evidence satisfied, blocked items, days in stage | Formation is distinct from licensing and appointment |

All sums should use integer minor units or a decimal-money library. Ownership should use sufficiently precise shares and deterministic rounding with residual allocation. Avoid summing multiple financial periods or multiple snapshots of the same underlying report. Show currency, basis, as-of time and demo status close to financial outputs.

## Phased implementation

1. Local interaction MVP: synthetic company/order/application data; meaningful create/edit/filter/review/export flows; same company boundary across modules; role-view demo; document version metadata; visible simulated integration states; resettable persistence; comprehensive representative exceptions.
2. Shared internal foundation: identity and MFA; real authorization; database and object storage; audit events; encrypted sensitive fields; retention rules; backup/restore; secret management; established document templates. Hosting choice follows access needs and risk review, rather than inheriting the transcript's unsupported assumption that local-only is inherently secure.
3. Intake and file migration: redacted pilot data, mapping/duplicate review, secure Docusign sandbox flow, completed-document reconciliation, import evidence. Test permission isolation before broad access.
4. Title production connector: approved SoftPro/underwriter access and source-of-truth decisions, read-only order import first, document-review handoff, external confirmation. Detailed vendor findings are a separate research workstream.
5. Finance connector: confirm accounting product and entity setup, read-only report imports, two trial month-end closes reconciled against John's existing process, approved allocation rules, partner statements.
6. Controlled automation: reminders, intake classification, document extraction with source evidence, exception routing and reviewed exports. Expand external writes only after exact vendor capabilities, authority and evidence flows are proven.

## Information still needed before production wiring

- Confirmed operating states are North Carolina and South Carolina; individual property jurisdictions, entity structure and actual number of active JVs still need validation.
- Whether the business performs settlement/escrow/recording or receives completed attorney documents only.
- Tyler's complete daily process, actual handoffs, exceptions and order acceptance criteria.
- John's month-end worksheets, accounting software/product, chart of accounts, cutoff conventions, reserves and approved allocation rules.
- Redacted operating agreement, onboarding application, ABA disclosure and preference form; template ownership/approval.
- Per-company/underwriter agency agreements, premium remittance obligations and policy timing.
- Existing Docusign account plan, templates, envelope ownership and external intake consent flow.
- Partner permissions: company-wide order visibility versus only their submitted orders; which financial statements each may receive.
- Retention policy, company security program, authorized migration scope, and recovery requirements.

These gaps do not prevent a realistic local MVP; they prevent claiming production automation is complete.

## Sources

1. American Land Title Association. *ALTA Best Practices Framework: Title Insurance and Settlement Company Best Practices*, v4.2, August 19, 2025. https://www.alta.org/policies-and-standards/best-practices/download.cfm?bestPracID=113&type=pdf . Current version listing: https://www.alta.org/policies-and-standards/best-practices/ . Accessed September 11, 2026.
2. Consumer Financial Protection Bureau. *§1024.15 Affiliated business arrangements*, current Regulation X page, sections (b)(1)–(3) and (d). https://www.consumerfinance.gov/rules-policy/regulations/1024/15/ . Accessed September 11, 2026.
3. Consumer Financial Protection Bureau. *Appendix D to Part 1024 — Affiliated Business Arrangement Disclosure Statement Format Notice*, current page. https://www.consumerfinance.gov/rules-policy/regulations/1024/d/ . Accessed September 11, 2026.
4. Rajvir Sethi, Docusign employee. *No More 20 API Calls: Introducing the Streamlined Integration Go-Live Experience in Apps & Keys*, October 3, 2025. https://community.docusign.com/go-live-70/no-more-20-api-calls-introducing-the-streamlined-integration-go-live-experience-in-apps-keys-25623 . Accessed September 11, 2026.
5. Docusign Developer Newsletter, November 2025, *Move integrations to production with less time and effort*. https://developers.docusign.com/html/newsletter/202511.html . Accessed September 11, 2026. Corroborates the supersession of the 20-call prerequisite.
6. Deepak Munayat, Docusign. *From the Trenches: Your app's approved for go-live: now configure your production account!* Undated page. https://www.docusign.com/blog/developers/dsdev-from-the-trenches-your-apps-approved-for-go-live-now-configure-your-production-account . Accessed September 11, 2026.
7. Adil Bukhari, Docusign. *Manually authenticating HMAC signatures for Docusign Connect webhook configurations*. Undated page. https://www.docusign.com/blog/developers/manually-authenticating-hmac-signatures-docusign-connect-webhook-configurations . Accessed September 11, 2026.
8. Intuit. *Create or add another company file*, U.S. help page. https://quickbooks.intuit.com/learn-support/en-us/help-article/account-management/create-add-another-company-file-quickbooks-online/L1WEnRQs1_US_en_US . Accessed September 11, 2026.
9. Intuit. *Run reports by class in QuickBooks*, U.S. help page. https://quickbooks.intuit.com/learn-support/en-us/help-article/class-list/run-reports-class/L73XjI7rG_US_en_US . Accessed September 11, 2026.
10. Intuit. *OAuth Client for Intuit*, official Node.js repository README. https://github.com/intuit/oauth-jsclient . Accessed September 11, 2026.
11. Intuit Developer. *Report-ProfitAndLoss*, published QuickBooks Online Accounting API Postman collection. https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/request/4884662-561138cb-5782-4271-a70c-e502771c1cc4 . Accessed September 11, 2026.
12. Intuit. *Quickstart — QuickBooks V3 PHP SDK*, Reports section. https://intuit.github.io/QuickBooks-V3-PHP-SDK/quickstart.html . Versioned SDK documentation, used as evidence of reports capability rather than a recommendation to select PHP or that SDK version. Accessed September 11, 2026.
13. IntuitDeveloper. *SampleApp-Webhooks-Java-Cloudevents*, official sample README. https://github.com/IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents . Accessed September 11, 2026.
14. *Call with Stephenie Tocado — machine transcript*, private supplied recording transcription. Local source: /Users/pilksclaes/Title software/.local/discovery/call-transcript.md . Timestamps cited in the evidence table; speaker identities and transcription accuracy unverified.

Source access limitation: Intuit's current developer portal returned only a JavaScript app shell for /app/developer/qbo/docs/workflows/run-reports, /develop/webhooks and /develop/authentication-and-authorization. The findings above therefore rely on Intuit-owned SDK/repository and published collection sources; exact endpoint parameters, API entitlements and current quotas must be checked during implementation. Docusign's current go-live page likewise returned no readable body, so the dated official employee announcement and developer newsletter were used to resolve contradictory older guidance.
