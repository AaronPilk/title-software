# Workflow debugging and product comparison — September 22, 2026

Application commit: `e22ad58`. Pushed to GitHub `main` and deployed to the existing private pilot.

Frontend Worker version: `64e9b208-ee0d-4a10-a3a8-3801bb828c5f` (100% traffic, deployment `5128e4e3-f2fe-4f6a-b8e5-b49b591f2880`). The API, assistant, database and credentials were not changed by this frontend release.

## Six corrected workflow defects

| Defect | Result after the fix |
| --- | --- |
| Capturing fields from a replacement attachment could prefill values read from another attachment and relabel their source. | A different source starts blank; recapturing the same source keeps its values. Required input must be provided before saving. This guard is by document ID, not an added document-version field. |
| A source excerpt's selected parent could disappear before save and silently become a standalone excerpt. | The save fails with an actionable message and the form remains open. |
| Source excerpts used the UTC date rather than the business date. | They use the shared Eastern business calendar, including across midnight UTC. |
| During an OCR rerun, old text could be acknowledged while processing and leave replacement text marked reviewed. | OCR copying/confirmation are disabled while processing; replacement output clears confirmation and selection. Cancellation rejects late results. |
| The month selected for a financial report differed from the independent month in Company closes. | Both views and report exports share the selected month. |
| Financial review checkboxes could remain checked after premiums, expenses or ownership changed. | Checkboxes apply to the exact report fingerprint. Changed figures need fresh review; an unchanged refresh preserves it. |

Source-intake copy now points to the implemented document reader/OCR. It no longer says OCR is disconnected. Private acceptance guidance permits owner-authorized originals; public test fixtures remain fictional.

## Verification performed for this release

**908 automated checks passed:** 903 across the application suites and five against the locally served production pilot build. The 903 include 14 new actual-component browser regressions: four source-capture, three OCR-review and seven financial-review cases.

The broader run covers domain rules, backend commands, actual API handlers, Missive workflows/settings, PDF extraction, real browser OCR, assistant logic, authentication setup, member management, workspace refresh, Agency/Production views, daily use, staff assignment, documents and backup/preview flows. Tests use fictional state and synthetic authentication/storage/provider transports where specified. The new OCR-review tests control recognition completion to reproduce the race; the separate existing OCR suite executes the real OCR engine.

TypeScript, both Edge bundle builds, standard and pilot production builds, deployment dry-run and staged secret scan passed. Lint: **0 errors, 33 existing warnings**. Production checks cover response security policy, desktop/mobile sign-in hydration, runtime errors and horizontal overflow. These are local production-build checks, not a signed-in hosted staff acceptance test.

No SQL/schema or dependency changes were made. The previous security release's SQL assertion and dependency-audit results are recorded in [its own report](security-remediation-2026-09-22.md), not counted as newly run here.

After deployment, the current Worker version and protection settings were read back: preview URLs remain disabled, query strings are redacted from observability, invocation logging remains off, and the existing seven-email Access allow policy remains in place. The Access application still covers both hostname and Worker with an eight-hour session.

All **16 anonymous hosted perimeter checks passed** after deployment: protected app/static paths, API requests without valid authentication, unsigned event intake and the disabled direct assistant hostname. No real messages, customer documents or business records were changed.

## Research and remaining acceptance

The [market comparison](../research/product-comparison-2026-09-22.md) checks six relevant products against official sources and implemented capabilities. It distinguishes Qualia's separate products from independent vendors and corrects stale implementation summaries. Vendor accounts were not tested, and no relative UX, accuracy or ROI winner is claimed.

Still needed: a signed-in owner/non-owner walkthrough with the intended company scopes, a staff-reviewed original-document workflow, actual Missive configuration acceptance and supported SoftPro integration access. This release does not establish a live SoftPro reader/writer, automatic legal-field extraction, trust accounting or underwriter policy issuance.

Run the new regressions with `npm run test:review:ui` from `web`. Run `npm run test:pilot:security` against a locally served `build:pilot` on port 5189. Neither command should target real business records.
