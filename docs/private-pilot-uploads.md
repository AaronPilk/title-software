# Company and original-document pilot

The connected private workspace accepts authorized original company documents, policies and finals. Redaction is not a prerequisite for private workflow review. Start with one company's documents and one representative completed file, verify that upload, access and retrieval work, and then continue building the portfolio.

## Company setup and upload

1. Complete personal sign-in, password and authenticator setup. The owner assigns company-management and document permissions before the walkthrough.
2. In Agency, open Companies and use Add company. Check the legal company name, state and possible duplicates before saving.
3. Open Documents, choose Upload, select the correct Company and use Company documents only for company-level records. Choose the category and appropriate visibility. Restricted records require restricted access.
4. Upload original PDF, TXT, CSV, PNG or JPG files. The current screen accepts up to 10 files, 25 MB per file and 100 MB per batch. ZIP, Word, Excel and TIFF are not accepted by this form; retain originals and provide a supported export where needed.
5. Confirm the saved record, reload, and open or download one file to check the original. File-specific finals and policy documents should be linked to the correct order, with the appropriate source type. Upload does not itself issue a policy or modify SoftPro.
6. Report the screen, what was attempted, expected result and confusing step. Keep client-bearing screenshots and examples in the private review channel or local private-validation folder.

The minimum existing company-onboarding role is onboarding with all-company scope. Restricted access is a separate grant required for applications/evidence and Restricted documents. This role can view Production but does not permit production mutations. Broader administration/production permissions are a separate owner decision; choosing Agency never changes authority.

## Original files and validation

Connected uploads preserve original bytes in private hosted storage, store hashes and use versioned asset records. Download access checks the current company and document permissions. Browser-local sample mode has different persistence and must not be presented as the connected workspace.

PDF text review and supported OCR run in the browser and leave originals unchanged. They help compare a real source with the team's reviewed expected outcome. The final-source capture form now suggests explicitly labelled deed and security-instrument fields, retains quotes/pages and corrections, and requires original-source review before saving. See [document field review](document-field-review.md) for its supported fields, scan limits and acceptance workflow. Preserve the input set, source-to-field/page references, revision sequence and actual final outcome when evaluating a representative case.

An upload does not automatically provide document bytes or OCR text to the in-app assistant. Assistant questions, conversation history and permitted structured workspace context do use the hosted AI service. Avoid promising that no information leaves the browser.

Keep the company's existing originals during the pilot. Hosted metadata recovery points depend on the source storage objects; the separate **Settings → Recovery → Independent original files** archive includes original bytes and checksums. No live vendor execution or archival replacement is implied by either workflow.

## Independent original-file recovery drill

1. After a fictional or authorized representative upload, confirm its company/file/version and download the original. Keep the input as the comparison copy.
2. As an organization-wide administrator, open **Settings → Recovery → Independent original files**. Select that document or all originals available to the account, then choose **Export original files archive**. Store the resulting archive in the approved independent backup location.
3. Check the result for missing originals. A partial archive is explicitly incomplete; resolve every required missing item before bulk import.
4. Select the downloaded archive in the recovery panel. Verification checks its manifest, bounds, file signatures and SHA-256 checksums. Select an original and choose **Download recovered original**. Open it and compare its bytes/hash with the upload. Recovery reads the archive's bytes without requiring the original hosted storage object; do not delete production objects to test this.
5. Record the tested company/file/version, successful comparison and where the independent copy is retained. Repeat for representative file types and retain the originals until the team's recovery and retention procedure is accepted.

Archives are limited to 2,000 references, 64 MiB decoded originals in total, 50 MiB per original and 96 MiB serialized JSON. Larger collections need separate exports. These archives recover original-file downloads; they do not overwrite hosted metadata, repair document links, authenticate the archive's author or scan for malware. Local demo full-backup restore is a different operation and remains disabled for connected workspaces.

## Engineering evidence

Store authorized real source files, excerpts, screenshots and expected outputs only in ignored `.local/private-validation/` or the permitted private workspace. Never commit them as public test fixtures or logs. Use synthetic equivalents for GitHub regression tests. Generated client artifacts in root `output/` and `tmp/` are ignored as well.

Real acceptance remains separate from mocked transport tests: verify the intended person's sign-in, assigned company controls, original-file round trip and another account's denied access. This guide does not claim Stephenie's account has completed that check.
