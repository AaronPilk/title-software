# Company onboarding, renewals, monthly close and partner publication

The local MVP should complete four connected administrative workflows: receive and review an onboarding application; assemble evidence for company activation; track recurring and change-triggered obligations; and let John close each JV's month and publish approved statements. These workflows can function with synthetic data and local artifacts before external APIs are connected. Checkmarks, generated PDFs and role previews must retain their actual meaning: they record local work, not external licensing, signatures, payments or authenticated partner access.

This report distinguishes **reported practice** from **verified external requirements** and **proposed product behavior**. The supplied machine transcripts contain no verified speaker labels; consequential wording and attribution need checking against the recordings. John has not supplied a first-person accounting walkthrough. Neither transcript establishes the actual accounting basis, distribution agreements, underwriter contract terms, DocuSign template, tax classification, or every agency's credentials. The present research concerns NC and SC company operations, not a nationwide compliance determination.

## Transcript evidence and product gaps

| Evidence | What the recording supports | Missing local workflow |
|---|---|---|
| Stephenie 16:48–17:30; 18:41–19:19 | A welcome letter and application currently go through DocuSign. Reported fields include contact information, DOB, SSN, five years of residence/work history, and business/branding preferences. | An application case with packet preview, required-item review, correction requests, completion evidence and a restricted external-document reference. |
| Stephenie 19:25–20:32 | Stephenie and John reuse the application for different work. She forms the LLC; John handles insurance applications. | Assigned handoff with a named recipient, available evidence, unresolved questions and acceptance history. |
| Stephenie 20:32–21:27 | Formation precedes tax-ID work; formation and EIN documents are shared with John and kept under the company. | Separate formation/EIN records and dependency-aware work items; existing-company import route to avoid refiling an existing entity. |
| Stephenie 19:36–20:06; 20:53–21:01 | Insurance approval, underwriter approval and financial setup are distinct. | Separate agency, producer and underwriter evidence; bank setup can have a manual milestone only. |
| Stephenie 21:35–22:33 | Logos, affiliated-business disclosures, title-preference forms and business cards live locally and are repeatedly requested. | Controlled company-material packet, approval/versioning and direct retrieval by authorized staff. |
| Stephenie 22:40–24:43 | Partners may see their own documents, orders, closed business, earnings and rejected opportunities. | Explicit publication, selectable periods, member statements and categorized lost-business follow-up. |
| Stephenie 13:18–14:57 | SoftPro tracks policy money and underwriter obligations. John balances each company and handles differing member groups. Stephenie expressly does not know his detailed process. | Per-JV reconciliation and close, source report mapping, dated membership and reviewed allocation rules. |
| Tyler 39:49–40:24; 63:07–63:21 | Approximately 20–23 active JVs and the need to select the right company/profile. | Portfolio-wide completeness matrix with independent company states, not one global close switch. |
| Tyler 62:26–62:39 | John sends spreadsheets to every JV; this takes roughly a day or two. | Generate reviewable company/member statement artifacts and a local publication queue. |
| Tyler 57:47–58:20 | JV owners should see their own submissions/rejections without administrator access. | Company-scoped operational projections and a recovery queue separate from financial allocations. |
| Stephenie 25:35–25:38; Tyler 61:27–61:30 | Banking execution is outside the described desired application; Tyler says his ordinary title work does not handle bank information. | Record reviewed accounting evidence and externally completed payment references without payment execution. |
| Tyler 47:41–48:08; 51:14–53:56 | Work can be read-only when another user has a file; actual SoftPro profiles/underwriter configuration matter. | Preserve external identifiers and stale-data protection; a local record is not evidence of an upstream change. |

Annual renewals were **not described in detail in either call**. Their inclusion below is a researched operational extension, not a transcript quotation. The private source register identifies both recordings and the existing analyses.[1][2]

## Current implementation assessment

The inspected implementation already provides company creation, seven onboarding checks, assigned people, jurisdiction tracking, a document vault, editable fictional ownership interests, illustrative remittance/profit calculations, CSV export and an administrator's partner preview. Financials display cents and use a largest-remainder allocation, avoiding the earlier whole-dollar rounding issue. The partner preview does not currently expose earnings; its note correctly reserves them for an approved close.

