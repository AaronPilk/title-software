-- Internal company records share the existing encrypted envelope and access lock.
-- No new public API or direct table grants.
create schema if not exists title_private;
create function title_private.company_record_object(p jsonb, fields text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object' and p ?& fields and (p-fields)='{}'::jsonb,false)
$$;
create function title_private.company_record_text(p jsonb, lim integer, multiline boolean default false) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='string' and length(p#>>'{}')<=lim and
   (p#>>'{}') !~ case when multiline then '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' else '[\x01-\x1f\x7f]' end,false)
$$;
create function title_private.company_record_date(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare s text=p#>>'{}'; begin
 if not title_private.company_record_text(p,10) then return false; end if;
 if s='' then return true; end if;
 return s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and left(s,4)<>'0000' and to_char(s::date,'YYYY-MM-DD')=s;
exception when others then return false; end $$;
create function title_private.company_record_ids(p jsonb, lim integer) returns boolean
language plpgsql immutable set search_path='' as $$
declare v jsonb; ids text[]='{}'; begin
 if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)>lim then return false; end if;
 for v in select value from jsonb_array_elements(p) loop
   if not title_private.company_record_text(v,180) or (v#>>'{}') !~ '^[-A-Za-z0-9_ .:@]{1,180}$' or (v#>>'{}')=any(ids) then return false; end if;
   ids=array_append(ids,v#>>'{}');
 end loop; return true;
end $$;
create function title_private.company_records_valid(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare o jsonb; r jsonb; a jsonb; t jsonb; w jsonb; f jsonb; k text; ids text[]; links text[]='{}'; subids text[];
begin
 if not title_private.company_record_object(p,array['companyEin','owners','agreements','worksheets']) or
    not title_private.company_record_text(p->'companyEin',9) or (p->>'companyEin'<>'' and p->>'companyEin' !~ '^[0-9]{9}$') or
    jsonb_typeof(p->'owners') is distinct from 'array' or jsonb_array_length(p->'owners')>40 or
    jsonb_typeof(p->'agreements') is distinct from 'array' or jsonb_array_length(p->'agreements')>40 or
    jsonb_typeof(p->'worksheets') is distinct from 'array' or jsonb_array_length(p->'worksheets')>30 then return false; end if;
 ids='{}';
 for o in select value from jsonb_array_elements(p->'owners') loop
   if not title_private.company_record_object(o,array['id','memberId','kind','legalName','ein','representatives','formationStatus','formationBy','formationState','formationReference','documentIds']) then return false; end if;
   foreach k in array array['id','memberId'] loop
     if not title_private.company_record_text(o->k,150) or o->>k !~ '^[A-Za-z0-9_-]{1,150}$' then return false; end if;
   end loop;
   if o->>'id'=any(ids) or o->>'memberId'=any(links) then return false; end if;
   ids=array_append(ids,o->>'id'); links=array_append(links,o->>'memberId');
   if not title_private.company_record_text(o->'kind',20) or o->>'kind' not in ('individual','llc','other') or
     not title_private.company_record_text(o->'legalName',200) or not title_private.company_record_text(o->'ein',9) or
     (o->>'ein'<>'' and (o->>'ein' !~ '^[0-9]{9}$' or o->>'kind'='individual')) or
     not title_private.company_record_text(o->'formationStatus',30) or o->>'formationStatus' not in ('Unknown','Being formed','Formed','Not applicable') or
     not title_private.company_record_text(o->'formationBy',40) or o->>'formationBy' not in ('Not confirmed','Agency','Owner / outside professional') or
     not title_private.company_record_text(o->'formationState',2) or (o->>'formationState'<>'' and o->>'formationState' !~ '^[A-Z]{2}$') or
     not title_private.company_record_text(o->'formationReference',1000) or not title_private.company_record_ids(o->'documentIds',20) or
     jsonb_typeof(o->'representatives') is distinct from 'array' or jsonb_array_length(o->'representatives')>10 then return false; end if;
   if o->>'kind'='individual' and (o->>'formationState'<>'' or o->>'formationReference'<>'' or o->>'formationBy'<>'Not confirmed' or o->>'formationStatus' not in ('Unknown','Not applicable') or jsonb_array_length(o->'documentIds')<>0) then return false; end if;
   subids='{}';
   for r in select value from jsonb_array_elements(o->'representatives') loop
     if not title_private.company_record_object(r,array['id','name','email','phone']) or not title_private.company_record_text(r->'id',150) or r->>'id' !~ '^[A-Za-z0-9_-]{1,150}$' or r->>'id'=any(subids) or
       not title_private.company_record_text(r->'name',150) or not title_private.company_record_text(r->'email',254) or
       (r->>'email'<>'' and r->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or not title_private.company_record_text(r->'phone',60) then return false; end if;
     subids=array_append(subids,r->>'id');
   end loop;
 end loop;
 ids='{}';
 for a in select value from jsonb_array_elements(p->'agreements') loop
   if not title_private.company_record_object(a,array['id','title','effectiveOn','reference','documentIds','terms','notes']) or
     not title_private.company_record_text(a->'id',150) or a->>'id' !~ '^[A-Za-z0-9_-]{1,150}$' or a->>'id'=any(ids) or
     not title_private.company_record_text(a->'title',200) or not title_private.company_record_date(a->'effectiveOn') or
     not title_private.company_record_text(a->'reference',1000) or not title_private.company_record_text(a->'notes',4000,true) or
     not title_private.company_record_ids(a->'documentIds',20) or jsonb_typeof(a->'terms') is distinct from 'array' or jsonb_array_length(a->'terms')>80 then return false; end if;
   ids=array_append(ids,a->>'id');
   for t in select value from jsonb_array_elements(a->'terms') loop
     if not title_private.company_record_object(t,array['memberId','label','percentage']) or not title_private.company_record_text(t->'memberId',150) or t->>'memberId' !~ '^[A-Za-z0-9_-]{1,150}$' or
       not title_private.company_record_text(t->'label',150) or not title_private.company_record_text(t->'percentage',7) then return false; end if;
     if t->>'percentage'<>'' and (t->>'percentage' !~ '^[0-9]{1,3}(\.[0-9]{1,3})?$' or (t->>'percentage')::numeric>100) then return false; end if;
   end loop;
 end loop;
 ids='{}';
 for w in select value from jsonb_array_elements(p->'worksheets') loop
   if not title_private.company_record_object(w,array['id','title','version','documentId','fields']) or not title_private.company_record_text(w->'id',150) or w->>'id' !~ '^[A-Za-z0-9_-]{1,150}$' or w->>'id'=any(ids) or
     not title_private.company_record_text(w->'title',200) or not title_private.company_record_text(w->'version',80) or
     not title_private.company_record_text(w->'documentId',180) or (w->>'documentId'<>'' and w->>'documentId' !~ '^[-A-Za-z0-9_ .:@]{1,180}$') or
     jsonb_typeof(w->'fields') is distinct from 'array' or jsonb_array_length(w->'fields')>100 then return false; end if;
   ids=array_append(ids,w->>'id'); subids='{}';
   for f in select value from jsonb_array_elements(w->'fields') loop
     if not title_private.company_record_object(f,array['id','label','source']) or not title_private.company_record_text(f->'id',150) or f->>'id' !~ '^[A-Za-z0-9_-]{1,150}$' or f->>'id'=any(subids) or
       not title_private.company_record_text(f->'label',200) or not title_private.company_record_text(f->'source',80) or
       f->>'source' not in ('company.name','company.states','company.ein','owner.name','owner.ein','owner.share','contact.name','contact.email','contact.phone','owner.formationState','owner.formationReference') then return false; end if;
     subids=array_append(subids,f->>'id');
   end loop;
 end loop;
 return true;
exception when others then return false;
end $$;

create function title_private.company_record_sources(p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb='[]'; r jsonb; d text;
begin
 for r in select value from jsonb_array_elements(coalesce(p->'owners','[]')) loop
   for d in select value from jsonb_array_elements_text(r->'documentIds') loop
     result=result||jsonb_build_array(jsonb_build_object('id',d,'categories',jsonb_build_array('Formation','Company records')));
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
 return result;
end $$;
revoke all on function title_private.company_record_object(jsonb,text[]),title_private.company_record_text(jsonb,integer,boolean),title_private.company_record_date(jsonb),title_private.company_record_ids(jsonb,integer),title_private.company_records_valid(jsonb),title_private.company_record_sources(jsonb) from public,anon,authenticated,service_role;

create or replace function public.title_jv_payload_valid(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb; h jsonb; s jsonb; k text; ids text[]; n integer;
  step_ids constant text[]=array['partnership-agreement','domain','secretary-of-state','federal-tax-id','bank-account','nipr','sc-insurance','nc-insurance','underwriters','softpro','website','email','business-cards','accounting','logo','aba','buyer-title-preference'];
begin
  if p ? 'companyRecords' then
    if not title_private.company_records_valid(p->'companyRecords') or octet_length(p::text)>131072 then return false; end if;
    p=p-'companyRecords';
  end if;
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>131072 or
    (p-'schemaVersion'-'applicants'-'logoPreferences'-'notes'-'sourceDocumentIds'-'steps')<>'{}'::jsonb or
    p->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p->'applicants') is distinct from 'array' or
    jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_typeof(p->'sourceDocumentIds') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'applicants')>20 or jsonb_array_length(p->'steps')<>17 or
    jsonb_array_length(p->'sourceDocumentIds')>100 then return false; end if;
  foreach k in array array['logoPreferences','notes'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>20000 then return false; end if;
  end loop;
  ids='{}';
  for a in select value from jsonb_array_elements(p->'applicants') loop
    if jsonb_typeof(a)<>'object' or (a-'id'-'name'-'email'-'phone'-'dob'-'ssn'-'driverLicense'-'currentAddress'-'ownershipType'-'businessName'-'businessStatus'-'businessReference'-'residenceHistory'-'employmentHistory')<>'{}'::jsonb then return false; end if;
    foreach k in array array['id','name','email','phone','dob','ssn','driverLicense','currentAddress','ownershipType','businessName','businessStatus','businessReference'] loop
      if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k)>4000 then return false; end if;
    end loop;
    if length(a->>'id') not between 1 and 180 or (a->>'id')=any(ids) or
      a->>'ownershipType' not in ('undecided','individual','business') or a->>'businessStatus' not in ('existing','forming','not-applicable') or
      (a->>'ssn'<>'' and a->>'ssn' !~ '^[0-9]{9}$') or length(a->>'dob')>10 then return false; end if;
    ids=array_append(ids,a->>'id');
    foreach k in array array['residenceHistory','employmentHistory'] loop
      if jsonb_typeof(a->k) is distinct from 'array' then return false; end if;
      if jsonb_array_length(a->k)>40 then return false; end if;
      if exists(select 1 from jsonb_array_elements(a->k) item group by item->>'id' having count(*)>1) then return false; end if;
      for h in select value from jsonb_array_elements(a->k) loop
        if jsonb_typeof(h)<>'object' or (h-'id'-'address'-'from'-'to'-case when k='employmentHistory' then 'employer' else 'id' end-case when k='employmentHistory' then 'role' else 'id' end)<>'{}'::jsonb then return false; end if;
        if jsonb_typeof(h->'id') is distinct from 'string' or length(h->>'id') not between 1 and 180 or
          jsonb_typeof(h->'address') is distinct from 'string' or length(h->>'address')>4000 or
          jsonb_typeof(h->'from') is distinct from 'string' or length(h->>'from')>10 or
          jsonb_typeof(h->'to') is distinct from 'string' or length(h->>'to')>10 then return false; end if;
        if k='employmentHistory' and (jsonb_typeof(h->'employer') is distinct from 'string' or length(h->>'employer')>4000 or
          jsonb_typeof(h->'role') is distinct from 'string' or length(h->>'role')>4000) then return false; end if;
      end loop;
    end loop;
  end loop;
  ids='{}';
  for s in select value from jsonb_array_elements(p->'steps') loop
    if jsonb_typeof(s)<>'object' or (s-'id'-'status'-'assignee'-'dueDate'-'reference'-'note')<>'{}'::jsonb then return false; end if;
    foreach k in array array['id','status','assignee','dueDate','reference','note'] loop
      if jsonb_typeof(s->k) is distinct from 'string' or length(s->>k)>4000 then return false; end if;
    end loop;
    if not (s->>'id')=any(step_ids) or (s->>'id')=any(ids) or
      s->>'status' not in ('Not started','In progress','Complete','Not applicable') or length(s->>'dueDate')>10 or
      (s->>'status' in ('Complete','Not applicable') and btrim(s->>'reference')='' and (length(btrim(s->>'note'))<10 or s->>'note' !~ '[[:alnum:]]')) then return false; end if;
    ids=array_append(ids,s->>'id');
  end loop;
  ids='{}';
  for s in select value from jsonb_array_elements(p->'sourceDocumentIds') loop
    if jsonb_typeof(s)<>'string' or length(s#>>'{}') not between 1 and 180 or (s#>>'{}')=any(ids) then return false; end if;
    ids=array_append(ids,s#>>'{}');
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function public.title_jv_payload_valid(jsonb) from public,anon,authenticated,service_role;


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
        and d->>'visibility'='Restricted' and exists(select 1 from jsonb_array_elements_text(request->'categories') category where category=d->>'category')
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
    loop
      if not exists(select 1 from jsonb_array_elements(state->'companies') c cross join lateral jsonb_array_elements(c->'members') member_row where c->>'id'=p_company and member_row->>'id'=member_id) then
        raise exception 'Company owner links changed.' using errcode='PT409'; end if;
    end loop;
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
