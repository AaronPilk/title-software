# TitleOS

A local MVP for a multi-company title operations workspace, built from the supplied discovery call. It covers Tyler’s policy preparation, Stephenie’s company onboarding, John’s monthly financial review, document management, partner publication, and automation previews.

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

- **Policy workbench:** review Maple Avenue’s recorded-document excerpts, approve individual changes, enter a fictional attorney reference, and export a review packet. Harbor Lane demonstrates a source-document hold; Willow Court starts ready for simulated issuance.
- **Companies / Onboarding:** create a sample company, update its checklist, add NC/SC authority references, and edit demo member interests.
- **Documents:** upload a synthetic or redacted PDF, text file, CSV, PNG, or JPEG (up to 10 MB), preview it, and choose whether to publish it in the local partner view.
- **Financials:** compare September and August, enter illustrative expenses, review member estimates, and reconcile a demo remittance batch.
- **Inbox / Tasks / Automations:** queue matched requests, draft follow-ups, assign work, and run repeatable local rules.
- **Settings:** see integration plans, change the demo persona, plan state expansion, export metadata, or reset sample records with Undo.

## Scope and data

All built-in companies, customers, records, documents and financial figures are fictional. Changes are saved in the current browser’s localStorage and uploaded files in IndexedDB. No shared backend, authentication, actual access enforcement, live extraction, mailbox, underwriter, accounting, payment, or signature API is connected. Use sample/redacted files only.

The partner view and persona switch demonstrate intended workflows, not production security. Locally recorded issuance and delivery are simulations. Uploaded files do not automatically populate policy comparison fields. A metadata export does not include separately uploaded binary files.

## Validation

```sh
cd web
npm run typecheck
npm test
npm run build
```

The domain tests compile the actual TypeScript model/engine into an ignored temporary directory and remove it after execution. The app uses the bundled Vinext/React/TypeScript starter. Its optional backend helpers are dormant; hosting and APIs remain a later project decision.

## Documentation

- [System blueprint and implementation coverage](docs/system-blueprint.md)
- [Research and engineering decisions](docs/research/README.md)
- [Tyler’s policy workflow and vendor research](docs/research/policy-workflows.md)
- [Onboarding, finances, partner access and integrations](docs/research/operations-and-integrations.md)
- [NC and SC requirements](docs/research/carolinas-requirements.md)
- [Historical discovery analysis](docs/discovery/call-analysis.md)

Project destination: [AaronPilk/title-software](https://github.com/AaronPilk/title-software). This delivery is local; no production application is deployed.

The supplied recording and machine transcript are excluded from version control under `.local/`. No credentials or customer documents are needed to run the prototype.
