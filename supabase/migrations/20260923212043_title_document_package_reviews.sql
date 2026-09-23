-- Only the verified gateway can read saved text. No browser Data API grants.
create table public.title_document_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  actor_id uuid not null references auth.users(id),
  access_version bigint not null,
  sources_hash text not null check (sources_hash ~ '^[a-f0-9]{64}$'),
  sources jsonb not null check (jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 100),
  checkpoint jsonb,
  pages jsonb not null default '{}' check (jsonb_typeof(pages)='object' and octet_length(pages::text)<=12000000),
  decisions jsonb not null default '[]' check (jsonb_typeof(decisions)='array' and jsonb_array_length(decisions)<=1000),
  version integer not null default 1 check (version>=1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,actor_id,access_version,sources_hash),
  check (checkpoint is null or (jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=1000000))
);
create index title_document_packages_actor_idx on public.title_document_packages(actor_id);
alter table public.title_document_packages enable row level security;
revoke all on public.title_document_packages from public,anon,authenticated,service_role;
grant select,insert,update on public.title_document_packages to service_role;

-- The gateway validates the exact document projection, asset hashes, page receipts,
-- and review candidate IDs. This transaction closes membership/state check races
-- and saves text and its progress checkpoint together, with optimistic locking.
create function public.title_document_package(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_state_revision bigint,
  p_action text,p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.title_memberships%rowtype; r public.title_document_packages%rowtype;
  revision bigint; stamp timestamptz=clock_timestamp();
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_access_version is null or m.version<>p_access_version or m.role not in ('owner','admin','operations','onboarding') then
    raise exception 'Document review access changed. Refresh and try again.' using errcode='42501';
  end if;
  select w.revision into revision from public.title_workspaces w where w.id=p_workspace for share;
  if p_state_revision is null or revision is distinct from p_state_revision then
    raise exception 'Workspace changed. Reopen the document review.' using errcode='PT409';
  end if;
  if p_action='open' then
    select * into r from public.title_document_packages where workspace_id=p_workspace and actor_id=p_actor and access_version=m.version and sources_hash=p_input->>'sourcesHash' for update;
    if not found then
      if (select count(*) from public.title_document_packages where workspace_id=p_workspace and actor_id=p_actor and created_at>stamp-interval '1 day')>=100 then
        raise exception 'Too many new document reviews today. Resume an existing review.' using errcode='PT429';
      end if;
      insert into public.title_document_packages(workspace_id,actor_id,access_version,sources_hash,sources)
        values(p_workspace,p_actor,m.version,p_input->>'sourcesHash',p_input->'sources') returning * into r;
    elsif r.sources is distinct from p_input->'sources' then
      raise exception 'Document sources changed.' using errcode='PT409';
    end if;
  else
    select * into r from public.title_document_packages where workspace_id=p_workspace and actor_id=p_actor and access_version=m.version and id=(p_input->>'id')::uuid for update;
    if not found then raise exception 'Document review is unavailable.' using errcode='PT404'; end if;
    if p_action not in ('load','save','review') then raise exception 'Invalid review action.' using errcode='22023'; end if;
    if p_action in ('save','review') then
      if (p_input->>'expectedVersion')::integer is distinct from r.version then
        raise exception 'Document review changed. Reopen it before continuing.' using errcode='PT409';
      end if;
      if p_action='save' then
        if jsonb_typeof(p_input->'pages') is distinct from 'object' or octet_length((p_input->'pages')::text)>2200000
          or jsonb_typeof(p_input->'checkpoint') is distinct from 'object' then raise exception 'Invalid scan batch.' using errcode='22023'; end if;
        update public.title_document_packages set pages=pages||(p_input->'pages'),checkpoint=p_input->'checkpoint',decisions=case when p_input->'pages'='{}'::jsonb then decisions else '[]'::jsonb end,version=version+1,updated_at=stamp where id=r.id returning * into r;
      else
        update public.title_document_packages set decisions=p_input->'decisions',version=version+1,updated_at=stamp where id=r.id returning * into r;
      end if;
    end if;
  end if;
  if p_action in ('save','review') then return jsonb_build_object('version',r.version,'decisions',r.decisions); end if;
  return to_jsonb(r);
end $$;
revoke all on function public.title_document_package(uuid,uuid,bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.title_document_package(uuid,uuid,bigint,bigint,text,jsonb) to service_role;
