-- Recipient capabilities are hash-only. Identity, corrections, and applications live in Vault.
-- All gateway calls recheck the inviter's current authority under the lifecycle lock.
create schema if not exists title_private;
revoke all on schema title_private from public,anon,authenticated;
create table title_private.jv_portal_invites (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.title_workspaces(id),
 company_id text not null, created_by uuid not null references auth.users(id), access_version bigint not null,
 request_id uuid not null, secret_id uuid not null unique references vault.secrets(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), version bigint not null default 1,
 status text not null default 'Draft' check(status in ('Draft','Submitted','Changes requested','Revoked')),
 expires_at timestamptz not null default now()+interval '7 days', created_at timestamptz not null default now(), submitted_at timestamptz,
 baseline_version bigint not null, applied_version bigint, applied_submission_version bigint, needs_merge boolean not null default false,
 session_hash text unique, session_expires_at timestamptz,
 challenge_hash text, challenge_expires_at timestamptz, challenge_attempts integer not null default 0,
 challenge_started_at timestamptz, challenge_window timestamptz, challenge_count integer not null default 0,
 challenge_job uuid, challenge_delivery text,
 delivery_status text not null default 'not_sent' check(delivery_status in ('not_sent','sending','sent','failed','unknown')),
 delivery_job uuid, delivery_at timestamptz, provider_id text,
 notification_status text not null default 'not_sent', notification_job uuid, notification_provider_id text,
 unique(workspace_id,created_by,request_id), check(version between 1 and 9007199254740991)
);
create index jv_portal_company_idx on title_private.jv_portal_invites(workspace_id,company_id);
create index jv_portal_creator_idx on title_private.jv_portal_invites(created_by);
create table title_private.jv_portal_attachments (
 id uuid primary key default gen_random_uuid(), invitation_id uuid not null references title_private.jv_portal_invites(id),
 object_path text not null unique, filename text not null, mime text not null, byte_size bigint not null check(byte_size between 1 and 10485760),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), state text not null default 'pending' check(state in ('pending','ready','removed','cancelled')),
 created_at timestamptz not null default now(), finalized_at timestamptz, document_id text, asset_id text,
 check(mime in ('application/pdf','image/png','image/jpeg','text/plain'))
);
create index jv_portal_attachment_invitation_idx on title_private.jv_portal_attachments(invitation_id);
create table title_private.jv_portal_events (
 id bigint generated always as identity primary key, invitation_id uuid not null references title_private.jv_portal_invites(id),
 actor_id uuid references auth.users(id), actor_kind text not null check(actor_kind in ('staff','recipient','system')),
 action text not null, version bigint not null, created_at timestamptz not null default now()
);
create index jv_portal_events_invitation_idx on title_private.jv_portal_events(invitation_id);
create index jv_portal_events_actor_idx on title_private.jv_portal_events(actor_id);
create table title_private.jv_portal_rates (ip_hash text not null, action text not null, window_start timestamptz not null, count integer not null, primary key(ip_hash,action));
alter table title_private.jv_portal_invites enable row level security;
alter table title_private.jv_portal_attachments enable row level security;
alter table title_private.jv_portal_events enable row level security;
alter table title_private.jv_portal_rates enable row level security;
revoke all on title_private.jv_portal_invites,title_private.jv_portal_attachments,title_private.jv_portal_events,title_private.jv_portal_rates from public,anon,authenticated,service_role;
-- System adoption never impersonates the inviter as the person who typed/uploaded recipient data.
alter table public.title_jv_intakes alter column updated_by drop not null;
alter table public.title_jv_intakes add column recipient_invitation_id uuid references title_private.jv_portal_invites(id);
create index title_jv_intakes_recipient_idx on public.title_jv_intakes(recipient_invitation_id);
alter table public.title_assets alter column uploaded_by drop not null;
alter table public.title_assets add column recipient_invitation_id uuid references title_private.jv_portal_invites(id);
create index title_assets_recipient_idx on public.title_assets(recipient_invitation_id);

create function title_private.jv_portal_blank() returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'applicants','[]'::jsonb,'logoPreferences','','notes','','sourceDocumentIds','[]'::jsonb,'steps',
 (select jsonb_agg(jsonb_build_object('id',id,'status','Not started','assignee','','dueDate','','reference','','note','')) from unnest(array['partnership-agreement','domain','secretary-of-state','federal-tax-id','bank-account','nipr','sc-insurance','nc-insurance','underwriters','softpro','website','email','business-cards','accounting','logo','aba','buyer-title-preference']) id))
