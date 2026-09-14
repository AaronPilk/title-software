-- Per-workspace encrypted credentials. Tokens never enter workspace JSON,
-- application backups, title_integrations.config, or audit detail.
create extension if not exists supabase_vault with schema vault;
create table public.title_missive_credentials (
  workspace_id uuid primary key references public.title_workspaces(id) on delete cascade,
  secret_id uuid references vault.secrets(id),
  revision bigint not null check(revision > 0),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.title_missive_credentials enable row level security;
revoke all on public.title_missive_credentials from public,anon,authenticated,service_role;
create function public.title_missive_credential_status(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.title_memberships%rowtype; c public.title_missive_credentials%rowtype;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_access_version is null or m.version<>p_access_version or
     not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  select * into c from public.title_missive_credentials where workspace_id=p_workspace;
  return jsonb_build_object('exists',found,'configured',c.secret_id is not null,
    'revision',coalesce(c.revision,0),'verifiedAt',c.verified_at);
end $$;
-- Functions need Vault privileges without granting the API service general
-- Vault access. Their EXECUTE grants are service-only; each checks live access.
create function public.title_read_missive_credential(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.title_memberships%rowtype; c public.title_missive_credentials%rowtype; token text;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_access_version is null or m.version<>p_access_version or
     not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  select * into c from public.title_missive_credentials where workspace_id=p_workspace;
  if not found then return jsonb_build_object('exists',false,'revision',0,'token',null,'verifiedAt',null); end if;
  if c.secret_id is not null then
    select decrypted_secret into token from vault.decrypted_secrets where id=c.secret_id;
    if token is null then raise exception 'Missive credential is unavailable'; end if;
  end if;
  return jsonb_build_object('exists',true,'revision',c.revision,'token',token,'verifiedAt',c.verified_at);
end $$;

create function public.title_save_missive_credential(p_workspace uuid,p_actor uuid,p_access_version bigint,p_expected bigint,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.title_memberships%rowtype; c public.title_missive_credentials%rowtype; secret uuid;
  config jsonb; routing jsonb; routes jsonb; email text; verified timestamptz;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_access_version is null or m.version<>p_access_version or
     not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  perform 1 from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select * into c from public.title_missive_credentials where workspace_id=p_workspace for update;
  if p_expected is null or p_expected<0 or coalesce(c.revision,0)<>p_expected then
    raise exception 'Missive connection changed. Refresh before saving.' using errcode='PT409'; end if;
  if p_token is not null and (length(p_token)<16 or length(p_token)>4096 or p_token !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'Invalid Missive token format'; end if;
  if p_token is not null then
    -- Caller must verify this token against Missive before this service-only RPC.
    if c.secret_id is null then
      secret=vault.create_secret(p_token,'title:missive:'||p_workspace::text,'Workspace Missive API credential');
    else
      secret=c.secret_id;
      perform vault.update_secret(secret,p_token);
    end if;
    verified=now();
  else
    secret=null;
  end if;
  insert into public.title_missive_credentials(workspace_id,secret_id,revision,verified_at,updated_by)
    values(p_workspace,secret,p_expected+1,verified,p_actor)
    on conflict(workspace_id) do update set secret_id=excluded.secret_id,revision=excluded.revision,
      verified_at=excluded.verified_at,updated_by=excluded.updated_by,updated_at=now();
  if p_token is null and c.secret_id is not null then delete from vault.secrets where id=c.secret_id; end if;
  -- Invalidate in-flight reviews and pause every old route on rotate/disconnect.
  select i.config into config from public.title_integrations i where workspace_id=p_workspace and provider='missive' for update;
  routing=public.title_missive_routing(config);
  select coalesce(jsonb_agg(r||jsonb_build_object('enabled',false,'version',(routing->>'revision')::bigint+1) order by ord),'[]'::jsonb)
    into routes from jsonb_array_elements(routing->'mappings') with ordinality as x(r,ord);
  insert into public.title_integrations(workspace_id,provider,status,config)
    values(p_workspace,'missive','disabled',(coalesce(config,'{}'::jsonb)-'mapping')||
      jsonb_build_object('schemaVersion',2,'revision',(routing->>'revision')::bigint+1,'mappings',routes))
    on conflict(workspace_id,provider) do update set status='disabled',last_error=null,config=excluded.config;
  select u.email into email from auth.users u where id=p_actor;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,detail)
    values(p_workspace,p_actor,email,case when p_token is null then 'missive.disconnected' else 'missive.credential_verified' end,
      jsonb_build_object('credentialRevision',p_expected+1,'routesPaused',true));
  return jsonb_build_object('configured',p_token is not null,'revision',p_expected+1,'verifiedAt',verified,'source','workspace');
end $$;
revoke all on function public.title_read_missive_credential(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.title_missive_credential_status(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.title_save_missive_credential(uuid,uuid,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.title_read_missive_credential(uuid,uuid,bigint) to service_role;
grant execute on function public.title_missive_credential_status(uuid,uuid,bigint) to service_role;
grant execute on function public.title_save_missive_credential(uuid,uuid,bigint,bigint,text) to service_role;
