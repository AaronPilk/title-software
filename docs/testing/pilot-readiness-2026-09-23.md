# Pilot readiness and reviewed extraction — September 23, 2026

The September 22 access, preview/restore, input-limit and dependency fixes were rechecked. This change adds reviewed document-to-field suggestions and an independent originals archive, fixes a newly reproduced source-evidence deletion bypass, and makes zero-warning lint a release gate. SoftPro is deferred at the owner's request; no vendor connector, outgoing mail or staff permission change is part of this release.

## Requested checklist

| Item | Evidence and remaining boundary |
| --- | --- |
| 1. ACCESS-01 / ACCESS-02, all scopes and legacy approvals | Existing fixes and persistent actual-handler regressions pass again. Company-scoped finance/admin cannot read workspace-wide snapshots or mutate global configuration/accounting mappings; legacy approval inputs are covered. New capture-evidence checks reject deletion as well as replacement, including omitted legacy source fields. |
| 2. Preview/restore, email conversion, streaming limits | Existing bounded rendered-PDF preview, validated local restore/rollback/Undo, forward-only email conversion and actual streaming-byte limits pass. Independent originals archives now include bytes and bound manifest checksums; recovery does not trust an archive to overwrite hosted records. |
| 3. Dependencies in a separate compatible change | Already isolated in commit `58fab50`. Fresh September 23 audits report zero vulnerabilities for web and assistant. No dependency or lockfile change was needed in this follow-up. Production builds pass against those versions. |
| 4. Adversarial, suites/build and lint | Affected denial/input regressions, extraction provenance/staleness tests and corrupt/oversized archive cases pass with safe behavior expected. Full suite/build results are below. Lint is now zero errors and zero warnings, enforced with `--max-warnings 0`. |
| 5. Hosted owner/staff and original recovery | Actual application UI/API/SQL tests cover scoped denial, upload/download and setup with fictional transports. Independent recovery reproduces unavailable storage and returns byte-identical readable originals. **Fresh ordinary signed-in hosted owner/staff acceptance and the hosted original-file recovery drill remain pending.** The pilot is at the Cloudflare login screen; no identity bypass, invented staff acceptance or production-object deletion was used. |

## New behavior and regression coverage

- Source suggestions read actual original bytes using same-origin PDF.js/Tesseract assets. The parser suggests only bounded, explicitly labelled existing deed/security fields, preserving exact quotes and physical pages. Ambiguous or weak-OCR candidates are excluded from bulk filling. No provider receives OCR document bytes, and no upload automatically trains a model.
- Capture requires the user to review the original. Edits clear the review acknowledgement; document/file changes reject stale saves; cancellation and workspace/account changes cannot install stale results. Saved fields retain source version, original suggestion and correction evidence, and remain unapproved.
- A final security review reproduced an omission bypass in generic field edits: comparing only submitted keys permitted removal of stored evidence. Validation now checks the union of stored and submitted keys. Regression tests cover omitted/replaced capture evidence, omitted legacy source fields and cross-company denial.
- A 390-pixel browser check caught native recovery selectors expanding their grid and clipping guidance. Controls now shrink within the panel; a persistent test loads production CSS and checks controls, warnings and instructions for overflow.
- The Recovery panel creates a bounded independent archive of authorized originals, references and SHA-256 checksums. Missing originals are explicit. Verification rejects corruption, changed bindings, duplicates and oversized input before offering recovery. Recovery downloads a verified original without requiring the source server object or modifying hosted records. Checksums establish archive integrity, not trusted authorship or malware safety.

## Verification

