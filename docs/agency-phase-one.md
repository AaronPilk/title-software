# Phase One agency workspace

Use **Agency → Overview, Companies, Tasks, and Documents** for everyday work. **More tools** reveals the additional workflows; Production remains available separately. This guide describes the implemented workflow. Environment setup and release details belong in the [pilot guide](cloudflare-pilot.md).

Each company has five tabs:

| Tab | Use it for |
| --- | --- |
| Overview | Contact and address, primary/additional company emails, domain, website or Website Not Needed, logo, service dates and operating status. |
| Setup | Conditional setup tasks, owner-type choices, selected template version, required originals and readiness. |
| Ownership | Member ownership and protected owner/entity records, distinct financial terms, governing agreements and dated filing evidence. |
| Documents | Upload, view, download, organize and manage company originals. |
| Application | Retained application preparation, stored completed applications, optional reading/import and prior private checklist details. |

**Store a completed application.** Upload it as a Restricted company Application. Saving the original is a complete action: reading, OCR, import and review are optional. An available saved original satisfies the application's setup task without those extra steps. Use **Read / Import Application Details** only when you want to extract details, then review proposed values before applying them. Application originals remain available in the company cabinet.

**Configure and work the checklist.** A new company starts in Onboarding with a Phase One checklist. Select NC/SC operating states and each underwriter; add the ownership members, then choose individual, existing entity or new entity in **Setup choices**. Choose one combined governing agreement or two separate agreements and record company E&O coverage. Existing companies can use **Create setup checklist**. Existing Active operating statuses remain Active; earlier approval evidence and the private 17-step JV checklist are retained.

Setup and recurring work share **Tasks**, with assigned staff, status, due date, completion date, notes and linked originals. Complete required tasks with the appropriate live company originals. Save the domain, valid primary email and website in Overview before completing those tasks; Website Not Needed removes the conditional website task. Private owner/tax and bank/payment completion records a staff member's **reviewed assertion** after checking the relevant records. It does not automatically verify private data or external accounts. Optional cards and deferred QuickBooks do not block readiness. **Mark Ready / Active** becomes available when the configured required work is complete.

An organization-wide owner/admin can **Edit template** to save a new version. Existing company checklists retain their selected version until changed in Setup choices. Refresh applicable tasks after changing setup choices; retired tasks keep their history. Changed or unavailable evidence can reopen work.

**Keep ownership and financial terms separate.** Enter ownership percentages in the member ledger. In protected owner details, enter distribution percentages independently, the management/operating fee, effective date and executed governing agreement source(s). Draft terms may be incomplete. Confirmed terms require a distribution entry for every current owner, exactly 100% in total, a fee and effective date, and the appropriate executed Restricted originals; explicit 0% is allowed. Ownership and distribution totals are shown separately. These records prepare future financial use and do not themselves calculate payouts or change accounting.

**Use the cabinet safely.** Eight default folders cover applications/agreements, formation/tax, owner entities, licensing/underwriters, banking/accounting, brand/email, disclosures/forms and SoftPro/production setup. Move a file using its folder control; edit its display name or select Current/Final without changing the original filename or bytes. **Delete** moves an eligible file to recoverable **Trash**, where it can be restored. Linked originals, private-record sources, sharing history and Production/import sources have removal safeguards. Use the referenced workflow or a replacement when removal is blocked. Uploading or renaming does not publish a file to partners; sharing remains a reviewed action.

**Track recurring obligations.** Open **Tasks → Renewals & maintenance → Add schedule**. Keep title-company, each owner-entity and agency obligations separate. Confirm the date, source, last verification date and renewal term; domain, email and website can have different dates and multi-year terms. Maintenance is the current source for future renewal dates. Dated private filing updates can align the matching entity schedule; unchanged private records do not rewind a completed cycle.

NC agency license schedules use April 1 annually. SC uses January of even years; its suggested January 1 date is a planning anchor to replace or verify against the applicable notice. Agency E&O is one September obligation, with the exact policy date to confirm, and John's agency credential is tracked once. Entity annual-report and good-standing dates require their own verified sources. These are scheduling records, not a compliance determination.

Due tasks cover the next 14 days and overdue work. **Complete cycle** saves completion history and the next renewal date; the generic task checkbox cannot complete or roll forward a renewal. Pause an inapplicable obligation rather than deleting its history. Owners/admins can open **Reminder delivery**, enter the shared inbox and explicitly enable renewal email. Delivery starts disabled and requires both that opt-in and configured server email delivery. The authenticated scheduler can synchronize due tasks without sending email. Deployment/setup of the worker and scheduler is a separate administrator handoff; see [scheduler activation](../ops/maintenance/activate-scheduler.mjs) and [backend setup](supabase-backend.md).

**Send useful private feedback.** Feedback accepts a deliberately chosen PNG/JPEG screenshot up to 4 MB. Preview and remove it before sending if needed; the app does not capture the screen automatically. Only the report author and workspace owner can open it. Review screenshots for private details before submission.

**Keep the Application tab and DocuSign follow-up.** The prior instruction to retain Application remains in effect. This phase does not replace it with an external-only workflow. The existing DocuSign connector supports reviewed draft preparation and status groundwork; explicit portal sending, completion events and signed-original import remain a separate follow-up. Continue using the external signing process and storing completed originals until that work is available. See [vendor connector scope](vendor-connectors.md).
