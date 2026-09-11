# Tyler workflow: Missive integration and county record availability

Research accessed **September 11, 2026**. This is documentation research, not a live integration test. The new call, as relayed by the implementation lead, reports Missive, approximately 20–23 active JVs, and the sequence: request email → correct JV/SoftPro profile → correct file → revised loan amount → regenerated commitment named by file number → reply draft with attachment for human review. Those are reported business requirements. Vendor and county findings below are independently sourced.

## Missive capability fit

Missive provides the email-side primitives for this workflow. It does not establish that the customer's SoftPro installation permits API changes or commitment generation; that remains a separate integration dependency.

The official **Endpoints** reference documents:

| Need | Supported operation or constraint |
|---|---|
| Find the thread | `GET /v1/conversations`, with mailbox/team/label filters; `GET /v1/conversations/:id`. |
| Read content | `GET /v1/conversations/:id/messages` excludes drafts; `GET /v1/messages/:id` returns full body, headers and attachment metadata/URLs. |
| Inspect drafts | `GET /v1/conversations/:id/drafts`; `DELETE /v1/drafts/:id` exists. |
| Prepare reply | `POST /v1/drafts`; use `conversation` or email `references`, explicit recipients and an authorized `from_field` alias. |
| Attach regenerated PDF | Up to 25 attachments, each with `base64_data` and `filename`; total JSON request ≤10 MB. |
| Preserve human review | `send: true` sends immediately; `send_at` schedules sending. Neither belongs in the draft-only adapter. |
| Preserve recipient threading | Set `subject` to `Re: [original subject]`. Missive supplies reply headers from the conversation's latest email. |
| Subscribe programmatically | `POST /v1/hooks` creates rule-backed subscriptions; `DELETE /v1/hooks/:id` removes them. |

The email-send path is drafts; `POST /v1/messages` serves incoming custom-channel messages. Outgoing rules also execute for API sends. [Missive — Endpoints](https://missiveapp.com/docs/developers/rest-api/endpoints)

## Authentication and operating constraints

The REST base is `https://public.missiveapp.com/v1`. Authentication uses a personal API token in the Bearer authorization header. Missive explicitly has no organization-level or shared-account-specific token: a user's token reaches all accounts that user can access, including shared accounts. Request filters narrow results; they are not separate credential scopes. The REST overview lists the Productive plan prerequisite for token creation. Successful responses are 200/201, and a successful POST can have an empty body; JSON POSTs require the proper Content-Type. [Missive — Rest API](https://missiveapp.com/docs/developers/rest-api)

**Recommended implementation:** keep the credential on the future server, use an approved integration identity with limited account access, and maintain an explicit shared-mailbox → JV → SoftPro profile mapping. Never derive a trusted JV solely from an email display name or subject. Expose credential status in Settings without displaying the token. Verify the customer's plan, mailbox membership and operational ownership before connection.

Missive permits **5 concurrent requests, 300 requests/minute and 900 requests/15 minutes**. A 429 supplies `Retry-After` and rate-limit/reset headers. The documented steady rate is one request/second; batch message reads can reduce request volume. Plan a single coordinated limiter per credential, caching and backoff rather than independent polling for each JV. [Missive — Rate Limits](https://missiveapp.com/docs/developers/rest-api/rate-limits)

Webhook rules support incoming/outgoing email and label events. Creating a rule sends a validation POST immediately. Rules require an owner/admin on Productive or Business. A receiver must respond within 15 seconds; failures retry up to five times over eight minutes, and more than 50 consecutive failures disable the rule. With a validation secret configured, `X-Hook-Signature` carries an HMAC-SHA256 signature of the raw body. [Missive — Webhooks](https://missiveapp.com/docs/developers/webhooks)

**Recommended implementation:** validate signatures, persist the event before acknowledging it, then process through a queue. Deduplicate by provider message/event identity and our workflow revision. Track stalled jobs and disabled-rule recovery. Fetch authoritative email content instead of treating the webhook's preview as the complete request. These are backend requirements for the later connection phase; the local MVP should simulate the events.

## Proposed workflow contract

1. **Request received:** show original sender, recipients, email text, source message ID and attachments.
2. **File matched:** require an unambiguous JV, SoftPro profile and file match; route uncertain matches to Tyler's review queue.
3. **Change reviewed:** display original/requested loan amounts as exact cents, the request evidence, reviewer and expected file version. Reject stale edits when another operator has changed the file.
4. **Commitment prepared:** record document revision, file number, filename and content hash. Later, only the approved SoftPro/underwriter process can establish that this is a real regenerated commitment.
5. **Reply draft ready:** review sender alias, recipients, subject, attachment and thread freshness. Save the provider draft ID after confirmed creation. Keep a human send action in Missive for the initial integration.
6. **Sent confirmed:** advance only on reconciled provider evidence, with a separate delivery-failure state. Creating a local preview or a provider draft does not establish sending.

Use a unique operation key for each requested change. After a timeout, reconcile the prior attempt before creating another draft. Existing drafts may have human edits: do not replace them silently. The local MVP should use labels such as “Draft preview” and “Simulated commitment,” with visible pending-connection states. No bank execution is part of this workflow.

## Union County versus Mecklenburg County, North Carolina

| County | Verified official availability | Product consequence |
|---|---|---|
| **Union** | The county's July 9, 2024 notice says property deed information is available online at no charge. Its current FAQ says its website contains deeds from 1973 and maps from 1842. The Land Records FAQ limits the deed lookup to deeds/plats and states mortgage information is unavailable online. | “Entirely offline” overstates the limitation. Show **partial online coverage; manual research required for gaps**. Preserve Tyler's reported courthouse work as a workflow requirement, then validate exactly which records require it. |
| **Mecklenburg** | The county advertises online modern land records from March 1990 onward and historical records/images from 1763 through February 1990. | Provide separate modern/historical source links and capture the searched period; do not equate a successful web search with a completed title examination. |

Sources: [Union — Beware of Scam Letters Targeting Residents for Property Deed Information](https://www.unioncountync.gov/Home/Components/News/News/1621/), published July 9, 2024; [Union — FAQs](https://www.unioncountync.gov/government/departments-r-z/register-of-deeds/faqs); [Union — Land Records](https://www.unioncountync.gov/government/departments-r-z/register-of-deeds/land-records); [Mecklenburg — Search Real Estate Records](https://deeds.mecknc.gov/services/real-estate-records).

Mecklenburg's official page links its [modern record portal](https://meckrod.manatron.com/) and [historical index](https://www.meckrodhistorical.com/). The modern portal was reachable with a public-access disclaimer. No actual record search, completeness check, or document download was performed. Union's Land Records/FAQ content was verified through the official-domain search extraction; direct page fetching was inconsistent. Its county-issued announcement independently confirms the existence of online deed access.

## Remaining facts to establish before integration

Confirm Missive plan/permissions and authorized JV mailbox mappings; SoftPro edition, hosted environment and permitted write/document-generation interfaces; commitment template/underwriter requirements; original-versus-reply thread handling; expected PDF sizes; customer retention rules; county coverage and indexing lag; and any vendor-approved county search API. No public county API or scraping permission was verified. Store each title-research task's jurisdiction, source, date range, evidence, reviewer and unresolved gaps rather than one “online/offline” flag.
