-- Private product feedback: submitted text plus a fixed page/view label only.
-- The verified gateway supplies identity; browsers never read this table or call RPCs.
create table public.title_feedback (
  id uuid primary key,
  workspace_id uuid not null references public.title_workspaces(id),
  author_id uuid not null references auth.users(id),
  author_email text not null check (char_length(author_email) between 3 and 254 and author_email = lower(btrim(author_email)) and author_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  kind text not null check (kind in ('problem','idea','question')),
  message text not null check (char_length(message) between 1 and 4000 and message !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' and message = regexp_replace(message,'^[[:space:]]+|[[:space:]]+$','','g')),
  page text not null check (page in ('Overview','Assistant','Inbox','Orders','Policy workbench','Commitments','Policy products','Handoffs','Revisions','Companies','Onboarding','Documents','Tasks','Financials','Partner portal','Automations','Connections','Settings')),
  view text not null check (view in ('agency','production','partner')),
  status text not null default 'new' check (status in ('new','in_progress','done')),
  owner_reply text not null default '' check (char_length(owner_reply) <= 2000 and owner_reply !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' and owner_reply = regexp_replace(owner_reply,'^[[:space:]]+|[[:space:]]+$','','g')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index title_feedback_workspace_time_idx on public.title_feedback(workspace_id,created_at desc,id desc);
create index title_feedback_author_time_idx on public.title_feedback(workspace_id,author_id,created_at desc,id desc);
-- Index the user FK independently of the workspace to keep identity cleanup bounded.
create index title_feedback_author_idx on public.title_feedback(author_id);
alter table public.title_feedback enable row level security;
revoke all on public.title_feedback from public,anon,authenticated,service_role;
grant select,insert,update on public.title_feedback to service_role;

create function public.title_submit_feedback(
  p_workspace uuid,p_actor uuid,p_email text,p_actor_version bigint,p_id uuid,
  p_kind text,p_message text,p_page text,p_view text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; r public.title_feedback%rowtype;
  normalized_message text=regexp_replace(p_message,'^[[:space:]]+|[[:space:]]+$','','g');
  normalized_email text=lower(btrim(p_email)); minute_count bigint; day_count bigint; stamp timestamptz;
begin
  -- Share the lifecycle lock with staff revoke/claim/assignment. The membership is
  -- re-read after waiting, and its row lock is held through the write.
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_actor_version is null or m.version<>p_actor_version then
    raise exception 'Workspace access changed. Refresh and try again.' using errcode='42501';
  end if;
  if p_id is null or normalized_email is null or char_length(normalized_email) not between 3 and 254
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or p_kind is null or p_kind not in ('problem','idea','question')
     or normalized_message is null or char_length(p_message)>4000 or char_length(normalized_message) not between 1 and 4000
     or p_message ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
     or p_page is null or p_page not in ('Overview','Assistant','Inbox','Orders','Policy workbench','Commitments','Policy products','Handoffs','Revisions','Companies','Onboarding','Documents','Tasks','Financials','Partner portal','Automations','Connections','Settings')
     or p_view is null or p_view not in ('agency','production','partner') then
    raise exception 'Invalid feedback details.' using errcode='22023';
  end if;
  select * into r from public.title_feedback where id=p_id;
  if found then
    if r.workspace_id=p_workspace and r.author_id=p_actor and r.author_email=normalized_email
       and r.kind=p_kind and r.message=normalized_message and r.page=p_page and r.view=p_view then
      return to_jsonb(r);
    end if;
    raise exception 'Feedback request changed. Refresh and try again.' using errcode='PT409';
  end if;
  stamp=clock_timestamp();
  select count(*) filter(where created_at>stamp-interval '1 minute'),count(*) into minute_count,day_count
    from public.title_feedback where workspace_id=p_workspace and author_id=p_actor and created_at>stamp-interval '1 day';
  if minute_count>=10 or day_count>=100 then
    raise exception 'You have sent several notes recently. Please wait before sending another.' using errcode='PT429';
  end if;
  begin
    insert into public.title_feedback(id,workspace_id,author_id,author_email,kind,message,page,view,created_at,updated_at)
      values(p_id,p_workspace,p_actor,normalized_email,p_kind,normalized_message,p_page,p_view,stamp,stamp) returning * into r;
  exception when unique_violation then
    -- A simultaneous ID collision in a different workspace has a different
    -- lifecycle lock. Do not expose that row or its database constraint details.
    raise exception 'Feedback request changed. Refresh and try again.' using errcode='PT409';
  end;
  return to_jsonb(r);
end $$;
revoke all on function public.title_submit_feedback(uuid,uuid,text,bigint,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.title_submit_feedback(uuid,uuid,text,bigint,uuid,text,text,text,text) to service_role;

create function public.title_list_feedback(
  p_workspace uuid,p_actor uuid,p_actor_version bigint,p_limit integer default 50,
  p_before timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; r public.title_feedback%rowtype;
  items jsonb='[]'; cursor jsonb=null; amount integer=0;
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_actor_version is null or m.version<>p_actor_version then
    raise exception 'Workspace access changed. Refresh and try again.' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50
     or (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then
    raise exception 'Invalid feedback page.' using errcode='22023';
  end if;
  for r in select f.* from public.title_feedback f
    where f.workspace_id=p_workspace and (m.role='owner' or f.author_id=p_actor)
      and (p_before is null or (f.created_at,f.id)<(p_before,p_before_id))
    order by f.created_at desc,f.id desc limit p_limit+1 loop
    amount=amount+1;
    if amount<=p_limit then
      items=items||jsonb_build_array(to_jsonb(r));
      cursor=jsonb_build_object('createdAt',r.created_at,'id',r.id);
    end if;
  end loop;
  if amount<=p_limit then cursor=null; end if;
  return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
revoke all on function public.title_list_feedback(uuid,uuid,bigint,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.title_list_feedback(uuid,uuid,bigint,integer,timestamptz,uuid) to service_role;

create function public.title_update_feedback(
  p_workspace uuid,p_actor uuid,p_actor_version bigint,p_id uuid,p_expected_version integer,p_status text,p_reply text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.title_memberships%rowtype; r public.title_feedback%rowtype;
  normalized_reply text=regexp_replace(p_reply,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_actor_version is null or m.version<>p_actor_version or m.role<>'owner' then
    raise exception 'Only the workspace owner can manage developer feedback.' using errcode='42501';
  end if;
  if p_id is null or p_expected_version is null or p_expected_version<1
     or p_status is null or p_status not in ('new','in_progress','done')
     or normalized_reply is null or char_length(p_reply)>2000
     or p_reply ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'Invalid feedback update.' using errcode='22023';
  end if;
  select * into r from public.title_feedback where id=p_id and workspace_id=p_workspace for update;
  if not found then raise exception 'Feedback is unavailable.' using errcode='PT404'; end if;
  if r.version<>p_expected_version then
    if r.version=p_expected_version::bigint+1 and r.status=p_status and r.owner_reply=normalized_reply then return to_jsonb(r); end if;
    raise exception 'Feedback changed. Refresh before saving your response.' using errcode='PT409';
  end if;
  if r.status=p_status and r.owner_reply=normalized_reply then return to_jsonb(r); end if;
  update public.title_feedback set status=p_status,owner_reply=normalized_reply,version=version+1,updated_at=clock_timestamp()
    where id=p_id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.title_update_feedback(uuid,uuid,bigint,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.title_update_feedback(uuid,uuid,bigint,uuid,integer,text,text) to service_role;
