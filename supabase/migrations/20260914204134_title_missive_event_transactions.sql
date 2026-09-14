-- Every receiver operation takes the workspace lock before the integration
-- lock, matching reviewed mapping changes and imports. A successful response
-- therefore cannot acknowledge an event routed using a superseded mapping.
create function public.title_enqueue_missive_event(p_workspace uuid,p_event jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare w public.title_workspaces%rowtype; mapping jsonb; inserted uuid; already_imported boolean;
begin
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select config->'mapping' into mapping from public.title_integrations
    where workspace_id=p_workspace and provider='missive' and status<>'disabled' for share;
  if mapping is null or (mapping->>'version') is distinct from (p_event->>'mappingVersion') or
      (mapping->>'companyId') is distinct from (p_event->>'companyId') or
      (mapping->>'organizationId') is distinct from (p_event->>'organizationId') or
      (mapping->>'teamId') is distinct from (p_event->>'teamId') then
    raise exception 'Inbox mapping changed. Retry the source event.' using errcode='PT409';
  end if;
  if coalesce(p_event->>'messageId','')='' or coalesce(p_event->>'conversationId','')='' then
    raise exception 'Event identifiers are incomplete';
  end if;
  select exists(select 1 from jsonb_array_elements(coalesce(w.state->'inbox','[]'::jsonb)) mail
    where mail->'missive'->>'organizationId'=p_event->>'organizationId'
      and mail->'missive'->>'messageId'=p_event->>'messageId') into already_imported;
  insert into public.title_jobs(workspace_id,provider,external_id,kind,payload,status)
    values(p_workspace,'missive',(p_event->>'organizationId')||':'||(p_event->>'messageId'),
      'incoming_review',p_event,case when already_imported then 'completed' else 'queued' end)
    on conflict(workspace_id,provider,external_id,kind) do nothing returning id into inserted;
  return inserted is not null;
end $$;
revoke all on function public.title_enqueue_missive_event(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.title_enqueue_missive_event(uuid,jsonb) to service_role;

-- Import receipt, state, and queue completion commit together. Queue failure
-- rolls back the import instead of reporting failure after a durable commit.
create or replace function public.title_import_missive(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; mapping jsonb; result jsonb;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501';
  end if;
  perform 1 from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select config->'mapping' into mapping from public.title_integrations where workspace_id=p_workspace and provider='missive' and status<>'disabled' for share;
  if mapping is null or (mapping->>'version')::bigint<>p_mapping_version or mapping->>'companyId'<>p_company then
    raise exception 'Inbox mapping changed. Preview the message again.' using errcode='PT409';
  end if;
  result=public.title_commit(p_workspace,p_actor,p_email,p_access_version,p_expected,p_request,p_hash,p_state,'["importMissiveText"]'::jsonb,array[p_company]);
  update public.title_jobs j set status='completed',updated_at=now()
    where j.workspace_id=p_workspace and j.provider='missive' and j.kind='incoming_review' and j.status='queued'
      and exists(select 1 from public.title_workspaces w,
        lateral jsonb_array_elements(coalesce(w.state->'inbox','[]'::jsonb)) mail
        where w.id=p_workspace and mail->'missive'->>'organizationId'=j.payload->>'organizationId'
          and mail->'missive'->>'messageId'=j.payload->>'messageId');
  return result;
end $$;
revoke all on function public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) to service_role;
create index title_jobs_pending_review_idx on public.title_jobs(workspace_id,created_at,id)
  where provider='missive' and kind='incoming_review' and status='queued';

-- Query pending work before pagination. Keep older routing visible so an
-- administrator can restore its mapping instead of losing accepted events.
create function public.title_pending_missive_events(p_workspace uuid,p_offset integer default 0)
returns table(id uuid,payload jsonb,status text,created_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid event page'; end if;
  return query select j.id,j.payload,j.status,j.created_at from public.title_jobs j
    where j.workspace_id=p_workspace and j.provider='missive' and j.kind='incoming_review' and j.status='queued'
    order by j.created_at,j.id limit 101 offset p_offset;
end $$;
revoke all on function public.title_pending_missive_events(uuid,integer) from public,anon,authenticated;
grant execute on function public.title_pending_missive_events(uuid,integer) to service_role;
