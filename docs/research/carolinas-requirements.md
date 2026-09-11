# North Carolina and South Carolina workflow addendum

Operations are confirmed in North Carolina and South Carolina, with future expansion intended. The software should use jurisdiction-specific onboarding and policy checklists, while preserving the distinction between state formation, permission to conduct insurance business, an underwriter relationship, and attorney work. The points below are design inputs from official sources, reviewed September 11, 2026; they are not a determination that any particular company or person is authorized to transact business.

## Immediate product consequences

1. Store **formation jurisdiction**, **operating jurisdictions**, and each order’s **property jurisdiction** independently. A company formed in North Carolina can have separate South Carolina registration and insurance-license records. One state dropdown on the company is insufficient.
2. Represent **legal entity registration**, **agency license**, **individual producer license/line of authority**, **underwriter appointment**, and **attorney review** as different records with separate evidence and expiration/status fields.
3. Make future states configurable. A new jurisdiction starts as **Requirements under review**, with a cited checklist and reviewer, rather than inheriting North Carolina’s rules.
4. Keep exact transcription and document organization automatable. Route legal interpretation, title opinions, determination of insurability, curative decisions, policy-form selection and licensed actions to the appropriate authorized professional.
5. Store checklist authority, source URL, source revision, effective dates, date last verified and reviewer. Do not label a company “compliant” merely because its uploaded-document count is complete.

## Agency and producer licensing

| Topic | North Carolina | South Carolina | Design implication |
|---|---|---|---|
| Agency authorization | NCDOI says insurance business entities must be licensed. The business-entity license has no separate lines of authority; those come from the individual producers. A North Carolina-licensed DRLP is required.[1] | SCDOI requires an agency license, with the stated sole-proprietor exception. Maintaining it requires at least one licensed and appointed producer assigned to the agency.[3] | Keep entity and individual license records separate; attach the designated responsible person and evidence of current status. |
| Application route | Current NCDOI guidance sends resident and nonresident business entities through NIPR and requires the designated producer to already hold an active NC license. Secretary of State compliance remains a separate responsibility.[2] | Current SCDOI guidance directs agency applications through NIPR after the agency has at least one SC-licensed producer; nonresident home-state certification may be needed if database verification is unavailable.[3] | Use prerequisite tasks and a manual “submitted / approved / needs information” lifecycle with external reference numbers. |
| Branches | NCDOI says branches sharing a FEIN can be covered by one license; separate FEINs require separate licenses.[2] | SCDOI gives a similar FEIN-based branch distinction.[3] | Do not assume every office is a legal company, or every company is one branch. |
| Agency renewals | Current NCDOI FAQ states April 1 annually.[2] | Current SCDOI page states January of even-numbered years.[3] | Renewal calendars must be tied to license type/state and observed license dates. |
| Individual title producer | NCDOI’s current entry page points to its candidate guide and coverage chart for the applicable resident/nonresident requirements.[4] | Current SCDOI producer guidance specifically requires title producers to submit a Financial Interest Disclosure under §38-75-960(B).[5] | Include a SC title disclosure task and support conditional examination/background requirements, based on the actual applicant category. |

**Avoid a blanket continuing-education rule.** SCDOI’s general producer page says all resident producers need 24 hours, but the department’s FAQ expressly identifies limited lines—including title—as exempt from §38-43-106; the statute also contains a limited-lines exception.[6][7] An individual may hold other lines with different obligations. The MVP should use a field for the verified requirement/exemption and evidence, rather than automatically generating a universal 24-hour CE obligation for title-only producers.

NCDOI also publishes a distinction between licensable insurance activity and nonlicensable administrative work.[8] That makes named roles and action-specific authorization more appropriate than treating an application uploader as a licensed producer.

## Attorney roles and policy preparation

**North Carolina:** G.S. §58-26-1(a) says insurance concerning NC real property requires an opinion from an NC-licensed attorney who is not an employee or agent of the title insurance company, based on a reasonable title examination conducted by the attorney or under the attorney’s direct supervision. It separately addresses the insurer’s determination of insurability.[9] The NC State Bar’s Authorized Practice Advisory Opinion 2002-1, revised January 26, 2012, discusses residential closings, legal-document preparation, title abstraction/opinions and the limits on nonlawyer activity.[10]

