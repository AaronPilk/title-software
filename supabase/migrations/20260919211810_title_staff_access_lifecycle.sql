-- All staff grant mutations serialize per workspace before taking membership locks.
-- Membership locks precede workspace locks, matching title_commit/restore/import.
-- Claim locks every affected workspace in UUID order before consuming any grant.
alter table public.title_invitations
  add column version bigint not null default 1 check (version > 0),
  add column updated_at timestamptz not null default now(),
  add column last_action text not null default 'prepared'
    check (last_action in ('prepared','edited','reissued','cancelled','accepted')),
  add column request_id uuid,
  add column recipient_user_id uuid references auth.users(id);
-- Bind only currently usable legacy grants with one exact normalized Auth
-- email match. Accepted/cancelled/expired history is deliberately untouched;
-- an unknown or ambiguous current identity stays unbound for explicit review.
update public.title_invitations invitation set recipient_user_id=identity.user_id
  from (select lower(btrim(email)) email_key,(array_agg(id))[1] user_id from auth.users
    where nullif(btrim(email),'') is not null group by lower(btrim(email)) having count(*)=1) identity
  where invitation.accepted_at is null and invitation.revoked_at is null
    and invitation.expires_at>clock_timestamp()
    and lower(btrim(invitation.email))=identity.email_key;

create unique index title_invitations_request_idx on public.title_invitations(workspace_id,request_id)
  where request_id is not null;
create index title_invitations_recipient_user_idx on public.title_invitations(recipient_user_id) where recipient_user_id is not null;

