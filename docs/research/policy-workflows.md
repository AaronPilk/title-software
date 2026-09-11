# Policy production and underwriter integration research

## Product decision

Tyler’s post-closing work belongs in the first MVP as a complete, interactive policy workbench. The recording describes a repetitive, evidence-driven process spanning email, recorded instruments, SoftPro, an underwriter portal, and month-end remittance. The highest-value custom work is a unified queue, reliable document-to-order matching, an exact field comparison, review decisions, and a visible handoff trail. Treat SoftPro and authorized underwriter services as future systems of record until their actual edition, permissions, integration contract, and supported interfaces are established.

This recommendation supports the broader company operating system. It does not equate the single workflow described in the call with every activity that a licensed title operation performs. The transcript expressly says Stephenie is not familiar with all of Tyler’s work (12:55–13:01) or John’s accounting process (14:41–15:01). Those gaps can be represented through configurable tasks and an integration plan without inventing production rules.

## Evidence from the recording

The supplied machine transcript is the primary evidence for the company’s current workflow. Speaker identities are not verified and wording may be imperfect. Relevant observations:

| Recording segment | Observed work or constraint | Product implication |
|---|---|---|
| 00:06–01:48 | Stephenie accesses Tyler’s laptop; SoftPro access involves VPN and Tyler’s authenticator approval. | Future access needs named users, permissions and a documented connection model. The local demo needs a clear distinction between role views and real authentication. |
| 02:01–03:37 | Underwriters named are WFG and Commonwealth; configuration changes reportedly go through a SoftPro contact. The reason is uncertain in the call. | Capture agency account, branch/profile and underwriter separately. Do not interpret an installation-specific restriction as a universal law prohibiting custom integration. |
| 03:42–05:23 | Preliminary work exists, then final documents arrive after closing. Recorded information is checked before the jacket is finalized through the underwriter. | Maintain an order lifecycle with source evidence, review, jacket handoff and issuance milestones. |
| 06:34–07:45 | A paralegal emails final-policy requests and attachments. Stephenie locates the file in SoftPro, downloads documents and changes fields. | Build an intake queue with sender, request time, attachments, candidate order matches, assignee and current status. |
| 08:56–10:20 | Names, vesting wording and recording date/time must match the recorded instrument exactly. | Show existing value and proposed value together with the original source excerpt. Preserve exact text, including suffixes and punctuation. |
| 10:24–11:38 | Trustee text is copied from a supplied form into existing document text. | Distinguish extracted facts from controlled template language. Show the destination field and contextual text before approval. |
| 05:25–06:19 | John remits underwriter premiums monthly. A $1,000 premium and 30% WFG share are explicitly an example. | Never hardcode 30% as the real contract. Use configurable, versioned terms and illustrative values in the demo. |
| 13:18–13:45 | SoftPro already tracks policies and money owed; separate company balance sheets still require work. | Link issuance to a reconciliation workspace; avoid counting the same premium twice in a separate dashboard. |
| 13:45–14:57 | JV allocation involves varying numbers of participants and company-specific month-end work. | Link each order to its legal company; separate agency remittance from partner distributions. John’s rules remain an interview dependency. |

Source: `Call with Stephenie Tocado.m4a`, provided locally; machine transcript at `/Users/pilksclaes/Title software/.local/discovery/call-transcript.md`, reviewed 2026-09-11. No production client records were supplied.

## What official product documentation verifies

### SoftPro edition and integration options

SoftPro Select publicly supports configurable fields, screens, calculations, documents and workflow. It lists ProInterface as an API with an SDK for custom integration. Its add-ons include AutoMail, which captures Microsoft 365 emails and attachments using an order number in the subject; AttachPro for attachment queues; DocuView for viewing documents alongside an order; AutoDocGen; and task notifications. It also supports reports and Excel exports.[1] These verified capabilities establish that custom integration is plausible; they do not establish API access for this installation.

SoftPro Hosted says it supplies the same feature set as Select while SoftPro hosts the data.[2] Its published client requirements still specify Windows and Intel/AMD hardware.[3] Therefore a laptop installation is not proof that all data lives only on that laptop, and an Apple-style web UI is a separate frontend choice from how SoftPro is hosted. The existing VPN destination, host and edition must be confirmed.

SoftPro advertises custom development for legacy and CRM connections, order/template imports, accounting integrations, and third-party vendor connections.[4] The practical next discovery step is to ask the existing SoftPro administrator which supported route fits this agency, using the MVP’s reviewed changes as the concrete integration specification. Do not begin with portal scraping or direct database updates.

### SoftPro 360 and WFG