The material gaps are structural:

| Current code | Issue to resolve | Buildable replacement |
|---|---|---|
| `companies.tsx:351` makes `stage = Active` when seven booleans are true. | Checks can be completed out of order with no related evidence, even while authority records remain unstarted. | Derive launch readiness from case requirements, explicit evidence review and selected operating state; retain a separate administrative company stage. |
| `companies.tsx:593` renders authority status/reference/reviewer. | An “Evidence recorded” selection does not require a reference; there are no observed effective/expiration dates, individual identity or underwriter/product scope. | Structured credentials with evidence IDs, reviewer/date, issuer, jurisdiction, applicability and validity interval. |
| `model.ts` uses `{name, share}` for members. | Names are unstable identifiers, and current shares rewrite the assumptions for historic estimates. | Stable person/entity IDs plus an effective-dated membership and allocation schedule. |
| `financials.tsx:43` builds one month-level review fingerprint. | Fingerprint omits order company/underwriter identifiers; three review checks are transient. A source change can leave incomplete review evidence. | A persisted close record per company/period and a complete immutable input revision. |
| `financials.tsx:283` marks every selected underwriter policy `remitted = true`. | The flag is not bound to the amount, statement or reviewed version; changing inputs can leave stale reconciliation state. | Remittance batches with source lines, variances, amount/version and separate observed external payment status. |
| Financial allocation cards require issued orders. | A zero-policy company with expenses has no usable close/allocation review; absence of data can look like zero. | Include every active company in the period, with explicit zero-activity confirmation versus missing data. |
| `workspace.tsx:135` uses September 2026 orders and current visibility labels. | No period selection, approved financial publication or member statement recipient. “Closed / issued” merges distinct events. | Separate operational status projection, approved financial snapshot and controlled document release. |
| `store.tsx:75` serializes workspace state into localStorage. | An application form added naively would persist sensitive identity values in browser storage. | Synthetic public fields plus external secure references and completion metadata for sensitive intake. |

File paths are relative to `/Users/pilksclaes/Title software/web/`; line numbers describe the inspected snapshot and may move during implementation. The demo's user picker is not authentication. These are local behavior requirements now and future server-enforcement requirements later, not grounds for presenting the demo as production security.

## Application and company activation model

### Application packet

Create an `ApplicationCase` per proposed or existing company. The application form should distinguish public business preferences from sensitive licensing/identity evidence. For the current local MVP, store contact name/email, proposed company name, formation route, operating states, branding preferences, internal owners, checklist results and a dummy secure-intake reference. Do not collect actual SSN/DOB, background reports or identity documents into the local workspace.

Use the company's approved application as the source of future fields. The call's five-year histories are **their reported intake practice**, not proof that every state requires that exact lookback for every owner. Track each proposed owner's role: applicant, owner, producer, manager, responsible party or contact. Do not assume every equity owner must hold an individual producer license.

A useful local state sequence is:

`Draft → Ready for intake → Awaiting applicant → Received → Needs correction / Under review → Accepted → Handoff accepted`

The local labels should explicitly indicate simulated delivery/signature events. A future `providerStatus` is separate from this internal `caseStatus`: an electronically completed envelope may still contain information John must review or correct. Declined, voided, email-delivery failure and withdrawn cases must be visible terminal or exception states, not automatically treated as missing applications.

**Exact validations:** recipient email and role are required before preparing a packet; packet documents and template version belong to this case/company; accepted intake requires all applicable review items plus reviewer/date and completion evidence; any waiver needs a reason and reviewer; correction requests identify fields/documents without copying sensitive values into task titles; reusing an applicant never silently grants access to another JV. Editing an accepted application creates a new revision and reopens only dependent tasks.

### Docusign mapping for the later integration

Docusign's own REST collection distinguishes `status: created` drafts from `status: sent` envelopes. Creating a draft is not sending.[3] Its template guidance supports named recipient roles, document composition and data labels; template changes can affect integrations, so map approved template versions and field labels explicitly and test changed templates before use.[4]

Provider events distinguish an envelope being opened from completion of a recipient's actions; email failure and decline are separate events.[5] Connect can deliver envelope and recipient events, and Docusign documents HMAC verification for origin and message integrity.[6] The proposed adapter should therefore use durable event intake, duplicate handling and an authoritative envelope-state refresh, rather than requiring every intermediate event to arrive in order.