| Check | Result |
| --- | --- |
| Domain | 221 passed |
| Backend and actual API handler | 112 + 212 passed |
| Missive | 86 passed |
| PDF text, workflow, assistant and OCR | 13 + 34 + 17 + 18 passed |
| Auth, members, Missive settings, refresh and workspace views | 8 + 33 + 11 + 9 + 39 passed |
| Daily-use UI and staff assignment | 32 + 18 passed |
| Document, backup/preview and review UI | 7 + 19 + 14 passed |
| Field extraction, actual scan reader, provenance and capture UI | 61 passed |
| Independent original-file recovery UI | 8 passed |
| Locally served production pilot, including desktop/mobile sign-in | 5 passed |
| **Automated application total** | **977 passed** |
| Disposable PostgreSQL | 1,317 explicitly counted assertions, 18 concurrency scenarios, plus repeated routing/credential/pause scenarios |
| Web typecheck, API bundle, standard and pilot builds, deployment dry run | Passed |
| Lint | Zero errors, zero warnings |
| Dependency audits | Both zero vulnerabilities |

The member UI suite initially failed because its synthetic module fixture lacked newly imported download exports. The fixture was corrected and all 33 tests passed on rerun. That failure and its correction are retained in private evidence. No failing assertions were discarded or skipped.

The scan-reader suite includes generated fictional PNG and scanned-PDF originals through real PDF.js and Tesseract, with exact source/page checks and unchanged bytes. Other browser tests use controlled readers/transports to exercise rejection paths deterministically. SQL tests use disposable native PostgreSQL and synthetic Auth/Vault interfaces; they do not establish hosted Auth behavior or Vault encryption. Test counts are measured checks, not a claim of perfect extraction or a security certification.

Private logs and reproductions are in ignored `.local/coordination/pilot-readiness-2026-09-23/`. Real client originals, credentials and invitation details are excluded from Git. See [review instructions](../document-field-review.md) and [the original-file recovery drill](../private-pilot-uploads.md).

Repeat extraction with `npm run test:extraction`. Build first with `npm run build:pilot`, then run `npm run test:originals:ui` for byte recovery and the production-CSS mobile regression. The tests do not rebuild a running app.

## Release readback

Code commit `47debec` is on GitHub `main`. No database migration was needed.

- Frontend Worker `5c0478db-1d5b-4dee-82fa-5e623d24231a`, 100% traffic. The final built artifact passed all five production response-policy and desktop/mobile sign-in checks after the mobile fix.
- `title-api` version **16**, JWT verification enabled. Downloaded deployed source exactly matches the tested 380,923-byte bundle: SHA-256 `4580b8d764a19a6e6c545ee1ad90d9a8c7f526db7593a57f96fc6e313eeb6842`.
- The private assistant and event receiver were not changed. Cloudflare Access still covers the pilot hostname and Worker destination, with the same seven-email allow list and eight-hour app session. Preview URLs are disabled. Query strings remain redacted and automatic invocation logs disabled.
- All **16 hosted unauthenticated perimeter checks** returned the expected denied/protected responses after deployment, including current client assets, API paths and fake-token/hostile-origin requests. These are not a substitute for authenticated staff isolation checks.
- The fresh Supabase security advisor has no warning/error findings and 13 informational [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the intentionally server-only tables. No browser table policy was opened.
- The staged source scan found no secrets. The final compiled-client scan's sole finding exactly matched the configured public Supabase publishable key; no privileged credential was identified.

## Remaining acceptance

1. Owner completes ordinary Cloudflare and app sign-in. Walk company creation and a fictional original upload/reload/download in that session.
2. Review the intended staff role and company scope, renew expired access as needed, and have staff complete personal password/authenticator setup. Verify that a scoped staff account cannot see or download a different company's file through the UI and API.
3. Export a required original through **Settings → Recovery → Independent original files**, verify the downloaded archive, recover and open a representative original, and compare its bytes/hash with the upload. Resolve every required missing-original entry before bulk import. Keep the approved independent copies.
4. Start real document feedback with a small representative completed case and staff-reviewed expected values. Establish a private accuracy set before expanding layouts or reducing manual review. Scanning/quarantine, retention and operational recovery ownership still need decisions before broad untrusted intake or archive replacement.
