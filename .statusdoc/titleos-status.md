# TitleOS — status and continuation notes

Local-first operations platform for Pilk's mother's JV title insurance agencies (NC/SC now, more states later). Built from scratch by Codex, handed off to Claude for continuation on 2026-09-11; since 2026-09-12 both agents work directly on Pilk's Mac, coordinating through `CODEX_PARALLEL_WORK.md` at the repo root (untracked, local-only — each agent appends under its own section and never edits the other's). This doc is the running status/handoff record across Claude sessions — read it before picking the project back up. Terser on-disk equivalents live at `docs/implementation-coverage.md` and `docs/system-blueprint.md` (Codex reads those, so keep both current).

## Current state — September 14, 2026

- **Mac `main` is `b7ccbc2`.** Working tree clean apart from three deliberately untracked root files (`CLAUDE.md`, `CODEX_PARALLEL_WORK.md`, `HANDOFF_FOR_CLAUDE.md`).
- **The repo is now public on GitHub and pushed.** Pilk pushed `main` to `github.com/AaronPilk/title-software` on September 14 — "no one knows about this other than me push it all live so I can start looking at it". The earlier ask-before-pushing rule is retired. Before that push, all 233 tracked files were scanned for credentials: none. `.local/` (recordings, transcripts, `START-HERE.txt`, staff credentials) is gitignored with nothing tracked under it. The only public identifiers are the Cloudflare account id and Supabase project ref in `wrangler.jsonc`, neither a credential. As of this writing the Mac is three commits ahead of `origin/main`.
- **Test totals:** 156 domain tests, 34 workflow tests, typecheck clean, production build clean. Backend, Missive and assistant suites need live credentials and are run separately.
- **A private Cloudflare pilot is deployed** at `https://title-software-pilot.aaron-9c3.workers.dev` with Supabase auth, MFA and a per-staff assistant — see "Backend and pilot" below.

### Environment note that will bite you

The Cowork **device shell is a Linux VM** with the Mac's folders mounted, so the Mac's macOS-native `node_modules` cannot run `npm run dev` or `npm run build` there — rolldown looks for `@rolldown/binding-linux-arm64-gnu` and fails. `npx tsc --noEmit` and `npm test` work fine on the Mac (plain JS/TS). Builds and browser passes go in a cloud container clone, shipped back as a git bundle and fast-forwarded. Git in that device shell also cannot delete files by default, so a crashed git operation leaves a stale `.git/index.lock` that blocks every later write — request delete permission for the folder and `rm` it.

## What TitleOS is

- Order intake → commitment review → policy production (Owner/Loan) → issuance/delivery → closing/financials → partner portal, plus onboarding, CPLs, attorney follow-ups, loan-amount and commitment-field revisions, post-issuance corrections, company materials/publications, a statement delivery register, a per-recipient document delivery ledger, effective-dated ownership history, task waiting/SLA tracking, full local backup/restore, an accounting CSV import preview scaffold, a finals backlog queue, referenced-source holds, and a per-staff AI assistant.
- Local-first by default: workspace metadata in browser `localStorage` (`titleos.workspace.v1`), uploaded files in `IndexedDB`. A connected Supabase/Cloudflare mode exists for the private pilot. Every "SoftPro filed" / "Missive sent" / "Docusign signed" action anywhere in the app is a **local record of an operator-reported outcome**, never a real integration call.
- Two source call recordings/transcripts (Stephenie Tocado, Tyler Pilkington) are evidence for what to build, never authorization to send anything or move money.
- Stack: React 19.2 + TypeScript 5.9, Vinext (Next-style App Router) on Vite 8 (Rolldown) + Cloudflare Workers runtime, Tailwind 4 + shadcn/Radix, drizzle-orm present but dormant. Node ≥22.13. App in `web/`; `npm run dev` → localhost:5173. Local folder `/Users/pilksclaes/Title software`.

## Core architecture (read this before changing domain logic)