The current SoftPro integration directory says 360 is included in all versions; use of the portal is free but ordered services can be charged. It lists WFG support for title searches, title evidence, closing protection letters and policy jackets. The same directory lists agentTRAX jacket issuance and automated reporting of gross premiums to FNF Agency Accounting.[5] These integrations already exist and should be evaluated before recreating issuance logic.

SoftPro’s WFG search guide, dated May 9, 2019, documents agency selection, a provider reference number, queued request states, and review before accepting returned data/documents. It also illustrates an important operational distinction: canceling the transaction in the SoftPro queue did not itself cancel the WFG transaction. This guide is historical evidence for designing explicit external states; its detailed behavior needs revalidation against the installed version.[6]

SoftPro announced WFG search integration in July 2019 and confirms WFG jackets and CPLs were already supported.[7] WFG’s January 2026 announcement separately lists onboarding, production, AI and e-Remit improvements.[8] The announcement does not publish a developer API, account eligibility, pricing or integration specification. Do not show e-Remit as connected or available to the company merely because it appears in a release.

### Commonwealth and agentTRAX

FNF’s national agency site describes agentTRAX facilities for jackets, final-policy document upload, corrections, reporting, statements, high-liability approval and remittance payments.[9] FNF’s Maryland agency site identifies Commonwealth among its underwriting brands and links agentTRAX.[10] That supports agentTRAX as the integration route to investigate for Commonwealth, but the family’s actual agency account and authorized property states remain unverified.

The official SoftPro agentTRAX guide is dated August 2022, despite recent web crawl dates. It shows company/underwriter eligibility by property state; separate owner/loan jacket selection; loan selection when multiple loans exist; rate/form selection; endorsement matching; and later policy-image upload. Unmatched endorsements block progression. The guide also shows returned policy identifiers and documents being accepted into the order, and a distinct authorized-signatory mapping.[11] Use these as workflow requirements, while reconfirming the current screens and supported operations.

FNF’s integration-partner handout states that supported connections include SoftPro 360 and that premium details can be reported from the closing file to agency accounting. It notes that some partners support jacket editing, voiding or reinstatement.[12] Therefore corrections should be modeled explicitly; support for each operation cannot be assumed for every provider.

### Document and form boundaries

A policy workbench should distinguish the recorded deed, final title opinion, policy jacket, policy schedules, endorsements and complete delivered policy. They are separate artifacts. ALTA’s form collection maintains form versions and distinguishes licensing/access groups.[13] The demo should provide an original preparation summary labeled as a demonstration document, then later populate properly authorized templates through the approved production workflow. A copied underwriter-branded jacket is not an appropriate placeholder for a real issued policy.

## Recommended MVP workflow

The following is product design derived from the transcript and documented lifecycle, not a claim that the company already follows these exact states.

1. **New request.** Capture a synthetic incoming message or allow local selection of a demonstration file. Record channel, sender, request date, attachment names and an intake identifier. Make duplicate request handling visible.
2. **Match order.** Search by file number, company, property and party. Display the selected company and underwriter above the work area so similarly named files across JVs cannot silently merge. An ambiguous request remains unmatched.
3. **Prepare documents.** Classify the deed, deed of trust, final opinion and supporting exhibits. Distinguish a recorded document from an unsigned draft. Missing pages or evidence should create an actionable issue.
4. **Compare fields.** Present each source-backed proposed change against the current order. Every field has a source document, page or excerpt, and a status: unchanged, needs review, accepted, rejected or manually edited.
5. **Review and resolve.** Support approval per field and return-for-information notes. Approval applies to that document version; new evidence invalidates affected approvals. An exception can be assigned without losing the queue position.
6. **Prepare handoff.** Produce a review packet showing the approved field changes and source references. In the MVP, use “Export preparation packet” or “Mark ready for SoftPro” rather than a button claiming that a live policy was issued.
7. **Record jacket outcome.** Support a simulated response with provider reference, owner/loan policy numbers, issued date and returned document. Keep failure, pending, rejected and needs-correction states visible. Do not mark a request complete on submission alone.
8. **Finish policy and delivery.** Track schedule/endorsement assembly, final-policy upload and customer delivery separately. Preserve version history and the recipient record. The demo can log local simulated delivery with explicit labeling.
9. **Reconcile remittance.** Group issued premium items by legal company, underwriter, agency account and statement period. Show calculated expected amounts against imported statement values, adjustments and unexplained differences. Export a draft; payment remains separate.

For a simple primary list, use `Received`, `Needs documents`, `In review`, `Ready for jacket`, `Awaiting underwriter`, `Issued`, and `Complete`, with an independent `On hold` flag. Detailed milestones live inside the order instead of making a 15-column board. A visible activity log connects all actions.

