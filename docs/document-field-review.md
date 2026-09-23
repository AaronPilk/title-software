# Reviewing document-to-field suggestions

The pilot can suggest the existing deed and security-instrument source fields from selectable PDF text, scanned PDFs and PNG/JPEG originals. Suggestions preserve the source wording and physical page. A person checks the original before saving; the separate final-review and policy gates still apply. Uploading examples does not automatically train a model.

## First representative file

1. Sign in with your own account and authenticator. Use the assigned company in Production and select the correct file. Start with one completed case whose expected result your team already knows.
2. Attach the original deed and security instrument, or the combined final package, using its correct source type. Keep the existing originals. Private authorized examples do not need blanket redaction; do not put client records in GitHub or public feedback.
3. In the file's final-source section, choose **Capture fields**, then **Find field suggestions**. Open the original beside the suggestions. The current fields cover grantee/name; deed date, recording date/time and book/page; loan amount; security-instrument date, recording date/time and book/page; and trustee, as applicable to the selected source.
4. Inspect the quote and page for each proposed value. **Fill unambiguous suggestions for review** fills only a single, unambiguous candidate. Multiple candidates and weak OCR need individual selection or manual transcription. A confidence score describes the OCR engine's output; it is not a guarantee of accuracy.
5. For scans, the automatic run reads up to six pages without selectable text. Unread pages are listed. Use the physical-page selection and orientation controls to read another relevant group of up to six pages. Review the full source, including pages the tool did not read. A subsequent run replaces the displayed suggestions; already entered form values remain available to review.
6. Correct the captured wording if needed. Suggested wording, its quote, source version and page are retained alongside the correction. Confirm that every captured value was compared with the original, then save. Changing a value clears this acknowledgement. Saving captures proposed fields for review; it does not approve a policy, update SoftPro or silently change the order's borrower or loan.
7. If the source, file, company or workspace changes during review, reopen capture against the current version. Old suggestions must not be applied to new records.

The separate **Documents → Read document text** tool remains available for selectable text or a single scanned page. Its reviewed copy workflow does not by itself populate business fields. Missing original bytes are an error, not permission to use an old stored excerpt instead.

## Build an acceptance set

Have the reviewer retain the source, company/file/version, expected field value and page, the suggested value, their correction and whether any source wording was missed. Include different document layouts, multiple loans, combined packages, conflicting values, poor scans and handwritten material. Keep this set in the private workspace or approved private validation storage. Use fictional equivalents for automated regression tests.

Measure correct suggestions, missing suggestions and incorrect suggestions separately. Confirm critical fields against the original on every case. Real representative documents are still needed to evaluate accuracy across Ballantyne's forms; the automated fictional scan tests do not establish that accuracy. This release does not interpret arbitrary legal descriptions, validate signatures, read handwriting reliably, or produce insurer-issued policies.

SoftPro integration is deferred at the owner's request until supported vendor access is available. The current review workflow is usable without it.

## Recovery before bulk import

Complete the independent original-file recovery drill in [the upload guide](private-pilot-uploads.md) before importing a bulk archive. A successful metadata recovery-point operation alone does not prove that original document bytes can be recovered.
