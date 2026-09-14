-- Run only by the disposable local PostgreSQL runner. Vault is a plaintext API
-- stub here: these tests verify authorization and transactions, not encryption.
create function pg_temp.assert_credential(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Credential regression: %',label; end if; end $$;
create function pg_temp.reject_credential(expected text,statement text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection missing' using errcode='PTBAD';
exception when others then if sqlstate<>expected then raise; end if; end; end $$;
create function pg_temp.fail_credential_audit() returns trigger language plpgsql as $$
begin if current_setting('title_test.fail_credential_audit',true)='yes' and new.action in ('missive.credential_verified','missive.disconnected') then raise exception 'Synthetic audit failure' using errcode='PTTST'; end if; return new; end $$;
create trigger credential_audit_failure before insert on public.title_audit for each row execute function pg_temp.fail_credential_audit();
do $$ begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
do $$
declare actor uuid=gen_random_uuid(); stranger uuid=gen_random_uuid(); w uuid; w2 uuid; empty_w uuid;
  result jsonb; config jsonb; secret_id uuid; second_secret uuid; n integer; count_passed integer=0; signature text;
  token_a text='missive_pat-SYNTHETIC_SQL_TOKEN_A'; token_b text='missive_pat-SYNTHETIC_SQL_TOKEN_B';
  mapping_a jsonb='{"organizationId":"org","teamId":"team","companyId":"A","teamName":"Synthetic shared inbox","enabled":true}';
  mapping_b jsonb='{"organizationId":"org","teamId":"team","companyId":"B","teamName":"Synthetic shared inbox","enabled":true}';
begin
  foreach signature in array array['public.title_missive_credential_status(uuid,uuid,bigint)','public.title_read_missive_credential(uuid,uuid,bigint)','public.title_save_missive_credential(uuid,uuid,bigint,bigint,text)'] loop
    perform pg_temp.assert_credential(not has_function_privilege('anon',signature,'execute') and not has_function_privilege('authenticated',signature,'execute') and has_function_privilege('service_role',signature,'execute'),'RPC callable by service only');
  end loop;
  perform pg_temp.assert_credential((select relrowsecurity from pg_class where oid='public.title_missive_credentials'::regclass),'credential table has RLS');
  perform pg_temp.assert_credential(not has_table_privilege('anon','public.title_missive_credentials','select') and not has_table_privilege('authenticated','public.title_missive_credentials','select') and not has_table_privilege('service_role','public.title_missive_credentials','select'),'raw credential metadata table is not directly readable');
  insert into auth.users(id,email,email_confirmed_at) values(actor,'credentials@example.test',now()),(stranger,'stranger@example.test',now());
  for n in 1..5 loop
    begin
      insert into public.title_workspaces(name,state) values('Credential fixture','{"companies":[{"id":"A"},{"id":"B"}],"inbox":[]}') returning id into w;
      insert into public.title_workspaces(name,state) values('Separate credential fixture','{"companies":[],"inbox":[]}') returning id into w2;
      insert into public.title_workspaces(name,state) values('No integration fixture','{"companies":[{"id":"A"}],"inbox":[]}') returning id into empty_w;
      insert into public.title_memberships(workspace_id,user_id,role,all_companies) values(w,actor,'owner',true),(w2,actor,'owner',true),(empty_w,actor,'owner',true);
      set local role service_role;
      result=public.title_missive_credential_status(w,actor,1);
      perform pg_temp.assert_credential(result='{"exists":false,"configured":false,"revision":0,"verifiedAt":null}'::jsonb,'safe absent metadata');
      perform pg_temp.assert_credential(public.title_read_missive_credential(w,actor,1)='{"exists":false,"revision":0,"token":null,"verifiedAt":null}'::jsonb,'absent server record');
      perform pg_temp.reject_credential('42501','select * from public.title_missive_credentials');
      perform pg_temp.reject_credential('42501','select * from vault.decrypted_secrets');
      perform pg_temp.reject_credential('42501',format('select public.title_missive_credential_status(%L,%L,1)',w,stranger));
      perform pg_temp.reject_credential('42501',format('select public.title_read_missive_credential(%L,%L,1)',w,stranger));
      perform pg_temp.reject_credential('42501',format('select public.title_save_missive_credential(%L,%L,1,0,%L)',w,stranger,token_a));
      perform public.title_save_missive_route(w,actor,'credentials@example.test',1,0,mapping_a);
      perform public.title_save_missive_route(w,actor,'credentials@example.test',1,1,mapping_b);
      result=public.title_save_missive_credential(w,actor,1,0,token_a);
      perform pg_temp.assert_credential(result->>'configured'='true' and result->>'revision'='1' and result->>'source'='workspace' and not(result ? 'token') and not(result::text like '%'||token_a||'%'),'save returns safe credential metadata');
      result=public.title_missive_credential_status(w,actor,1);
      perform pg_temp.assert_credential(result->>'exists'='true' and result->>'configured'='true' and result->>'revision'='1' and not(result ? 'token') and (select count(*) from jsonb_object_keys(result))=4,'status returns exactly four safe fields');
      perform pg_temp.assert_credential(public.title_read_missive_credential(w,actor,1)->>'token'=token_a,'authorized server read returns exact token');
      select i.config into config from public.title_integrations i where workspace_id=w;
      perform pg_temp.assert_credential(config->>'schemaVersion'='2' and config->>'revision'='3' and not exists(select 1 from jsonb_array_elements(config->'mappings') r where r->>'enabled'<>'false' or r->>'version'<>'3'),'initial credential save pauses all routes and invalidates global review');
      perform pg_temp.assert_credential((select status from public.title_integrations where workspace_id=w)='disabled','provider disabled until routing reviewed');
      perform pg_temp.assert_credential(public.title_read_missive_credential(w2,actor,1)->>'exists'='false','other owned workspace does not inherit token');
      perform pg_temp.reject_credential('PT409',format('select public.title_save_missive_credential(%L,%L,1,0,%L)',w,actor,token_b));
      perform pg_temp.reject_credential('PT409',format('select public.title_save_missive_credential(%L,%L,1,null,%L)',w,actor,token_b));
      perform pg_temp.reject_credential('P0001',format('select public.title_save_missive_credential(%L,%L,1,1,%L)',w,actor,'bad token with spaces'));
      perform pg_temp.reject_credential('42501',format('select public.title_save_missive_credential(%L,%L,2,1,%L)',w,actor,token_b));
      perform pg_temp.reject_credential('42501',format('select public.title_read_missive_credential(%L,%L,null)',w,actor));
      reset role;
      select c.secret_id into secret_id from public.title_missive_credentials c where workspace_id=w;
      perform pg_temp.assert_credential((select count(*) from vault.secrets)=1,'one Vault record created');
      set local role service_role;
      -- Metadata remains available when the stub simulates unavailable decrypted bytes.
      perform set_config('title_test.vault_read_failure','yes',true);
      perform pg_temp.assert_credential(public.title_missive_credential_status(w,actor,1)->>'revision'='1','metadata does not decrypt the old credential');
      perform pg_temp.reject_credential('P0001',format('select public.title_read_missive_credential(%L,%L,1)',w,actor));
      result=public.title_save_missive_credential(w,actor,1,1,token_b);
      perform pg_temp.assert_credential(result->>'revision'='2','rotation can recover without decrypting old credential');
      perform set_config('title_test.vault_read_failure','no',true);
      perform pg_temp.assert_credential(public.title_read_missive_credential(w,actor,1)->>'token'=token_b,'rotated token is current');
      reset role;
      perform pg_temp.assert_credential((select c.secret_id from public.title_missive_credentials c where workspace_id=w)=secret_id and (select count(*) from vault.secrets)=1,'rotation updates existing Vault record');
      set local role service_role;
      perform pg_temp.assert_credential((select i.config->>'revision' from public.title_integrations i where workspace_id=w)='4','rotation invalidates routing again');
      -- Failing the final audit must roll back Vault, credential metadata and routing.
      perform set_config('title_test.fail_credential_audit','yes',true);
      perform pg_temp.reject_credential('PTTST',format('select public.title_save_missive_credential(%L,%L,1,2,%L)',w,actor,token_a));
      perform set_config('title_test.fail_credential_audit','no',true);
      perform pg_temp.assert_credential(public.title_read_missive_credential(w,actor,1)->>'token'=token_b and public.title_missive_credential_status(w,actor,1)->>'revision'='2' and (select i.config->>'revision' from public.title_integrations i where workspace_id=w)='4','failed save rolls back all mutable records');
      result=public.title_save_missive_credential(w,actor,1,2,null);
      perform pg_temp.assert_credential(result->>'configured'='false' and result->>'revision'='3' and result->'verifiedAt'='null'::jsonb,'disconnect creates an explicit tombstone');
      perform pg_temp.assert_credential(public.title_read_missive_credential(w,actor,1)='{"exists":true,"revision":3,"token":null,"verifiedAt":null}'::jsonb,'disconnected server read does not contain old bytes');
      reset role;
      perform pg_temp.assert_credential(not exists(select 1 from vault.secrets where id=secret_id),'disconnect deletes encrypted source record');
      perform pg_temp.assert_credential((select c.secret_id from public.title_missive_credentials c where workspace_id=w) is null,'credential tombstone has no dangling secret reference');
      set local role service_role;
      perform pg_temp.assert_credential((select i.config->>'revision' from public.title_integrations i where workspace_id=w)='5','disconnect advances global routing revision');
      result=public.title_save_missive_credential(w,actor,1,3,token_a);
      perform pg_temp.assert_credential(result->>'revision'='4','reconnect advances credential revision');
      reset role;
      select c.secret_id into second_secret from public.title_missive_credentials c where workspace_id=w;
      perform pg_temp.assert_credential(second_secret<>secret_id and (select count(*) from vault.secrets)=1,'reconnect creates a fresh Vault identity');
      set local role service_role;
      -- Disconnect with no integration still invalidates a concurrently open first-route dialog.
      result=public.title_save_missive_credential(empty_w,actor,1,0,null);
      perform pg_temp.assert_credential(result->>'revision'='1' and (select i.config->>'revision' from public.title_integrations i where workspace_id=empty_w)='1','empty disconnect reserves a routing revision');
      perform pg_temp.reject_credential('PT409',format('select public.title_save_missive_route(%L,%L,%L,1,0,%L)',empty_w,actor,'credentials@example.test',mapping_a));
      perform public.title_save_missive_route(empty_w,actor,'credentials@example.test',1,1,mapping_a);
      perform pg_temp.assert_credential((select i.config->>'revision' from public.title_integrations i where workspace_id=empty_w)='2','freshly reviewed first route can proceed');
      result=public.title_save_missive_credential(w2,actor,1,0,token_b);
      perform pg_temp.assert_credential(public.title_read_missive_credential(w2,actor,1)->>'token'=token_b and public.title_read_missive_credential(w,actor,1)->>'token'=token_a,'two owned workspaces keep distinct credentials');
      perform pg_temp.assert_credential(not exists(select 1 from public.title_audit where workspace_id in(w,w2,empty_w) and (detail::text like '%'||token_a||'%' or detail::text like '%'||token_b||'%')),'audit contains no tokens');
      perform pg_temp.assert_credential(not exists(select 1 from public.title_workspaces where id in(w,w2,empty_w) and (state::text like '%'||token_a||'%' or state::text like '%'||token_b||'%')) and not exists(select 1 from public.title_integrations i where workspace_id in(w,w2,empty_w) and (i.config::text like '%'||token_a||'%' or i.config::text like '%'||token_b||'%')),'workspace state and integration config contain no tokens');
      update public.title_memberships set role='admin',all_companies=false where workspace_id=w;
      perform pg_temp.reject_credential('42501',format('select public.title_missive_credential_status(%L,%L,1)',w,actor));
      perform pg_temp.reject_credential('42501',format('select public.title_read_missive_credential(%L,%L,1)',w,actor));
      perform pg_temp.reject_credential('42501',format('select public.title_save_missive_credential(%L,%L,1,4,null)',w,actor));
      update public.title_memberships set role='admin',all_companies=true where workspace_id=w;
      perform pg_temp.assert_credential(public.title_missive_credential_status(w,actor,1)->>'configured'='true','current global admin can read safe status');
      update public.title_memberships set active=false,version=2 where workspace_id=w;
      perform pg_temp.reject_credential('42501',format('select public.title_missive_credential_status(%L,%L,1)',w,actor));
      perform pg_temp.reject_credential('42501',format('select public.title_read_missive_credential(%L,%L,1)',w,actor));
      perform pg_temp.reject_credential('42501',format('select public.title_save_missive_credential(%L,%L,1,4,null)',w,actor));
      reset role;
      raise exception 'Rollback fixtures' using errcode='PTCMP';
    exception when sqlstate 'PTCMP' then count_passed=count_passed+1; end;
  end loop;
  perform pg_temp.assert_credential(count_passed=5 and (select count(*) from public.title_missive_credentials)=0 and (select count(*) from vault.secrets)=0,'all five credential rounds fully rolled back');
  raise notice 'PASS: five credential transaction rounds with a local Vault API stub (not encryption verification)';
end $$;
select 'Missive credential SQL verification complete';
