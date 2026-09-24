-- Fictional records in a disposable native PostgreSQL cluster. No provider traffic.
create function pg_temp.assert_credential(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Intake regression: %',label; end if; end $$;
create function pg_temp.reject_credential(expected text,statement text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection missing: %',statement using errcode='PTBAD';
exception when others then if sqlstate<>expected then raise; end if; end; end $$;
do $$ begin execute format('grant usage on schema %I to service_role,anon,authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
create function pg_temp.intake_statement(w uuid,actor uuid,expected bigint,request uuid,state jsonb,
  action text default 'source',company text default 'A',ord text default 'FILE-A',mapping bigint default 3,
  routing bigint default 3,credential bigint default 1,access_version bigint default 1,hash text default 'reviewed-hash') returns text language sql as $$
  select format('select public.title_commit_missive_intake(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    w,actor,'intake-operator@example.test',access_version,expected,request,hash,state,mapping,company,routing,'route:org:production:A',credential,ord,'message-a',action)
$$;
do $$
declare owner_id uuid=gen_random_uuid(); operator_id uuid=gen_random_uuid(); w uuid; request uuid; result jsonb;
  initial jsonb; candidate jsonb; source jsonb; document jsonb; mail jsonb; attachment jsonb; saved jsonb; bad jsonb;
  checks integer=0; run integer; role_name text; stmt text;
  signature text='public.title_commit_missive_intake(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text,bigint,text,bigint,text,text,text)';
begin
  perform pg_temp.assert_credential(not has_function_privilege('anon',signature,'execute') and
    not has_function_privilege('authenticated',signature,'execute') and has_function_privilege('service_role',signature,'execute'),'intake is service-only');
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,'intake-owner@example.test',now()),(operator_id,'intake-operator@example.test',now());
  for run in 1..5 loop
    begin
      initial='{"user":"intake-owner@example.test","companies":[{"id":"A"},{"id":"B"}],"orders":[{"id":"FILE-A","companyId":"A","status":"In review"},{"id":"FILE-B","companyId":"B","status":"In review"}],"documents":[],"inbox":[],"business":{"policies":[]}}';
      insert into public.title_workspaces(name,state) values('Fictional intake fixture',initial) returning id into w;
      insert into public.title_memberships(workspace_id,user_id,role,all_companies,company_ids)
        values(w,owner_id,'owner',true,'{}'),(w,operator_id,'operations',false,'{A}');
      set local role service_role;
      perform public.title_save_missive_credential(w,owner_id,1,0,'SYNTHETIC_INTAKE_CREDENTIAL');
      perform public.title_save_missive_route(w,owner_id,'intake-owner@example.test',1,1,
        '{"organizationId":"org","teamId":"production","teamName":"Fictional production","companyId":"A","enabled":true}');
      perform public.title_missive_set_production_only(w,owner_id,1,2,'route:org:production:A',true);
      source='{"provider":"Missive","id":"message-a","organizationId":"org","teamId":"production","conversationId":"conversation-a","html":"<p>Fictional final</p>","attachments":[{"id":"attachment-a","name":"original.txt","mime":"text/plain","bytes":17}]}';
      document=jsonb_build_object('id','source-doc','companyId','A','orderId','FILE-A','visibility','Internal','category','Email source','mime','application/json','text',source::text);
      mail=jsonb_build_object('id','mail-a','companyId','A','orderId','FILE-A','kind','Finals','missive',
        jsonb_build_object('messageId','message-a','organizationId','org','teamId','production','conversationId','conversation-a','companyId','A','orderId','FILE-A',
          'importedBy','intake-operator@example.test','mappingVersion',3,'sourceDocumentId','source-doc','fingerprint',repeat('a',64),'attachments',source->'attachments'));
      candidate=initial||jsonb_build_object('user','intake-operator@example.test','documents',jsonb_build_array(document),'inbox',jsonb_build_array(mail));
      request=gen_random_uuid();
      foreach role_name in array array['onboarding','finance','viewer','partner'] loop
        reset role; update public.title_memberships set role=role_name where workspace_id=w and user_id=operator_id;
        set local role service_role;
        perform pg_temp.reject_credential('42501',pg_temp.intake_statement(w,operator_id,0,request,candidate)); checks=checks+1;
      end loop;
      reset role; update public.title_memberships set role='operations' where workspace_id=w and user_id=operator_id;
      set local role service_role;
      perform pg_temp.reject_credential('42501',pg_temp.intake_statement(w,operator_id,0,request,candidate,access_version=>2));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,request,candidate));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate,mapping=>2));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate,routing=>2));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate,credential=>2));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate,company=>'B',ord=>'FILE-B'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate,ord=>'FILE-B'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate,action=>'invented'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate||'{"companies":[]}'::jsonb));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,candidate||'{"user":"spoofed@example.test"}'::jsonb));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,jsonb_set(candidate,'{documents,0}',document-'visibility')));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,jsonb_set(candidate,'{inbox,0}',mail-'kind')));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,jsonb_set(candidate,'{documents,0,companyId}','"B"')));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,jsonb_set(candidate,'{inbox,0,missive,sourceDocumentId}','"unrelated"')));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,0,request,jsonb_set(candidate,'{documents,0,text}','"not JSON"')));
      checks=checks+15;
      perform pg_temp.assert_credential((select state=initial and revision=0 from public.title_workspaces where id=w) and
        not exists(select 1 from public.title_command_receipts where workspace_id=w),'rejected requests retain state and receipts');
      execute pg_temp.intake_statement(w,operator_id,0,request,candidate) into result;
      perform pg_temp.assert_credential(result->>'revision'='1' and result->>'replayed'='false','approved scoped Operations saves one source');
      execute pg_temp.intake_statement(w,operator_id,0,request,candidate) into result;
      perform pg_temp.assert_credential(result->>'replayed'='true' and result->>'revision'='1','receipt replay does not duplicate');
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,request,candidate,hash=>'different'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,gen_random_uuid(),candidate));
      perform pg_temp.assert_credential(exists(select 1 from public.title_audit where workspace_id=w and action='workspace.commands' and actor_id=operator_id and
        actor_email='intake-operator@example.test' and company_ids='{A}' and detail->'actions'='["importMissiveText"]'::jsonb),'source audit attribution');
      saved=candidate;
      attachment=jsonb_build_object('id','attachment-doc','companyId','A','orderId','FILE-A','visibility','Internal','category','Email attachment','mime','text/plain','assetId','asset-a','providerSource',
        jsonb_build_object('provider','Missive','messageId','message-a','organizationId','org','teamId','production','conversationId','conversation-a','sourceMailId','mail-a','sourceDocumentId','source-doc',
          'attachmentId','attachment-a','importedBy','intake-operator@example.test','mappingVersion',3,'filename','original.txt','mime','text/plain','bytes',17,'sha256',repeat('b',64)));
      candidate=saved||jsonb_build_object('documents',(saved->'documents')||jsonb_build_array(attachment));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,gen_random_uuid(),candidate,action=>'attachment'));
      insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by)
        values(w,'asset-a','A','attachment-doc',w::text||'/synthetic-original','text/plain','original.txt',17,repeat('b',64),operator_id);
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,gen_random_uuid(),jsonb_set(candidate,'{documents,1,providerSource,sha256}',to_jsonb(repeat('c',64))),action=>'attachment'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,gen_random_uuid(),jsonb_set(candidate,'{documents,0,text}','"edited source"'),action=>'attachment'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,gen_random_uuid(),jsonb_set(candidate,'{inbox,0,kind}','"Revision"'),action=>'attachment'));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,1,gen_random_uuid(),jsonb_set(candidate,'{documents,1,providerSource,attachmentId}','"other"'),action=>'attachment'));
      perform pg_temp.assert_credential((select revision=1 and state=saved from public.title_workspaces where id=w),'failed attachment retains saved email');
      request=gen_random_uuid(); execute pg_temp.intake_statement(w,operator_id,1,request,candidate,action=>'attachment') into result;
      perform pg_temp.assert_credential(result->>'revision'='2' and result->>'replayed'='false','bytes-proven attachment commits');
      execute pg_temp.intake_statement(w,operator_id,1,request,candidate,action=>'attachment') into result;
      perform pg_temp.assert_credential(result->>'replayed'='true','attachment retry replays');
      reset role;
      update public.title_workspaces set state=jsonb_set(candidate,'{orders,0,status}','"Issued"') where id=w;
      set local role service_role;
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),candidate,action=>'attachment'));
      reset role;
      update public.title_workspaces set state=jsonb_set(candidate,'{business,policies}','[{"id":"policy-a","orderId":"FILE-A","status":"Delivered"}]') where id=w;
      set local role service_role;
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),candidate,action=>'attachment'));
      reset role;
      update public.title_workspaces set state=jsonb_set(candidate,'{documents,1,visibility}','"Restricted"') where id=w;
      set local role service_role;
      perform pg_temp.reject_credential('42501',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),candidate,action=>'attachment'));
      reset role; update public.title_workspaces set state=candidate where id=w;
      set local role service_role;
      saved=candidate;
      bad=candidate||jsonb_build_object('documents',(candidate->'documents')||jsonb_build_array(attachment||'{"id":"duplicate-source"}'::jsonb));
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),bad,action=>'attachment'));
      perform pg_temp.assert_credential((select count(*)=2 from public.title_command_receipts where workspace_id=w),'only successful source and attachment have receipts');
      perform public.title_missive_set_production_only(w,owner_id,1,3,'route:org:production:A',false);
      perform pg_temp.reject_credential('PT409',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),bad,action=>'attachment'));
      perform pg_temp.reject_credential('42501',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),bad,action=>'attachment',mapping=>4,routing=>4));
      reset role; update public.title_memberships set active=false where workspace_id=w and user_id=operator_id;
      set local role service_role;
      perform pg_temp.reject_credential('42501',pg_temp.intake_statement(w,operator_id,2,gen_random_uuid(),bad,action=>'attachment',mapping=>4,routing=>4));
      perform pg_temp.assert_credential((select state=saved and revision=2 from public.title_workspaces where id=w),'revocations preserve saved originals');
      checks=checks+20;
      reset role;
      raise exception 'Rollback this fictional round' using errcode='PTCMP';
    exception when sqlstate 'PTCMP' then null;
    end;
  end loop;
  raise notice 'PASS: five isolated intake rounds, including authorization, immutable source, bytes, replay, stale input and revocation; no external database or Missive writes';
end $$;
