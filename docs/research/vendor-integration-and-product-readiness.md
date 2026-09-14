# Vendor integration and product readiness

SoftPro has a documented custom-integration route. The next step is to obtain the interface and access appropriate to Ballantyne's installation while continuing to build and test the internal application. A polished demonstration can support that conversation now; the external connector cannot be accepted before its actual interface, permissions, company identifiers and transaction behavior are known.

This report distinguishes official vendor statements, Ballantyne's proposed requirements, and engineering recommendations. Public sources were checked September 14, 2026. Public capability descriptions do not establish Ballantyne's purchased entitlements, configured features, or production permission. Application status changes during development; the maintained implementation inventory is [Requirements implementation](../REQUIREMENTS_IMPLEMENTATION.md).

## Company mappings in plain language

A company mapping is the application's verified routing record for a title business. For example, a message addressed to a particular JV's inbox must lead to that JV's exact company inside SoftPro, its underwriter and templates, and the staff allowed to work its files. It prevents a correct piece of information from being attached to the wrong LLC's transaction.

The revised requirements describe one SoftPro Select environment containing separate company entries, selected through a company dropdown. That is different from requiring a separate login or software installation for every JV. The proposed master setup asks for each company's exact name, inbox, underwriter, templates, numbering, contacts and access rules. These values need operational confirmation because they cannot be safely inferred from a logo, company name, borrower or property address. [1, pp. 2-4, 12, 22; 2, pp. 1-3]

| Mapping information | Concrete example using fictional values | Who can confirm it |
| --- | --- | --- |
| Business identity | Example Title LLC; internal company key `example-title` | Stephenie or company administrator |
| SoftPro environment and company identity | Production environment A; vendor-provided company ID; exact dropdown name | SoftPro administrator and representative |
| Mail routing | Orders and revisions sent to an approved shared inbox or alias | Staff who manage Missive |
| Underwriter/channel | Authorized underwriter and the existing corresponding 360 integration | Authorized title operator |
| Defaults | Approved template, document naming, numbering and archive location | John/Tyler and administrator |
| People and authority | Who may view, propose, approve, administer and see financial information | Business owner/administrator |

For a business with one title company, there is one such record and the interface can select it automatically. For a group with approximately 25 JVs, the same design contains approximately 25 records. Separate customer organizations must remain separate workspaces even if their companies happen to share a name or use the same vendor. Company membership is an authorization boundary; a dropdown choice alone is not permission.

Business confirmation should be practical: begin with one active company's verified setup and representative files, then repeat the onboarding process for the remaining companies. A full directory is necessary before routing live work for every JV, not before anyone can review the pilot.

## What is confirmed about SoftPro

SoftPro's Select product page identifies ProInterface as the API including the SDK for custom integration. It also advertises customizable fields/workflows, permissions, order history and native automation. That confirms an integration path exists; it does not publish an unrestricted REST API for a browser application. [3]

SoftPro's public NuGet publisher lists Core, Server and Shell SDK packages. The descriptions include command-line applications and extensions to the Select mid-tier server. Several displayed package versions date to 2019-2020. Their presence is evidence of SDK distribution, not a reason to install those versions against an unknown current production deployment. [4]

SoftPro also offers custom-development services covering data import for order/template creation, third-party vendors, CRM and accounting integrations. A customer need not present a completed replacement product to ask the integration team which supported route fits its installation. [5]

| Question | Confirmed | Still unknown for Ballantyne |
| --- | --- | --- |
| Can Select support custom integration? | ProInterface/API/SDK is publicly offered. [3] | Entitlement, onboarding process, version, documentation and fees |
| Does a public package prove cloud REST access? | SDK packages are publicly listed. [4] | Approved transport, hosting location, required runtime and network route |
| Can integration create or change our particular files? | Custom integration and order-import services are advertised. [3, 5] | Exact read/write methods, supported fields, company scope, lock behavior and result contract |
| Can a service operate independently of a staff member's desktop? | A server-side SDK exists. [4] | Whether Ballantyne's hosting permits a service and which license/account it needs |
| Can the connector issue all underwriter products? | Existing 360 integrations cover specific products. [6, 7] | Ballantyne's authority, product/version support and programmatic trigger/accept capabilities |

An API is not necessarily an internet URL. Depending on the vendor-supported arrangement, the integration could require a service near SoftPro, a supported extension, or another approved transport. That is an architectural possibility to confirm, not an assertion about Ballantyne's installation. Do not invent endpoint names, write directly to Select's database, or substitute screen clicking for a vendor contract.

