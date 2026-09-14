-- Pausing one route must not relabel a shared inbox as the other company.
-- This changes new event context only; accepted history is never rewritten.
create or replace function public.title_enqueue_missive_event(p_workspace uuid,p_event jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.title_workspaces%rowtype; config jsonb; routing jsonb; candidates jsonb; inserted uuid; already_imported boolean; event jsonb;
begin
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select i.config into config from public.title_integrations i
    where workspace_id=p_workspace and provider='missive' and status<>'disabled' for share;
  routing=public.title_missive_routing(config);
  if config is null or coalesce(p_event->>'organizationId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
     coalesce(p_event->>'teamId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
     coalesce(p_event->>'messageId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
     coalesce(p_event->>'conversationId','') !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Event identifiers are incomplete'; end if;
  -- Old receiver payloads remain valid only while the stored config is legacy.
  if p_event ? 'routingRevision' then
    if routing->>'revision' is distinct from p_event->>'routingRevision' then
      raise exception 'Inbox routing changed. Retry the source event.' using errcode='PT409'; end if;
  elsif config->>'schemaVersion'='2' or config->'mapping'->>'version' is distinct from p_event->>'mappingVersion' or
      config->'mapping'->>'companyId' is distinct from p_event->>'companyId' then
    raise exception 'Inbox routing changed. Retry the source event.' using errcode='PT409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','companyId',r->>'companyId','version',(r->>'version')::bigint) order by ord),'[]'::jsonb)
    into candidates from jsonb_array_elements(routing->'mappings') with ordinality as x(r,ord)
    where r->>'organizationId'=p_event->>'organizationId' and r->>'teamId'=p_event->>'teamId';
  -- A paused company is still a possible destination for this shared inbox.
  -- Keep its context, but require at least one active route before accepting work.
  if not exists(select 1 from jsonb_array_elements(routing->'mappings') r where r->>'enabled'='true'
      and r->>'organizationId'=p_event->>'organizationId' and r->>'teamId'=p_event->>'teamId') then
    raise exception 'Inbox mapping changed. Retry the source event.' using errcode='PT409'; end if;
  event=p_event||jsonb_build_object('routingRevision',(routing->>'revision')::bigint,'candidateRoutes',candidates,
    'companyId',case when jsonb_array_length(candidates)=1 then candidates->0->>'companyId' else null end);
  select exists(select 1 from jsonb_array_elements(coalesce(w.state->'inbox','[]'::jsonb)) mail
    where mail->'missive'->>'organizationId'=p_event->>'organizationId' and mail->'missive'->>'messageId'=p_event->>'messageId') into already_imported;
  insert into public.title_jobs(workspace_id,provider,external_id,kind,payload,status)
    values(p_workspace,'missive',(p_event->>'organizationId')||':'||(p_event->>'messageId'),'incoming_review',event,
      case when already_imported then 'completed' else 'queued' end)
    on conflict(workspace_id,provider,external_id,kind) do nothing returning id into inserted;
  return inserted is not null;
end $$;
revoke all on function public.title_enqueue_missive_event(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.title_enqueue_missive_event(uuid,jsonb) to service_role;

