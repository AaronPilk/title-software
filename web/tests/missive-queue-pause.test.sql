-- A normal operator pause must not silently narrow a shared inbox's company.
create function pg_temp.assert_queue_pause(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Queue pause regression: %',label; end if; end $$;
create function pg_temp.reject_queue_pause(expected text,statement text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection missing' using errcode='PTBAD';
exception when others then if sqlstate<>expected then raise; end if; end; end $$;
do $$ begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
do $$
declare actor uuid=gen_random_uuid(); w uuid; state_value jsonb; result jsonb; event jsonb; captured jsonb; n integer; count_passed integer=0;
  mapping_a jsonb='{"organizationId":"org","teamId":"shared","companyId":"A","teamName":"Shared inbox","enabled":true}';
  mapping_b jsonb='{"organizationId":"org","teamId":"shared","companyId":"B","teamName":"Shared inbox","enabled":true}';
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'queue-pause@example.test',now());
  set local role service_role;
  for n in 1..5 loop
    begin
      state_value='{"companies":[{"id":"A"},{"id":"B"},{"id":"C"}],"inbox":[]}';
      insert into public.title_workspaces(name,state) values('Shared inbox pause fixture',state_value) returning id into w;
      insert into public.title_memberships(workspace_id,user_id,role,all_companies) values(w,actor,'owner',true);
      perform public.title_save_missive_route(w,actor,'queue-pause@example.test',1,0,mapping_a);
      perform public.title_save_missive_route(w,actor,'queue-pause@example.test',1,1,mapping_b);
      -- Company A pauses processing. B remains active in the same shared inbox.
      result=public.title_save_missive_route(w,actor,'queue-pause@example.test',1,2,mapping_a||'{"enabled":false}');
      event='{"organizationId":"org","teamId":"shared","messageId":"during-pause","conversationId":"thread","routingRevision":3,"companyId":"B","candidateRoutes":[{"id":"route:org:shared:B","companyId":"B","version":2}]}';
      -- The database recomputes full inbox context even if an older deployed
      -- receiver supplied only the remaining active route.
      perform pg_temp.assert_queue_pause(public.title_enqueue_missive_event(w,event),'event accepted with an active route');
      select payload into captured from public.title_jobs where workspace_id=w;
      perform pg_temp.assert_queue_pause(captured->'companyId'='null'::jsonb and jsonb_array_length(captured->'candidateRoutes')=2,'shared identity retained while A paused');
      perform pg_temp.assert_queue_pause(captured->'candidateRoutes'->0->>'companyId'='A' and captured->'candidateRoutes'->1->>'companyId'='B','both exact company identities retained');
      perform pg_temp.reject_queue_pause('PT409',format('select public.title_import_missive_routed(%L,%L,%L,1,0,%L,%L,%L,3,%L,3,%L,%L)',w,actor,'queue-pause@example.test',gen_random_uuid(),'paused',state_value,'A','route:org:shared:A','importMissiveText'));
      -- Re-enabling A makes it available for explicit review without rewriting
      -- the original event or its captured approval versions.
      result=public.title_save_missive_route(w,actor,'queue-pause@example.test',1,3,mapping_a);
      perform pg_temp.assert_queue_pause((select payload from public.title_jobs where workspace_id=w)=captured,'re-enable does not rewrite source event history');
      perform pg_temp.assert_queue_pause(not public.title_enqueue_missive_event(w,event||'{"routingRevision":4}'),'retry after re-enable remains idempotent');
      state_value=jsonb_set(state_value,'{inbox}','[{"companyId":"A","orderId":"O-A","missive":{"organizationId":"org","teamId":"shared","messageId":"during-pause","mappingVersion":4}}]');
      result=public.title_import_missive_routed(w,actor,'queue-pause@example.test',1,0,gen_random_uuid(),'reviewed-company-a',state_value,4,'A',4,'route:org:shared:A','importMissiveText');
      perform pg_temp.assert_queue_pause(result->>'revision'='1' and (select status from public.title_jobs where workspace_id=w)='completed','reviewed A import completes original queued work');
      perform pg_temp.assert_queue_pause((select payload from public.title_jobs where workspace_id=w)=captured,'completion preserves original event context');
      -- Pausing B later still must not relabel a new shared source as A.
      perform public.title_save_missive_route(w,actor,'queue-pause@example.test',1,4,mapping_b||'{"enabled":false}');
      perform public.title_enqueue_missive_event(w,event||'{"routingRevision":5,"messageId":"b-paused"}');
      perform pg_temp.assert_queue_pause((select payload->'companyId' from public.title_jobs where workspace_id=w and external_id='org:b-paused')='null'::jsonb,'either paused company keeps shared classification');
      -- Different inboxes remain single-company even when other routes exist.
      perform public.title_save_missive_route(w,actor,'queue-pause@example.test',1,5,mapping_b||'{"companyId":"C","teamId":"separate"}');
      perform public.title_enqueue_missive_event(w,event||'{"routingRevision":6,"messageId":"separate-message","teamId":"separate"}');
      perform pg_temp.assert_queue_pause((select payload->>'companyId' from public.title_jobs where workspace_id=w and external_id='org:separate-message')='C','unrelated configured routes do not create false shared identity');
      perform public.title_save_missive_route(w,actor,'queue-pause@example.test',1,6,mapping_a||'{"enabled":false}');
      perform pg_temp.reject_queue_pause('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"routingRevision":7,"messageId":"fully-paused"}'));
      perform pg_temp.assert_queue_pause((select count(*) from public.title_jobs where workspace_id=w)=3,'fully paused inbox creates no new work');
      raise exception 'Rollback fixtures' using errcode='PTCMP';
    exception when sqlstate 'PTCMP' then count_passed=count_passed+1; end;
  end loop;
  perform pg_temp.assert_queue_pause(count_passed=5 and (select count(*) from public.title_workspaces)=0,'five normal queue pause rounds completed and rolled back');
  raise notice 'PASS: five shared-inbox pause and re-enable transaction rounds';
end $$;
select 'Shared inbox pause SQL verification complete';
