-- Private JV applications and review notes are encrypted together in Vault.
-- Only server-derived status/version/actor metadata exists outside the secret.
create table public.title_jv_intakes (
  workspace_id uuid not null references public.title_workspaces(id),
  company_id text not null check(company_id ~ '^[-A-Za-z0-9_ .:@]{1,180}$'),
  version bigint not null check(version between 1 and 9007199254740991),
  status text not null check(status in ('Draft','Ready for review','Reviewed')),
  secret_id uuid not null unique references vault.secrets(id),
  updated_at timestamptz not null,
  updated_by uuid not null references auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  primary key(workspace_id,company_id),
  check((status='Reviewed')=(reviewed_at is not null) and (reviewed_at is null)=(reviewed_by is null))
);
create index title_jv_intakes_updated_by_idx on public.title_jv_intakes(updated_by);
create index title_jv_intakes_reviewed_by_idx on public.title_jv_intakes(reviewed_by);
alter table public.title_jv_intakes enable row level security;
revoke all on public.title_jv_intakes from public,anon,authenticated,service_role;

-- The gateway applies detailed date, identity, history and readiness validation.
-- This internal boundary independently enforces a bounded, allowlisted schema.
create function public.title_jv_payload_valid(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb; h jsonb; s jsonb; k text; ids text[]; n integer;
  step_ids constant text[]=array['partnership-agreement','domain','secretary-of-state','federal-tax-id','bank-account','nipr','sc-insurance','nc-insurance','underwriters','softpro','website','email','business-cards','accounting','logo','aba','buyer-title-preference'];
begin
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

-- Internal resolver; caller already holds current workspace and lifecycle locks.
-- Missing/reclassified originals produce an explicit unavailable marker on load.
create function public.title_jv_sources(p_workspace uuid,p_state jsonb,p_company text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare doc_id text; doc jsonb; asset public.title_assets%rowtype; manifest jsonb='[]'::jsonb;
begin
  for doc_id in select value from jsonb_array_elements_text(p_payload->'sourceDocumentIds') loop
    select d into doc from jsonb_array_elements(coalesce(p_state->'documents','[]'::jsonb)) d
      where d->>'id'=doc_id and d->>'companyId'=p_company and coalesce(d->>'orderId','')=''
        and d->>'visibility'='Restricted' and d->>'category'='Applications';
    if not found then manifest=manifest||jsonb_build_array(jsonb_build_object('documentId',doc_id,'unavailable',true)); continue; end if;
    select * into asset from public.title_assets a where a.workspace_id=p_workspace and a.id=doc->>'assetId'
      and a.company_id=p_company and a.document_id=doc_id for share;
    if not found then manifest=manifest||jsonb_build_array(jsonb_build_object('documentId',doc_id,'unavailable',true)); continue; end if;
    manifest=manifest||jsonb_build_array(jsonb_build_object('documentId',doc_id,'assetId',asset.id,'version',doc->'version','sha256',asset.sha256,'bytes',asset.byte_size));
  end loop;
  return manifest;
end $$;
revoke all on function public.title_jv_sources(uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;

create function public.title_jv_intake(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_company text,p_action text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  m public.title_memberships%rowtype; r public.title_jv_intakes%rowtype; state jsonb;
  decrypted text; private_data jsonb; previous_payload jsonb; next_payload jsonb; next_status text; next_note text;
  expected bigint; secret uuid; stamp timestamptz=clock_timestamp(); changed boolean;
  current_sources jsonb; expected_sources jsonb; sources_changed boolean=false;
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
