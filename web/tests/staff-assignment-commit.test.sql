begin;
create temporary table staff_assertions(label text);
create function pg_temp.ok(actual boolean,label text) returns void language plpgsql as $$
begin if actual is distinct from true then raise exception 'FAILED: %',label; end if;
  insert into staff_assertions values(label); end $$;
create function pg_temp.reject(code text,statement text,label text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection: %',label using errcode='PTBAD';
  exception when others then if sqlstate<>code then raise; end if; end;
  insert into staff_assertions values(label); end $$;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin
  if current_setting('title_test.fail_audit',true)='yes' then raise exception 'Synthetic audit failure' using errcode='PTTST'; end if;
  return new; end $$;
create trigger staff_test_fail_audit before insert on public.title_audit for each row execute function pg_temp.fail_audit();
do $$ begin execute format('grant usage on schema %I to service_role', (select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
grant all on staff_assertions to service_role;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','owner@example.test',now()),
 ('10000000-0000-4000-8000-000000000002','staff@example.test',now()),
 ('10000000-0000-4000-8000-000000000003','admin@example.test',now()),
 ('10000000-0000-4000-8000-000000000004','other-admin@example.test',now()),
 ('10000000-0000-4000-8000-000000000005','viewer@example.test',now());
set local role service_role;
insert into public.title_workspaces(id,name,state) values
 ('20000000-0000-4000-8000-000000000001','Fictional staff lifecycle','{"companies":[{"id":"A","members":[{"name":"Member One"},{"name":"Member Two"}]},{"id":"B","members":[{"name":"Member Two"}]}]}'),
 ('20000000-0000-4000-8000-000000000002','Fictional other workspace','{"companies":[{"id":"A"}]}');
insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','{}',true,true),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','operations','{A}',false,false),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','admin','{A}',false,false),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','admin','{A}',false,false),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','viewer','{A}',false,false),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','owner','{}',true,true);
do $$
declare w uuid='20000000-0000-4000-8000-000000000001'; owner_id uuid='10000000-0000-4000-8000-000000000001';
 staff_id uuid='10000000-0000-4000-8000-000000000002'; admin_id uuid='10000000-0000-4000-8000-000000000003';
 viewer_id uuid='10000000-0000-4000-8000-000000000005'; state jsonb; initial jsonb; next_state jsonb; result jsonb;
 request_id uuid=gen_random_uuid(); before_state jsonb; before_revision bigint; before_audit bigint; before_receipts bigint;
