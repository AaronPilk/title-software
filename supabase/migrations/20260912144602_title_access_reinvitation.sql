create or replace function public.title_claim_access(p_actor uuid,p_email text,p_state jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare b public.title_bootstrap%rowtype; w uuid; inv public.title_invitations%rowtype;
begin
  if not exists(select 1 from auth.users where id=p_actor and lower(email)=lower(p_email) and email_confirmed_at is not null and not is_anonymous) then raise exception 'Verified account required'; end if;
  select * into b from public.title_bootstrap where singleton=true for update;
  if found and b.consumed_at is null and lower(b.owner_email)=lower(p_email) then
    insert into public.title_workspaces(name,state) values('Ballantyne Title',p_state) returning id into w;
    insert into public.title_memberships(workspace_id,user_id,role,all_companies,restricted_access) values(w,p_actor,'owner',true,true);
    update public.title_bootstrap set consumed_at=now(),workspace_id=w where singleton=true;
    insert into public.title_audit(workspace_id,actor_id,actor_email,action) values(w,p_actor,p_email,'workspace.created');
  end if;
  for inv in select * from public.title_invitations where lower(email)=lower(p_email) and accepted_at is null and revoked_at is null and expires_at>now() for update loop
    insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access,partner_members)
      values(inv.workspace_id,p_actor,inv.role,inv.company_ids,inv.all_companies,inv.restricted_access,inv.partner_members)
      on conflict(workspace_id,user_id) do update set
        role=excluded.role, company_ids=excluded.company_ids, all_companies=excluded.all_companies,
        restricted_access=excluded.restricted_access, partner_members=excluded.partner_members,
        active=true, version=public.title_memberships.version+1
      where public.title_memberships.role<>'owner';
    update public.title_invitations set accepted_at=now() where id=inv.id;
  end loop;
  return w;
end $$;
