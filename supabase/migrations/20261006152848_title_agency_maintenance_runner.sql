-- Service-only scheduler. No browser, partner or anonymous reads of delivery state.
-- This single scheduled action has a system actor; human audit actions still require a user.
alter table public.title_audit alter column actor_id drop not null;
alter table public.title_audit add constraint title_audit_actor_required check (
 actor_id is not null or coalesce(action='maintenance.tasks_created' and actor_email='' and revision>0
 and jsonb_typeof(detail)='object' and detail-'createdCount'-'taskIds'='{}'::jsonb
 and jsonb_typeof(detail->'createdCount')='number' and jsonb_typeof(detail->'taskIds')='array',false)
);
create schema if not exists title_private;
create table title_private.maintenance_runner_state (
 workspace_id uuid primary key references public.title_workspaces(id) on delete cascade,
 checked_at timestamptz not null default clock_timestamp()
);
create table title_private.maintenance_outbox (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.title_workspaces(id) on delete cascade,
 maintenance_id text not null, cycle_on date not null, task_id text not null, recipient text not null,
 company_name text not null, task_title text not null, sender text,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','unknown','manual','canceled')),
 attempts integer not null default 0, first_attempt_at timestamptz, last_attempt_at timestamptz, dispatch_started_at timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(), lease_until timestamptz, lease_token uuid,
 provider_id text not null default '', created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,maintenance_id,cycle_on,recipient),
 check(length(recipient)<=254 and recipient ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
 check(length(company_name) between 1 and 500 and length(task_title) between 1 and 220)
);
create index maintenance_outbox_ready on title_private.maintenance_outbox(workspace_id,status,next_attempt_at);
alter table title_private.maintenance_runner_state enable row level security;
alter table title_private.maintenance_outbox enable row level security;
revoke all on title_private.maintenance_runner_state,title_private.maintenance_outbox from public,anon,authenticated,service_role;
grant usage on schema title_private to service_role;
grant select,insert,update on title_private.maintenance_runner_state,title_private.maintenance_outbox to service_role;

create function public.title_maintenance_candidates(p_limit integer default 25) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; begin
 if p_limit is null or p_limit not between 1 and 25 then raise exception 'Invalid maintenance batch.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'state',state) order by checked_at nulls first,id),'[]') into result from (
   select w.id,w.revision,w.state,r.checked_at from public.title_workspaces w left join title_private.maintenance_runner_state r on r.workspace_id=w.id
   where jsonb_typeof(w.state->'agencyMaintenance'->'records')='array' and w.state->'agencyMaintenance'->'records'<>'[]'::jsonb
   order by r.checked_at nulls first,w.id limit p_limit
 ) candidates;
 return result; end $$;