Store `environment`, `accountId`, `envelopeId`, `templateVersion`, company/case IDs, recipient-role IDs, provider timestamps, internal review outcome and protected completion-document references. Keep recipient completion separate from envelope completion. Retrieve the completed packet and available completion evidence into an approved storage system later; an envelope ID alone does not establish that reviewers received the evidence. OAuth/production entitlements remain setup work, not current demo capability.

The local acceptance flow can preview a welcome letter, simulate packet preparation/return, show a correction request, record approved evidence and hand off to John. It should not send a live envelope or email during the MVP phase.

### Formation and downstream work

Support three starting routes: **new entity**, **existing entity**, and **expansion into another state**. Store formation country/state, legal entity type, legal name, registry identifier, registered agent, effective date, filing reference and reviewed governing documents. A foreign qualification in SC for an NC company is a state registration concept; it is not formation in a foreign country.

The IRS directs newly created legal entities to form with their state before requesting an EIN, identifies the responsible party, and distinguishes nominees from authorized applicants.[7] Thus “EIN confirmed” should require a formation/existing-entity reference and an IRS evidence reference, not merely a nine-digit value entered into a text box. The application's primary contact need not be the responsible party. Retain only an approved masked identifier/reference in the local MVP.

For SC foreign qualification, the Secretary of State specifies a home-state certificate of existence no more than 30 days old, and its rejection guidance covers registered-agent/signature/capacity and naming defects. Its public filings do not necessarily contain a complete member list.[8] Build a document-age validation against the planned submission date and preserve the reviewed ownership schedule separately from public registry data.

Task states should be `Not started`, `Ready`, `In progress`, `Awaiting external response`, `Needs information`, `Evidence under review`, `Accepted`, and `Not applicable`. Each task needs an owner, due date, dependencies, evidence links, applicability reason, external submission/reference fields and review history. This handles parallel formation/material preparation without implying one universally required legal sequence.

### Activation decision

For a selected operating state, evaluate the reviewed template's applicable requirements: entity registration; EIN evidence where needed; accepted governing/member records; required entity and individual producer credentials; state-specific disclosure review; underwriter authority and correct SoftPro profile; required company materials; and an operational owner. Track bank setup only as a manually confirmed milestone if the company's approved checklist calls for it.

The output should be `Blocked`, `Needs evidence`, `Ready for internal launch review`, or `Launch approved locally`. A genuine credential record can be marked “Externally confirmed” only with its source and verification date. An expired SC authorization can block SC activity without erasing valid NC history. Adding an operating state starts that state's requirements as unreviewed; it must not inherit another state's approvals.

## State-specific requirements and renewal behavior

| Area | NC | SC | Product rule |
|---|---|---|---|
| Agency licensing | Business entities selling/soliciting/negotiating insurance require licensing. NCDOI's application FAQ calls for a designated responsible producer already holding an active NC license.[9] | Agency licensing requires an SC-licensed producer first; maintaining the agency license requires a licensed and appointed producer. The stated sole-proprietor exception does not describe a multi-owner JV.[10] | Separate company license from individual license and appointment; record actual applicant category. |
| Agency renewal | April 1 annually in the applicable NCDOI business-entity guidance.[9][11] | January of even-numbered years.[10] | Store credential type and observed expiry. Do not turn the whole portfolio into one annual renewal. |
| Branches | The FAQ differentiates branches sharing a FEIN from branches with separate FEINs.[9] | The agency page makes the same FEIN distinction.[10] | Branch, JV, company and profile are different IDs. |
| Producer education | Requirements depend on the actual license/lines and person; this review does not assign a universal NC CE value. | SCDOI's CE FAQ expressly exempts limited lines including title from §38-43-106.[12] | Use `Required`, `Exempt`, or `Unverified` with source; other lines may change the person's obligation. |
| Entity annual reporting | Ordinary LLC first report is due April 15 following formation or foreign qualification, then annually, subject to applicable exceptions.[13] | SCDOR distinguishes LLCs taxed as corporations from those not taxed as corporations for corporate annual report/license-fee obligations.[14] | Capture tax classification separately from legal entity type. Do not generate an NC-style annual LLC report for every SC company. |
| Ownership/affiliation changes | Maintain the current affiliated-agent roster; NCDOI says routine producer-affiliation reporting was removed.[9] | The agency page requires notification of changed application information. Title financial-interest reports also have their own application/change trigger.[10][15] | Membership, producer or legal-name changes create relevant review tasks, not automatic regulatory filings. |

