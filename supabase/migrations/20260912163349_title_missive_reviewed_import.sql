-- Reviewed team routing and message imports use the same membership/workspace
-- lock order as title_commit. Browser roles cannot invoke either RPC.
create function public.title_save_missive_mapping(
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

create function public.title_import_missive(
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
  select config->'mapping' into mapping from public.title_integrations where workspace_id=p_workspace and provider='missive' and status<>'disabled' for share;
  if mapping is null or (mapping->>'version')::bigint<>p_mapping_version or mapping->>'companyId'<>p_company then
    raise exception 'Inbox mapping changed. Preview the message again.' using errcode='PT409';
  end if;
  return public.title_commit(p_workspace,p_actor,p_email,p_access_version,p_expected,p_request,p_hash,p_state,'["importMissiveText"]'::jsonb,array[p_company]);
end $$;

revoke all on function public.title_save_missive_mapping(uuid,uuid,text,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.title_save_missive_mapping(uuid,uuid,text,bigint,bigint,jsonb) to service_role;
revoke all on function public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) to service_role;

-- On an initialized project, verify transaction boundaries five times without
-- retaining fixtures. Each iteration deliberately rolls back its subtransaction.
-- A fresh install without an owner skips these deployment-time assertions.
do $$
declare actor uuid; wid uuid; request uuid; result jsonb; run integer; count_passed integer:=0;
begin
  if has_function_privilege('authenticated','public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text)','execute') or
     has_function_privilege('anon','public.title_save_missive_mapping(uuid,uuid,text,bigint,bigint,jsonb)','execute') then
    raise exception 'Missive RPCs must remain server-only';
  end if;
  select user_id into actor from public.title_memberships where role='owner' and active limit 1;
  if actor is null then return; end if;
  for run in 1..5 loop
    begin
      insert into public.title_workspaces(name,state) values('Missive transaction test','{"companies":[{"id":"test-company"}]}') returning id into wid;
      insert into public.title_memberships(workspace_id,user_id,role,all_companies) values(wid,actor,'owner',true);
      result=public.title_save_missive_mapping(wid,actor,'transaction-test@example.invalid',1,0,'{"companyId":"test-company","teamId":"fixture-team","organizationId":"fixture-org"}');
      if result->>'version'<>'1' then raise exception 'Mapping version did not advance'; end if;
      begin
        perform public.title_save_missive_mapping(wid,actor,'test@example.invalid',1,0,'{"companyId":"test-company"}');
        raise exception 'Stale mapping accepted';
      exception when sqlstate 'PT409' then null; end;
      begin
        perform public.title_save_missive_mapping(wid,actor,'test@example.invalid',1,1,'{"companyId":"missing-company"}');
        raise exception 'Missing company accepted';
      exception when sqlstate 'PT409' then null; end;
      request=gen_random_uuid();
      begin
        perform public.title_import_missive(wid,actor,'test@example.invalid',1,0,request,'fixture-hash','{}',2,'test-company');
        raise exception 'Stale import mapping accepted';
      exception when sqlstate 'PT409' then null; end;
      begin
        perform public.title_import_missive(wid,actor,'test@example.invalid',1,0,request,'fixture-hash','{}',1,'wrong-company');
        raise exception 'Cross-company import accepted';
      exception when sqlstate 'PT409' then null; end;
      result=public.title_import_missive(wid,actor,'test@example.invalid',1,0,request,'fixture-hash','{"import":"fixture"}',1,'test-company');
      if result->>'revision'<>'1' or result->>'replayed'<>'false' then raise exception 'Initial import failed'; end if;
      result=public.title_import_missive(wid,actor,'test@example.invalid',1,0,request,'fixture-hash','{"ignored":"replay"}',1,'test-company');
      if result->>'replayed'<>'true' then raise exception 'Replay not recognized'; end if;
      begin
        perform public.title_import_missive(wid,actor,'test@example.invalid',1,0,request,'different-input','{}',1,'test-company');
        raise exception 'Conflicting request identity accepted';
      exception when sqlstate 'PT409' then null; end;
      begin
        perform public.title_import_missive(wid,actor,'test@example.invalid',1,0,gen_random_uuid(),'second-request','{}',1,'test-company');
        raise exception 'Concurrent stale revision accepted';
      exception when sqlstate 'PT409' then null; end;
      update public.title_memberships set active=false,version=2 where workspace_id=wid;
      begin
        perform public.title_import_missive(wid,actor,'test@example.invalid',1,1,gen_random_uuid(),'revoked','{}',1,'test-company');
        raise exception 'Revoked membership accepted';
      exception when insufficient_privilege then null; end;
      if (select count(*) from public.title_command_receipts where workspace_id=wid)<>1 or
         (select state from public.title_workspaces where id=wid)<>'{"import":"fixture"}'::jsonb then
        raise exception 'Rejected operations changed persisted state';
      end if;
      raise exception 'Rollback successful test fixtures' using errcode='PTCMP';
    exception when sqlstate 'PTCMP' then count_passed=count_passed+1;
    end;
  end loop;
  if count_passed<>5 then raise exception 'Transaction verification incomplete'; end if;
end $$;