-- The service role cannot query Auth tables directly. This helper discloses only
-- one account's ID/email to a currently authorized staff administrator. It is not
-- exposed through the public API and does not modify Auth records.
create schema if not exists title_private;
revoke all on schema title_private from public,anon,authenticated;
grant usage on schema title_private to service_role;
create function title_private.staff_identity(p_workspace uuid,p_actor uuid,p_access_version bigint,p_user uuid,p_recipient text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid()<>p_actor then
    raise exception 'Account identity changed' using errcode='42501';
  end if;
  if not exists(select 1 from public.title_memberships where workspace_id=p_workspace and user_id=p_actor
    and active and version=p_access_version and role in ('owner','admin')) then
    raise exception 'Administrator access changed' using errcode='42501';
  end if;
  if (p_user is null) = (p_recipient is null) then
    raise exception 'Choose one account identity' using errcode='22023';
  end if;
  return (select jsonb_build_object('id',u.id,'email',lower(btrim(u.email))) from auth.users u
    where (p_user is not null and u.id=p_user) or (p_recipient is not null and lower(u.email)=lower(btrim(p_recipient))));
end $$;
revoke all on function title_private.staff_identity(uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function title_private.staff_identity(uuid,uuid,bigint,uuid,text) to service_role;

create function public.title_prepare_invitation(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,
  p_recipient text,p_role text,p_companies text[],p_all_companies boolean,p_restricted boolean,p_partner_members jsonb,
  p_invitation uuid default null,p_expected bigint default null,p_reissue boolean default false,p_request uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.title_memberships%rowtype; target public.title_memberships%rowtype; inv public.title_invitations%rowtype;
  identity jsonb; state jsonb; recipient text=lower(btrim(p_recipient)); companies text[]; partners jsonb; stored_partners jsonb; same_grant boolean;
  action text; mutation_time timestamptz; had_invitation boolean=false; replay boolean=false;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not actor.active or actor.version is distinct from p_access_version or actor.role not in ('owner','admin') then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter an email address' using errcode='22023'; end if;
  if p_role is null or p_role not in ('admin','operations','onboarding','finance','viewer','partner') then
    raise exception 'Choose a role' using errcode='22023'; end if;
  if p_invitation is null and p_request is null then
    raise exception 'A request ID is required. Refresh before preparing access' using errcode='22023'; end if;
  if p_all_companies is null or p_restricted is null or p_reissue is null then
    raise exception 'Choose explicit access options' using errcode='22023'; end if;
  if actor.role<>'owner' and (p_role='admin' or p_all_companies or p_restricted) then
    raise exception 'Only the owner may grant elevated access' using errcode='42501'; end if;
  identity=title_private.staff_identity(p_workspace,p_actor,p_access_version,null,recipient);
  if lower(btrim(p_email))=recipient or identity->>'id'=p_actor::text then
    raise exception 'You cannot change your own access by invitation' using errcode='42501'; end if;
  if identity is not null then
    select * into target from public.title_memberships where workspace_id=p_workspace and user_id=(identity->>'id')::uuid for update;
    if found and (target.role='owner' or (actor.role<>'owner' and (target.role='admin' or target.all_companies or target.restricted_access
      or (not actor.all_companies and not target.company_ids<@actor.company_ids)))) then
      raise exception 'Owner access is required for this account' using errcode='42501'; end if;
  end if;
  select w.state into state from public.title_workspaces w where id=p_workspace for share;
  if not found then raise exception 'Workspace unavailable' using errcode='22023'; end if;
  if p_companies is null or exists(select 1 from unnest(p_companies) c where c is null or btrim(c)='') then
    raise exception 'Choose existing companies' using errcode='22023'; end if;
  select coalesce(array_agg(c order by c),'{}') into companies from (select distinct unnest(p_companies) c) selected;
  if exists(select 1 from unnest(companies) c where
    (not actor.all_companies and not c=any(actor.company_ids)) or
    not exists(select 1 from jsonb_array_elements(coalesce(state->'companies','[]')) company where company->>'id'=c)) then
    raise exception 'Choose existing companies within your access' using errcode='42501'; end if;
  if p_partner_members is null or jsonb_typeof(p_partner_members)<>'array' then
    raise exception 'Choose valid member assignments' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_partner_members) m where jsonb_typeof(m)<>'object'
      or jsonb_typeof(m->'companyId') is distinct from 'string' or jsonb_typeof(m->'memberName') is distinct from 'string'
      or not (m->>'companyId'=any(companies))
      or not exists(select 1 from jsonb_array_elements(coalesce(state->'companies','[]')) c,
        jsonb_array_elements(coalesce(c->'members','[]')) member
        where c->>'id'=m->>'companyId' and member->>'name'=m->>'memberName')) then
    raise exception 'Choose an existing company member' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('companyId',company_id,'memberName',member_name) order by company_id,member_name),'[]')
    into partners from (select distinct m->>'companyId' company_id,m->>'memberName' member_name from jsonb_array_elements(p_partner_members) m) x;
  if p_role='partner' and (jsonb_array_length(partners)=0 or p_all_companies or p_restricted
    or exists(select 1 from unnest(companies) c where not exists(select 1 from jsonb_array_elements(partners) m where m->>'companyId'=c))) then
    raise exception 'Partners need explicit member assignments and restricted company access' using errcode='22023'; end if;
  if p_role<>'partner' and jsonb_array_length(partners)>0 then
    raise exception 'Member assignments apply only to partner accounts' using errcode='22023'; end if;
  mutation_time=clock_timestamp();
  if p_invitation is not null then
    if p_expected is null or p_expected<1 then raise exception 'Invitation version is required' using errcode='22023'; end if;
    select * into inv from public.title_invitations where id=p_invitation and workspace_id=p_workspace for update;
    if not found then raise exception 'Invitation unavailable' using errcode='22023'; end if;
    had_invitation=true;
    if lower(btrim(inv.email))<>recipient then raise exception 'Invitation email cannot be changed' using errcode='22023'; end if;
    if inv.accepted_at is not null then raise exception 'Accepted invitations cannot be changed' using errcode='40001'; end if;
    action=case when p_reissue then 'reissued' else 'edited' end;
  elsif p_expected is not null or p_reissue then
    raise exception 'Choose an invitation to change' using errcode='22023';
  else
    if p_request is not null then
      select * into inv from public.title_invitations where workspace_id=p_workspace and request_id=p_request for update;
      had_invitation=found;
    end if;
    if not had_invitation then
      select * into inv from public.title_invitations where workspace_id=p_workspace and lower(btrim(email))=recipient
        and accepted_at is null and revoked_at is null order by created_at desc,id desc limit 1 for update;
      had_invitation=found;
    end if;
    action='prepared';
  end if;
  if had_invitation then
    if actor.role<>'owner' and (inv.role='admin' or inv.all_companies or inv.restricted_access
      or (not actor.all_companies and not inv.company_ids<@actor.company_ids)) then
      raise exception 'Only the owner may change this invitation' using errcode='42501'; end if;
    same_grant=lower(btrim(inv.email))=recipient and inv.role=p_role and inv.all_companies=p_all_companies and inv.restricted_access=p_restricted
      and (select coalesce(array_agg(c order by c),'{}') from (select distinct unnest(inv.company_ids) c) x)=companies
      and (select coalesce(jsonb_agg(jsonb_build_object('companyId',company_id,'memberName',member_name) order by company_id,member_name),'[]')
        from (select distinct m->>'companyId' company_id,m->>'memberName' member_name from jsonb_array_elements(inv.partner_members) m) x)=partners;
    if p_invitation is null then
      if not same_grant then raise exception 'A pending invitation or request already has different access. Review it before changing access' using errcode='40001'; end if;
      if p_request is not null and inv.request_id=p_request then replay=true;
      else raise exception 'An invitation already exists. Review it before preparing different access' using errcode='40001'; end if;
    elsif inv.version<>p_expected then
      if inv.version=p_expected+1 and inv.last_action=action and same_grant and inv.revoked_at is null then replay=true;
      else raise exception 'Invitation changed. Refresh before saving' using errcode='40001'; end if;
    elsif not p_reissue and (inv.revoked_at is not null or inv.expires_at<=mutation_time) then
      raise exception 'Only pending invitations can be edited. Review and reissue it' using errcode='40001';
    elsif not p_reissue and same_grant then replay=true;
    end if;
    if replay then
      return jsonb_build_object('id',inv.id,'version',inv.version,'expires_at',inv.expires_at,'replayed',true,
        'accepted_at',inv.accepted_at,'revoked_at',inv.revoked_at);
    end if;
  end if;
  -- Legacy duplicate invitations are canceled atomically when an explicit new
  -- grant is prepared. This prevents a second pending row undoing the review.
  update public.title_invitations set revoked_at=mutation_time,version=version+1,updated_at=mutation_time,last_action='cancelled'
    where workspace_id=p_workspace and lower(btrim(email))=recipient and accepted_at is null and revoked_at is null
    and (not had_invitation or id<>inv.id);
  select coalesce(jsonb_agg(m || jsonb_build_object('id',coalesce(
    (select prior->>'id' from jsonb_array_elements(coalesce(inv.partner_members,'[]')) prior
      where prior->>'companyId'=m->>'companyId' and prior->>'memberName'=m->>'memberName' limit 1),gen_random_uuid()::text))),'[]')
    into stored_partners from jsonb_array_elements(partners) m;
  if had_invitation then
    update public.title_invitations set role=p_role,company_ids=companies,all_companies=p_all_companies,restricted_access=p_restricted,
      partner_members=stored_partners,recipient_user_id=(identity->>'id')::uuid,version=version+1,updated_at=mutation_time,last_action=action,revoked_at=null,
      expires_at=case when p_reissue then mutation_time+interval '7 days' else expires_at end
      where id=inv.id returning * into inv;
  else
    insert into public.title_invitations(workspace_id,email,role,company_ids,all_companies,restricted_access,partner_members,created_by,request_id,recipient_user_id)
      values(p_workspace,recipient,p_role,companies,p_all_companies,p_restricted,stored_partners,p_actor,p_request,(identity->>'id')::uuid) returning * into inv;
  end if;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,p_email,'member.invitation_'||action,companies,
      jsonb_build_object('invitationId',inv.id,'version',inv.version,'role',p_role));
  return jsonb_build_object('id',inv.id,'version',inv.version,'expires_at',inv.expires_at,'replayed',false,
    'accepted_at',inv.accepted_at,'revoked_at',inv.revoked_at);
