-- Auth internals are read only through this narrow, service-only helper.
-- No Auth tables/triggers are modified and no password hashes are copied.
create schema if not exists title_private;
revoke all on schema title_private from public, anon, authenticated;
grant usage on schema title_private to service_role;

create table title_private.account_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_change_required boolean not null default true,
  session_not_before timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);
alter table title_private.account_credentials enable row level security;
revoke all on title_private.account_credentials from public, anon, authenticated, service_role;

create function title_private.security_state(p_user uuid, p_session uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session_valid', exists (
      select 1 from auth.sessions s
      where s.id = p_session and s.user_id = p_user
        and (s.not_after is null or s.not_after > now())
        and s.created_at >= coalesce(c.session_not_before, '-infinity'::timestamptz)
    ),
    'password_change_required', coalesce(c.password_change_required, true),
    'has_totp', exists (
      select 1 from auth.mfa_factors f
      where f.user_id = p_user and f.factor_type = 'totp' and f.status = 'verified'
    ),
    'session_totp', exists (
      select 1 from auth.sessions s join auth.mfa_factors f on f.id = s.factor_id
      where s.id = p_session and s.user_id = p_user and s.aal = 'aal2'
        and f.user_id = p_user and f.factor_type = 'totp' and f.status = 'verified'
    )
  ) from auth.users u left join title_private.account_credentials c on c.user_id = u.id
    where u.id = p_user;
$$;
revoke all on function title_private.security_state(uuid,uuid) from public, anon, authenticated;
grant execute on function title_private.security_state(uuid,uuid) to service_role;

create function public.title_security_state(p_user uuid, p_session uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select title_private.security_state(p_user,p_session);
$$;
revoke all on function public.title_security_state(uuid,uuid) from public, anon, authenticated;
grant execute on function public.title_security_state(uuid,uuid) to service_role;

-- Called only by an authorized provisioning function immediately after rotation.
create function title_private.record_rotation(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into title_private.account_credentials (user_id,password_change_required,session_not_before,rotated_at)
    select id,true,now(),now() from auth.users where id=p_user
  on conflict(user_id) do update set password_change_required=true,
    session_not_before=excluded.session_not_before,rotated_at=excluded.rotated_at;
$$;
revoke all on function title_private.record_rotation(uuid) from public, anon, authenticated;
grant execute on function title_private.record_rotation(uuid) to service_role;
create function public.title_record_credential_rotation(p_user uuid)
returns void language sql security invoker set search_path = '' as $$
  select title_private.record_rotation(p_user);
$$;
revoke all on function public.title_record_credential_rotation(uuid) from public, anon, authenticated;
grant execute on function public.title_record_credential_rotation(uuid) to service_role;

-- The API calls this only after Auth accepts a password update with the user's JWT.
create function title_private.complete_password_change(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into title_private.account_credentials (user_id,password_change_required,session_not_before)
    values(p_user,false,'-infinity'::timestamptz)
  on conflict(user_id) do update set password_change_required=false;
$$;
revoke all on function title_private.complete_password_change(uuid) from public, anon, authenticated;
grant execute on function title_private.complete_password_change(uuid) to service_role;
create function public.title_complete_password_change(p_user uuid)
returns void language sql security invoker set search_path = '' as $$
  select title_private.complete_password_change(p_user);
$$;
revoke all on function public.title_complete_password_change(uuid) from public, anon, authenticated;
grant execute on function public.title_complete_password_change(uuid) to service_role;
