# Document package review

The package reader processes uploaded originals into source-cited suggestions. It prepares a review; it does not issue a title opinion, decide lien priority, approve coverage, write SoftPro records, or send correspondence.

## Staff workflow

1. Upload originals to the correct company and title file. In **Final sources**, choose **Read document package**. Company document collections offer the same review for onboarding evidence.
2. Select the originals together, open the saved review, and start reading. PDFs use their embedded text when suitable; scanned and mixed pages use local OCR. Original bytes remain unchanged.
3. Review unread pages and conflicting values. Each candidate carries its document, version, physical page, literal quote, and reading method. Compare opens the cited physical page; the original preview also offers a bounded page-number jump. Accept, correct with an explanation, or reject it.
4. Use reviewed title fields to open the existing capture form. Confirm its source reference and save deliberately. Captured fields still require the normal title-file review. Company suggestions likewise require a deliberate profile edit; ownership and onboarding are not approved by extraction.

Replies remain drafts inside Title Software. Missive directory discovery and reviewed imports use read requests. Sending remains disabled until a separate transport and delivery-verification rollout is completed. QuickBooks/accounting and direct SoftPro automation remain later phases.

## Supported extraction

The deterministic reader recognizes supported explicit wording and labels for deed vesting, dated versus recorded dates, recording times and references, trustee and principal loan amounts. It also prepares company legal-name/EIN/formation/contact/member wording, property address/county/parcel/legal-description evidence, title-opinion attorney, and policy metadata. Policy-jacket detection does not establish that a policy is the applicable prior policy. Exhibit pointers, missing text, uncertain OCR, conflicting instruments, and unsupported layouts require review or manual capture.

Matching a name or dollar amount alone is insufficient. Purchase prices and fees must not become loan amounts; a notary's county must not become the property county. Multiple candidate values remain visible. No ownership percentages, parties, addresses, or missing dates are invented.

## Bounded processing and persistence

- At most **1,000 physical pages, 100 originals, 25 MB per original, 500 MB total**, and five million retained text characters per package.
- The reader processes ten-page windows and renders OCR pages individually. Oversized or unread pages are flagged, not silently truncated. The older single-document text viewer retains its 120-page limit.
- Keep the review open during scanning. Completed batches save to the private backend; reopening the same originals resumes confirmed progress. A lost save acknowledgement requires reopening to recover the server's confirmed state.
- Checkpoints contain hashes and metadata; page text is stored separately in the private review record, not browser local storage. Source identity includes asset hash, document version, scope, role and visibility.
- Saved reviews belong to their operator. Access and source identity are checked again on every load/save. Removed access, replaced originals, or concurrent changes fail closed. The database saves page text and checkpoint in one transaction.
- Reading additional pages clears earlier field decisions so new conflicts receive a fresh review. Empty progress updates preserve decisions. Decisions record the authenticated reviewer, timestamp, correction, note and evidence.

OCR text and page manifests are client-produced evidence, not server attestation of document authenticity. Server checks establish consistent stored bytes/metadata/receipts and authorization, not that an OCR transcription is legally correct.

## Missive company intake

An organization administrator can load the verified Missive team-inbox directory, select clear company identities, review duplicate matches, and create incomplete profiles. Inbox names are unverified company display names. Contact details, operating/formation states, members, ownership and documents remain blank until supplied and reviewed. No inbox routing or Missive records change during company creation. The source identity is immutable, and the same inbox cannot create a second profile.

## Verification and calibration

Automated coverage includes real 500-page and split 1,000-page PDFs; OCR on physical page 500; late-page conflicts; cancellation, failed saves and reload; PostgreSQL JSONB serialization; stale originals and access; source-bound capture; provider read-only behavior; and SQL concurrency, atomicity and browser-role denials. Run `npm run test:package`, `npm run test:packages:sql`, `npm run test:company-intake`, `npm run test:extraction`, and `npm run test:api` in `web`.

Synthetic fixtures establish regression behavior, not accuracy across the family's actual forms. Tyler and Stephenie should review representative originals, including scans, combined packages and unusual wording, using the private upload workflow. Their accepted/corrected/rejected evidence can support a measured accuracy benchmark. Uploading documents does not automatically train a model, and no perfect OCR accuracy is claimed.

## Release verification — September 23, 2026

Release `0bb9312` passed the following checks. Counts describe separate suites and should not be added together as a unique-test total.

| Check | Result | Evidence covered |
| --- | --- | --- |
| Package reader, backend, intelligence and integration | 45 passed | Real 500-page and split 1,000-page PDFs; late-page field citations; atomic-save failures and lost acknowledgements; cancel/reload/retry; source and access changes; JSONB object-key reordering through open, save, resume and candidate review. |
| Field extraction and existing source reader | 86 passed | Supported title wording, conflicting values and source-bound capture; real scanned, mixed and selectable-footer PDFs; explicit unread-page outcomes. |
| PDF parsing and local OCR | 23 PDF and 19 OCR passed | Bounded page windows, parser cleanup and limits; actual OCR of physical page 500; orientation, cancellation and no third-party OCR requests. |
| Package review UI | 9 passed | Explicit comparison before acceptance, saved decisions after reload, corrected capture, conflicting values, failed saves, access revocation, 390px layout and keyboard navigation. |
| Company intake | 23 passed | Incomplete profiles without invented facts, duplicate review, immutable Missive attribution, deliberate company prefill and access changes. |
| Broader regressions | 302 API, 221 domain and 20 daily-use UI passed | Existing authorization, provider boundaries and business workflow behavior. |
| Build checks | Passed | TypeScript, strict lint with no warnings, production build and Cloudflare deployment dry-run. |

These checks use fictional documents and controlled test data. They verify the tested behavior and failure handling; they do not measure extraction accuracy on Tyler's or Stephenie's actual searches, finals, policies or onboarding packets. Representative real-form evaluation and correction review remain necessary before relying on unfamiliar layouts.

### Hosted pilot verification

The ordinary hosted owner session uploaded a fictional 30-page PDF to the existing test-only company. The hosted reader saved all 30 physical pages and cited the company name/contact email on page 1 and employer identification number on page 30. After comparing the rendered original, an accepted company-name decision was saved with a review note. A full browser reload restored all 30 pages and the decision; retrying an already-complete package preserved that decision.

Downloading the original returned all 14,446 bytes unchanged, with SHA-256 `c2a55448072d4e61c8bf7b01fefd877cf9e391bb72e9710be6e1695680787be5`. A read-only database check independently confirmed 30 saved pages, a complete checkpoint and the saved review. The browser had no warning or error logs during this flow. The file remains clearly labeled fictional and was not applied to a real company profile.

Missive directory verification succeeded in the hosted workspace. The reviewed import created 21 incomplete company profiles while skipping the existing base company. No owner, operating state, contact or ownership data was inferred, no inbox routes were activated, and no Missive messages or drafts were written.

Hosted testing exposed an unsupported `Contact name` label on a company application. A follow-up adds that exact alias while preserving the document-role requirement; regression tests prove it is ignored on deeds and unrelated text. The package suite passes 46 tests after this change. Extraction accuracy on actual family documents remains unmeasured.

The same follow-up passes physical-page targets through the package comparison workflow and adds direct PDF page navigation. Eight preview tests use actual PDFs, including a 1,000-page original, to check page 30/750/1,000, invalid requests, unavailable-page recovery, source replacement, one-page rendering, worker/URL cleanup and phone layouts. Nine package UI tests, seven document-storage UI tests and thirteen final-source capture UI tests pass. Independent review found no blocker in source/access identity handling. Typecheck, zero-warning lint, production build and deployment dry-run pass.
