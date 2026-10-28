# Floating glass workspace

Visual reference: [code.xr Glasssy Dashboard V5](https://www.instagram.com/p/De_78COzoPO/), requested by Aaron on October 28, 2026. The public video was viewed directly. The implementation adapts its floating translucent panels and capsule controls to Ballantyne's existing navy/white identity. No reference media, code or invented dashboard metrics were copied.

## Changes

- Shared frosted sidebar, pill navigation and toolbar, translucent cards, softer blue ambient background, and clearer metric hierarchy.
- Agency welcome and list surfaces, Production setup cards, company drawers, dialogs and shared controls use the same material system.
- Readable solid inputs; near-opaque document/dialog surfaces; opaque high-contrast and reduced-transparency alternatives; reduced-motion and forced-color support.
- Compact desktop and phone layouts preserve all actions, vertical drawer scrolling and full metric values.
- Existing Agency/Production workflows, permissions, integrations, records and storage are unchanged.
- Fixed a pre-existing local sample failure: `createSeed()` now initializes the statement-delivery collection required when switching to Production.

## Verification

- 17 glass UI tests: real local-sample app, desktop/phone navigation, ordinary forms, keyboard focus, material contrast and accessibility alternatives, currency-value containment at 1360/960/390/320px. The suite is self-contained; a separate dev server is no longer required.
- 5 combined Agency browser checks: all company tabs, document cabinet, maintenance, protected document links and unsaved-form guards. Also included in the 137-test Agency suite below.
- 73 workspace view/navigation/access checks; 137 Agency Phase One checks; 221 domain checks. Counts overlap and are not a unique total.
- Typecheck, zero-warning lint, production pilot build and deployment dry run passed.
- Direct browser inspection of Agency, Production, company documents and phone drawers using fictional local records. No live customer records were edited for verification.

Run the focused browser suite with `npm --prefix web run test:glass:ui`. Set `TITLE_GLASS_SCREENSHOTS` to an absolute local directory to retain screenshots.
