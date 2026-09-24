-- Fictional regression fixture only. Every mutation is rolled back, including
-- auth users, workspace/memberships, Vault secrets, helper functions and audits.
begin;
create function pg_temp.jv_check(ok boolean,label text) returns integer language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'JV assertion failed: %',label; end if; return 1; end $$;
create function pg_temp.jv_error(code text,statement text) returns integer language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return 1; end if; raise; end;
 raise exception 'Expected JV SQLSTATE %',code; end $$;
do $$
declare w uuid='e8200000-0000-4000-8000-000000000001'; w2 uuid='e8200000-0000-4000-8000-000000000002';
 owner uuid='e8100000-0000-4000-8000-000000000001'; staff uuid='e8100000-0000-4000-8000-000000000002'; other uuid='e8100000-0000-4000-8000-000000000003';
 p jsonb; r jsonb; input jsonb; new_input jsonb; secret_uuid uuid; stamp text; checks integer=0; role_name text; field_name text; before_count integer; call text;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner,'jv-owner@example.test',now()),(staff,'jv-staff@example.test',now()),(other,'jv-other@example.test',now());
 insert into public.title_workspaces(id,name,state) values(w,'Fictional JV regression','{"companies":[{"id":"C1"},{"id":"C2"}],"documents":[{"id":"D1","companyId":"C1","assetId":"A1","version":1,"visibility":"Restricted","category":"Applications"}]}'),(w2,'Fictional second workspace','{"companies":[{"id":"C1"}]}');
 insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access) values(w,owner,'owner','{}',true,true),(w,staff,'onboarding',array['C1'],false,true),(w,other,'operations','{}',true,true),(w2,owner,'owner','{}',true,true);
 insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by)
 values(w,'A1','C1','D1','fictional-jv-regression/a1.pdf','application/pdf','fictional.pdf',100,repeat('a',64),owner);
 p=jsonb_build_object('schemaVersion',1,'applicants',jsonb_build_array(jsonb_build_object('id','fictional-applicant','name','FICTIONAL_PRIVATE_JV_NAME','email','applicant@example.test','phone','7045550101','dob','1985-01-15','ssn','123456789','driverLicense','FICTIONAL_DL','currentAddress','10 Example Street','ownershipType','individual','businessName','','businessStatus','not-applicable','businessReference','','residenceHistory','[]'::jsonb,'employmentHistory','[]'::jsonb)),
   'logoPreferences','','notes','FICTIONAL_PRIVATE_JV_NOTE','sourceDocumentIds','["D1"]'::jsonb,'steps',
   (select jsonb_agg(jsonb_build_object('id',id,'status','Not started','assignee','','dueDate','','reference','','note','') order by n)
     from unnest(array['partnership-agreement','domain','secretary-of-state','federal-tax-id','bank-account','nipr','sc-insurance','nc-insurance','underwriters','softpro','website','email','business-cards','accounting','logo','aba','buyer-title-preference']) with ordinality as steps(id,n)));
 input=jsonb_build_object('expectedVersion',0,'payload',p,'status','Draft','reviewNote','','sourceManifest','[{"documentId":"D1","assetId":"A1","version":1}]'::jsonb);
 checks=checks+pg_temp.jv_check(public.title_jv_payload_valid(p),'valid bounded schema');
 checks=checks+pg_temp.jv_check(public.title_jv_intake(w,staff,1,'C1','load','{}') is null,'absent application remains version zero at gateway');
 call=format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,other,'C1','load','{}');
 checks=checks+pg_temp.jv_error('42501',call);
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,2,%L,%L,%L)',w,staff,'C1','load','{}'));
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C2','load','{}'));
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w2,staff,'C1','load','{}'));
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,owner,'missing','load','{}'));
 update public.title_memberships set restricted_access=false where workspace_id=w and user_id=owner;
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,owner,'C1','load','{}'));
 update public.title_memberships set restricted_access=true where workspace_id=w and user_id=owner;
 r=public.title_jv_intake(w,staff,1,'C1','save',input);
 checks=checks+pg_temp.jv_check(r->>'version'='1' and r->>'status'='Draft' and r->'payload'=p,'private save returns exact data');
 select secret_id into secret_uuid from public.title_jv_intakes where workspace_id=w and company_id='C1';
 checks=checks+pg_temp.jv_check((select decrypted_secret::jsonb->'payload'=p from vault.decrypted_secrets where id=secret_uuid),'Vault decrypts complete payload');
 checks=checks+pg_temp.jv_check((select position('FICTIONAL_PRIVATE_JV_NAME' in secret::text)=0 and position('123456789' in secret::text)=0 from vault.secrets where id=secret_uuid),'Vault ciphertext has no plaintext fixture markers');
 checks=checks+pg_temp.jv_check(not (select to_jsonb(t) ?| array['payload','review_note','reviewNote','ssn'] from public.title_jv_intakes t where workspace_id=w),'metadata contains no private fields');
 checks=checks+pg_temp.jv_error('PT409',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',input));
 input=jsonb_set(input,'{expectedVersion}','1');
 foreach field_name in array array['reviewedAt','reviewedBy','ssn','unexpected_private_value'] loop
  new_input=jsonb_set(input,'{payload}',p||jsonb_build_object(field_name,'FICTIONAL_PRIVATE_JV_NAME'));
  checks=checks+pg_temp.jv_error('22023',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',new_input));
 end loop;
 new_input=jsonb_set(input,'{payload,notes}',to_jsonb(repeat('x',140000)));
 checks=checks+pg_temp.jv_error('22023',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',new_input));
 new_input=jsonb_set(input,'{payload,sourceDocumentIds}','["missing"]');
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',new_input));
 foreach field_name in array array['visibility','category','companyId','orderId','assetId'] loop
  update public.title_workspaces set state=jsonb_set(state,array['documents','0',field_name],'"changed"') where id=w;
  checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',input));
  update public.title_workspaces set state=jsonb_set(state,'{documents}','[{"id":"D1","companyId":"C1","assetId":"A1","version":1,"visibility":"Restricted","category":"Applications"}]') where id=w;
 end loop;
 update public.title_assets set company_id='C2' where workspace_id=w and id='A1';
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',input));
 update public.title_assets set company_id='C1' where workspace_id=w and id='A1';
 checks=checks+pg_temp.jv_check((select version=1 from public.title_jv_intakes where workspace_id=w),'all failed writes leave version unchanged');
 new_input=input||'{"status":"Reviewed","reviewNote":"FICTIONAL_PRIVATE_REVIEW_NOTE"}';
 checks=checks+pg_temp.jv_error('PT409',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',new_input));
 r=public.title_jv_intake(w,staff,1,'C1','save',input||'{"status":"Ready for review"}');
 input=jsonb_set(input,'{expectedVersion}','2');new_input=input||'{"status":"Reviewed","reviewNote":"FICTIONAL_PRIVATE_REVIEW_NOTE"}';
 checks=checks+pg_temp.jv_error('PT409',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',jsonb_set(new_input,'{payload,notes}','"Changed"')));
 r=public.title_jv_intake(w,owner,1,'C1','save',new_input);stamp=r->>'reviewedAt';
 checks=checks+pg_temp.jv_check(r->>'status'='Reviewed' and r->>'reviewedBy'=owner::text and stamp is not null,'review attribution is server-owned');
 checks=checks+pg_temp.jv_check((select decrypted_secret::jsonb->>'reviewNote'='FICTIONAL_PRIVATE_REVIEW_NOTE' from vault.decrypted_secrets where id=secret_uuid),'review note is encrypted in Vault envelope');
 new_input=jsonb_set(new_input,'{expectedVersion}','3');new_input=jsonb_set(new_input,'{payload,steps,0,status}','"In progress"');
 r=public.title_jv_intake(w,staff,1,'C1','save',new_input);
 checks=checks+pg_temp.jv_check(r->>'reviewedAt'=stamp and r->>'reviewedBy'=owner::text and r->>'version'='4','checklist edits preserve original manual review');
 checks=checks+pg_temp.jv_check((select secret_id=secret_uuid from public.title_jv_intakes where workspace_id=w),'updates reuse original Vault secret');
 new_input=jsonb_set(new_input,'{expectedVersion}','4');new_input=jsonb_set(new_input,'{payload,notes}','"Changed intake"');
 checks=checks+pg_temp.jv_error('PT409',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',new_input));
 r=public.title_jv_intake(w,staff,1,'C1','save',new_input||'{"status":"Draft","reviewNote":""}');
 checks=checks+pg_temp.jv_check(r->>'status'='Draft' and r->'reviewedAt'='null'::jsonb and r->'reviewedBy'='null'::jsonb,'changed intake clears review');
 checks=checks+pg_temp.jv_check(not exists(select 1 from public.title_audit where workspace_id=w and (detail-'companyId'-'version'-'status')<>'{}'::jsonb),'audit allowlists metadata only');
 checks=checks+pg_temp.jv_check(not exists(select 1 from public.title_audit where workspace_id=w and to_jsonb(title_audit)::text like '%FICTIONAL_PRIVATE%'),'audit contains no private fixture markers');
 checks=checks+pg_temp.jv_check(not exists(select 1 from public.title_workspaces where id=w and state::text like '%FICTIONAL_PRIVATE%'),'workspace has no application');
 checks=checks+pg_temp.jv_check(not exists(select 1 from public.title_backups where workspace_id=w),'JV creates no workspace backups');
 update public.title_memberships set active=false,version=2 where workspace_id=w and user_id=staff;
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','load','{}'));
 checks=checks+pg_temp.jv_error('42501',format('select public.title_jv_intake(%L,%L,1,%L,%L,%L)',w,staff,'C1','save',new_input));
 foreach role_name in array array['anon','authenticated','service_role'] loop
  checks=checks+pg_temp.jv_check(not has_table_privilege(role_name,'public.title_jv_intakes','SELECT,INSERT,UPDATE,DELETE'),'no direct private table grant');
  checks=checks+pg_temp.jv_check(not has_function_privilege(role_name,'public.title_jv_payload_valid(jsonb)','EXECUTE'),'internal validator has no API grant');
  checks=checks+pg_temp.jv_check(has_function_privilege(role_name,'public.title_jv_intake(uuid,uuid,bigint,text,text,jsonb)','EXECUTE')=(role_name='service_role'),'RPC is service only');
 end loop;
 checks=checks+pg_temp.jv_check((select relrowsecurity from pg_class where oid='public.title_jv_intakes'::regclass),'private table RLS enabled');
 raise notice 'JV SQL: % fictional access/schema/CAS/review/encryption/audit assertions passed; all data will roll back.',checks;
end $$;
rollback;
