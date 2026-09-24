-- The operator activates enforcement only after a hosted scanner has been tested.
-- Browser/service roles cannot change this policy. Pending setup is never called clean.
create table title_private.document_scan_policy(singleton boolean primary key default true check(singleton), mode text not null check(mode in ('pending_setup','required')), activated_at timestamptz);
insert into title_private.document_scan_policy(singleton,mode) values(true,'pending_setup');
create table title_private.document_scan_receipts(
 object_path text primary key, workspace_id uuid not null references public.title_workspaces(id), company_id text not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), byte_size bigint not null check(byte_size between 0 and 52428800),
 status text not null check(status in ('clean','pending_setup','legacy_unscanned')),
 receipt jsonb, created_at timestamptz not null default clock_timestamp(),
 check((status='clean')=(receipt is not null))
);
create index document_scan_workspace_idx on title_private.document_scan_receipts(workspace_id,status);
alter table title_private.document_scan_policy enable row level security;
alter table title_private.document_scan_receipts enable row level security;
revoke all on title_private.document_scan_policy,title_private.document_scan_receipts from public,anon,authenticated,service_role;
insert into title_private.document_scan_receipts(object_path,workspace_id,company_id,sha256,byte_size,status)
 select object_path,workspace_id,company_id,sha256,byte_size,'legacy_unscanned' from public.title_assets;
insert into title_private.document_scan_receipts(object_path,workspace_id,company_id,sha256,byte_size,status)
 select a.object_path,i.workspace_id,i.company_id,a.sha256,a.byte_size,'legacy_unscanned' from title_private.jv_portal_attachments a join title_private.jv_portal_invites i on i.id=a.invitation_id where a.state='ready'
 on conflict(object_path) do nothing;

create function title_private.title_prepare_document_ingestion(p_path text,p_workspace uuid,p_company text,p_sha text,p_bytes bigint) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare w uuid=p_workspace; c text=p_company; mode text;
begin
 if auth.uid() is not null then raise exception 'Service ingestion required.' using errcode='42501'; end if;
 if p_sha is null or p_sha !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 1 and 52428800 or p_path is null or length(p_path)>400 then raise exception 'Invalid document scan target.' using errcode='22023'; end if;
 if w is null and c is null then
  select i.workspace_id,i.company_id into w,c from title_private.jv_portal_attachments a join title_private.jv_portal_invites i on i.id=a.invitation_id
   where a.object_path=p_path and a.sha256=p_sha and a.byte_size=p_bytes and a.state='pending' and a.created_at>clock_timestamp()-interval '15 minutes';
  if not found then raise exception 'Document upload reservation unavailable.' using errcode='42501'; end if;
 elsif w is null or c is null or p_path !~ ('^'||w::text||'/[a-f0-9-]{36}$') or not exists(select 1 from public.title_workspaces x,jsonb_array_elements(x.state->'companies') company where x.id=w and company->>'id'=c) then
  raise exception 'Invalid document scan target.' using errcode='42501';
 end if;
 select p.mode into mode from title_private.document_scan_policy p where singleton;
 return jsonb_build_object('workspaceId',w,'companyId',c,'policy',mode);
end $$;

create function title_private.title_record_document_scan(p_path text,p_workspace uuid,p_company text,p_sha text,p_bytes bigint,p_receipt jsonb) returns void
 language plpgsql security definer set search_path='' as $$
