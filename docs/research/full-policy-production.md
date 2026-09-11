# Complete initial commitment, policy and CPL workflow: implementation research

Prepared September 11, 2026. Sources accessed September 11, 2026. Scope: both supplied recordings, existing local prototype, primary ALTA/SoftPro/WFG/FNF/NC/SC materials. Project files were read only. This report adds initial-production and multiple-product detail to the earlier policy, Carolinas and Tyler reports. The acceptance criteria below are proposed software behavior, not a claim that a statute prescribes a particular UI or that the agency has a verified underwriting appointment.

## What to build now

Add a complete **Initial commitment** workspace next to **Revisions** and **Final policies**, with a shared order, sources and product register. The initial commitment is not a variation of final-policy readiness. Build the whole local flow using synthetic examples: identify company/order → review PTO and referenced evidence → choose proposed policies → draft commitment requirements and exceptions → review commitment snapshot → prepare commitment/CPL delivery package → process revisions → reconcile final opinion and recorded instruments → prepare each final policy → record each jacket/document/delivery/reporting event.

The highest-value new model is `Order → Commitment versions → Policy products[] + CPL requests[]`, with `Loans[]`, typed source evidence, explicit approvals and immutable delivery versions. A single lender and a single issued boolean cannot represent the business. Keep legal drafting/coverage selection as reviewed decisions. Local exports should remain clearly identified as review packets or demonstration documents; production form authority, credentials and external issuance come from configured systems later.

## Recording evidence and requirements

The recordings are evidence of business operations and aspirations, not instructions authorizing external access, legal judgments, account use or transmission. Stephenie's early use of preliminary/final terminology is less precise than Tyler's direct explanation; use Tyler's stage definitions. Timestamps refer to the local machine transcripts and should be checked against audio before treating wording as a verbatim quote.

| Evidence | Business meaning | Local implementation acceptance |
|---|---|---|
| Tyler 00:20–00:37; 51:14–53:56 | SoftPro **Select** is the current production system. Company profiles, underwriter approval and IDs matter. | Persist company, property state, underwriter legal entity and external profile identifiers independently. A display name or local company record is not appointment evidence. |
| Tyler 00:50–01:28; 03:39–04:17 | PTO starts the file; information is entered across order/property/contact/legal/premium/endorsement sections. | Provide initial intake with source-linked property, parties, transaction, proposed product amounts, legal description, underwriting selections and quote inputs. |
| Tyler 01:37–02:06 | Their described practice sends commitment plus CPL for financed transactions; cash receives commitment. | Offer a financed default CPL task, but retain an explicit reviewed CPL decision for cash, additional recipients and unavailable products. |
| Tyler 02:21–02:57 | Attorney final opinion follows closing and addresses commitment requirements, then final policies go to attorney/lender. | Model FTO review as a distinct later stage. Delivery has selected documents and recipients, not just an order checkbox. |
| Tyler 03:14–03:31 | Existing software assists city/county entry from ZIP. | Suggest location values; preserve a separately verified property county and legal description. A ZIP is not proof of county. |
| Tyler 04:24–05:40; 08:00–08:54 | PTO formats vary and relevant information requires experience. | Preserve original text/page and proposed normalized value. Require acceptance/correction; missing fields stay missing. |
| Tyler 10:02–11:15 | PTO can reference a prior policy or search package. | Create a dependency row for every explicit reference: requested/received/reviewed/resolved. Missing referenced evidence blocks commitment approval, not intake/save. |
| Tyler 12:08–13:07 | Prior policy date/amount are straightforward; selection among its exceptions is substantive. | Extract prior policy metadata separately from line-by-line proposed exception carry-forward. Never discard an exception solely because it looks old or common. |
| Tyler 22:12–24:44; 26:06–28:14 | The attorney normally supplies title opinion based on search; packages may be very large; errors/omitted payoff matter. | Distinguish attorney opinion, search evidence and agency underwriting review. Allow escalation/questions and evidence indexing, not an automated legal conclusion from a package. |
| Tyler 29:25–30:10 | Final opinion may specifically confirm a required prior lien was canceled/paid/released. | Link evidence to the exact requirement. A final-opinion upload does not satisfy all requirements. |
| Tyler 31:27–33:10 | “See attached” can require instrument review; dated and recorded dates differ; missing document should be requested from attorney. | Separate execution/dated date, recording date/time, county and recording identifier. A missing security instrument offers an attorney request draft and an unresolved dependency. |
| Stephenie 06:34–11:38; Tyler 68:03–69:23 | Save the email attachments, use exact recorded names/capacities/instrument details, obtain the correct jacket. | Preserve every attachment/version, explicit identity/capacity text and document provenance; distinguish draft schedule, jacket and assembled final policy. |
| Tyler 39:26–41:52; 42:52–42:58 | Revision starts with email body, correct JV/file, loan amount change, revised commitment and prepared reply. | Revision request records source message, selected loan, before/after values, reason, impact list, new document version and unsent reply. |
| Tyler 44:09–45:45; 47:39–48:16 | Background work should not occupy Tyler's session; simultaneous edits cause locks. | Demonstrate jobs and stale-version guards locally; future integration needs supported unattended execution and lock handling. Shared-login and device-count comments are not verified licensing permissions. |
| Stephenie 13:18–14:57; Tyler 62:07–63:15 | SoftPro tracks production/underwriter money; John creates JV reports and allocations. | Link products and premium classifications to reporting, but keep issued, delivered, reported and remitted distinct. Exact accounting rules still need John's examples. |

