# TitleOS

A local MVP for a multi-company title operations workspace, built from the Stephenie and Tyler discovery calls. It covers Tyler’s policy preparation, Stephenie’s company onboarding, John’s monthly financial review, document management, partner publication, and automation previews.

Initial operating states: North Carolina and South Carolina. Future jurisdictions have an explicit planning path. The interface uses an Apple-inspired visual system with quiet navigation, focused work areas, and contextual detail panels.

## Run locally

Requires Node.js 22.13 or later. From this repository:

```sh
cd web
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by the server, normally [http://localhost:5173](http://localhost:5173).

## Explore

- **Commitments → Load sample case:** add a complete, isolated fictional training file. Review the PTO, product choices, prior-policy/search context and CPL decisions. Prepare a conditional commitment and record its current returned output.
- **Policy products:** prepare separate owner and loan policies, each with its own coverage, premium, source evidence and exceptions. Track current output documents, local issuance and recipient delivery separately. CPL requests have their own preparation/return/delivery workflow.
- **Policy workbench → Source package:** open Maple Avenue, preview its fictional final opinion, deed and deed of trust. Upload a batch of sample files, classify each attachment, and capture the relevant wording with a page reference. Combined PDFs can have linked section references. The app identifies missing documents and drafts a request for the attorney.
- **Policy workbench → File details:** review the county, financing, loan amount, attorney and commitment reference. Record requirement evidence and exception dispositions, then explicitly attest to the commitment review and save. The sample requirement starts unresolved deliberately.
- **Policy workbench → Document review:** compare the captured wording with proposed values, review each relevant field, and enter a fictional attorney-review reference to export a preparation packet. New documents or changed values reopen affected review steps. Cash purchases and refinances have different source requirements.
- **Inbox / Revisions:** open the sample Evergreen loan-amount request, confirm the company/file and before/after amounts, then apply the local revision. A reply draft waits for a revised commitment document. Upload a sample using a distinct filename, attach the current revision's document, review the reply and approve it locally. Nothing is sent or changed in SoftPro.
- **Policy workbench → Attorney follow-ups:** save a missing-document request with its owner and outstanding items. Record a manual send reference and resolve individual received items without losing the request on reload.
- **Companies / Onboarding:** create a company, record application/signature references, attach milestone evidence, review NC/SC agency/producer/underwriter authority, and complete launch review. Changed evidence reopens affected approvals.
- **Documents:** upload and preview a synthetic or redacted PDF, text file, CSV, PNG, or JPEG. Up to 10 files per batch, 25 MB per file and 100 MB per batch. Link title documents to the correct company and order; same filenames are versioned within that scope.
- **Financials → Company closes:** freeze one company/month’s policy rows and ownership, enter expenses/reserves/adjustments, reconcile references and publish a reviewed revision. Preview the frozen member statement in **Partner portal → Statements**.
- **Handoffs:** review version-bound commitment, policy, CPL, reply and application preparations; record manual outcomes. Changed sources place pending handoffs on hold.
- **Tasks / Automations / Settings:** assign work, run repeatable local rules, review the disconnected SoftPro Select and Missive integration plans, plan state expansion, or export workspace metadata.

## Scope and data

All built-in companies, customers, records, documents and financial figures are fictional. Changes are saved in the current browser’s localStorage and uploaded files in IndexedDB. No shared backend, authentication, actual access enforcement, live extraction, mailbox, underwriter, accounting, payment, or signature API is connected. Use sample/redacted files only.

The partner view and persona switch demonstrate intended workflows, not production security. Locally recorded issuance and delivery are simulations. Uploaded files can populate review fields through manual source capture; OCR and AI extraction are not connected. Captured excerpts preserve the operator-entered wording, independently of proposed changes. They are not machine-verified readings of the document. A metadata export does not include separately uploaded binary files.

## Validation

```sh
cd web
npm run typecheck
npm test
npm run build
```

The 47 domain tests compile the actual TypeScript model/engine into an ignored temporary directory and remove it after execution. They cover source/version changes, multiple products, revisions, onboarding, frozen closes, attorney follow-ups, period reporting and repeated actions. The app uses the bundled Vinext/React/TypeScript starter. Its optional backend helpers are dormant; hosting and APIs remain a later project decision.

## Documentation

- [Current system blueprint](docs/system-blueprint.md)
- [Implementation coverage and walkthrough](docs/implementation-coverage.md)
- [All-transcript traceability: 54 workflow requirements](docs/discovery/all-transcript-traceability.md)
- [Full policy-production research](docs/research/full-policy-production.md)
- [Full company-operations research](docs/research/full-company-operations.md)
- [Research and engineering decisions](docs/research/README.md)
- [Tyler’s full call analysis and priorities](docs/discovery/tyler-call-analysis.md)
- [Missive integration and county-record research](docs/research/tyler-missive-and-records.md)
- [Commitments, CPLs and final-policy distinctions](docs/research/tyler-commitments-and-cpls.md)
- [Original policy workflow and vendor research](docs/research/policy-workflows.md)
- [Onboarding, finances, partner access and integrations](docs/research/operations-and-integrations.md)
- [NC and SC requirements](docs/research/carolinas-requirements.md)
- [Historical discovery analysis](docs/discovery/call-analysis.md)

Project destination: [AaronPilk/title-software](https://github.com/AaronPilk/title-software). This delivery is local; no production application is deployed.

Recordings remain outside the repository. Both machine transcripts are excluded from version control under `.local/`. No credentials or customer documents are needed to run the prototype.