end $$;

create function public.title_cancel_invitation(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_invitation uuid,p_expected bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor public.title_memberships%rowtype; target public.title_memberships%rowtype; inv public.title_invitations%rowtype; identity jsonb;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not actor.active or actor.version is distinct from p_access_version or actor.role not in ('owner','admin') then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  select * into inv from public.title_invitations where id=p_invitation and workspace_id=p_workspace for update;
  if not found then raise exception 'Invitation unavailable' using errcode='22023'; end if;
  if p_expected is null or p_expected<1 then raise exception 'Invitation version is required' using errcode='22023'; end if;
  identity=title_private.staff_identity(p_workspace,p_actor,p_access_version,null,inv.email);
  if identity->>'id'=p_actor::text or lower(btrim(inv.email))=lower(btrim(p_email)) then
    raise exception 'You cannot change your own access by invitation' using errcode='42501'; end if;
  if identity is not null then
    select * into target from public.title_memberships where workspace_id=p_workspace and user_id=(identity->>'id')::uuid for update;
    if found and (target.role='owner' or (actor.role<>'owner' and (target.role='admin' or target.all_companies or target.restricted_access
      or (not actor.all_companies and not target.company_ids<@actor.company_ids)))) then
      raise exception 'Owner access is required for this account' using errcode='42501'; end if;
  end if;
  if actor.role<>'owner' and (inv.role='admin' or inv.all_companies or inv.restricted_access or not inv.company_ids<@actor.company_ids and not actor.all_companies) then
    raise exception 'Only the owner may change this invitation' using errcode='42501'; end if;
  if inv.accepted_at is not null then raise exception 'Accepted invitations cannot be cancelled; revoke the member instead' using errcode='40001'; end if;
  if inv.version<>p_expected then
    if inv.version=p_expected+1 and inv.last_action='cancelled' and inv.revoked_at is not null then
      return jsonb_build_object('cancelled',true,'id',inv.id,'version',inv.version,'replayed',true); end if;
    raise exception 'Invitation changed. Refresh before saving' using errcode='40001';
  end if;
  if inv.revoked_at is not null then return jsonb_build_object('cancelled',true,'id',inv.id,'version',inv.version,'replayed',true); end if;
  update public.title_invitations set revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),last_action='cancelled'
    where id=inv.id returning * into inv;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,p_email,'member.invitation_cancelled',inv.company_ids,jsonb_build_object('invitationId',inv.id,'version',inv.version));
  return jsonb_build_object('cancelled',true,'id',inv.id,'version',inv.version,'replayed',false);
