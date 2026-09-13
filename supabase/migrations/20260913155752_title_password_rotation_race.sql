create or replace function title_private.security_state(p_user uuid, p_session uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session_valid', exists (select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user
      and (s.not_after is null or s.not_after>now()) and s.created_at>=coalesce(c.session_not_before,'-infinity'::timestamptz)),
    'password_change_required',coalesce(c.password_change_required,true),
    'credential_version',c.rotated_at,
    'has_totp',exists(select 1 from auth.mfa_factors f where f.user_id=p_user and f.factor_type='totp' and f.status='verified'),
    'session_totp',exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id
      where s.id=p_session and s.user_id=p_user and s.aal='aal2' and f.user_id=p_user and f.factor_type='totp' and f.status='verified')
  ) from auth.users u left join title_private.account_credentials c on c.user_id=u.id where u.id=p_user;
$$;

drop function public.title_complete_password_change(uuid);
drop function title_private.complete_password_change(uuid);
create function title_private.complete_password_change(p_user uuid,p_session uuid,p_expected_rotation timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare credential title_private.account_credentials; session_row auth.sessions;
begin
  -- Insert a default row so concurrent first-time requests also serialize.
  insert into title_private.account_credentials(user_id,password_change_required,session_not_before)
    values(p_user,true,'-infinity'::timestamptz) on conflict(user_id) do nothing;
  select * into credential from title_private.account_credentials where user_id=p_user for update;
  if p_expected_rotation is not null and credential.rotated_at is distinct from p_expected_rotation then
    raise exception using errcode='PT409',message='Your temporary password changed during setup. Sign in again.';
  end if;
  if p_expected_rotation is null and credential.session_not_before <> '-infinity'::timestamptz then
    raise exception using errcode='PT409',message='Your temporary password changed during setup. Sign in again.';
  end if;
  select * into session_row from auth.sessions where id=p_session and user_id=p_user;
  if not found or session_row.created_at<credential.session_not_before
    or (session_row.not_after is not null and session_row.not_after<=now()) then
    raise exception using errcode='42501',message='Your sign-in expired. Sign in again.';
  end if;
  update title_private.account_credentials set password_change_required=false where user_id=p_user;
end;
$$;
revoke all on function title_private.complete_password_change(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function title_private.complete_password_change(uuid,uuid,timestamptz) to service_role;
create function public.title_complete_password_change(p_user uuid,p_session uuid,p_expected_rotation timestamptz)
returns void language sql security invoker set search_path = '' as $$
  select title_private.complete_password_change(p_user,p_session,p_expected_rotation);
$$;
revoke all on function public.title_complete_password_change(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.title_complete_password_change(uuid,uuid,timestamptz) to service_role;

-- Exercise the race on disposable pilot QA records when present. Every probe
-- rolls back its modifications; fresh installations simply skip the probes.
do $$
declare u uuid; s uuid; v timestamptz; i integer; rejected boolean;
begin
  select c.user_id,a.id,c.rotated_at into u,s,v from title_private.account_credentials c
    join auth.users x on x.id=c.user_id join auth.sessions a on a.user_id=x.id
    where x.raw_app_meta_data ? 'title_pilot_qa' and a.created_at>=c.session_not_before limit 1;
  if u is null then return; end if;
  for i in 1..5 loop
    begin
      update title_private.account_credentials set password_change_required=true,rotated_at=v+interval '1 second' where user_id=u;
      rejected:=false;
      begin perform title_private.complete_password_change(u,s,v); exception when sqlstate 'PT409' then rejected:=true; end;
      if not rejected or not (select password_change_required from title_private.account_credentials where user_id=u) then raise exception 'Rotation race verification failed'; end if;
      rejected:=false;
      begin perform title_private.complete_password_change(u,gen_random_uuid(),v+interval '1 second'); exception when insufficient_privilege then rejected:=true; end;
      if not rejected then raise exception 'Session verification failed'; end if;
      raise exception using errcode='ZQ001',message='Roll back successful verification probe';
    exception when sqlstate 'ZQ001' then null;
    end;
  end loop;
end $$;
