# Prepared Cloudflare scanner hosting

**Prepared only. No paid host is deployed and upload enforcement is not activated by these files.** Aaron chose to prepare the package and defer paid hosting. Deploying the Worker/container, enabling its warm schedule, writing runtime secrets, or changing the database policy is a later operator action. Existing pilot originals remain `legacy_unscanned` until independently scanned; never relabel them clean.

## Architecture and operating cost

`services/title-scanner-host` supplies authenticated HTTPS ingress and one named Cloudflare Container. The Node service verifies exact byte hashes and request nonces, applies archive bounds, and calls ClamAV over a protected Unix socket. Bodies stream through the Worker without document persistence; ClamAV and the bounded adapter hold the bytes only for scanning and temporary extraction.

The prepared Wrangler configuration uses standard-2 (1 vCPU, 6 GiB memory, 12 GB disk), maximum one container, and an `ENAM` placement constraint. ENAM is Eastern North America, not a claim of United States-only processing. Cloudflare, Supabase, and all other processors still need inclusion in the data-flow/vendor review. Current published memory/disk rates imply about $41/month at 720 running hours, before active CPU and shared Worker/Durable Object usage. A $50–$80/month planning range is an estimate, not a cap or quote; usage can exceed it. See [pricing](https://developers.cloudflare.com/containers/platform/pricing/) and [placement](https://developers.cloudflare.com/containers/concepts/placement/).

ClamAV can need substantially more memory during signature reloads; this instance size allows headroom above its [recommended memory](https://docs.clamav.net/manual/Installing/Docker.html). Real hosted load, restart, egress, monitoring, and data-location checks are still deployment acceptance requirements.

## Security boundaries

- Standalone mode retains authenticated loopback HTTPS and mandatory TLS files. `cloudflare-private-http` is an explicit new transport for the private Container port only. Never expose that port to the public internet or a shared network. The Worker rejects external HTTP; Supabase's scanner client still requires HTTPS and certificate verification.
- Public ingress authenticates and validates headers before obtaining a Durable Object or starting compute. Missing token, disabled configuration, unsupported paths, wrong protocol, compressed request bodies and declared oversize are rejected before forwarding.
- The gateway streams through `FixedLengthStream`, checks actual bytes against the declared size, and bounds upload/response/transport work to 28 seconds. Replies are bounded to 4 KiB. Redirects are rejected without following them. The API's existing receipt verification remains authoritative.
- The Node server and Durable Object each allow at most two concurrent requests. Health is authenticated and checks `PING`, engine version and fresh official definitions. Engine timeout, unavailable engine, stale definitions and ambiguous archives remain failures.
- The image runs as the unprivileged `clamav` account, with no ClamAV TCP listener, no customer files/logs, a private temporary directory and a foreground supervisor. The Node binary and official ClamAV base images are pinned by registry digest. Docker build context is restricted by `.dockerignore`; runtime tokens and local evidence cannot enter it.
- Container internet access defaults off. A Worker egress handler permits only HTTPS GET/HEAD requests for official signature paths at `database.clamav.net`, strips credentials, rejects query strings/redirects, and denies other hosts. Cloudflare's runtime egress CA is combined with the OS CA bundle into a private file for Freshclam, using its documented `CURL_CA_BUNDLE` support; certificate verification stays enabled. [Egress documentation](https://developers.cloudflare.com/containers/guides/outbound-traffic/), [Freshclam trust configuration](https://docs.clamav.net/faq/faq-freshclam.html)
- Only aggregate lifecycle/health events are logged. Proxy access/body logging is disabled. Health state contains timestamps and failure counts, not document identifiers. No payload is written to Durable Object storage.

## Startup, signatures and monitoring

`TITLE_SCANNER_ENABLED` is committed as `false`. The prepared five-minute Cron handler does nothing until the flag is explicitly enabled and a valid token is installed. After enabling, it maintains one fixed container. Freshclam runs before opening the listener, with a bounded initial update; the engine must pass readiness before uploads can be scanned. Customer requests get an unavailable response during warmup instead of holding open through definition downloads. Initial warmup can take several minutes.

Freshclam verifies official signatures and tests databases, then notifies ClamAV after updates every six hours. The adapter refuses signatures older than 48 hours. The filesystem is ephemeral: every restart downloads definitions afresh, so a deployment must verify upstream limits and initialization time under the real account. Do not create a container per document. A growing installation should add a controlled verified definition cache before scaling beyond this single instance.

Five-minute health checks persist status/backoff across Durable Object eviction. Failures back off to ten minutes, below the fifteen-minute idle timeout. Cron execution has bounded CPU; no rapid recursive alarms or customer-triggered retry loops are used. Status transitions appear as aggregate Worker logs. **An external alert/uptime destination is not configured by this package.** Select and prove one before production activation; logs alone are not an alerting program. Signature failures, blocked uploads, timeouts, capacity and cold starts need an on-call owner.

## Build and verify without provisioning

Run from the repository root:

```sh
npm --prefix services/title-scanner ci
npm --prefix services/title-scanner test
npm --prefix services/title-scanner-host ci
npm --prefix services/title-scanner-host run typecheck
npm --prefix services/title-scanner-host test
npm --prefix services/title-scanner-host run dry-run
```

`wrangler deploy --dry-run` packages the Worker but does not prove the container image or hosted service works. On a Linux runner with Docker:

```sh
docker build --platform linux/amd64 -t title-scanner:verify services/title-scanner
```

Start that image with a temporary runtime `TITLE_SCANNER_TOKEN`, a loopback-only mapped port, at least 6 GiB memory, PID/CPU limits, dropped capabilities, and no-new-privileges. Do not print the token. Then set `TITLE_SCANNER_URL=http://127.0.0.1:18080` and the same token in the test process environment and run:

```sh
node --experimental-strip-types services/title-scanner/scripts/verify-container.mjs
```

The verifier waits at most seven minutes, then checks clean bytes, EICAR, EICAR ZIP, encrypted/over-limit archive rejection, authentication and route boundaries. It accepts loopback HTTP only. It never activates the database policy. The runner must remove its container/token afterward; this script does not remove unrelated processes or containers.

The optional hosted verifier requires an exact HTTPS `/v1/scan` URL and token in the operator process environment:

```sh
node --experimental-strip-types services/title-scanner-host/scripts/verify-hosted.mjs
```

It sends synthetic content only. Passing from a laptop does not prove Supabase Edge-runtime reachability or fail-closed Storage integration.

## Later deployment and activation

After hosting/cost approval, use Cloudflare Workers Builds with project root `services/title-scanner-host`, build `npm ci && npm run typecheck`, deploy `npx wrangler deploy`. Cloudflare's build environment can build the Dockerfile; local Docker is not required. Alternatively, a Linux CI runner can build/push through Wrangler to Cloudflare's managed registry using an approved scoped deployment token. GHCR is not currently one of the documented direct image sources, so do not assume a GHCR URL is deployable. [Deployment](https://developers.cloudflare.com/containers/guides/deploy/), [image management](https://developers.cloudflare.com/containers/guides/image-management/)

1. Verify image build and synthetic container tests. Inspect image vulnerabilities, exact engine/version and pinned source digests.
2. Deploy an isolated staging scanner first. Install a fresh random server token without putting it in source, arguments, screenshots or chat. Enable only that staging host, wait for fresh health, and prove its allowed/denied egress and resource limits.
3. Verify clean/EICAR/archive/failure behavior from a deployed Supabase runtime. Test engine-down, stale definitions and timeout using staging, not by interrupting users. Confirm zero Storage writes after rejected scans through all four upload paths.
4. Verify worker/container deployments independently because image rollout is not transactional. Configure the approved production host and alert destination; prove restart, signature update, timeout and capacity behavior.
5. Install the exact approved `TITLE_SCANNER_URL` and shared token in both `title-api` and `title-jv-public`. Keep current recipient capability authentication. Do not expose the token to browser code.
6. Call the operator-only `title_private.activate_document_scanning()` function only after those checks. This transitions upload enforcement and grandfathers accepted originals without fabricating clean receipts. Never directly update the policy table.
7. Repeat normal upload, EICAR rejection and scan-audit checks. Retain dated evidence and update the security program. If the service fails, fix or roll back its deployment while uploads fail closed; never silently return to unscanned acceptance.

This package does not perform the paid deployment, host activation, database activation, external alert enrollment, independent assessment, or a production capacity claim.