## Verified facts that change the model

### 1. Requirements, exceptions and policy schedules are different concepts

The published ALTA 2021 commitment describes a conditional undertaking to issue identified policies, not an attorney title opinion. Schedule A identifies proposed insureds and amounts; Schedule B-I lists conditions; B-II lists matters excepted unless cleared to the insurer's satisfaction. The commitment's duration is an inserted interval, so do not hardcode a universal six-month expiry. Store actual effective date, chosen duration/expiry and amendment version. Open B-I conditions are compatible with preparing a commitment. [ALTA 2021 Commitment redline, published July 30, 2021](https://www.alta.org/policies-and-standards/policy-forms/downloadSub?formSubID=2159&type=pdf)

Final schedules need product-specific mapping. FNF's 2021 loan-policy comparison shows Schedule B-II concerns subordinate matters; that is not the meaning of commitment B-II. A commitment exception cannot simply be copied into a same-named final bucket without review. Store semantic item type and target product/schedule instead of treating the printed label as the business concept. [FNF ALTA Policy Comparisons, loan Schedule B, 2021](https://media.fntic.com/ncs/2021policycomparisons/36-37/)

### 2. One transaction can require multiple policies and loans

NC's consumer guidance distinguishes owner protection from lender protection and explains that lender insurance does not protect the owner. The local screen should display both proposed products and their distinct insureds and coverage amounts. An owner product should not inherit the lender name; a financed transaction should not automatically imply the owner declined coverage. [NC DOI, Title Insurance, current undated page](https://www.ncdoi.gov/consumers/homeowners-insurance/title-insurance)

WFG publishes an NC rating-bureau manual effective October 1, 2025. It describes simultaneous issue of an owner policy plus at least one loan policy on identical property; multiple loans are explicitly contemplated. It also defines mortgage broadly to include a mortgage, deed of trust and other security instruments. Its rules distinguish prior-policy/reissue evidence and separately calculated charges aggregated as one insured premium. These are reasons to model arrays, instrument type, evidence and rate versions. They do not establish the user's contract, eligible risks or policy-form choices. [WFG, North Carolina Title Insurance Rating Bureau manual, effective October 1, 2025](https://wfgunderwriting.com/wp-content/uploads/filebase/north-carolina/rate-manuals/WFG%20North%20Carolina%20Title%20Insurance%20Rating%20Bureau%20Rate%20Manual%20effective%2010-1-2....pdf)

A second official NC publication explains the quantitative simultaneous calculation: use the higher of owner coverage or combined loan coverage, then add $28.50 per simultaneously issued loan policy. It also specifies reissue evidence, a fifteen-year condition and eligible coverage limits. Do not calculate full independent owner and lender premiums and add them. Keep actual customer quotes inactive until the applicable underwriter/rule set and transaction eligibility are confirmed. [Chicago Title, North Carolina Title Insurance Rates, effective October 1, 2025](https://www.northcarolina.ctic.com/getattachment/News-Events/Chicago-Title-Rates-Effective-10-1-2025.pdf?lang=en-US)

### 3. Tacking is not a discount switch

NC State Bar 2009 FEO 17 withdraws the portion of RPC 99 that appeared to set an owner-versus-lender-policy tacking standard of care; it treats that as outside the Ethics Committee's remit and preserves competence and client consultation duties. Therefore do not implement an old “only owner prior policies are allowed” rule, or interpret an uploaded prior policy as automatic permission to rely on its title conclusions. Separate attorney/underwriter reliance review from premium reissue qualification. [NC State Bar, Tacking as Question of Standard of Care, 2009 FEO 17; current official text accessed September 11, 2026](https://www.ncbar.gov/for-lawyers/ethics-and-governing-rules/ethics-opinions/opinions/2009-formal-ethics-opinion-17/)

### 4. CPL is a separate, configurable product

ALTA's single-transaction CPL addresses limited closing-funds loss and has terms applicable to lenders and purchasers/lessees; it is not categorically a lender-only document or comprehensive transaction protection. The local label should be “CPL decision,” with recipient role, closing/issuing party, selected form and related loan where relevant. Do not turn Tyler's financed workflow shortcut into universal law. [ALTA Closing Protection Letter—Single Transaction redline, adopted April 2, 2021](https://www.alta.org/policies-and-standards/policy-forms/downloadSub?formSubID=2135&type=pdf)

SC §38-75-1010 permits protection for a party to a transaction in which a title policy will issue, with defined coverage boundaries. Its premium must be approved and is not subject to an agreement dividing the premium. Sections 980–990 concern filed schedules and dated current premiums; §1000 limits policy commission to 60%. Do not apply a generic company split to SC CPL charges, or assume every insurer shares one SC rate. [SC Code, Title 38 Chapter 75, §§980–1010; CPL provision effective June 11, 2012](https://www.scstatehouse.gov/code/t38c075.php)

### 5. NC and SC attorney/underwriter review cannot be collapsed

NC §58-26-1 requires the specified NC attorney opinion and separately assigns insurability determination to the title insurer. It also addresses approved-attorney closing-services coverage and combined premiums. Persist the opinion author, jurisdiction, opinion date/source, underwriter review and authorized reviewer separately. A local checkbox can record a demonstration review; it cannot manufacture attorney approval or insurer authority. [NC General Statutes §58-26-1, current text](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-26-1.html)

SC Bar's advisory opinion describes attorney supervision of closing components and meaningful review rather than merely assuming a nonlawyer completed legal work correctly. Keep SC-specific professional-review tasks available instead of copying NC statutory wording into every state. This advisory is not a standalone binding opinion on all future software functions. [SC Bar Ethics Advisory Opinion 09-01, 2009](https://www.scbar.org/for-lawyers/quicklinks/legal-resources/ethics-advisory-opinions/ethics-advisory-opinion-09-01/)

### 6. Current availability is an account/state/form matrix

SoftPro's agentTRAX guide describes company/property-state availability, loan-specific CPL and jacket selection, endorsement matching, high-liability approval relative to agency contract, document history, and separate final-policy upload. Edits in its CPL dialog do not necessarily write back to the order. A canceled CPL requires a new request. These documented behaviors justify explicit product mapping, reconciliation, history and per-request states. The guide is from 2022; it verifies historical functionality, not this agency's current permissions or an open API. [SoftPro 360—agentTRAX User Guide, March 2022 header / August 2022 revision history](https://help.softprocorp.com/articles/360/AgentTRAX_UserGuide.pdf)

Current SoftPro pages describe Select's ProInterface API/SDK as an add-on and 360 partner integrations including WFG and FNF. Reuse existing configured document production and underwriter connections where authorized; do not assume these pages grant API access or unattended automation. [SoftPro Select, current](https://www.softprocorp.com/real-estate-software-solutions/softpro-select/), [SoftPro 360 Integrations, current](https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/)

ALTA's current catalog contains different policy, endorsement and CPL generations, and describes form licensing. An ALTA family name/year is insufficient to choose an approved underwriter form. WFG's SC bulletin dated May 27, 2022 concerns approved updates to its ALTA 2006 forms effective May 18, 2022—useful evidence that “always select 2021” would be wrong, but not proof of today's complete approved SC inventory. [ALTA Policy Forms and Related Documents, current index](https://www.alta.org/policies-and-standards/policy-forms/), [WFG SC 2022-01, Updated ALTA 2006 Policy and Endorsement Forms](https://wfgunderwriting.com/wp-content/uploads/filebase/south-carolina/bulletins/SC%202022-01%20Updated%20ALTA%202006%20Policy%20and%20Endorsement%20Forms%2C%20effective%205-18-22.pdf)

Commonwealth/Fidelity have official NC and SC agency pages, so preserve Commonwealth as its exact insurer identity rather than renaming it to the FNF group. Neither page verifies this JV's appointment. [FNF NC Agency](https://nationalagency.fnf.com/nc/fntic-cltic/), [FNF SC Agency](https://nationalagency.fnf.com/sc/cltic-fntic)

## Proposed data model and invariants

This is an engineering design derived from the workflow, not a transcription of an external schema. Add stable IDs and versions; avoid overloading one order status.

| Entity | Minimum data and relationships | Invariant |
|---|---|---|
| Order | companyId, externalProfileId, state, county, transaction type, propertyIds, assigned reviewer, version | Company/order scope must be validated in every write, not just filtered in the UI. |
| Property | address, verified county/state, parcels[], legal description + source, estate/interest | Address, parcel identifiers and legal description are distinct; retain supplied legal text. |
| Party | exact legal name, capacity wording, roles[], address/contact sources | Buyer, seller, borrower, vesting owner, proposed insured, lender and attorney may overlap but are not synonyms. |
| Opinion | preliminary/final, attorney, source document+version, date, signed-status evidence, covered property, reviewedBy/at | No fabricated signature or approved-attorney status from a name/email. |
| SourceEvidence | documentId, version, page/range, excerpt, source role, parent split, linked items/fields | Replacement invalidates dependent reviews; all original attachments remain discoverable. |
| IntakeDependency | type, originating PTO excerpt, needed document/clarification, owner, status, resolution evidence | “See prior policy/search” unresolved blocks approval; manual draft/save remains allowed. |
| Loan | stable id, borrower ids, lender insured clause, amount, priority description, securityInstrumentId | Positive finite money for active loan; money stored in cents; multiple loans have separate evidence. |
| SecurityInstrument | type mortgage/DOT/other, dated date, recording county/date/time, instrument number and/or book/page, parties, trustee if applicable | Type chooses required fields; a mortgage does not require a fabricated trustee. Recording references are strings, preserving leading zeros. |
| PolicyProduct | owner/loan/other-reviewed, loanId if loan, proposed insured, coverage cents, estate/interest, form choice, endorsements[], status | Each active loan product points to exactly one same-order loan. Owner coverage/insured is independently reviewed. |
| FormChoice | insurer id, property state, family, exact form code/version, effective dates, catalog source, approval status | Catalog dates are not inferred from document upload time; retired/mismatched forms cannot be approved as current. |
| CommitmentVersion | number, effective date/time as supplied, expiration terms, products snapshot, BI items, BII items, document refs, reviewer, version hash | Review binds to a complete immutable snapshot; new material change produces a new version. |
| Requirement | stable id, text, source/origin, applicable product ids, Open/Needs information/Satisfied/Not applicable reviewed, evidence[], decision | Final clearance needs an explicit supported disposition per applicable item; “not applicable” needs rationale, not silent deletion. |
| Exception | stable id, original text, source/origin, proposed/retained/revised/removal requested/removed after review, target products and final schedule, reviewer | Removing from a draft and insurer-authorized removal are separate. Never call the status simply “Excluded,” which can mean opposite things. |
| PriorPolicy | insurer, policy number/type, insured, amount, date, property match, document, exceptions[] | Prior title policy, prior security instrument and prior commitment are distinct document types. |
| PriorPolicyDecision | reliance review + rationale; independent reissue evidence/eligibility review + rate version | Tacking does not automatically cause a discount, and a discount does not prove title reliance approval. |
| CPLRequest | recipient(s), role, loanId if applicable, insurer/profile/state/form, closing party, planned closing date, amount when required, status, refs/docs, version | CPL lifecycle is independent of commitment and final policy; not-requested has a reason. |
| Quote | input snapshot, rate source/version/effective date, line classifications, simultaneous group, eligibility evidence, reviewer | Demo/manual estimate is visibly different from verified quote; changes invalidate quote approval. |
| ProductArtifact | policy id, kind (schedule/jacket/endorsement/assembled final), document version, external reference, effective date, mode | A jacket number alone does not prove an assembled final policy exists or was delivered. |
| DeliveryPackage | selected immutable artifact versions, To/CC, subject/body, reviewed snapshot, status, result evidence | Approval of one packet never authorizes a different attachment version or recipient set. |
| IntegrationJob | operation, scoped payload snapshot, idempotency key, remote correlation id, queued/running/succeeded/failed/unknown | Unknown submission result is reconciled before retry; local prototypes never imply an external request was sent. |

Treat title underwriting hold, customer withdrawal/lost business and technical job failure as different dimensions. Do not label all three “Rejected.”

## Exact state-transition acceptance criteria

### Initial intake and commitment

1. **Unmatched → Linked:** operator chooses company and order (or creates a scoped new order), confirms property/party match, and assigns source roles. Matching suggestions must not attach evidence from another JV automatically.
2. **Linked → Drafting:** PTO exists or an explicit alternative intake source is recorded. Intake can be incomplete. The screen shows missing data/dependencies without blocking saving.
3. **Drafting → Needs review:** a draft snapshot includes reviewed identity/property facts, at least one selected proposed policy, exact form metadata or an explicitly synthetic form, populated policy insured/amount, sourced legal description, requirement and exception lists, and a premium/CPL decision. Each explicit PTO cross-reference is resolved or remains an identified blocker.
4. **Needs review → Approved locally:** current snapshot equals reviewed snapshot; relevant dependency resolutions and product/coverage decisions are reviewed. Outstanding commitment requirements are permitted and remain printed/listed. Do not require FTO, deed recording or satisfied payoff requirements here.
5. **Approved locally → Package prepared:** generate/store a clearly marked local review artifact from that version and create an unsent recipient-specific reply. If CPL is pending, package shows that fact; it does not invent a CPL document.
6. **Changed after approval:** create/amend a draft version; mark previous approval/output stale for new delivery. Preserve old content/history. Existing actually sent packets remain historical truth rather than disappearing.

### CPL

1. Default state is **Decision needed**. A recorded **Not requested** decision includes reviewer, reason and affected recipients; it is not “legally unnecessary.”
2. **Draft → Reviewed locally** requires exact company/profile, state/insurer, recipient role/name, associated loan where applicable, closing party, selected form and transaction identifiers required by that form.
3. Local **Simulated request → Simulated result recorded** must use visibly synthetic document IDs. Real **Requested → Returned → Reviewed → Delivered** is reserved for a connected result/manual evidence recording with provenance.
4. An amount/recipient/closing party/profile/form change marks the prior pending request or prepared letter for reconciliation; do not overwrite an issued letter silently.
5. **Void/cancel recorded** is terminal for that request. Replacement creates a linked new request. Preserve original letter and cancellation evidence.

### Final policy products

1. **Awaiting final evidence → In review** accepts FTO and recorded-instrument documents without clearing any requirement automatically.
2. **In review → Prepared locally** requires current source-backed applicable fields; reviewed relationship between FTO, commitment version and each requirement; reviewed final exception mapping; product insured/coverage/form/endorsement selection; matching current quote; and any recorded authority/escalation decisions. A loan product validates its own instrument and amount, not whichever loan happened to be first.
3. A source may legitimately support several items, but each item records its evidence location and decision. Missing evidence/request clarification remains visible.
4. **Prepared → Jacket recorded** attaches the jacket/reference to the selected product only. **Final assembled** requires selected schedule/jacket/endorsement versions or one complete imported final policy document, with review.
5. **Final assembled → Delivery prepared** selects exact documents and recipients. **Delivered recorded** requires local simulation or externally evidenced delivery, clearly distinguished. Owner policy delivery does not mark the loan policy delivered.
6. **Reported** and **Remitted** are separate scoped events tied to product/premium accounting. Order-level “complete” is derived from all expected active products and required deliveries; a single product's success cannot finish the whole order.
7. Once an issued artifact is recorded, edits start a **Correction** or **Replacement** workflow preserving the issued original. Do not mutate historical coverage data in place.

### Revisions, concurrency and freshness

Use one domain mutation path for every material edit, increment the order/product version, and record an audit event. A stale UI mutation fails with “This file changed; review the latest version.” Do not rely on a disabled button as the only guard.

| Changed input | At least these reviews/outputs become stale |
|---|---|
| Loan amount or product coverage | selected loan/product, quote, commitment snapshot, relevant CPL/HLA decision, final draft, pending delivery |
| Buyer/lender/insured/capacity | affected policy and CPL selections, commitment/final drafts, recipient review where appropriate |
| State/county/property/legal | jurisdiction/profile/form eligibility, all coverage/schedule reviews, quote and affected artifacts |
| Insurer/company/profile | all insurer-specific forms, endorsements, approval evidence, quote, CPL/jacket request payloads |
| PTO/prior policy/search document | fields/items/dependencies derived from that version and initial-commitment approval |
| FTO/deed/security instrument | linked final fields, clearance review, final artifact readiness |
| Requirement/exception text or disposition | commitment version if applicable; final mapping/clearance and policy artifact |
| Recipient/attachment version | that delivery approval only; do not silently rereview legal content merely because subject spelling changed |

The snapshot should cover all relevant parties, properties, products, loans, forms, endorsements, evidence versions, schedule items and decisions—not just a generic loan amount and commitment reference. Persist approval purpose so “initial commitment review” cannot satisfy “final clearance review.”

## Minimum meaningful local scenarios

These are proposed acceptance cases rather than new legal rules.

1. **Financed NC purchase:** owner + first loan. Open mortgage-release requirement appears in the initial commitment; commitment can be reviewed. Final readiness remains blocked until item-specific evidence is accepted.
2. **NC multiple loans:** owner + first + junior loan; CPLs select correct loans; recording first-loan jacket leaves two products unfinished. A synthetic quote demonstrates simultaneous grouping without adding three full base premiums.
3. **Cash purchase:** owner product; no loan/DOT/trustee required. Explicit CPL decision can be “not requested” or a reviewed purchaser request.
4. **SC refinance with mortgage:** lender-only product; no new transfer deed is assumed; actual mortgage metadata required and no fabricated DOT trustee. Existing owner/vesting facts remain represented separately.
5. **PTO references missing prior policy:** dependency blocks approval; manual draft available; receiving policy resolves receipt only until review. Prior exceptions remain source-linked.
6. **Twenty prior-policy exceptions:** proposed carry-forward decisions can be saved individually. Removing five requires five reviewed decisions/rationales; upload/extraction alone cannot silently erase them.
7. **Loan revision after approved commitment/CPL:** before/after diff displays impact; new snapshot/revised document required; old pending reply cannot be approved or reused unnoticed.
8. **Changed source after final review:** relevant fields and evidence review become stale even when the filename is unchanged.
9. **Wrong JV evidence:** identical address/file name under another company cannot satisfy the order's prerequisite, attach to its packet or resolve its requirement.
10. **Form mismatch:** owner endorsement selected for a loan product, unknown state/form version or unmatched insurer code blocks the relevant production approval; it can remain in a draft as unresolved.
11. **Partial delivery:** lender packet prepared; owner packet still pending. Order dashboard reports partial completion accurately.
12. **Conflict and correction:** stale modal save fails; issued document data cannot be silently revised; replacement event links old and new artifacts.
13. **CPL cancellation:** canceled request remains immutable; replacement has a new ID and explicit relationship.
14. **Future state:** intake/drafting possible, but state-specific production approval displays missing configuration instead of inheriting NC rules.

## Read-only code review: concrete delta from existing prototype

Inspected `web/lib/title/production.ts`, `web/lib/title/model.ts`, `web/components/title/policies.tsx`, `web/components/title/final-intake.tsx`, revisions, and existing discovery/research notes. Findings below describe the inspected version; other agents may now be changing it.

- `TitleFile` at `production.ts:30` holds one lender/loan, commitment reference and CPL reference. `requirements` combines requirement/exception status values. Add separate products/loans/CPLs and typed dispositions; migration can seed one explicit loan product from existing data and leave owner product “decision needed” rather than inventing selection.
- `neededFields`/`requiredSources` at lines 125/190 choose only Deed and Deed of trust. Replace the financed-implies-DOT assumption with loan-specific instrument types/field requirements. Keep source-role migration compatible.
- `commitmentReview` and `finalReadiness` at lines 159–245 currently implement final clearance, not initial commitment creation. Rename its purpose or separate the two to prevent accidental gate reuse.
- Current final snapshot omits future product/form/endorsement/party content and does not serve as a complete artifact snapshot. Extend through centralized dependency invalidation.
- `TitleRequirement.evidence` is a free string. For meaningful evidence review, store document/version/page references alongside notes; a nonblank word cannot establish current source provenance.
- Policy lifecycle at `policies.tsx:809–889` records one issued status and delivery boolean for the entire order. Move lifecycle to products/artifacts, preserve aggregated legacy display as a derived value, and retain demonstration-vs-external event provenance.
- Existing source matching, version guards and locally approved revision replies are useful foundations. Reuse them; extend the scoping and stale-snapshot checks rather than creating an independent data island for commitments.

## What is verified, and what remains configuration

**Verified:** SoftPro Select is named in Tyler's call; public Select documentation offers ProInterface API/SDK add-on; public 360 integration documentation names WFG/FNF capabilities; agentTRAX has documented product/loan/form review flows; NC and SC differ materially; official NC 2025 rate publications exist; a current SC public filing portal exists.

**Not verified:** actual Select build, enabled API/SDK license, unattended session rights, production/test access, agency/JV appointments, signatory rights, permitted policy forms/endorsements for each state/insurer, current WFG/Commonwealth SC rate manuals, liability thresholds, insurer escalation contacts, settlement/CPL workflow used by each JV, and John's allocation formulas. Store these as explicit configuration/evidence states. Do not fill them from a public marketing page or transcript speculation.

The SC DOI provides public closed rate/rule/form filings through SERFF. The publicly located WFG SC rate PDF is effective April 22, 2011; it is too old to present as a verified September 2026 price book. Use the DOI retrieval route or the agency's current insurer materials before enabling real pricing. [SC DOI, Insurance Company Filings, current undated page](https://www.doi.sc.gov/595/Insurance-Rates)

## Source register

All URLs above were checked/accessed September 11, 2026. Effective dates are taken from the documents, not search-result crawl/publication guesses.

| ID | Primary source / date | Use and currentness limit |
|---|---|---|
| T1 | `.local/discovery/call-transcript.md`, supplied Stephenie recording | Operational evidence; dates/wording not externally verified; quoted timestamps above. |
| T2 | `.local/discovery/tyler-transcript.md`, supplied Tyler recording | Main technical workflow evidence; statements about licensing/permissions not independently established. |
| R1 | ALTA 2021 Commitment redline, July 30, 2021 publication | Published form semantics; comparison document, not an agency-authorized template. |
| R2 | FNF 2021 loan-policy comparison | Product-specific schedule meaning; not a current approved form inventory. |
| R3 | NC DOI Title Insurance, undated current page | Owner/lender distinction. |
| R4 | WFG NC rating-bureau manual, effective October 1, 2025 | Current located NC rules; not evidence of user's appointment. |
| R5 | Chicago Title NC rates, effective October 1, 2025 | Independent official corroboration of NC simultaneous/reissue mechanics. |
| R6 | NC State Bar 2009 FEO 17, current official text | Tacking decision boundary. Redesigned official page omits adoption date in retrieved body; opinion ID is not an adoption date. |
| R7 | ALTA Single Transaction CPL, adopted April 2, 2021 | Recipient/coverage distinctions; actual approved form depends on insurer/state. |
| R8 | SC Code §§38-75-980–1010; relevant CPL provision June 11, 2012 | Current codified text, not a full interpretation of agency-specific arrangements. |
| R9 | NC GS §58-26-1, current codified text | Attorney opinion and insurer roles. |
| R10 | SC Bar Ethics Advisory Opinion 09-01, 2009 | Advisory professional-supervision guidance. |
| R11 | SoftPro agentTRAX guide, 2022 | Historical operational evidence; current account feature access unknown. |
| R12 | SoftPro Select and 360 current product pages | Public capabilities and integration candidates, not API permission. |
| R13 | ALTA current policy-form index | Version/licensing considerations; excludes proposed/not-final drafts. |
| R14 | WFG SC 2022-01 bulletin, May 27, 2022; forms effective May 18, 2022 | Demonstrates state/insurer-specific form availability; current inventory unknown. |
| R15 | FNF NC and SC agency pages, undated current | Exact Commonwealth/Fidelity regional identity; no JV appointment evidence. |
| R16 | SC DOI Insurance Company Filings, undated current | Public rate/form verification route. |

Research traps avoided: no third-party generic SC rate calculator was relied upon; no ALTA public-comment draft was treated as a final approved form; no old WFG SC rate schedule was silently promoted to current; no owner-policy-only tacking rule was copied from superseded RPC99 language; no legal conclusion was inferred from Tyler's descriptions of colleagues' work.
