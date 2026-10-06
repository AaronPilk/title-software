-- Apply after the maintenance migration and edge-function deployment.
-- Existing Supabase project only. No external scheduler/hosting is provisioned.
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Secret values are provisioned by activate-scheduler.mjs via environment variables.
select cron.schedule('title-agency-maintenance','0 * * * *','select title_private.invoke_maintenance_worker();');
