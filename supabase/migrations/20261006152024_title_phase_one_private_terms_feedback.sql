-- Additive private terms remain in the existing encrypted JV envelope.
-- Legacy payloads are valid without the optional Phase One extensions.
alter function title_private.company_records_valid(jsonb) rename to company_records_legacy_valid;
create function title_private.company_record_compliance_valid(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 return title_private.company_record_object(p,array['status','statusCheckedOn','annualReportFiledOn','annualReportDueOn','documentIds'])
 and title_private.company_record_text(p->'status',20) and p->>'status' in ('Unknown','Current','Delinquent','Inactive','Dissolved','Suspended')
 and title_private.company_record_date(p->'statusCheckedOn') and title_private.company_record_date(p->'annualReportFiledOn')
 and title_private.company_record_date(p->'annualReportDueOn') and title_private.company_record_ids(p->'documentIds',20);
exception when others then return false; end $$;
create function title_private.company_record_percentage_valid(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 return title_private.company_record_text(p,7) and ((p#>>'{}')='' or ((p#>>'{}') ~ '^[0-9]{1,3}(\.[0-9]{1,3})?$' and (p#>>'{}')::numeric<=100));
exception when others then return false; end $$;
create function title_private.company_records_valid(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare stripped jsonb=p-array['financialTerms','banking','companyCompliance']; o jsonb; a jsonb; f jsonb; b jsonb; row jsonb;
  owners jsonb='[]'; agreements jsonb='[]'; ids text[]='{}'; total numeric=0; all_entered boolean=true; governing jsonb; operating jsonb;
begin
 if jsonb_typeof(p)<>'object' then return false; end if;
 for o in select value from jsonb_array_elements(p->'owners') loop
   if o ? 'setupKind' and (o->>'kind'='individual' or not title_private.company_record_text(o->'setupKind',10) or o->>'setupKind' not in ('existing','new')) then return false; end if;
   if o ? 'compliance' and (o->>'kind'='individual' or not title_private.company_record_compliance_valid(o->'compliance')) then return false; end if;
   owners=owners||jsonb_build_array(o-array['setupKind','compliance']);
 end loop;
 for a in select value from jsonb_array_elements(p->'agreements') loop
   if a ? 'kind' and (not title_private.company_record_text(a->'kind',20) or a->>'kind' not in ('combined','jv','operating','other')) then return false; end if;
   if a ? 'executed' and jsonb_typeof(a->'executed')<>'boolean' then return false; end if;
   agreements=agreements||jsonb_build_array(a-array['kind','executed']);
 end loop;
 stripped=jsonb_set(jsonb_set(stripped,'{owners}',owners),'{agreements}',agreements);
 if not title_private.company_records_legacy_valid(stripped) then return false; end if;
 if p ? 'companyCompliance' and not title_private.company_record_compliance_valid(p->'companyCompliance') then return false; end if;
 if p ? 'banking' then
   b=p->'banking';
   if not title_private.company_record_object(b,array['bankEstablished','bankName','confirmation','paymentEstablished','cardholder','lastFour']) or
     jsonb_typeof(b->'bankEstablished')<>'boolean' or jsonb_typeof(b->'paymentEstablished')<>'boolean' or
     not title_private.company_record_text(b->'bankName',200) or not title_private.company_record_text(b->'confirmation',500) or
     not title_private.company_record_text(b->'cardholder',200) or not title_private.company_record_text(b->'lastFour',4) or (b->>'lastFour'<>'' and b->>'lastFour' !~ '^[0-9]{4}$') or concat(b->>'bankName',' ',b->>'confirmation',' ',b->>'cardholder') ~ '([0-9][ -]?){12,19}' then return false; end if;
 end if;
 if p ? 'financialTerms' then
   f=p->'financialTerms';
   if not title_private.company_record_object(f,array['status','effectiveOn','distribution','managementFeePercentage','agreementMode','jvAgreementId','operatingAgreementId']) or
     not title_private.company_record_text(f->'status',20) or f->>'status' not in ('Draft','Confirmed') or not title_private.company_record_date(f->'effectiveOn') or
     not title_private.company_record_percentage_valid(f->'managementFeePercentage') or not title_private.company_record_text(f->'agreementMode',20) or f->>'agreementMode' not in ('single','separate') or
     not title_private.company_record_text(f->'jvAgreementId',150) or not title_private.company_record_text(f->'operatingAgreementId',150) or
     jsonb_typeof(f->'distribution') is distinct from 'array' or jsonb_array_length(f->'distribution')>40 then return false; end if;
   if f->>'agreementMode'='single' and f->>'operatingAgreementId'<>'' then return false; end if;
   select value into governing from jsonb_array_elements(p->'agreements') where value->>'id'=f->>'jvAgreementId';
   select value into operating from jsonb_array_elements(p->'agreements') where value->>'id'=f->>'operatingAgreementId';
   if f->>'jvAgreementId'<>'' and governing is null or f->>'operatingAgreementId'<>'' and operating is null then return false; end if;
   for row in select value from jsonb_array_elements(f->'distribution') loop
     if not title_private.company_record_object(row,array['memberId','percentage']) or not title_private.company_record_text(row->'memberId',150) or row->>'memberId' !~ '^[A-Za-z0-9_-]{1,150}$' or row->>'memberId'=any(ids) or not title_private.company_record_percentage_valid(row->'percentage') then return false; end if;
     ids=array_append(ids,row->>'memberId');
     if row->>'percentage'='' then all_entered=false; else total=total+(row->>'percentage')::numeric; end if;
   end loop;
   if f->>'status'='Confirmed' and (f->>'effectiveOn'='' or f->>'managementFeePercentage'='' or total<>100 or not all_entered or
     governing is null or governing->'executed' is distinct from 'true'::jsonb or jsonb_array_length(governing->'documentIds')=0 or governing->>'kind' is distinct from case when f->>'agreementMode'='single' then 'combined' else 'jv' end or
     (f->>'agreementMode'='separate' and (operating is null or operating->'executed' is distinct from 'true'::jsonb or jsonb_array_length(operating->'documentIds')=0 or operating->>'kind' is distinct from 'operating' or operating->>'id'=governing->>'id'))) then return false; end if;
 end if;
 return true;
exception when others then return false; end $$;
revoke all on function title_private.company_records_valid(jsonb),title_private.company_record_percentage_valid(jsonb),title_private.company_record_compliance_valid(jsonb) from public,anon,authenticated,service_role;

create or replace function title_private.company_record_sources(p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb='[]'; r jsonb; d text;
begin
 for r in select value from jsonb_array_elements(coalesce(p->'owners','[]')) loop
   for d in select value from jsonb_array_elements_text((r->'documentIds')||coalesce(r->'compliance'->'documentIds','[]')) loop
     result=result||jsonb_build_array(jsonb_build_object('id',d,'categories',jsonb_build_array('Formation','Company records','Partner entities')));
   end loop;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p->'agreements','[]')) loop
   for d in select value from jsonb_array_elements_text(r->'documentIds') loop
     result=result||jsonb_build_array(jsonb_build_object('id',d,'categories',jsonb_build_array('Agreements')));
   end loop;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p->'worksheets','[]')) loop
   if r->>'documentId'<>'' then result=result||jsonb_build_array(jsonb_build_object('id',r->>'documentId','categories',jsonb_build_array('Applications','Agreements','Disclosures','Company records'))); end if;
 end loop;
 for d in select value from jsonb_array_elements_text(coalesce(p->'companyCompliance'->'documentIds','[]')) loop
   result=result||jsonb_build_array(jsonb_build_object('id',d,'categories',jsonb_build_array('Formation','Company records')));
 end loop;
 return result;
end $$;

create or replace function public.title_jv_sources(p_workspace uuid,p_state jsonb,p_company text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare request jsonb; requests jsonb='[]'; doc_id text; doc jsonb; asset public.title_assets%rowtype; manifest jsonb='[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',value,'categories',jsonb_build_array('Applications')) order by n),'[]') into requests
    from jsonb_array_elements_text(p_payload->'sourceDocumentIds') with ordinality as refs(value,n);
  requests=requests||title_private.company_record_sources(p_payload->'companyRecords');
  for request in select value from jsonb_array_elements(requests) loop
    doc_id=request->>'id';
    select d into doc from jsonb_array_elements(coalesce(p_state->'documents','[]'::jsonb)) d
      where d->>'id'=doc_id and d->>'companyId'=p_company and coalesce(d->>'orderId','')=''
        and coalesce(d->>'archivedAt','')='' and d->>'visibility'='Restricted' and exists(select 1 from jsonb_array_elements_text(request->'categories') category where category=d->>'category')
        and jsonb_typeof(d->'version')='number' and (d->>'version') ~ '^[1-9][0-9]*$';
    if not found then manifest=manifest||jsonb_build_array(jsonb_build_object('documentId',doc_id,'unavailable',true)); continue; end if;
    select * into asset from public.title_assets a where a.workspace_id=p_workspace and a.id=doc->>'assetId'
      and a.company_id=p_company and a.document_id=doc_id for share;
    if not found then manifest=manifest||jsonb_build_array(jsonb_build_object('documentId',doc_id,'unavailable',true)); continue; end if;
    if exists(select 1 from jsonb_array_elements(manifest) row where row->>'documentId'=doc_id) then continue; end if;
    manifest=manifest||jsonb_build_array(jsonb_build_object('documentId',doc_id,'assetId',asset.id,'version',doc->'version','sha256',asset.sha256,'bytes',asset.byte_size));
  end loop;
  return manifest;