### Existing SoftPro 360 channels

| Channel | Publicly described capability | Engineering implication |
| --- | --- | --- |
| First American AgentNet | CPLs, searches, jackets, rate validation, policy upload/remittance; automation for certain actions. [6] | Preserve the existing channel and ask which actions can be triggered and confirmed in this installation. |
| Fidelity/Commonwealth agentTRAX | CPLs, jackets, policy-image upload, premium reporting, high-liability approval and endorsement mapping. [7] | Match the configured underwriter before requesting an action; retain returned product identifiers and evidence. |
| WFG | Title searches/evidence, CPLs and policy jackets. [6] | Use the installed channel where supported; confirm which products and territories apply. |

The PDFs explicitly say these channels are already used. They should remain the starting point for orchestration. A product available in a vendor catalog is not automatically enabled for every JV or a valid substitute for underwriter approval. [1, pp. 3, 7, 13; 2, p. 1]

### Contact SoftPro now

Waiting for near-perfect software before establishing the external interface reverses the dependency. The interface determines where code can run, which identifiers must be stored, how concurrent work behaves and how success can be verified. A short technical discovery call prevents building around assumptions that later need replacement. It can occur while the team reviews the local workflows and document processing.

The first deliverable to request is a supported integration discovery package, followed by a read-only proof against a non-production company. Production write access is a later milestone.

**Draft opening for the representative - prepared only, not sent:**

> We use SoftPro Select with multiple title-company/JV profiles in one environment. We are building an internal workflow application around Missive and Select. Select will remain our production record, and we intend to keep our existing AgentNet, agentTRAX and WFG connections through SoftPro 360. We need your supported route for company-scoped order lookup, reading permitted fields and documents, and eventually making reviewed updates. Can you connect our developer with the ProInterface/integration team and help us obtain the correct documentation, licensing and non-production access?

Ask for concrete answers and a named technical contact:

1. What exact Select version, build and hosting arrangement does the account use? Is ProInterface included or an add-on, and may internal custom code be deployed under this arrangement?
2. Which current SDK/API documentation and examples apply? Is a developer agreement, certification, paid engagement or separate test license required?
3. Where must the connector run? What network access, service identity, authentication and permissions are supported? How does service authentication coexist with staff MFA?
4. How are the environment, company/profile, order, loan, document and task uniquely identified? Can company context be explicitly supplied and verified on every operation?
5. How do scoped search, pagination and change notifications work? Which stable fields can find an order without relying on borrower name alone?
6. Which operations support order creation, field reads/writes, custom fields, notes, task/status changes and attachment transfer? Which are read-only or unsupported?
7. How does the interface expose locks, read-only orders, versions and concurrent edits? Can a write assert the previously read version or values?
8. What is the transaction boundary for multiple fields? What happens if saving succeeds but the response is lost? Is there a request identifier or audit lookup for reconciliation?
9. Which edits trigger premiums, calculations, document regeneration or workflow rules? Can those results be inspected after saving?
10. Which 360 submit/accept actions can be initiated through supported automation for each installed underwriter connection? How are queued, issued, rejected and failed results distinguished?
11. What sandbox/test companies and synthetic data are available? How are production and test endpoints/accounts kept separate?
12. What rate/concurrency limits, maintenance windows, upgrade notices, support arrangements and recurring costs apply? What additional agreement would apply if the product later serves unrelated title businesses?

Bring the application diagram, a list of desired operations, one fictional example of a loan revision, and the acceptance matrix below. Do not claim that the current application has made a SoftPro write until a real supported operation has completed and its result has been re-read.

## Missive protocol and the token question

The documented REST base is `https://public.missiveapp.com/v1/`; authentication uses the complete personal token in the `Authorization: Bearer ...` header. Tokens inherit the owner's access, including accessible shared accounts. The API token's display name is an administrative label, not the credential. Documentation points to an eligible organization plan for token creation. [8]

Use `GET /v1/organizations` for a minimal account-discovery check, then discover accessible teams and filter conversations to the approved scope. A successful organization request does not by itself prove access to the desired inbox, message or attachment. Those require separate scoped checks. [9]

No official explanation of the API settings label **Never used** was found in the reviewed documentation. It must not be used as proof that the token is invalid, that no request reached Missive, or that the deployed service is using the same token shown on screen. The actual root cause needs request evidence.

