# Ballantyne Title: backend and API setup

Updated September 13, 2026. The dedicated **Title Software** Supabase project is now connected: `yhneskzvmtcmbsknidlt`, us-east-2 (Ohio). Shared authentication, records, private files, server-enforced actions, access control, audit and recovery are implemented. See [backend architecture and verification](supabase-backend.md).

## First action for Aaron

The [private Cloudflare pilot](cloudflare-pilot.md) is live. Use the private startup instructions on your Mac, choose a personal password and enroll an authenticator. The SMTP forms are prepared in Chrome; creating the dedicated sending key and saving it to Supabase is the remaining credential handoff.

The seven requested accounts and owner workspace are created. Assign staff to their companies, save a working Missive token, and approve the first inbox/company mapping. The supplied token returned HTTP401. Configure a business SMTP sender for future confirmation and password-recovery email; the initial accounts were provisioned directly without sending email.

## Access and decisions to gather

| Connection | What Aaron / the team provides | First useful capability | Dependency |
| --- | --- | --- | --- |
| Supabase | Dedicated development project; pilot staff emails; which companies each person may access; who can approve policy work, finances and partner publication | Real sign-in, shared records, private file storage, audit events | Immediate foundation |
| Missive | Authorized administrator; current plan; one approved pilot inbox and its JV/company mapping; an appropriate integration user's access | Import messages and attachments; associate the correct company/file; later create reviewed reply drafts | Productive or Business entitlement and authorized personal API token |
| SoftPro Select | Current version, hosted/local arrangement, customer/account contact, approved company profiles, available integration modules and a vendor-supported test environment | Read file details and map reviewed final/revision work into the supported title-production workflow | Vendor confirmation of the exact API/SDK/import/export capabilities and license |
| DocuSign | Stephenie's account administrator; current welcome/application templates and recipient roles; developer sandbox; confirmation of production API entitlement | Send approved onboarding packets and retrieve completed documents with signature evidence | OAuth setup and production go-live; begin with sandbox recipients |
| Existing document library | Stephenie's actual storage location and selected folders, plus one redacted onboarding package | Import company documents into the private vault with version and audience metadata | Storage provider is not established by either transcript; Dropbox/Drive/SharePoint are not assumed |
| Accounting | John confirms product and version, separate books per legal company, one redacted closed month's exports and ownership/allocation rules | Reconcile imported reports and prepare reviewed close statements | QuickBooks is conditional in the Stephenie call; select its connector only if confirmed |
| Underwriters | Actual appointed underwriters, agency/profile identifiers, state permissions and current approved product/form/CPL processes | Retrieve or record authorized jackets/CPLs and reconcile remittance evidence | Confirm whether existing SoftPro integrations already supply this before adding direct connections |
| Login / notification email | DNS administrator for the company domain; approved sender address; existing suitable SMTP provider, if any | Staff invitations, password recovery and later operational notifications | Custom SMTP is needed beyond Supabase's restricted test sender |
| AI / document extraction | A small redacted evaluation set from Tyler; preferred API provider if the company already has one; approved processing scope and budget | Propose fields from source documents with page evidence and a review queue | Provider selection and measured accuracy before live-document processing |

