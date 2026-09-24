# Joint venture application

The Agency workflow implements the two-page Ballantyne JV welcome letter/application supplied September 24, 2026. The private original is retained outside Git. The packet states a company process; this implementation does not assert that its checklist is a complete legal or licensing standard.

## Use

### Existing, operating companies

1. Open **Agency → Applications → Existing companies** and choose the company. Its company drawer also has an **Application** tab and an **Upload completed application** shortcut.
2. Upload the completed PDF or supported image. The company, Applications category and Restricted access are fixed for this upload; no document allocation decisions are needed. The original is saved before reading starts.
3. Compare the suggested values with their page evidence. Confirm the source applicants, review the clear suggestions together or individually, and resolve conflicting answers separately. Existing values need explicit replacement acknowledgement; changes to the source, destination or values invalidate that acknowledgement.
4. Apply the reviewed information, then **Save application details**. Reopen it to continue later. The details editor is available for missing or unreadable answers. Partial applications can be saved without pretending every required fact is present.

An existing company stays active. Uploading its application does not restart its launch process, mark licensing approved or change its shared company name, contact or ownership percentages. Licensing, records and approval history are in a closed disclosure below the application.

### New joint ventures

Choose **New joint ventures**, add/select the company, then **Send application link**. This opens the private request form; it does not send email by itself. The applicant completes the separate email-verified portal and submits their answers. Staff review and explicitly apply the returned information. See [Recipient intake](jv-recipient-intake.md).

### Detailed review when needed

Each applicant has separate identity details, individual/business ownership, and dated residence and employment histories. The manual editor retains the full application. **Review status and missing details** explains what remains before internal review. The 17-step setup checklist is a secondary section for formation work, not the starting task for every existing company. Internal review is separate from authority or launch approval.

The reader covers the supplied two-page form's printed labels, adjacent answer lines, ownership choice, split history headings, branding and notes. It can suggest dated history rows. Blank form instructions produce no applicant facts. Scans still depend on legible text: ambiguous dates, unreadable handwriting and unstructured histories require correction. Representative completed customer applications remain necessary to measure real-world accuracy.

## Packet mapping

| Source | Implementation |
|---|---|
| Applicant name, email, phone, DOB, SSN, license, current address | Multiple private applicant records; sensitive identity fields masked by default |
| Individual or business election; owner LLC before venture | Explicit election, business status and formation reference |
| Five-year residence / employment histories | Dated repeatable rows, coverage and gap checks |
| Logo preferences, colors, existing design, other information | Branding preferences, notes and company document references |
| Partnership agreement | Checklist; original agreement and review remain separate from this unsigned application |
| Domain; Secretary of State; federal tax ID; bank account | Four separate checklist steps |
| NIPR; SC insurance; NC insurance; underwriters | Four separate checklist steps |
| SoftPro; website; email; business cards; accounting; logo | Six separate checklist steps |
| ABA; buyer title preference form | Two separate checklist steps |

The supplied application does not contain ownership percentages, company-name inference, a signature block or a consent statement. The workflow does not invent these. Membership percentages and executed agreements belong to their existing company workflows.

## Private storage and authorization

- `title_jv_intakes` stores metadata only. Supabase Vault encrypts the complete applicant payload, review notes and source manifest. The service-only `title_jv_intake` RPC checks current membership, access version, company scope, role and restricted permission under the shared lifecycle lock. Browser roles and direct service-role table access have no grants; RLS is enabled.
- Owner, admin and onboarding roles require both company access and restricted evidence access. Operations, finance, viewer and partner roles cannot load the private application. Normal password/MFA setup gates apply to the HTTP endpoint.
- Explicit saves use application-version compare-and-swap. Concurrent saves, revoked access, moved/replaced originals and stale company assignments are rejected. Source manifests bind document version and asset identity plus stored byte count and SHA-256. Linked-original changes reset a Ready/Reviewed case to Draft on its next protected load.
- Applicant values never enter general workspace JSON, assistant context, shared activity details, browser local storage, IndexedDB or ordinary workspace exports/backups. Audit records contain only company, action, version and status. The form and scan live in memory while open; save before closing or navigating. Application reading uses the existing local document reader; it does not call an external model or train one.
- Recovery must include the database table and its Vault secret together through the platform's database recovery process and managed encryption key. Restoring a normal workspace snapshot does **not** restore or roll back private JV intake. No portable identity export is provided. The separate recipient portal is documented in [Recipient intake](jv-recipient-intake.md).
- HTTP request limit is 128 KiB; validated application payload limit is 100,000 UTF-8 bytes, at most 20 applicants and 40 rows of each history per applicant. Server-generated source metadata has a separate bounded allowance.

## Verification

`npm run test:jv` covers domain validation, actual Edge-handler routing/auth, private client context, and real React/browser interactions. Its integrated application-flow suite uploads fictional two-page PDFs through the real allocation component, reads them with PDF.js and the actual parser, reviews/applies candidates, saves and reopens the private record. It covers restricted company allocation, access loss, exact replacement acknowledgement, source changes, and mobile layout. `npm run test:jv:sql` creates an isolated temporary PostgreSQL database and verifies authorization, concurrent access changes, original replacement, CAS, encrypted-envelope writes and rollback. Its Vault API-compatible fixture uses pgcrypto and is not a claim about hosted Vault cryptography. The hosted pilot was separately exercised through the ordinary owner UI with fictional intake: save/reopen, submit, review and checklist updates. Read-only database checks confirmed RLS/grants, ciphertext storage and absence of applicant values in the general workspace. The hosted rollback SQL fixture could not run because the connected SQL tool is read-only; it is not counted as a passing hosted test.

No vendor accounts, applications, emails, registrations, websites, tax IDs or bank accounts are created by checking a step. Those deliverables remain tracked human/vendor work.