**Verified connection finding, September 14:** the saved 70-character value omitted the literal `missive_pat-` prefix. The original value returned HTTP 401. Using the documented complete token form returned HTTP 200. Read-only directory discovery then returned one organization and 21 team inboxes. This confirms a working credential and directory access; it does not establish that company routing is approved, that all intended messages are accessible, or that an end-to-end import has passed. No token value, real directory names or identifiers are included in this report. This finding comes from the project's recorded live diagnostic, separate from the public documentation.

For future support incidents, the engineering investigation should establish, without printing the secret:

1. Whether the complete newly created token is the value configured in the active server deployment; compare locally using a one-way fingerprint if needed.
2. Whether a request left the application, reached the exact documented host and included the Bearer header once.
3. The endpoint, UTC request time and HTTP status, with a sanitized provider error. Distinguish a local configuration error, network failure, authentication response and authorized-but-unavailable resource.
4. Whether token ownership and shared-account visibility cover the intended Missive organization/inbox.
5. Whether the same read-only check succeeds after correcting a confirmed configuration problem. Do not keep retrying a credential failure or rotate tokens without identifying the mismatch.

Missive's webhook documentation describes signed requests and retries; the receiver should authenticate the raw payload, durably queue it and acknowledge promptly. A received event is work to review, not proof that a title transaction is complete. [10]

A documentation freshness issue matters for later outbound work: the June 19, 2026 changelog announces conversation updates without posting a comment, while the fetched endpoint reference still described using posts/drafts/messages for changes. Confirm the current method and schema before implementing it. Do not infer a new endpoint from the changelog alone. [9, 11]

## OCR and actual automation mean different things

**PDF text extraction** reads characters already stored in a PDF. **OCR** recognizes characters from page images, such as a scanned deed. **Structured extraction** interprets those characters as a borrower, amount, date or recording reference. **Automation** acts on a verified interpretation in another system. Each layer has a separate failure mode and acceptance test.

A useful complete document workflow preserves the original file, records physical page references, identifies pages with no reliable text, offers OCR where appropriate, and displays proposed values beside their evidence. It must handle mixed text/scanned files without silently skipping unreadable pages. A reviewed local result can be fully functional before SoftPro access is granted. Applying that result inside SoftPro additionally requires the supported connector and its tests.

OCR output is evidence to inspect, not an authoritative title conclusion. Dates, decimal points, legal descriptions, handwritten notes and similar names can be misrecognized. Confidence must describe the specific extracted evidence; a high recognition score cannot resolve conflicting sources or authorize a policy change. The PDFs require unreadable documents to become exceptions and preserve human review for material changes. [1, pp. 8, 14, 16; 2, pp. 3, 5-6]

The two PDFs use different approval language: the requirements allow some medium-risk actions to become automatic with strong validation, while the preparation checklist requires approval before medium-risk writes and says high-risk changes must never be autonomous. Treat that as a business decision still to confirm. Until then, reviewed proposals and explicit human approvals are the defensible implementation. [1, p. 14; 2, p. 3]

## Competitive context

Neither supplied PDF contains a named competitor comparison or identifies two competing software companies. They name SoftPro, Missive, OneDrive and existing underwriter systems. The Tyler transcript discusses unnamed alternatives to SoftPro around 03:31 and 51:20-52:55. It does not establish a two-company market or feature inventory. [1; 2; 12]

Alanna.ai and Pythonic are independently selected examples with relevant official material. They are not represented as the two products intended by the earlier comment. The table records advertised capabilities, not independently measured accuracy or a procurement endorsement.

| Capability | Alanna.ai official evidence | Pythonic official evidence | Implication for this application |
| --- | --- | --- | --- |
| Work with existing SoftPro | Advertises integration with Select. [13] | Names Select and Resware integration. [14] | Integration is a real market capability; obtain the supported contract. |
| Reduce data entry | Describes document processing and automated order entry. [13] | Describes order entry and document-processing agents. [14] | Evaluate completed field values and evidence, not only extracted text. |
| Client communication | Describes texting, updates, intelligent collection and responses. [13] | FAQ includes email routing among workflows. [14] | Preserve Missive context and distinguish internal notes, drafts and actual sends. |
| Closing disclosure reconciliation | Not established by the reviewed Alanna page. | SoftPro confirms comparison with lender CDs and operator selection of line-level changes. [15] | A credible comparison must include controlled updates and readable differences. |
| Document-package review | General document processing is advertised; detailed package behavior not established here. [13] | SoftPro's guide shows correcting document titles, review and submission back to the production system. [16] | Split/classify/review packages and retain their original evidence. |
| Security evidence | No assessment made from the reviewed integration page. | Vendor states SOC 2 Type 2 and offers its report on request. [14] | Do not claim comparable assurance from unit tests alone; document controls and validate them. |
| Approximately 25 JVs, shared staff, isolated partner access and business onboarding | Not established by these sources. | Not established by these sources. | Demonstrate these workflows with explicit evidence; absence from a page does not prove a competitor lacks them. |

