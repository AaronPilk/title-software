# Statement delivery register (J05)

Implemented September 12, 2026 as a split build: Codex owns the domain module (`web/lib/title/statement-delivery.ts`), the optional `Workspace.statementDeliveries` state, its mutation/restore validation and dedicated tests; Claude owns the UI (`web/components/title/statement-deliveries.tsx`, wired into the internal close workspace in `close-suite.tsx`) and this documentation. The shared typed contract lived in `.local/coordination/statement-delivery-contract.md` while the halves were built in parallel.

Requirement: J05 in the [traceability matrix](discovery/all-transcript-traceability.md) (Tyler 62:26–62:44) — knowing which member statement went to whom, and when. The state design below is an engineering choice, not a quoted transcript schema.

## What it is, and what it is not

A **register of manual deliveries**. The app never sends an email or a file anywhere. An operator records that they delivered a published member statement by hand — the date, a piece of evidence (a receipt, tracking number, meeting), and a note — and that record is frozen against the exact revision figures it was prepared from.

**Exporting is not delivering.** "Download statement text" produces the plain-text statement for a record so it can be delivered by whatever means the business uses; it never marks anything delivered. Recording the actual delivery is a separate, explicit step.

## Local workflow

1. In **Financials → Company closes**, select a company and month, and a revision whose status is **Published**. The **Statement delivery register** section appears below the ownership snapshot for every revision; only a Published revision offers the preparation form.
2. **Prepare a delivery record**: choose the member statement (from the revision's captured allocations — only members with a captured allocation can be chosen), enter the recipient's name and email, write a review note, tick the explicit review confirmation, and prepare. The record freezes the company, month, revision, member, share, amount, published date and reviewer as of that moment, and stores who prepared it and when. Changing the recipient afterward means cancelling and preparing a new record.
3. **Download statement text** for a current Prepared record (or a Recorded one) and deliver it by hand. The text contains only that member's statement — no other member's allocation or contact data.
4. **Record the actual delivery** on a current Prepared record: delivery date (from the preparation date through today), an evidence reference and a note. The record becomes **Recorded** with the operator and time captured. Recording the identical completion again is a no-op; different details are rejected.
5. **Cancel** a Prepared record (including a stale one) with a reason. Cancelled records stay in the register as history.

## States

- **Prepared** — frozen, current, can be exported and recorded.
- **Recorded** — delivered; keeps its frozen figures and delivery evidence; can still be exported as a historical copy even after the revision is withdrawn or superseded.
- **Source changed** — a Prepared record whose published statement no longer matches what it froze (the revision was withdrawn, superseded or re-reviewed). It cannot be exported or recorded as delivered; it can only be cancelled. New drafts alone do not make a record stale.
- **Cancelled** — kept for history; cannot be exported or recorded.

Records prepared against a revision that is later withdrawn or superseded remain listed under that revision in the close workspace, so the history of what was delivered from each revision is never lost.

## Preservation

`Workspace.statementDeliveries` is optional and defaults through its accessor; a workspace saved before the feature simply has none. Full backup/restore includes it, and restore validates its shape the same way the other optional modules are validated. Partner portal downloads are unchanged.

## Verification

See the dated entry in [implementation coverage](implementation-coverage.md) for the combined verification record (domain suite, typecheck, production build and the real-browser pass through prepare → download → record, and the stale → cancel path).