- **Central mutation gate**: `WorkspaceProvider.update(fn, title, detail)` in `web/lib/title/store.tsx` clones state, applies the mutator, then runs `validateBusinessMutation(before, after)` in `web/lib/title/business.ts`, which throws to reject an invalid mutation (surfaced as a toast) before anything commits. This is the single enforcement point for nearly every cross-cutting invariant — **any new rule that must hold no matter which UI path caused the change belongs here**, not only in the function that "normally" makes that change. It currently chains out to `validateReferencedSourcesMutation`, `validateStatementDeliveryMutation`, `validateMaterialsMutation`, `validateTaskClock`, `validateDeliveryMutation` and `validateOwnershipMutation`.
- **Fingerprint/snapshot pattern**: `commitmentFingerprint`, `finalProductFingerprint`, `cplFingerprint`, `closeFingerprint`, `launchFingerprint`, `applicationFingerprint`, `correctionFingerprint` — each JSON-snapshots the inputs a "prepared/reviewed" state depends on. A later prepared/output document must match the *current* fingerprint or it is stale.
- **Derived-not-stored**: prefer computing a lifecycle field from an existing event log over adding a second mutable field that can drift. `recoveryStage(order)` from `outcomes[]`, `taskClock(task)` from waiting periods, and `deliveryState(s, r)` from the document's current version are all examples.
- **Append-only evidence logs**: waiting periods, delivery records and ownership records are all append-only. Nothing is deleted or rewritten; a correction is a new record. Each has a validator clause enforcing that.
- **Optional modules vs. required-with-backfill fields**: `Workspace.materials`, `statementDeliveries`, `deliveries` and `ownershipHistory` are genuinely *optional* modules with internal shape — never add them to a required-array-keys list, and validate their shape when present in `isWorkspaceShape` (this protects both `localStorage` hydration and backup restore). A plain new array with no internal shape (`revisions`, `fieldRevisions`, `replyDrafts`, `expansionStates`, `importTemplates`) instead goes on `Workspace` as *required*, backfilled via `s.field ??= []` in `enrichWorkspace`.
- **New top-level workspace arrays also need a `command-log.ts` `tables` entry**, or their edits are not captured for the connected backend.
- **Warn, don't gate, on fuzzy matches**: `similarCompanies()` is the pattern for anything heuristic — pure, explainable, never merges or blocks; the human decision stays in the UI and gets recorded in the activity detail.
- **Document family/versioning**: `sameDocumentFamily()` in `production.ts` scopes "latest version" by companyId+orderId+name, and for output roles also by `sourceRole` + `policyId`/`cplId`/`correctionId`.
- **Issued-policy immutability**: once a `PolicyProduct` is Issued/Delivered, `validateBusinessMutation` blocks any change to its `finalProductFingerprint`. That fingerprint deliberately excludes certain output-role documents from its shared-sources comparison — a new output-document role attached to an order *after* issuance must be added to that exclusion list or it falsely trips the guard.
- **Keys must be unique among siblings, even outside a `.map()`.** Two differently-typed siblings given the same literal `key` is a real bug: React can duplicate or drop one in the live DOM. Hit twice now — once with `OrderOutcome`/`OrderNotes` sharing an order id, once in the shared `DataTable`, whose header cells were keyed by their *label* so any table with two blank or identical headers silently lost one. `DataTable` headers are now keyed by position; the general rule stands.
- **Suggested wording is not an approved taxonomy.** Recovery outcomes, task waiting reasons, delivery recipient roles and methods are all editable starting text, labelled as such in the docs, pending a compliance-reviewed list.

## Verification method (repeat this for every feature)