begin
  perform pg_temp.ok(not has_function_privilege('anon','public.title_commit(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,jsonb,text[])','execute'),'anonymous commit denied');
  perform pg_temp.ok(not has_function_privilege('authenticated','public.title_commit(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,jsonb,text[])','execute'),'browser direct commit denied');
  perform pg_temp.ok(has_function_privilege('service_role','public.title_commit(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,jsonb,text[])','execute'),'service commit remains available');
  initial='{"companies":[{"id":"A"},{"id":"B"}],"tasks":[],"orders":[]}';
  state=jsonb_set(initial,'{tasks}',jsonb_build_array(jsonb_build_object('id','task-1','companyId','A','owner','staff@example.test','assigneeId',staff_id,'title','Fictional task')));
  perform pg_temp.reject('42501',format('select public.title_commit(%L,%L,%L,null,0,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'new',state,'[]','{A}'),'null actor version fails closed');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,null,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'new',state,'[]','{A}'),'null revision fails closed');
  result=public.title_commit(w,owner_id,'owner@example.test',1,0,request_id,'first',state,'["editDraft"]','{A}');
  perform pg_temp.ok(result->>'revision'='1' and result->>'replayed'='false','active scoped staff task assignment commits');
  update public.title_memberships set active=false,version=2 where workspace_id=w and user_id=staff_id;
  result=public.title_commit(w,owner_id,'owner@example.test',1,0,request_id,'first',state,'["editDraft"]','{A}');
  perform pg_temp.ok(result->>'revision'='1' and result->>'replayed'='true','receipt replay survives later assignee revocation');
  next_state=jsonb_set(state,'{tasks,0,title}','"Historical assignment remains visible"');
  result=public.title_commit(w,owner_id,'owner@example.test',1,1,gen_random_uuid(),'second',next_state,'["editDraft"]','{A}');
  perform pg_temp.ok(result->>'revision'='2','unrelated edits preserve inactive historical assignment');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'changed-label',jsonb_set(next_state,'{tasks,0,owner}','"Changed owner label"'),'[]','{A}'),'owner relabel revalidates inactive assignee');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'new-row',jsonb_set(next_state,'{tasks,0,id}','"task-2"'),'[]','{A}'),'new row cannot assign revoked account');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'remove-id',next_state#-'{tasks,0,assigneeId}','[]','{A}'),'existing stable assignment cannot be silently stripped');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'bad-id',jsonb_set(next_state,'{tasks,0,assigneeId}','"malformed"'),'[]','{A}'),'malformed assignee rejects as conflict');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'missing-user',jsonb_set(next_state,'{tasks,0,assigneeId}',to_jsonb(gen_random_uuid()::text)),'[]','{A}'),'unknown workspace assignee rejected');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'viewer',jsonb_set(next_state,'{tasks,0,assigneeId}',to_jsonb(viewer_id::text)),'[]','{A}'),'viewer cannot receive work');
  update public.title_memberships set active=true,version=3 where workspace_id=w and user_id=staff_id;
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,2,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'scope-change',jsonb_set(next_state,'{tasks,0,companyId}','"B"'),'[]','{B}'),'same assignee moved outside scope rejected');
  update public.title_memberships set role='finance' where workspace_id=w and user_id=admin_id;
  next_state=jsonb_set(next_state,'{tasks,0,assigneeId}',to_jsonb(admin_id::text));
  result=public.title_commit(w,owner_id,'owner@example.test',1,2,gen_random_uuid(),'finance-task',next_state,'[]','{A}');
  perform pg_temp.ok(result->>'revision'='3','finance may receive scoped task');
  state=jsonb_set(next_state,'{orders}',jsonb_build_array(jsonb_build_object('id','order-1','companyId','A','owner','admin@example.test','assigneeId',admin_id)));
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,3,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'finance-order',state,'[]','{A}'),'finance cannot receive production order');
  update public.title_memberships set role='onboarding' where workspace_id=w and user_id=admin_id;
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,3,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'onboarding-order',state,'[]','{A}'),'onboarding cannot receive production order');
  state=jsonb_set(state,'{orders,0,assigneeId}',to_jsonb(staff_id::text));
  select ws.state,ws.revision into before_state,before_revision from public.title_workspaces ws where id=w;
  select count(*) into before_audit from public.title_audit;
  select count(*) into before_receipts from public.title_command_receipts;
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_commit(%L,%L,%L,1,3,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'audit-fails',state,'[]','{A}'),'commit audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok((select ws.state=before_state and ws.revision=before_revision from public.title_workspaces ws where id=w),'commit audit failure rolls state and revision back');
  perform pg_temp.ok((select count(*) from public.title_audit)=before_audit and (select count(*) from public.title_command_receipts)=before_receipts,'commit audit failure rolls receipts back');
  result=public.title_commit(w,owner_id,'owner@example.test',1,3,gen_random_uuid(),'operations-order',state,'[]','{A}');
  perform pg_temp.ok(result->>'revision'='4','operations may receive production order');
  next_state=jsonb_set(state,'{orders,0,companyId}','"B"');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,4,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'order-scope',next_state,'[]','{B}'),'production order assignment revalidates changed company');
  update public.title_memberships set all_companies=true where workspace_id=w and user_id=staff_id;
  result=public.title_commit(w,owner_id,'owner@example.test',1,4,gen_random_uuid(),'all-company-order',next_state,'[]','{B}');
  perform pg_temp.ok(result->>'revision'='5','explicit all-company member can receive order for another existing company');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,5,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'missing-company',jsonb_set(next_state,'{orders,0,companyId}','"missing"'),'[]','{missing}'),'all-company assignment still needs actual company');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,5,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',request_id,'different',state,'[]','{A}'),'changed request hash remains conflict');
  perform pg_temp.reject('PT409',format('select public.title_commit(%L,%L,%L,1,1,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',gen_random_uuid(),'stale-revision',state,'[]','{A}'),'stale revision remains conflict');
end $$;
select count(*)||' staff assignment commit SQL assertions passed' from staff_assertions;
rollback;
