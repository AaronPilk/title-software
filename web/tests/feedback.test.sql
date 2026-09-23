begin;
create temporary table feedback_assertions(label text);
create function pg_temp.ok(actual boolean,label text) returns void language plpgsql as $$
begin if actual is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into feedback_assertions values(label); end $$;
create function pg_temp.reject(code text,statement text,label text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection: %',label using errcode='PTBAD';
 exception when others then if sqlstate<>code then raise; end if; end;
 insert into feedback_assertions values(label); end $$;
do $$ begin execute format('grant usage on schema %I to service_role', (select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
grant all on feedback_assertions to service_role;
insert into auth.users(id,email,email_confirmed_at)
 select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'user'||i||'@example.test',now() from generate_series(1,8) i;
set local role service_role;
insert into public.title_workspaces(id,name,state) values
 ('20000000-0000-4000-8000-000000000001','Fictional feedback','{}'),
 ('20000000-0000-4000-8000-000000000002','Fictional other workspace','{}');
insert into public.title_memberships(workspace_id,user_id,role)
 select '20000000-0000-4000-8000-000000000001',('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 (array['owner','admin','operations','onboarding','finance','viewer','partner'])[i] from generate_series(1,7) i;
insert into public.title_memberships(workspace_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','owner'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000008','operations');
update public.title_memberships set active=false where user_id='10000000-0000-4000-8000-000000000008';
do $$
declare w uuid='20000000-0000-4000-8000-000000000001'; w2 uuid='20000000-0000-4000-8000-000000000002';
 owner_id uuid='10000000-0000-4000-8000-000000000001'; admin_id uuid='10000000-0000-4000-8000-000000000002';
 staff_id uuid='10000000-0000-4000-8000-000000000003'; viewer_id uuid='10000000-0000-4000-8000-000000000006';
 partner_id uuid='10000000-0000-4000-8000-000000000007'; inactive_id uuid='10000000-0000-4000-8000-000000000008';
 actor uuid; signature text; permission text; result jsonb; again jsonb; cursor jsonb; ids text[]='{}'; row_item jsonb;
 staff_note uuid; owner_note uuid; value text; i integer;
begin
 foreach signature in array array[
 'public.title_submit_feedback(uuid,uuid,text,bigint,uuid,text,text,text,text)',
 'public.title_list_feedback(uuid,uuid,bigint,integer,timestamptz,uuid)',
 'public.title_update_feedback(uuid,uuid,bigint,uuid,integer,text,text)'] loop
  perform pg_temp.ok(not has_function_privilege('anon',signature,'execute'),'anonymous denied '||signature);
  perform pg_temp.ok(not has_function_privilege('authenticated',signature,'execute'),'browser denied '||signature);
  perform pg_temp.ok(has_function_privilege('service_role',signature,'execute'),'service permitted '||signature);
  perform pg_temp.ok((select not prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=signature::regprocedure),'invoker with empty search path '||signature);
 end loop;
 foreach permission in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
  perform pg_temp.ok(not has_table_privilege('anon','public.title_feedback',permission),'anonymous table '||permission||' denied');
  perform pg_temp.ok(not has_table_privilege('authenticated','public.title_feedback',permission),'browser table '||permission||' denied');
 end loop;
 perform pg_temp.ok(not has_table_privilege('service_role','public.title_feedback','DELETE'),'server cannot silently delete feedback');
 perform pg_temp.ok((select relrowsecurity from pg_class where oid='public.title_feedback'::regclass),'RLS enabled');
 for i in 1..7 loop
  actor=('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  result=public.title_submit_feedback(w,actor,' USER'||i||'@example.test ',1,gen_random_uuid(),'question',E' \tWhere is the next step?\n ','Overview',case when i=7 then 'partner' else 'agency' end);
  perform pg_temp.ok(result->>'message'='Where is the next step?' and result->>'author_email'='user'||i||'@example.test','role '||i||' can submit and content is normalized');
  perform pg_temp.ok(result->>'status'='new' and result->>'version'='1' and result->>'owner_reply'='','initial status is server-owned');
  if i=1 then owner_note=(result->>'id')::uuid; end if;
  if i=3 then staff_note=(result->>'id')::uuid; end if;
 end loop;
 for i in 2..7 loop
  actor=('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  result=public.title_list_feedback(w,actor,1);
  perform pg_temp.ok(jsonb_array_length(result->'items')=1 and result->'items'->0->>'author_id'=actor::text and result->'nextCursor'='null','role '||i||' lists own notes only');
  perform pg_temp.reject('42501',format('select public.title_update_feedback(%L,%L,1,%L,1,%L,%L)',w,actor,staff_note,'done','Cannot edit'),'non-owner role '||i||' cannot update even own feedback');
 end loop;
 result=public.title_list_feedback(w,owner_id,1);
 perform pg_temp.ok(jsonb_array_length(result->'items')=7,'owner sees workspace feedback');
 perform pg_temp.ok(jsonb_array_length(public.title_list_feedback(w2,owner_id,1)->'items')=0,'owner list still workspace-scoped');
 perform pg_temp.reject('42501',format('select public.title_list_feedback(%L,%L,1)',w2,staff_id),'nonmember workspace denied');
 perform pg_temp.reject('42501',format('select public.title_list_feedback(%L,null,1)',w),'null actor denied');
 perform pg_temp.reject('42501',format('select public.title_list_feedback(null,%L,1)',owner_id),'null workspace denied');
 perform pg_temp.reject('42501',format('select public.title_list_feedback(%L,%L,null)',w,staff_id),'null membership version denied');
 perform pg_temp.reject('42501',format('select public.title_list_feedback(%L,%L,2)',w,staff_id),'stale membership version denied');
 perform pg_temp.reject('42501',format('select public.title_list_feedback(%L,%L,1)',w,inactive_id),'inactive member denied');
 perform pg_temp.reject('42501',format('select public.title_submit_feedback(%L,%L,%L,2,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',gen_random_uuid(),'idea','Try this','Overview','agency'),'stale submit denied');
 perform pg_temp.reject('42501',format('select public.title_update_feedback(%L,%L,2,%L,1,%L,%L)',w,owner_id,staff_note,'done','Fixed'),'stale owner update denied');
 -- Tie every timestamp to prove that the ID tiebreaker gives stable pages.
 update public.title_feedback set created_at='2026-09-23T10:00:00Z';
 loop
  result=public.title_list_feedback(w,owner_id,1,2,(cursor->>'createdAt')::timestamptz,(cursor->>'id')::uuid);
  for row_item in select * from jsonb_array_elements(result->'items') loop ids=array_append(ids,row_item->>'id'); end loop;
  cursor=result->'nextCursor'; exit when cursor='null';
 end loop;
 perform pg_temp.ok(cardinality(ids)=7 and (select count(distinct id) from unnest(ids) id)=7,'tied timestamp pagination loses or repeats no rows');
 perform pg_temp.ok(ids=(select array_agg(id::text order by created_at desc,id desc) from public.title_feedback where workspace_id=w),'pagination preserves descending timestamp then UUID');
 for i in -1..0 loop
  perform pg_temp.reject('22023',format('select public.title_list_feedback(%L,%L,1,%s)',w,owner_id,i),'invalid page size '||i);
 end loop;
 perform pg_temp.reject('22023',format('select public.title_list_feedback(%L,%L,1,51)',w,owner_id),'oversized page rejected');
 perform pg_temp.reject('22023',format('select public.title_list_feedback(%L,%L,1,null)',w,owner_id),'null page size rejected');
 perform pg_temp.reject('22023',format('select public.title_list_feedback(%L,%L,1,2,now(),null)',w,owner_id),'half timestamp cursor rejected');
 perform pg_temp.reject('22023',format('select public.title_list_feedback(%L,%L,1,2,null,%L)',w,owner_id,staff_note),'half UUID cursor rejected');
 perform pg_temp.reject('22023',format('select public.title_list_feedback(%L,%L,1,2,%L,%L)',w,owner_id,'infinity',staff_note),'infinite cursor rejected');
 result=public.title_submit_feedback(w,staff_id,'user3@example.test',1,staff_note,'question','Where is the next step?','Overview','agency');
 again=public.title_submit_feedback(w,staff_id,'user3@example.test',1,staff_note,'question','Where is the next step?','Overview','agency');
 perform pg_temp.ok(again=result,'identical request retries return the same record');
 perform pg_temp.reject('PT409',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',staff_note,'question','Changed payload','Overview','agency'),'changed request payload conflicts');
 perform pg_temp.reject('PT409',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,admin_id,'user2@example.test',staff_note,'question','Where is the next step?','Overview','agency'),'another author cannot replay a note');
 perform pg_temp.reject('PT409',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w2,owner_id,'user1@example.test',owner_note,'question','Where is the next step?','Overview','agency'),'another workspace cannot replay a note');
 foreach value in array array[null,'',E' \t\r\n ',repeat('x',4001),'A'||repeat(' ',4000),E'Bad\x01control'] loop
  perform pg_temp.reject('22023',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',gen_random_uuid(),'idea',value,'Overview','agency'),'invalid message rejected');
 end loop;
 foreach value in array array[null,'invalid','Problem'] loop
  perform pg_temp.reject('22023',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',gen_random_uuid(),value,'Hello','Overview','agency'),'invalid kind rejected');
 end loop;
 foreach value in array array[null,'https://example.test/?private=value','Unknown'] loop
  perform pg_temp.reject('22023',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',gen_random_uuid(),'idea','Hello',value,'agency'),'arbitrary page and URL rejected');
 end loop;
 foreach value in array array[null,'admin','Agency'] loop
  perform pg_temp.reject('22023',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',gen_random_uuid(),'idea','Hello','Overview',value),'invalid view rejected');
 end loop;
 foreach value in array array[null,'','no-email',E'a\nb@example.test',repeat('a',245)||'@example.test'] loop
  perform pg_temp.reject('22023',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,value,gen_random_uuid(),'idea','Hello','Overview','agency'),'invalid author email rejected');
 end loop;
 perform pg_temp.reject('22023',format('select public.title_submit_feedback(%L,%L,%L,1,null,%L,%L,%L,%L)',w,staff_id,'user3@example.test','idea','Hello','Overview','agency'),'null request ID rejected');
 result=public.title_update_feedback(w,owner_id,1,staff_note,1,'in_progress',E' \tInvestigating.\n ');
 perform pg_temp.ok(result->>'version'='2' and result->>'status'='in_progress' and result->>'owner_reply'='Investigating.','owner updates version and trims reply');
 again=public.title_update_feedback(w,owner_id,1,staff_note,1,'in_progress','Investigating.');
 perform pg_temp.ok(again=result,'lost owner update response safely retries');
 again=public.title_update_feedback(w,owner_id,1,staff_note,2,'in_progress','Investigating.');
 perform pg_temp.ok(again=result,'no-op update does not increment version');
 perform pg_temp.reject('PT409',format('select public.title_update_feedback(%L,%L,1,%L,1,%L,%L)',w,owner_id,staff_note,'done','Fixed'),'stale different owner response conflicts');
 perform pg_temp.reject('PT404',format('select public.title_update_feedback(%L,%L,1,%L,2,%L,%L)',w2,owner_id,staff_note,'done','Fixed'),'cross-workspace update unavailable');
 foreach value in array array[null,'deleted','Done'] loop
  perform pg_temp.reject('22023',format('select public.title_update_feedback(%L,%L,1,%L,2,%L,%L)',w,owner_id,staff_note,value,'Fixed'),'invalid update status rejected');
 end loop;
 foreach value in array array[null,repeat('x',2001),'A'||repeat(' ',2000),E'Bad\x01control'] loop
  perform pg_temp.reject('22023',format('select public.title_update_feedback(%L,%L,1,%L,2,%L,%L)',w,owner_id,staff_note,'done',value),'invalid reply rejected');
 end loop;
 perform pg_temp.reject('22023',format('select public.title_update_feedback(%L,%L,1,%L,null,%L,%L)',w,owner_id,staff_note,'done','Fixed'),'null CAS rejected');
 perform pg_temp.reject('22023',format('select public.title_update_feedback(%L,%L,1,%L,0,%L,%L)',w,owner_id,staff_note,'done','Fixed'),'zero CAS rejected');
 result=public.title_update_feedback(w,owner_id,1,staff_note,2,'done',repeat('x',2000));
 perform pg_temp.ok(result->>'version'='3' and char_length(result->>'owner_reply')=2000,'reply boundary accepted');
 perform pg_temp.ok(public.title_list_feedback(w,staff_id,1)->'items'->0->>'owner_reply'=repeat('x',2000),'author sees owner response');
 result=public.title_submit_feedback(w,staff_id,'user3@example.test',1,gen_random_uuid(),'idea',repeat('x',4000),'Tasks','production');
 perform pg_temp.ok(char_length(result->>'message')=4000,'message boundary accepted');
 -- Minute limit: exactly ten new rows accepted, then further requests rejected;
 -- exact retries remain available after the limit to resolve lost responses.
 update public.title_feedback set created_at=clock_timestamp()-interval '2 days';
 for i in 1..10 loop
  result=public.title_submit_feedback(w,viewer_id,'user6@example.test',1,gen_random_uuid(),'problem','Note '||i,'Tasks','agency');
 end loop;
 perform pg_temp.ok((select count(*) from public.title_feedback where author_id=viewer_id and created_at>clock_timestamp()-interval '1 minute')=10,'ten notes accepted in rolling minute');
 perform pg_temp.reject('PT429',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,viewer_id,'user6@example.test',gen_random_uuid(),'problem','One more','Tasks','agency'),'eleventh minute note rejected');
 again=public.title_submit_feedback(w,viewer_id,'user6@example.test',1,(result->>'id')::uuid,'problem','Note 10','Tasks','agency');
 perform pg_temp.ok(again=result,'exact retry does not consume limit');
 -- A full day can be reached without a minute burst.
 insert into public.title_feedback(id,workspace_id,author_id,author_email,kind,message,page,view,created_at)
 select gen_random_uuid(),w,partner_id,'user7@example.test','idea','Earlier note','Partner portal','partner',clock_timestamp()-interval '2 hours'
 from generate_series(1,99);
 result=public.title_submit_feedback(w,partner_id,'user7@example.test',1,gen_random_uuid(),'idea','Hundredth','Partner portal','partner');
 perform pg_temp.ok(result->>'message'='Hundredth','hundredth daily note accepted');
 perform pg_temp.reject('PT429',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,partner_id,'user7@example.test',gen_random_uuid(),'idea','Too many','Partner portal','partner'),'101st daily note rejected');
 update public.title_memberships set active=false,version=2 where workspace_id=w and user_id=staff_id;
 perform pg_temp.reject('42501',format('select public.title_list_feedback(%L,%L,1)',w,staff_id),'revoked member cannot read prior feedback');
 perform pg_temp.reject('42501',format('select public.title_submit_feedback(%L,%L,%L,1,%L,%L,%L,%L,%L)',w,staff_id,'user3@example.test',staff_note,'question','Where is the next step?','Overview','agency'),'revoked member cannot replay');
end $$;
reset role;
select count(*)||' feedback SQL assertions passed' from feedback_assertions;
rollback;
