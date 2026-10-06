-- Cabinet trash never invalidates private application or ownership evidence.
-- State commits and intake writers share the workspace advisory/row lock.
create or replace function title_private.guard_agency_document_archive() returns trigger
language plpgsql security definer set search_path='' as $$
declare removed text[]; intake record; secret text; payload jsonb;
begin
  select array_agg(d->>'id') into removed from jsonb_array_elements(coalesce(old.state->'documents','[]')) d
  where coalesce(d->>'archivedAt','')='' and not exists (
    select 1 from jsonb_array_elements(coalesce(new.state->'documents','[]')) n
    where n->>'id'=d->>'id' and coalesce(n->>'archivedAt','')='');
  if removed is null then return new; end if;
  for intake in select secret_id from public.title_jv_intakes where workspace_id=new.id and secret_id is not null loop
    select decrypted_secret into secret from vault.decrypted_secrets where id=intake.secret_id;
    if secret is null then raise exception 'Private record evidence could not be checked. Retry before removing this original.' using errcode='PT409'; end if;
    payload=secret::jsonb->'payload';
    if exists(select 1 from jsonb_array_elements_text(coalesce(payload->'sourceDocumentIds','[]')) id where id=any(removed))
      or exists(select 1 from jsonb_array_elements(title_private.company_record_sources(payload->'companyRecords')) ref where ref->>'id'=any(removed)) then
      raise exception 'This original is linked to a private company record. Remove that reference before moving it to Trash.' using errcode='PT409';
    end if;
  end loop;
  return new;
end $$;
revoke all on function title_private.guard_agency_document_archive() from public,anon,authenticated,service_role;
create trigger title_agency_document_archive_guard before update of state on public.title_workspaces
for each row execute function title_private.guard_agency_document_archive();

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
      or (assignment.kind='task' and assignment.item->>'scope'='agency' and staff.role not in ('owner','admin','onboarding'))
      or (not coalesce(assignment.kind='task' and assignment.item->>'scope'='agency' and assignment.item->'phaseOne'->>'kind'='maintenance'
        and coalesce(assignment.item->>'companyId','')='' and staff.all_companies
        and exists(select 1 from jsonb_array_elements(coalesce(p_state->'agencyMaintenance'->'records','[]')) maintenance_record
          where maintenance_record->>'id'=assignment.item->'phaseOne'->>'maintenanceId' and maintenance_record->>'scope'='agency'),false)
        and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'companies','[]')) company where company->>'id'=assignment.item->>'companyId')) then
      raise exception 'The selected staff account no longer has access to this company. Refresh the staff list.' using errcode='PT409'; end if;
  end loop;
  update public.title_workspaces set state=p_state,revision=revision+1,updated_at=now() where id=p_workspace;
  insert into public.title_command_receipts(workspace_id,request_id,actor_id,payload_hash,revision) values(p_workspace,p_request,p_actor,p_hash,w.revision+1);
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail,revision,request_id)
    values(p_workspace,p_actor,p_email,'workspace.commands',p_companies,jsonb_build_object('actions',p_actions),w.revision+1,p_request);
  return jsonb_build_object('revision',w.revision+1,'replayed',false);
end $$;
