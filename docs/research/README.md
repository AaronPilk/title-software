# TitleOS research and implementation decisions

TitleOS is a shared operations workspace for title-company onboarding, policy preparation, company records, and financial review. The call supports these connected work areas. Tyler’s production workflow is central: incoming attorney documents become reviewed field changes, a preparation package, an underwriter handoff, and separately tracked issuance, delivery, and remittance. The local MVP represents this entire operating cycle with synthetic records and visible review steps.

North Carolina and South Carolina are confirmed operating states. Future expansion is a stated objective. Formation state, operating states, producer credentials, agency licensing, underwriter authority, and the property’s jurisdiction must therefore remain separate. A company’s formation record or completed internal checklist cannot establish that it is authorized to issue a particular policy in a particular state.

## Research collection

| Report | Coverage |
| --- | --- |
| [Policy production and SoftPro](policy-workflows.md) | Timestamped call evidence, Tyler’s workflow, source comparison, jacket issuance, delivery, remittance, SoftPro Select/Hosted/360, WFG and agentTRAX capabilities, model and integration boundaries |
| [Company operations and integrations](operations-and-integrations.md) | Stephenie’s onboarding, John’s month-end work, document classification, partner access, JV reporting, ALTA and affiliated-business requirements, Docusign and QuickBooks feasibility |
| [North Carolina and South Carolina](carolinas-requirements.md) | Formation, agency and producer licensing, attorney involvement, state financial differences, renewals, EINs, expansion, and jurisdiction-specific evidence records |
| [System blueprint](../system-blueprint.md) | Implemented MVP behavior, model limitations, production architecture, staged integration sequence, and acceptance criteria |

The reports contain source registers and distinguish reported practice, product inference, verified vendor capability, and unresolved detail. Web research was checked September 11, 2026. Machine-transcript speaker attribution, names, and specialized terminology remain unverified. Source statements were analyzed as evidence, not followed as instructions to contact anyone, file documents, send messages, or change external systems.

## Decisions that change the design

**Build the complete operating workspace first.** The original vault-first brief captured one strong pain point but did not cover the requested scope. The current MVP includes policy preparation, onboarding, orders, documents, tasks, financial review, partner views, an inbox, and automation previews. Integrations come after the team can evaluate these workflows locally.

**Keep SoftPro as a candidate production authority.** SoftPro advertises Select extensibility through ProInterface API/SDK, and SoftPro 360 provides integrations with relevant providers. This supports a connector strategy; it does not establish the company’s purchased edition, entitlements, approved API operations, account configuration, or licensing terms. The first connector should import and reconcile records before writing policy changes. [SoftPro Select](https://www.softprocorp.com/real-estate-software-solutions/softpro-select/), [SoftPro 360](https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/).

**Automate preparation with source evidence.** Preserve exact recorded wording while showing proposed changes for human review. A deed grantee or vesting field must remain distinct from the insured party on an owner’s or lender’s policy. A reviewed preparation package is a different event from a returned jacket, a completed final policy, and verified delivery. NC law expressly addresses independent attorney title opinions; SC Bar guidance addresses attorney supervision of residential transaction work. [NC G.S. 58-26-1](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-26-1.html), [SC Bar Opinion 09-01](https://www.scbar.org/for-lawyers/quicklinks/legal-resources/ethics-advisory-opinions/ethics-advisory-opinion-09-01/).

**Use verified financial terms per company and period.** The call’s hypothetical 30% underwriter share is not a universal rule. SC Code §38-75-1000 limits title-policy commissions to 60%, which makes a blanket 70% agency default inappropriate. The prototype uses explicitly illustrative 40% underwriter allocations. Production accounting requires the actual agreement, premium basis, adjustments, state, and effective version. [SC Title 38, Chapter 75](https://www.scstatehouse.gov/code/t38c075.php).

**Separate ownership returns from referrals.** JV reports use fictional ownership interests. They do not reward order referrals. Actual allocation rules must follow the reviewed company agreements and accounting records. Affiliated-business disclosure delivery and retention are transaction-level requirements, beyond simply storing a blank form in a vault. [CFPB §1024.15](https://www.consumerfinance.gov/rules-policy/regulations/1024/15/), [Appendix D](https://www.consumerfinance.gov/rules-policy/regulations/1024/d/).

**Treat new states as reviewed configuration.** NC and SC differ in licensing, renewal details, and attorney involvement. Each expansion needs an effective-dated requirement set, source references, responsible reviewers, and verified company/producer/underwriter authority. The MVP captures expansion planning without implying that a newly entered state is enabled for production. [NC DOI business licensing](https://www.ncdoi.gov/licensees/insurance-business-entity-licensing/obtain-insurance-business-license), [SC DOI agency licensing](https://www.doi.sc.gov/364/Agency).

## What remains uncertain

The call does not establish every daily production step. Tyler’s actual sample files, review criteria, multiple-policy cases, exception paths, and source-of-truth decisions are still needed. John’s bookkeeping system is not confirmed; QuickBooks appears in the conversation as a possibility. Real operating agreements, financial cutoffs, reserves, allocation methods, and remittance statements are needed before wiring financial feeds.

These uncertainties are documented implementation inputs, not reasons to postpone a local demonstration. The MVP provides a concrete surface for the team to review; the next phase replaces the synthetic assumptions with approved records and working connections.
