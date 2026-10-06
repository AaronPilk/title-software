# Agency maintenance scheduler

The worker creates shared maintenance tasks when a verified date is overdue or within 14 days. It checks hourly, uses the existing Supabase database and Edge Functions, and introduces no new hosting service or paid plan. Existing project database, network and function usage still applies. Task creation and reminder delivery are separate: scheduling can run with email delivery disabled.

## Deployment and activation

Run commands from the repository root against the intended linked project. Migration and deployment are release operations; local tests do not activate the scheduler.

1. Apply the checked-in Phase One migrations, including `20261006152848_title_agency_maintenance_runner.sql`, in chronological order through the normal release path. The migration installs service-only worker functions, durable delivery state and system audit support. It schedules a job automatically only when `pg_cron` and `pg_net` already exist; absent Vault configuration makes that job a no-op.
2. Build and deploy the worker:

   ```sh
   npm --prefix web run backend:build
   supabase functions deploy title-maintenance --project-ref "$SUPABASE_PROJECT_REF"
   ```

   Keep `verify_jwt = true` from `supabase/config.toml`. The handler additionally requires the exact dedicated `TITLE_MAINTENANCE_SCHEDULER_KEY`; it fails closed when that setting is absent and does not fall back to `SUPABASE_SERVICE_ROLE_KEY`. The database client continues to use its built-in `SUPABASE_SERVICE_ROLE_KEY` independently. An anonymous or ordinary user JWT is rejected even when the gateway accepts its signature. Use an unexpired service-role JWT for this project as the dedicated scheduler key so it also passes gateway JWT verification. The Vault bearer and dedicated function setting must match exactly; neither needs to equal the built-in database client key.
3. Provide `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `TITLE_MAINTENANCE_SCHEDULER_KEY` through the deployment process's protected environment. Do not place raw values in shell arguments, screenshots, checked-in files, debug logs or SQL output. Install the same dedicated scheduler key as a function secret using a protected mode-0600 environment file; do not overwrite the built-in `SUPABASE_SERVICE_ROLE_KEY`:

   ```sh
   supabase secrets set --env-file "$scheduler_env_file" --project-ref "$SUPABASE_PROJECT_REF"
   ```

   The file must contain `TITLE_MAINTENANCE_SCHEDULER_KEY=<the valid project service-role JWT>`; remove it after installation. Redeploy the worker after changing this wiring. Validate and activate:

   ```sh
   node ops/maintenance/activate-scheduler.mjs
   node ops/maintenance/activate-scheduler.mjs --activate
   ```

   The first command checks configuration without a network request, including the JWT role (`service_role`), project reference and future expiration. This decodes claims to catch mistakes; only the Edge gateway verifies the signature. The second uses the Management API in one database transaction to install available `pg_cron` and `pg_net` extensions, upsert Vault names `title_maintenance_worker_url` and `title_maintenance_service_role_key` (the latter contains the dedicated scheduler key, retaining its existing database name), and register the named hourly job `title-agency-maintenance`. The endpoint is `https://<project-ref>.supabase.co/functions/v1/title-maintenance`. Repeating activation updates the named job and Vault configuration. Activation does not invoke a tick or enable email.

   A release operator already authenticated through the linked CLI may instead generate a mode-0600 SQL file from protected environment values containing the same transaction and apply it with `supabase db query --linked --file "$activation_file"`. Use the statements in `activate-scheduler.sql` and the Vault update/create logic in `activate-scheduler.mjs`, quote SQL literals correctly, suppress result bodies, and remove the temporary file afterward. Never commit this generated file. A database administrator must create the cron job: its execution identity needs to execute the private invoker and access Vault. The `service_role`, `anon` and `authenticated` roles deliberately cannot call the private invoker directly.
4. Verify extension availability, cron registration and Vault names with the read-only checks below. Wait for the next hourly tick to verify function execution. A manual authenticated POST is an actual worker run that can create tasks and, if all delivery gates are enabled, send reminders; it is not a read-only health check.

Activation needs project Management API database-query access (or an equivalently authorized linked CLI session), database privileges for extension installation, Vault and cron, Edge Function deployment access, and the valid dedicated scheduler JWT installed identically in the function environment and Vault. The last pre-release inspection found Vault installed but `pg_cron` and `pg_net` absent; confirm their availability before activation. Missing credentials or unsupported extensions must be resolved in the existing project. The release owner should run hosted security/performance advisors after installation; the local PostgreSQL tests do not verify hosted extension grants or cron availability.

## Email is disabled by default

A provider request occurs only when **both** sets of gates pass:

- The worker has `TITLE_MAINTENANCE_EMAIL_ENABLED=true`, a nonblank `RESEND_API_KEY`, and a valid sender in `TITLE_MAINTENANCE_EMAIL_FROM` or the existing `TITLE_APPLICATION_EMAIL_FROM` fallback. Omitted or false enablement disables sending.
- The workspace's Maintenance reminder settings explicitly enable delivery and contain a valid shared recipient. Blank recipient/disabled settings produce no eligible delivery. A pending item must still represent the current active, unfinished cycle when its lease is checked immediately before provider I/O.