**South Carolina:** The SC Bar’s Ethics Advisory Opinion 09-01 describes lawyer supervision of five components of residential real-estate transactions: title abstracting, preparation of documents, closing, recording and disbursement. It emphasizes instruction, review and correction, rather than reliance on blanket assurances.[11] This is Bar advisory guidance, not a software certification or an approval of an autonomous workflow. The Supreme Court’s 2009 guidance for residential closing attorneys is a best-practice model; a contemporaneous official judicial report expressly states the court did not adopt those guidelines as a rule or otherwise endorse them.[12] Do not turn a best-practice checklist into an assertion that every item is a statutory command.

**Design recommendation:** the policy workbench should preserve the supplying attorney and firm, jurisdiction, opinion/document version, received date, source pages, professional reviewer and review outcome. It can propose exact field changes from recorded evidence; any conflict, new legal wording, absent opinion or unexplained title issue belongs in a review queue. For South Carolina, a transaction can record the responsible attorney and separate supervision milestones if the company participates in those steps. Do not claim the title company itself performs the attorney’s work.

## A material South Carolina accounting difference

SC Code §38-75-1000 states that a title insurer cannot pay a commission greater than 60%, directly or indirectly, on a title-insurance policy. Sections 38-75-980 and 990 also address filed premium schedules and dated schedules/retention.[13] The call’s hypothetical 30% underwriter / 70% agency allocation therefore must not become a universal default or an SC production calculation. Actual commissions, fees and remittance bases require the applicable underwriter agreement and authorized review; the statute alone does not establish the company’s real split.

Use separate fields for gross premium, agency commission, underwriter amount, other fees, adjustments, state, underwriter and effective contract/rate version. Keep draft remittance separate from partner distributions. A JV’s distributions are not simply the agency commission split across a member list.

## Formation, foreign qualification and EIN boundaries

**North Carolina formation:** G.S. §§57D-2-20 and 57D-2-21 describe LLC formation through filed articles and the required information, including organizer/member capacity, registered office/agent and principal office. G.S. §57D-7-01 separately addresses foreign LLC authority and lists activities that do not constitute transacting business.[14] Choosing the entity structure or deciding whether a particular expansion requires qualification should remain a professional decision; the system should collect the selected route and supporting filing.

**North Carolina maintenance:** the Secretary of State says an LLC’s first annual report is due April 15 of the year after creation, followed by annual reports.[15] A currentness check identified Session Law 2026-59, enacted August 11, 2026, adding a specified deployed-military-owner exception effective October 1, 2026.[16] It is not effective on the research date. This is a concrete reason to support effective dates and exceptions rather than one permanent recurring deadline for every entity.

**South Carolina formation and expansion:** the Secretary of State handles LLC filings; its current FAQ lists an in-state registered agent and, for foreign-entity authority applications, a home-state certificate of existence dated no more than 30 days earlier. It also flags unavailable names and missing signing capacity as common rejection causes.[17] SC LLC law provides the formation and foreign-qualification framework.[18] The state’s entity records do not necessarily provide a complete member/ownership roster, so the system needs the reviewed operating agreement or other authoritative ownership records—not an assumption that public registry lookup establishes all partners.[17]

**EIN:** this is a federal IRS identifier, distinct from either state’s entity number and insurance license. IRS guidance directs a newly created legal entity to register with its state before requesting an EIN. The IRS also distinguishes the responsible party from a nominee.[19] Current Form SS-4 instructions, revised December 2025, require the responsible party generally to be an individual and describe separate authorization for a third-party designee.[20]

A practical shared onboarding template is: choose reviewed formation route → collect approved governing documents → confirm state filing/foreign qualification → obtain and store EIN confirmation → verify individual producer credentials → apply for agency licensing → complete state-specific disclosures → record underwriter appointment and production configuration. These are dependency-aware administrative tasks; not every task is universally required in that order for every existing company.

## MVP fields and states to add

- `CompanyJurisdiction`: state, domestic/foreign status, registry ID, registration evidence, effective date, status, next required filing and responsible person.
- `AgencyLicense`: state, legal entity, FEIN reference, license/NPN, designated producer, active/expired/pending status, observed expiration, renewal rule/source.
- `ProducerCredential`: individual, state, line/type, license/NPN, status, exam/background/CE applicability and supporting evidence.
- `UnderwriterAuthority`: company, underwriter, state, agency account, appointment evidence, approved products, limits and effective dates.
- `ProfessionalReview`: order, attorney/firm, state, work being reviewed, evidence version, outcome and date.
- `RequirementTemplate`: jurisdiction, entity/license type, prerequisite, optional/conditional status, authority URL, effective window and approval history.

For the demo, label sample credentials and professional approvals as synthetic. A “Ready for review” state can be achieved locally; a real “Licensed,” “Registered” or “Issued” status should ultimately require authoritative evidence or a verified external result.

## Source register

