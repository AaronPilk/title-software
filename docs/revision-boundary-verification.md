# Revision boundary verification

Verified locally on 2026-09-12 UTC, following the field-revision and multi-loan work in `c7c6b0c` and `4bfeb3e`.

## Corrected behavior

- A lender revision captured on a financed file cannot be refreshed or applied after the file becomes cash. Both operations reject before mutating the workspace. Other supported changes, such as county corrections, remain available on cash files.
- Every applied field or loan-amount revision clears the previous final commitment approval. Advancing the file version alone did not invalidate the final-review snapshot for lender, seller, legal description, attorney, attorney email, or product-only multi-loan changes. Those changes could therefore leave final readiness true with an old approval.
- Field and multi-loan revisions preserve captured source-document values and reviews. Multi-loan revisions preserve the shared loan amount and every other loan product. A new commitment review is required before final preparation can resume.

## Evidence

`web/tests/revision-boundaries.test.mjs` contains ten regression cases: two cash-lender rejection paths, a permitted cash county correction, all six revisable fields, and a product-only multi-loan change. Rejected actions are checked for full workspace immutability. Applied changes are checked through the same business mutation validator used by the application, including retained source evidence and readiness returning only after an explicit new review.

Before the fix, nine of these ten tests failed. After the fix, all ten pass. One existing field-revision assertion was updated to expect the old commitment approval to be cleared; its unchanged-field and loan-product assertions remain intact.

An independent read-only review also checked that final policy preparation and issuance reject the revised, unreviewed file, and that both revision types reject changes before mutation when a sibling policy is already issued or delivered.

Verification on the revision branch based on `4bfeb3e`: 99/99 domain tests, TypeScript checking and production build passed. This record covers domain and build verification; no new browser pass was performed for this patch.

The fixes affect local MVP state only. No external title, underwriter, email or accounting systems are called.
