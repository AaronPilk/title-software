# Document malware scanning operations

The scanner is a private, authenticated adapter to a local ClamAV daemon. No upload is sent to a public malware-analysis service. It is not deployed or connected to customer documents by this change. Host selection, data location, network access, secrets, and activation are operator decisions. The prepared [Cloudflare hosting package](scanner-hosting.md) terminates public HTTPS at an authenticated Worker and forwards over the private container connection. The standalone service retains loopback HTTPS as its default.

On September 24, the owner approved preparation and testing **without starting paid hosting**. Do not deploy the container package or activate required scanning under that decision. The image verification workflow builds and tests synthetic files on a temporary GitHub runner; it does not provision a scanner host or establish production coverage.

## Receipt and release contract

`web/lib/backend/document-security.ts` exports `scanDocument(env, bytes)`. It returns `clean`, `infected`, or `unavailable`. Missing configuration, unavailable/stale engines, uninspectable archives, malformed receipts, and deadline failures cannot return `clean`.

A successful receipt includes SHA-256, exact byte count, protocol version, scan timestamp, ClamAV version, signature version, and signature database timestamp. The client snapshots the exact byte view, hashes it, sends a fresh request nonce, and validates the echoed nonce, hash, length, versions, and time. HTTPS certificate verification stays enabled, redirects are forbidden, and response parsing is bounded to 4 KiB. Scan timestamps must fall within the current request with 60 seconds of clock tolerance. Signature age must not exceed 72 hours in the client; the service defaults to 48 hours.

The API must bind the receipt to the actual immutable storage bytes and asset/version before releasing that asset to preview, OCR, download, or partner use. Never accept a browser-provided receipt. Never update old assets to `clean` without rescanning their bytes. `infected` includes ClamAV policy/heuristic findings and does not necessarily prove a malicious file. Archive policy failures are `unavailable`, not clean results.

The integration uses an operator-controlled database rollout policy. `pending_setup` records new content explicitly as unscanned while the existing pilot continues; it is not malware protection. `required` must hold upload bytes before normal storage and require a matching clean receipt for release. Activating `required` without a ready endpoint stops new uploads. Existing files remain `legacy_unscanned`; keeping their controlled access is a migration policy, not a backfilled scan.

## Bounded service

Run Node 22.13 or newer. Install the locked dependency with `npm --prefix services/title-scanner ci`. In standalone mode the service listens only on loopback and terminates TLS itself. The explicit container mode is limited to the prepared private ingress architecture described in the hosting runbook; never publish its HTTP port directly. Keep request bodies, authorization headers, names, hashes, and content out of proxy, tracing, error, and access logs. Do not expose `clamd` or its unauthenticated TCP protocol. The adapter only connects to its configured local Unix socket and sends `INSTREAM`, never customer filenames or filesystem paths.

| Setting | Default / limit |
| --- | --- |
| Request bytes | 50 MiB, nonempty, exact Content-Length required |
| Concurrent scans | 2; configurable 1–4, no queue |
| Open HTTPS connections | 16 |
| Header bytes / header count | 8 KiB / 16 |
| TLS handshake / HTTP headers | 5 seconds / 5 seconds |
| Service total request deadline | 25 seconds; configurable 1–30 seconds |
| API total request deadline | 30 seconds; configurable 1–30 seconds |
| ClamAV scan time | 15 seconds |
| ClamAV stream / file / aggregate scan | 50 MiB / 50 MiB / 200 MiB |
| ClamAV threads / queue / recursion / files | 2 / 4 / 16 / 10,000 |
| ZIP member / expanded bytes / members / ZIP nesting | 25 MiB / 100 MiB / 2,048 / 4 |