$$;
create function title_private.jv_portal_payload_valid(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select p is not null and jsonb_typeof(p)='object' and (p-'applicants'-'logoPreferences'-'notes')='{}'::jsonb
 and public.title_jv_payload_valid(title_private.jv_portal_blank()||p)
$$;
create function title_private.jv_portal_ready(p jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare a jsonb; k text; coverage datemultirange; today date=(now() at time zone 'UTC')::date;
begin
 if not title_private.jv_portal_payload_valid(p) or jsonb_array_length(p->'applicants')<1 then return false; end if;
 for a in select value from jsonb_array_elements(p->'applicants') loop
  foreach k in array array['name','email','phone','dob','ssn','driverLicense','currentAddress'] loop if btrim(a->>k)='' then return false; end if; end loop;
  if a->>'ownershipType' not in ('individual','business') or (a->>'dob')::date>today or length(regexp_replace(a->>'phone','[^0-9]','','g'))<7 then return false; end if;
  if a->>'ownershipType'='business' and (btrim(a->>'businessName')='' or a->>'businessStatus'<>'existing' or btrim(a->>'businessReference')='') then return false; end if;
  foreach k in array array['residenceHistory','employmentHistory'] loop
   if exists(select 1 from jsonb_array_elements(a->k) h where btrim(h->>case when k='residenceHistory' then 'address' else 'employer' end)='' or h->>'from'='') then return false; end if;
   select range_agg(daterange((h->>'from')::date,coalesce(nullif(h->>'to','')::date,today)+1,'[)')) into coverage from jsonb_array_elements(a->k) h;
   if coverage is null or not coverage @> daterange((today-interval '5 years')::date,today+1,'[)') then return false; end if;
  end loop;
 end loop; return true;
exception when others then return false;
end $$;
create function title_private.jv_portal_authority(w uuid,actor uuid,access_version bigint,company text) returns jsonb language plpgsql set search_path='' as $$
declare m public.title_memberships%rowtype; s jsonb;
begin
 perform pg_advisory_xact_lock(19492271,hashtext(w::text));
 select * into m from public.title_memberships where workspace_id=w and user_id=actor for share;
 if not found or not m.active or m.version is distinct from access_version or m.role not in ('owner','admin','onboarding') or not m.restricted_access or not(m.all_companies or company=any(m.company_ids)) then raise exception 'Application access unavailable.' using errcode='42501'; end if;
 select state into s from public.title_workspaces where id=w for update;
 if not found or not exists(select 1 from jsonb_array_elements(coalesce(s->'companies','[]')) c where c->>'id'=company) then raise exception 'Application access unavailable.' using errcode='42501'; end if;
 return s;
end $$;
create function title_private.jv_portal_secret(r title_private.jv_portal_invites) returns jsonb language plpgsql set search_path='' as $$
declare data jsonb;
begin
 select decrypted_secret::jsonb into data from vault.decrypted_secrets where id=r.secret_id;
 if data is null or not title_private.jv_portal_payload_valid(data->'payload') or jsonb_typeof(data->'email') is distinct from 'string' or jsonb_typeof(data->'recipientName') is distinct from 'string' or jsonb_typeof(data->'correctionNote') is distinct from 'string' then raise exception 'Application unavailable.' using errcode='PT503'; end if;
 return data;
end $$;
create function title_private.jv_portal_attachments(r title_private.jv_portal_invites) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.filename,'mime',a.mime,'bytes',a.byte_size,'sha256',a.sha256) order by a.created_at,a.id),'[]') from title_private.jv_portal_attachments a where a.invitation_id=r.id and a.state='ready'
$$;
create function title_private.jv_portal_staff_record(r title_private.jv_portal_invites,d jsonb) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'recipientName',d->>'recipientName','email',d->>'email','status',case when r.status='Revoked' then 'Revoked' when r.status='Submitted' then 'Submitted' when r.expires_at<=now() then 'Expired' else r.status end,'version',r.version,'expiresAt',r.expires_at,'submittedAt',r.submitted_at,'deliveryStatus',case when r.delivery_status='sending' and r.delivery_at<now()-interval '2 minutes' then 'unknown' else r.delivery_status end,'appliedVersion',r.applied_version,'needsMerge',r.needs_merge,'notificationStatus',case when r.notification_status='sending' and r.submitted_at<now()-interval '2 minutes' then 'unknown' else r.notification_status end)
$$;
create function title_private.jv_portal_public_record(r title_private.jv_portal_invites,d jsonb,s jsonb) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'companyName',(select c->>'name' from jsonb_array_elements(s->'companies') c where c->>'id'=r.company_id),'recipientName',d->>'recipientName','status',r.status,'version',r.version,'expiresAt',r.expires_at,'submittedAt',r.submitted_at,'correctionNote',d->>'correctionNote','payload',d->'payload','attachments',title_private.jv_portal_attachments(r))
$$;

-- Called only after authority and invitation locks. Asset registration, workspace originals,
-- encrypted intake mutation, source-manifest capture and receipt all commit atomically.
create function title_private.jv_portal_apply(r title_private.jv_portal_invites,actor uuid,expected bigint,automatic boolean) returns title_private.jv_portal_invites language plpgsql set search_path='' as $$
declare existing public.title_jv_intakes%rowtype; d jsonb; p jsonb; old jsonb; envelope jsonb; s jsonb; a title_private.jv_portal_attachments%rowtype;
 docs jsonb; sources jsonb; secret uuid; stamp timestamptz=clock_timestamp(); next_status text;