NCDOI's separate renewal page lists another schedule for surplus-lines business entities; the title-company template should not silently apply that category.[11] Producer renewals, E&O coverage, local licenses, underwriter appointments and contracts should use verified credential/policy dates. Neither recording establishes universal renewal dates for those items.

NC Session Law 2026-59 creates a conditional annual-report extension route for qualifying deployed military owners, with the relevant provisions effective **October 1, 2026**. That date is after this report's source-access date. Support effective-dated templates and reviewed exceptions; do not enable an extension for every company.[16]

FinCEN's current BOI page reports an August 2026 final rule preserving the exemption for U.S.-created companies, effective August 14, 2026. Domestic JV onboarding should therefore not contain a mandatory BOI filing step based on older generic LLC checklists.[17] This is distinct from any separately applicable bank or transaction reporting process.

### Renewal record and triggers

Model `Obligation` with company/person ID, state, requirement type, authority/source, rule version, applicability, period, due-date basis, observed due date, owner, reminder offsets, status, evidence reference and reviewer. A due date can be a precise date, a month/window, or “Awaiting verification”; do not invent January 31 solely because a source says January.

Suggested states are `Upcoming → In preparation → Awaiting external confirmation → Evidence received → Reviewed complete`, with `Overdue`, `Needs correction`, `Exempt` and `Superseded` branches. Reminder offsets are configurable business preferences, not legal deadlines. Re-running the local task engine must not create duplicate obligations for the same company/credential/period.

Changes to legal name, formation structure, FEIN, operating state, producer, ownership, address or underwriter contract should generate only the relevant review items. Do not overwrite an old credential's dates when recording a renewal; attach a renewal instance and preserve prior evidence. “Submitted” must not extend an expiration automatically.

## Company materials and affiliated-business disclosures

Stephenie's logos and business cards can have a straightforward draft/approved/current lifecycle. Affiliated-business disclosures need two layers: the **approved company template** and a **transaction-specific instance**. A template being downloadable in a portal does not prove the recipient received the required disclosure for a particular referral.

For covered arrangements, Regulation X §1024.15 conditions the exemption on disclosure, the required-use restriction with stated exceptions, and permissible returns. It excludes purported ownership returns based on relative referrals and requires covered documents to be retained for five years after execution. It also says simply labeling a payment as an ownership return is insufficient.[18] Appendix D supplies the disclosure structure, including the relationship, estimated charges and applicable choice language.[19]

SC §38-75-960 separately addresses written financial-interest disclosure to the buyer/seller/lender and three-year retention. Its department report is due with the license application and when the previously reported information changes; the statute does not establish a universal annual February filing. SC §38-75-1000 also caps the title insurer's commission at 60%, so the call's hypothetical 70% agency retention cannot be a universal production term.[15]

**Proposed data and checks:** template version/jurisdiction/reviewer/effective date; referring party; provider; transaction; relationship description; reviewed ownership/financial-interest statement; charge schedule version; recipient; required timing; actual delivery reference; acknowledgment where applicable; and retention rule. Store multiple applicable obligations and apply the approved retention policy; do not shorten a federal five-year record to a state three-year period. A title-preference form is a separate document type, not a substitute for disclosure or proof that consumers must use an affiliate.

When membership or pricing changes, mark related disclosure templates “Review needed,” preserving earlier published versions and historical transaction instances. Publishing a newer internal draft should not erase the previously released version. Separate `workingVersion` from `publishedVersion` rather than selecting whichever filename has the largest version number.

## John's monthly close

### Boundaries and evidence

John's detailed books remain unknown. Tyler confirms monthly JV spreadsheets, while Stephenie's QuickBooks mention is conditional. Do not claim that the local calculation reproduces John's balance sheets or that every JV is a QuickBooks Online class. Initially support manually entered synthetic data and source-file references; later map each approved accounting source to the correct legal company.

