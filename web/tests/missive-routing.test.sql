-- Local disposable fixtures only. The script runner supplies the real schema.
create function pg_temp.assert_routing(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Routing regression: %',label; end if; end $$;
create function pg_temp.reject_routing(expected text,statement text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection missing' using errcode='PTBAD';
exception when others then if sqlstate<>expected then raise; end if; end; end $$;
create function pg_temp.fail_routed_queue() returns trigger language plpgsql as $$
begin if current_setting('title_test.fail_queue',true)='yes' and new.status='completed' then raise exception 'Synthetic queue failure' using errcode='PTTST'; end if; return new; end $$;
drop trigger if exists test_queue_failure on public.title_jobs;
create trigger test_routed_queue_failure before update on public.title_jobs for each row execute function pg_temp.fail_routed_queue();
do $$ begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
do $$
declare actor uuid=gen_random_uuid(); w uuid; result jsonb; event jsonb; state jsonb; imported jsonb; req uuid; n integer; count_passed integer=0; route_a text='route:org:shared:A'; route_b text='route:org:shared:B';
  mapping_a jsonb='{"organizationId":"org","teamId":"shared","companyId":"A","teamName":"Shared inbox","enabled":true}';
  mapping_b jsonb='{"organizationId":"org","teamId":"shared","companyId":"B","teamName":"Shared inbox","enabled":true}';
  rpc text='public.title_import_missive_routed(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text,bigint,text,text)';
begin
  perform pg_temp.assert_routing(not has_function_privilege('anon',rpc,'execute') and not has_function_privilege('authenticated',rpc,'execute') and has_function_privilege('service_role',rpc,'execute'),'routed commit is server only');
  perform pg_temp.assert_routing(not has_function_privilege('authenticated','public.title_save_missive_route(uuid,uuid,text,bigint,bigint,jsonb)','execute'),'mapping writes server only');
  insert into auth.users(id,email,email_confirmed_at) values(actor,'routing@example.test',now());
  set local role service_role;
  for n in 1..5 loop
    begin
      state='{"companies":[{"id":"A"},{"id":"B"},{"id":"C"}],"inbox":[]}';
      insert into public.title_workspaces(name,state) values('Routing fixture',state) returning id into w;
      insert into public.title_memberships(workspace_id,user_id,role,all_companies) values(w,actor,'owner',true);
      -- Upgrade an actual legacy stored configuration, preserving its source version.
      perform public.title_save_missive_mapping(w,actor,'routing@example.test',1,0,mapping_a-'enabled');
      result=public.title_save_missive_route(w,actor,'routing@example.test',1,1,mapping_b);
      perform pg_temp.assert_routing(result->>'revision'='2' and jsonb_array_length(result->'mappings')=2,'upgrade retains two routes');
      perform pg_temp.assert_routing(result->'mappings'->0->>'version'='1' and result->'mappings'->0->>'id'=route_a,'legacy approval and identity preserved');
      perform pg_temp.assert_routing(not (select config ? 'mapping' from public.title_integrations where workspace_id=w),'old singleton removed on upgrade');
      perform pg_temp.reject_routing('PT409',format('select public.title_save_missive_mapping(%L,%L,%L,1,0,%L)',w,actor,'routing@example.test',mapping_a));
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive(%L,%L,%L,1,0,%L,%L,%L,1,%L)',w,actor,'routing@example.test',gen_random_uuid(),'legacy',state,'A'));
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive_attachment(%L,%L,%L,1,0,%L,%L,%L,1,%L)',w,actor,'routing@example.test',gen_random_uuid(),'legacy',state,'A'));

      perform pg_temp.reject_routing('PT409',format('select public.title_save_missive_route(%L,%L,%L,1,1,%L)',w,actor,'routing@example.test',mapping_a));
      -- Global revision invalidates route A even though its own approval is still v1.
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive_routed(%L,%L,%L,1,0,%L,%L,%L,1,%L,1,%L,%L)',w,actor,'routing@example.test',gen_random_uuid(),'h',state,'A',route_a,'importMissiveText'));
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive_routed(%L,%L,%L,1,0,%L,%L,%L,1,%L,2,%L,%L)',w,actor,'routing@example.test',gen_random_uuid(),'h',state,'B',route_a,'importMissiveText'));
      event='{"organizationId":"org","teamId":"shared","messageId":"message-a","conversationId":"thread","routingRevision":2,"subject":"Synthetic shared event"}';
      perform pg_temp.assert_routing(public.title_enqueue_missive_event(w,event),'shared event queued');
      perform pg_temp.assert_routing(not public.title_enqueue_missive_event(w,event||'{"subject":"retry"}'::jsonb),'shared event deduplicated');
      select payload into result from public.title_jobs where workspace_id=w;
      perform pg_temp.assert_routing(result->'companyId'='null'::jsonb and jsonb_array_length(result->'candidateRoutes')=2,'shared event never guesses destination');
      perform pg_temp.reject_routing('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"routingRevision":1}'::jsonb));
      perform pg_temp.reject_routing('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"teamId":"wrong"}'::jsonb));
      perform pg_temp.reject_routing('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"organizationId":"other"}'::jsonb));
      imported=jsonb_set(state,'{inbox}','[{"companyId":"B","orderId":"O-B","missive":{"organizationId":"org","teamId":"shared","messageId":"message-a","mappingVersion":2}}]');
      req=gen_random_uuid();
      perform set_config('title_test.fail_queue','yes',true);
      perform pg_temp.reject_routing('PTTST',format('select public.title_import_missive_routed(%L,%L,%L,1,0,%L,%L,%L,2,%L,2,%L,%L)',w,actor,'routing@example.test',req,'import-b',imported,'B',route_b,'importMissiveText'));
      perform pg_temp.assert_routing((select ws.state from public.title_workspaces ws where id=w)=state and not exists(select 1 from public.title_command_receipts where workspace_id=w),'queue failure rolls back state and receipt');
      perform set_config('title_test.fail_queue','no',true);
      result=public.title_import_missive_routed(w,actor,'routing@example.test',1,0,req,'import-b',imported,2,'B',2,route_b,'importMissiveText');
      perform pg_temp.assert_routing(result->>'revision'='1' and (select status from public.title_jobs where workspace_id=w)='completed','explicit company B commit completes queue');
      result=public.title_import_missive_routed(w,actor,'routing@example.test',1,0,req,'import-b','{}',2,'B',2,route_b,'importMissiveText');
      perform pg_temp.assert_routing(result->>'replayed'='true','duplicate request replays');
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive_routed(%L,%L,%L,1,1,%L,%L,%L,2,%L,2,%L,%L)',w,actor,'routing@example.test',req,'changed-request',imported,'B',route_b,'importMissiveText'));
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive_routed(%L,%L,%L,1,0,%L,%L,%L,2,%L,2,%L,%L)',w,actor,'routing@example.test',gen_random_uuid(),'stale',imported,'B',route_b,'importMissiveText'));
      result=public.title_save_missive_route(w,actor,'routing@example.test',1,2,mapping_a||'{"enabled":false}'::jsonb);
      perform pg_temp.assert_routing(result->>'revision'='3' and result->'mappings'->1->>'version'='2','pausing other route advances only global revision');
      perform pg_temp.reject_routing('PT409',format('select public.title_import_missive_routed(%L,%L,%L,1,1,%L,%L,%L,3,%L,3,%L,%L)',w,actor,'routing@example.test',gen_random_uuid(),'paused',imported,'A',route_a,'importMissiveAttachment'));
      -- An attachment on unchanged route B records its own approval version and global CAS.
      result=public.title_import_missive_routed(w,actor,'routing@example.test',1,1,gen_random_uuid(),'attachment-b',imported||'{"savedAttachment":"original-B-source"}'::jsonb,2,'B',3,route_b,'importMissiveAttachment');
      perform pg_temp.assert_routing(result->>'revision'='2','attachment commits with selected route');
      perform pg_temp.assert_routing((select detail->'actions' from public.title_audit where workspace_id=w and action='workspace.commands' order by created_at desc,id desc limit 1) is not null,'routed imports retain audit detail');
      -- Distinct inbox routes do not join shared candidates.
      result=public.title_save_missive_route(w,actor,'routing@example.test',1,3,mapping_b||'{"companyId":"C","teamId":"separate"}'::jsonb);
      perform pg_temp.assert_routing(jsonb_array_length(result->'mappings')=3,'separate inbox route added');
      perform pg_temp.assert_routing(public.title_enqueue_missive_event(w,event||'{"messageId":"message-c","teamId":"separate","routingRevision":4}'::jsonb),'distinct inbox event queued');
      select payload into result from public.title_jobs where workspace_id=w and external_id='org:message-c';
      perform pg_temp.assert_routing(result->>'companyId'='C' and jsonb_array_length(result->'candidateRoutes')=1,'distinct inbox has exact company C candidate');
      -- Receipt/state already existed before a late webhook: mark it complete immediately.
      delete from public.title_jobs where workspace_id=w and external_id='org:message-a';
      perform public.title_enqueue_missive_event(w,event||'{"routingRevision":4}'::jsonb);
      perform pg_temp.assert_routing((select status from public.title_jobs where workspace_id=w and external_id='org:message-a')='completed','late shared event recognizes imported source');
      update public.title_memberships set role='operations' where workspace_id=w;
      perform pg_temp.reject_routing('42501',format('select public.title_save_missive_route(%L,%L,%L,1,4,%L)',w,actor,'routing@example.test',mapping_a));
      update public.title_memberships set role='owner',active=false,version=2 where workspace_id=w;
      perform pg_temp.reject_routing('42501',format('select public.title_import_missive_routed(%L,%L,%L,1,2,%L,%L,%L,2,%L,4,%L,%L)',w,actor,'routing@example.test',gen_random_uuid(),'revoked',imported,'B',route_b,'importMissiveAttachment'));
      raise exception 'Rollback fixtures' using errcode='PTCMP';
    exception when sqlstate 'PTCMP' then count_passed=count_passed+1; end;
  end loop;
  perform pg_temp.assert_routing(count_passed=5 and (select count(*) from public.title_workspaces)=0,'all five multi-company rounds rolled back');
  raise notice 'PASS: five multi-company routing transaction rounds, legacy rollout guards and shared-inbox source isolation verified';
end $$;
select 'Multi-company Missive SQL verification complete';