The opportunity is a coherent system that fits real work across company onboarding, title files, communications, review, financial visibility and partner access. The evidence does not support saying that little competition exists or that matching a short marketing feature list proves market readiness.

## Acceptance matrix for one company and approximately 25 JVs

These are recommended acceptance cases, not a claim that all have passed. Execute synthetic automated tests first, then a documented staff walkthrough and supported vendor-sandbox tests. Use approved anonymized samples for document accuracy. Record environment, app/connector version, inputs, expected result, actual result and evidence for each case.

| Case | One-company expectation | Multi-JV expectation | Evidence required |
| --- | --- | --- | --- |
| First setup | One company works without unnecessary switching. | Configure 25 distinct companies without source changes. | Reloaded configuration and permission checks |
| New JV onboarding | Not required to invent a JV structure. | New JV has its own identity, checklist, documents, defaults and users. | Completed fictional onboarding and audit |
| Shared staff | Two staff can work one file with visible history. | Shared staff move across authorized companies without losing context. | Two simultaneous sessions |
| Partner access | Partner sees only permitted company/records. | Partner of JV A cannot view JV B or group-only records. | Read, download, search, export and command checks |
| Company routing | Approved inbox resolves to the company. | Overlapping aliases and conflicting signals require review. | Source message, mapping version and reviewed route |
| Scoped file identity | File reference is verified. | Identical file numbers in two JVs remain distinct. | Composite environment/company/order identity |
| Name/address ambiguity | Similar borrowers and unit numbers do not auto-match. | Same property or person in different JVs cannot bypass scope. | Candidate list and no unintended change |
| Reused email thread | New unrelated transaction does not inherit old linkage blindly. | Old thread cannot redirect work into another JV. | Match evidence and reviewed relink |
| Duplicate arrival | Repeated email/event/import produces one durable result. | Deduplication does not merge unrelated company records. | Stable request/source IDs and receipt |
| Multi-inbox configuration | One inbox works end to end. | Each approved inbox/alias preserves its own routing; changes do not rewrite old evidence. | Cases for each configured route |
| Original documents | Source bytes and page references remain available. | Documents retain correct company and file scope. | Hash, provider identity, version and access checks |
| OCR | Scan, mixed PDF, rotated page and unreadable page show honest results. | Same handling for every company. | Ground-truth text/fields and manual review outcomes |
| Repeat revisions | Revisions 1 through 5 preserve before/after/source history. | Revisions remain in the correct JV despite staff/context switches. | Complete versioned timeline |
| Multiple loans | Change targets the intended active loan. | Identical loan labels elsewhere are irrelevant. | Target identity and unaffected sibling loan |
| Human concurrent edit | Stale proposal cannot overwrite newer SoftPro data. | Scope changes also invalidate affected proposals. | Vendor read version/lock and rejected stale write |
| Approval authority | Material change requires the permitted reviewer. | JV-specific reviewers cannot approve outside their scope. | Authenticated actor and decision evidence |
| Document/calculation impact | Revision remains unfinished until required outputs are refreshed. | Correct JV templates and underwriter rules apply. | Regenerated output and current field comparison |
| Final readiness | Missing recording, unresolved revisions or required checks block final preparation. | Same gate with approved company differences. | Gate-by-gate result and staff sign-off |
| Late revision | Material change after preparation becomes a visible exception. | Cannot silently change another company's or issued policy data. | Preserved issued record and correction history |
| Underwriter action | Requested product uses authorized channel. | WFG/AgentNet/agentTRAX cannot be interchanged by context error. | Vendor request/result identity |
| Failure after possible save | Retry reconciles an uncertain result before repeating. | Failure in JV A does not stall or contaminate JV B. | Fault-injection trace and vendor result lookup |
| Stop and recovery | Authorized pause prevents subsequent writes; work stays visible. | Company pause and global emergency stop have explicit scope. | Running/queued work test and restore rehearsal |
| User removal | Removed staff lose data and action access. | Company removal affects only intended memberships. | Revoked-session and fresh-request checks |
| Independent business | Works as a single customer organization. | A second organization cannot access the group's records even with colliding names/IDs. | Cross-workspace isolation checks |

