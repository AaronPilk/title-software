-- Server-owned application state. Browser roles cannot read snapshots or call privileged commits.
create table public.title_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.title_memberships (
  workspace_id uuid not null references public.title_workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','operations','onboarding','finance','viewer','partner')),
  company_ids text[] not null default '{}',
  all_companies boolean not null default false,
  restricted_access boolean not null default false,
  partner_members jsonb not null default '[]',
  version bigint not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);
create index title_memberships_user_idx on public.title_memberships(user_id,active);
create table public.title_bootstrap (
  singleton boolean primary key default true check(singleton),
  owner_email text not null,
  consumed_at timestamptz,
  workspace_id uuid references public.title_workspaces(id)
);
create table public.title_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  email text not null,
  role text not null check(role in ('admin','operations','onboarding','finance','viewer','partner')),
  company_ids text[] not null default '{}',
  all_companies boolean not null default false,
  restricted_access boolean not null default false,
  partner_members jsonb not null default '[]',
  created_by uuid not null references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now()
);
create index title_invites_workspace_email_idx on public.title_invitations(workspace_id,lower(email));
create index title_invites_creator_idx on public.title_invitations(created_by);
create table public.title_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.title_workspaces(id),
  actor_id uuid not null references auth.users(id),
  actor_email text not null,
  action text not null,
  company_ids text[] not null default '{}',
  detail jsonb not null default '{}',
  revision bigint,
  request_id uuid,
  created_at timestamptz not null default now()
);
create index title_audit_workspace_time_idx on public.title_audit(workspace_id,created_at desc);
create index title_audit_actor_idx on public.title_audit(actor_id);
create table public.title_command_receipts (
  workspace_id uuid not null references public.title_workspaces(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  payload_hash text not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,request_id)
);
create index title_receipts_actor_idx on public.title_command_receipts(actor_id);
create table public.title_assets (
  workspace_id uuid not null references public.title_workspaces(id),
  id text not null,
  company_id text not null,
  document_id text not null,
  object_path text not null unique,
  mime text not null,
  filename text not null,
  byte_size bigint not null check(byte_size >= 0 and byte_size <= 52428800),
  sha256 text not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(workspace_id,id)
);
create index title_assets_uploader_idx on public.title_assets(uploaded_by);
create table public.title_integrations (
  workspace_id uuid not null references public.title_workspaces(id),
  provider text not null check(provider in ('missive','softpro','docusign','accounting','extraction')),
  status text not null default 'not_connected' check(status in ('not_connected','configured','healthy','error','disabled')),
  config jsonb not null default '{}',
  last_checked_at timestamptz,
  last_error text,
  primary key(workspace_id,provider)
);
create table public.title_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  provider text not null,
  external_id text not null,
  kind text not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  payload jsonb not null default '{}',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,provider,external_id,kind)
);
create table public.title_backups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  revision bigint not null,
  state jsonb not null,
  asset_manifest jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index title_backups_workspace_time_idx on public.title_backups(workspace_id,created_at desc);
create index title_backups_creator_idx on public.title_backups(created_by);

do $$ declare t text; begin
  foreach t in array array['title_workspaces','title_memberships','title_bootstrap','title_invitations','title_audit','title_command_receipts','title_assets','title_integrations','title_jobs','title_backups'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select, insert, update, delete on public.%I to service_role',t);
  end loop;
end $$;
grant usage, select on sequence public.title_audit_id_seq to service_role;
revoke all on public.title_audit from service_role;
grant select,insert on public.title_audit to service_role;

create function public.title_claim_access(p_actor uuid,p_email text,p_state jsonb)
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
      on conflict(workspace_id,user_id) do nothing;
    update public.title_invitations set accepted_at=now() where id=inv.id;
  end loop;
  return w;
end $$;

create function public.title_commit(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_request uuid,p_hash text,p_state jsonb,p_actions jsonb,p_companies text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare w public.title_workspaces%rowtype; m public.title_memberships%rowtype; r public.title_command_receipts%rowtype;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or m.version<>p_access_version or m.role in ('viewer','partner') then raise exception 'Access changed' using errcode='42501'; end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select * into r from public.title_command_receipts where workspace_id=p_workspace and request_id=p_request;
  if found then
    if r.actor_id<>p_actor or r.payload_hash<>p_hash then raise exception 'Request ID was already used for different input' using errcode='40001'; end if;
    return jsonb_build_object('revision',r.revision,'replayed',true);
  end if;
  if w.revision<>p_expected then raise exception 'Workspace changed. Refresh before saving.' using errcode='40001'; end if;
  update public.title_workspaces set state=p_state,revision=revision+1,updated_at=now() where id=p_workspace;
  insert into public.title_command_receipts(workspace_id,request_id,actor_id,payload_hash,revision) values(p_workspace,p_request,p_actor,p_hash,w.revision+1);
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail,revision,request_id) values(p_workspace,p_actor,p_email,'workspace.commands',p_companies,jsonb_build_object('actions',p_actions),w.revision+1,p_request);
  return jsonb_build_object('revision',w.revision+1,'replayed',false);
end $$;

create function public.title_restore_backup(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_backup uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare b public.title_backups%rowtype; w public.title_workspaces%rowtype;
begin
  perform 1 from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active and version=p_access_version and role='owner' for share;
  if not found then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found or w.revision<>p_expected then raise exception 'Workspace changed' using errcode='40001'; end if;
  select * into b from public.title_backups where id=p_backup and workspace_id=p_workspace;
  if not found then raise exception 'Backup unavailable'; end if;
  insert into public.title_backups(workspace_id,revision,state,asset_manifest,created_by) values(p_workspace,w.revision,w.state,(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.title_assets a where a.workspace_id=p_workspace),p_actor);
  update public.title_workspaces set state=b.state,revision=revision+1,updated_at=now() where id=p_workspace;
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,detail,revision) values(p_workspace,p_actor,p_email,'workspace.restored',jsonb_build_object('backupId',p_backup),w.revision+1);
  return w.revision+1;
end $$;

revoke all on function public.title_claim_access(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.title_commit(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,jsonb,text[]) from public,anon,authenticated;
revoke all on function public.title_restore_backup(uuid,uuid,text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.title_claim_access(uuid,text,jsonb) to service_role;
grant execute on function public.title_commit(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,jsonb,text[]) to service_role;
grant execute on function public.title_restore_backup(uuid,uuid,text,bigint,bigint,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('title-documents','title-documents',false,52428800) on conflict(id) do nothing;