A close should keep policy production, underwriter obligation, business accounting, distribution approval and payment evidence separate. Issued premium is not necessarily cash received; retained premium is not automatically recognized net income; net income is not automatically distributable cash. IRS guidance also distinguishes a partner's distributive share of taxable items from money actually distributed.[20] Monthly member statements should be described as management/distribution statements, not generated tax K-1s.

NC LLC law restricts distributions that would leave the company unable to pay debts or with liabilities exceeding assets.[21] SC's distribution restrictions additionally address superior preferential rights; its default equal-distribution rule must be read with the operating agreement provisions.[22] Therefore approved governing rules and financial review are necessary inputs. The software should not select legal default allocations for an unknown company.

ALTA 4.2 covers current licensing, information protection, policy production/remittance, insurance and complaints; its escrow controls apply to escrow trust accounting, which must remain distinct from ordinary operating funds.[23] Do not import statutory insurer reserve formulas or escrow three-way reconciliation into this agency's JV profit calculation merely because the broader title industry uses them.

### Per-company close record

Use `(companyId, periodStart, periodEnd, basis, revision)` as the logical identity. Store preparation/review/publishing actors separately. A portfolio view can summarize 23 companies without approving all 23 together.

| Step | Data | Gate |
|---|---|---|
| Select period | Fiscal calendar, period boundaries, accounting basis, source cutoff | Explicit period and basis; “Unknown” blocks an approved financial statement. |
| Gather records | Policy register, remittance statement, revenue/expense report, balance/adjustment evidence as applicable | Each required source present or explicitly confirmed zero/not applicable; source company and period match. |
| Reconcile policies | Stable order/policy IDs, underwriter, issue/post dates, gross premium, fees, credits, contract version | Duplicate/missing policy rows, company mismatch and amount variance resolved. |
| Review underwriter batch | Company + underwriter + period; opening obligation, activity, credits, external remittance evidence | Batch totals tie to reviewed source; unresolved differences remain visible. |
| Review company results | Recognized agency revenue, other revenue, expenses and categorized adjustments | Do not mix operating expenses, capital activity and remittance payments into one editable “expenses” number. |
| Determine distribution pool | Approved financial basis, retained reserve, reserve release, prior commitments and reviewed available amount | Distribution policy and authority documented; negative operating results remain visible; no implied cash availability. |
| Allocate | Effective membership/plan version, approved pool, member-specific reviewed adjustments | Applicable schedule covers the period; total cents reconcile; no referral-based input. |
| Approve | Complete input snapshot and approval notes | Required checks persist against this revision; any changed relevant input invalidates review. |
| Publish | Statement artifact versions and exact recipients | Published artifact hash/revision equals approved hash/revision. |

Suggested state flow is `Open → Preparing → Needs resolution / Ready for review → Approved → Published → Locked`. Reopening requires a reason and produces a new revision. Preserve old approved/published versions with a superseded status rather than rewriting history. Publication can be withdrawn independently without deleting the close.

### Exact arithmetic and review validations

Use integer cents for stored financial amounts. Policy-row rounding must be defined once and reconciled to the actual underwriter statement, rather than summing an unrounded percentage and silently changing pennies. Contract/rate records need state, underwriter, applicable products, effective interval, calculation base and review source. A fictional 40% setting is a demo fixture, not the actual agreement.

For a deliberately simple local example: $12,000 premium less $4,800 illustrative underwriter obligation leaves $7,200 retained premium. With $1,800 expenses, illustrative operating profit is $5,400; reserving $900 leaves a proposed $4,500 pool. An approved demo 60/40 allocation yields $2,700 and $1,800. The $900 reserve is a decision about retained amounts, not an operating expense. The example assumes suitable recognition and availability solely for demonstration.

The root implementation can enforce these checks now:

