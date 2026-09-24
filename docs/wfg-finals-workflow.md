# WFG final preparation worksheet

The WFG final worksheet turns reviewed source facts and manually confirmed policy instructions into an internal handoff. It does not issue an official policy or jacket, change SoftPro, calculate an approved insurance rate, or send email. Provider access and provider-approved forms remain separate prerequisites.

## Operator flow

1. Open the correct company's title file. Upload and classify the original final opinion, deed and security instrument as applicable; review captured values and the current commitment.
2. Create the required Owner and/or Loan policy products. Enter their approved form/version, insured, coverage, premium and exception dispositions. Each Loan product needs a reviewed principal, distinct loan identity and current security-document/page reference.
3. Save the WFG worksheet. Record the company's authority evidence for the file's state and the attorney's eligibility evidence. These are explicit manual review references, not an automated appointment verification.
4. For each policy, confirm **Standard** or **Enhanced**, the matching approved form/version, and the reason it matches the commitment and jacket instructions. Owner/Loan and Standard/Enhanced are separate dimensions. Record exact endorsement codes, include/exclude decisions, reasons and verified fees. No codes or default fees are supplied by this feature.
5. Record binder-fee applicability, its approved source and rationale. Add other fee decisions when needed. An unknown amount remains unknown; zero must be a reviewed value. Complete the local reply draft.
6. Resolve every source and worksheet blocker, record the review note, then prepare the handoff. Download the reviewed instructions and any separately selected authorized originals. Complete issuance through the existing approved underwriter workflow; use the existing product lifecycle to record its returned policy document and reference.

The handoff includes reviewed source fields with document/page evidence, policy insured/coverage/principal/premium, variant/form instructions, exception dispositions, endorsement/fee decisions, compatibility references, source-original identities and the local reply. It explicitly says it is not an official policy or jacket and that no email was sent. Referenced source metadata does not mean every original is included in an exported bundle; the export identifies which originals were selected.

## Boundaries and stale evidence

- This worksheet prepares **WFG** cases only. Commonwealth and First American need separate reviewed provider workflows; adding an underwriter label does not authorize its operation.
- Issuing and referring companies are preserved as distinct proposed identities, but either differing from the file's company blocks preparation. An administrator must review cross-agency appointment, access and attribution before a future workflow can support that case. Saving a worksheet never moves a title file or changes its company scope.
- The backend permits only supported Production roles with access to the file and referenced companies/products. Agency documents are not disclosed merely to fill the compatibility worksheet. The worksheet's evidence text is a manual attestation, not provider-confirmed eligibility.
- Draft save, review and preparation require the worksheet version and the source snapshot opened by the editor. Changed originals, file facts, commitment review, product configuration or readiness blockers reject stale submissions.
- A prepared worksheet becomes stale when relevant input evidence changes. Saving an edited worksheet creates a new draft version and retains review-event history. Existing file/source correction history remains a separate record.
- Snapshots bind original IDs, versions, asset IDs, names, visibility and available provenance hashes. They exclude raw document text and recursive historical snapshots. Official returned output documents and product lifecycle bookkeeping do not falsely invalidate unchanged preparation instructions.
- Issued, partially issued and rejected files cannot mutate the worksheet. An already prepared, still-current handoff can remain readable after an external issuance is recorded. It does not replace the sanctioned policy-correction workflow.
- Final readiness, reviewed requirement/exception dispositions, loan-source checks and current commitment review remain mandatory. No worksheet checkbox bypasses them.

## Implementation and validation

Domain: `web/lib/title/final-preparation.ts`. The three command actions are `saveFinalPreparation`, `reviewFinalPreparation` and `prepareFinalHandoff`. The backend command allowlist supplies authorization; shape/history guards alone are not an authorization boundary. `finalHandoffData` and `finalHandoffText` export only current prepared records.

Focused regression coverage in `web/tests/final-preparation.test.mjs` checks unknown defaults, draft/review/prepare behavior, stale originals/commitments/products, pre-save editor races, retained history, cross-agency withholding, unsupported underwriters, conditional endorsements, binder applicability, exact product mapping, per-loan evidence, source-readiness gates, issuance locks, malformed input, recipient-header injection, command capture, real product issuance transitions and snapshot size/privacy boundaries. The real backend command-path tests in `web/tests/final-preparation-backend.test.mjs` independently cover role/company scope and forged/stale mutations.

These synthetic regressions establish mechanics and guards. Production readiness still requires representative original documents and expected outputs reviewed by the operations team, approved provider configuration, and end-to-end acceptance. Recorded examples and feedback do not automatically train a model or establish compliance certification.

## Connected inbox and originals

Production → Inbox → Live email → Review for title file opens a fresh provider review. The operator explicitly selects an existing, open file in the mapped company (or opens the normal new-file form first), saves the immutable email, and chooses individual attachments to save. Suggestions never assign a file automatically. Each attachment has its own acknowledgement and retry; a failed attachment does not roll back an already saved email or claim the whole package succeeded. Opening the title file leads into Prepare final and its existing source classification/capture controls.

The intake transport makes GET requests to Missive only. It never sends, drafts, marks read, archives, moves or edits provider records. Operations access requires both company membership and an explicit administrator approval of the entire Production inbox; a company route alone is insufficient. The API rechecks membership, routing, credential revision and source fingerprint during slow reads and at the transactional commit. Browser-supplied grants cannot recreate the server capability. A registered private original may remain unlinked after a save conflict so a successful concurrent retry cannot have its bytes deleted; an unlinked asset is not a staff-readable document.

New inbound email or an unclassified original invalidates an earlier preparation immediately. The incoming inventory contains source identities, not copied message bodies. Agency-only records are excluded consistently from both the canonical and staff-projected snapshots. Semantic snapshot comparison tolerates PostgreSQL JSONB object-key order while preserving values and array order; existing commitment review stamps are not rewritten or reapproved.

## Review history and downloads

The trusted mutation boundary appends field captures, corrections and explicit reviews with the prior/recorded value, source ID/version/page, available extracted suggestion and quote, reviewer and time. Staff cannot overwrite this history. The document-review tab displays the latest entries and exports the retained history. These events are not automatically validated training labels.

The final workspace exports printable HTML, plain text, a local reply text file, or a ZIP containing the handoff and selected original bytes. A SHA-256 manifest identifies the selected files. Downloads pin the account/workspace and recheck file, source and preparation identity throughout asynchronous reads. The bundle rejects missing, empty, oversized, mismatched or corrupt supported file bytes. Limits are 50 selected originals, 25 MiB per original and 64 MiB combined. A bundle is not an email delivery or official policy.

Preparation, policy-product and file-detail drafts have navigation protection. A rejected save keeps the edits; pending writes cannot be discarded by changing workbench tabs or files. A preparation cannot export while its source facts or reviewed instructions are stale.

## Remaining operational inputs

Start acceptance with three to five WFG cases reviewed by the operations team: original inbound email and attachments, relevant existing commitment/file facts, the expected final policies/jackets, exact endorsement and fee decisions, and a narrated walkthrough. Include Standard/Enhanced and omitted-endorsement variations. Use additional held-out cases to measure extraction accuracy and identify unsupported layouts. Exact forms, rates, company/attorney eligibility and exceptions must be verified against the agency's approved instructions. Direct SoftPro writes, provider jacket generation, other underwriter workflows and accounting are separate future work.