## Data structure and field model

An order is not the same object as a policy. Model `Company → Order → Policy[]` and `Order → Property[] / Loan[] / DocumentVersion[] / ReviewChange[]`. An inbound message may relate to several attachments; each attachment may contain several recorded instruments. An underwriter submission is another object because it can fail or return asynchronously.

| Area | Fields to support in a demonstration model | Handling |
|---|---|---|
| Ownership and assignment | Company ID, legal company name, SoftPro profile/branch reference, order number, assignee, backup reviewer, request date | Company ID is required independently of a human-readable file number. |
| Underwriter | Provider, agency account reference, property state, product/form, authorized-signatory reference | Demo values are illustrative; production choices come from authorized account capabilities. |
| Property | Address, county, state, parcel reference, legal-description text, exhibit references | Preserve legal text exactly; normalization is for matching, not replacement. |
| Parties | Display name, exact insured/vesting text, role, source document, source page | Never infer marital status, legal capacity or a trustee from a name. |
| Recording | Instrument type, county/jurisdiction, instrument number, book/page where used, recorded date, recorded time, source stamp | Store the original string and parsed value. Record missing precision; do not invent time or silently change dates through time-zone conversion. |
| Loan/security instrument | Loan reference, beneficiary/lender, trustee text, recorded instrument reference | Several loans and instruments may exist. The reviewer selects the relevant association. |
| Review evidence | Current value, proposed value, exact source excerpt, document version, reviewer, review time, override reason | Simulated extraction must be identified as simulated. Numerical confidence should not imply a measured accuracy that does not exist. |
| Policy | Kind, form/version, effective date/time, liability amount, policy number, schedules, endorsements, issuance state | Keep “jacket issued,” “policy assembled,” “uploaded,” and “delivered” separately observable. |
| Premium ledger | Gross premium, endorsement premiums, fees, contractual basis/version, expected due, statement due, adjustment, reporting period | Exact integer cents or decimal arithmetic; explanatory calculations and separate amounts for distinct charge types. |
| External operation | Connection name, request ID, status, last attempt, provider reference, outcome receipt | Show disconnected, queued, accepted, rejected and unknown outcome distinctly. |

The demo should show the four changes specifically described in the call: a full insured name/vesting string, recording date/time, book/page or instrument reference, and trustee language. Additional extraction fields can be included as review scaffolding, without representing them as confirmed daily work.

## Exception scenarios worth demonstrating

- **Wrong or ambiguous file:** two companies share a party name; require a file/company match before applying any change.
- **Unrecorded or incomplete evidence:** missing recording stamp, illegible page, unavailable legal exhibit, or email attachment absent.
- **Conflicting evidence:** the final opinion and deed differ; show both and send to the reviewer instead of choosing silently.
- **Exact text ambiguity:** OCR confuses a letter/number, suffix, punctuation or date. Preserve source and corrected value separately.
- **Revision after approval:** an attorney sends a corrected deed; affected reviews become stale and require attention.
- **Multiple loans or policies:** the order contains a first and second loan plus an owner policy; prevent changes from being applied to the wrong policy.
- **Eligibility or underwriting hold:** unsupported property state, no authorized signatory, unmatched endorsement, or required high-liability approval. Specific triggers must be configured from actual authority.
- **External uncertainty:** a request times out after submission; do not retry issuance blindly. Check the provider reference/status first.
- **Correction after issuance:** preserve the original policy, attach the correction, and separately reconcile related credits or premium changes.
- **Statement mismatch:** an issued policy appears in the wrong period, company, or agency account, or the underwriter statement differs from the expected amount.

## UI recommendations for the local build

Use a restrained desktop workbench: a company-aware navigation sidebar, a compact queue with useful filters, and a large central detail view. A split review layout puts the source document on the left and changes on the right; a focused review mode can temporarily widen the document. Large typography belongs in the page heading and key totals, while table rows should remain dense enough for repeated operational use.

Prefer one blue primary action per stage, muted surfaces, fine dividers, generous line height and limited status colors. Make keyboard navigation, a visible focus ring, search, sorting and an accessible dialog part of the design. A status icon must have a text label. Do not imitate macOS window controls that do nothing.

The queue should answer: what needs work, who owns it, what is blocking it, how long it has waited and what happens next. The change panel should answer: what changed, what source supports it and whether a person approved it. The integration screen should answer: which provider would handle this step and whether it is connected. A demo mode badge should remain visible without overwhelming the work.

