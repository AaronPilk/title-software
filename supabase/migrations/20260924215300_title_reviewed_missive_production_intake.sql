-- Explicit local intake capability. This does not authorize any Missive write,
-- broaden the legacy administrator importer, or create a title file.
create function public.title_commit_missive_intake(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,
  p_request uuid,p_hash text,p_state jsonb,p_mapping_version bigint,p_company text,
  p_routing_revision bigint,p_mapping_id text,p_credential_revision bigint,
  p_order text,p_message text,p_action text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.title_workspaces%rowtype; member public.title_memberships%rowtype; context jsonb; routing jsonb; route jsonb;
  target jsonb; mail jsonb; document jsonb; snapshot jsonb; source jsonb; manifest jsonb;
  receipt public.title_command_receipts%rowtype; old_docs jsonb; new_docs jsonb; old_mail jsonb; new_mail jsonb;
begin
  -- Match the workspace/staff lifecycle lock order before acquiring row locks.
  perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
  select * into member from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or member.version is distinct from p_access_version or member.role not in ('owner','admin','operations') then
    raise exception 'Production access changed' using errcode='42501'; end if;
  -- Routing writers take workspace before integration; preserve that order.
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable' using errcode='PT409'; end if;
  context=public.title_missive_feed_context(p_workspace,p_actor,p_access_version,p_mapping_id,p_routing_revision,false);
  if p_mapping_id is null or p_routing_revision is null or p_credential_revision is null or
    (context->>'revision')::bigint is distinct from p_credential_revision or
    ((context->>'exists')::boolean and not (context->>'configured')::boolean) then
    raise exception 'Email connection changed' using errcode='PT409'; end if;
  select public.title_missive_routing(config) into routing from public.title_integrations
    where workspace_id=p_workspace and provider='missive';
  select r into route from jsonb_array_elements(routing->'mappings') r where r->>'id'=p_mapping_id and r->>'enabled'='true';
  if route is null or route->>'companyId' is distinct from p_company or
    (route->>'version')::bigint is distinct from p_mapping_version then
    raise exception 'Approved company route changed' using errcode='PT409'; end if;
  select o into target from jsonb_array_elements(coalesce(w.state->'orders','[]')) o where o->>'id'=p_order and o->>'companyId'=p_company;
  if target is null or coalesce(target->>'status','') in ('Issued','Rejected') or exists(select 1 from jsonb_array_elements(coalesce(w.state->'business'->'policies','[]')) p
    where p->>'orderId'=p_order and p->>'status' in ('Issued','Delivered')) then
    raise exception 'Choose an open title file in the mapped company' using errcode='PT409'; end if;
  if not member.restricted_access and exists(select 1 from jsonb_array_elements(coalesce(w.state->'documents','[]')) d
    where d->>'orderId'=p_order and d->>'visibility'='Restricted') then
    raise exception 'Title file requires restricted evidence access' using errcode='42501'; end if;
  if p_action is null or p_action not in ('source','attachment') or p_message is null or p_message !~ '^[a-zA-Z0-9_-]{1,100}$' then
    raise exception 'Unsupported intake action' using errcode='PT409'; end if;
  select * into receipt from public.title_command_receipts where workspace_id=p_workspace and request_id=p_request;
  if found then
    if receipt.actor_id is distinct from p_actor or receipt.payload_hash is distinct from p_hash then
      raise exception 'Save request was already used' using errcode='PT409'; end if;
    return jsonb_build_object('revision',w.revision,'replayed',true);
  end if;
  if w.revision is distinct from p_expected or jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'Workspace changed. Review again' using errcode='PT409'; end if;
  if (p_state-'documents'-'inbox'-'user') is distinct from (w.state-'documents'-'inbox'-'user') or p_state->>'user' is distinct from p_email then
    raise exception 'Intake can only add its reviewed source documents' using errcode='PT409'; end if;
  old_docs=coalesce(w.state->'documents','[]'); new_docs=p_state->'documents';
  old_mail=coalesce(w.state->'inbox','[]'); new_mail=p_state->'inbox';
  if jsonb_typeof(new_docs) is distinct from 'array' or jsonb_typeof(new_mail) is distinct from 'array' or
    jsonb_array_length(new_docs)<>jsonb_array_length(old_docs)+1 or not new_docs @> old_docs or
    exists(select 1 from jsonb_array_elements(new_docs) d group by d->>'id' having count(*)<>1) then
    raise exception 'Existing source documents are immutable' using errcode='PT409'; end if;
  select d into document from jsonb_array_elements(new_docs) d where not exists(select 1 from jsonb_array_elements(old_docs) prior where prior->>'id'=d->>'id');
  if document is null or document->>'companyId' is distinct from p_company or document->>'orderId' is distinct from p_order or
    coalesce(document->>'visibility','') not in ('Internal','Restricted') or document ? 'sourceRole' or document ? 'output' then
    raise exception 'Attachment must remain with its reviewed company file' using errcode='PT409'; end if;
  if p_action='source' then
    if jsonb_array_length(new_mail)<>jsonb_array_length(old_mail)+1 or not new_mail @> old_mail or
      exists(select 1 from jsonb_array_elements(new_mail) m group by m->>'id' having count(*)<>1) then
      raise exception 'Existing emails are immutable' using errcode='PT409'; end if;
    select m into mail from jsonb_array_elements(new_mail) m where not exists(select 1 from jsonb_array_elements(old_mail) prior where prior->>'id'=m->>'id');
    source=mail->'missive';
    if mail is null or coalesce(mail->>'kind','') not in ('Finals','Revision','Commitment') or mail->>'companyId' is distinct from p_company or mail->>'orderId' is distinct from p_order or
      source->>'messageId' is distinct from p_message or source->>'organizationId' is distinct from route->>'organizationId' or
      source->>'teamId' is distinct from route->>'teamId' or source->>'companyId' is distinct from p_company or source->>'orderId' is distinct from p_order or
      source->>'importedBy' is distinct from p_email or (source->>'mappingVersion')::bigint is distinct from p_mapping_version or
      source->>'sourceDocumentId' is distinct from document->>'id' or coalesce(source->>'fingerprint','') !~ '^[a-f0-9]{64}$' or
      document->>'category' is distinct from 'Email source' or document->>'visibility' is distinct from 'Internal' or document->>'mime' is distinct from 'application/json' or document ? 'assetId' or
      exists(select 1 from jsonb_array_elements(old_mail) m where m->'missive'->>'organizationId'=route->>'organizationId' and m->'missive'->>'messageId'=p_message) then
      raise exception 'Source attribution does not match reviewed email' using errcode='PT409'; end if;
    begin snapshot=(document->>'text')::jsonb;
    exception when others then raise exception 'Invalid immutable source' using errcode='PT409'; end;
    if snapshot->>'provider' is distinct from 'Missive' or snapshot->>'id' is distinct from p_message or snapshot->>'organizationId' is distinct from route->>'organizationId' or
      snapshot->>'teamId' is distinct from route->>'teamId' or snapshot->>'conversationId' is distinct from source->>'conversationId' or
      snapshot->'attachments' is distinct from source->'attachments' or jsonb_typeof(snapshot->'html') is distinct from 'string' then
      raise exception 'Immutable source contents do not match attribution' using errcode='PT409'; end if;
  else
    if new_mail is distinct from old_mail then raise exception 'Attachment intake cannot change email sources' using errcode='PT409'; end if;
    select m into mail from jsonb_array_elements(old_mail) m where m->'missive'->>'organizationId'=route->>'organizationId' and m->'missive'->>'messageId'=p_message;
    source=document->'providerSource';
    select d into snapshot from jsonb_array_elements(old_docs) d where d->>'id'=mail->'missive'->>'sourceDocumentId';
    select a into manifest from jsonb_array_elements(coalesce(mail->'missive'->'attachments','[]')) a where a->>'id'=source->>'attachmentId';
    if mail is null or snapshot is null or manifest is null or mail->>'companyId' is distinct from p_company or mail->>'orderId' is distinct from p_order or
      document->>'category' is distinct from 'Email attachment' or document->>'visibility' is distinct from snapshot->>'visibility' or
      source->>'provider' is distinct from 'Missive' or source->>'messageId' is distinct from p_message or source->>'organizationId' is distinct from route->>'organizationId' or source->>'teamId' is distinct from route->>'teamId' or
      source->>'sourceMailId' is distinct from mail->>'id' or source->>'sourceDocumentId' is distinct from snapshot->>'id' or source->>'conversationId' is distinct from mail->'missive'->>'conversationId' or
      source->>'importedBy' is distinct from p_email or (source->>'mappingVersion')::bigint is distinct from p_mapping_version or
      source->>'filename' is distinct from manifest->>'name' or source->>'mime' is distinct from manifest->>'mime' or source->'bytes' is distinct from manifest->'bytes' or
      exists(select 1 from jsonb_array_elements(old_docs) d where d->'providerSource'->>'organizationId'=route->>'organizationId' and d->'providerSource'->>'messageId'=p_message and d->'providerSource'->>'attachmentId'=source->>'attachmentId') or
      not exists(select 1 from public.title_assets a where a.workspace_id=p_workspace and a.id=document->>'assetId' and a.document_id=document->>'id' and a.company_id=p_company
        and a.sha256=source->>'sha256' and a.byte_size=(source->>'bytes')::bigint and a.mime=source->>'mime' and a.filename=source->>'filename') then
      raise exception 'Attachment bytes and provenance must match the saved source' using errcode='PT409'; end if;
  end if;
  return public.title_commit(p_workspace,p_actor,p_email,p_access_version,p_expected,p_request,p_hash,p_state,
    jsonb_build_array(case when p_action='source' then 'importMissiveText' else 'importMissiveAttachment' end),array[p_company]);
end $$;
revoke all on function public.title_commit_missive_intake(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text,bigint,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.title_commit_missive_intake(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text,bigint,text,bigint,text,text,text) to service_role;
