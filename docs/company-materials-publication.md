# Company materials and partner publication

Implemented September 11, 2026, alongside Claude's post-issuance correction workflow. This feature uses the existing local workspace and document storage; it does not require new APIs.

## Discovery coverage

The discovery traceability document remains the baseline gap assessment. This document records the implementation of its materials and document-publication gaps:

| Requirement | Call reference | Implementation |
| --- | --- | --- |
| S08: create company materials | Stephenie 19:08–19:19; 21:35–22:15 | Requested content and branding, responsible person, preparation status, attached file and version, review notes and approval history. |
| S10: retrieve and share the correct company document | Stephenie 21:01–22:33; 25:54–26:14 | Company-scoped materials, exact-version preview/download, separate publication review and replacement. |
| V01: partner document downloads | Stephenie 22:40–23:52 | Explicit publication records with company, source version, audience, reviewer, publication event, withdrawal and replacement history. |
| X01 / X05: assignments and evidence | Both calls; see traceability table | Material requests create assigned tasks. Approval records retain their original material snapshot and document identity after later revisions. |

The standard checklist contains logo, affiliated-business disclosure, title preference form and business card. Company agreement and other material can be requested separately. This extends document retrieval for S09; effective ownership and agreement accounting remain in the existing onboarding/close workflows.

Existing research: [full company operations](research/full-company-operations.md), [operations and integrations](research/operations-and-integrations.md), and [both-call traceability](discovery/all-transcript-traceability.md). Raw recordings and full transcripts remain in ignored local storage.

## Local workflow

1. Open **Companies → a company → Documents → Requests and approvals**. Set up the standard checklist or request a material. Repeating setup does not duplicate records or tasks.
2. Record the owner and requested content. Upload a company file, choose the current document, and save **Awaiting review**.
3. Enter a material review note and confirm the saved material/file. Approval records the exact revision, source identity, reviewer and note. The assigned preparation task completes.
4. Prepare a publication draft with a title and either all company partners or selected members. Review that exact version and audience, then publish to the local partner preview.
5. Open **Partner portal → Shared documents** and choose the audience to inspect. Preview/download uses the published version.
6. Upload a later file version. The material needs review again and its task reopens. The existing publication stays on its previously reviewed source.
7. Approve the new material and publication. Replacement requires explicit confirmation of the prior release and audience change. Withdrawal requires a reason and never revives an older release.

There is one active release per company/document family or linked material, across audiences. To serve multiple selected members, select them together in the replacement release. The confirmation identifies the old and new audiences and explains lost access.

## Preservation and migration

- `Workspace.materials` is additive and has its own version. Existing orders, corrections, company records and document assets are preserved.
- Legacy `Partner` visibility labels remain on existing records but do not manufacture reviews or publication events. The vault identifies them for sharing review. Review and publish the desired versions explicitly.
- Applications and previously restricted sources cannot become partner publications by changing their label/category. Use a separately prepared, reviewed copy when appropriate.
- Restricting a reviewed or published source withdraws its release. Reviewed source content and historical approval evidence cannot be overwritten or deleted through ordinary workspace mutations; upload a new version.
- A private new version does not affect the published version. A closed publication cannot be reactivated. A new release must go through review.
- Material approval is distinct from company launch approval and transaction-specific disclosure delivery. The app does not generate legal templates or determine their sufficiency.
- Audience selection remains an administrator preview using recorded member names. Production account IDs, authorization, external sharing and durable audit storage remain separate work. Claude's full local backup/restore is included in the combined app.

## Verification

The full domain suite passes **67 tests**, including all 50 prior tests and 17 materials/publication tests. TypeScript checking passes.

Browser verification on isolated local sample data exercised upload, preparation, material approval, publication review, publication, private v2 upload, selected-member replacement, reload persistence and withdrawal. Downloads before and after replacement were compared byte for byte with their v1 and v2 upload fixtures. After withdrawal, no prior release reappeared. Uploading a material preserves the open company sheet and selected material.

The new tests cover legacy migration, idempotent tasks, company scoping, stale review, immutable historical approval evidence, reopening preparation work, audience replacement, privacy restrictions, publication history and independent onboarding state.

The production build also passes. After rebasing onto Claude's `e591577` backup commit, a full backup was restored through the UI into a fresh browser session. Re-export comparison confirmed identical materials, approval snapshots/history, both publication records, document IDs and exact uploaded v1/v2 bytes. Desktop and 390-pixel layouts were inspected visually.

A final browser pass opened all 16 workspace sections with no uncaught or console errors after a clean browser launch. Earlier development-only hot updates required a reload after shared context modules changed; the clean-session verification ran after those edits and the rebase.
