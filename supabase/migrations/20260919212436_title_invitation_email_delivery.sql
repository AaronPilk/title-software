-- Delivery records contain outcomes only, never sign-in links, tokens or passwords.
create table public.title_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  invitation_id uuid not null references public.title_invitations(id),
  invitation_version bigint not null,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  status text not null check(status in ('sending','sent','failed','unknown')),
  kind text not null check(kind in ('invite','magiclink')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  error_code text check(error_code is null or error_code in ('provider_rejected','delivery_unconfirmed')),
  unique(workspace_id,request_id)
);
alter table public.title_invitation_deliveries enable row level security;
revoke all on public.title_invitation_deliveries from public,anon,authenticated;
grant select,insert,update on public.title_invitation_deliveries to service_role;
create index title_invitation_deliveries_invitation_idx on public.title_invitation_deliveries(invitation_id);
create index title_invitation_deliveries_actor_idx on public.title_invitation_deliveries(actor_id);
create index title_invitation_deliveries_latest_idx on public.title_invitation_deliveries(workspace_id,invitation_id,created_at desc);

create function public.title_begin_invitation_email(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_invitation uuid,p_expected bigint,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor public.title_memberships%rowtype; inv public.title_invitations%rowtype;
  delivery public.title_invitation_deliveries%rowtype; previous public.title_invitation_deliveries%rowtype;
  identity jsonb; recipient_kind text;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not actor.active or actor.version is distinct from p_access_version or not(actor.role='owner' or (actor.role='admin' and actor.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  if p_request is null or p_expected is null or p_expected<1 then raise exception 'Review the invitation before sending' using errcode='22023'; end if;
  select * into delivery from public.title_invitation_deliveries where workspace_id=p_workspace and request_id=p_request;
  if found then
    if delivery.actor_id<>p_actor or delivery.invitation_id<>p_invitation or delivery.invitation_version<>p_expected then
      raise exception 'This delivery request already represents another action' using errcode='40001'; end if;
    return jsonb_build_object('id',delivery.id,'send',false,'status',case when delivery.status='sending' and delivery.created_at<clock_timestamp()-interval '5 minutes' then 'unknown' else delivery.status end);
  end if;
  select * into inv from public.title_invitations where workspace_id=p_workspace and id=p_invitation for update;
  if not found or inv.version<>p_expected then raise exception 'Invitation changed. Refresh before sending' using errcode='40001'; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at<=clock_timestamp() then
    raise exception 'Only a current pending invitation can receive a setup email' using errcode='40001'; end if;
  if actor.role<>'owner' and (inv.role='admin' or inv.all_companies or inv.restricted_access) then
    raise exception 'Only the owner may send this invitation' using errcode='42501'; end if;
  identity=title_private.staff_identity(p_workspace,p_actor,p_access_version,null,inv.email);
  if inv.recipient_user_id is not null and (identity is null or identity->>'id'<>inv.recipient_user_id::text) then
    raise exception 'Invitation account identity changed. Cancel and prepare a reviewed new grant' using errcode='40001'; end if;
  if identity->>'id'=p_actor::text then raise exception 'Use your account sign-in flow' using errcode='42501'; end if;
  if exists(select 1 from public.title_memberships where workspace_id=p_workspace and user_id=(identity->>'id')::uuid
    and (role='owner' or (actor.role<>'owner' and (role='admin' or all_companies or restricted_access)))) then
    raise exception 'Owner access is required for this account' using errcode='42501'; end if;
  select * into previous from public.title_invitation_deliveries where workspace_id=p_workspace and invitation_id=p_invitation order by created_at desc,id desc limit 1;
  if found and (previous.created_at>clock_timestamp()-interval '1 minute' or (previous.status='sending' and previous.created_at>clock_timestamp()-interval '5 minutes')) then
    raise exception 'A setup email was recently requested. Refresh its status before retrying' using errcode='40001'; end if;
  recipient_kind=case when identity is null then 'invite' else 'magiclink' end;
  insert into public.title_invitation_deliveries(workspace_id,invitation_id,invitation_version,request_id,actor_id,status,kind)
    values(p_workspace,p_invitation,p_expected,p_request,p_actor,'sending',recipient_kind) returning * into delivery;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,p_email,'member.invitation_email_requested',inv.company_ids,jsonb_build_object('invitationId',inv.id,'deliveryId',delivery.id,'version',inv.version));
  return jsonb_build_object('id',delivery.id,'send',true,'email',inv.email,'kind',recipient_kind,'status','sending');
end $$;

-- An in-flight sender may finish recording an already-authorized attempt after
-- its own access changes. This RPC grants no access and never resends anything.
create function public.title_finish_invitation_email(p_workspace uuid,p_actor uuid,p_email text,p_delivery uuid,p_request uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare delivery public.title_invitation_deliveries%rowtype;
begin
  if p_status is null or p_status not in ('sent','failed','unknown') then raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  select * into delivery from public.title_invitation_deliveries where workspace_id=p_workspace and id=p_delivery and request_id=p_request and actor_id=p_actor for update;
  if not found then raise exception 'Delivery is not available' using errcode='42501'; end if;
  if delivery.status<>'sending' then
    if delivery.status<>p_status then raise exception 'Delivery outcome already recorded' using errcode='40001'; end if;
    return jsonb_build_object('id',delivery.id,'status',delivery.status,'replayed',true);
  end if;
  update public.title_invitation_deliveries set status=p_status,finished_at=clock_timestamp(),
    error_code=case when p_status='failed' then 'provider_rejected' when p_status='unknown' then 'delivery_unconfirmed' else null end where id=delivery.id;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,detail)
    values(p_workspace,p_actor,p_email,'member.invitation_email_'||p_status,jsonb_build_object('invitationId',delivery.invitation_id,'deliveryId',delivery.id));
  return jsonb_build_object('id',delivery.id,'status',p_status,'replayed',false);
end $$;
revoke all on function public.title_begin_invitation_email(uuid,uuid,text,bigint,uuid,bigint,uuid) from public,anon,authenticated;
revoke all on function public.title_finish_invitation_email(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.title_begin_invitation_email(uuid,uuid,text,bigint,uuid,bigint,uuid) to service_role;
grant execute on function public.title_finish_invitation_email(uuid,uuid,text,uuid,uuid,text) to service_role;

-- One row per invitation: current pending grant only, or the last historical
-- attempt after acceptance/cancellation. History volume cannot hide a result.
create function public.title_invitation_delivery_status(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns table(invitation_id uuid,status text,created_at timestamptz,finished_at timestamptz,invitation_version bigint)
language plpgsql security invoker set search_path='' as $$
declare actor public.title_memberships%rowtype;
begin
  select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not actor.active or actor.version is distinct from p_access_version
    or not(actor.role='owner' or (actor.role='admin' and actor.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  return query select i.id,
      case when latest.status='sending' and latest.created_at<clock_timestamp()-interval '5 minutes' then 'unknown' else latest.status end,
      latest.created_at,latest.finished_at,latest.invitation_version
    from public.title_invitations i
    cross join lateral (select d.status,d.created_at,d.finished_at,d.invitation_version from public.title_invitation_deliveries d
      where d.workspace_id=p_workspace and d.invitation_id=i.id
        and (i.accepted_at is not null or i.revoked_at is not null or d.invitation_version=i.version)
      order by d.created_at desc,d.id desc limit 1) latest
    where i.workspace_id=p_workspace;
end $$;
revoke all on function public.title_invitation_delivery_status(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.title_invitation_delivery_status(uuid,uuid,bigint) to service_role;
