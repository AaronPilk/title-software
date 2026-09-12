-- Application conflicts are HTTP 409, not PostgreSQL serialization errors eligible for driver retries.
create or replace function public.title_commit(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_request uuid,p_hash text,p_state jsonb,p_actions jsonb,p_companies text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare w public.title_workspaces%rowtype; m public.title_memberships%rowtype; r public.title_command_receipts%rowtype;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or m.role in ('viewer','partner') then raise exception 'Access changed' using errcode='42501'; end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select * into r from public.title_command_receipts where workspace_id=p_workspace and request_id=p_request;
  if found then
    if r.actor_id<>p_actor or r.payload_hash<>p_hash then raise exception 'Request ID was already used for different input' using errcode='PT409'; end if;
    return jsonb_build_object('revision',r.revision,'replayed',true);
  end if;
  if w.revision<>p_expected then raise exception 'Workspace changed. Refresh before saving.' using errcode='PT409'; end if;
  update public.title_workspaces set state=p_state,revision=revision+1,updated_at=now() where id=p_workspace;
  insert into public.title_command_receipts(workspace_id,request_id,actor_id,payload_hash,revision) values(p_workspace,p_request,p_actor,p_hash,w.revision+1);
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail,revision,request_id) values(p_workspace,p_actor,p_email,'workspace.commands',p_companies,jsonb_build_object('actions',p_actions),w.revision+1,p_request);
  return jsonb_build_object('revision',w.revision+1,'replayed',false);
end $$;

create or replace function public.title_restore_backup(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_backup uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare b public.title_backups%rowtype; w public.title_workspaces%rowtype;
begin
  perform 1 from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active and version=p_access_version and role='owner' for share;
  if not found then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found or w.revision<>p_expected then raise exception 'Workspace changed' using errcode='PT409'; end if;
  select * into b from public.title_backups where id=p_backup and workspace_id=p_workspace;
  if not found then raise exception 'Backup unavailable'; end if;
  insert into public.title_backups(workspace_id,revision,state,asset_manifest,created_by) values(p_workspace,w.revision,w.state,(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.title_assets a where a.workspace_id=p_workspace),p_actor);
  update public.title_workspaces set state=b.state,revision=revision+1,updated_at=now() where id=p_workspace;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,detail,revision) values(p_workspace,p_actor,p_email,'workspace.restored',jsonb_build_object('backupId',p_backup),w.revision+1);
  return w.revision+1;
end $$;
