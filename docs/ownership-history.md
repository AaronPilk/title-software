# Effective-dated ownership history

Closes the S09 gap: member interests that change over time, with a record of
when, so a monthly close allocates on the ownership that was in effect for
that period rather than the ownership that happens to be on file today.

## The problem it fixes

A company's `members` array is ownership **as it stands now**. A close for
April run in September was previously allocated on September's shares. If a
member was admitted in May, April's profit was split on a cap table that did
not exist in April.

## How it works

- Records are append-only snapshots of the **whole member set**, each
  effective from a stated date. The first record for a company is its
  *opening* position; every later one is a *change*.
- `ownershipAsOf(s, company, date)` returns the record in effect on that date.
  `ownershipForMonth(s, company, month)` asks about the **last day of the
  reporting month** — that is the position a monthly close allocates on.
- `newClose` captures those members and stores `ownershipSource` (the record
  id and its effective date) on the close, so every published close says which
  ownership governed it. The close screen prints that line.
- `closeFingerprint` resolves ownership the same way. Editing current members
  therefore no longer disturbs a close governed by an earlier dated record —
  but recording a new record that changes *which* record governs the month
  does invalidate it, exactly as a source change should.

## Nothing is guessed

- With **no dated records at all**, behaviour is unchanged from before this
  feature: current members govern, and editing them invalidates the close. The
  UI says so rather than implying dated history exists.
- For a date **before the opening record**, ownership is reported as not on
  record and falls back to current members visibly (`source: "current"`,
  `beforeHistory: true`). The app does not invent what the shares used to be.

## Refresh resolves the same way

`refreshClose` resolves ownership through `ownershipForMonth` exactly as
`newClose` does, and writes the members, the `ownershipSource` and the hash
from that one resolution. An earlier version copied `c.members` here while the
hash resolved the historical record, so a refreshed historical draft silently
held today's ownership behind a hash claiming it was current — and review and
publication then accepted it. Codex found this in QA on 2026-09-14 by driving
the sequence through to publication (`$100/$900` published where `$300/$700`
was owed). Any future writer of a close snapshot must take members and
provenance from a single resolution, never from `c.members` directly.

## Rules

- One record per company per effective date; a change cannot pre-date the
  opening record; every record totals 100 percent with unique, positive
  member interests; effective dates cannot be in the future.
- Records are **evidence a close was allocated against**: they are never
  edited in place and never removed. A correction is a new record with a later
  effective date, or a corrected opening record — never a rewrite.
- `ownershipDrift(s)` reports published closes whose month is now governed by
  a different dated record than the one they were published on. It **reports
  only**. A published allocation stays frozen; changing one is a reviewed
  close revision, which is a human decision.

## Still outside this

The approved agreements themselves. A record here says what the interests
were and why, in the operator's words; it is not the operating agreement, a
transfer instrument, or an approval workflow. Per-period member admission and
withdrawal evidence, and any tax-basis or capital-account treatment, need
John's actual inputs.

## Code

| Path | Responsibility |
| --- | --- |
| `web/lib/title/ownership-history.ts` | Records, date resolution, drift reporting and `validateOwnershipMutation` |
| `web/lib/title/business.ts` | `closeFingerprint` and `newClose` resolve ownership by month |
| `web/components/title/ownership.tsx` | The history panel under the company member editor |
| `web/components/title/close-suite.tsx` | The governing-ownership line on the close |
| `web/tests/ownership-history.test.mjs` | Domain, close-integration and invariant regressions |
