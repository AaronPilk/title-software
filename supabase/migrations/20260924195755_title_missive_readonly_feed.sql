-- Service-only capability for read-only, company-routed email. The browser
-- never receives a credential and cannot call this function directly.
create function public.title_missive_feed_context(
  p_workspace uuid, p_actor uuid, p_access_version bigint,
  p_route_id text default null, p_routing_revision bigint default null,
  p_decrypt boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.title_memberships%rowtype; c public.title_missive_credentials%rowtype;
  i public.title_integrations%rowtype; routing jsonb; route jsonb; token text;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_access_version is null or m.version<>p_access_version or m.role not in ('owner','admin','operations') then
    raise exception 'Production email access changed' using errcode='42501';
  end if;
  if p_decrypt is null or (p_route_id is null and (p_decrypt or p_routing_revision is not null)) then
    raise exception 'Choose an approved inbox' using errcode='PT409';
  end if;
  if p_route_id is not null then
    select * into i from public.title_integrations where workspace_id=p_workspace and provider='missive' for share;
    if not found or i.status='disabled' then raise exception 'Inbox connection is paused' using errcode='PT409'; end if;
    routing=public.title_missive_routing(i.config);
    if p_routing_revision is null or p_routing_revision<>(routing->>'revision')::bigint then
      raise exception 'Inbox routing changed' using errcode='PT409'; end if;
    select r into route from jsonb_array_elements(routing->'mappings') r where r->>'id'=p_route_id and r->>'enabled'='true';
    if route is null or not (m.all_companies or route->>'companyId'=any(m.company_ids)) or
      not exists(select 1 from public.title_workspaces w,jsonb_array_elements(w.state->'companies') company where w.id=p_workspace and company->>'id'=route->>'companyId') then
      raise exception 'Inbox is not assigned to your companies' using errcode='42501'; end if;
    if m.role='operations' and coalesce(route->>'productionOnly','false')<>'true' then
      raise exception 'This inbox has not been approved for Production email' using errcode='42501'; end if;
    -- Even a paused second route makes attribution ambiguous. Never expose an
    -- entire shared mailbox as though it belonged to one company.
    if (select count(distinct r->>'companyId') from jsonb_array_elements(routing->'mappings') r
        where r->>'organizationId'=route->>'organizationId' and r->>'teamId'=route->>'teamId')<>1 then
      raise exception 'Shared inbox needs message-level routing' using errcode='PT409'; end if;
  end if;
  select * into c from public.title_missive_credentials where workspace_id=p_workspace for share;
  if p_decrypt and c.secret_id is not null then
    select decrypted_secret into token from vault.decrypted_secrets where id=c.secret_id;
    if token is null then raise exception 'Missive credential is unavailable' using errcode='PT503'; end if;
  end if;
  return jsonb_build_object('exists',c.workspace_id is not null,'configured',c.secret_id is not null,
    'revision',coalesce(c.revision,0),'verifiedAt',c.verified_at)||
    case when p_decrypt then jsonb_build_object('token',token) else '{}'::jsonb end;
end $$;
revoke all on function public.title_missive_feed_context(uuid,uuid,bigint,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.title_missive_feed_context(uuid,uuid,bigint,text,bigint,boolean) to service_role;

-- Reuse the existing audited administrator-only route writer atomically after
-- the API has reverified exact imported inbox identities with Missive.
create function public.title_save_missive_routes(
  p_workspace uuid,p_actor uuid,p_email text,p_access_version bigint,p_expected bigint,p_workspace_revision bigint,p_mappings jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; result jsonb; expected bigint=p_expected;
begin
  if p_mappings is null or jsonb_typeof(p_mappings)<>'array' or jsonb_array_length(p_mappings)<1 or jsonb_array_length(p_mappings)>100 then
    raise exception 'Review a bounded list of company inboxes' using errcode='PT409'; end if;
  perform 1 from public.title_workspaces where id=p_workspace and revision=p_workspace_revision for update;
  if not found then raise exception 'Companies changed. Review the inbox list again' using errcode='PT409'; end if;
  for item in select value from jsonb_array_elements(p_mappings) loop
    result=public.title_save_missive_route(p_workspace,p_actor,p_email,p_access_version,expected,item);
    expected=(result->>'revision')::bigint;
  end loop;
  return result;
end $$;
revoke all on function public.title_save_missive_routes(uuid,uuid,text,bigint,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.title_save_missive_routes(uuid,uuid,text,bigint,bigint,bigint,jsonb) to service_role;

-- Production access requires a separate explicit review of the entire inbox.
-- SECURITY DEFINER permits reading the canonical actor email from auth.users;
-- only the authenticated server can invoke this RPC with its verified actor.
create function public.title_missive_set_production_only(
  p_workspace uuid,p_actor uuid,p_access_version bigint,p_expected bigint,
  p_route_id text,p_production_only boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.title_memberships%rowtype; w public.title_workspaces%rowtype;
  i public.title_integrations%rowtype; routing jsonb; route jsonb; routes jsonb; email text;
begin
  select * into m from public.title_memberships where workspace_id=p_workspace and user_id=p_actor and active for share;
  if not found or p_access_version is null or m.version<>p_access_version or
    not (m.role='owner' or (m.role='admin' and m.all_companies)) then
    raise exception 'Administrator access changed' using errcode='42501'; end if;
  if p_production_only is null or p_route_id is null then
    raise exception 'Review an exact inbox and its Production email approval' using errcode='PT409'; end if;
  select * into w from public.title_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable' using errcode='PT409'; end if;
  select * into i from public.title_integrations where workspace_id=p_workspace and provider='missive' for update;
  if not found then raise exception 'Inbox connection is unavailable' using errcode='PT409'; end if;
  routing=public.title_missive_routing(i.config);
  if p_expected is null or p_expected<0 or (routing->>'revision')::bigint is distinct from p_expected then
    raise exception 'Inbox routing changed. Refresh before saving.' using errcode='PT409'; end if;
  if jsonb_typeof(routing->'mappings') is distinct from 'array' then
    raise exception 'Saved inbox routing is incomplete' using errcode='PT409'; end if;
  -- Reject malformed identities and duplicate route IDs before attributing a
  -- whole inbox to one company, including identities on paused routes.
  if exists(select 1 from jsonb_array_elements(routing->'mappings') r where
      coalesce(r->>'organizationId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
      coalesce(r->>'teamId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
      coalesce(r->>'companyId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
      r->>'id' is distinct from 'route:'||(r->>'organizationId')||':'||(r->>'teamId')||':'||(r->>'companyId') or
      jsonb_typeof(r->'enabled') is distinct from 'boolean') or
    exists(select 1 from jsonb_array_elements(routing->'mappings') r group by r->>'id' having count(*)>1) then
    raise exception 'Saved inbox routing is incomplete' using errcode='PT409'; end if;
  select r into route from jsonb_array_elements(routing->'mappings') r where r->>'id'=p_route_id;
  if route is null then raise exception 'Inbox route is unavailable' using errcode='PT409'; end if;
  if p_production_only then
    if i.status='disabled' or route->'enabled'<>'true'::jsonb then
      raise exception 'Choose an active inbox before approving Production email' using errcode='PT409'; end if;
    if not exists(select 1 from jsonb_array_elements(w.state->'companies') company where company->>'id'=route->>'companyId') then
      raise exception 'Mapped company is unavailable' using errcode='PT409'; end if;
    if (select count(distinct r->>'companyId') from jsonb_array_elements(routing->'mappings') r
        where r->>'organizationId'=route->>'organizationId' and r->>'teamId'=route->>'teamId')<>1 then
      raise exception 'Shared inbox needs message-level routing' using errcode='PT409'; end if;
  end if;
  select u.email into email from auth.users u where u.id=p_actor;
  if email is null or btrim(email)='' then raise exception 'Administrator account is unavailable' using errcode='42501'; end if;
  route=route||jsonb_build_object('productionOnly',p_production_only,'version',p_expected+1,
    'productionOnlyReviewedAt',now(),'productionOnlyReviewedBy',email);
  select jsonb_agg(case when r->>'id'=p_route_id then route else r end order by ord)
    into routes from jsonb_array_elements(routing->'mappings') with ordinality as x(r,ord);
  routing=jsonb_build_object('schemaVersion',2,'revision',p_expected+1,'mappings',routes);
  update public.title_integrations set config=(i.config-'mapping')||routing
    where workspace_id=p_workspace and provider='missive';
  insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail)
    values(p_workspace,p_actor,email,case when p_production_only then 'missive.production_only_approved' else 'missive.production_only_revoked' end,
      array[route->>'companyId'],jsonb_build_object('routingRevision',p_expected+1,'routeId',p_route_id,
        'productionOnly',p_production_only,'mapping',route));
  return routing;
end $$;
revoke all on function public.title_missive_set_production_only(uuid,uuid,bigint,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.title_missive_set_production_only(uuid,uuid,bigint,bigint,text,boolean) to service_role;
