# DocuSign and QuickBooks company connections

These connectors use OAuth authorization, not a personal API token. They are
implemented for the shared workspace. Vendor acceptance still requires actual
developer apps, consent and test accounts. Sample mode never contacts vendors.

## What is implemented

- Per-company account connections managed by the owner or an organization-wide
  administrator after normal password/MFA sign-in.
- Ten-minute, single-use authorization state bound to the initiating user,
  membership version, workspace, company, vendor and environment.
- Server-only encrypted access/refresh tokens, refresh serialization, reconnect
  fencing, local disconnect and company-specific connection checks.
- DocuSign account verification, template discovery, explicit reviewed **draft**
  creation, durable retry reservations, status lookup and recovery lookup by
  transaction ID. Creating a draft does **not** send an envelope. Review and send
  through DocuSign itself. Automatic sending, Connect webhooks and completed-PDF
  retrieval are not part of this connector release.
- QuickBooks Online company identity and dated Profit and Loss reports with Cash
  or Accrual basis. A realm cannot be silently mapped to two companies in the same
  workspace/environment. The report is read-only: no ledger posting, bank
  transaction, reconciliation approval, payment or remittance change occurs.

## Developer app setup

Create a DocuSign developer account/application and an Intuit developer
application for QuickBooks Online. Start in their sandbox environments. Obtain
each application's client ID and client secret. For DocuSign the client ID is
also called an integration key; record the desired account ID and approved
template IDs/role names separately.

Register this **exact** redirect URI, including its trailing slash, in both apps:

```
https://title-software-pilot.aaron-9c3.workers.dev/
```

The user's browser returns through the existing Cloudflare gate. No public
webhook or authentication bypass is needed. Stay signed in to the pilot during
consent. If an approval expires or the browser session changes, start again.

Install the following **server-only Supabase Edge Function secrets**. Never put
them in `NEXT_PUBLIC_*`, the frontend environment, git, or workspace backups.
The Supabase account used for installation must have write privileges.

```
TITLE_VENDOR_REDIRECT_URI=https://title-software-pilot.aaron-9c3.workers.dev/
DOCUSIGN_CLIENT_ID=<integration-key>
DOCUSIGN_CLIENT_SECRET=<secret-key>
DOCUSIGN_ENVIRONMENT=sandbox
QUICKBOOKS_CLIENT_ID=<client-id>
QUICKBOOKS_CLIENT_SECRET=<client-secret>
QUICKBOOKS_ENVIRONMENT=sandbox
```

Each vendor can be configured independently. Configuration alone does not mean
an account is connected. The UI enables consent only after the server has all
required values. Use the intended deployed hostname if it later changes, and
update both vendors' registered redirect URIs at the same time.

OAuth scopes: DocuSign `signature extended`; Intuit
`com.intuit.quickbooks.accounting`. Intuit's accounting scope is broader than the
read-only operations exposed by this application. Secrets stay on the server.

## Owner connection flow

1. Create the company profile in the shared workspace.
2. Open **Settings → Connections**, choose DocuSign or QuickBooks, then the company.
3. For DocuSign, enter the account ID you intend to use. For QuickBooks, select
   the correct books during Intuit consent. Confirm the returned company name.
4. Connect and approve access on the vendor's own site. The pilot verifies the
   returned account and saves the encrypted credentials for that company.
5. Run **Check connection**. Test DocuSign with an approved fictional template
   and recipients, and compare a QuickBooks sandbox report to the same report in
   QuickBooks for an identical period and basis.
6. Complete vendor production approval, install production credentials and
   environment, then explicitly reconnect each authorized company. Sandbox
   credentials and template IDs must not be assumed valid in production.

**Disconnect** removes this company's local credentials and invalidates pending
approvals. It does not revoke consent at the vendor. Revoke the app from the
vendor's account settings when that is also required.

## Retries and operational limits

An uncertain DocuSign draft request remains recorded. Retrying the same request
does not create another draft. Check its status; if it cannot be found, inspect
DocuSign before preparing a new request. Transaction IDs are retained by
DocuSign for seven days, so a missing lookup is never proof no envelope exists.
Repeated envelope checks are limited to more than fifteen minutes apart.
Template discovery is bounded to the first 100 templates and explicitly marks
additional results. Reports are bounded to approximately one year and finite
row/byte limits; use a shorter period when necessary.

The code does not follow arbitrary vendor URLs or expose vendor error bodies.
App setup errors, revoked consent and expired refresh credentials require an
administrator to reconnect. Existing company records are preserved.

## Missive

Missive uses its complete personal token, including the `missive_pat-` prefix.
In the hosted workspace, **Settings → Connections → Connect Missive → Verify and
save connection** tests the token before saving it in Vault. Discovery success
alone does not install the credential. After saving, review each inbox-to-company
route explicitly; do not guess which of the joint ventures owns a mailbox.
Incoming message/attachment import is reviewed. Outgoing sends and scheduled
polling are separate work.

## Sources and vendor acceptance

See [DocuSign source notes](research/docusign-connector.md) and
[Intuit source notes](research/quickbooks-connector.md). DocuSign production needs
Go-Live approval and an API-capable plan. Intuit production credentials and app
requirements must also be completed in its developer portal. Fixture tests do
not establish live account consent, delivery, report accuracy or vendor approval.
