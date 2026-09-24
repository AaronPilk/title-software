-- Metadata-only security evidence. No document values, filenames, URLs, emails,
-- tokens, exception messages or request bodies are accepted by these tables.
create table public.title_security_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  actor_id uuid references auth.users(id),
  event_type text not null check (event_type in ('file.download','workspace.export','backup.created','backup.restored','authorization.denied','security.events_exported','access.reviewed','document.scan_clean','document.scan_blocked','document.scan_unavailable')),
  outcome text not null check (outcome in ('success','denied','failure')),
  company_id text check (company_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  record_type text check (record_type in ('asset','workspace','backup','access_review')),
  record_id text check (record_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  record_count integer check (record_count between 0 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  check ((record_type is null) = (record_id is null)),
  check ((event_type = 'authorization.denied') = (outcome = 'denied'))
);
create index title_security_events_page_idx on public.title_security_events(workspace_id,created_at desc,id desc);
create index title_security_events_actor_idx on public.title_security_events(actor_id);
create table public.title_access_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.title_workspaces(id),
  actor_id uuid not null references auth.users(id),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{32}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  member_count integer not null check (member_count between 0 and 1000),
  note text not null check (length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index title_access_reviews_latest_idx on public.title_access_reviews(workspace_id,created_at desc,id desc);
create index title_access_reviews_actor_idx on public.title_access_reviews(actor_id);
alter table public.title_security_events enable row level security;
alter table public.title_access_reviews enable row level security;
revoke all on public.title_security_events,public.title_access_reviews from public,anon,authenticated,service_role;

create schema if not exists title_private;
revoke all on schema title_private from public,anon,authenticated;
grant usage on schema title_private to service_role;

create function title_private.reject_security_evidence_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Security evidence is append-only' using errcode='42501'; end $$;
revoke all on function title_private.reject_security_evidence_mutation() from public,anon,authenticated,service_role;
create trigger title_security_events_immutable before update or delete on public.title_security_events
  for each statement execute function title_private.reject_security_evidence_mutation();
create trigger title_access_reviews_immutable before update or delete on public.title_access_reviews
  for each statement execute function title_private.reject_security_evidence_mutation();

-- Private definers are needed only because even service_role cannot write/read
-- these tables directly. Public API RPCs are invokers, EXECUTE granted solely to
-- service_role. The gateway verifies Auth/session/MFA before passing actor IDs.
create function title_private.require_security_admin(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.title_memberships%rowtype;
begin
  if p_actor is null or (auth.uid() is not null and auth.uid()<>p_actor) then
    raise exception 'Verified account required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not actor.active or actor.version is distinct from p_access_version
    or not (actor.role='owner' or (actor.role='admin' and actor.all_companies)) then
    raise exception 'Workspace-wide administrator access changed' using errcode='42501'; end if;
end $$;
revoke all on function title_private.require_security_admin(uuid,uuid,bigint) from public,anon,authenticated,service_role;

create function title_private.security_snapshot(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if (select count(*) from public.title_memberships where workspace_id=p_workspace)>1000 then
    raise exception 'Workspace membership review exceeds the supported limit' using errcode='22023'; end if;
  -- Canonical arrays make semantic scope changes visible while ignoring order.
  select jsonb_build_object('companyIds',coalesce((select jsonb_agg(id order by id) from
    (select distinct c->>'id' id from public.title_workspaces w,
      jsonb_array_elements(coalesce(w.state->'companies','[]')) c where w.id=p_workspace) companies),'[]'),
    'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role,
      'companyIds',(select coalesce(jsonb_agg(id order by id),'[]') from (select distinct unnest(m.company_ids) id) companies),
      'allCompanies',m.all_companies,'restricted',m.restricted_access,'active',m.active,'version',m.version,
      'partnerAssignmentsDigest',md5(m.partner_members::text)) order by m.user_id)
      from public.title_memberships m where m.workspace_id=p_workspace),'[]')) into result;
  return result;
end $$;
revoke all on function title_private.security_snapshot(uuid) from public,anon,authenticated,service_role;

create function title_private.record_security_event(p_workspace uuid,p_actor uuid,p_event_type text,p_outcome text,
  p_company_id text,p_record_type text,p_record_id text,p_count integer,p_access_version bigint,p_workspace_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid; actor public.title_memberships%rowtype; expected_type text; current_workspace public.title_workspaces%rowtype;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_actor then
    raise exception 'Account identity changed' using errcode='42501'; end if;
  if p_event_type is null or p_event_type not in ('file.download','workspace.export','backup.created','backup.restored','authorization.denied','security.events_exported','access.reviewed','document.scan_clean','document.scan_blocked','document.scan_unavailable')
    or p_outcome is null or p_outcome not in ('success','denied','failure')
    or ((p_event_type='authorization.denied')<>(p_outcome='denied')) then
    raise exception 'Invalid security event type' using errcode='22023'; end if;
  if (p_record_type is null)<>(p_record_id is null)
    or (p_record_type is not null and p_record_type not in ('asset','workspace','backup','access_review'))
    or (p_record_id is not null and p_record_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
    or (p_company_id is not null and p_company_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
    or (p_count is not null and (p_count<0 or p_count>1000000)) then
    raise exception 'Invalid security event metadata' using errcode='22023'; end if;
  if p_record_type in ('workspace','backup','access_review') and p_record_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
    raise exception 'Invalid security record ID' using errcode='22023'; end if;
  expected_type=case p_event_type when 'file.download' then 'asset' when 'workspace.export' then 'workspace'
    when 'backup.created' then 'backup' when 'backup.restored' then 'backup' when 'access.reviewed' then 'access_review' end;
  if p_outcome='success' and expected_type is not null and p_record_type is distinct from expected_type then
    raise exception 'Associated security record required' using errcode='22023'; end if;
  if p_event_type='workspace.export' and p_record_id is distinct from p_workspace::text then
    raise exception 'Workspace record mismatch' using errcode='22023'; end if;
  if p_actor is null and p_event_type not in ('authorization.denied','document.scan_clean','document.scan_blocked','document.scan_unavailable') then
    raise exception 'Verified actor required' using errcode='42501'; end if;
  -- Denials can describe a verified user whose membership was just revoked;
  -- background/public-recipient scanner events may have no authenticated actor.
  if p_actor is not null and p_event_type<>'authorization.denied' then
    select * into actor from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
    if not found or not actor.active or actor.version is distinct from p_access_version then
      raise exception 'Member access changed' using errcode='42501'; end if;
    if p_company_id is not null and not (actor.role='owner' or actor.all_companies or p_company_id=any(actor.company_ids)) then
      raise exception 'Company access denied' using errcode='42501'; end if;
  end if;
  if p_company_id is not null and p_event_type<>'authorization.denied' and not exists (
    select 1 from public.title_workspaces w,jsonb_array_elements(coalesce(w.state->'companies','[]')) c
      where w.id=p_workspace and c->>'id'=p_company_id) then
    raise exception 'Company unavailable' using errcode='22023'; end if;
  if p_event_type='file.download' and p_outcome='success' then
    -- The gateway's allowedAsset projection is valid only for these exact
    -- membership and workspace versions. Recheck after storage download.
    select * into current_workspace from public.title_workspaces where id=p_workspace for share;
    if not found or p_workspace_revision is null or current_workspace.revision is distinct from p_workspace_revision then
      raise exception 'Workspace changed during document download' using errcode='42501'; end if;
    if p_company_id is null or not exists(select 1 from public.title_assets a,
      jsonb_array_elements(coalesce(current_workspace.state->'documents','[]')) d
      where a.workspace_id=p_workspace and a.id=p_record_id and a.company_id=p_company_id
        and d->>'id'=a.document_id and d->>'assetId'=a.id and d->>'companyId'=a.company_id) then
      raise exception 'Document binding changed' using errcode='42501'; end if;
  end if;
  insert into public.title_security_events(workspace_id,actor_id,event_type,outcome,company_id,record_type,record_id,record_count)
    values(p_workspace,p_actor,p_event_type,p_outcome,p_company_id,p_record_type,p_record_id,p_count) returning id into event_id;
  return event_id;
end $$;
revoke all on function title_private.record_security_event(uuid,uuid,text,text,text,text,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function title_private.record_security_event(uuid,uuid,text,text,text,text,text,integer,bigint,bigint) to service_role;
create function public.title_record_security_event(p_workspace uuid,p_actor uuid,p_event_type text,p_outcome text,
  p_company_id text default null,p_record_type text default null,p_record_id text default null,p_count integer default null,p_access_version bigint default null,p_workspace_revision bigint default null)
returns uuid language sql security invoker set search_path='' as $$
 select title_private.record_security_event(p_workspace,p_actor,p_event_type,p_outcome,p_company_id,p_record_type,p_record_id,p_count,p_access_version,p_workspace_revision)
$$;
revoke all on function public.title_record_security_event(uuid,uuid,text,text,text,text,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function public.title_record_security_event(uuid,uuid,text,text,text,text,text,integer,bigint,bigint) to service_role;

create function title_private.security_center(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; digest text; review jsonb;
begin
  perform title_private.require_security_admin(p_workspace,p_actor,p_access_version);
  snapshot=title_private.security_snapshot(p_workspace); digest=md5(snapshot::text);
  select jsonb_build_object('id',r.id,'createdAt',r.created_at,'actorId',r.actor_id,'snapshotDigest',r.snapshot_digest,
    'memberCount',r.member_count,'note',r.note,'current',r.snapshot_digest=digest) into review
    from public.title_access_reviews r where r.workspace_id=p_workspace order by r.created_at desc,r.id desc limit 1;
  return jsonb_build_object('checkedAt',clock_timestamp(),'snapshot',snapshot,'snapshotDigest',digest,'latestReview',review,
    'evidence',jsonb_build_object('eventCount',(select count(*) from public.title_security_events where workspace_id=p_workspace),
      'lastEventAt',(select max(created_at) from public.title_security_events where workspace_id=p_workspace),
      'lastBackupAt',(select max(created_at) from public.title_backups where workspace_id=p_workspace),
      'backupCount',(select count(*) from public.title_backups where workspace_id=p_workspace)));
end $$;
revoke all on function title_private.security_center(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function title_private.security_center(uuid,uuid,bigint) to service_role;
create function public.title_security_center(p_workspace uuid,p_actor uuid,p_access_version bigint)
returns jsonb language sql security invoker set search_path='' as $$ select title_private.security_center(p_workspace,p_actor,p_access_version) $$;
revoke all on function public.title_security_center(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.title_security_center(uuid,uuid,bigint) to service_role;

create function title_private.security_events(p_workspace uuid,p_actor uuid,p_access_version bigint,
  p_before timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; cursor jsonb;
begin
  perform title_private.require_security_admin(p_workspace,p_actor,p_access_version);
  if p_limit is null or p_limit<1 or p_limit>100 or ((p_before is null)<>(p_before_id is null))
    or (p_before is not null and not isfinite(p_before)) then
    raise exception 'Invalid event pagination' using errcode='22023'; end if;
  select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]') into items from (
    select e.id,e.created_at,jsonb_build_object('id',e.id,'createdAt',e.created_at,'actorId',e.actor_id,
      'eventType',e.event_type,'outcome',e.outcome,'companyId',e.company_id,'recordType',e.record_type,
      'recordId',e.record_id,'count',e.record_count) row_data
    from public.title_security_events e where e.workspace_id=p_workspace
      and (p_before is null or (e.created_at,e.id)<(p_before,p_before_id))
    order by e.created_at desc,e.id desc limit p_limit+1) rows;
  if jsonb_array_length(items)>p_limit then
    items=items-p_limit;
    cursor=jsonb_build_object('createdAt',items->(p_limit-1)->>'createdAt','id',items->(p_limit-1)->>'id');
  end if;
  return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
revoke all on function title_private.security_events(uuid,uuid,bigint,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function title_private.security_events(uuid,uuid,bigint,timestamptz,uuid,integer) to service_role;
create function public.title_security_events(p_workspace uuid,p_actor uuid,p_access_version bigint,
  p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns jsonb language sql security invoker set search_path='' as $$ select title_private.security_events(p_workspace,p_actor,p_access_version,p_before,p_before_id,p_limit) $$;
revoke all on function public.title_security_events(uuid,uuid,bigint,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.title_security_events(uuid,uuid,bigint,timestamptz,uuid,integer) to service_role;

create function title_private.record_access_review(p_workspace uuid,p_actor uuid,p_access_version bigint,p_snapshot_digest text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; review public.title_access_reviews%rowtype;
begin
  perform title_private.require_security_admin(p_workspace,p_actor,p_access_version);
  if p_snapshot_digest is null or p_snapshot_digest !~ '^[a-f0-9]{32}$' or p_note is null or length(btrim(p_note)) not between 1 and 1000
    or p_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'Enter a bounded review note and snapshot digest' using errcode='22023'; end if;
  snapshot=title_private.security_snapshot(p_workspace);
  if md5(snapshot::text)<>p_snapshot_digest then
    raise exception 'Memberships or company scope changed. Refresh and review again' using errcode='40001'; end if;
  insert into public.title_access_reviews(workspace_id,actor_id,snapshot_digest,snapshot,member_count,note)
    values(p_workspace,p_actor,p_snapshot_digest,snapshot,jsonb_array_length(snapshot->'members'),btrim(p_note)) returning * into review;
  perform title_private.record_security_event(p_workspace,p_actor,'access.reviewed','success',null,'access_review',review.id::text,review.member_count,p_access_version,null);
  return jsonb_build_object('id',review.id,'createdAt',review.created_at,'actorId',review.actor_id,'snapshotDigest',review.snapshot_digest,
    'memberCount',review.member_count,'note',review.note,'current',true);
end $$;
revoke all on function title_private.record_access_review(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function title_private.record_access_review(uuid,uuid,bigint,text,text) to service_role;
create function public.title_record_access_review(p_workspace uuid,p_actor uuid,p_access_version bigint,p_snapshot_digest text,p_note text)
returns jsonb language sql security invoker set search_path='' as $$ select title_private.record_access_review(p_workspace,p_actor,p_access_version,p_snapshot_digest,p_note) $$;
revoke all on function public.title_record_access_review(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.title_record_access_review(uuid,uuid,bigint,text,text) to service_role;