begin
 if r.status<>'Submitted' then raise exception 'Application changed.' using errcode='PT409'; end if;
 if r.applied_submission_version=r.version then return r; end if;
 select * into existing from public.title_jv_intakes where workspace_id=r.workspace_id and company_id=r.company_id for update;
 if coalesce(existing.version,0)<>expected or automatic and (coalesce(existing.version,0)<>r.baseline_version or coalesce(existing.status,'Draft')<>'Draft') then
  if automatic then update title_private.jv_portal_invites set needs_merge=true where id=r.id returning * into r;return r; end if;
  raise exception 'Application changed.' using errcode='PT409';
 end if;
 d=title_private.jv_portal_secret(r);
 if not title_private.jv_portal_ready(d->'payload') then raise exception 'Invalid application request.' using errcode='22023'; end if;
 old=title_private.jv_portal_blank();
 if existing.secret_id is not null then
  select decrypted_secret::jsonb into old from vault.decrypted_secrets where id=existing.secret_id;
  envelope=old; old=old->'payload'; if not public.title_jv_payload_valid(old) then raise exception 'Application unavailable.' using errcode='PT503'; end if;
 end if;
 select state into s from public.title_workspaces where id=r.workspace_id for update;
 -- A recipient may fill a pristine draft, but cannot silently replace another applicant
 -- or approve a changed inherited original. Preserve all internal steps and original IDs.
 if automatic and existing.secret_id is not null and (
   btrim(old->>'logoPreferences')<>'' or btrim(old->>'notes')<>'' or
   exists(select 1 from jsonb_array_elements(old->'applicants') person where
     (person-'id'-'ownershipType'-'businessStatus'-'residenceHistory'-'employmentHistory') is distinct from
       '{"name":"","email":"","phone":"","dob":"","ssn":"","driverLicense":"","currentAddress":"","businessName":"","businessReference":""}'::jsonb
     or person->>'ownershipType'<>'undecided' or person->>'businessStatus'<>'not-applicable'
     or person->'residenceHistory'<>'[]'::jsonb or person->'employmentHistory'<>'[]'::jsonb) or
   public.title_jv_sources(r.workspace_id,s,r.company_id,old) is distinct from envelope->'sourceManifest') then
  update title_private.jv_portal_invites set needs_merge=true where id=r.id returning * into r;return r;
 end if;
 p=old||(d->'payload');
 docs=coalesce(s->'documents','[]'); sources=p->'sourceDocumentIds';
 for a in select * from title_private.jv_portal_attachments where invitation_id=r.id and state='ready' order by created_at,id for update loop
  if a.document_id is null then
   a.document_id='JV-DOC-'||replace(a.id::text,'-',''); a.asset_id='JV-ASSET-'||replace(a.id::text,'-','');
   insert into public.title_assets(workspace_id,id,company_id,document_id,object_path,mime,filename,byte_size,sha256,uploaded_by,recipient_invitation_id)
    values(r.workspace_id,a.asset_id,r.company_id,a.document_id,a.object_path,a.mime,a.filename,a.byte_size,a.sha256,null,r.id);
   docs=docs||jsonb_build_array(jsonb_build_object('id',a.document_id,'companyId',r.company_id,'name',a.filename,'category','Applications','visibility','Restricted','date',to_char(stamp at time zone 'UTC','YYYY-MM-DD'),'size',a.byte_size::text||' bytes','version',1,'assetId',a.asset_id,'mime',a.mime));
   update title_private.jv_portal_attachments set document_id=a.document_id,asset_id=a.asset_id where id=a.id;
  elsif not exists(select 1 from jsonb_array_elements(docs) x where x->>'id'=a.document_id and x->>'companyId'=r.company_id and x->>'visibility'='Restricted' and x->>'category'='Applications' and x->>'assetId'=a.asset_id) then
   raise exception 'Application source unavailable.' using errcode='42501';
  end if;
  if not sources @> jsonb_build_array(a.document_id) then sources=sources||jsonb_build_array(a.document_id); end if;
 end loop;
 p=jsonb_set(p,'{sourceDocumentIds}',sources); s=jsonb_set(s,'{documents}',docs);
 if not public.title_jv_payload_valid(p) then raise exception 'Invalid application request.' using errcode='22023'; end if;
 sources=public.title_jv_sources(r.workspace_id,s,r.company_id,p);
 if exists(select 1 from jsonb_array_elements(sources) x where x->'unavailable'='true') then
  raise exception 'Application source unavailable.' using errcode='42501'; end if;
 d=jsonb_build_object('payload',p,'reviewNote','','sourceManifest',sources,'sourceChanged',false);
 next_status='Ready for review';
 if existing.secret_id is null then
  secret=vault.create_secret(d::text,'title:jv:'||r.workspace_id::text||':'||r.company_id,'Private JV application');
  insert into public.title_jv_intakes(workspace_id,company_id,version,status,secret_id,updated_at,updated_by,recipient_invitation_id)
   values(r.workspace_id,r.company_id,1,next_status,secret,stamp,actor,r.id) returning * into existing;
 else
  perform vault.update_secret(existing.secret_id,d::text);
  update public.title_jv_intakes set version=version+1,status=next_status,updated_at=stamp,updated_by=actor,reviewed_at=null,reviewed_by=null,recipient_invitation_id=r.id
   where workspace_id=r.workspace_id and company_id=r.company_id returning * into existing;
 end if;
 update public.title_workspaces set state=s,revision=revision+1,updated_at=stamp where id=r.workspace_id;
 update title_private.jv_portal_invites set applied_version=existing.version,applied_submission_version=r.version,needs_merge=false where id=r.id returning * into r;
 insert into title_private.jv_portal_events(invitation_id,actor_id,actor_kind,action,version) values(r.id,actor,case when actor is null then 'system' else 'staff' end,'apply',r.version);
 return r;