1. `npm run typecheck` (`tsc --noEmit`) — must be clean.
2. `npm test` (`node scripts/test-domain.mjs`) — transpiles the domain modules named in its explicit `tsc` root list (`model.ts`, `engine.ts`, `csv.ts`, `task-clock.ts`, `delivery-ledger.ts`, `ownership-history.ts`; everything else arrives transitively) and runs the `node --test` suite. **A new domain module with its own tests must be added to both lists in `scripts/test-domain.mjs`.** Currently 156/156.
3. `npm run test:workflows` — 34/34.
4. `npm run build` — full Vinext/Vite production build.
5. **A real browser pass through `update()` and the actual UI, not just domain calls.** Domain tests write straight into state and bypass `validateBusinessMutation` and real component wiring. Every feature so far has found at least one real bug this way that the domain suite missed.

Browser-pass gotchas worth keeping: Radix `TabsTrigger` activates on `onMouseDown`, so a synthetic `page.evaluate` click silently does nothing — use a real Playwright locator `.click()`. The sidebar is plain `<button>` elements, not a `<nav>`; Companies is a card grid, not a table. Changing the hash with `page.goto` leaves the previous screen mounted — reload after it. Sonner stacks toasts, so assert against `allInnerTexts()` rather than `.last()`.

## Features built, newest first

### September 14, 2026 (Claude): three features, plus the public push

`87b6528` **X01 — task waiting reasons and due-date countdown.** `lib/title/task-clock.ts` adds append-only waiting periods to a `Task` (reason, detail, operator, start date, resolution date, what unblocked it) and a derived `taskClock` reporting the due-date countdown, total waiting days, and *active* days — time held minus time spent waiting on someone else, which is the number that separates our responsiveness from an attorney's. A task with no `createdAt` reports an unknown age rather than inferring one from its due date. **Waiting never extends a deadline**: a waiting task is still Overdue and still appears under that filter, shown side by side so a slow reply does not read as a missed deadline and a missed deadline is not excused by one. Invariants: one open period at a time; a task cannot be completed while still waiting (the checkbox is refused with an explaining toast); recorded periods cannot be deleted, rewritten or reopened, and a resolved one must say what unblocked it. Tasks UI gains Waiting and Overdue views, a per-row status and countdown, the waiting dialog and expandable history. 15 tests; 11-step browser pass.

`13a6092` **Per-recipient document delivery ledger.** `lib/title/delivery-ledger.ts` + `components/title/deliveries.tsx`, mounted in the document preview beside `PublicationManager`. Attaches to **any document on an order file**, so commitments, finals, CPLs, corrections and ordinary sources share one mechanism rather than a bespoke recipient field per product. Prepared / Recorded / Failed / Cancelled, plus a derived "Source changed". Preparation binds to one exact document version: a superseded document cannot start a delivery, and a prepared record whose document is later replaced can only be cancelled, because the recipient would otherwise read as holding a current copy they do not have. Retries are new linked attempts with an incremented attempt number, bound to whichever version is current *at retry time*. One open preparation per recipient per document, matched case-insensitively on email. Additive: `deliverPolicy` still records the single recipient that gates order completion. 17 tests; 14-step browser pass.

`b7ccbc2` **S09 — effective-dated ownership history.** `lib/title/ownership-history.ts` + `components/title/ownership.tsx` under the company member editor. **This changes shared close behaviour — read it before touching financials.** `newClose` and `closeFingerprint` now resolve ownership as of the *last day of the reporting month* instead of reading `c.members`, and each close stores `ownershipSource` (record id + effective date) which the close screen prints. Records are append-only snapshots of the whole member set; the first is the company's *opening* position, later ones are changes. With **no dated records the behaviour is identical to before** — current members govern and editing them still invalidates the close — and there is a dedicated test pinning that. For a date before the opening record, ownership is reported as not on file and falls back visibly rather than being guessed. `ownershipDrift` reports published closes now governed by a different record; it **reports only**, since published allocations are frozen and changing one is a reviewed revision. 15 tests; 10-step browser pass whose decisive check builds an April close through the real Financials UI after ownership changed to 10/90 and confirms it allocated on January's 60/40.

Also fixed: `DataTable` keyed header cells by their label, so any table with two blank or identical headers silently duplicated or dropped one in the live DOM. The new Tasks table tripped it; headers are now keyed by position.