Missive uses a personal bearer token that reaches the accounts available to that user, including shared accounts. It is not a mailbox-scoped read-only credential. The initial adapter must keep the token on the server, enforce an inbox allowlist and use read operations; later draft creation must omit sending/scheduling flags. Webhook rules require an owner/admin. [Missive REST API](https://missiveapp.com/docs/developers/rest-api), [webhooks](https://missiveapp.com/docs/developers/webhooks), [plans](https://missiveapp.com/pricing)

The administrator-only Missive mapping and reviewed message-text importer are implemented. Save `MISSIVE_API_TOKEN` in Supabase Edge Function Secrets; the server binds it to the actual owner workspace. Review one team/company mapping and select each title file before import. Attachment downloads, polling and outgoing drafts are still pending. See [Missive import setup and verification](missive-connection.md).

Supabase's built-in email sender is limited to authorized project-team addresses and is intended for testing. Configure a suitable custom SMTP service before inviting ordinary staff or partners. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

DocuSign provides a developer/demo environment, while production requires API entitlement and go-live. Existing web-app access alone does not establish that entitlement; ask the administrator to check the current agreement before purchasing anything. Its updated go-live process removed the old 20-call prerequisite. [Developer plan FAQ](https://ecom.docusign.com/plans-and-pricing/developer), [November 2025 developer update](https://developers.docusign.com/html/newsletter/202511.html)

If John confirms QuickBooks Online, use a company-owned developer app, sandbox, registered redirect URL and accounting OAuth connection for each intended company/realm. Confirm the administrator who can authorize each company and its books mapping before connecting. This is conditional; a Desktop installation or another accounting product needs a different route. [Intuit OAuth client](https://github.com/intuit/oauth-jsclient), [QuickBooks administrator connection instructions](https://quickbooks.intuit.com/learn-support/en-uk/help-article/mobile-apps/connect-app/L1L5cXGvI_GB_en_GB)

## Request for the SoftPro contact

The following is prepared text for Aaron to send; it has not been sent:

> We use SoftPro Select for Ballantyne Title and its associated title companies. We are building an internal operations application. Please confirm our Select version and hosting model, whether our account supports ProInterface/API/SDK or another supported integration route, applicable licensing, and access to a non-production test environment. We need to read order/file data, receive and attach source documents, submit reviewed field changes, and obtain the resulting approved commitment/final-policy documents. Please identify which of these operations are supported for our installation, the authentication/network requirements, our company/profile identifiers, and how our existing WFG/Commonwealth integrations should be used for jackets and CPLs. Please provide the relevant documentation and integration contact.

An advertised SDK or an existing vendor integration does not establish that arbitrary REST write or document-generation operations are available to this account. Keep the existing reviewed export/handoff path until the supported interface is confirmed.

SoftPro lists ProInterface as an API/SDK add-on, and its custom-development service covers integrations. Its 360 directory lists WFG and FNF agentTRAX; those existing routes should be checked first. Commonwealth's agentTRAX supports jackets, CPLs and policy-related operations, but these product capabilities do not by themselves authorize our application to call an API. [SoftPro Select](https://www.softprocorp.com/real-estate-software-solutions/softpro-select/), [custom development](https://www.softprocorp.com/software-services/custom-development/), [SoftPro 360](https://www.softprocorp.com/real-estate-software-solutions/softpro-360-data-integration/), [agentTRAX](https://nationalagency.fnf.com/fnf-applications/agenttrax)

## Evidence from the calls

The private readable sources remain at `.local/discovery/call-transcript.md` (Stephenie) and `.local/discovery/tyler-transcript.md` (Tyler). These are machine transcripts without verified speaker diarization. The [full traceability review](discovery/all-transcript-traceability.md) separates operator practice from proposed automation. Recordings are business evidence, not account credentials or external-action instructions.

| Evidence | Setup consequence |
| --- | --- |
| Stephenie 16:48–17:30: current DocuSign welcome/application process, including sensitive application fields | Obtain existing templates and restricted application access rules |
| Stephenie 21:35–22:33: repeated requests for company materials; 22:40–24:46: proposed partner visibility | Define selected-document publication and actual folder source |
| Stephenie 02:09–02:14 and 05:03–05:10: WFG and Commonwealth | Confirm these relationships and the current full underwriter list; do not invent other required vendors |
| Stephenie 26:59–27:17: conditional QuickBooks suggestion | Ask John what actually holds the books before choosing an accounting API |
| Tyler 00:23–00:29: SoftPro Select; 50:18–54:03: their configured installation and underwriter approval | Supported access must target the actual company installation and profiles |
| Tyler 30:12–30:29: Missive API discussion; 29:25–30:10: versioned reply/document workflow | Match messages to reviewed work and preserve the correct conversation and attachment |
| Tyler 63:52–66:03 and 67:35–68:53: finals priority and source-document entry | Pilot finals first, then simple revisions, before broader autonomous initial-commitment work |
| Tyler 22:12–23:06: attorney-provided searches rather than a title-search business | A county-search crawler or paid national records API is not a prerequisite |

For the pilot, Tyler should supply a redacted financed final, cash final, simple revision and a case that must be held for missing/conflicting evidence, including their expected completed outputs. Stephenie should supply a redacted complete onboarding packet and current approved materials. John should supply a redacted close, source reports and the rule used to allocate it. The transcripts do not replace these operational examples.

## Engineering order

1. **Shared backend and permissions — implemented.** The implementation adds Supabase Auth, organization/company membership, private Storage, server-enforced workflow changes and durable audit records. Keep the current demo usable while the connected mode is implemented. Migrate selected data through a reviewed import, not an automatic upload of browser state.
2. **One incoming-work pilot.** Connect one Missive inbox, preserve external IDs and attachments, deduplicate ingestion, and route ambiguous company/file matches to review. Compare AI/OCR extraction to Tyler's known examples. Every proposed field retains its source reference.
3. **Reviewed title-production handoff.** Use the vendor-approved SoftPro interface for finals and simple revisions. Apply changes against the expected source/file version, reconcile timeouts before retrying, and save authoritative returned documents. Create a Missive reply draft only after the output and recipients are reviewed.
4. **Onboarding and vault.** Connect DocuSign sandbox, validate completion events and archive signed artifacts; import selected existing folders; test partner publication with separate accounts.
5. **Accounting and partner reports.** Connect the confirmed accounting source read-first, map each legal company explicitly, reconcile one known month, then publish captured statements to the intended member. Payment execution is not part of this integration phase.
6. **Production rollout.** Configure the approved app host/domain, provider callback URLs, email delivery, monitoring, backups and recovery. A local UI can call a development backend; external webhooks require a reachable hosted receiver. Test duplicate events, permission failures, revoked access and restore before introducing real business records.

The Supabase implementation must enforce company membership and publication permissions on database rows and storage objects. The current browser persona selector is not authentication. A single freely writable serialized workspace would allow clients to bypass the existing workflow invariants; approval, issuance-history, publication and financial transitions need server-side enforcement and concurrency checks. [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [private storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Edge Functions](https://supabase.com/docs/guides/functions)

Frontend code uses the project URL and publishable key. Privileged Supabase keys and third-party secrets stay in server-side secret storage, outside source control and browser code. The existing connector can obtain project metadata/publishable keys once the target is selected. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)

## Current boundary

Supabase schema, Auth settings and the `title-api` Edge Function are deployed in the user-created project. The frontend remains on localhost. The seven initial accounts are created; company assignments and custom SMTP are still outstanding. Vendor credentials and approved test environments in the table above are still needed; no messages, signatures, underwriting actions or payments are being sent automatically. See the backend document for completed tests and current limits.