A private demonstration is ready when staff can sign in as themselves, understand their next action, complete a representative reviewed workflow and see truthful integration status. A production write pilot additionally needs supported vendor access, company configuration, real transaction/failure tests and business acceptance. Wider rollout needs operational ownership, monitoring, restoration evidence and evaluation on real workflow variation. These milestones should be tracked separately rather than compressed into one claim that the system is fully tested.

## Source notes

1. Ballantyne Title, *AI Workflow & SoftPro Select Developer Requirements*, revised, September 2026, 26 pages. Supplied private file `Ballantyne_Title_AI_System_Developer_Requirements_REVISED.pdf`; read in full. Requirements evidence, not independent vendor validation. Original remains outside the repository.
2. Ballantyne Title, *AI System - Information Needed Before Production*, 10 pages, supplied September 2026. Private file `Ballantyne_Title_AI_Information_Needed_Before_Production.pdf`; read in full. Blank checklist entries are unresolved requirements, not completed approvals.
3. SoftPro, [SoftPro Select](https://www.softprocorp.com/real-estate-software-solutions/softpro-select/), current product page, accessed September 14, 2026. ProInterface and native platform capabilities.
4. SoftPro publisher, [NuGet package catalog](https://www.nuget.org/profiles/SoftPro), accessed September 14, 2026. Historical SDK package metadata; applicable current version requires vendor confirmation.
5. SoftPro, [Custom Development](https://www.softprocorp.com/software-services/custom-development/), accessed September 14, 2026. Supported engagement categories and contact route.
6. SoftPro, [SoftPro 360 Integrations](https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/), accessed September 14, 2026. AgentNet and WFG capability descriptions.
7. SoftPro, [Eclosings](https://www.softprocorp.com/real-estate-software-solutions/eclosings/), agentTRAX section, accessed September 14, 2026. Advertised underwriter integration actions.
8. Missive, [REST API](https://missiveapp.com/docs/developers/rest-api), accessed September 14, 2026. Base URL, Bearer authentication and personal-token access model.
9. Missive, [REST endpoints](https://missiveapp.com/docs/developers/rest-api/endpoints), accessed September 14, 2026. Organization/team/conversation discovery; conversation-update documentation requires freshness reconciliation.
10. Missive, [Webhooks](https://missiveapp.com/docs/developers/webhooks), accessed September 14, 2026. Signing, delivery and retry contract.
11. Missive, [Changelog](https://missiveapp.com/changelog), June 19, 2026 entry; accessed September 14, 2026. Announcement of conversation changes without a post.
12. *Call with Tyler Pilkington*, private machine transcript, 75:03. [Existing analysis](../discovery/tyler-call-analysis.md) and [all-transcript traceability](../discovery/all-transcript-traceability.md). Also reviewed [Stephenie call analysis](../discovery/call-analysis.md). Machine wording/speaker attribution remains subject to audio verification for consequential details; no private recordings or raw transcripts are included here.
13. Alanna.ai, [SoftPro integration](https://www.alanna.ai/softpro-integration/), accessed September 14, 2026. Vendor-advertised capabilities only; performance claims not independently assessed.
14. Pythonic, [Frequently Asked Questions](https://pythonic.ai/faq), accessed September 14, 2026. Vendor descriptions of workflows, supported production systems and security-report availability; report itself not reviewed.
15. SoftPro, [Introducing the Pythonic Integration in SoftPro 360](https://blog.softprocorp.com/introducing-pythonic-integration-in-softpro-360), November 16, 2023, accessed September 14, 2026. Documented CD comparison and reviewed updates.
16. SoftPro, [Pythonic user guide](https://help.softprocorp.com/articles/360/Pythonic_User_Guide_-_Automated_CD_Processing.pdf), September 2, 2025, particularly document-package review around pp. 9-10; accessed September 14, 2026. Observed review/return workflow, not a promise that all services are licensed for this account.