The API client and service each have independent total deadlines. A stalled response stream cannot hold the API open indefinitely. A service deadline aborts the Unix connection and archive reader. Engine work may continue until its separate ClamAV limit; concurrency and the ClamAV queue remain bounded. Request bodies stay in memory in the adapter, while ClamAV can use its private temporary directory for extracted content. Use a dedicated unprivileged account, protected Unix socket, read-only application files, restrictive temporary-directory permissions, process memory/CPU limits, and a private temporary filesystem with a quota. Disable payload/core dumps and clean the private temp directory after an abnormal daemon exit before restart. No scan payload is retained by application logging.

## Engine policy and archive handling

Use `services/title-scanner/src/engine-config.mjs` to generate the instance's daemon configuration. It explicitly enables archive, PDF, OLE2, XML Office, executable, and mail inspection; rejects encryption and exceeded scan limits through heuristic alerts; requires official signatures; and disables verbose, clean-file, extended-detection, and syslog logging. Do not substitute an arbitrary pre-existing daemon configuration. Keep the daemon and adapter under the same controlled operational deployment and restrict access to the socket to that account.

Actual verification found a compressed ZIP member larger than `MaxFileSize` could receive a clean ClamAV result despite `AlertExceedsMax`. An independent ZIP policy therefore validates central/local record coverage, supported compression, sizes and CRCs, fully reads bounded members, and checks nested ZIPs. Encrypted ZIPs, ZIP64, ambiguous/hidden records, unsupported ZIP compression, and excessive expansion/nesting are rejected. Recognizable RAR, 7z, gzip, bzip2, xz, CAB and tar containers are also rejected. Normal supported Office ZIP containers continue through ClamAV. This deliberately narrower accepted subset can reject benign unusual documents; convert them to a supported, inspectable document through an approved workflow. Never work around a rejected scan by marking it clean.

ClamAV's [protocol documentation](https://docs.clamav.net/manual/Usage/ClamdProtocol.html) defines INSTREAM framing and limits. Its [scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html) explains the unauthenticated daemon interface. The [engine configuration reference](https://github.com/Cisco-Talos/clamav/blob/main/docs/man/clamd.conf.5.in) documents inspection limits and encryption alerts; [upstream issue 633](https://github.com/Cisco-Talos/clamav/issues/633) describes the ZIP limit failure. ZIP parsing uses the pinned [yauzl](https://github.com/thejoshwolfe/yauzl) implementation. Antivirus results are limited detection evidence, not a guarantee that active document content is safe to execute. Preserve existing file-type checks and isolated rendering/OCR.

## Environment configuration

Provide secrets through the runtime's secret environment facility. Do not commit a token, private key, certificate configuration containing secrets, or `.env` file. The TLS key must be a permission-restricted runtime-mounted file; its path is configuration, not the secret itself.

API runtime:

- `TITLE_SCANNER_URL`: exact `https://approved-host/v1/scan`; no query, fragment, userinfo, or redirects.
- `TITLE_SCANNER_TOKEN`: randomly generated printable token, 32–512 characters, matching the service secret. Never provide it to the browser.
- `TITLE_SCANNER_TIMEOUT_MS`: optional, defaults to `30000`, valid `1000`–`30000`.

Scanner runtime:

- `TITLE_SCANNER_TOKEN`: same token from the secret environment.
- `TITLE_SCANNER_TLS_CERT`, `TITLE_SCANNER_TLS_KEY`: TLS PEM file paths. Use a certificate trusted by the API runtime.
- `CLAMD_SOCKET`: absolute protected Unix socket path.
- `TITLE_SCANNER_HOST`: `127.0.0.1` (default) or `::1` only.
- `TITLE_SCANNER_PORT`: `9443` by default.
- `TITLE_SCANNER_MAX_BYTES`: optional reduction of the 50 MiB cap.
- `TITLE_SCANNER_TIMEOUT_MS`: service deadline, default `25000`.
- `TITLE_SCANNER_CONCURRENCY`: default `2`, maximum `4`.
- `TITLE_SCANNER_MAX_SIGNATURE_AGE_HOURS`: default `48`, maximum `72`.

