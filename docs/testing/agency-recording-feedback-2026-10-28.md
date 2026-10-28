# Agency recording feedback — October 28, 2026

The Agency workspace now starts with simpler company work. This change responds to the supplied screen recording while retaining existing originals, ownership history and access boundaries.

| Concern | Result |
| --- | --- |
| Duplicate home navigation and counters that look clickable | One company-directory action; compact informational totals; direct company and task links. |
| Unclear task origin and assignment | Expandable explanations distinguish checklist tasks, scheduled renewals and legacy tasks with no recorded origin. Current assignment is separate from creation. |
| Documents from all companies mixed together | Agency Documents starts with a company chooser. Search, filters and upload destination follow the chosen company. Production retains its existing vault. |
| Repeated office address entry | Company details can copy an explicitly selected existing company address. No bulk overwrite. |
| Confusing email labels | Optional email descriptions with concrete examples. |
| Domain without a website and unclear save errors | Domain normalization and visible validation; “Website Not Needed” does not block saving a domain. |
| NC/SC selection | Both states can be selected; states already used by title files remain protected. |
| Repeated service/reference inputs | Everyday fields remain prominent; renewal dates, providers and notes are optional expanded details. |
| Unclear setup choices | “Checklist settings” explains task creation, agreements and coverage. Template mechanics move under Advanced. |
| Too much ownership machinery for a contact | Partner name, email and phone save independently. Existing legal interests, financial terms and private records remain in an optional section. |
| Eight folders recreated automatically | New cabinets start empty. Unchanged, unused legacy presets are hidden; custom and occupied folders remain, including originals in Trash. |

## Compatibility and release

- `CompanyDesk.partnerContacts` is an optional addition to the existing workspace document. Deploy the updated `title-api` validator before the UI; no database migration or access expansion.
- Retained company folders can be implicit in older records. Selection, validation, upload and move must all resolve them against that company’s documents, including archived originals.
- No real records, provider messages or account permissions were changed during testing.
- Private recording, transcript and frame review remain outside Git. The source has 18:19 of video and 7:01 of recorded audio. Full audio was transcribed locally; visual samples cover the remainder. Silent actions were not treated as additional spoken requirements.

## Verification

- Typecheck and zero-warning ESLint passed.
- Domain 221, backend 129 and API 386 tests passed.
- Agency Phase One 143 and company-workspace 47 tests passed.
- Daily-use, document-allocation and glass/accessibility browser run: 55 passed.
- Final full document-allocation run: 57 passed. Agency cabinet browser run: 14 passed, including two regressions reproduced before the implicit-folder upload fix (active original and Trash-only original).
- Synthetic Chrome walkthrough verified company-first documents, domain without website, both operating states, simple contact save and compact company cabinet.
- Separate dependency remediation and assistant migration evidence: [dependency-security-2026-10-28.md](dependency-security-2026-10-28.md).

Counts refer to individual commands and overlap; they are not a unique aggregate. Local and synthetic acceptance does not establish that every real customer record or hosted workflow has been exercised.

## Second recording review and simplified Agency navigation

A second review compared the complete recorded audio and visual samples throughout the silent remainder with the running synthetic workspace, implementation and regression tests. The appearance reference is separate from this workflow evidence.

| Recording time | Acceptance check |
| --- | --- |
| 0:00–1:09 | Home uses compact informational totals and direct company links; no duplicated hero navigation. |
| 1:13–1:39 | Tasks explain source and current assignment; absent legacy provenance stays unknown. |
| 1:45–2:40 | Agency Documents opens a company chooser before showing files. |
| 2:46–3:12 | Address can be copied from an explicitly selected accessible company. |
| 3:14–3:44 | Email description is optional and includes examples. |
| 3:53–4:24 | Domain can save while Website Not Needed is selected. |
| 4:24–4:36 | Both NC and SC can be selected; existing title-file references remain protected. |
| 4:36–5:20 | Everyday domain/email fields are separate from collapsed optional renewal details. |
| 5:22–5:51 | Checklist settings explains its effect. Template editing and task refresh are under collapsed Checklist tools; active companies label this tab Setup records. |
| 5:52–6:30 | Partners tab opens simple name/email/phone contacts. Card totals use that same contact source. Optional legal/financial records remain collapsed. |
| 6:35–6:58 | New cabinets have no forced folders; manual folder creation and existing originals are preserved. |
| 7:01–18:19 | Silent application/upload/folder interactions were visually checked against the relevant flows above, without inventing additional spoken requests. |

Agency navigation and command search no longer list the full Assistant, Automations or orchestration Connections screens. The full assistant stays in Production; contextual help remains available. Existing application reading remains optional. No existing record, permission, original document or integration credential was altered by this UX cleanup. Production scanning and policy preparation are unchanged.

Second-pass verification: 146 Agency checks, 77 workspace/navigation checks, 18 glass/accessibility checks, 13 company-workspace UI checks and 221 domain checks passed. Counts overlap. Typecheck, zero-warning lint and the pilot production build passed. Direct synthetic browser checks covered the revised company tab labels and ordinary contact/document views; independent diff review found no further actionable issue after the selected-tab and metric contrast fixes.
