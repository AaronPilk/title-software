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
declare w uuid='20000000-0000-4000-8000-000000000001'; other_w uuid='20000000-0000-4000-8000-000000000002';
  owner_id uuid='10000000-0000-4000-8000-000000000001'; staff_id uuid='10000000-0000-4000-8000-000000000002';
  admin_id uuid='10000000-0000-4000-8000-000000000003'; other_admin uuid='10000000-0000-4000-8000-000000000004';
  viewer_id uuid='10000000-0000-4000-8000-000000000005'; request_id uuid=gen_random_uuid(); invitation uuid;
  grant_result jsonb; again jsonb; old_expiry timestamptz; before_count bigint; signature text;
begin
  foreach signature in array array[
    'public.title_prepare_invitation(uuid,uuid,text,bigint,text,text,text[],boolean,boolean,jsonb,uuid,bigint,boolean,uuid)',
    'public.title_cancel_invitation(uuid,uuid,text,bigint,uuid,bigint)',
    'public.title_revoke_member(uuid,uuid,text,bigint,uuid,bigint)',
    'public.title_claim_access(uuid,text,jsonb)',
    'title_private.staff_identity(uuid,uuid,bigint,uuid,text)'] loop
    perform pg_temp.ok(not has_function_privilege('anon',signature,'execute'),'anon cannot execute '||signature);
    perform pg_temp.ok(not has_function_privilege('authenticated',signature,'execute'),'browser cannot execute '||signature);
    perform pg_temp.ok(has_function_privilege('service_role',signature,'execute'),'service can execute '||signature);
  end loop;
  perform pg_temp.ok(not has_table_privilege('authenticated','public.title_invitations','select'),'browser cannot list raw grants');
  perform pg_temp.ok(not has_table_privilege('service_role','auth.users','select'),'service role cannot read Auth table');
  perform pg_temp.ok((select not prosecdef from pg_proc where oid='public.title_revoke_member(uuid,uuid,text,bigint,uuid,bigint)'::regprocedure),'public revoke remains invoker');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L)',w,owner_id,'owner@example.test','staff@example.test','operations','{A}','[]'),'new invitation needs request ID');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,null,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','staff@example.test','operations','{A}','[]',gen_random_uuid()),'null actor version denied');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,99,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','staff@example.test','operations','{A}','[]',gen_random_uuid()),'stale actor denied');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,viewer_id,'viewer@example.test','staff@example.test','operations','{A}','[]',gen_random_uuid()),'viewer denied');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,admin_id,'admin@example.test','future@example.test','admin','{A}','[]',gen_random_uuid()),'admin cannot grant admin');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,true,false,%L,null,null,false,%L)',w,admin_id,'admin@example.test','future@example.test','operations','{A}','[]',gen_random_uuid()),'admin cannot grant all companies');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,true,%L,null,null,false,%L)',w,admin_id,'admin@example.test','future@example.test','operations','{A}','[]',gen_random_uuid()),'admin cannot grant restricted');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,admin_id,'admin@example.test','future@example.test','operations','{B}','[]',gen_random_uuid()),'admin cannot grant outside companies');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','future@example.test','operations','{missing}','[]',gen_random_uuid()),'nonexistent company denied');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','owner@example.test','viewer','{A}','[]',gen_random_uuid()),'self change denied');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,admin_id,'admin@example.test','owner@example.test','viewer','{A}','[]',gen_random_uuid()),'owner recipient protected');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,admin_id,'admin@example.test','other-admin@example.test','viewer','{A}','[]',gen_random_uuid()),'admin recipient protected');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','partner@example.test','partner','{A}','[]',gen_random_uuid()),'partner assignments required');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','partner@example.test','partner','{A}','[{"companyId":"A","memberName":"Wrong"}]',gen_random_uuid()),'partner name validated');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','partner@example.test','partner','{A}','[{"companyId":"B","memberName":"Member Two"}]',gen_random_uuid()),'partner company validated');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','partner@example.test','partner','{A}','[null]',gen_random_uuid()),'malformed partner assignment rejected');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','partner@example.test','partner','{A,B}','[{"companyId":"A","memberName":"Member One"}]',gen_random_uuid()),'every partner company requires named member mapping');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,' STAFF@example.test ','operations','{B,A,A}',false,false,'[]',null,null,false,request_id);
  invitation=(grant_result->>'id')::uuid;
  perform pg_temp.ok(grant_result->>'version'='1' and grant_result->>'replayed'='false','initial grant prepared');
  perform pg_temp.ok((select email='staff@example.test' and company_ids='{A,B}' from public.title_invitations where id=invitation),'recipient and company set normalized');
  perform pg_temp.ok((select active and version=1 and company_ids='{A}' from public.title_memberships where workspace_id=w and user_id=staff_id),'prepare preserves current member grants');
  select count(*) into before_count from public.title_audit;
  again=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','operations','{A,B}',false,false,'[]',null,null,false,request_id);
  perform pg_temp.ok(again->>'id'=invitation::text and again->>'replayed'='true','same request replays');
  perform pg_temp.ok((select count(*) from public.title_audit)=before_count,'replay does not append audit');
  perform pg_temp.reject('40001',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','different@example.test','operations','{A,B}','[]',request_id),'request reused for different recipient rejected');
  perform pg_temp.reject('40001',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','staff@example.test','operations','{A,B}','[]',gen_random_uuid()),'new request cannot silently adopt an existing pending grant');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','finance','{A}',false,false,'[]',invitation,1,false);
  perform pg_temp.ok(grant_result->>'version'='2','explicit CAS edit increments version');
  again=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','finance','{A}',false,false,'[]',invitation,1,false);
  perform pg_temp.ok(again->>'version'='2' and again->>'replayed'='true','lost edit response exact retry idempotent');
  perform pg_temp.reject('40001',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,%L,1,false)',w,owner_id,'owner@example.test','staff@example.test','viewer','{A}','[]',invitation),'stale different edit denied');
  perform pg_temp.reject('22023',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,%L,2,false)',w,owner_id,'owner@example.test','changed@example.test','finance','{A}','[]',invitation),'email immutable on edit');
  perform pg_temp.reject('22023',format('select public.title_cancel_invitation(%L,%L,%L,1,%L,2)',other_w,owner_id,'owner@example.test',invitation),'cross-workspace invitation unavailable');
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_cancel_invitation(%L,%L,%L,1,%L,2)',w,owner_id,'owner@example.test',invitation),'cancel audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok((select revoked_at is null and version=2 from public.title_invitations where id=invitation),'cancel rolls back when audit fails');
  grant_result=public.title_cancel_invitation(w,owner_id,'owner@example.test',1,invitation,2);
  perform pg_temp.ok(grant_result->>'version'='3','cancel increments version');
  again=public.title_cancel_invitation(w,owner_id,'owner@example.test',1,invitation,2);
  perform pg_temp.ok(again->>'replayed'='true' and again->>'version'='3','cancel exact retry idempotent');
  perform pg_temp.reject('40001',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,%L,3,false)',w,owner_id,'owner@example.test','staff@example.test','finance','{A}','[]',invitation),'canceled invitation cannot be edited');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','finance','{A}',false,false,'[]',invitation,3,true);
  old_expiry=(grant_result->>'expires_at')::timestamptz;
  perform pg_temp.ok(grant_result->>'version'='4','explicit reissue reactivates cancelled grant');
  again=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','finance','{A}',false,false,'[]',invitation,3,true);
  perform pg_temp.ok(again->>'replayed'='true' and (again->>'expires_at')::timestamptz=old_expiry,'reissue retry preserves original expiry');
  perform pg_temp.reject('40001',format('select public.title_cancel_invitation(%L,%L,%L,1,%L,3)',w,owner_id,'owner@example.test',invitation),'stale cancel cannot remove reissued grant');
  update public.title_invitations set expires_at=clock_timestamp()-interval '1 second' where id=invitation;
  perform pg_temp.reject('40001',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,%L,4,false)',w,owner_id,'owner@example.test','staff@example.test','finance','{A}','[]',invitation),'expired invitation cannot be edited');
  perform public.title_claim_access(staff_id,'staff@example.test','{}');
  perform pg_temp.ok((select version=1 and company_ids='{A}' from public.title_memberships where workspace_id=w and user_id=staff_id),'expired invitation is not claimed');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','finance','{A}',false,false,'[]',invitation,4,true);
  perform pg_temp.ok(grant_result->>'version'='5','expired invitation reissues explicitly');
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_revoke_member(%L,%L,%L,1,%L,1)',w,owner_id,'owner@example.test',staff_id),'revoke audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok((select active and version=1 from public.title_memberships where workspace_id=w and user_id=staff_id),'revoke rolls member back');
  perform pg_temp.ok((select revoked_at is null and version=5 from public.title_invitations where id=invitation),'revoke rolls invitation back');
  grant_result=public.title_revoke_member(w,owner_id,'owner@example.test',1,staff_id,1);
  perform pg_temp.ok(grant_result->>'version'='2' and grant_result->>'cancelledInvitations'='1','revoke atomically cancels pending grant');
  perform public.title_claim_access(staff_id,'staff@example.test','{}');
  perform pg_temp.ok((select not active and version=2 from public.title_memberships where workspace_id=w and user_id=staff_id),'revoked member stays denied after reconnect');
  perform pg_temp.ok((select revoked_at is not null and accepted_at is null from public.title_invitations where id=invitation),'revoked invitation never accepted');
  perform pg_temp.reject('40001',format('select public.title_revoke_member(%L,%L,%L,1,%L,1)',w,owner_id,'owner@example.test',staff_id),'stale revoke rejected');
  -- Replaying the original create ID cannot undo the revocation, even when the
  -- payload exactly matches its current stored grant.
  again=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','finance','{A}',false,false,'[]',null,null,false,request_id);
  perform pg_temp.ok(again->>'id'=invitation::text and again->>'revoked_at' is not null,'old create retry returns cancelled state');
  perform pg_temp.ok((select count(*) from public.title_invitations where email='staff@example.test')=1,'old create retry cannot create another grant');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','operations','{A,B}',false,false,'[]',null,null,false,gen_random_uuid());
  invitation=(grant_result->>'id')::uuid;
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_claim_access(%L,%L,%L)',staff_id,'staff@example.test','{}'),'claim audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok((select not active and version=2 from public.title_memberships where workspace_id=w and user_id=staff_id),'claim rollback preserves inactive member');
  perform pg_temp.ok((select accepted_at is null and version=1 from public.title_invitations where id=invitation),'claim rollback preserves pending invitation');
  perform public.title_claim_access(staff_id,'staff@example.test','{}');
  perform pg_temp.ok((select active and version=3 and role='operations' and company_ids='{A,B}' from public.title_memberships where workspace_id=w and user_id=staff_id),'intentional new invitation may reactivate with explicit grants');
  perform pg_temp.ok((select accepted_at is not null and last_action='accepted' and version=2 from public.title_invitations where id=invitation),'claim consumes invitation with version and audit');
  perform public.title_claim_access(staff_id,'staff@example.test','{}');
  perform pg_temp.ok((select version=3 from public.title_memberships where workspace_id=w and user_id=staff_id),'repeated claim does not bump membership');
  perform pg_temp.reject('40001',format('select public.title_cancel_invitation(%L,%L,%L,1,%L,2)',w,owner_id,'owner@example.test',invitation),'accepted invitation cannot cancel');
  perform pg_temp.reject('40001',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,%L,2,true)',w,owner_id,'owner@example.test','staff@example.test','operations','{A,B}','[]',invitation),'accepted invitation cannot reissue');
  perform pg_temp.reject('42501',format('select public.title_revoke_member(%L,%L,%L,1,%L,1)',w,owner_id,'owner@example.test',owner_id),'self revoke denied');
  perform pg_temp.reject('42501',format('select public.title_revoke_member(%L,%L,%L,1,%L,1)',w,admin_id,'admin@example.test',owner_id),'owner revoke denied');
  perform pg_temp.reject('42501',format('select public.title_revoke_member(%L,%L,%L,1,%L,1)',w,admin_id,'admin@example.test',other_admin),'admin peer revoke denied');
  perform pg_temp.reject('42501',format('select public.title_revoke_member(%L,%L,%L,1,%L,3)',w,admin_id,'admin@example.test',staff_id),'scoped admin cannot revoke wider member');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'partner@example.test','partner','{B,A}',false,false,'[{"id":"ignored","companyId":"A","memberName":"Member One"},{"companyId":"B","memberName":"Member Two"}]',null,null,false,gen_random_uuid());
  invitation=(grant_result->>'id')::uuid;
  again=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'partner@example.test','partner','{A,B}',false,false,'[{"companyId":"B","memberName":"Member Two"},{"companyId":"A","memberName":"Member One"},{"companyId":"A","memberName":"Member One"}]',invitation,1,false);
  perform pg_temp.ok(again->>'version'='1' and again->>'replayed'='true','partner semantic set equality ignores generated IDs and order');
  perform pg_temp.ok((select bool_and(m->>'id' is not null) from public.title_invitations i,jsonb_array_elements(i.partner_members) m where i.id=invitation),'partner grant IDs stored');
  grant_result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'elevated@example.test','admin','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  invitation=(grant_result->>'id')::uuid;
  perform pg_temp.reject('42501',format('select public.title_cancel_invitation(%L,%L,%L,1,%L,1)',w,admin_id,'admin@example.test',invitation),'admin cannot cancel elevated pending grant');
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,%L,1,false)',w,admin_id,'admin@example.test','elevated@example.test','viewer','{A}','[]',invitation),'admin cannot downgrade elevated pending grant');
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,owner_id,'owner@example.test','rollback@example.test','operations','{A}','[]',gen_random_uuid()),'prepare audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok(not exists(select 1 from public.title_invitations where email='rollback@example.test'),'prepare rollback removes pending grant');
  update public.title_memberships set active=false,version=2 where workspace_id=w and user_id=admin_id;
  perform pg_temp.reject('42501',format('select public.title_prepare_invitation(%L,%L,%L,1,%L,%L,%L,false,false,%L,null,null,false,%L)',w,admin_id,'admin@example.test','new@example.test','operations','{A}','[]',gen_random_uuid()),'revoked actor cannot prepare');
end $$;
select count(*)||' staff lifecycle SQL assertions passed' from staff_assertions;
rollback;