- Monetary inputs are finite integer cents within an explicit supported range; expense entry rejects a negative value, while signed adjustments use a separate typed record with explanation.
- Imported row identity combines source system, connection/company, record ID and revision. The same file imported twice does not double-count amounts.
- Revenue/expense source period and basis match the close. Missing source data is distinct from a confirmed zero.
- All active companies can complete a zero-policy month, including a loss-only month. Losses stay negative on the statement; an empty distribution pool does not erase them or invent a capital call.
- A distribution plan identifies stable members, effective dates, approved agreement/evidence, permitted method and reviewer. Do not assume a mid-month ownership change is automatically prorated; require the approved rule.
- If the supported demo method is percentage allocation, its eligible shares total exactly 100% in the chosen precision. Use deterministic largest remainder to reconcile every cent. Reject missing/overlapping effective schedules.
- The approved distribution pool cannot be negative. Reducing or withholding a member payment requires a separately classified, reviewed adjustment; allocations plus retained/withheld amounts must reconcile to the approved pool.
- The approval fingerprint includes company, period, basis, every source row/version, company and underwriter mappings, contract terms, adjustments, reserves, ownership schedule and calculation-version identifier.
- A new premium, cancellation, reassignment, rate version, ownership effective date or source replacement marks affected closes/remittance batches stale. Other companies remain unaffected.
- `Reconciled`, `Approved for distribution`, `Statement published`, and `Payment recorded externally` are different states. No state change executes a payment.

A monthly statement needs company legal name, reporting period, basis, draft/approved status, source cutoff, statement revision, approval date, financial summary, the specific member's allocation, applicable ownership/allocation plan, reviewed adjustments, explanatory notes and a clear payment-status field. Tax documents supplied later by the accountant can be securely published as separate artifacts.

Intuit's management-report feature illustrates the useful pairing of profit/loss and balance-sheet reports, configurable periods and report packets.[24] This is evidence for a future accounting adapter, not proof of QuickBooks usage or a requirement to reproduce its ledger in the MVP.

## Partner publication and permissions

Use three separate publication channels: approved company materials, operational order summaries, and approved financial/member statements. A partner may need multiple authorized companies, while a company may have multiple partners. Model this as explicit memberships and grants, not a single global partner role.

| Actor | Proposed scope | Approval/publication capability |
|---|---|---|
| Stephenie | Assigned onboarding cases, formation records and company materials; restricted intake only by explicit need | Prepare material releases and request approvals. |
| John | Assigned company licensing and financial records | Review close/statement revisions and publish approved outputs. |
| Tyler | Assigned title orders, supporting documents and operational exceptions | Prepare high-level order updates; no onboarding identity access by default. |
| Company partner | Authorized company's released materials/order summaries; own statements | Read/download only; optional requests for missing information. |
| Administrator | Access-grant and system administration | Administration is not automatic authority to approve distributions or inspect identity records. |

This is a proposed least-privilege starting point; actual member information rights and company agreements must inform grants. SC law provides member information/access rights, so a narrow self-service portal should not be presented as the entirety of a member's legal access rights.[22]

A `Publication` record should contain company ID, audience type and stable member IDs, artifact/version/hash, close revision when relevant, internal approver, publication date, superseded/withdrawn state and recipient preview. Require all audience members to have access to the stated company. Published member statements must not contain another member's private identifiers or personal statement by accident.

Keep order metrics precise: received this period, closing recorded this period, policies issued this period, canceled/rejected this period and reopened/recovered this period are different counts. Until actual closing dates exist, label the current metric “Issued policies.” Rejection categories should distinguish attorney choice, consumer choice, duplicate, cancellation and unresolved issue. A recovery task needs reason/source, owner, next date and outcome, with no automatic outreach.

The local demo can preview a selected partner, publish a synthetic statement, and prove that only the selected person's released artifacts appear. Production must enforce company/member access on the server and file-serving layer. A localStorage role switch is only a preview of those rules.

## Acceptance scenarios and implementation order

