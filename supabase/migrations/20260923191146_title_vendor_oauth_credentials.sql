-- OAuth connection metadata is per company. Credentials live only in Vault and
-- are never added to workspace snapshots, backups, jobs, or audit details.
create table public.title_vendor_connections (
  workspace_id uuid not null references public.title_workspaces(id),
  company_id text not null check(company_id ~ '^[-A-Za-z0-9_ .:@]{1,180}$'),
  provider text not null check(provider in ('docusign','quickbooks')),
  revision bigint not null default 0 check(revision >= 0),
  generation bigint not null default 0 check(generation >= 0),
  environment text check(environment in ('sandbox','production')),
  metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
  secret_id uuid references vault.secrets(id),
  connected_at timestamptz,
  expires_at timestamptz,
  lease_id uuid,
  lease_kind text check(lease_kind in ('oauth','refresh')),
  lease_actor uuid references auth.users(id),
  lease_access_version bigint,
  lease_environment text check(lease_environment in ('sandbox','production')),
  lease_expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,company_id,provider),
  check((lease_id is null)=(lease_kind is null) and (lease_id is null)=(lease_actor is null)
    and (lease_id is null)=(lease_access_version is null) and (lease_id is null)=(lease_environment is null)
    and (lease_id is null)=(lease_expires_at is null))
);
create unique index title_vendor_quickbooks_realm_idx on public.title_vendor_connections(workspace_id,environment,(metadata->>'realmId')) where provider='quickbooks' and secret_id is not null;
create index title_vendor_connections_lease_actor_idx on public.title_vendor_connections(lease_actor);
create index title_vendor_connections_secret_idx on public.title_vendor_connections(secret_id);
create table public.title_vendor_oauth_states (
  state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null,
  company_id text not null,
  provider text not null,
  actor_id uuid not null references auth.users(id),
  access_version bigint not null,
  expected_revision bigint not null,
  environment text not null check(environment in ('sandbox','production')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,company_id,provider) references public.title_vendor_connections(workspace_id,company_id,provider) on delete cascade
);
create index title_vendor_oauth_connection_idx on public.title_vendor_oauth_states(workspace_id,company_id,provider);
create index title_vendor_oauth_actor_idx on public.title_vendor_oauth_states(actor_id);
create index title_vendor_oauth_expiry_idx on public.title_vendor_oauth_states(expires_at);
alter table public.title_vendor_connections enable row level security;
alter table public.title_vendor_oauth_states enable row level security;
revoke all on public.title_vendor_connections,public.title_vendor_oauth_states from public,anon,authenticated,service_role;