Set server secrets through a protected mode-0600 environment file with `supabase secrets set --env-file "$runtime_env_file" --project-ref "$SUPABASE_PROJECT_REF"`; remove the file afterward. Keep the enable flag false until the shared inbox and verified Resend sender are approved. UI settings alone cannot bypass the server gate. With server sending disabled, tasks still materialize and enabled workspace settings may queue durable reminders; review those settings before later enabling delivery.

Messages contain only the shared company name, task title and due date. Private records, identifiers, notes, document links and screenshots are excluded. One run scans up to 25 workspaces and submits at most 10 reminders, with at most five from one workspace. Database compare-and-swap and stable task identities prevent stale snapshots from overwriting current work.

## Safe monitoring

Use a privileged database operator session. These read-only queries return metadata and counts, not secret values or recipient addresses. Run cron-specific queries only after its extension is installed. Do not select from `vault.decrypted_secrets`, inspect the invoker's HTTP Authorization header, or export raw workspace/outbox payloads.

```sql
select name, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net', 'supabase_vault');

select jobid, jobname, schedule, active, username
from cron.job where jobname = 'title-agency-maintenance';

select name, count(*)
from vault.secrets
where name in ('title_maintenance_worker_url', 'title_maintenance_service_role_key')
group by name;

select p.proname, p.prosecdef,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as user_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'title_private' and p.proname = 'invoke_maintenance_worker')
   or (n.nspname = 'public' and p.proname in
       ('title_maintenance_candidates', 'title_materialize_maintenance',
        'title_claim_maintenance_email', 'title_check_maintenance_email',
        'title_finish_maintenance_email'));

select status, count(*) from title_private.maintenance_outbox group by status;
select min(checked_at) as oldest_check, max(checked_at) as latest_check,
       count(*) as workspaces_checked from title_private.maintenance_runner_state;

select created_at, revision, detail->>'createdCount' as created_count
from public.title_audit where action = 'maintenance.tasks_created'
order by id desc limit 20;

select d.status, d.start_time, d.end_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname = 'title-agency-maintenance'
order by d.start_time desc limit 20;
```

The private invoker should have `prosecdef=true` and all three displayed execution grants false. Public worker RPCs are security invoker functions; only the service role should have execute permission. Browser roles must have no table privileges on private delivery state. The cron job's database owner must be trusted and able to execute the private function. A successful cron SQL statement only confirms that an HTTP request was queued; inspect the `title-maintenance` function's HTTP outcome and sanitized counts to confirm the worker ran. A 503 means at least one workspace failed or the tick could not complete. `deferred` counts revision conflicts or withdrawn leases. `needsAttention` counts non-successful delivery outcomes. Newly created tasks record `maintenance.tasks_created` with a null system actor, count/task IDs and resulting workspace revision; unchanged ticks do not add audit noise.

## Cancellation, retry and recovery

The outbox is unique by workspace, maintenance record, cycle and recipient. Each attempt has a fenced two-minute lease; an old worker cannot record an outcome under a replaced lease. Sender and message content are captured for provider-idempotent retries. Transient failures and uncertain provider outcomes retry after at least five minutes with the same Resend idempotency key; the hourly schedule determines the usual retry interval.

Disabling workspace reminders, changing their recipient, pausing a record, completing its cycle or changing its due date makes the old job ineligible at claim/preflight. Canceled jobs can reactivate for the same recipient/cycle only if no worker ever passed provider preflight. Any job that may have reached the provider stays canceled after disable/re-enable; sent and uncertain jobs are never reset for a blind resend. A changed recipient receives a distinct eligible job. An email already accepted by the provider cannot be recalled; settings changes after the last preflight cannot retroactively cancel that request.

Resend retains idempotency keys for 24 hours. This worker stops automatic attempts at **23 hours from the first claim** and marks the job `manual`, leaving a safety margin. Inspect the provider delivery record and application lease/status before resolving an uncertain outcome. Do not reset `first_attempt_at`, `dispatch_started_at`, status or unique keys to force another send. A definitive provider rejection is `failed` and does not automatically retry. Delivery history is private operational state; status counts are safe for routine monitoring.

For an incident, set `TITLE_MAINTENANCE_EMAIL_ENABLED=false` to stop future sends while allowing tasks to materialize. To stop scheduled work entirely, an authorized operator can execute:

```sql
select cron.unschedule('title-agency-maintenance');
```

This does not cancel a request already in flight. Preserve outbox history and audit rows. To resume, resolve the incident and rerun activation; retain delivery disabled until settings and any uncertain prior submissions are reviewed. Rotating the scheduler credential requires updating `TITLE_MAINTENANCE_SCHEDULER_KEY` in the function environment and the existing Vault `title_maintenance_service_role_key` entry together, using a service-role JWT that remains valid at the gateway. A gateway-accepted request that returns `Service authorization required` means the dedicated key is absent or differs from the Vault bearer; it does not mean the database client key should be replaced. Use protected configuration handling to reconcile the two, without printing either value.

## Local verification

From `web/`, run `npm run test:jv:sql`, `npm run test:feedback:sql`, and `npm run test:agency:sql` sequentially. They use isolated disposable local PostgreSQL clusters and fictional data; they do not use configured hosted credentials or send email. The maintenance suite verifies service-only access, canonical task append, system audit, revision conflicts, TS/SQL parity, outbox deduplication, cancellation/reactivation, lease fencing and the manual-review boundary. API/worker tests use synthetic provider transport.