create function public.title_materialize_maintenance(p_workspace uuid,p_expected bigint,p_day date,p_tasks jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.title_workspaces%rowtype; record jsonb; incoming jsonb; task jsonb; all_tasks jsonb; added jsonb='[]'; key text; reminder_recipient text; record_company_name text; requires_original boolean; meta jsonb; created integer=0; queued integer=0; rows_added integer; staff public.title_memberships%rowtype;
begin
 perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
 select * into w from public.title_workspaces where id=p_workspace for update;
 if not found or p_expected is null or w.revision<>p_expected then raise exception 'Workspace changed. Retry maintenance.' using errcode='PT409'; end if;
 if p_day is null or p_day<>(clock_timestamp() at time zone 'America/New_York')::date or jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks)>10000 or octet_length(p_tasks::text)>8000000 then raise exception 'Invalid maintenance request.' using errcode='22023'; end if;
 all_tasks=coalesce(w.state->'tasks','[]');
 for incoming in select value from jsonb_array_elements(p_tasks) loop
   if jsonb_typeof(incoming)<>'object' or jsonb_typeof(incoming->'id') is distinct from 'string' or incoming->>'id' !~ '^task-maintenance-[a-f0-9]{40}$' or incoming->'phaseOne'->>'kind' is distinct from 'maintenance' then raise exception 'Invalid maintenance task.' using errcode='22023'; end if;
   select r into record from jsonb_array_elements(coalesce(w.state->'agencyMaintenance'->'records','[]')) r where r->>'id'=incoming->'phaseOne'->>'maintenanceId';
   if record is null or record->'active' is distinct from 'true'::jsonb or record->>'nextDueOn'='' or (record->>'nextDueOn')::date>p_day+14 or record->>'nextDueOn' is distinct from incoming->'phaseOne'->>'cycleOn' or exists(select 1 from jsonb_array_elements(coalesce(w.state->'agencyMaintenance'->'history','[]')) h where h->>'maintenanceId'=record->>'id' and h->>'cycleOn'=record->>'nextDueOn') then raise exception 'Maintenance cycle changed.' using errcode='PT409'; end if;
   key='maintenance:'||(record->>'id')||':'||(record->>'nextDueOn');
   if exists(select 1 from jsonb_array_elements(all_tasks||added) t where t->'phaseOne'->>'key'=key) then continue; end if;
   if exists(select 1 from jsonb_array_elements(all_tasks||added) t where t->>'id'=incoming->>'id') then raise exception 'Maintenance task identity changed.' using errcode='PT409'; end if;
   if record->>'scope'<>'agency' and not exists(select 1 from jsonb_array_elements(w.state->'companies') c where c->>'id'=record->>'companyId') then raise exception 'Maintenance company changed.' using errcode='PT409'; end if;
   requires_original=(record->>'scope'='entity' and record->>'kind'='Good standing') or record->>'kind' in ('NC agency license','SC agency license');
   meta=jsonb_build_object('kind','maintenance','key',key,'maintenanceId',record->>'id','cycleOn',record->>'nextDueOn','required',true,'applicable',true,'revision',1);
   if requires_original then meta=meta||jsonb_build_object('documentRequirement',jsonb_build_object('categories',case when record->>'scope'='entity' then '["Formation","Company records","Partner entities"]'::jsonb else '["Licensing"]'::jsonb end,'minimum',1,'restricted',record->>'scope'='entity')); end if;
   task=jsonb_build_object('id',incoming->>'id','title',record->>'title','companyId',record->>'companyId','owner',coalesce(record->>'owner',''),'scope','agency','due',record->>'nextDueOn','done',false,'status','Not Started','completedOn','','notes','','documentIds','[]'::jsonb,'priority','Normal','createdAt',p_day::text,'phaseOne',meta);
   -- A withdrawn assignee must not prevent a due task from appearing. Keep it
   -- unassigned when the recorded staff account no longer has company access.
   if coalesce(record->>'assigneeId','') ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then
     select * into staff from public.title_memberships where workspace_id=p_workspace and user_id=(record->>'assigneeId')::uuid and active for share;
     if found and staff.role in ('owner','admin','onboarding') and (staff.all_companies or record->>'companyId'=any(staff.company_ids)) then task=task||jsonb_build_object('assigneeId',staff.user_id); else task=jsonb_set(task,'{owner}','""'); end if;
   end if;
   added=added||jsonb_build_array(task); created=created+1;
 end loop;
 all_tasks=all_tasks||added;
 if created>0 then
   update public.title_workspaces set state=jsonb_set(w.state,'{tasks}',all_tasks),revision=revision+1,updated_at=clock_timestamp() where id=p_workspace;
   insert into public.title_audit(workspace_id,actor_id,actor_email,action,company_ids,detail,revision)
   values(p_workspace,null,'','maintenance.tasks_created',
     array(select distinct t->>'companyId' from jsonb_array_elements(added) t where coalesce(t->>'companyId','')<>'' order by 1),
     jsonb_build_object('createdCount',created,'taskIds',(select jsonb_agg(t->>'id') from jsonb_array_elements(added) t)),w.revision+1);
 end if;
 -- Addresses and minimal email text come from the locked canonical state.
 reminder_recipient=lower(btrim(w.state->'agencyMaintenance'->'notifications'->>'recipient'));
 if w.state->'agencyMaintenance'->'notifications'->'enabled'='true'::jsonb and length(reminder_recipient) between 3 and 254 and reminder_recipient ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then
   for record in select value from jsonb_array_elements(coalesce(w.state->'agencyMaintenance'->'records','[]')) loop
     if record->'active' is distinct from 'true'::jsonb or coalesce(record->>'nextDueOn','')='' or (record->>'nextDueOn')::date>p_day+14 then continue; end if;
     key='maintenance:'||(record->>'id')||':'||(record->>'nextDueOn');
     select t into task from jsonb_array_elements(all_tasks) t where t->'phaseOne'->>'key'=key and t->'done'='false'::jsonb and t->'phaseOne'->'applicable'='true'::jsonb;
     if task is null or exists(select 1 from jsonb_array_elements(coalesce(w.state->'agencyMaintenance'->'history','[]')) h where h->>'maintenanceId'=record->>'id' and h->>'cycleOn'=record->>'nextDueOn') then continue; end if;
     if record->>'scope'='agency' then record_company_name='Ballantyne Title agency'; else select c->>'name' into record_company_name from jsonb_array_elements(w.state->'companies') c where c->>'id'=record->>'companyId'; end if;
     if record_company_name is null then continue; end if;
     insert into title_private.maintenance_outbox(workspace_id,maintenance_id,cycle_on,task_id,recipient,company_name,task_title)
     values(p_workspace,record->>'id',(record->>'nextDueOn')::date,task->>'id',reminder_recipient,record_company_name,record->>'title') on conflict(workspace_id,maintenance_id,cycle_on,recipient) do update
       set status='pending',task_id=excluded.task_id,company_name=excluded.company_name,task_title=excluded.task_title,
       sender=null,first_attempt_at=null,last_attempt_at=null,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
       where title_private.maintenance_outbox.status='canceled' and title_private.maintenance_outbox.dispatch_started_at is null;
     -- Only jobs never authorized for provider dispatch can be reactivated.
     -- An uncertain/sent original retains its unique cycle and is never resent.
     get diagnostics rows_added=row_count; queued=queued+rows_added;
   end loop;
 end if;
 insert into title_private.maintenance_runner_state(workspace_id) values(p_workspace) on conflict(workspace_id) do update set checked_at=clock_timestamp();
 return jsonb_build_object('created',created,'queued',queued,'revision',w.revision+case when created>0 then 1 else 0 end);