-- Internal helpers are callable only by the owner of the service RPCs. A shared
-- lifecycle lock and membership row lock fence revocation/role/company changes.
create function public.title_vendor_authorized(p_workspace uuid,p_actor uuid,p_access_version bigint,p_company text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.title_memberships%rowtype; state jsonb;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not m.active or p_access_version is null or m.version<>p_access_version or
    not (m.role='owner' or (m.role='admin' and m.all_companies)) then return false; end if;
  select w.state into state from public.title_workspaces w where id=p_workspace for share;
  if not found then return false; end if;
  return p_company is null or exists(select 1 from jsonb_array_elements(coalesce(state->'companies','[]'::jsonb)) c where c->>'id'=p_company);
end $$;
create function public.title_vendor_public_status(c public.title_vendor_connections)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('provider',c.provider,'companyId',c.company_id,'configured',c.secret_id is not null,
    'revision',coalesce(c.revision,0),'generation',coalesce(c.generation,0),'environment',c.environment,'metadata',coalesce(c.metadata,'{}'::jsonb),
    'connectedAt',c.connected_at,'expiresAt',c.expires_at,
    'busy',coalesce(c.lease_id is not null and c.lease_expires_at>clock_timestamp(),false));
$$;
revoke all on function public.title_vendor_authorized(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.title_vendor_public_status(public.title_vendor_connections) from public,anon,authenticated,service_role;

create function public.title_vendor_list(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.title_vendor_authorized(p_workspace,p_actor,p_access_version) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(public.title_vendor_public_status(c) order by c.company_id,c.provider),'[]'::jsonb)
    from public.title_vendor_connections c where c.workspace_id=p_workspace and exists(
      select 1 from public.title_workspaces w,jsonb_array_elements(coalesce(w.state->'companies','[]'::jsonb)) company
      where w.id=p_workspace and company->>'id'=c.company_id));
end $$;
create function public.title_vendor_status(p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype;
begin
  if not public.title_vendor_authorized(p_workspace,p_actor,p_access_version,p_company) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  if p_provider is null or p_provider not in ('docusign','quickbooks') or p_company is null then
    raise exception 'Invalid vendor connection' using errcode='22023'; end if;
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider;
  return public.title_vendor_public_status(c)||jsonb_build_object('provider',p_provider,'companyId',p_company);
end $$;
create function public.title_vendor_read(p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; tokens text;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for share;
  if c.secret_id is null then raise exception 'Vendor connection is unavailable' using errcode='PT409'; end if;
  select decrypted_secret into tokens from vault.decrypted_secrets where id=c.secret_id;
  if tokens is null then raise exception 'Vendor credential is unavailable' using errcode='PT409'; end if;
  return public.title_vendor_public_status(c)||jsonb_build_object('tokens',tokens::jsonb);
end $$;
create function public.title_vendor_start_oauth(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,
  p_environment text,p_expected bigint,p_state_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; expiry timestamptz=clock_timestamp()+interval '10 minutes';
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  if p_environment is null or p_environment not in ('sandbox','production') or p_expected is null or p_expected<0
    or p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid authorization request' using errcode='22023'; end if;
  insert into public.title_vendor_connections(workspace_id,company_id,provider) values(p_workspace,p_company,p_provider) on conflict do nothing;
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  if c.revision<>p_expected then raise exception 'Vendor connection changed. Refresh and try again.' using errcode='PT409'; end if;
  if c.lease_id is not null and c.lease_expires_at>clock_timestamp() then
    raise exception 'Vendor connection is busy. Try again shortly.' using errcode='PT409'; end if;
  -- Consumed and expired state records have no reusable credentials; pruning is
  -- bounded to this workspace and does not remove live authorization attempts.
  delete from public.title_vendor_oauth_states where workspace_id=p_workspace and expires_at<clock_timestamp()-interval '1 day';
  update public.title_vendor_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp())
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider;
  insert into public.title_vendor_oauth_states(state_hash,workspace_id,company_id,provider,actor_id,access_version,expected_revision,environment,expires_at)
    values(p_state_hash,p_workspace,p_company,p_provider,p_actor,p_access_version,p_expected,p_environment,expiry);
  return jsonb_build_object('expiresAt',expiry,'revision',c.revision);
end $$;
create function public.title_vendor_claim_oauth(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_state_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; s public.title_vendor_oauth_states%rowtype;
  allowed boolean; lease uuid=gen_random_uuid();
begin
  -- Return, rather than raise, after consuming a matching state: a rejected
  -- callback must not roll the one-time consumption back with its transaction.
  allowed=public.title_vendor_authorized(p_workspace,p_actor,p_access_version,p_company);
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  select * into s from public.title_vendor_oauth_states where state_hash=p_state_hash and workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  if not found or s.consumed_at is not null then return jsonb_build_object('ok',false,'error','Authorization is unavailable or already used. Start again.'); end if;
  update public.title_vendor_oauth_states set consumed_at=clock_timestamp() where state_hash=p_state_hash;
  if not allowed or p_actor is distinct from s.actor_id or p_access_version is distinct from s.access_version
    or s.expires_at<=clock_timestamp() or c.revision is distinct from s.expected_revision then
    return jsonb_build_object('ok',false,'error','Authorization expired or access changed. Start again.'); end if;
  if c.lease_id is not null and c.lease_expires_at>clock_timestamp() then
    return jsonb_build_object('ok',false,'error','Vendor connection is busy. Start again shortly.'); end if;
  update public.title_vendor_connections set lease_id=lease,lease_kind='oauth',lease_actor=p_actor,
    lease_access_version=p_access_version,lease_environment=s.environment,lease_expires_at=clock_timestamp()+interval '2 minutes'
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider;
  return jsonb_build_object('ok',true,'leaseId',lease,'revision',c.revision,'environment',s.environment);
end $$;
create function public.title_vendor_claim_refresh(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_expected bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; tokens text; lease uuid=gen_random_uuid();
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  if not found or c.secret_id is null or p_expected is null or c.revision<>p_expected then
    raise exception 'Vendor connection changed. Refresh and try again.' using errcode='PT409'; end if;
  if (c.lease_id is not null and c.lease_expires_at>clock_timestamp()) or exists(select 1 from public.title_vendor_oauth_states
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider and consumed_at is null and expires_at>clock_timestamp()) then
    return jsonb_build_object('ok',false,'error','Vendor authorization is in progress. Try again shortly.'); end if;
  select decrypted_secret into tokens from vault.decrypted_secrets where id=c.secret_id;
  if tokens is null then raise exception 'Vendor credential is unavailable' using errcode='PT409'; end if;
  update public.title_vendor_connections set lease_id=lease,lease_kind='refresh',lease_actor=p_actor,
    lease_access_version=p_access_version,lease_environment=c.environment,lease_expires_at=clock_timestamp()+interval '2 minutes'
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider;
  return public.title_vendor_public_status(c)||jsonb_build_object('ok',true,'leaseId',lease,'tokens',tokens::jsonb);
end $$;
create function public.title_vendor_finish(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,
  p_lease uuid,p_tokens jsonb,p_metadata jsonb,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; secret uuid; email text; kind text;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  if not found or p_lease is null or c.lease_id is distinct from p_lease or c.lease_actor is distinct from p_actor
    or c.lease_access_version is distinct from p_access_version or c.lease_expires_at<=clock_timestamp() then
    raise exception 'Vendor authorization lease expired or changed. Start again.' using errcode='PT409'; end if;
  if p_tokens is null or jsonb_typeof(p_tokens)<>'object' or (p_tokens-'accessToken'-'refreshToken')<>'{}'::jsonb
    or coalesce(jsonb_typeof(p_tokens->'accessToken'),'')<>'string' or length(p_tokens->>'accessToken') not between 1 and 16384
    or coalesce(jsonb_typeof(p_tokens->'refreshToken'),'')<>'string' or length(p_tokens->>'refreshToken') not between 1 and 16384
    or (p_tokens->>'accessToken') ~ '[[:space:][:cntrl:]]' or (p_tokens->>'refreshToken') ~ '[[:space:][:cntrl:]]'
    or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '24 hours' then
    raise exception 'Invalid vendor credentials' using errcode='22023'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or (p_metadata-'accountId'-'accountName'-'baseUri'-'realmId')<>'{}'::jsonb
    or coalesce(jsonb_typeof(p_metadata->'accountName'),'')<>'string' or length(p_metadata->>'accountName') not between 1 and 1024
    or (p_metadata->>'accountName') ~ '[[:cntrl:]]' then
    raise exception 'Invalid vendor account details' using errcode='22023'; end if;
  if (p_provider='quickbooks' and (coalesce(jsonb_typeof(p_metadata->'realmId'),'')<>'string' or coalesce(p_metadata->>'realmId','') !~ '^[0-9]{1,30}$' or p_metadata ? 'accountId' or p_metadata ? 'baseUri'))
    or (p_provider='docusign' and (coalesce(jsonb_typeof(p_metadata->'accountId'),'')<>'string' or coalesce(p_metadata->>'accountId','') !~ '^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$'
      or coalesce(p_metadata->>'baseUri','') !~ case when c.lease_environment='sandbox' then '^https://demo[.]docusign[.]net$' else '^https://(www|na2|na3|na4|ca|eu|au)[.]docusign[.]net$' end or p_metadata ? 'realmId')) then
    raise exception 'Invalid vendor account details' using errcode='22023'; end if;
  if c.lease_kind='refresh' and (c.metadata<>p_metadata or c.environment is distinct from c.lease_environment) then
    raise exception 'Refresh cannot change the connected account' using errcode='PT409'; end if;
  kind=c.lease_kind;
  if c.secret_id is null then
    secret=vault.create_secret(p_tokens::text,'title:vendor:'||p_workspace::text||':'||p_company||':'||p_provider,'Company OAuth credential');
  else secret=c.secret_id; perform vault.update_secret(secret,p_tokens::text); end if;
  update public.title_vendor_connections set secret_id=secret,revision=revision+1,generation=generation+case when kind='oauth' then 1 else 0 end,environment=lease_environment,metadata=p_metadata,
    connected_at=case when kind='oauth' then clock_timestamp() else connected_at end,expires_at=p_expires_at,updated_at=clock_timestamp(),
    lease_id=null,lease_kind=null,lease_actor=null,lease_access_version=null,lease_environment=null,lease_expires_at=null
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider returning * into c;
  update public.title_vendor_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp())
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider;
  select u.email into email from auth.users u where id=p_actor;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,email,case when kind='oauth' then 'vendor.connected' else 'vendor.token_refreshed' end,array[p_company],
      jsonb_build_object('provider',p_provider,'environment',c.environment,'connectionRevision',c.revision));
  return public.title_vendor_public_status(c);
exception when unique_violation then
  raise exception 'This vendor account is already connected to another company in this workspace.' using errcode='PT409';
end $$;
create function public.title_vendor_release(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_lease uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare count_changed integer;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  update public.title_vendor_connections set lease_id=null,lease_kind=null,lease_actor=null,lease_access_version=null,lease_environment=null,lease_expires_at=null
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider and lease_id=p_lease
      and lease_actor=p_actor and lease_access_version=p_access_version;
  get diagnostics count_changed=row_count;
  return jsonb_build_object('released',count_changed=1);
end $$;
create function public.title_vendor_disconnect(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_expected bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; old_secret uuid; email text;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  insert into public.title_vendor_connections(workspace_id,company_id,provider) values(p_workspace,p_company,p_provider) on conflict do nothing;
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  if p_expected is null or c.revision<>p_expected then raise exception 'Vendor connection changed. Refresh and try again.' using errcode='PT409'; end if;
  old_secret=c.secret_id;
  update public.title_vendor_connections set secret_id=null,revision=revision+1,generation=generation+1,environment=null,metadata='{}',connected_at=null,expires_at=null,
    lease_id=null,lease_kind=null,lease_actor=null,lease_access_version=null,lease_environment=null,lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider returning * into c;
  if old_secret is not null then delete from vault.secrets where id=old_secret; end if;
  update public.title_vendor_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp())
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider;
  select u.email into email from auth.users u where id=p_actor;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,email,'vendor.disconnected',array[p_company],jsonb_build_object('provider',p_provider,'connectionRevision',c.revision));
  return public.title_vendor_public_status(c);
end $$;

-- Explicit service-only grants. Even the API service cannot read the tables or
-- Vault directly: every credential path rechecks current workspace membership.
do $$ declare signature regprocedure; begin
  for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('title_vendor_list','title_vendor_status','title_vendor_read','title_vendor_start_oauth',
      'title_vendor_claim_oauth','title_vendor_claim_refresh','title_vendor_finish','title_vendor_release','title_vendor_disconnect') loop
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    execute format('grant execute on function %s to service_role',signature);
  end loop;
end $$;

-- A reservation is durable before a draft request reaches DocuSign. A pending
-- request is never automatically sent again after a timeout or process crash.
-- Only a payload hash and remote envelope reference are retained here.
create table public.title_vendor_drafts (
  workspace_id uuid not null,
  company_id text not null,
  provider text not null check(provider='docusign'),
  request_id uuid not null,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id),
  access_version bigint not null,
  connection_revision bigint not null,
  connection_generation bigint not null,
  environment text not null,
  account_id text not null,
  base_uri text not null,
  status text not null default 'pending' check(status in ('pending','created')),
  envelope_id text,
  envelope_status text,
  last_checked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,company_id,provider,request_id),
  foreign key(workspace_id,company_id,provider) references public.title_vendor_connections(workspace_id,company_id,provider),
  check((status='pending' and envelope_id is null and envelope_status is null) or
    (status='created' and envelope_id is not null and envelope_status is not null))
);
create index title_vendor_drafts_actor_idx on public.title_vendor_drafts(actor_id);
create index title_vendor_drafts_list_idx on public.title_vendor_drafts(workspace_id,company_id,provider,created_at desc,request_id desc);
alter table public.title_vendor_drafts enable row level security;
revoke all on public.title_vendor_drafts from public,anon,authenticated,service_role;
create function public.title_vendor_draft_public(d public.title_vendor_drafts)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('requestId',d.request_id,'status',d.status,'envelopeId',d.envelope_id,'envelopeStatus',d.envelope_status,
    'connectionRevision',d.connection_revision,'connectionGeneration',d.connection_generation,'environment',d.environment,'accountId',d.account_id,'createdAt',d.created_at,'updatedAt',d.updated_at,'lastCheckedAt',d.last_checked_at);
$$;
revoke all on function public.title_vendor_draft_public(public.title_vendor_drafts) from public,anon,authenticated,service_role;
create function public.title_vendor_reserve_draft(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_expected bigint,p_request uuid,p_payload_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; d public.title_vendor_drafts%rowtype;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  if p_provider<>'docusign' or p_request is null or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid draft request' using errcode='22023'; end if;
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for update;
  if not found or c.secret_id is null or p_expected is null or c.revision<>p_expected then
    raise exception 'Vendor connection changed. Refresh and try again.' using errcode='PT409'; end if;
  if c.lease_id is not null and c.lease_expires_at>clock_timestamp() then
    raise exception 'Vendor connection is busy. Try again shortly.' using errcode='PT409'; end if;
  select * into d from public.title_vendor_drafts where workspace_id=p_workspace and company_id=p_company and provider=p_provider and request_id=p_request;
  if found then
    if d.payload_hash<>p_payload_hash or d.actor_id<>p_actor or d.connection_generation<>c.generation
      or d.environment<>c.environment or d.account_id<>c.metadata->>'accountId' or d.base_uri<>c.metadata->>'baseUri' then
      raise exception 'Draft request changed. Review the existing request before continuing.' using errcode='PT409'; end if;
    return public.title_vendor_draft_public(d)||jsonb_build_object('created',false);
  end if;
  insert into public.title_vendor_drafts(workspace_id,company_id,provider,request_id,payload_hash,actor_id,access_version,connection_revision,connection_generation,environment,account_id,base_uri)
    values(p_workspace,p_company,p_provider,p_request,p_payload_hash,p_actor,p_access_version,p_expected,c.generation,c.environment,c.metadata->>'accountId',c.metadata->>'baseUri') returning * into d;
  return public.title_vendor_draft_public(d)||jsonb_build_object('created',true);
end $$;
create function public.title_vendor_finish_draft(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_request uuid,p_envelope text,p_status text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; d public.title_vendor_drafts%rowtype; email text;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  if p_provider<>'docusign' or p_request is null or p_envelope is null or p_envelope !~ '^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$'
    or p_status is null or p_status not in ('created','sent','delivered','completed','declined','voided','deleted','signed','timedout','processing','correct') then
    raise exception 'Invalid envelope reference' using errcode='22023'; end if;
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for share;
  select * into d from public.title_vendor_drafts where workspace_id=p_workspace and company_id=p_company and provider=p_provider and request_id=p_request for update;
  if not found or c.secret_id is null or c.generation<>d.connection_generation
    or c.environment<>d.environment or c.metadata->>'accountId'<>d.account_id or c.metadata->>'baseUri'<>d.base_uri then
    raise exception 'Draft authorization changed. Review its existing provider transaction before continuing.' using errcode='PT409'; end if;
  if d.status='created' then
    if d.envelope_id<>p_envelope then raise exception 'The recorded envelope cannot be replaced' using errcode='PT409'; end if;
    if d.envelope_status=p_status then return public.title_vendor_draft_public(d); end if;
  end if;
  update public.title_vendor_drafts set status='created',envelope_id=p_envelope,envelope_status=p_status,last_checked_at=coalesce(last_checked_at,clock_timestamp()),updated_at=clock_timestamp()
    where workspace_id=p_workspace and company_id=p_company and provider=p_provider and request_id=p_request returning * into d;
  select u.email into email from auth.users u where id=p_actor;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,email,'vendor.draft_recorded',array[p_company],jsonb_build_object('provider',p_provider,'requestId',p_request,'envelopeId',p_envelope));
  return public.title_vendor_draft_public(d);
end $$;
create function public.title_vendor_list_drafts(p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  if p_provider<>'docusign' then raise exception 'Invalid draft provider' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(public.title_vendor_draft_public(d) order by d.created_at desc,d.request_id desc),'[]'::jsonb)
    from (select * from public.title_vendor_drafts where workspace_id=p_workspace and company_id=p_company and provider=p_provider order by created_at desc,request_id desc limit 50) d);
end $$;
revoke all on function public.title_vendor_reserve_draft(uuid,uuid,bigint,text,text,bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.title_vendor_finish_draft(uuid,uuid,bigint,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.title_vendor_list_drafts(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.title_vendor_reserve_draft(uuid,uuid,bigint,text,text,bigint,uuid,text) to service_role;
grant execute on function public.title_vendor_finish_draft(uuid,uuid,bigint,text,text,uuid,text,text) to service_role;
grant execute on function public.title_vendor_list_drafts(uuid,uuid,bigint,text,text) to service_role;

-- DocuSign permits envelope polling no more than once per 15 minutes. Reserve
-- before the provider request so simultaneous tabs and failed lookups also obey
-- the limit. A newly pending, uncertain draft can be looked up once immediately.
create function public.title_vendor_claim_draft_check(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_provider text,p_company text,p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.title_vendor_connections%rowtype; d public.title_vendor_drafts%rowtype;
begin
  perform public.title_vendor_status(p_workspace,p_actor,p_access_version,p_provider,p_company);
  if p_provider<>'docusign' or p_request is null then raise exception 'Invalid draft request' using errcode='22023'; end if;
  select * into c from public.title_vendor_connections where workspace_id=p_workspace and company_id=p_company and provider=p_provider for share;
  select * into d from public.title_vendor_drafts where workspace_id=p_workspace and company_id=p_company and provider=p_provider and request_id=p_request for update;
  if not found or c.secret_id is null or c.generation<>d.connection_generation or c.environment<>d.environment
    or c.metadata->>'accountId'<>d.account_id or c.metadata->>'baseUri'<>d.base_uri then
    raise exception 'Draft authorization changed. Review its existing provider transaction before continuing.' using errcode='PT409'; end if;
  if d.last_checked_at is not null and d.last_checked_at>clock_timestamp()-interval '15 minutes' then
    raise exception 'Wait 15 minutes between checks for this envelope.' using errcode='PT429'; end if;
  update public.title_vendor_drafts set last_checked_at=clock_timestamp() where workspace_id=p_workspace and company_id=p_company
    and provider=p_provider and request_id=p_request returning * into d;
  return public.title_vendor_draft_public(d);
end $$;
revoke all on function public.title_vendor_claim_draft_check(uuid,uuid,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.title_vendor_claim_draft_check(uuid,uuid,bigint,text,text,uuid) to service_role;