end $$;

create function public.title_revoke_member(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_target uuid,p_expected bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor public.title_memberships%rowtype; target public.title_memberships%rowtype; identity jsonb; cancelled integer;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not actor.active or actor.version is distinct from p_access_version or actor.role not in ('owner','admin') then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  if p_actor=p_target then raise exception 'You cannot revoke your current account' using errcode='42501'; end if;
  select * into target from public.title_memberships where workspace_id=p_workspace and user_id=p_target for update;
  if not found then raise exception 'Member unavailable' using errcode='22023'; end if;
  if target.role='owner' or (target.role='admin' and actor.role<>'owner') then
    raise exception 'Owner access is required' using errcode='42501'; end if;
  if p_expected is null or target.version<>p_expected then raise exception 'Member access changed. Refresh before revoking' using errcode='40001'; end if;
  if actor.role<>'owner' and (target.all_companies or target.restricted_access or not target.company_ids<@actor.company_ids and not actor.all_companies) then
    raise exception 'Only the owner may revoke this member' using errcode='42501'; end if;
  identity=title_private.staff_identity(p_workspace,p_actor,p_access_version,p_target,null);
  if identity is null or identity->>'email' is null then raise exception 'Member identity unavailable' using errcode='22023'; end if;
  update public.title_invitations set revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),last_action='cancelled'
    where workspace_id=p_workspace and (lower(btrim(email))=identity->>'email' or recipient_user_id=p_target)
      and accepted_at is null and revoked_at is null;
  get diagnostics cancelled=row_count;
  update public.title_memberships set active=false,version=version+1 where workspace_id=p_workspace and user_id=p_target returning * into target;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,detail)
    values(p_workspace,p_actor,p_email,'member.revoked',jsonb_build_object('userId',p_target,'version',target.version,'cancelledInvitations',cancelled));
  return jsonb_build_object('revoked',true,'version',target.version,'cancelledInvitations',cancelled);
end $$;