end $$;

create function title_private.maintenance_email_current(p_state jsonb,p_record text,p_cycle date,p_recipient text,p_task text) returns boolean
language sql stable set search_path='' as $$
 select coalesce(p_state->'agencyMaintenance'->'notifications'->'enabled'='true'::jsonb and lower(btrim(p_state->'agencyMaintenance'->'notifications'->>'recipient'))=p_recipient
 and exists(select 1 from jsonb_array_elements(coalesce(p_state->'agencyMaintenance'->'records','[]')) r where r->>'id'=p_record and r->'active'='true'::jsonb and r->>'nextDueOn'=p_cycle::text)
 and not exists(select 1 from jsonb_array_elements(coalesce(p_state->'agencyMaintenance'->'history','[]')) h where h->>'maintenanceId'=p_record and h->>'cycleOn'=p_cycle::text)
 and exists(select 1 from jsonb_array_elements(coalesce(p_state->'tasks','[]')) t where t->>'id'=p_task and t->'done'='false'::jsonb and t->'phaseOne'->'applicable'='true'::jsonb and t->'phaseOne'->>'maintenanceId'=p_record and t->'phaseOne'->>'cycleOn'=p_cycle::text),false)
$$;
create function public.title_claim_maintenance_email(p_workspace uuid,p_limit integer,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare state jsonb; r title_private.maintenance_outbox%rowtype; result jsonb='[]'; stamp timestamptz=clock_timestamp(); amount integer=0;
begin
 if p_limit is null or p_limit not between 1 and 5 or p_sender is null or length(p_sender) not between 3 and 300 or p_sender ~ '[\x01-\x1f\x7f]' or p_sender !~ '(^|<)[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+>?$' then raise exception 'Invalid reminder batch.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
 select w.state into state from public.title_workspaces w where w.id=p_workspace for share;
 if not found then return result; end if;
 for r in select * from title_private.maintenance_outbox where workspace_id=p_workspace and ((status in ('pending','unknown') and next_attempt_at<=stamp) or (status='sending' and lease_until<=stamp)) order by created_at,id for update loop
   if not title_private.maintenance_email_current(state,r.maintenance_id,r.cycle_on,r.recipient,r.task_id) then update title_private.maintenance_outbox set status='canceled',lease_token=null,lease_until=null,updated_at=stamp where id=r.id; continue; end if;
   if r.first_attempt_at is not null and r.first_attempt_at<=stamp-interval '23 hours' then update title_private.maintenance_outbox set status='manual',lease_token=null,lease_until=null,updated_at=stamp where id=r.id; continue; end if;
   if amount>=p_limit then exit; end if;
   update title_private.maintenance_outbox set status='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,stamp),last_attempt_at=stamp,lease_token=gen_random_uuid(),lease_until=stamp+interval '2 minutes',sender=coalesce(sender,p_sender),updated_at=stamp where id=r.id returning * into r;
   result=result||jsonb_build_array(jsonb_build_object('id',r.id,'workspaceId',r.workspace_id,'leaseToken',r.lease_token,'recipient',r.recipient,'sender',r.sender,'companyName',r.company_name,'taskTitle',r.task_title,'dueOn',r.cycle_on,'firstAttemptAt',r.first_attempt_at)); amount=amount+1;
 end loop;
 return result;
end $$;
create function public.title_check_maintenance_email(p_workspace uuid,p_id uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare state jsonb; r title_private.maintenance_outbox%rowtype;
begin
 perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
 select w.state into state from public.title_workspaces w where w.id=p_workspace for share;
 select * into r from title_private.maintenance_outbox where id=p_id and workspace_id=p_workspace for update;
 if not found or r.status<>'sending' or r.lease_token is distinct from p_lease or r.lease_until<=clock_timestamp() then return false; end if;
 if not title_private.maintenance_email_current(state,r.maintenance_id,r.cycle_on,r.recipient,r.task_id) then update title_private.maintenance_outbox set status='canceled',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=r.id; return false; end if;
 if r.first_attempt_at<=clock_timestamp()-interval '23 hours' then update title_private.maintenance_outbox set status='manual',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=r.id; return false; end if;
 update title_private.maintenance_outbox set dispatch_started_at=coalesce(dispatch_started_at,clock_timestamp()) where id=r.id;
 return true;
end $$;
create function public.title_finish_maintenance_email(p_workspace uuid,p_id uuid,p_lease uuid,p_status text,p_provider_id text default '') returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null or p_status not in ('sent','failed','unknown','manual') or p_provider_id is null or length(p_provider_id)>200 or (p_provider_id<>'' and p_provider_id !~ '^[A-Za-z0-9_-]+$') then raise exception 'Invalid reminder outcome.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(19492271,hashtext(p_workspace::text));
 update title_private.maintenance_outbox set status=p_status,provider_id=p_provider_id,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where id=p_id and workspace_id=p_workspace and status='sending' and lease_token=p_lease;
 return found;
end $$;
revoke all on function public.title_maintenance_candidates(integer),public.title_materialize_maintenance(uuid,bigint,date,jsonb),title_private.maintenance_email_current(jsonb,text,date,text,text),public.title_claim_maintenance_email(uuid,integer,text),public.title_check_maintenance_email(uuid,uuid,uuid),public.title_finish_maintenance_email(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.title_maintenance_candidates(integer),public.title_materialize_maintenance(uuid,bigint,date,jsonb),title_private.maintenance_email_current(jsonb,text,date,text,text),public.title_claim_maintenance_email(uuid,integer,text),public.title_check_maintenance_email(uuid,uuid,uuid),public.title_finish_maintenance_email(uuid,uuid,uuid,text,text) to service_role;

-- Uses only existing pg_cron/pg_net and existing Supabase hosting. Secret values
-- must be installed in Vault at activation; missing configuration is a quiet noop.
create function title_private.invoke_maintenance_worker() returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; service_key text; request_id bigint;
begin
 if not exists(select 1 from pg_extension where extname='pg_net') or to_regclass('vault.decrypted_secrets') is null then return null; end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1' into endpoint using 'title_maintenance_worker_url';
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1' into service_key using 'title_maintenance_service_role_key';
 if endpoint is null or endpoint !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/title-maintenance$' or service_key is null or length(service_key)<20 then return null; end if;
 execute 'select net.http_post(url := $1,headers := $2,body := ''{}''::jsonb,timeout_milliseconds := 120000)' into request_id using endpoint,jsonb_build_object('Authorization','Bearer '||service_key,'Content-Type','application/json');
 return request_id;
end $$;
revoke all on function title_private.invoke_maintenance_worker() from public,anon,authenticated,service_role;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
   execute 'select cron.schedule(''title-agency-maintenance'',''0 * * * *'',''select title_private.invoke_maintenance_worker();'')';
 end if;
end $$;