end $$;

create function public.title_jv_portal_staff(p_workspace uuid,p_actor uuid,p_access_version bigint,p_company text,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r title_private.jv_portal_invites%rowtype; d jsonb; s jsonb; result jsonb; a title_private.jv_portal_attachments%rowtype; secret uuid; baseline bigint; stamp timestamptz=clock_timestamp(); job jsonb; company_name text;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>131072 or p_company is null or p_company !~ '^[-A-Za-z0-9_ .:@]{1,180}$' or p_action is null or p_action not in ('list','create','send','revoke','request-changes','load-submission','download-attachment','apply','delivery-result') then raise exception 'Invalid application request.' using errcode='22023'; end if;
 s=title_private.jv_portal_authority(p_workspace,p_actor,p_access_version,p_company);
 select c->>'name' into company_name from jsonb_array_elements(s->'companies') c where c->>'id'=p_company;
 if p_action='list' then
  if p_input<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(title_private.jv_portal_staff_record(i,title_private.jv_portal_secret(i)) order by i.created_at desc),'[]') into result from title_private.jv_portal_invites i where workspace_id=p_workspace and company_id=p_company;
  return jsonb_build_object('requests',result);
 elsif p_action='create' then
  if (p_input-'recipientName'-'email'-'requestId'-'tokenHash')<>'{}'::jsonb or jsonb_typeof(p_input->'recipientName') is distinct from 'string' or length(btrim(p_input->>'recipientName')) not between 1 and 200 or jsonb_typeof(p_input->'email') is distinct from 'string' or length(p_input->>'email')>254 or p_input->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_input->>'tokenHash' is null or p_input->>'tokenHash' !~ '^[a-f0-9]{64}$' or p_input->>'requestId' is null then raise exception 'Invalid application request.' using errcode='22023'; end if;
  select * into r from title_private.jv_portal_invites where workspace_id=p_workspace and created_by=p_actor and request_id=(p_input->>'requestId')::uuid for update;
  if found then
   d=title_private.jv_portal_secret(r);
   if r.company_id<>p_company or d->>'email'<>lower(btrim(p_input->>'email')) or d->>'recipientName'<>btrim(p_input->>'recipientName') then raise exception 'Application changed.' using errcode='PT409'; end if;
   return jsonb_build_object('request',title_private.jv_portal_staff_record(r,d),'tokenIssued',false);
  end if;
  if (select count(*) from title_private.jv_portal_invites where workspace_id=p_workspace and company_id=p_company and status<>'Revoked' and expires_at>stamp)>=10 then raise exception 'Application limit reached.' using errcode='PT429'; end if;
  select version into baseline from public.title_jv_intakes where workspace_id=p_workspace and company_id=p_company;
  d=jsonb_build_object('recipientName',btrim(p_input->>'recipientName'),'email',lower(btrim(p_input->>'email')),'correctionNote','','payload',title_private.jv_portal_blank()-'schemaVersion'-'steps'-'sourceDocumentIds');
  secret=vault.create_secret(d::text,null,'Private recipient JV application');
  insert into title_private.jv_portal_invites(workspace_id,company_id,created_by,access_version,request_id,secret_id,token_hash,baseline_version)
   values(p_workspace,p_company,p_actor,p_access_version,(p_input->>'requestId')::uuid,secret,p_input->>'tokenHash',coalesce(baseline,0)) returning * into r;
  insert into title_private.jv_portal_events(invitation_id,actor_id,actor_kind,action,version) values(r.id,p_actor,'staff','create',r.version);
  return jsonb_build_object('request',title_private.jv_portal_staff_record(r,d),'tokenIssued',true);
 end if;
 select * into r from title_private.jv_portal_invites where id=(p_input->>'id')::uuid and workspace_id=p_workspace and company_id=p_company for update;
 if not found then raise exception 'Application access unavailable.' using errcode='42501'; end if;
 d=title_private.jv_portal_secret(r);
 if p_action='download-attachment' then
  if (p_input-'id'-'attachmentId')<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  select * into a from title_private.jv_portal_attachments where id=(p_input->>'attachmentId')::uuid and invitation_id=r.id and state='ready';
  if not found then raise exception 'Application access unavailable.' using errcode='42501'; end if;
  insert into title_private.jv_portal_events(invitation_id,actor_id,actor_kind,action,version) values(r.id,p_actor,'staff',p_action,r.version);
  return jsonb_build_object('objectPath',a.object_path,'attachment',jsonb_build_object('id',a.id,'name',a.filename,'mime',a.mime,'bytes',a.byte_size,'sha256',a.sha256));
 elsif p_action='load-submission' then
  if (p_input-'id')<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  insert into title_private.jv_portal_events(invitation_id,actor_id,actor_kind,action,version) values(r.id,p_actor,'staff',p_action,r.version);
  return jsonb_build_object('request',title_private.jv_portal_staff_record(r,d),'payload',d->'payload','attachments',title_private.jv_portal_attachments(r));
 elsif p_action='delivery-result' then
  if (p_input-'id'-'jobId'-'status'-'providerId')<>'{}'::jsonb or p_input->>'status' is null or p_input->>'status' not in ('sent','failed','unknown') or coalesce(length(p_input->>'providerId'),0)>200 then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if r.delivery_job is distinct from (p_input->>'jobId')::uuid then raise exception 'Application changed.' using errcode='PT409'; end if;
  if r.delivery_status='sending' then update title_private.jv_portal_invites set delivery_status=p_input->>'status',provider_id=p_input->>'providerId' where id=r.id returning * into r; end if;
  return jsonb_build_object('request',title_private.jv_portal_staff_record(r,d));
 end if;
 if p_input->>'expectedVersion' is null or p_input->>'expectedVersion' !~ '^[0-9]{1,16}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
 if r.version<>(p_input->>'expectedVersion')::bigint then raise exception 'Application changed.' using errcode='PT409'; end if;
 if r.status='Revoked' or (r.expires_at<=stamp and not (r.status='Submitted' and p_action in ('apply','request-changes','revoke'))) then raise exception 'Application access unavailable.' using errcode='42501'; end if;
 if p_action='revoke' then
  if (p_input-'id'-'expectedVersion')<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  update title_private.jv_portal_invites set status='Revoked',version=version+1,session_hash=null,session_expires_at=null,challenge_hash=null,challenge_expires_at=null where id=r.id returning * into r;
 elsif p_action='request-changes' then
  if (p_input-'id'-'expectedVersion'-'note'-'tokenHash')<>'{}'::jsonb or jsonb_typeof(p_input->'note') is distinct from 'string' or length(btrim(p_input->>'note')) not between 1 and 2000 or p_input->>'tokenHash' is null or p_input->>'tokenHash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if r.status<>'Submitted' then raise exception 'Application changed.' using errcode='PT409'; end if;
  d=jsonb_set(d,'{correctionNote}',to_jsonb(btrim(p_input->>'note'))); perform vault.update_secret(r.secret_id,d::text);
  update title_private.jv_portal_invites set status='Changes requested',version=version+1,token_hash=p_input->>'tokenHash',session_hash=null,session_expires_at=null,challenge_hash=null,challenge_expires_at=null,expires_at=stamp+interval '7 days',delivery_status='not_sent',delivery_job=null,provider_id=null,notification_status='not_sent',notification_job=null where id=r.id returning * into r;
 elsif p_action='send' then
  if (p_input-'id'-'expectedVersion'-'tokenHash')<>'{}'::jsonb or p_input->>'tokenHash' is null or p_input->>'tokenHash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if r.status not in ('Draft','Changes requested') then raise exception 'Application changed.' using errcode='PT409'; end if;
  if r.delivery_status in ('sending','sent','unknown') then
   if r.delivery_status='sending' and r.delivery_at<stamp-interval '2 minutes' then update title_private.jv_portal_invites set delivery_status='unknown' where id=r.id returning * into r; end if;
   return jsonb_build_object('request',title_private.jv_portal_staff_record(r,d));
  end if;
  update title_private.jv_portal_invites set token_hash=p_input->>'tokenHash',version=version+1,session_hash=null,session_expires_at=null,challenge_hash=null,challenge_expires_at=null,delivery_status='sending',delivery_job=gen_random_uuid(),delivery_at=stamp where id=r.id returning * into r;
  job=jsonb_build_object('jobId',r.delivery_job,'to',d->>'email','recipientName',d->>'recipientName','companyName',company_name);
 elsif p_action='apply' then
  if (p_input-'id'-'expectedVersion'-'expectedApplicationVersion')<>'{}'::jsonb or p_input->>'expectedApplicationVersion' is null or p_input->>'expectedApplicationVersion' !~ '^[0-9]{1,16}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  r=title_private.jv_portal_apply(r,p_actor,(p_input->>'expectedApplicationVersion')::bigint,false);
 end if;
 insert into title_private.jv_portal_events(invitation_id,actor_id,actor_kind,action,version) values(r.id,p_actor,'staff',p_action,r.version);
 return jsonb_build_object('request',title_private.jv_portal_staff_record(r,d),'job',job,'tokenIssued',p_action='request-changes');
