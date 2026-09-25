# Company workspace

The Agency company drawer has three sections: Overview, Application and Documents.

## Overview

- Company cards and headers show a selected Internal Branding PNG/JPG original as their logo. Upload company logo saves the original, then selects it. Existing eligible logos can be selected in Edit details; Use initials clears the selection.
- Edit details has operating-state checkboxes, the company's selected underwriters and separate Domain, Email and Website renewal dates, providers and references. These are recorded facts, not automatic renewal purchases or external authority verification.
- New company creation supports NC/SC and underwriter selection. The agency can leave contact name/email blank. Imported company profiles likewise do not need invented contacts.
- Owners and percentage interests live on Overview. Existing ledger names remain stable because historical accounting refers to them. Separate private owner details identify the actual legal person or LLC and its representatives.
- Owner records include formation status, agency/outside formation responsibility, state, Secretary of State reference and optional restricted formation originals. The title company's EIN is separate from each owner's EIN; neither requires an uploaded tax document.
- Saved applicants can populate a selected owner and representative record after confirmation. Copying a different legal owner clears the prior entity's EIN and formation references. Use a different legal owner also clears those details and representatives before manual replacement; ordinary name corrections retain them. Unknown ownership does not invent an LLC.
- Agreement terms and percentages are recorded separately from legal ownership and accounting calculations.

## Documents

Each company has its own named folders. Create/rename folders, upload into the selected folder or move originals using the file's Folder menu. Folder membership never changes document category, original bytes or access. Company folders cannot contain another company's documents or property-specific title-file documents. Existing company document categories and material approval workflows remain available.

## John's applications

An application worksheet maps named fields to saved company/owner/representative facts. Choose the intended owner and representative, save the mapping, and download an unsigned preparation sheet. Missing values are marked; text is escaped. The sheet does not sign, submit or represent completion of an official form. Exact current state, insurance and underwriter application templates must still be supplied for direct form-specific PDF placement.

## Persistence and access

Logos, folders, renewals and stable member IDs use the existing workspace command and snapshot system. Private EINs, owners, agreements and worksheet mappings use an optional `companyRecords` extension inside the existing Supabase Vault encrypted JV envelope. They are not put in the general workspace, audit text, assistant context, applicant portal or ordinary JSON exports. Existing privileged database recovery procedures apply to the encrypted records; ordinary workspace JSON is not a private-record backup.

Private access requires the existing restricted owner/admin/onboarding company permission. Saves retain compare-and-swap version checks and workspace/member locking. Legacy applications without the extension remain readable. Older clients cannot remove newly saved private records by omitting the extension. Sources remain bound to their company, access, document purpose and asset/version. Missing members after an older workspace restore invalidate reviewed status and can be reconciled without deleting original documents.

Underwriter changes invalidate application, underwriter approval and launch evidence while retaining independent confirmation that a company is already operating. Unchanged selections do not invalidate review. A company with no selected underwriters remains unselected when other details change; launch still requires a selection and matching authority evidence.

## Verification

`npm --prefix web run test:company-workspace` exercises the domain, server command round trips and real browser components using fictional records. The JV and recipient-portal SQL runners exercise real temporary PostgreSQL transactions, source invalidation, access races, encrypted-envelope retention and recipient exclusions. Their local Vault fixture verifies transaction behavior; it does not independently certify Supabase's encryption implementation.
