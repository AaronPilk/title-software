# Dependency security remediation — October 28, 2026

The web production audit reported five affected packages (one critical, three high, one moderate). Their locked versions are now patched. The review also included development tooling and the scanner packages, because vulnerable build and local-runtime dependencies should not be left behind.

| Package or supported group | Before | After | Reason |
| --- | --- | --- | --- |
| Next / eslint-config-next | 16.3.6 | 16.4.3 | Patched 16.x release; aligned runtime and lint configuration |
| Zod | 3.25.76 | 4.6.7 | Collection-validation resource exhaustion fix; existing resolver peers accept 4.x and application source has no direct Zod import |
| fast-uri | 3.1.8 | 3.1.9 | URI interpretation fixes, within existing parent ranges |
| source-map-js | 1.2.1 | 1.2.2 | Indexed-source-map resource exhaustion fix, within existing parent ranges |
| sharp | 0.35.4 | 0.35.5 | Patched native SVG dependency, including the Miniflare copy |
| Vite | 8.3.0 | 8.3.5 | Patched development-server release |
| Cloudflare Vite plugin / Wrangler | 1.57.3 / 4.136.3 | 1.66.0 / 4.154.0 | Supported matching pair resolves patched Miniflare, Undici and sharp |
| Cloudflare Workers types | 5.20260922.1 | 5.20261023.1 | Satisfies the updated Wrangler peer range |
| Vinext | 1.0.0-beta.11 | 1.4.0 | Supported dependency path to patched OG renderer/Satori |
| React / React DOM / React Server DOM Webpack | 19.3.0 | 19.3.1 | Satisfies the supported Vinext peer set |
| Vite RSC plugin | 0.5.35 | 0.5.37 | Satisfies the supported Vinext peer set |

The scanner host also updates its development Wrangler dependency to 4.154.0. The scanner service has no dependency changes.

The assistant service updates Agents SDK 0.23.0 to 0.31.0 and Wrangler 4.136.3 to 4.154.0. The supported SDK dependency tree removes unused MCP server dependencies and patches the remaining MCP client and Zod dependencies. Application source, Durable Object bindings, the existing migration, private routing, and compatibility date are unchanged.

The only new override is `satori → fflate: 0.7.5`. The patched Satori release pins vulnerable fflate 0.7.3; this override takes the same 0.7 release line to its security patch. No `npm audit fix --force`, ignored peer conflict, global security bypass, framework major upgrade, compatibility-date change, or paid scanner activation was used.

## Verification

- Full and production-only npm audits: zero findings in `web`, `services/title-scanner`, and `services/title-scanner-host`.
- Assistant service: full and production audits have zero findings; clean locked install, typecheck, 33 tests, and deployment dry run passed. A new installed-SDK regression exercises a real local SQLite Durable Object, successful synthetic completion, separation between users, history after restart, and deletion without resetting quota. An actual 0.23-to-0.31 bundle upgrade against the same local SQLite store also preserved conversation history, quota, and user isolation; a persistent regression seeds the legacy schema and checks migration and idempotent retries. Backend and AI calls remain local synthetic fixtures.
- Additional backend, API, and security regressions passed: 129, 386, and 32 tests respectively.
- A fresh `npm run install:ci` from the final web lockfile completed; the audit and native sharp check also passed afterward. Installation was isolated from the main checkout.
- Web typecheck and zero-warning lint passed.
- Domain suite: 221/221 passed.
- Browser regression selection: 24/24 passed, including Agency navigation, document links and unsaved-change guards; desktop/mobile glass controls and accessibility preferences; 30-page scanned and mixed PDFs through the field-review UI.
- Scanner service: 20/20 passed.
- Scanner host: typecheck, 13/13 gateway/native runtime tests, and deployment dry run passed. Its enabled flag remains false.
- Pilot build and packaging dry run passed with the updated framework/runtime. The built Worker served the branded landing page with HTTP 200 in the local native runtime.
- Library checks passed for sharp SVG rasterization and PNG resizing, Zod v4 form-resolver valid/invalid values, fflate archive round trip, and source-map lookup.

The pilot build retains non-fatal bundle-size, plugin sourcemap and route-classification warnings. No source configuration was changed to hide them. This dependency change does not certify security or compliance, activate antivirus, verify external integrations, or change business data.

The CI security gate now installs and checks the assistant service as well. Audits cover application and development dependencies in all four package trees, with moderate or higher findings failing the gate. The assistant service requires its own deployment; deploying the frontend alone does not update it.

A standalone Node 25 smoke import of `@vercel/og` encountered its upstream bundled Harfbuzz `require("fs")` limitation. The application has no OG image endpoint; the actual Cloudflare Worker build and landing-page runtime passed. This check does not establish Node-hosted OG rendering support. The isolated local assistant service was not running during the landing-page smoke, so its 503 response is not counted as an authentication or assistant integration test.

## Upstream references

- [Next.js patched versions and SVG dependency advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw)
- [Next.js 16.4.3 release](https://github.com/vercel/next.js/releases/tag/v16.4.3)
- [sharp 0.35.5 release](https://github.com/lovell/sharp/releases/tag/v0.35.5)
- [Zod 4.6.7 release](https://github.com/colinhacks/zod/releases/tag/v4.6.7)
- [Zod collection-validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Satori advisory](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp)
- [fflate ZIP64 advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98)

Versions, dependency ranges, and peer compatibility were also checked against the npm registry. Audit results are a point-in-time check of published advisories, not an exploitation assessment.
