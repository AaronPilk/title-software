create schema if not exists title_private;
-- Deliberate screenshots are isolated from title_assets and company/partner libraries.
insert into storage.buckets(id,name,public,file_size_limit) values('title-feedback-screenshots','title-feedback-screenshots',false,4194304) on conflict(id) do update set public=false,file_size_limit=4194304;
-- No storage.objects policies: the verified gateway is the sole storage caller.
alter table public.title_feedback add column screenshot jsonb;
create table title_private.feedback_screenshots (
 feedback_id uuid primary key references public.title_feedback(id) on delete cascade,
 object_path text not null unique, file_name text not null,
 mime text not null check(mime in ('image/png','image/jpeg')),
 byte_size integer not null check(byte_size between 1 and 4194304),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 width integer not null check(width between 1 and 12000), height integer not null check(height between 1 and 12000),
 ready boolean not null default false, created_at timestamptz not null default clock_timestamp(), check(width::bigint*height<=32000000)
);
alter table title_private.feedback_screenshots enable row level security;
revoke all on title_private.feedback_screenshots from public,anon,authenticated,service_role;
grant usage on schema title_private to service_role;
grant select,insert,update on title_private.feedback_screenshots to service_role;
create function public.title_feedback_screenshot(p_workspace uuid,p_actor uuid,p_actor_version bigint,p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.title_memberships%rowtype; f public.title_feedback%rowtype; a title_private.feedback_screenshots%rowtype;
begin
 perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
 select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
 if not found or p_actor_version is null or m.version<>p_actor_version then raise exception 'Feedback access changed.' using errcode='42501'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or p_action is null or p_action not in ('prepare','complete','read') or
 not (p_input ? 'id') or jsonb_typeof(p_input->'id')<>'string' or p_input->>'id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'Invalid screenshot request.' using errcode='22023'; end if;
 if p_action='prepare' then
   if not p_input ?& array['workspaceId','id','kind','message','page','view','email','fileName','mime','byteSize','sha256','width','height'] or
   (p_input-array['workspaceId','id','kind','message','page','view','email','fileName','mime','byteSize','sha256','width','height'])<>'{}'::jsonb or
   p_input->>'workspaceId' is distinct from p_workspace::text or jsonb_typeof(p_input->'fileName')<>'string' or length(p_input->>'fileName') not between 1 and 180 or
   p_input->>'fileName' ~ '[\x01-\x1f\x7f/\\]' or jsonb_typeof(p_input->'mime')<>'string' or p_input->>'mime' not in ('image/png','image/jpeg') or
   jsonb_typeof(p_input->'sha256')<>'string' or p_input->>'sha256' !~ '^[a-f0-9]{64}$' or
   jsonb_typeof(p_input->'byteSize')<>'number' or p_input->>'byteSize' !~ '^[0-9]{1,7}$' or (p_input->>'byteSize')::integer not between 1 and 4194304 or
   jsonb_typeof(p_input->'width')<>'number' or p_input->>'width' !~ '^[0-9]{1,5}$' or (p_input->>'width')::integer not between 1 and 12000 or
   jsonb_typeof(p_input->'height')<>'number' or p_input->>'height' !~ '^[0-9]{1,5}$' or (p_input->>'height')::integer not between 1 and 12000 or
   (p_input->>'width')::bigint*(p_input->>'height')::bigint>32000000 then raise exception 'Invalid screenshot details.' using errcode='22023'; end if;
   perform public.title_submit_feedback(p_workspace,p_actor,p_input->>'email',p_actor_version,(p_input->>'id')::uuid,p_input->>'kind',p_input->>'message',p_input->>'page',p_input->>'view');
 else
   if p_action='read' and (p_input-'id')<>'{}'::jsonb or p_action='complete' and (not p_input ? 'sha256' or (p_input-array['id','sha256'])<>'{}'::jsonb or jsonb_typeof(p_input->'sha256')<>'string' or p_input->>'sha256' !~ '^[a-f0-9]{64}$') then raise exception 'Invalid screenshot request.' using errcode='22023'; end if;
 end if;
 select * into f from public.title_feedback where id=(p_input->>'id')::uuid and workspace_id=p_workspace for update;
 if not found or (f.author_id<>p_actor and (p_action<>'read' or m.role<>'owner')) then raise exception 'Feedback screenshot unavailable.' using errcode='PT404'; end if;
 select * into a from title_private.feedback_screenshots where feedback_id=f.id for update;
 if p_action='prepare' then
   if found then
     if a.sha256<>p_input->>'sha256' or a.file_name<>p_input->>'fileName' or a.mime<>p_input->>'mime' or a.byte_size<>(p_input->>'byteSize')::integer or a.width<>(p_input->>'width')::integer or a.height<>(p_input->>'height')::integer then raise exception 'Screenshot changed.' using errcode='PT409'; end if;
   else
     insert into title_private.feedback_screenshots(feedback_id,object_path,file_name,mime,byte_size,sha256,width,height)
     values(f.id,p_workspace::text||'/'||p_actor::text||'/'||f.id::text||'/'||(p_input->>'sha256'),p_input->>'fileName',p_input->>'mime',(p_input->>'byteSize')::integer,p_input->>'sha256',(p_input->>'width')::integer,(p_input->>'height')::integer) returning * into a;
   end if;
   return jsonb_build_object('path',a.object_path,'ready',a.ready);
 end if;
 if a.feedback_id is null then raise exception 'Screenshot unavailable.' using errcode='PT404'; end if;
 if p_action='read' then
   if not a.ready then raise exception 'Screenshot unavailable.' using errcode='PT404'; end if;
   return jsonb_build_object('path',a.object_path,'fileName',a.file_name,'mime',a.mime,'sha256',a.sha256);
 end if;
 if a.sha256<>p_input->>'sha256' then raise exception 'Screenshot changed.' using errcode='PT409'; end if;
 if not a.ready then
   update title_private.feedback_screenshots set ready=true where feedback_id=f.id;
   update public.title_feedback set screenshot=jsonb_build_object('fileName',a.file_name,'mime',a.mime,'byteSize',a.byte_size,'width',a.width,'height',a.height),version=version+1,updated_at=clock_timestamp() where id=f.id returning * into f;
 end if;
 return to_jsonb(f);
end $$;
revoke all on function public.title_feedback_screenshot(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.title_feedback_screenshot(uuid,uuid,bigint,text,jsonb) to service_role;
