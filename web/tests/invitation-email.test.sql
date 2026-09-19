-- Synthetic SQL only: no email provider, SMTP, Auth mutation or external network.
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
 ('10000000-0000-4000-8000-000000000004','scoped-admin@example.test',now());
set local role service_role;
insert into public.title_workspaces(id,name,state) values
 ('20000000-0000-4000-8000-000000000001','Fictional mail tests','{"companies":[{"id":"A","members":[]}]}'),
 ('20000000-0000-4000-8000-000000000002','Fictional other workspace','{"companies":[{"id":"A"}]}');
insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','{}',true),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','operations','{A}',false),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','admin','{}',true),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','admin','{A}',false),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','owner','{}',true);
do $$
declare w uuid='20000000-0000-4000-8000-000000000001'; other_w uuid='20000000-0000-4000-8000-000000000002';
  owner_id uuid='10000000-0000-4000-8000-000000000001'; staff_id uuid='10000000-0000-4000-8000-000000000002';
  admin_id uuid='10000000-0000-4000-8000-000000000003'; scoped_id uuid='10000000-0000-4000-8000-000000000004';
  request_id uuid=gen_random_uuid(); invitation uuid; delivery uuid; new_invitation uuid; future_invitation uuid;
  result jsonb; again jsonb; signature text; audits bigint;
