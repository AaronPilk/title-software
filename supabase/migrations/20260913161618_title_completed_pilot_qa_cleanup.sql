-- Remove the completed September 13 pilot verification workspace only when
-- all of its members and audit actors are explicitly tagged synthetic users.
-- Storage objects are removed through the Storage API before this migration;
-- Auth users are removed afterward through the Auth Admin API.
do $$
declare w record; table_name text;
begin
  for w in select id,name from public.title_workspaces
    where name like 'Disposable private pilot QA %' and created_at::date=date '2026-09-13'
  loop
    if exists(select 1 from public.title_bootstrap where workspace_id=w.id)
      or not exists(select 1 from public.title_memberships where workspace_id=w.id)
      or exists(select 1 from public.title_memberships m join auth.users u on u.id=m.user_id
        where m.workspace_id=w.id and (u.raw_app_meta_data->>'title_pilot_qa' is distinct from substring(w.name from 29)
          or u.email not like 'title-pilot-%@example.com'))
      or exists(select 1 from public.title_audit a join auth.users u on u.id=a.actor_id
        where a.workspace_id=w.id and u.raw_app_meta_data->>'title_pilot_qa' is distinct from substring(w.name from 29))
      or exists(select 1 from storage.objects o join public.title_assets a on a.object_path=o.name
        where a.workspace_id=w.id and o.bucket_id='title-documents') then
      raise exception 'Pilot QA cleanup scope or storage precondition failed';
    end if;
    foreach table_name in array array['title_invitations','title_audit','title_command_receipts','title_assets','title_integrations','title_jobs','title_backups','title_memberships'] loop
      execute format('delete from public.%I where workspace_id=$1',table_name) using w.id;
    end loop;
    delete from public.title_workspaces where id=w.id;
  end loop;
end $$;
