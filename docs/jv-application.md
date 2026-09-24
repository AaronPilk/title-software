# Joint venture application

The Agency workflow implements the two-page Ballantyne JV welcome letter/application supplied September 24, 2026. The private original is retained outside Git. The packet states a company process; this implementation does not assert that its checklist is a complete legal or licensing standard.

## Use

1. Add the company with its basic company information. Open **Agency → Onboarding**, select it, then **Open private application**. The same application is available in **Companies → company → Onboarding**. Existing companies can continue using basic details and Documents without completing a new-JV application.
2. Add each applicant separately: name, email, phone, date of birth, SSN, driver's license and current address. Choose individual or business ownership. Business ownership needs the owner's business name, formed status and a formation reference before internal submission.
3. Record residence and employment periods covering the last five calendar years. Include the current period, leaving its end date blank. Employment periods can identify self-employment, unemployment or retirement. Overlaps are supported; unexplained gaps block submission.
4. Record logo/color preferences and other information. Link originals uploaded to this company's **Applications / Restricted** category. The application reader offers conservative printed-label suggestions with original page references. Every suggestion requires confirmation that it matches the source and the selected applicant. Unclear dates, checkbox elections, handwriting and history tables need manual entry.
5. **Save draft**, then **Save and submit for review** when the required information is complete. Review the original documents, add a review note, confirm the check and mark reviewed. Editing applicant intake returns it to Draft. Replacing a linked original invalidates the earlier review. This internal review does not approve company launch or submit anything externally.
6. Use **Setup checklist** to track all 17 deliverables, responsible person, due date, evidence reference and note. Complete / Not applicable needs an evidence reference or meaningful explanation. Checklist edits preserve an unchanged applicant review. Existing licensing, authority and launch evidence controls remain separate.

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
- Recovery must include the database table and its Vault secret together through the platform's database recovery process and managed encryption key. Restoring a normal workspace snapshot does **not** restore or roll back private JV intake. No portable identity export or public self-service applicant portal is provided by this release.
- HTTP request limit is 128 KiB; validated application payload limit is 100,000 UTF-8 bytes, at most 20 applicants and 40 rows of each history per applicant. Server-generated source metadata has a separate bounded allowance.

## Verification

`npm run test:jv` covers domain validation, actual Edge-handler routing/auth, private client context, real React/browser interactions and source suggestion review. `npm run test:jv:sql` creates an isolated temporary PostgreSQL database and verifies authorization, concurrent access changes, original replacement, CAS, encrypted-envelope writes and rollback. Its Vault API-compatible fixture uses pgcrypto and is not a claim about hosted Vault; a separate rollback-only fixture validates the deployed Vault path with fictional values.

No vendor accounts, applications, emails, registrations, websites, tax IDs or bank accounts are created by checking a step. Those deliverables remain tracked human/vendor work.
