# Whole-document scanning and Liquid Glass verification — September 23, 2026

Released code: `35fd467`. Frontend deployment:
`b68b59d8-c937-4588-b395-96205bdbf15c`, verified at 100%.

## Delivered behavior

PDF reading now covers the complete document, including scanned pages, up to
120 pages and 25 MB. The reader processes scanned pages sequentially, shows
progress, retains completed pages during the open review, and supports cancel,
resume, unread-page retry and deliberate page rereads with rotation. One failed
page does not discard the rest. Field suggestions combine page evidence and
preserve conflicting values for deliberate review.

Documents → open an original → Read document text → Read whole document.
Production final sources → Capture fields → Find field suggestions uses the
same whole-document reader. Existing review and source-citation requirements
remain in place.

The interface now has translucent floating navigation, layered controls,
rounded dialogs and subtle highlights, while retaining Ballantyne branding and
solid document/form surfaces. It is a web interpretation informed by Apple's
[materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
and [Liquid Glass guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass),
not Apple's native material renderer. Reduced transparency, increased contrast,
forced colors and reduced motion have explicit fallbacks.

## Verification completed

| Check | Passing tests |
| --- | ---: |
| Domain suite | 221 |
| Extraction, source evidence, reader and capture UI | 79 |
| PDF reader | 19 |
| Local OCR | 18 |
| Document, final-source and financial review UI | 22 |
| Real whole-document browser flows | 2 |
| Liquid Glass app and control UI | 12 |
| Agency/Production workspace UI | 39 |
| Feedback client, HTTP and UI | 56 |
| Document storage UI | 7 |
| Original archive/recovery UI | 8 |
| Production headers and sign-in smoke | 5 |
| Hosted anonymous perimeter checks | 16 |

Full typecheck, zero-warning lint, pilot production build and deployment dry run
passed. Source secret scan passed. The client scan's single finding was checked
against configuration and is exactly the intentionally public Supabase
publishable key; no private key was found. No dependency versions changed.

The real PDF.js/Tesseract path read fictional 30-page all-scanned, mixed
text/scanned, and selectable-footer/scanned-body PDFs. Distinctive values on
page 30 were recovered. The actual React flows required review before copying
text or filling fields, retained page/version citations, and kept conflicting
page 1/page 30 loan values ambiguous. Original-file hashes remained unchanged.
The local OCR tests verified no external provider traffic or persistent browser
text storage.

Regression coverage includes cancelled initial indexing, partial results,
failed-page retry, forced reread invalidation, text/resource budgets, forged
resume snapshots, account/access changes, and source changes while reading.
Desktop, 390/320-pixel layouts and accessibility preference fallbacks passed.

The deployed application was opened in an ordinary authenticated owner browser
session. The new shell and the document-intelligence dialog's whole-document,
120-page/25-MB guidance were visually verified; browser warning/error logs were
empty. This hosted check was read-only. End-to-end scanning used local fictional
fixtures, not hosted client originals.

## Findings corrected before release

- A cancelled initial PDF index could incorrectly display zero of zero pages as
  ready. Completion now requires an explicit complete result and a known,
  consistent page count.
- A changed access revision or source visibility could reset the child reader
  while leaving its parent stuck in a reading state. Shared source/session
  identity now resets the entire capture consistently.
- A selectable footer could hide a scanned page body from OCR. Raster-bearing
  pages now receive OCR even when a text layer is present. Failed OCR does not
  silently promote a footer into a complete page result.
- The existing originals-recovery test needed to isolate an unrelated vendor
  settings import introduced in the preceding release. Its fixture was updated;
  all eight recovery UI checks then passed.

## Limits and release boundaries

Scanning runs locally in the open browser review. Resume state is in memory;
closing/reloading the review or switching source/account clears it. This is not
a durable background job. Existing 90-second per-page OCR timeouts and bounded
text/image budgets remain enforced. Unread pages are explicit.

OCR and suggestions still require comparison against originals. Printed English
fixtures establish functionality, not perfect accuracy on handwritten, unusual
or degraded title documents. Authorized representative originals are still
needed for accuracy measurement; uploading documents does not train a model.

This release changed no API, schema, memberships, credentials, authentication,
Cloudflare Access policy, or provider connection. `title-api` remains version 19;
the assistant is unchanged. No live emails, envelopes, accounting writes or
company/document mutations were performed. The full API and SQL suites were not
rerun for this frontend/reader change. SoftPro remains deferred.

Private command logs and fictional screenshots are retained under
`.local/coordination/whole-document-*2026-09-23*`. No private originals or
credentials are included in this report.