All accessed September 11, 2026. Undated official webpages are identified as such. Source scope and exceptions matter; this list is not a comprehensive legal inventory.

1. NC DOI. [Obtain an Insurance Business License](https://www.ncdoi.gov/licensees/insurance-business-entity-licensing/obtain-insurance-business-license). Undated current page.
2. NC DOI. [Licensing Applications and Forms for Business Entities and Agencies](https://www.ncdoi.gov/licensees/insurance-business-entity-licensing/licensing-applications-and-forms-business-entities-and-agencies). Undated current FAQ; preferred over the older standalone PDF.
3. SC DOI. [Agency](https://www.doi.sc.gov/364/Agency). Undated current page; includes DRLP updates through NIPR.
4. NC DOI. [Become an Insurance Producer or Adjuster](https://www.ncdoi.gov/licensees/insurance-producer-and-adjuster-licensing/become-insurance-producer-or-adjuster). Undated current entry point; requirements depend on applicant/license category.
5. SC DOI. [Producer](https://www.doi.sc.gov/producer). Current page with explicit May 1, 2023 exam-vendor change; preferred over legacy pages still naming PSI or Prometric.
6. SC DOI. [Frequently Asked Questions — Continuing Education - Compliance Requirements](https://www.doi.sc.gov/m/faq?cat=25). Undated current FAQ; title/limited-lines CE exception.
7. South Carolina General Assembly. [Code, Title 38, Chapter 43](https://www.scstatehouse.gov/code/t38c043.php), especially §§38-43-30, 38-43-100 and 38-43-106. Current online code; individual sections carry amendment histories.
8. NC DOI. [Activities Requiring a License and Non-licensable Administrative Activities](https://www.ncdoi.gov/documents/agent-services/activities-requiring-license-and-non-licensable-activities/open). Official administrative guidance; publication date not established from retrieved content.
9. North Carolina General Assembly. [G.S. 58-26-1](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-26-1.html). Current posted text; displayed history includes 2018-38.
10. North Carolina State Bar. [Authorized Practice Advisory Opinion 2002-1](https://www.ncbar.gov/for-lawyers/ethics-and-governing-rules/ethics-opinions/opinions/authorized-practice-advisory-opinion-2002-1/). Adopted January 24, 2003; revised January 26, 2012.
11. South Carolina Bar. [Ethics Advisory Opinion 09-01](https://www.scbar.org/for-lawyers/quicklinks/legal-resources/ethics-advisory-opinions/ethics-advisory-opinion-09-01/). 2009 advisory opinion, currently published. The Bar committee disclaims disciplinary authority.
12. South Carolina Judicial Department. [Annual Accountability Report, Fiscal Year 2009–2010](https://www.scstatehouse.gov/Archives/aar2010/B04.pdf), p. 5. September 15, 2010. Historical official report, used only to characterize the 2009 guidelines’ status.
13. South Carolina General Assembly. [Code, Title 38, Chapter 75](https://www.scstatehouse.gov/code/t38c075.php), §§38-75-960, 38-75-980, 38-75-990 and 38-75-1000. Current online code; §38-75-1000 history identifies 1988 Act 562.
14. North Carolina General Assembly. [Chapter 57D](https://www.ncleg.gov/enactedlegislation/statutes/html/bychapter/chapter_57d.html), §§57D-2-20, 57D-2-21 and 57D-7-01. Current posted statutory framework; pending modifications checked separately.
15. NC Secretary of State. [Annual Report Help](https://www.sosnc.gov/divisions/business_registration/annual_report_help). Undated current administrative guidance.
16. North Carolina General Assembly. [Session Law 2026-59](https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/2025-2026/SL2026-59.html), §13; [unincorporated modifications table](https://www.ncleg.gov/Laws/Modifications). Enacted August 11, 2026; relevant modifications effective October 1, 2026.
17. SC Secretary of State. [FAQs About Business Entities](https://sos.sc.gov/faqs-about-business-entities) and [Business Entities](https://sos.sc.gov/online-filings/business-entities). Undated current administrative pages.
18. South Carolina General Assembly. [Code, Title 33, Chapter 44](https://www.scstatehouse.gov/code/t33c044.php), §§33-44-202, 33-44-203, 33-44-1002 and 33-44-1003. Current online LLC framework.
19. IRS. [Employer identification number](https://www.irs.gov/businesses/employer-identification-number). Current official guidance; page revision date not displayed in retrieved content.
20. IRS. [Instructions for Form SS-4](https://www.irs.gov/pub/irs-pdf/iss4.pdf). Revised December 2025.