begin
  foreach signature in array array[
    'public.title_begin_invitation_email(uuid,uuid,text,bigint,uuid,bigint,uuid)',
    'public.title_finish_invitation_email(uuid,uuid,text,uuid,uuid,text)',
    'public.title_invitation_delivery_status(uuid,uuid,bigint)'] loop
    perform pg_temp.ok(not has_function_privilege('anon',signature,'execute'),'anon email RPC denied');
    perform pg_temp.ok(not has_function_privilege('authenticated',signature,'execute'),'browser email RPC denied');
    perform pg_temp.ok(has_function_privilege('service_role',signature,'execute'),'service email RPC enabled');
  end loop;
  perform pg_temp.ok(not has_table_privilege('authenticated','public.title_invitation_deliveries','select'),'browser cannot read delivery records');
  perform pg_temp.ok(not has_table_privilege('anon','public.title_invitation_deliveries','insert'),'anonymous cannot create delivery records');
  perform pg_temp.ok((select relrowsecurity from pg_class where oid='public.title_invitation_deliveries'::regclass),'delivery RLS enabled');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'staff@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  invitation=(result->>'id')::uuid;
  perform pg_temp.reject('42501',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,staff_id,'staff@example.test',invitation,request_id),'operations cannot send invitations');
  perform pg_temp.reject('42501',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,scoped_id,'scoped-admin@example.test',invitation,request_id),'scoped administrator cannot send');
  perform pg_temp.reject('42501',format('select public.title_begin_invitation_email(%L,%L,%L,null,%L,1,%L)',w,owner_id,'owner@example.test',invitation,request_id),'null actor version rejected');
  perform pg_temp.reject('42501',format('select public.title_begin_invitation_email(%L,%L,%L,9,%L,1,%L)',w,owner_id,'owner@example.test',invitation,request_id),'stale actor version rejected');
  perform pg_temp.reject('22023',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,null)',w,owner_id,'owner@example.test',invitation),'missing send request ID rejected');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,9,%L)',w,owner_id,'owner@example.test',invitation,request_id),'stale invitation version rejected');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',other_w,owner_id,'owner@example.test',invitation,request_id),'cross-workspace send denied');
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,owner_id,'owner@example.test',invitation,request_id),'begin audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok(not exists(select 1 from public.title_invitation_deliveries),'begin audit failure rolls delivery intent back');
  result=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,invitation,1,request_id);
  delivery=(result->>'id')::uuid;
  perform pg_temp.ok(result->>'send'='true' and result->>'status'='sending' and result->>'kind'='magiclink' and result->>'email'='staff@example.test','known account uses single recorded magiclink intent');
  select count(*) into audits from public.title_audit;
  again=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,invitation,1,request_id);
  perform pg_temp.ok(again->>'send'='false' and again->>'id'=delivery::text and again->>'status'='sending','same request never sends twice');
  perform pg_temp.ok(not again ? 'email' and not again ? 'kind','replay excludes provider-send payload');
  perform pg_temp.ok((select count(*) from public.title_audit)=audits,'begin replay no audit duplication');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,admin_id,'admin@example.test',invitation,request_id),'another actor cannot reuse delivery request');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,2,%L)',w,owner_id,'owner@example.test',invitation,request_id),'different invitation version cannot reuse delivery request');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,owner_id,'owner@example.test',invitation,gen_random_uuid()),'new request blocked by active send cooldown');
  perform pg_temp.reject('42501',format('select public.title_finish_invitation_email(%L,%L,%L,%L,%L,%L)',other_w,owner_id,'owner@example.test',delivery,request_id,'sent'),'cross-workspace finish denied');
  perform pg_temp.reject('42501',format('select public.title_finish_invitation_email(%L,%L,%L,%L,%L,%L)',w,admin_id,'admin@example.test',delivery,request_id,'sent'),'different actor cannot finish delivery');
  perform pg_temp.reject('42501',format('select public.title_finish_invitation_email(%L,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',delivery,gen_random_uuid(),'sent'),'different request cannot finish delivery');
  perform pg_temp.reject('22023',format('select public.title_finish_invitation_email(%L,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',delivery,request_id,'delivered'),'unconfirmed delivered status rejected');
  perform set_config('title_test.fail_audit','yes',true);
  perform pg_temp.reject('PTTST',format('select public.title_finish_invitation_email(%L,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',delivery,request_id,'sent'),'finish audit failure propagates');
  perform set_config('title_test.fail_audit','no',true);
  perform pg_temp.ok((select status='sending' and finished_at is null from public.title_invitation_deliveries where id=delivery),'finish audit rollback keeps in-flight intent');
  result=public.title_finish_invitation_email(w,owner_id,'owner@example.test',delivery,request_id,'sent');
  perform pg_temp.ok(result->>'status'='sent' and result->>'replayed'='false','finish records provider acceptance');
  again=public.title_finish_invitation_email(w,owner_id,'owner@example.test',delivery,request_id,'sent');
  perform pg_temp.ok(again->>'replayed'='true','finish exact replay idempotent');
  perform pg_temp.reject('40001',format('select public.title_finish_invitation_email(%L,%L,%L,%L,%L,%L)',w,owner_id,'owner@example.test',delivery,request_id,'failed'),'terminal outcome cannot be rewritten');
  again=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,invitation,1,request_id);
  perform pg_temp.ok(again->>'send'='false' and again->>'status'='sent','lost provider response does not resend');
  update public.title_invitation_deliveries set created_at=clock_timestamp()-interval '2 minutes' where id=delivery;
  request_id=gen_random_uuid();
  result=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,invitation,1,request_id);
  delivery=(result->>'id')::uuid;
  perform pg_temp.ok(result->>'send'='true','deliberate new request after cooldown permitted');
  update public.title_invitation_deliveries set created_at=clock_timestamp()-interval '6 minutes' where id=delivery;
  again=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,invitation,1,request_id);
  perform pg_temp.ok(again->>'status'='unknown' and again->>'send'='false','stuck sending is reported unknown without automatic send');
  result=public.title_finish_invitation_email(w,owner_id,'owner@example.test',delivery,request_id,'unknown');
  perform pg_temp.ok((select error_code='delivery_unconfirmed' and finished_at is not null from public.title_invitation_deliveries where id=delivery),'unknown stores safe failure code');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'new@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  new_invitation=(result->>'id')::uuid;
  request_id=gen_random_uuid();
  result=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,new_invitation,1,request_id);
  delivery=(result->>'id')::uuid;
  perform pg_temp.ok(result->>'kind'='invite' and result->>'send'='true','missing Auth account uses account invitation');
  perform public.title_finish_invitation_email(w,owner_id,'owner@example.test',delivery,request_id,'failed');
  perform pg_temp.ok((select status='failed' and error_code='provider_rejected' from public.title_invitation_deliveries where id=delivery),'provider rejection stored without sensitive errors');
  perform public.title_cancel_invitation(w,owner_id,'owner@example.test',1,new_invitation,1);
  again=public.title_begin_invitation_email(w,owner_id,'owner@example.test',1,new_invitation,1,request_id);
  perform pg_temp.ok(again->>'send'='false' and again->>'status'='failed','canceled invitation historical request returns recorded outcome only');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,2,%L)',w,owner_id,'owner@example.test',new_invitation,gen_random_uuid()),'canceled invitation cannot start new send');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'future@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  future_invitation=(result->>'id')::uuid;
  update public.title_invitations set expires_at=clock_timestamp()-interval '1 second' where id=future_invitation;
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,owner_id,'owner@example.test',future_invitation,gen_random_uuid()),'expired invitation cannot send');
  perform public.title_claim_access(staff_id,'staff@example.test','{}');
  perform pg_temp.reject('40001',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,2,%L)',w,owner_id,'owner@example.test',invitation,gen_random_uuid()),'accepted invitation cannot send');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'restricted@example.test','operations','{A}',false,true,'[]',null,null,false,gen_random_uuid());
  invitation=(result->>'id')::uuid;
  perform pg_temp.reject('42501',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,admin_id,'admin@example.test',invitation,gen_random_uuid()),'admin cannot send owner restricted grant');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'another@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  invitation=(result->>'id')::uuid;
  request_id=gen_random_uuid();
  result=public.title_begin_invitation_email(w,admin_id,'admin@example.test',1,invitation,1,request_id);
  delivery=(result->>'id')::uuid;
  perform public.title_revoke_member(w,owner_id,'owner@example.test',1,admin_id,1);
  perform pg_temp.reject('42501',format('select public.title_begin_invitation_email(%L,%L,%L,1,%L,1,%L)',w,admin_id,'admin@example.test',invitation,request_id),'revoked sender cannot begin or replay');
  result=public.title_finish_invitation_email(w,admin_id,'admin@example.test',delivery,request_id,'sent');
  perform pg_temp.ok(result->>'status'='sent','already authorized sender may record outcome after its own revocation');
  perform pg_temp.reject('42501',format('select * from public.title_invitation_delivery_status(%L,%L,null)',w,owner_id),'status rejects null actor version');
  perform pg_temp.reject('42501',format('select * from public.title_invitation_delivery_status(%L,%L,1)',w,staff_id),'status rejects operations');
  perform pg_temp.reject('42501',format('select * from public.title_invitation_delivery_status(%L,%L,1)',w,scoped_id),'status rejects scoped administrator');
  perform pg_temp.reject('42501',format('select * from public.title_invitation_delivery_status(%L,%L,1)',w,admin_id),'status rejects revoked administrator');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'historical@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  new_invitation=(result->>'id')::uuid;
  insert into public.title_invitation_deliveries(workspace_id,invitation_id,invitation_version,request_id,actor_id,status,kind,created_at,finished_at)
    values(w,new_invitation,1,gen_random_uuid(),owner_id,'sent','invite',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days');
  result=public.title_prepare_invitation(w,owner_id,'owner@example.test',1,'noise@example.test','operations','{A}',false,false,'[]',null,null,false,gen_random_uuid());
  future_invitation=(result->>'id')::uuid;
  insert into public.title_invitation_deliveries(workspace_id,invitation_id,invitation_version,request_id,actor_id,status,kind,created_at)
    select w,future_invitation,1,gen_random_uuid(),owner_id,'failed','invite',clock_timestamp()-s*interval '1 second' from generate_series(1,510) s;
  perform pg_temp.ok((select status='sent' and finished_at is not null from public.title_invitation_delivery_status(w,owner_id,1) where invitation_id=new_invitation),'status survives more than 500 newer attempts elsewhere');
  perform pg_temp.ok((select count(*) from public.title_invitation_delivery_status(w,owner_id,1) where invitation_id=future_invitation)=1,'status returns one latest attempt per invitation');
  perform pg_temp.ok(not exists(select 1 from public.title_invitation_delivery_status(other_w,owner_id,1)),'status respects workspace scope');
  update public.title_invitations set accepted_at=clock_timestamp(),version=2 where id=new_invitation;
  perform pg_temp.ok((select status='sent' and invitation_version=1 from public.title_invitation_delivery_status(w,owner_id,1) where invitation_id=new_invitation),'accepted grant retains its pre-acceptance delivery');
  update public.title_invitations set accepted_at=null,version=3 where id=new_invitation;
  perform pg_temp.ok(not exists(select 1 from public.title_invitation_delivery_status(w,owner_id,1) where invitation_id=new_invitation),'edited or reissued pending grant does not inherit older delivery');
  insert into public.title_invitation_deliveries(workspace_id,invitation_id,invitation_version,request_id,actor_id,status,kind,created_at)
    values(w,new_invitation,3,gen_random_uuid(),owner_id,'sending','invite',clock_timestamp()-interval '6 minutes');
  perform pg_temp.ok((select status='unknown' and invitation_version=3 from public.title_invitation_delivery_status(w,owner_id,1) where invitation_id=new_invitation),'status presents overdue sending attempt as unknown');
  update public.title_invitations set revoked_at=clock_timestamp(),version=4 where id=new_invitation;
  perform pg_temp.ok((select status='unknown' and invitation_version=3 from public.title_invitation_delivery_status(w,owner_id,1) where invitation_id=new_invitation),'canceled grant retains last delivery outcome');
  perform pg_temp.ok((select bool_and(not detail ? 'email' and not detail ? 'token' and not detail ? 'password' and not detail ? 'link') from public.title_audit where action like 'member.invitation_email_%'),'email audit contains IDs/outcomes only');
end $$;
select count(*)||' invitation email SQL assertions passed' from staff_assertions;
rollback;