Run `TZ=UTC clamd --foreground --config-file=/private/instance/clamd.conf --fail-if-cvd-older-than=3` and `npm --prefix services/title-scanner start` under the private process supervisor. No `brew services` or system configuration changes are required. Set `TZ=UTC` for the daemon because the version protocol exposes a database date string without an explicit time zone. Check that resource limits accommodate official ClamAV databases and the bounded concurrent scans; the local verification is not a production load test.

Update official signatures using a separate bounded `freshclam` process and isolated database directory. Restrict updater egress to the approved signature source. Confirm successful signature verification, arrange the controlled daemon reload, and monitor signature age without logging document identifiers. The adapter checks daemon version before and after each scan; a reload during a scan fails that request closed. Rotate the shared token in a coordinated service/API change and re-run the synthetic test. Monitor only aggregate service health, timeout counts, blocked counts, and signature age.

## Reproducible local verification

Only synthetic content is used. The EICAR antivirus test string and its ZIP remain in memory; they are not customer data or executable malware. The verifier creates a temporary TLS certificate/key, a loopback HTTPS listener, a private Unix socket and private ClamAV configuration, then stops its own processes and deletes temporary artifacts. It never disables TLS certificate verification. Official signature files can be retained in the ignored task-local database directory for repeat tests.

1. Install the official ClamAV package if absent. On this machine, `HOMEBREW_NO_AUTO_UPDATE=1 brew install clamav` installed ClamAV 1.5.4. No service/autostart was enabled.
2. Create a private task-local database directory and `freshclam.conf` with absolute `DatabaseDirectory`, current-user `DatabaseOwner`, `DatabaseMirror database.clamav.net`, `ConnectTimeout 10`, `ReceiveTimeout 60`, `MaxAttempts 1`, and `TestDatabases yes`. Run `freshclam --config-file=/private/task/freshclam.conf`. This downloads signatures only, not documents.
3. Run `sigtool --info=/private/task/db/daily.cvd` and check `Verification OK`.
4. Run `npm --prefix services/title-scanner test`.
5. Run `SCANNER_VERIFY_DATABASE_DIR=/private/task/db CLAMD_BINARY=/absolute/path/to/clamd npm --prefix services/title-scanner run verify:local`.

Verification also needs `openssl` and `zip`. Tests generate their own short-lived certificates; native Node fetch receives the local CA only through that test child's `NODE_EXTRA_CA_CERTS`. The verifier pauses its own real daemon to prove timeout handling, resumes it, then stops it to prove engine-loss handling. No global daemon is contacted or stopped.

Evidence on 2026-09-24: ClamAV 1.5.4, official daily definitions 28133, build `2026-09-24T06:24:19Z`. Freshclam exited successfully and tested the daily/main/bytecode databases; its Homebrew build printed `NULL X509 store` diagnostics during download, so `sigtool` was also run and independently reported `Verification OK` for the daily database. No certificate bypass was configured. The real HTTPS/API adapter returned clean for synthetic text and detected EICAR directly and inside a ZIP. Encrypted ZIP, over-limit ZIP expansion and nesting, oversized uploads, a paused daemon, and a stopped daemon were blocked. Unit/service tests cover receipt replay/mismatch/staleness, redirects, response bounds, hanging transport/body, auth, concurrency, policy configuration, malformed archives and engine protocol errors.

Activate only by calling the operator-only `title_private.activate_document_scanning()` database function, never by directly updating the policy table. The activation function locks upload tables, labels already-ready existing assets/recipient attachments as `legacy_unscanned`, and then enables enforcement. Unfinalized uploads must retry under the new policy. This preserves later submission of existing recipient attachments without falsely labeling them clean.

Before activating the database's required-scan policy, run the same synthetic clean/blocked/unavailable checks from the deployed API runtime against the approved private endpoint, verify signature updates and alarms, and verify that missing/blocked scans cannot reach storage, preview, OCR or download. This local evidence does not establish hosted reachability, operational monitoring, recovery, performance under load, or production scan coverage. Keep the activation decision explicit.
