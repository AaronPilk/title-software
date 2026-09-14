-- Separate receipt action for reviewed attachment bytes. The mapping and access
-- version are rechecked under the same lock order as message imports.
create function public.title_import_missive_attachment(
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
    raise exception 'Inbox mapping changed. Review the attachment again.' using errcode='PT409';
  end if;
  return public.title_commit(p_workspace,p_actor,p_email,p_access_version,p_expected,p_request,p_hash,p_state,
    '["importMissiveAttachment"]'::jsonb,array[p_company]);
end $$;
revoke all on function public.title_import_missive_attachment(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.title_import_missive_attachment(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text) to service_role;
