# Recipient delivery ledger

A per-recipient, per-document-version record of deliveries that a person
actually made. It closes the "broader per-recipient, per-document/version
delivery history for commitments, CPLs, finals, retries, and later recipients"
gap recorded in the [transcript recheck](transcript-recheck-2026-09-13.md).

The application still sends nothing. Every record here is entered by the
person who sent the document, after they sent it.

## What it covers

The register attaches to **any document on an order file** — a commitment
output, a final policy, a CPL, a correction output, or an ordinary source
document — so a single mechanism serves every document type rather than one
bespoke recipient field per product. It is reached from the document preview,
below the partner publication section.

It is additive. `deliverPolicy` still records the single recipient and
external reference that gates order completion; the ledger is the richer
history alongside it, and neither overwrites the other.

## Record lifecycle

| State | Meaning |
| --- | --- |
| Prepared | Reviewed and ready to send, bound to one exact document version |
| Recorded | A person delivered it and entered the date and evidence reference |
| Failed | It did not reach the recipient, with the reason and date |
| Cancelled | Abandoned with a reason; kept as history |
| Source changed | A Prepared record whose document has since been superseded |

## Rules

- **A download is not a delivery.** Exporting a document and recording that it
  reached someone are separate actions, and the UI says so.
- **One open preparation per recipient per document.** A second one for the
  same email address is refused until the first is recorded or cancelled; a
  different recipient on the same document is always allowed.
- **Preparation binds to the current version.** A delivery cannot be prepared
  from a superseded document, and a Prepared record whose document is later
  replaced becomes *Source changed*: it can no longer be recorded as
  delivered, only cancelled, because the recipient would otherwise be shown as
  holding a copy that is no longer current.
- **A retry is a new attempt, not an edit.** Only a Failed record can be
  retried. The retry is a fresh record linked to the failure it follows, with
  an incremented attempt number, and it binds to whichever version is current
  *at retry time* — which may not be the version the failed attempt carried.
- **History is kept.** Records are never deleted. Recorded, Failed and
  Cancelled are terminal; the document identity, attempt number, preparer and
  preparation time are frozen at preparation, and recorded evidence cannot be
  rewritten. These are enforced in `validateBusinessMutation`, so no UI path
  can bypass them.
- Recipient relationships and delivery methods are **suggested starting text**,
  not an approved taxonomy. The recipient's name and email carry the identity.

## Still outside this register

Provider receipts and actual transport: nothing is sent, no bounce is detected
automatically, and a failure is recorded because a person observed it. Linking
a delivery to a Missive thread or a SoftPro action beyond pasting its reference
needs those integrations. Retention and audit of delivery evidence follow the
backend guides.

## Code

| Path | Responsibility |
| --- | --- |
| `web/lib/title/delivery-ledger.ts` | Types, lifecycle functions, coverage calculation and `validateDeliveryMutation` |
| `web/components/title/deliveries.tsx` | The `DeliveryManager` section inside the document preview |
| `web/tests/delivery-ledger.test.mjs` | Domain and invariant regressions |

`Workspace.deliveries` is an optional module with its own internal shape, so
it is validated when present on both ordinary hydration and backup restore,
and absent on workspaces saved before this feature.
