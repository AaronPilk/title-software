-- Versioned inbox routes support independent LLCs and deliberately shared inboxes.
-- Existing single-inbox approvals keep their identity and version until reviewed.
create function public.title_missive_routing(p_config jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select case when p_config->>'schemaVersion'='2' then p_config
    when p_config->'mapping' is not null then jsonb_build_object('schemaVersion',2,
      'revision',(p_config->'mapping'->>'version')::bigint,'mappings',jsonb_build_array(
        p_config->'mapping' || jsonb_build_object('enabled',true,'id','route:'||
          (p_config->'mapping'->>'organizationId')||':'||(p_config->'mapping'->>'teamId')||':'||(p_config->'mapping'->>'companyId'))))
    else '{"schemaVersion":2,"revision":0,"mappings":[]}'::jsonb end;
$$;
revoke all on function public.title_missive_routing(jsonb) from public,anon,authenticated;
grant execute on function public.title_missive_routing(jsonb) to service_role;

create function public.title_save_missive_route(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_mapping jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.title_memberships%rowtype; w public.title_workspaces%rowtype; config jsonb; routing jsonb;
  route jsonb; route_id text; routes jsonb; found_route boolean;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select i.config into config from public.title_integrations i where workspace_id=p_workspace and provider='missive' for update;
  routing=public.title_missive_routing(config);
  if p_expected is null or (routing->>'revision')::bigint<>p_expected then
    raise exception 'Inbox routing changed. Refresh before saving.' using errcode='PT409'; end if;
  if not exists(select 1 from jsonb_array_elements(w.state->'companies') c where c->>'id'=p_mapping->>'companyId') then
    raise exception 'Mapped company is unavailable' using errcode='PT409'; end if;
  if coalesce(p_mapping->>'organizationId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
     coalesce(p_mapping->>'teamId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
     coalesce(p_mapping->>'companyId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
     coalesce(jsonb_typeof(p_mapping->'teamName'),'')<>'string' or length(p_mapping->>'teamName')>500 or
     coalesce(jsonb_typeof(p_mapping->'enabled'),'')<>'boolean' then raise exception 'Invalid inbox route'; end if;
  route_id='route:'||(p_mapping->>'organizationId')||':'||(p_mapping->>'teamId')||':'||(p_mapping->>'companyId');
  found_route=exists(select 1 from jsonb_array_elements(routing->'mappings') r where r->>'id'=route_id);
  if not found_route and (p_mapping->>'enabled')::boolean is false then raise exception 'Route is unavailable' using errcode='PT409'; end if;
  if not found_route and jsonb_array_length(routing->'mappings')>=500 then raise exception 'Inbox routing limit reached'; end if;
  route=jsonb_build_object('id',route_id,'organizationId',p_mapping->>'organizationId','teamId',p_mapping->>'teamId',
    'companyId',p_mapping->>'companyId','teamName',p_mapping->>'teamName','enabled',(p_mapping->>'enabled')::boolean,
    'version',p_expected+1,'approvedAt',now(),'approvedBy',p_email);
  select coalesce(jsonb_agg(case when r->>'id'=route_id then route else r end order by ord),'[]'::jsonb)
    into routes from jsonb_array_elements(routing->'mappings') with ordinality as x(r,ord);
  if not found_route then routes=routes||jsonb_build_array(route); end if;
  routing=jsonb_build_object('schemaVersion',2,'revision',p_expected+1,'mappings',routes);
  insert into public.title_integrations(workspace_id,provider,status,config,last_checked_at)
    values(p_workspace,'missive','configured',(coalesce(config,'{}'::jsonb)-'mapping')||routing,now())
    on conflict(workspace_id,provider) do update set status='configured',config=excluded.config,last_checked_at=now(),last_error=null;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,p_email,'missive.route_reviewed',array[p_mapping->>'companyId'],jsonb_build_object('routingRevision',p_expected+1,'mapping',route));
  return routing;
end $$;
revoke all on function public.title_save_missive_route(uuid,uuid,text,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.title_save_missive_route(uuid,uuid,text,bigint,bigint,jsonb) to service_role;

-- Membership, workspace revision, the whole routing revision, and the exact
-- selected route stay locked through source commit and queue completion.
create function public.title_import_missive_routed(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text,
  p_routing_revision bigint,p_mapping_id text,p_action text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.title_memberships%rowtype; routing jsonb; route jsonb; result jsonb;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  perform 1 from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select public.title_missive_routing(config) into routing from public.title_integrations
    where workspace_id=p_workspace and provider='missive' and status<>'disabled' for share;
  select r into route from jsonb_array_elements(coalesce(routing->'mappings','[]'::jsonb)) r where r->>'id'=p_mapping_id and r->>'enabled'='true';
  if routing is null or p_routing_revision is null or (routing->>'revision')::bigint<>p_routing_revision or route is null or
      p_mapping_version is null or (route->>'version')::bigint<>p_mapping_version or route->>'companyId' is distinct from p_company then
    raise exception 'Inbox routing changed. Review the company and file again.' using errcode='PT409'; end if;
  if p_action is null or p_action not in ('importMissiveText','importMissiveAttachment') then raise exception 'Invalid Missive import action'; end if;
  result=public.title_commit(p_workspace,p_actor,p_email,p_access_version,p_expected,p_request,p_hash,p_state,jsonb_build_array(p_action),array[p_company]);
  if p_action='importMissiveText' then
    update public.title_jobs j set status='completed',updated_at=now()
      where j.workspace_id=p_workspace and j.provider='missive' and j.kind='incoming_review' and j.status='queued'
        and exists(select 1 from public.title_workspaces w,
          lateral jsonb_array_elements(coalesce(w.state->'inbox','[]'::jsonb)) mail
          where w.id=p_workspace and mail->'missive'->>'organizationId'=j.payload->>'organizationId'
            and mail->'missive'->>'messageId'=j.payload->>'messageId');
  end if;
  return result;
end $$;
revoke all on function public.title_import_missive_routed(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.title_import_missive_routed(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text,bigint,text,text) to service_role;

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
    where r->>'enabled'='true' and r->>'organizationId'=p_event->>'organizationId' and r->>'teamId'=p_event->>'teamId';
  if jsonb_array_length(candidates)=0 then raise exception 'Inbox mapping changed. Retry the source event.' using errcode='PT409'; end if;
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

-- A rolling deployment or rollback must not resurrect the retired singleton.
-- Legacy RPCs remain compatible until this workspace first adopts route sets.

create or replace function public.title_save_missive_mapping(
  p_workspace uuid, p_actor uuid, p_email text, p_access_version bigint,
  p_expected bigint, p_mapping jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; w public.title_workspaces%rowtype;
  current_mapping jsonb; next_mapping jsonb;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501';
  end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  if exists(select 1 from public.title_integrations where workspace_id=p_workspace and provider='missive' and config->>'schemaVersion'='2') then
    raise exception 'This workspace uses company inbox routes. Refresh the application before continuing.' using errcode='PT409';
  end if;
  select config->'mapping' into current_mapping from public.title_integrations where workspace_id=p_workspace and provider='missive' for update;
  if coalesce((current_mapping->>'version')::bigint,0)<>p_expected then
    raise exception 'Inbox mapping changed. Refresh before saving.' using errcode='PT409';
  end if;
  if not exists(select 1 from jsonb_array_elements(w.state->'companies') c where c->>'id'=p_mapping->>'companyId') then
    raise exception 'Mapped company is unavailable' using errcode='PT409';
  end if;
  next_mapping=p_mapping || jsonb_build_object('version',p_expected+1,'approvedAt',now(),'approvedBy',p_email);
  insert into public.title_integrations(workspace_id,provider,status,config,last_checked_at)
    values(p_workspace,'missive','configured',jsonb_build_object('mapping',next_mapping),now())
    on conflict(workspace_id,provider) do update set status='configured',config=public.title_integrations.config || excluded.config,last_checked_at=now(),last_error=null;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,p_email,'missive.mapping_reviewed',array[p_mapping->>'companyId'],jsonb_build_object('mapping',next_mapping));
  return next_mapping;
end $$;

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
  if exists(select 1 from public.title_integrations where workspace_id=p_workspace and provider='missive' and config->>'schemaVersion'='2') then
    raise exception 'This workspace uses company inbox routes. Refresh the application before continuing.' using errcode='PT409';
  end if;
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

create or replace function public.title_import_missive_attachment(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; mapping jsonb;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501';
  end if;
  perform 1 from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  if exists(select 1 from public.title_integrations where workspace_id=p_workspace and provider='missive' and config->>'schemaVersion'='2') then
    raise exception 'This workspace uses company inbox routes. Refresh the application before continuing.' using errcode='PT409';
  end if;
  select config->'mapping' into mapping from public.title_integrations where workspace_id=p_workspace and provider='missive' and status<>'disabled' for share;
  if mapping is null or (mapping->>'version')::bigint<>p_mapping_version or mapping->>'companyId'<>p_company then
    raise exception 'Inbox mapping changed. Review the attachment again.' using errcode='PT409';
  end if;
  return public.title_commit(p_workspace,p_actor,p_email,p_access_version,p_expected,p_request,p_hash,p_state,
    '["importMissiveAttachment"]'::jsonb,array[p_company]);
end $$;
