# QuickBooks connector: read-only company reports

Researched September 23, 2026. Implementation: `web/lib/backend/quickbooks.ts`. Adapter verification uses injected synthetic transports; no live QuickBooks company has been authorized or validated by these tests.

## Implemented provider operations

The adapter builds the Intuit authorization-code URL, exchanges a code, refreshes a connection with the returned token pair, revokes a connection, reads the authorized company's display information, and retrieves a dated Profit and Loss report. Authorization uses `com.intuit.quickbooks.accounting`. Intuit exposes that broad accounting scope; our adapter's accounting operations are fixed GET requests. There is no arbitrary API proxy, journal entry, payment, invoice creation, or accounting write. [Intuit OAuth guide](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0), [official OAuth client](https://github.com/intuit/oauth-jsclient).

The authorization, token and revocation endpoints are pinned to the URLs published in [Intuit's discovery document](https://developer.intuit.com/.well-known/openid_configuration). Redirects are disabled on every server request. Production reads use `quickbooks.api.intuit.com`; sandbox reads use `sandbox-quickbooks.api.intuit.com`. The server selects that origin from a two-value environment setting. Callers cannot supply a provider host or arbitrary path.

Company discovery requests `/v3/company/{realmId}/companyinfo/{realmId}` and returns only the realm ID, company name, legal name and country. CompanyInfo's own `Id` is an entity identifier and is not substituted for the OAuth `realmId`. [Intuit's CompanyInfo OAuth example](https://github.com/intuit/oauth-pythonclient/blob/master/docs/user-guide.rst), [CompanyInfo reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/companyinfo).

Profit and Loss requests `/v3/company/{realmId}/reports/ProfitAndLoss` with explicit `start_date`, `end_date`, and `accounting_method`. Cash and Accrual are supported; Accrual is the adapter default. The response must name the requested report and echo the requested dates and basis. Currency, generation time, columns and hierarchical row text are preserved in a bounded display projection. Monetary strings remain strings; the adapter does not calculate or approve balances. Provider IDs, URLs, addresses, tax IDs and arbitrary extra properties are excluded. [Report parameters in Intuit's SDK](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/ReportService/ReportService.php), [report header schema](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPReportHeader.php), [row schema](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPRow.php).

## Account setup still required

1. Create a QuickBooks Online app in the Intuit Developer portal. Start with its development credentials and a sandbox company.
2. Register the exact application callback URL in Keys & OAuth. Configure the client ID and client secret on the server, with the matching sandbox or production environment. Production requires HTTPS; the adapter allows HTTP loopback callbacks only for sandbox development.
3. An authorized QuickBooks company administrator connects the intended books. Each connection must be mapped to the matching title-company record; 25 title companies must not silently share a single realm mapping.
4. Complete sandbox acceptance using a known report and compare dates, Cash/Accrual basis, currency, totals, reconnect, refresh, and disconnect against QuickBooks itself. Verify revoked staff and other companies cannot access it through the application.
5. Follow Intuit's current production requirements before configuring production credentials and separately authorizing live companies. Sandbox authorization is not evidence of production access.

The adapter does not determine workspace or staff access. The caller must bind a random, expiring, single-use OAuth state to the initiating user, workspace, title company, and current access version; validate it before exchanging the callback; keep tokens encrypted and server-only; and enforce the stored company mapping on every read. A caller must persist both tokens from a refresh atomically and serialize concurrent refreshes. Intuit instructs integrations to use the latest returned refresh token. [Official token lifecycle guidance](https://github.com/intuit/oauth-jsclient#refresh-access_token).

## Bounded behavior and verification

Provider requests use a 20-second abort signal and never retry automatically. Byte limits apply while streaming, including responses without a valid Content-Length: 64 KiB for tokens, 256,000 bytes for company information, and 2,000,000 bytes for reports. Reports allow at most 32 columns, 5,000 visited rows and 5,000 displayed lines, and 12 nested levels. Requested dates must be real calendar dates, ordered, and at most 366 days apart. Oversized or malformed results fail without returning partial data. Vendor/network error text is never returned to callers.

Run from `web`:

```sh
node --test tests/quickbooks.test.mjs
```

The synthetic suite covers endpoint isolation and request protocols, rotating tokens, disconnect, display projection, malicious realm/date inputs, missing or malformed tokens, incorrect report periods/basis, malformed/nested/excessive reports, streamed limits, and sanitized provider/network failures. It does not establish live Intuit account eligibility or report accuracy for the owner's books. Those checks need the real sandbox authorization described above.
