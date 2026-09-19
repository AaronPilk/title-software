-- Resolve assignment eligibility again in the same transaction as the state
-- commit. A directory lookup before this RPC cannot authorize a revoked user.
create or replace function public.title_commit(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_request uuid,p_hash text,p_state jsonb,p_actions jsonb,p_companies text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare w public.title_workspaces%rowtype; m public.title_memberships%rowtype; r public.title_command_receipts%rowtype;
  assignment record; staff public.title_memberships%rowtype; assignee uuid;
begin
  -- Shares the staff lifecycle ordering. The nested import entrypoints below
  -- take this advisory lock before their row locks; other state writers take
  -- their actor membership lock before workspace state and do not need it.
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version is distinct from p_access_version or m.role in ('viewer','partner') then
    raise exception 'Access changed' using errcode='42501'; end if;
  -- Lock every referenced account before the workspace. Which assignments have
  -- actually changed is determined later against the locked current state.
  perform 1 from public.title_memberships membership where membership.workspace_id=p_workspace and membership.user_id in (
    select case when item->>'assigneeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (item->>'assigneeId')::uuid else null end
    from jsonb_array_elements(coalesce(p_state->'tasks','[]') || coalesce(p_state->'orders','[]')) item
  ) order by membership.user_id for share;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select * into r from public.title_command_receipts where workspace_id=p_workspace and request_id=p_request;
  if found then
    if r.actor_id<>p_actor or r.payload_hash<>p_hash then raise exception 'Request ID was already used for different input' using errcode='PT409'; end if;
    return jsonb_build_object('revision',r.revision,'replayed',true);
  end if;
  if w.revision is distinct from p_expected then raise exception 'Workspace changed. Refresh before saving.' using errcode='PT409'; end if;
  for assignment in
    select entries.kind,entries.item,prior.item previous from (
      select 'task' kind,t item from jsonb_array_elements(coalesce(p_state->'tasks','[]')) t
      union all select 'order',o from jsonb_array_elements(coalesce(p_state->'orders','[]')) o
    ) entries left join lateral (
      select old_item item from jsonb_array_elements(case when entries.kind='task' then coalesce(w.state->'tasks','[]') else coalesce(w.state->'orders','[]') end) old_item
      where old_item->>'id'=entries.item->>'id' limit 1
    ) prior on true
    where (entries.item ? 'assigneeId' or prior.item ? 'assigneeId') and
      (prior.item is null or entries.item->'assigneeId' is distinct from prior.item->'assigneeId'
        or entries.item->'companyId' is distinct from prior.item->'companyId'
        or entries.item->'owner' is distinct from prior.item->'owner')
  loop
    if jsonb_typeof(assignment.item->'assigneeId') is distinct from 'string'
      or not (assignment.item->>'assigneeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'Choose an active workspace staff account. Refresh the staff list.' using errcode='PT409'; end if;
    assignee=(assignment.item->>'assigneeId')::uuid;
    select * into staff from public.title_memberships where workspace_id=p_workspace and user_id=assignee;
    if not found or not staff.active or staff.role not in ('owner','admin','operations','onboarding','finance')
      or (assignment.kind='order' and staff.role not in ('owner','admin','operations'))
      or (not staff.all_companies and not coalesce(assignment.item->>'companyId'=any(staff.company_ids),false))
      or not exists(select 1 from jsonb_array_elements(coalesce(p_state->'companies','[]')) company where company->>'id'=assignment.item->>'companyId') then
      raise exception 'The selected staff account no longer has access to this company. Refresh the staff list.' using errcode='PT409'; end if;
  end loop;
  update public.title_workspaces set state=p_state,revision=revision+1,updated_at=now() where id=p_workspace;
  insert into public.title_command_receipts(workspace_id,request_id,actor_id,payload_hash,revision) values(p_workspace,p_request,p_actor,p_hash,w.revision+1);
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail,revision,request_id)
    values(p_workspace,p_actor,p_email,'workspace.commands',p_companies,jsonb_build_object('actions',p_actions),w.revision+1,p_request);
  return jsonb_build_object('revision',w.revision+1,'replayed',false);
end $$;

-- Import entrypoints call title_commit while already holding workspace state.
-- They must enter the same advisory lock before any row lock, so nested commits
-- never invert the lifecycle lock order. Routing/queue behavior is unchanged.

create or replace function public.title_import_missive_routed(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text,
  p_routing_revision bigint,p_mapping_id text,p_action text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.title_memberships%rowtype; routing jsonb; route jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
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

create or replace function public.title_import_missive(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; mapping jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
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
revoke all on function public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) to service_role;

create or replace function public.title_import_missive_attachment(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; mapping jsonb;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
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
revoke all on function public.title_import_missive_attachment(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.title_import_missive_attachment(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) to service_role;