Useful working interactions for the MVP: company switching; order search/filter/sort; opening a request; approving/rejecting/editing individual fields; resolving a missing-document task; assigning work; advancing an eligible order; exporting a preparation packet; and viewing the audit trail. Demonstration actions should persist locally. Neither emailed materials nor public GitHub should be used to store real applications, SSNs or production title files.

## Integration questions to resolve after the MVP

1. Which SoftPro edition, build and hosting arrangement is actually installed, and who administers it? Which agency profiles and companies are represented?
2. Is ProInterface licensed and permitted in this environment? Obtain its supported SDK, deployment architecture, authentication model, read/write methods, concurrency behavior and vendor support terms.
3. Which existing add-ons are enabled, especially AutoMail and document/task tools? What format of order/attachment exports is available today?
4. Do WFG and Commonwealth accounts already work through SoftPro 360? Which products, states, policy forms, endorsement mappings and signatories are authorized?
5. What are the real underwriter premium arrangements, statement formats and correction practices? Which account owns each issued policy?
6. What are the precise template destinations for insured vesting, recording and trustee text? Review representative redacted before/after files with Tyler and Stephenie.
7. What completes a file operationally: jacket retrieval, final-policy assembly, underwriter image upload, delivery to lender/owner, or all of these?
8. What are John’s separate accounting and distribution rules? A policy premium estimate cannot establish distributable JV profit.

Until these answers are known, the build can still offer a complete local demonstration with provider adapters, deterministic synthetic extraction, draft calculations and clear state transitions. Production completeness requires authoritative configurations and a verified integration, not additional visual screens alone.

## Sources

All pages accessed 2026-09-11. “Undated” means the page showed no reliable publication or revision date; a crawl date is not a publication date. Public guides may describe older versions.

1. SoftPro. [SoftPro Select — Real Estate Closing Software](https://www.softprocorp.com/real-estate-software-solutions/softpro-select/). Undated current product page. Used for ProInterface, configuration and named add-on capabilities.
2. SoftPro. [Real Estate Hosted Software Data](https://www.softprocorp.com/real-estate-software-solutions/softpro-hosted-software/). Undated current product page. Used for hosted-versus-Select positioning.
3. SoftPro. [SoftPro System Requirements — Hosted](https://www.softprocorp.com/softpro-system-requirements-hosted/). Undated current requirements page. Used for Windows client and hardware requirements.
4. SoftPro. [Real Estate Software Custom Development](https://www.softprocorp.com/software-services/custom-development/). Undated current service page. Used for supported categories of custom development.
5. SoftPro. [SoftPro 360 Integrations](https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/). Undated current integration directory. Used for WFG, agentTRAX and 360 positioning.
6. SoftPro. [WFG National Title — Title Search User Guide](https://help.softprocorp.com/articles/360/WFG%20-%20Title%20Search%20User%20Guide.pdf). May 9, 2019, pp. 4–15. Historical workflow evidence; current implementation requires confirmation.
7. SoftPro. [New search capability with the WFG integration in SoftPro 360!](https://blog.softprocorp.com/introducing-wfg-enhancement-in-softpro-360). July 9, 2019. Historical confirmation of WFG search and jacket integration.
8. WFG National Title. [The Agent 3.0 Evolution — How WFG Is Rewriting the Title Agent Tech Playbook for 2026](https://wfgtitle.com/as-seen-in-the-title-report-the-agent-3-0-evolution-how-wfg-is-rewriting-the-title-agent-tech-playbook-for-2026/). January 21, 2026. Used for announced e-Remit and wider product work; not an API specification.
9. FNF National Agency. [Agent TRAX](https://nationalagency.fnf.com/fnf-applications/agenttrax). Undated current product page. Used for discrete jacket, upload, correction, reporting and remittance functions.
10. FNF Maryland Agency. [Home](https://www.nationalagency.fnf.com/md). Undated current agency page. Used to connect Commonwealth/FNF branding with agentTRAX; jurisdiction-specific agency content is not applied to this company.
11. SoftPro. [agentTRAX User Guide](https://help.softprocorp.com/articles/360/AgentTRAX_UserGuide.pdf). August 2022, especially pp. 6 and 29–37. Its internal running header says March 2022; the cover/history identifies the August revision.
12. FNF National Agency. [AgentTRAX Online Application Spotlight — Integration Partners](https://nationalagency.fnf.com/getmedia/5c15d4b7-a3fa-4cce-bb7e-aca173d9b2ab/AgentTraxOnlineApplicationSpotlight.pdf). Undated public PDF. Used for SoftPro partner and premium-reporting support.
13. American Land Title Association. [Policy Forms and Related Documents](https://www.alta.org/policies-and-standards/policy-forms/). Current collection, individual forms carry separate dates/versions. Used for form version and licensing boundaries.
