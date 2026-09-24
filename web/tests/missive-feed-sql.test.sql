-- Disposable PostgreSQL only; Vault in this runner uses synthetic credentials.
create function pg_temp.assert_credential(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Feed regression: %',label; end if; end $$;
create function pg_temp.reject_credential(expected text,statement text) returns void language plpgsql as $$
begin begin execute statement; raise exception 'Expected rejection missing' using errcode='PTBAD';
exception when others then if sqlstate<>expected then raise; end if; end; end $$;
do $$ begin execute format('grant usage on schema %I to service_role,anon,authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
do $$
declare owner_id uuid=gen_random_uuid(); operator_id uuid=gen_random_uuid(); stranger uuid=gen_random_uuid(); w uuid;
  result jsonb; sig text='public.title_missive_feed_context(uuid,uuid,bigint,text,bigint,boolean)';
begin
  perform pg_temp.assert_credential(not has_function_privilege('anon',sig,'execute') and not has_function_privilege('authenticated',sig,'execute') and has_function_privilege('service_role',sig,'execute'),'feed capability is service-only');
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,'feed-owner@example.test',now()),(operator_id,'feed-operator@example.test',now()),(stranger,'feed-stranger@example.test',now());
  insert into public.title_workspaces(name,state) values('Read-only feed fixture','{"companies":[{"id":"A"},{"id":"B"}]}') returning id into w;
  insert into public.title_memberships(workspace_id,user_id,role,all_companies,company_ids) values(w,owner_id,'owner',true,'{}'),(w,operator_id,'operations',false,'{A}');
  set local role service_role;
  perform public.title_save_missive_credential(w,owner_id,1,0,'SYNTHETIC_FEED_CREDENTIAL_ONLY');
  perform public.title_save_missive_route(w,owner_id,'feed-owner@example.test',1,1,'{"organizationId":"org","teamId":"team-a","teamName":"A inbox","companyId":"A","enabled":true}');
  perform public.title_save_missive_route(w,owner_id,'feed-owner@example.test',1,2,'{"organizationId":"org","teamId":"team-b","teamName":"B inbox","companyId":"B","enabled":true}');
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1,%L,3,true)',w,operator_id,'route:org:team-a:A'));
  perform public.title_missive_set_production_only(w,owner_id,1,3,'route:org:team-a:A',true);
  result=public.title_missive_feed_context(w,operator_id,1);
  perform pg_temp.assert_credential(result->>'configured'='true' and not(result?'token'),'setup returns metadata without credential');
  result=public.title_missive_feed_context(w,operator_id,1,'route:org:team-a:A',4,true);
  perform pg_temp.assert_credential(result->>'token'='SYNTHETIC_FEED_CREDENTIAL_ONLY','assigned operations route has server capability');
  perform pg_temp.assert_credential(not(public.title_missive_feed_context(w,operator_id,1,'route:org:team-a:A',4,false)?'token'),'post-read recheck omits credential');
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1,%L,4,true)',w,operator_id,'route:org:team-b:B'));
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1)',w,stranger));
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,0)',w,operator_id));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,null,null,true)',w,operator_id));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,2,true)',w,operator_id,'route:org:team-a:A'));
  reset role;
  update public.title_memberships set role='viewer' where workspace_id=w and user_id=operator_id;
  set local role service_role;
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1)',w,operator_id));
  reset role;
  update public.title_memberships set role='operations',active=false where workspace_id=w and user_id=operator_id;
  set local role service_role;
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1)',w,operator_id));
  reset role;
  update public.title_memberships set active=true where workspace_id=w and user_id=operator_id;
  set local role service_role;
  perform public.title_save_missive_route(w,owner_id,'feed-owner@example.test',1,4,'{"organizationId":"org","teamId":"team-a","teamName":"Shared inbox","companyId":"B","enabled":true}');
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,5,true)',w,operator_id,'route:org:team-a:A'));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,5,true)',w,owner_id,'route:org:team-a:A'));
  perform public.title_save_missive_route(w,owner_id,'feed-owner@example.test',1,5,'{"organizationId":"org","teamId":"team-a","teamName":"Shared inbox","companyId":"B","enabled":false}');
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,6,true)',w,operator_id,'route:org:team-a:A'));
  perform public.title_save_missive_credential(w,owner_id,1,1,null);
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,7,true)',w,operator_id,'route:org:team-a:A'));
  reset role;
  raise notice 'Read-only feed: metadata, scoped decryption, role/version/revocation, shared/paused route and disconnect checks passed';