1. **Incomplete intake:** prepare a synthetic application; simulate return with one missing item; the handoff remains blocked until that item is accepted or explicitly waived. No actual identity values appear in storage/export/search.
2. **Two-state company:** accept NC evidence while SC is pending; SC readiness stays blocked. Completing marketing assets cannot bypass the credential gates.
3. **Existing entity:** import formation/EIN references; the system does not create unnecessary new-filing tasks. An expired SC certificate of existence blocks the relevant planned filing review.
4. **Renewal rules:** generate NC agency annual and SC agency biennial instances without duplicates. A title-only SC CE record can be exempt. An ownership edit creates a financial-interest review task.
5. **Per-JV close:** approve Company A with a balanced source register while Company B has a variance; only A can publish. Confirm a separate zero-activity company period.
6. **Cents and reserves:** exercise the $4,500 demo pool above plus a one-cent/two-member rounding case and a loss-only period. All totals reconcile without hiding a loss.
7. **Changed source after approval:** replace an underwriter row or change the applicable ownership plan; the old close remains historical, the new revision requires review, and stale publication is clearly marked.
8. **Member privacy:** publish one approved statement for Member A; Member B's preview cannot retrieve it. A company material update does not silently replace the released version.
9. **Accounting/report semantics:** closing and issuance dates in different months produce different clearly labeled counts. Publishing an earnings estimate never marks payment sent.
10. **Handoff integrity:** the local packet's company/profile/evidence references survive through formation review, financial reporting and partner preview; ambiguous matching requires resolution.

Build first the application case and evidence-aware readiness, then obligations, then per-company close snapshots, then statements/publication. Those changes complete the largest missing workflows without waiting for external accounts. Docusign, accounting reports, verified credentials and SoftPro synchronization can later populate the same records through adapters rather than replacing the local workflow model.

## Facts still requiring company evidence

Obtain the approved application and welcome packet; one new-JV and one existing-JV folder; actual NC/SC agency and individual credentials; underwriter appointment/configuration records; approved disclosure/title-preference templates; two months of John's spreadsheets including a correction; an operating agreement and mid-period member-change example; the accounting product/version and entity-to-book mapping; actual expense/reserve/tax/repayment categories; and approved statement recipients. Redacted examples are enough to finalize structure. The records, rather than generalized industry assumptions, should determine production calculations and collection fields.

## Source register

All external sources accessed **September 11, 2026**. Undated means no reliable publication date was displayed in the retrieved content. Existing internal analyses were checked against the timestamped transcripts; they are not independent legal authority.