end $$;
revoke all on function public.title_jv_sources(uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;


create or replace function public.title_jv_intake(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_company text,p_action text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  m public.title_memberships%rowtype; r public.title_jv_intakes%rowtype; state jsonb;
  decrypted text; private_data jsonb; previous_payload jsonb; next_payload jsonb; next_status text; next_note text;
  expected bigint; secret uuid; stamp timestamptz=clock_timestamp(); changed boolean;
  member_id text; current_sources jsonb; expected_sources jsonb; sources_changed boolean=false;
begin
  -- Same lock/order as access lifecycle and workspace commits: revocation,
  -- company deletion, document edits and JV writes cannot pass one another.
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor for share;
  if not found or not m.active or p_access_version is null or m.version<>p_access_version or
    m.role not in ('owner','admin','onboarding') or not m.restricted_access or
    p_company is null or not (m.all_companies or p_company=any(m.company_ids)) then
    raise exception 'Private application access changed.' using errcode='42501'; end if;
  select w.state into state from public.title_workspaces w where w.id=p_workspace for share;
  if not found or not exists(select 1 from jsonb_array_elements(coalesce(state->'companies','[]'::jsonb)) c where c->>'id'=p_company) then
    raise exception 'Private application access changed.' using errcode='42501'; end if;
  if p_action is null or p_action not in ('load','save') or p_input is null or jsonb_typeof(p_input)<>'object' or
    octet_length(p_input::text)>262144 or p_company !~ '^[-A-Za-z0-9_ .:@]{1,180}$' then
    raise exception 'Invalid private application request.' using errcode='22023'; end if;
  select * into r from public.title_jv_intakes where workspace_id=p_workspace and company_id=p_company for update;
  if found then
    select decrypted_secret into decrypted from vault.decrypted_secrets where id=r.secret_id;
    if decrypted is null then raise exception 'Private application unavailable.' using errcode='PT503'; end if;
    private_data=decrypted::jsonb;
    previous_payload=private_data->'payload';
    if jsonb_typeof(private_data) is distinct from 'object' or not public.title_jv_payload_valid(previous_payload) or
      jsonb_typeof(private_data->'reviewNote') is distinct from 'string' then
      raise exception 'Private application unavailable.' using errcode='PT503'; end if;
    current_sources=public.title_jv_sources(p_workspace,state,p_company,previous_payload);
    sources_changed=current_sources is distinct from private_data->'sourceManifest';
    -- Older workspace restores or removed members must not retain reviewed links.
    if exists (
      select 1 from (
        select value->>'memberId' id from jsonb_array_elements(coalesce(previous_payload->'companyRecords'->'owners','[]'))
        union select term->>'memberId' from jsonb_array_elements(coalesce(previous_payload->'companyRecords'->'agreements','[]')) agreement cross join lateral jsonb_array_elements(agreement->'terms') term
      union select value->>'memberId' from jsonb_array_elements(coalesce(previous_payload->'companyRecords'->'financialTerms'->'distribution','[]'))
      ) linked where not exists (
        select 1 from jsonb_array_elements(state->'companies') c cross join lateral jsonb_array_elements(coalesce(c->'members','[]')) member
        where c->>'id'=p_company and member->>'id'=linked.id
      )
    ) then sources_changed=true; end if;
  end if;
  if p_action='load' then
    if p_input<>'{}'::jsonb then raise exception 'Invalid private application request.' using errcode='22023'; end if;
    if r.status in ('Ready for review','Reviewed') and sources_changed then
      private_data=private_data||jsonb_build_object('reviewNote','','sourceManifest',current_sources,'sourceChanged',true);
      perform vault.update_secret(r.secret_id,private_data::text);
      update public.title_jv_intakes set status='Draft',version=version+1,updated_at=stamp,updated_by=p_actor,reviewed_at=null,reviewed_by=null
        where workspace_id=p_workspace and company_id=p_company returning * into r;
      insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
        values(p_workspace,p_actor,'','jv-intake.sources_changed',array[p_company],jsonb_build_object('companyId',p_company,'version',r.version,'status',r.status));
    end if;
  else
    if (p_input-'expectedVersion'-'payload'-'status'-'reviewNote'-'sourceManifest')<>'{}'::jsonb or
      jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or
      p_input->>'expectedVersion' !~ '^[0-9]{1,16}$' or
      not public.title_jv_payload_valid(p_input->'payload') or
      jsonb_typeof(p_input->'status') is distinct from 'string' or p_input->>'status' not in ('Draft','Ready for review','Reviewed') or
      jsonb_typeof(p_input->'sourceManifest') is distinct from 'array' or
      jsonb_typeof(p_input->'reviewNote') is distinct from 'string' or length(p_input->>'reviewNote')>4000 then
      raise exception 'Invalid private application request.' using errcode='22023'; end if;
    expected=(p_input->>'expectedVersion')::bigint;
    if expected<>coalesce(r.version,0) then raise exception 'Private application changed.' using errcode='PT409'; end if;
    next_payload=p_input->'payload'; next_status=p_input->>'status'; next_note=btrim(p_input->>'reviewNote');
    if previous_payload ? 'companyRecords' and not (next_payload ? 'companyRecords') then
      raise exception 'Private company records changed.' using errcode='PT409'; end if;
    for member_id in
      select value->>'memberId' from jsonb_array_elements(coalesce(next_payload->'companyRecords'->'owners','[]'))
      union select term->>'memberId' from jsonb_array_elements(coalesce(next_payload->'companyRecords'->'agreements','[]')) agreement cross join lateral jsonb_array_elements(agreement->'terms') term
      union select value->>'memberId' from jsonb_array_elements(coalesce(next_payload->'companyRecords'->'financialTerms'->'distribution','[]'))
    loop
      if not exists(select 1 from jsonb_array_elements(state->'companies') c cross join lateral jsonb_array_elements(c->'members') member_row where c->>'id'=p_company and member_row->>'id'=member_id) then
        raise exception 'Company owner links changed.' using errcode='PT409'; end if;
    end loop;
    if next_payload->'companyRecords'->'financialTerms'->>'status'='Confirmed' and exists(
      select 1 from jsonb_array_elements(state->'companies') c cross join lateral jsonb_array_elements(c->'members') member_record
      where c->>'id'=p_company and not exists(select 1 from jsonb_array_elements(next_payload->'companyRecords'->'financialTerms'->'distribution') d where d->>'memberId'=member_record->>'id')
    ) then raise exception 'Confirmed terms require every owner.' using errcode='22023'; end if;
    changed=(previous_payload-'steps') is distinct from (next_payload-'steps');
    -- Reviewed can only follow an explicit ready state for the same intake.
    -- Checklist-only saves retain the original reviewer and review timestamp.
    if next_status='Reviewed' and (r.status is null or r.status not in ('Ready for review','Reviewed') or changed or next_note='' or
      (r.status='Reviewed' and next_note is distinct from private_data->>'reviewNote')) then
      raise exception 'Private application review changed.' using errcode='PT409'; end if;
    if next_status<>'Reviewed' and next_note<>'' then raise exception 'Invalid private application request.' using errcode='22023'; end if;
    if r.status='Reviewed' and next_status='Ready for review' then raise exception 'Private application review changed.' using errcode='PT409'; end if;
    -- Bind the gateway's reviewed source versions to current locked originals.
    -- The encrypted manifest additionally detects silent asset hash/size changes.
    if r.status in ('Ready for review','Reviewed') and sources_changed then
      raise exception 'Private application changed.' using errcode='PT409'; end if;
    current_sources=public.title_jv_sources(p_workspace,state,p_company,next_payload);
    if exists(select 1 from jsonb_array_elements(current_sources) s where s->'unavailable'='true'::jsonb) then
      raise exception 'Private application source unavailable.' using errcode='42501'; end if;
    select coalesce(jsonb_agg(s-'sha256'-'bytes' order by n),'[]'::jsonb) into expected_sources
      from jsonb_array_elements(current_sources) with ordinality as sources(s,n);
    if p_input->'sourceManifest' is distinct from expected_sources then
      raise exception 'Private application changed.' using errcode='PT409'; end if;
    private_data=jsonb_build_object('payload',next_payload,'reviewNote',next_note,'sourceManifest',current_sources,'sourceChanged',false);
    if octet_length(private_data::text)>262144 then raise exception 'Invalid private application request.' using errcode='22023'; end if;
    if r.secret_id is null then
      secret=vault.create_secret(private_data::text,'title:jv:'||p_workspace::text||':'||p_company,'Private JV application');
      insert into public.title_jv_intakes(workspace_id,company_id,version,status,secret_id,updated_at,updated_by)
        values(p_workspace,p_company,1,next_status,secret,stamp,p_actor) returning * into r;
    else
      perform vault.update_secret(r.secret_id,private_data::text);
      update public.title_jv_intakes set version=version+1,status=next_status,updated_at=stamp,updated_by=p_actor,
        reviewed_at=case when next_status<>'Reviewed' then null when r.status='Reviewed' then r.reviewed_at else stamp end,
        reviewed_by=case when next_status<>'Reviewed' then null when r.status='Reviewed' then r.reviewed_by else p_actor end
        where workspace_id=p_workspace and company_id=p_company returning * into r;
    end if;
  end if;
  -- No applicant values, review notes, document IDs, or field names in audit.
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,'','jv-intake.'||p_action,array[p_company],
      jsonb_build_object('companyId',p_company,'version',coalesce(r.version,0),'status',coalesce(r.status,'Draft')));
  if r.version is null then return null; end if;
  return jsonb_build_object('companyId',r.company_id,'version',r.version,'payload',private_data->'payload',
    'status',r.status,'reviewNote',private_data->>'reviewNote','updatedAt',r.updated_at,'updatedBy',r.updated_by,
    'reviewedAt',r.reviewed_at,'reviewedBy',r.reviewed_by,'sourceChanged',coalesce(private_data->'sourceChanged','false'::jsonb));
exception
  when sqlstate '42501' then raise exception 'Private application access changed.' using errcode='42501';
  when sqlstate 'PT409' then raise exception 'Private application changed.' using errcode='PT409';
  when sqlstate '22023' then raise exception 'Invalid private application request.' using errcode='22023';
  when others then raise exception 'Private application unavailable.' using errcode='PT503';
end $$;
revoke all on function public.title_jv_intake(uuid,uuid,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.title_jv_intake(uuid,uuid,bigint,text,text,jsonb) to service_role;