### September 13, 2026 (Codex): private Cloudflare pilot, Missive intake, staff assistant

`099a293`, `09c0f82`, `3f8a383`, `dc1ed0c`, `7868aa7`, `5930172`. A private pilot deployed at `https://title-software-pilot.aaron-9c3.workers.dev` with a Supabase backend (auth, MFA, password setup, RLS, ten migrations), a reviewed Missive text importer with immutable source snapshots, a finals backlog queue, exact-version referenced-source holds, member email/phone, dynamic underwriter remittance rows, safe partner monthly aggregates, and an authenticated per-staff Cloudflare Agent with private per-company/file conversation history. Assistant context is saved structured fields and document metadata only — never PDF text, OCR, email bodies or application forms. Details in `docs/cloudflare-pilot.md`, `docs/supabase-backend.md`, `docs/personal-assistant.md`, `docs/missive-connection.md` and `docs/transcript-recheck-2026-09-13.md`.

### September 12, 2026 (Claude + Codex): the split-build era

J05 statement delivery register (first feature split by layer against a typed contract Codex wrote to `.local/coordination/`), S01 duplicate-company warnings and the acknowledgement-signature follow-up, commitment field revisions, two multi-loan revision defects Codex found and Claude fixed, the rejected-file recovery pipeline, full workspace backup/restore and its hardening, the accounting CSV import scaffold, and Codex's company materials + partner publication work. Per-feature detail is preserved in `docs/implementation-coverage.md` and in `CODEX_PARALLEL_WORK.md` on the Mac.

### September 11, 2026 (Claude): post-issuance policy correction workflow

A `PolicyCorrection` record (`Requested → Reviewed → Recorded`, or `Cancelled`) that never mutates the original issued `PolicyProduct`.

## What is still incomplete

**Waiting on Pilk** (nothing in the app can proceed without these):

1. Sign in as `aaron@pilk.ai` using the private `.local/pilot/START-HERE.txt`, set a personal password and his own MFA.
2. Create the actual companies and assign the six staff — the real workspace is still empty, zero companies and zero orders.
3. A fresh Missive token plus an explicit inbox → company map. The previous token returned 401.
4. Finish the dedicated Resend SMTP setup and verify delivery; native email delivery is still unverified.
5. An approved SoftPro / underwriter integration sandbox, with forms and rules.
6. John's actual month-end examples and approved allocation rules.

**Vendor-dependent, and correctly deferred**: live SoftPro, Missive attachment/polling/reply, Docusign, QuickBooks, OCR and document extraction. No real government filings, no credential verification, no full rating engine, no money movement anywhere.

**Buildable locally, still open**: general task-to-case deep links and scheduled reminders; an approved compliance-reviewed wording taxonomy for recovery outcomes, waiting reasons and delivery roles (all currently editable starting text); accounting posting from the CSV import scaffold, which stops at preview and mapping by design; coverage, endorsement and policy-form revisions, which still need separate professional review; matching companies against an external CRM; automatic bounce detection for deliveries; and governing-document extraction behind ownership records.

**Infrastructure**: authenticated immutable audit, retention, multi-tab/multi-user conflict handling and durable server-side recovery. The local backup/restore is single-browser disaster recovery, not a substitute.

## Suggested continuation order

Same shape each time: pick one gap → domain types → domain functions → `validateBusinessMutation` invariants → UI → tests → the full five-step verification above → claim the feature and its expected files under the Claude section of `CODEX_PARALLEL_WORK.md` (and read Codex's section for anything queued) → work on an isolated `claude/<feature>` branch → rebase onto current `main` if it moved → sync to the Mac ff-only → verify there → record the landed hash in the coordination file.

Pushing to GitHub is now expected rather than gated, but the push itself runs from Pilk's Mac: neither the Cowork device shell nor the cloud container holds GitHub credentials, so hand him `cd "/Users/pilksclaes/Title software" && git push` and let him run it.
