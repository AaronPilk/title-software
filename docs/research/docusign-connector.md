# DocuSign connector implementation notes

Reviewed September 23, 2026. Provider adapter: `web/lib/backend/docusign.ts`. Transport regressions: `web/tests/docusign.test.mjs`.

## Authentication and account selection

The adapter implements confidential Authorization Code Grant with `signature extended`, followed by server-side code exchange and refresh. Sandbox uses `account-d.docusign.com`; production uses `account.docusign.com`. The integration key and secret authenticate the token request with Basic authentication. Rotated refresh tokens must replace the stored token atomically; a refresh error requires reconnection. The `extended` scope is requested during consent, not on refresh. See [confidential code grant](https://developers.docusign.com/platform/auth/confidential-authcode-get-token/) and the [official refresh guide](https://www.docusign.com/blog/developers/authorization-code-grant-refresh-tokens).

The application must bind random state to the initiating authenticated person, company, provider, environment, and configuration revision, expire it, and consume it once. The provider transport does not perform application authorization or store secrets.

Accounts and their regional API origins come from `/oauth/userinfo`. The transport accepts sandbox `demo.docusign.net` and the reviewed production hosts `www`, `na2`, `na3`, `na4`, `ca`, `eu`, and `au` under `docusign.net`. An unfamiliar region is rejected pending review, instead of sending credentials to an unverified hostname. This matches the routing model in [DocuSign's userinfo guidance](https://www.docusign.com/blog/developers/the-trenches-who-are-you).

## Bounded operations

The connector lists up to 100 template summaries, explicitly reporting whether more exist. Template IDs and role names must come from the selected vendor account and the company's approved onboarding template. The adapter creates only drafts (`status: created`) with explicit recipient role, name, and email fields. It accepts no arbitrary documents, callbacks, recipient fields, or send status. Review and sending happen in DocuSign. The endpoint shapes are documented in [Templates:list](https://developers.docusign.com/docs/esign-rest-api/reference/templates/templates/list/) and [Envelopes:create](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/).

Before a draft request, the application must durably reserve a transaction UUID. An uncertain response is never retried automatically. A fixed GET can recover the envelope using that transaction ID; multiple matches are rejected. DocuSign retains these IDs for seven days, so a missing result does not prove a retry is safe. The [official transaction recovery guide](https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created) and [official SDK endpoint implementation](https://github.com/docusign/docusign-esign-node-client/blob/master/src/api/EnvelopesApi.js) describe this mechanism.

Envelope status reads return only the envelope ID, recognized status, and status-change timestamp. The application must space repeated envelope checks more than 15 minutes apart, following [DocuSign's polling rules](https://www.docusign.com/blog/developers/the-trenches-troubleshooting-docusign-connect). This adapter does not install Connect webhooks, download completed originals, send envelopes, or request embedded signing sessions.

Every request disables redirects, uses a shared 20-second deadline including response streaming, and caps decoded responses at 1 MB. Provider errors and extra properties are not returned to the browser. Synthetic tests cover state input, confidential exchange, refresh rotation, origin attacks, environment crossover, malformed and oversized bodies, stalled transports, draft-only behavior, recipient validation, ambiguous failures, and recovery.

## Account setup and remaining live acceptance

Create a developer account and integration key, generate its client secret, register the application's exact callback URI, and authorize the intended account. Provide the account's approved template and recipient-role mapping. Credentials belong in server secret configuration, never in Git or frontend settings bundles.

Before production use, complete DocuSign Go-Live and confirm an API-capable plan. Production secrets, redirect configuration, accounts, and templates need separate setup; sandbox templates do not become production templates automatically. See [production setup](https://www.docusign.com/blog/developers/dsdev-from-the-trenches-your-apps-approved-for-go-live-now-configure-your-production-account) and [developer account eligibility](https://ecom.docusign.com/plans-and-pricing/developer).

No live DocuSign request was made for the adapter tests. Real consent, callback, refresh, account mapping, template discovery, draft creation/recovery, and status checks still require a sandbox account. Production acceptance remains a separate check after vendor approval.
