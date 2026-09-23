# Vendor connector verification — September 23, 2026

Implemented per-company OAuth connections, DocuSign draft preparation/status
recovery, and QuickBooks Online read-only Profit and Loss reports. Setup and
release boundaries are in [vendor-connectors.md](../vendor-connectors.md).

## Verification completed

- 134 connector tests: 22 DocuSign transport, 17 Intuit transport, 48 actual Edge
  handler, 4 callback parser, 26 actual OAuth return component, 11 actual settings
  component, and 6 refresh/retry regression tests.
- Full API suite: 299/299 (includes the 48 connector handler tests above).
- Existing domain suite: 221/221. Existing sign-in setup UI: 10/10. Existing
  Missive settings/import UI: 11/11. Captured-account client regressions: 4/4.
- Disposable Postgres: 422 assertions across five independent rounds, 12 actual
  concurrent-session scenarios, and 13 actual browser/service role denials.
  The local Vault stub proves transaction and authorization behavior, not
  cryptographic encryption.
- Full TypeScript check, zero-warning lint, pilot production build and Wrangler
  dry run pass. Final production preview opens the real sign-in screen with no
  browser warning/error logs. Connector forms and reports were exercised at
  desktop and 375-pixel mobile sizes using fictional browser fixtures.
- The saved Missive token appears in neither source files nor client assets.

## Bugs found and fixed during verification

- Vendor callback codes could be confused with Supabase sign-in codes. Vendor
  callbacks are captured and removed from the URL before the auth client starts.
- Malformed primitive/null request bodies now return controlled validation
  errors. Both providers enforce streamed response size and time limits.
- RPC transport failures no longer expose private token-save request details.
- Invalid recipient/role inputs are checked before reserving a DocuSign draft.
- Reconnects during refresh are fenced. A failed draft after successful refresh
  can retry its original reservation within the same connection generation;
  reconnect/disconnect invalidates that generation. No second envelope POST.
- Draft status checks retain their account binding across routine token
  refresh, are serialized, and respect the fifteen-minute provider limit.
- Disconnect remains available if server app configuration is missing.
- Late browser results from another company/account do not populate current
  reports, draft forms or callback success messages.

## Hosted checks and remaining acceptance

Migration `20260923191146_title_vendor_oauth_credentials` is applied. All three
new tables have RLS enabled, with no direct `anon` or `authenticated` grants.
The advisor reports informational no-policy notices because these tables use
the existing private service gateway pattern. It reports no security warning or
error for this change.

`title-api` version 19 is active with JWT verification enabled. Its retrieved
source is byte-for-byte identical to the tested bundle. No existing membership,
company data, password, MFA setting or Cloudflare access policy was changed.

The existing Missive token independently returned HTTP 200 for organizations and
teams, discovering one organization and 22 enabled team inboxes. It has **not**
been installed by this release: the CLI lacks secrets write privileges and SQL
execution through the current connector is read-only. The owner can save it
through the existing normal application form. Schema migration/deployment tools
have separate write capability and successfully applied the connector schema.

No real DocuSign/Intuit credentials or consent were available. Provider tests
use controlled transports; browser tests use fictional accounts. No envelope
email, accounting write, payment or live report import was executed. Ordinary
hosted owner verification after the browser restart is pending Cloudflare login;
the existing protection was preserved. Sandbox consent, report comparison,
template review and vendor production approval remain required before calling
either new provider operational.