exception
 when sqlstate '42501' then raise exception 'Application access unavailable.' using errcode='42501';
 when sqlstate 'PT409' then raise exception 'Application changed.' using errcode='PT409';
 when sqlstate 'PT429' then raise exception 'Application limit reached.' using errcode='PT429';
 when sqlstate '22023' or invalid_text_representation then raise exception 'Invalid application request.' using errcode='22023';
 when others then raise exception 'Application unavailable.' using errcode='PT503';
end $$;

create function public.title_jv_portal_public(p_action text,p_credential text,p_ip_hash text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r title_private.jv_portal_invites%rowtype; d jsonb; s jsonb; a title_private.jv_portal_attachments%rowtype; stamp timestamptz=clock_timestamp();
 tally integer; category text; job jsonb; company_name text; target uuid; source_id uuid; notification_email text; same_submit boolean=false;
begin
 if p_action is null or p_action not in ('start','verify','load','save','submit','reserve-attachment','finalize-attachment','cancel-attachment','download','remove-attachment','challenge-result','notification-result') or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>131072 or p_credential is null or p_credential !~ '^[a-f0-9]{64}$' or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
 category=case when p_action='start' then 'start' when p_action='verify' then 'verify' else 'session' end;
 insert into title_private.jv_portal_rates(ip_hash,action,window_start,count) values(p_ip_hash,category,stamp,1)
 on conflict(ip_hash,action) do update set count=case when jv_portal_rates.window_start<stamp-interval '1 hour' then 1 else jv_portal_rates.count+1 end,window_start=case when jv_portal_rates.window_start<stamp-interval '1 hour' then stamp else jv_portal_rates.window_start end returning count into tally;
 if tally>(case when category='start' then 60 when category='verify' then 100 else 1200 end) then return jsonb_build_object('errorCode','rate_limit'); end if;
 begin
 -- Unlocked routing only, followed by authority and row lock and a second credential comparison.
 select * into r from title_private.jv_portal_invites where case when p_action in ('start','verify','challenge-result') then token_hash=p_credential else session_hash=p_credential end;
 if not found then return case when p_action='start' then '{}'::jsonb else jsonb_build_object('errorCode','forbidden') end; end if;
 begin s=title_private.jv_portal_authority(r.workspace_id,r.created_by,r.access_version,r.company_id);
 exception when sqlstate '42501' then return case when p_action='start' then '{}'::jsonb else jsonb_build_object('errorCode','forbidden') end; end;
 target=r.id;
 select * into r from title_private.jv_portal_invites where id=target for update;
 stamp=clock_timestamp();
 if r.status='Revoked' or r.expires_at<=stamp or
  (p_action in ('start','verify','challenge-result') and r.token_hash is distinct from p_credential) or
  (p_action not in ('start','verify','challenge-result') and (r.session_hash is distinct from p_credential or r.session_expires_at<=stamp or r.session_expires_at is null)) then
  return case when p_action='start' then '{}'::jsonb else jsonb_build_object('errorCode','forbidden') end;
 end if;
 d=title_private.jv_portal_secret(r);
 select c->>'name' into company_name from jsonb_array_elements(s->'companies') c where c->>'id'=r.company_id;
 if p_action='start' then
  if (p_input-'codeHash')<>'{}'::jsonb or p_input->>'codeHash' is null or p_input->>'codeHash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if r.challenge_started_at>stamp-interval '60 seconds' or (r.challenge_window>stamp-interval '1 hour' and r.challenge_count>=5) then return '{}'::jsonb; end if;
  update title_private.jv_portal_invites set challenge_hash=p_input->>'codeHash',challenge_expires_at=least(expires_at,stamp+interval '10 minutes'),challenge_attempts=0,challenge_started_at=stamp,
   challenge_count=case when challenge_window>stamp-interval '1 hour' then challenge_count+1 else 1 end,
   challenge_window=case when challenge_window>stamp-interval '1 hour' then challenge_window else stamp end,challenge_job=gen_random_uuid(),challenge_delivery='sending'
   where id=r.id returning * into r;
  return jsonb_build_object('job',jsonb_build_object('jobId',r.challenge_job,'to',d->>'email','recipientName',d->>'recipientName','companyName',company_name));
 elsif p_action='challenge-result' or p_action='notification-result' then
  if (p_input-'jobId'-'status'-'providerId')<>'{}'::jsonb or p_input->>'status' is null or p_input->>'status' not in ('sent','failed','unknown') or coalesce(length(p_input->>'providerId'),0)>200 then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if p_action='challenge-result' then
   if r.challenge_job is distinct from (p_input->>'jobId')::uuid then raise exception 'Application changed.' using errcode='PT409'; end if;
   if r.challenge_delivery='sending' then update title_private.jv_portal_invites set challenge_delivery=p_input->>'status',challenge_hash=case when p_input->>'status'='failed' then null else challenge_hash end where id=r.id; end if;
  else
   if r.notification_job is distinct from (p_input->>'jobId')::uuid then raise exception 'Application changed.' using errcode='PT409'; end if;
   if r.notification_status='sending' then update title_private.jv_portal_invites set notification_status=p_input->>'status',notification_provider_id=p_input->>'providerId' where id=r.id; end if;
  end if;
  return '{}'::jsonb;
 elsif p_action='verify' then
  if (p_input-'codeHash'-'sessionHash')<>'{}'::jsonb or p_input->>'codeHash' is null or p_input->>'codeHash' !~ '^[a-f0-9]{64}$' or p_input->>'sessionHash' is null or p_input->>'sessionHash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if r.challenge_hash is null or r.challenge_expires_at<=stamp or r.challenge_attempts>=5 or r.challenge_delivery not in ('sent','unknown') then return jsonb_build_object('errorCode','forbidden'); end if;
  -- Return, do not raise: failed-attempt counters must commit.
  update title_private.jv_portal_invites set challenge_attempts=challenge_attempts+1 where id=r.id returning * into r;
  if r.challenge_hash<>p_input->>'codeHash' then return jsonb_build_object('errorCode','challenge_failed'); end if;
  update title_private.jv_portal_invites set session_hash=p_input->>'sessionHash',session_expires_at=least(expires_at,stamp+interval '1 hour'),challenge_hash=null,challenge_expires_at=null where id=r.id returning * into r;
  insert into title_private.jv_portal_events(invitation_id,actor_kind,action,version) values(r.id,'recipient','verify',r.version);
  return jsonb_build_object('expiresAt',r.session_expires_at,'application',title_private.jv_portal_public_record(r,d,s));
 elsif p_action='load' then
  if p_input<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  insert into title_private.jv_portal_events(invitation_id,actor_kind,action,version) values(r.id,'recipient','load',r.version);
  return jsonb_build_object('application',title_private.jv_portal_public_record(r,d,s));
 elsif p_action='download' then
  if (p_input-'attachmentId')<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  select * into a from title_private.jv_portal_attachments where id=(p_input->>'attachmentId')::uuid and invitation_id=r.id and state='ready';
  if not found then raise exception 'Application access unavailable.' using errcode='42501'; end if;
  insert into title_private.jv_portal_events(invitation_id,actor_kind,action,version) values(r.id,'recipient','download',r.version);
  return jsonb_build_object('objectPath',a.object_path,'attachment',jsonb_build_object('id',a.id,'name',a.filename,'mime',a.mime,'bytes',a.byte_size,'sha256',a.sha256));
 end if;
 if p_action in ('save','submit') then
  if (p_input-'expectedVersion'-'payload')<>'{}'::jsonb or not title_private.jv_portal_payload_valid(p_input->'payload') or p_input->>'expectedVersion' is null or p_input->>'expectedVersion' !~ '^[0-9]{1,16}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  same_submit=p_action='submit' and r.status='Submitted' and r.version-1=(p_input->>'expectedVersion')::bigint and d->'payload'=p_input->'payload';
  if same_submit then
   -- Retry an interrupted submission delivery with the same provider idempotency key.
   -- Never recreate the application or register its originals twice.
   if r.notification_status in ('sending','unknown','failed') and r.notification_job is not null and r.submitted_at>stamp-interval '23 hours' then
    select email into notification_email from auth.users where id=r.created_by;
    if notification_email is not null then job=jsonb_build_object('jobId',r.notification_job,'to',notification_email,'recipientName',d->>'recipientName','companyName',company_name); end if;
    update title_private.jv_portal_invites set notification_status='sending' where id=r.id returning * into r;
   end if;
   return jsonb_build_object('application',title_private.jv_portal_public_record(r,d,s),'notificationJob',job);
  end if;
 end if;
 if r.status not in ('Draft','Changes requested') then raise exception 'Application changed.' using errcode='PT409'; end if;
 if p_action in ('save','submit','remove-attachment') and (p_input->>'expectedVersion' is null or p_input->>'expectedVersion' !~ '^[0-9]{1,16}$' or r.version<>(p_input->>'expectedVersion')::bigint) then raise exception 'Application changed.' using errcode='PT409'; end if;
 if p_action in ('save','submit') then
  if p_action='submit' and not title_private.jv_portal_ready(p_input->'payload') then raise exception 'Invalid application request.' using errcode='22023'; end if;
  if p_action='submit' and exists(select 1 from title_private.jv_portal_attachments where invitation_id=r.id and state='pending' and created_at>stamp-interval '15 minutes') then raise exception 'Application changed.' using errcode='PT409'; end if;
  d=jsonb_set(d,'{payload}',p_input->'payload'); perform vault.update_secret(r.secret_id,d::text);
  update title_private.jv_portal_invites set version=version+1,status=case when p_action='submit' then 'Submitted' else status end,submitted_at=case when p_action='submit' then stamp else submitted_at end where id=r.id returning * into r;
  if p_action='submit' then
   r=title_private.jv_portal_apply(r,null,r.baseline_version,true);
   select email into notification_email from auth.users where id=r.created_by;
   update title_private.jv_portal_invites set notification_job=gen_random_uuid(),notification_status=case when notification_email is null then 'failed' else 'sending' end where id=r.id returning * into r;
   if notification_email is not null then job=jsonb_build_object('jobId',r.notification_job,'to',notification_email,'recipientName',d->>'recipientName','companyName',company_name); end if;
  end if;
 elsif p_action='reserve-attachment' then
  if (p_input-'name'-'mime'-'bytes'-'sha256')<>'{}'::jsonb or jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 1 and 200 or p_input->>'name' ~ '[[:cntrl:]/\\]' or p_input->>'mime' is null or p_input->>'mime' not in ('application/pdf','image/png','image/jpeg','text/plain') or p_input->>'bytes' is null or p_input->>'bytes' !~ '^[0-9]{1,8}$' or (p_input->>'bytes')::bigint not between 1 and 10485760 or p_input->>'sha256' is null or p_input->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid application request.' using errcode='22023'; end if;
  update title_private.jv_portal_attachments set state='cancelled' where invitation_id=r.id and state='pending' and created_at<=stamp-interval '15 minutes';
  if (select count(*) from title_private.jv_portal_attachments where invitation_id=r.id and state in ('pending','ready'))>=10 or (select coalesce(sum(kept.byte_size),0) from title_private.jv_portal_attachments kept where kept.invitation_id=r.id and (kept.state in ('pending','ready','removed') or exists(select 1 from storage.objects object where object.bucket_id='title-documents' and object.name=kept.object_path)))+(p_input->>'bytes')::bigint>41943040 then raise exception 'Application attachment limit reached.' using errcode='22023'; end if;
  source_id=gen_random_uuid();
  insert into title_private.jv_portal_attachments(id,invitation_id,object_path,filename,mime,byte_size,sha256)
   values(source_id,r.id,'jv-recipient/'||r.id::text||'/'||source_id::text,btrim(p_input->>'name'),p_input->>'mime',(p_input->>'bytes')::bigint,p_input->>'sha256') returning * into a;
  return jsonb_build_object('id',a.id,'objectPath',a.object_path);
 elsif p_action in ('finalize-attachment','cancel-attachment','remove-attachment') then
  if (p_input-'attachmentId'-case when p_action='remove-attachment' then 'expectedVersion' else 'attachmentId' end)<>'{}'::jsonb then raise exception 'Invalid application request.' using errcode='22023'; end if;
  select * into a from title_private.jv_portal_attachments where id=(p_input->>'attachmentId')::uuid and invitation_id=r.id for update;
  if not found then raise exception 'Application access unavailable.' using errcode='42501'; end if;
  if p_action='finalize-attachment' then
   if a.state='ready' then return jsonb_build_object('application',title_private.jv_portal_public_record(r,d,s)); end if;
   if a.state<>'pending' or a.created_at<=stamp-interval '15 minutes' then raise exception 'Application changed.' using errcode='PT409'; end if;
   if not exists(select 1 from storage.objects where bucket_id='title-documents' and name=a.object_path and (metadata->>'size')::bigint=a.byte_size) then raise exception 'Application unavailable.' using errcode='PT503'; end if;
   update title_private.jv_portal_attachments set state='ready',finalized_at=stamp where id=a.id;
   update title_private.jv_portal_invites set version=version+1 where id=r.id returning * into r;
  elsif p_action='cancel-attachment' then
   update title_private.jv_portal_attachments set state='cancelled' where id=a.id and state='pending';
  else
   if a.state<>'ready' then raise exception 'Application changed.' using errcode='PT409'; end if;
   update title_private.jv_portal_attachments set state='removed' where id=a.id;
   update title_private.jv_portal_invites set version=version+1 where id=r.id returning * into r;
  end if;
 end if;
 insert into title_private.jv_portal_events(invitation_id,actor_kind,action,version) values(r.id,'recipient',p_action,r.version);
 return jsonb_build_object('application',title_private.jv_portal_public_record(r,d,s),'notificationJob',job);
exception
 when sqlstate '42501' then return jsonb_build_object('errorCode','forbidden');
 when sqlstate 'PT409' then return jsonb_build_object('errorCode','conflict');
 when sqlstate '22023' or invalid_text_representation then return jsonb_build_object('errorCode','invalid');
 when others then return jsonb_build_object('errorCode','unavailable');
 end;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='title_private' and p.proname like 'jv_portal_%' loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
revoke all on function public.title_jv_portal_staff(uuid,uuid,bigint,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.title_jv_portal_public(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.title_jv_portal_staff(uuid,uuid,bigint,text,text,jsonb) to service_role;
grant execute on function public.title_jv_portal_public(text,text,text,jsonb) to service_role;