create or replace function public.title_claim_access(p_actor uuid,p_email text,p_state jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare b public.title_bootstrap%rowtype; w uuid; scope uuid; inv public.title_invitations%rowtype;
  existing public.title_memberships%rowtype; state jsonb; affected uuid[];
begin
  -- Auth identity/email confirmation and account setup are verified by title-api.
  select * into b from public.title_bootstrap where singleton=true for update;
  if found and b.consumed_at is null and lower(b.owner_email)=lower(p_email) then
    insert into public.title_workspaces(name,state) values('Ballantyne Title',p_state) returning id into w;
    insert into public.title_memberships(workspace_id,user_id,role,all_companies,restricted_access) values(w,p_actor,'owner',true,true);
    update public.title_bootstrap set consumed_at=now(),workspace_id=w where singleton=true;
    insert into public.title_audit(workspace_id,actor_id,actor_email,action) values(w,p_actor,p_email,'workspace.created');
  end if;
  select coalesce(array_agg(workspace_id order by workspace_id),'{}') into affected from
    (select distinct workspace_id from public.title_invitations where lower(btrim(email))=lower(btrim(p_email))
      and (recipient_user_id is null or recipient_user_id=p_actor)
      and accepted_at is null and revoked_at is null and expires_at>clock_timestamp()) candidates;
  foreach scope in array affected loop perform pg_advisory_xact_lock(19492271,hashtext(scope::text)); end loop;
  foreach scope in array affected loop
    select * into existing from public.title_memberships where workspace_id=scope and user_id=p_actor for update;
    select ws.state into state from public.title_workspaces ws where id=scope for share;
    -- A recheck after the lock is essential: cancellation/revocation may have
    -- committed while this claim was waiting. Latest legacy duplicate wins.
    select * into inv from public.title_invitations where workspace_id=scope and lower(btrim(email))=lower(btrim(p_email))
      and (recipient_user_id is null or recipient_user_id=p_actor)
      and accepted_at is null and revoked_at is null and expires_at>clock_timestamp()
      order by created_at desc,id desc limit 1 for update;
    if not found then continue; end if;
    if existing.role='owner' then continue; end if;
    if exists(select 1 from unnest(inv.company_ids) c where not exists(
      select 1 from jsonb_array_elements(coalesce(state->'companies','[]')) company where company->>'id'=c)) then continue; end if;
    if exists(select 1 from jsonb_array_elements(inv.partner_members) m where not exists(
      select 1 from jsonb_array_elements(coalesce(state->'companies','[]')) c,
        jsonb_array_elements(coalesce(c->'members','[]')) member
      where c->>'id'=m->>'companyId' and member->>'name'=m->>'memberName')) then continue; end if;
    insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access,partner_members)
      values(scope,p_actor,inv.role,inv.company_ids,inv.all_companies,inv.restricted_access,inv.partner_members)
      on conflict(workspace_id,user_id) do update set role=excluded.role,company_ids=excluded.company_ids,all_companies=excluded.all_companies,
        restricted_access=excluded.restricted_access,partner_members=excluded.partner_members,active=true,version=public.title_memberships.version+1
      where public.title_memberships.role<>'owner';
    update public.title_invitations set accepted_at=clock_timestamp(),recipient_user_id=p_actor,version=version+1,updated_at=clock_timestamp(),last_action='accepted' where id=inv.id;
    update public.title_invitations set revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),last_action='cancelled'
      where workspace_id=scope and lower(btrim(email))=lower(btrim(p_email)) and accepted_at is null and revoked_at is null;
    insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
      values(scope,p_actor,p_email,'member.invitation_accepted',inv.company_ids,jsonb_build_object('invitationId',inv.id,'version',inv.version+1));
  end loop;
  return w;
end $$;

revoke all on function public.title_prepare_invitation(uuid,uuid,text,bigint,text,text,text[],boolean,boolean,jsonb,uuid,bigint,boolean,uuid) from public,anon,authenticated;
revoke all on function public.title_cancel_invitation(uuid,uuid,text,bigint,uuid,bigint) from public,anon,authenticated;
revoke all on function public.title_revoke_member(uuid,uuid,text,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.title_prepare_invitation(uuid,uuid,text,bigint,text,text,text[],boolean,boolean,jsonb,uuid,bigint,boolean,uuid) to service_role;
grant execute on function public.title_cancel_invitation(uuid,uuid,text,bigint,uuid,bigint) to service_role;
grant execute on function public.title_revoke_member(uuid,uuid,text,bigint,uuid,bigint) to service_role;
