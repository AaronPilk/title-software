# Document package review

The package reader processes uploaded originals into source-cited suggestions. It prepares a review; it does not issue a title opinion, decide lien priority, approve coverage, write SoftPro records, or send correspondence.

## Staff workflow

1. Upload originals to the correct company and title file. In **Final sources**, choose **Read document package**. Company document collections offer the same review for onboarding evidence.
2. Select the originals together, open the saved review, and start reading. PDFs use their embedded text when suitable; scanned and mixed pages use local OCR. Original bytes remain unchanged.
3. Review unread pages and conflicting values. Each candidate carries its document, version, physical page, literal quote, and reading method. Accept, correct with an explanation, or reject it.
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