declare mode text; status text; bound jsonb;
begin
 if auth.uid() is not null then raise exception 'Service ingestion required.' using errcode='42501'; end if;
 -- Share lock serializes with activation; final asset trigger checks the policy again.
 select p.mode into mode from title_private.document_scan_policy p where singleton for share;
 bound=public.title_prepare_document_ingestion(p_path,case when p_path like 'jv-recipient/%' then null else p_workspace end,case when p_path like 'jv-recipient/%' then null else p_company end,p_sha,p_bytes);
 if bound->>'workspaceId' is distinct from p_workspace::text or bound->>'companyId' is distinct from p_company then raise exception 'Document scan binding changed.' using errcode='42501'; end if;
 if p_receipt is null then
  if mode is distinct from 'pending_setup' then raise exception 'A clean document scan is required.' using errcode='PT503'; end if;
  status='pending_setup';
 else
  if jsonb_typeof(p_receipt)<>'object' or p_receipt->>'status' is distinct from 'clean' or p_receipt->>'sha256' is distinct from p_sha or p_receipt->>'byteLength' is distinct from p_bytes::text
   or p_receipt->>'protocolVersion' is distinct from '1' or length(coalesce(p_receipt->>'engineVersion','')) not between 1 and 120 or length(coalesce(p_receipt->>'signatureVersion','')) not between 1 and 120
   or p_receipt->>'scannedAt' is null or p_receipt->>'signatureUpdatedAt' is null
   or (p_receipt->>'scannedAt')::timestamptz not between clock_timestamp()-interval '2 minutes' and clock_timestamp()+interval '1 minute'
   or (p_receipt->>'signatureUpdatedAt')::timestamptz not between clock_timestamp()-interval '72 hours' and clock_timestamp()+interval '1 minute'
   then raise exception 'Invalid clean scan receipt.' using errcode='22023'; end if;
  status='clean';
 end if;
 insert into title_private.document_scan_receipts(object_path,workspace_id,company_id,sha256,byte_size,status,receipt) values(p_path,p_workspace,p_company,p_sha,p_bytes,status,p_receipt);
 if status='clean' then
  perform public.title_record_security_event(p_workspace,null,'document.scan_clean','success',p_company);
 end if;
end $$;

create function title_private.require_document_scan() returns trigger language plpgsql security definer set search_path='' as $$
declare r title_private.document_scan_receipts; w uuid; c text; mode text;
begin
 if tg_table_name='jv_portal_attachments' then
  if new.state<>'ready' or old.state='ready' then return new; end if;
  select workspace_id,company_id into w,c from title_private.jv_portal_invites where id=new.invitation_id;
 else w=new.workspace_id; c=new.company_id; end if;
 select p.mode into mode from title_private.document_scan_policy p where singleton for share;
 select * into r from title_private.document_scan_receipts where object_path=new.object_path;
 -- Rolling-deploy compatibility for the preceding API while protection remains
 -- visibly NOT ACTIVATED. Never synthesize clearance in enforced mode.
 if not found and mode='pending_setup' then
  insert into title_private.document_scan_receipts(object_path,workspace_id,company_id,sha256,byte_size,status)
  values(new.object_path,w,c,new.sha256,new.byte_size,'pending_setup') returning * into r;
 end if;
 if not found or r.workspace_id is distinct from w or r.company_id is distinct from c or r.sha256 is distinct from new.sha256 or r.byte_size is distinct from new.byte_size
  or (r.status='pending_setup' and mode is distinct from 'pending_setup') then raise exception 'Document scan clearance is missing or changed.' using errcode='PT503'; end if;
 return new;
end $$;
create trigger title_asset_scan_gate before insert on public.title_assets for each row execute function title_private.require_document_scan();
create trigger jv_attachment_scan_gate before update of state on title_private.jv_portal_attachments for each row execute function title_private.require_document_scan();

-- Operators run this only after proving the hosted scanner works. Already accepted
-- originals remain explicitly unscanned; a pending upload still requires a scan.
create function title_private.activate_document_scanning() returns jsonb language plpgsql security invoker set search_path='' as $$
declare grandfathered bigint;
begin
 lock table public.title_assets,title_private.jv_portal_attachments in share row exclusive mode;
 perform 1 from title_private.document_scan_policy where singleton for update;
 update title_private.document_scan_receipts r set status='legacy_unscanned'
 where status='pending_setup' and (exists(select 1 from public.title_assets a where a.object_path=r.object_path)
  or exists(select 1 from title_private.jv_portal_attachments a where a.object_path=r.object_path and a.state='ready'));
 get diagnostics grandfathered=row_count;
 update title_private.document_scan_policy set mode='required',activated_at=coalesce(activated_at,clock_timestamp()) where singleton;
 return jsonb_build_object('policy','required_new_uploads','grandfathered',grandfathered);
end $$;
revoke all on function title_private.activate_document_scanning() from public,anon,authenticated,service_role;