end $$;
do $$
declare owner_id uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid(); scoped_id uuid=gen_random_uuid();
  operator_id uuid=gen_random_uuid(); viewer_id uuid=gen_random_uuid(); inactive_id uuid=gen_random_uuid(); stranger uuid=gen_random_uuid();
  rejected_actor uuid; w uuid; other_workspace uuid; rev bigint; before_audit bigint; initial_config jsonb; result jsonb; route jsonb;
  route_id text='route:org:production:A'; signature text='public.title_missive_set_production_only(uuid,uuid,bigint,bigint,text,boolean)';
begin
  perform pg_temp.assert_credential(not has_function_privilege('anon',signature,'execute') and
    not has_function_privilege('authenticated',signature,'execute') and has_function_privilege('service_role',signature,'execute'),
    'Production approval RPC is service-only');
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,'production-owner@example.test',now()),(admin_id,'production-admin@example.test',now()),
    (scoped_id,'production-scoped@example.test',now()),(operator_id,'production-operator@example.test',now()),(viewer_id,'production-viewer@example.test',now()),
    (inactive_id,'production-inactive@example.test',now()),(stranger,'production-stranger@example.test',now());
  insert into public.title_workspaces(name,state) values('Production approval fixture','{"companies":[{"id":"A"},{"id":"B"}]}') returning id into w;
  insert into public.title_workspaces(name,state) values('Other Production workspace','{"companies":[{"id":"A"}]}') returning id into other_workspace;
  insert into public.title_memberships(workspace_id,user_id,role,all_companies,company_ids,active) values
    (w,owner_id,'owner',false,'{A}',true),(w,admin_id,'admin',true,'{}',true),(w,scoped_id,'admin',false,'{A}',true),
    (w,operator_id,'operations',false,'{A}',true),(w,viewer_id,'viewer',true,'{}',true),(w,inactive_id,'owner',true,'{}',false),
    (other_workspace,stranger,'owner',true,'{}',true);
  set local role service_role;
  perform public.title_save_missive_credential(w,owner_id,1,0,'SYNTHETIC_PRODUCTION_CREDENTIAL_ONLY');
  result=public.title_save_missive_route(w,owner_id,'production-owner@example.test',1,1,
    '{"organizationId":"org","teamId":"production","teamName":"Production inbox","companyId":"A","enabled":true,"productionOnly":true}');
  result=public.title_save_missive_route(w,owner_id,'production-owner@example.test',1,2,
    '{"organizationId":"org","teamId":"general","teamName":"General inbox","companyId":"B","enabled":true,"productionOnly":true}');
  rev=(result->>'revision')::bigint;
  perform pg_temp.assert_credential(not exists(select 1 from jsonb_array_elements(result->'mappings') r where r->>'productionOnly'='true'),
    'ordinary route writer cannot grant Production approval through extra mapping fields');
  select config into initial_config from public.title_integrations where workspace_id=w and provider='missive';
  select count(*) into before_audit from public.title_audit where workspace_id=w;
  foreach rejected_actor in array array[operator_id,viewer_id,scoped_id,inactive_id,stranger] loop
    perform pg_temp.reject_credential('42501',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,rejected_actor,rev,route_id));
    perform pg_temp.reject_credential('42501',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,false)',w,rejected_actor,rev,route_id));
  end loop;
  perform pg_temp.reject_credential('42501',format('select public.title_missive_set_production_only(%L,%L,0,%L,%L,true)',w,owner_id,rev,route_id));
  perform pg_temp.reject_credential('42501',format('select public.title_missive_set_production_only(%L,%L,null,%L,%L,true)',w,owner_id,rev,route_id));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev-1,route_id));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,null,%L,true)',w,owner_id,route_id));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,null)',w,owner_id,rev,route_id));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,null,true)',w,owner_id,rev));
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev,'route:org:production:B'));
  reset role;
  set local role authenticated;
  perform pg_temp.reject_credential('42501',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev,route_id));
  reset role;
  set local role anon;
  perform pg_temp.reject_credential('42501',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev,route_id));
  reset role;
  set local role service_role;
  perform pg_temp.assert_credential((select config from public.title_integrations where workspace_id=w and provider='missive')=initial_config and
    (select count(*) from public.title_audit where workspace_id=w)=before_audit,'rejected approvals preserve routing and audit');
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1,%L,%L,true)',w,operator_id,route_id,rev));
  -- Spoofed request claims are not a source for the audit identity: the API's
  -- verified actor argument is resolved to its account email inside the RPC.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',stranger,'email','forged@example.test')::text,true);
  result=public.title_missive_set_production_only(w,owner_id,1,rev,route_id,true);
  rev=(result->>'revision')::bigint;
  select r into route from jsonb_array_elements(result->'mappings') r where r->>'id'=route_id;
  perform pg_temp.assert_credential(rev=4 and route->>'productionOnly'='true' and (route->>'version')::bigint=rev and
    route->>'productionOnlyReviewedBy'='production-owner@example.test' and route->>'productionOnlyReviewedAt' is not null,
    'explicit owner approval advances routing and selected route version');
  perform pg_temp.assert_credential((select r->>'version' from jsonb_array_elements(result->'mappings') r where r->>'id'='route:org:general:B')='3',
    'approval leaves unrelated route version unchanged');
  perform pg_temp.assert_credential(exists(select 1 from public.title_audit where workspace_id=w and action='missive.production_only_approved' and
    actor_id=owner_id and actor_email='production-owner@example.test' and company_ids='{A}' and detail->>'routeId'=route_id and
    detail->>'routingRevision'=rev::text and detail->>'productionOnly'='true'),'approval audit records account identity, route, company and revision');
  result=public.title_missive_feed_context(w,operator_id,1,route_id,rev,true);
  perform pg_temp.assert_credential(result->>'token'='SYNTHETIC_PRODUCTION_CREDENTIAL_ONLY','approved route grants assigned Operations feed capability');
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,%L,true)',w,operator_id,route_id,rev-1));
  result=public.title_missive_set_production_only(w,admin_id,1,rev,route_id,true);
  perform pg_temp.assert_credential((result->>'revision')::bigint=rev+1,'organization-wide administrator can reapprove and invalidate old reviews');
  rev=(result->>'revision')::bigint;
  result=public.title_missive_set_production_only(w,admin_id,1,rev,route_id,false);
  rev=(result->>'revision')::bigint;
  perform pg_temp.assert_credential(rev=6 and exists(select 1 from jsonb_array_elements(result->'mappings') r where r->>'id'=route_id and
    r->>'productionOnly'='false' and r->>'version'=rev::text),'revoke advances both versions and clears approval');
  perform pg_temp.assert_credential(exists(select 1 from public.title_audit where workspace_id=w and action='missive.production_only_revoked' and
    actor_id=admin_id and actor_email='production-admin@example.test' and detail->>'routingRevision'=rev::text and detail->>'productionOnly'='false'),
    'revocation has a distinct audit action and current actor');
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_feed_context(%L,%L,1,%L,%L,true)',w,operator_id,route_id,rev-1));
  perform pg_temp.reject_credential('42501',format('select public.title_missive_feed_context(%L,%L,1,%L,%L,true)',w,operator_id,route_id,rev));
  result=public.title_missive_set_production_only(w,owner_id,1,rev,route_id,true);
  rev=(result->>'revision')::bigint;
  result=public.title_save_missive_route(w,owner_id,'production-owner@example.test',1,rev,
    '{"organizationId":"org","teamId":"production","teamName":"Shared inbox","companyId":"B","enabled":true}');
  rev=(result->>'revision')::bigint;
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev,route_id));
  result=public.title_save_missive_route(w,owner_id,'production-owner@example.test',1,rev,
    '{"organizationId":"org","teamId":"production","teamName":"Shared inbox","companyId":"B","enabled":false}');
  rev=(result->>'revision')::bigint;
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev,route_id));
  result=public.title_missive_set_production_only(w,owner_id,1,rev,route_id,false);
  rev=(result->>'revision')::bigint;
  perform pg_temp.assert_credential(exists(select 1 from jsonb_array_elements(result->'mappings') r where r->>'id'=route_id and r->>'productionOnly'='false'),
    'revocation remains available after an inbox becomes shared with a paused route');
  -- A normal route review clears the explicit consent instead of carrying it
  -- into another review; the general company inbox writer stays unprivileged.
  result=public.title_missive_set_production_only(w,owner_id,1,rev,'route:org:general:B',true);
  rev=(result->>'revision')::bigint;
  result=public.title_save_missive_route(w,owner_id,'production-owner@example.test',1,rev,
    '{"organizationId":"org","teamId":"general","teamName":"General inbox","companyId":"B","enabled":true,"productionOnly":true}');
  rev=(result->>'revision')::bigint;
  perform pg_temp.assert_credential(not exists(select 1 from jsonb_array_elements(result->'mappings') r where r->>'id'='route:org:general:B' and r->>'productionOnly'='true'),
    'ordinary route re-review clears earlier Production approval');
  result=public.title_missive_set_production_only(w,owner_id,1,rev,'route:org:general:B',true);
  rev=(result->>'revision')::bigint;
  perform public.title_save_missive_credential(w,owner_id,1,1,null);
  rev=rev+1;
  perform pg_temp.reject_credential('PT409',format('select public.title_missive_set_production_only(%L,%L,1,%L,%L,true)',w,owner_id,rev,'route:org:general:B'));
  result=public.title_missive_set_production_only(w,owner_id,1,rev,'route:org:general:B',false);
  rev=(result->>'revision')::bigint;
  perform pg_temp.assert_credential(exists(select 1 from jsonb_array_elements(result->'mappings') r where r->>'id'='route:org:general:B' and
    r->>'productionOnly'='false' and r->>'enabled'='false') and
    (select status from public.title_integrations where workspace_id=w and provider='missive')='disabled',
    'revocation removes paused approval without reconnecting the disabled integration');
  reset role;
  raise notice 'Production approval: service-only calls, live roles/version, exact route/revision, actor audit, approve/reapprove/revoke feed capability, shared/paused routes and consent reset checks passed';
