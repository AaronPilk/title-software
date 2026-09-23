# Reviewing document-to-field suggestions

The pilot can suggest the existing deed and security-instrument source fields from selectable PDF text, scanned PDFs and PNG/JPEG originals. Suggestions preserve the source wording and physical page. A person checks the original before saving; the separate final-review and policy gates still apply. Uploading examples does not automatically train a model.

## First representative file

1. Sign in with your own account and authenticator. Use the assigned company in Production and select the correct file. Start with one completed case whose expected result your team already knows.
2. Attach the original deed and security instrument, or the combined final package, using its correct source type. Keep the existing originals. Private authorized examples do not need blanket redaction; do not put client records in GitHub or public feedback.
3. In the file's final-source section, choose **Capture fields**, then **Find field suggestions**. Open the original beside the suggestions. The current fields cover grantee/name; deed date, recording date/time and book/page; loan amount; security-instrument date, recording date/time and book/page; and trustee, as applicable to the selected source.
4. Inspect the quote and page for each proposed value. **Fill unambiguous suggestions for review** fills only a single, unambiguous candidate. Multiple candidates and weak OCR need individual selection or manual transcription. A confidence score describes the OCR engine's output; it is not a guarantee of accuracy.
5. Leave the optional scanned-page selection blank to read the whole document. Selectable PDF text is read first, then scanned pages are read one at a time. Progress and combined page results stay visible. A failed or empty page is listed for review without discarding the other pages. Use **Cancel reading** to stop, then **Resume / retry unread pages** to continue while the same review remains open. To correct an orientation or reread specific physical pages, enter their numbers or ranges and the required rotation; the selected pages are replaced and the other pages are retained. Compare any previously filled form values with the updated source before saving.
6. Correct the captured wording if needed. Suggested wording, its quote, source version and page are retained alongside the correction. Confirm that every captured value was compared with the original, then save. Changing a value clears this acknowledgement. Saving captures proposed fields for review; it does not approve a policy, update SoftPro or silently change the order's borrower or loan.
7. If the source, file, company or workspace changes during review, reopen capture against the current version. Old suggestions must not be applied to new records.

The separate **Documents → Read document text → Read whole document** tool uses the same whole-document reader. Select a physical page to inspect its text, reread that page at another orientation, or copy a reviewed excerpt with its citation. Its reviewed copy workflow does not by itself populate business fields. Missing original bytes are an error, not permission to use an old stored excerpt instead.

## Scan limits and recovery

Whole-document reading supports PDFs up to 120 pages and 25 MB, subject to a combined 500,000-character limit. It processes one scanned page at a time, with the existing 90-second per-page timeout and bounded image rendering. PNG/JPEG originals remain one page. A page with no recognized text, an OCR error or a resource-limit failure stays explicitly unread; a blank page must be checked against the original too.

Completed page results are held in the current review's memory. Cancel/resume and retry do not require uploading or reading successful pages again. Closing the review, changing the source/version, switching account/workspace/access, or reloading clears this temporary scan session. This is not a durable server job and does not continue after the browser closes. Original uploads and separately saved reviewed fields remain unchanged.

Whole-document processing does not imply that every source value is correct. Conflicting values on later pages remain candidates requiring a choice. Pages that paint images as well as selectable text are sent through full-page OCR, so a page-number footer cannot cause a scanned body to be skipped. This conservative check can also run OCR on pages with logos. If image inspection or OCR fails, the affected page stays unread. Text-only pages use their selectable text; use a selected-page OCR reread if that text layer is incorrect. Review the original, including attachments and any content the OCR did not recognize.

## Build an acceptance set

Have the reviewer retain the source, company/file/version, expected field value and page, the suggested value, their correction and whether any source wording was missed. Include different document layouts, multiple loans, combined packages, conflicting values, poor scans and handwritten material. Keep this set in the private workspace or approved private validation storage. Use fictional equivalents for automated regression tests.

Measure correct suggestions, missing suggestions and incorrect suggestions separately. Confirm critical fields against the original on every case. Real representative documents are still needed to evaluate accuracy across Ballantyne's forms; the automated fictional scan tests do not establish that accuracy. This release does not interpret arbitrary legal descriptions, validate signatures, read handwriting reliably, or produce insurer-issued policies.

SoftPro integration is deferred at the owner's request until supported vendor access is available. The current review workflow is usable without it.

## Recovery before bulk import

Complete the independent original-file recovery drill in [the upload guide](private-pilot-uploads.md) before importing a bulk archive. A successful metadata recovery-point operation alone does not prove that original document bytes can be recovered.