create function title_private.title_document_scan_status(p_workspace uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('policy',case mode when 'required' then 'required_new_uploads' else 'pending_setup' end,'legacyUnscannedCount',
 (select count(*) from title_private.document_scan_receipts r where workspace_id=p_workspace and status<>'clean' and
 (exists(select 1 from public.title_assets a where a.object_path=r.object_path) or exists(select 1 from title_private.jv_portal_attachments a where a.object_path=r.object_path and a.state='ready'))))
 from title_private.document_scan_policy where singleton and auth.uid() is null
$$;
revoke all on function title_private.title_prepare_document_ingestion(text,uuid,text,text,bigint),title_private.title_record_document_scan(text,uuid,text,text,bigint,jsonb),title_private.title_document_scan_status(uuid),title_private.require_document_scan() from public,anon,authenticated;
grant execute on function title_private.title_prepare_document_ingestion(text,uuid,text,text,bigint),title_private.title_record_document_scan(text,uuid,text,text,bigint,jsonb),title_private.title_document_scan_status(uuid) to service_role;

-- Recovery mutations and their security evidence commit or roll back together.
create function title_private.title_create_audited_backup(p_workspace uuid,p_actor uuid,p_access_version bigint)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.title_workspaces%rowtype; b public.title_backups%rowtype;
begin
 perform title_private.require_security_admin(p_workspace,p_actor,p_access_version);
 select * into w from public.title_workspaces where id=p_workspace for share;
 if not found then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 insert into public.title_backups(workspace_id,revision,state,asset_manifest,created_by)
 values(p_workspace,w.revision,w.state,(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.title_assets a where a.workspace_id=p_workspace),p_actor) returning * into b;
 perform public.title_record_security_event(p_workspace,p_actor,'backup.created','success',null,'backup',b.id::text,null,p_access_version);
 return jsonb_build_object('id',b.id,'revision',b.revision,'created_at',b.created_at);
end $$;
create function title_private.title_restore_audited_backup(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_backup uuid)
 returns bigint language plpgsql security definer set search_path='' as $$
declare revision bigint;
begin
 perform title_private.require_security_admin(p_workspace,p_actor,p_access_version);
 revision=public.title_restore_backup(p_workspace,p_actor,p_email,p_access_version,p_expected,p_backup);
 perform public.title_record_security_event(p_workspace,p_actor,'backup.restored','success',null,'backup',p_backup::text,null,p_access_version);
 return revision;
end $$;
revoke all on function title_private.title_create_audited_backup(uuid,uuid,bigint),title_private.title_restore_audited_backup(uuid,uuid,text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function title_private.title_create_audited_backup(uuid,uuid,bigint),title_private.title_restore_audited_backup(uuid,uuid,text,bigint,bigint,uuid) to service_role;

create function public.title_prepare_document_ingestion(p_path text,p_workspace uuid,p_company text,p_sha text,p_bytes bigint) returns jsonb language sql security invoker set search_path='' as $$ select title_private.title_prepare_document_ingestion(p_path,p_workspace,p_company,p_sha,p_bytes) $$;
revoke all on function public.title_prepare_document_ingestion(text,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.title_prepare_document_ingestion(text,uuid,text,text,bigint) to service_role;

create function public.title_record_document_scan(p_path text,p_workspace uuid,p_company text,p_sha text,p_bytes bigint,p_receipt jsonb) returns void language sql security invoker set search_path='' as $$ select title_private.title_record_document_scan(p_path,p_workspace,p_company,p_sha,p_bytes,p_receipt) $$;
revoke all on function public.title_record_document_scan(text,uuid,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.title_record_document_scan(text,uuid,text,text,bigint,jsonb) to service_role;

create function public.title_document_scan_status(p_workspace uuid) returns jsonb language sql security invoker set search_path='' as $$ select title_private.title_document_scan_status(p_workspace) $$;
revoke all on function public.title_document_scan_status(uuid) from public,anon,authenticated;
grant execute on function public.title_document_scan_status(uuid) to service_role;

create function public.title_create_audited_backup(p_workspace uuid,p_actor uuid,p_access_version bigint) returns jsonb language sql security invoker set search_path='' as $$ select title_private.title_create_audited_backup(p_workspace,p_actor,p_access_version) $$;
revoke all on function public.title_create_audited_backup(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.title_create_audited_backup(uuid,uuid,bigint) to service_role;

create function public.title_restore_audited_backup(p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_backup uuid) returns bigint language sql security invoker set search_path='' as $$ select title_private.title_restore_audited_backup(p_workspace,p_actor,p_email,p_access_version,p_expected,p_backup) $$;
revoke all on function public.title_restore_audited_backup(uuid,uuid,text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.title_restore_audited_backup(uuid,uuid,text,bigint,bigint,uuid) to service_role;
