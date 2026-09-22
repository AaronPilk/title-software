# Security remediation release — September 22, 2026

The six confirmed application findings from the September 21 assessment are corrected, along with vulnerable dependencies. Company-scoped accounts cannot read global financial snapshots or change workspace-wide configuration or accounting mappings. Local backups validate before writing, preserve original files through failure and Undo, and preview PDFs as rendered pages. Email conversion and request reading now have bounded processing behavior.

Code commits: `d516bc4`, `5411946`, `58fab50`. Existing history was preserved. No migrations, staff grants, invitations, passwords, MFA enrollment or real business documents changed during this release.

## Verification

| Check | Result |
| --- | --- |
| Domain | 221 passed |
| Backend | 112 passed |
| Actual API handler with synthetic Auth/database | 212 passed |
| Missive | 86 passed |
| PDF text, workflows, assistant, OCR | 82 passed |
| Auth, members, Missive settings and workspace UI | 100 passed |
| Daily-use UI and staff assignment | 50 passed |
| Document, backup and PDF preview UI | 26 passed |
| Locally served production pilot | 5 passed |
| **Automated application total** | **894 passed** |
| Disposable PostgreSQL | 1,317 explicitly counted assertions; 18 staff concurrency scenarios; repeated routing, credential and pause checks |
| Hosted unauthenticated perimeter | 16 expected responses |
| Fresh dependency installs and audits | Both packages install; both audits report zero vulnerabilities |
| Typechecks, API bundle, builds and deployment dry runs | Passed |
| Full lint | Zero errors, 33 existing warnings |

The production browser checks cover security headers on HTML, assets, API errors and missing pages, plus sign-in hydration on desktop/mobile. PDF browser tests also use the production response policy. A stale local Worker process initially referenced assets from an earlier build; restarting it against the final artifact resolved that test-environment failure.

Secret scans found no credential in the three release commits. The compiled-client scan flagged the intentionally public Supabase publishable key; it was compared with the configured publishable value. No privileged key was identified. Private audit evidence and originals remain outside Git.

## Deployment

- Frontend: `bb3fe81b-d21b-464c-9b64-ebdca74f9b30`, 100% traffic.
- Private assistant: `60f156f4-cda1-43ba-afc1-428ebaecda35`, 100% traffic through its service binding.
- Application API: version 15, JWT verification enabled. Downloaded deployed source exactly matches the tested bundle, SHA-256 `b4301c13de82fd0670a3add92b7fb87c7863b0704bd50809c1e2190d01b30e17`.
- Cloudflare Access still covers the pilot hostname and Worker destination. Preview URLs remain disabled; the assistant has no public Workers.dev route. Query strings are redacted and automatic invocation logs disabled for both Workers.
- Hosted metadata confirms private document storage, application-table RLS and no direct browser table reads.

## Acceptance still required

The owner's Cloudflare and application sessions need a fresh sign-in. No signed-in hosted owner/non-owner document round trip was claimed, and no access email was sent. Before Stephenie's invitation, complete the ordinary owner login and a fictional-company upload/download/access check; each staff member completes their own password and authenticator steps.

Content-signature validation is not antivirus scanning. A quarantine/scanning process, independent hosted original-file recovery drill and reviewed retention policy remain work for broad external intake or bulk archive migration. The local JSON backup limit is 64 MiB of decoded originals, 50 MiB per file, 2,000 files and a 96 MiB serialized file. Preview supports bounded rendered PDFs; larger supported originals remain downloadable. Authorized originals belong in private storage, never public fixtures or GitHub.

These are measured test results, not a security certification or proof that untested integrations are safe. Live SoftPro acceptance, provider/model adversarial testing and large-scale load testing remain outside this release.

To repeat the production smoke test, run `npm run build:pilot`, serve that build with `npm run start -- --port 5189`, then run `npm run test:pilot:security`. Stop and restart the local server after rebuilding so it cannot retain old asset references. Use `npm run test:backup:ui` for transactional backup and rendered-PDF regressions.
