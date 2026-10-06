begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','owner@example.test',now()),('10000000-0000-4000-8000-000000000002','reporter@example.test',now()),('10000000-0000-4000-8000-000000000003','other@example.test',now());
insert into public.title_workspaces(id,name,state) values('20000000-0000-4000-8000-000000000001','Screenshot fixture','{}');
insert into public.title_memberships(workspace_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','partner'),('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','admin');
set local role service_role;
do $$
declare w uuid='20000000-0000-4000-8000-000000000001'; reporter uuid='10000000-0000-4000-8000-000000000002'; owner_id uuid='10000000-0000-4000-8000-000000000001'; other_id uuid='10000000-0000-4000-8000-000000000003'; report_id uuid='30000000-0000-4000-8000-000000000001'; input jsonb; first jsonb; r jsonb;
begin
 if has_table_privilege('authenticated','title_private.feedback_screenshots','select') or has_function_privilege('authenticated','public.title_feedback_screenshot(uuid,uuid,bigint,text,jsonb)','execute') then raise exception 'Browser access leaked'; end if;
 input=jsonb_build_object('workspaceId',w,'id',report_id,'kind','problem','message','Screenshot report','page','Companies','view','partner','email','reporter@example.test','fileName','example.png','mime','image/png','byteSize',68,'sha256',repeat('a',64),'width',1,'height',1);
 first=public.title_feedback_screenshot(w,reporter,1,'prepare',input);
 if first->>'ready'<>'false' or first<>public.title_feedback_screenshot(w,reporter,1,'prepare',input) then raise exception 'Reservation retry changed'; end if;
 if (select count(*) from public.title_feedback)<>1 then raise exception 'Duplicate report'; end if;
 begin perform public.title_feedback_screenshot(w,reporter,1,'read',jsonb_build_object('id',report_id)); raise exception 'Pending screenshot readable'; exception when sqlstate 'PT404' then null; end;
 begin perform public.title_feedback_screenshot(w,reporter,1,'prepare',input||jsonb_build_object('sha256',repeat('b',64))); raise exception 'Changed bytes accepted'; exception when sqlstate 'PT409' then null; end;
 r=public.title_feedback_screenshot(w,reporter,1,'complete',jsonb_build_object('id',report_id,'sha256',repeat('a',64)));
 if r->'screenshot'->>'fileName'<>'example.png' or r->>'message'<>'Screenshot report' then raise exception 'Original report lost'; end if;
 if r<>public.title_feedback_screenshot(w,reporter,1,'complete',jsonb_build_object('id',report_id,'sha256',repeat('a',64))) then raise exception 'Completion retry changed'; end if;
 perform public.title_feedback_screenshot(w,reporter,1,'read',jsonb_build_object('id',report_id));
 perform public.title_feedback_screenshot(w,owner_id,1,'read',jsonb_build_object('id',report_id));
 begin perform public.title_feedback_screenshot(w,other_id,1,'read',jsonb_build_object('id',report_id)); raise exception 'Other reporter accessed screenshot'; exception when sqlstate 'PT404' then null; end;
 begin perform public.title_feedback_screenshot(w,owner_id,1,'complete',jsonb_build_object('id',report_id,'sha256',repeat('a',64))); raise exception 'Owner changed another reporter attachment'; exception when sqlstate 'PT404' then null; end;
 r=public.title_list_feedback(w,reporter,1);
 if r->'items'->0->'screenshot'->>'fileName'<>'example.png' or (r->'items'->0->'screenshot') ? 'object_path' then raise exception 'Metadata projection failed'; end if;
 update public.title_memberships set active=false,version=2 where workspace_id=w and user_id=reporter;
 begin perform public.title_feedback_screenshot(w,reporter,1,'read',jsonb_build_object('id',report_id)); raise exception 'Revoked reporter accessed screenshot'; exception when sqlstate '42501' then null; end;
 perform public.title_feedback_screenshot(w,owner_id,1,'read',jsonb_build_object('id',report_id));
end $$;
reset role;
select 'Screenshot SQL: retries, immutable bytes, original report, partner author, owner-only review, pending/read isolation and revoke passed';
rollback;