1. **Private recording: Call with Stephenie Tocado.** Machine transcript, duration 27:50, supplied recording; `/Users/pilksclaes/Title software/.local/discovery/call-transcript.md`. Relevant ranges listed in the evidence table. Companion internal analysis: `docs/discovery/call-analysis.md`.
2. **Private recording: Tyler call.** Machine transcript, duration 75:03, supplied recording; `/Users/pilksclaes/Title software/.local/discovery/tyler-transcript.md`. Relevant ranges listed above. Companion analysis: `docs/discovery/tyler-call-analysis.md`. Existing research reviewed: `docs/research/carolinas-requirements.md`, `docs/research/operations-and-integrations.md`, and `docs/research/tyler-missive-and-records.md`.
3. **Docusign.** [Envelopes — Docusign's Public Workspace](https://www.postman.com/docusign/docusign-s-public-workspace/folder/3y6ue9x/envelopes). Official vendor API collection, undated; draft versus send status.
4. **Larry Kluger, Docusign.** [Use a template, Luke!](https://www.docusign.com/blog/developers/use-template-luke). Undated retrieved article; template roles, fields and version-management concerns.
5. **Docusign.** [Get hooked on MyConnectWebhook, our latest sample app!](https://www.docusign.com/blog/developers/get-hooked-myconnectwebhook-our-latest-sample-app). Undated retrieved article; envelope/recipient event meanings.
6. **Docusign.** [Manually authenticating HMAC signatures for Docusign Connect webhook configurations](https://www.docusign.com/blog/developers/manually-authenticating-hmac-signatures-docusign-connect-webhook-configurations). Undated retrieved article; authenticating sender and message integrity. The current developer-center concept/HMAC pages returned empty bodies, so readable official vendor articles and collection were used.
7. **Internal Revenue Service.** [Employer identification number](https://www.irs.gov/businesses/employer-identification-number). Current administrative guidance, undated retrieved page; state formation, responsible party and EIN confirmation.
8. **South Carolina Secretary of State.** [FAQs About Business Entities](https://sos.sc.gov/faqs-about-business-entities). Current administrative guidance, undated; foreign qualification evidence, filing rejection issues, member-record limits.
9. **North Carolina Department of Insurance.** [Licensing Applications and Forms for Business Entities and Agencies](https://www.ncdoi.gov/licensees/insurance-business-entity-licensing/licensing-applications-and-forms-business-entities-and-agencies). Current administrative FAQ, undated; agency application, DRLP, affiliated-agent list, branches and renewal.
10. **South Carolina Department of Insurance.** [Agency](https://www.doi.sc.gov/364/Agency). Current administrative guidance, undated; license prerequisites, appointments, even-year renewal, changes and branches.
11. **North Carolina Department of Insurance.** [Renew or Change an Insurance Business License](https://www.ncdoi.gov/licensees/insurance-business-entity-licensing/renew-or-change-insurance-business-license). Current administrative guidance, undated; license-category schedules and change handling.
12. **South Carolina Department of Insurance.** [Continuing Education — Compliance Requirements FAQs](https://www.doi.sc.gov/m/faq?cat=25). Current administrative FAQ, undated; limited-lines/title exemption.
13. **North Carolina General Assembly.** [G.S. 57D-2-24 — Annual report for Secretary of State](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_57D/GS_57D-2-24.html). Current posted statute; future amendment checked separately. NCSOS annual-report help returned 403, so the statute supplies the deadline rule.
14. **South Carolina Department of Revenue.** [Corporate FAQs](https://dor.sc.gov/business-income-taxes/corporate/corporate-faqs). Current administrative guidance, undated; LLC tax classification and corporate annual-report obligations.
15. **South Carolina General Assembly.** [Title 38, Chapter 75 — Property, Casualty, and Title Insurance Generally](https://www.scstatehouse.gov/code/t38c075.php), §§38-75-960 and 38-75-1000. Current posted code; financial-interest disclosure/report triggers and title commission restriction. §960 history includes 1993 Act 181; §1000 identifies 1988 Act 562.
16. **North Carolina General Assembly.** [Session Law 2026-59](https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/2025-2026/SL2026-59.html), §§13 and 17. Enacted August 11, 2026; relevant provisions effective October 1, 2026. Conditional military deployment exception, not effective as of source access.
17. **Financial Crimes Enforcement Network.** [Beneficial Ownership Information Reporting](https://www.fincen.gov/boi); [FinCEN Permanently Ends Beneficial Ownership Reporting Requirements for Millions of Small Business Owners](https://www.fincen.gov/news/news-releases/fincen-permanently-ends-beneficial-ownership-reporting-requirements-millions). August 11, 2026 alert/release; final rule effective August 14, 2026. Domestic-company exemption.
18. **Consumer Financial Protection Bureau.** [Regulation X §1024.15 — Affiliated business arrangements](https://www.consumerfinance.gov/rules-policy/regulations/1024/15/). Current regulation page; disclosure, permissible returns, required-use restriction and five-year recordkeeping.
19. **Consumer Financial Protection Bureau.** [Appendix D to Part 1024 — Affiliated Business Arrangement Disclosure Statement Format Notice](https://www.consumerfinance.gov/rules-policy/regulations/1024/d/). Current regulation appendix; disclosure structure.
20. **Internal Revenue Service.** [Publication 525 — Taxable and Nontaxable Income](https://www.irs.gov/publications/p525), 2025 tax-year edition, Partnership Income section. Taxable distributive share versus actual distribution.
21. **North Carolina General Assembly.** [G.S. 57D-4-05 — Restrictions on making distributions](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_57D/GS_57D-4-05.html). Current posted statute; distribution limitations, 2013-157 history.
22. **South Carolina General Assembly.** [Title 33, Chapter 44 — Uniform Limited Liability Company Act](https://www.scstatehouse.gov/code/t33c044.php), §§33-44-103, 33-44-405, 33-44-406, 33-44-408. Current posted code; operating agreements, distributions and member information rights.
23. **American Land Title Association.** [ALTA Best Practices Framework: Title Insurance and Settlement Company Best Practices, v4.2](https://www.alta.org/policies-and-standards/best-practices/download.cfm?bestPracID=113&type=pdf). Effective August 19, 2025. Voluntary industry framework, not a comprehensive legal inventory or certification of this software.
24. **Intuit.** [Create, view, or edit a Management report in QuickBooks Online and Intuit Enterprise Suite](https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/view-edit-management-reports-quickbooks-online/L90RAh2XZ_US_en_US). Current U.S. product guidance, undated retrieved article; report packets and period selection, not evidence of this company's product usage.