end $$;
do $$
declare actor uuid=gen_random_uuid(); operator_id uuid=gen_random_uuid(); w uuid; rev bigint; result jsonb;
  good jsonb='[{"organizationId":"org","teamId":"one","teamName":"One","companyId":"A","enabled":true},{"organizationId":"org","teamId":"two","teamName":"Two","companyId":"B","enabled":true}]';
  bad jsonb='[{"organizationId":"org","teamId":"one","teamName":"One","companyId":"A","enabled":true},{"organizationId":"org","teamId":"two","teamName":"Two","companyId":"missing","enabled":true}]';
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'batch-owner@example.test',now()),(operator_id,'batch-operator@example.test',now());
  insert into public.title_workspaces(name,state) values('Batch route fixture','{"companies":[{"id":"A"},{"id":"B"}]}') returning id,revision into w,rev;
  insert into public.title_memberships(workspace_id,user_id,role,all_companies) values(w,actor,'owner',true),(w,operator_id,'operations',true);
  set local role service_role;
  perform pg_temp.reject_credential('42501',format('select public.title_save_missive_routes(%L,%L,%L,1,0,%L,%L)',w,operator_id,'batch-operator@example.test',rev,good));
  perform pg_temp.reject_credential('PT409',format('select public.title_save_missive_routes(%L,%L,%L,1,0,%L,%L)',w,actor,'batch-owner@example.test',rev,bad));
  perform pg_temp.assert_credential(not exists(select 1 from public.title_integrations where workspace_id=w),'failed batch leaves no partial routes');
  perform pg_temp.assert_credential(not exists(select 1 from public.title_audit where workspace_id=w),'failed batch rolls back audit');
  perform pg_temp.reject_credential('PT409',format('select public.title_save_missive_routes(%L,%L,%L,1,0,%L,%L)',w,actor,'batch-owner@example.test',rev+1,good));
  result=public.title_save_missive_routes(w,actor,'batch-owner@example.test',1,0,rev,good);
  perform pg_temp.assert_credential(result->>'revision'='2' and jsonb_array_length(result->'mappings')=2,'batch connects reviewed routes atomically');
  perform pg_temp.assert_credential(not exists(select 1 from jsonb_array_elements(result->'mappings') r where r->>'productionOnly'='true'),'general company routes never gain production approval');
  reset role;
  raise notice 'Batch routes: administrator, atomicity, audit, workspace revision and general-email scope checks passed';
end $$;
