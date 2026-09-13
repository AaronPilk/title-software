-- Remove only completed synthetic assistant QA workspaces. Auth accounts are
-- removed afterward through the Auth Admin API. Real workspace audit stays intact.
do $$
declare w record; table_name text; run_tag text;
begin
  for w in select id,name from public.title_workspaces
    where name like 'Disposable assistant QA %' and created_at::date=date '2026-09-13'
  loop
    run_tag := substring(w.name from length('Disposable assistant QA ')+1);
    if run_tag !~ '^[0-9a-f-]{36}$'
      or exists(select 1 from public.title_bootstrap where workspace_id=w.id)
      or (select count(*) from public.title_memberships where workspace_id=w.id)<>2
      or exists(select 1 from public.title_memberships m join auth.users u on u.id=m.user_id
        where m.workspace_id=w.id and (u.raw_app_meta_data->>'title_assistant_qa' is distinct from run_tag
          or u.email not like 'title-agent-qa-%@example.com'))
      or exists(select 1 from public.title_audit a join auth.users u on u.id=a.actor_id
        where a.workspace_id=w.id and u.raw_app_meta_data->>'title_assistant_qa' is distinct from run_tag)
      or exists(select 1 from public.title_command_receipts r join auth.users u on u.id=r.actor_id
        where r.workspace_id=w.id and u.raw_app_meta_data->>'title_assistant_qa' is distinct from run_tag)
      or exists(select 1 from public.title_assets where workspace_id=w.id)
      or exists(select 1 from public.title_invitations where workspace_id=w.id)
      or exists(select 1 from public.title_integrations where workspace_id=w.id)
      or exists(select 1 from public.title_jobs where workspace_id=w.id)
      or exists(select 1 from public.title_backups where workspace_id=w.id) then
      raise exception 'Assistant QA cleanup scope precondition failed';
    end if;
    foreach table_name in array array['title_audit','title_command_receipts','title_memberships'] loop
      execute format('delete from public.%I where workspace_id=$1',table_name) using w.id;
    end loop;
    delete from public.title_workspaces where id=w.id;
  end loop;
end $$;
