/** Isolated PostgreSQL transaction regressions. No project credentials or live database are used. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const binDirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean);
function binary(name) {
  for (const dir of binDirs) {
    const candidate = path.join(dir, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  throw new Error(`Install local PostgreSQL tools or set TITLE_TEST_PG_BIN; ${name} was not found. This test never connects to an existing database.`);
}
const bins = Object.fromEntries(["initdb", "pg_ctl", "psql"].map(name => [name, binary(name)]));
// Darwin's normal temporary directory can exceed PostgreSQL's Unix socket path limit.
const dir = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "title-missive-sql-"));
const data = path.join(dir, "data"), user = "title_sql_fixture", port = "55439";
const command = (name, args, options = {}) => execFileSync(bins[name], args, { encoding: "utf8", maxBuffer: 8_000_000, ...options });
const sql = text => command("psql", ["-X", "-h", dir, "-p", port, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: text });
let started = false;
try {
  command("initdb", ["-D", data, `--username=${user}`, "--auth-local=trust", "--auth-host=reject", "--no-locale"]);
  command("pg_ctl", ["-D", data, "-l", path.join(dir, "server.log"), "-o", `-k '${dir.replaceAll("'", "'\\''")}' -h '' -p ${port} -F`, "-w", "start"]); started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  for (const file of ["20260912142734_title_backend_foundation.sql", "20260912145505_title_explicit_conflicts.sql", "20260912163349_title_missive_reviewed_import.sql", "20260914200453_title_reviewed_attachment_commit.sql", "20260914202646_title_missive_event_transactions.sql"])
    sql(fs.readFileSync(path.join(root, "supabase/migrations", file), "utf8"));
  const result = sql(`
    create function pg_temp.check_true(ok boolean,label text) returns integer language plpgsql as $$
    begin if ok is distinct from true then raise exception 'Regression failed: %',label; end if; return 1; end $$;
    create function pg_temp.expect_error(expected text,statement text) returns integer language plpgsql as $$
    begin
      begin execute statement; raise exception 'Expected rejection did not occur' using errcode='PTBAD';
      exception when others then if sqlstate<>expected then raise; end if; end;
      return 1;
    end $$;
    create function pg_temp.fail_queue_update() returns trigger language plpgsql as $$
    begin
      if current_setting('title_test.fail_queue',true)='yes' and new.status='completed' then
        raise exception 'Synthetic queue update failure' using errcode='PTTST';
      end if;
      return new;
    end $$;
    create trigger test_queue_failure before update on public.title_jobs for each row execute function pg_temp.fail_queue_update();
    do $$ begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
    do $$
    declare actor uuid=gen_random_uuid(); w uuid; listing_workspace uuid; first_page text[]; next_page text[]; request uuid; result jsonb; event jsonb; expected_state jsonb; count_passed integer=0; checks integer=0; run integer;
      attachment_rpc text='public.title_import_missive_attachment(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text)';
      text_rpc text='public.title_import_missive(uuid,uuid,text,bigint,bigint,uuid,text,jsonb,bigint,text)';
      enqueue_rpc text='public.title_enqueue_missive_event(uuid,jsonb)';
      pending_rpc text='public.title_pending_missive_events(uuid,integer)'; signature text;
    begin
      foreach signature in array array[attachment_rpc,text_rpc,enqueue_rpc,pending_rpc] loop
        checks=checks+pg_temp.check_true(not has_function_privilege('anon',signature,'execute'),'anonymous RPC denied');
        checks=checks+pg_temp.check_true(not has_function_privilege('authenticated',signature,'execute'),'authenticated browser RPC denied');
        checks=checks+pg_temp.check_true(has_function_privilege('service_role',signature,'execute'),'service RPC executable');
      end loop;
      insert into auth.users(id,email,email_confirmed_at) values(actor,'sql-fixture@example.test',now());
      set local role service_role;
      for run in 1..5 loop
        begin
          insert into public.title_workspaces(name,state) values('Missive isolated SQL fixture','{"companies":[{"id":"company-a"}],"inbox":[]}') returning id into w;
          insert into public.title_memberships(workspace_id,user_id,role,all_companies) values(w,actor,'owner',true);
          result=public.title_save_missive_mapping(w,actor,'sql-fixture@example.test',1,0,'{"companyId":"company-a","teamId":"team-a","organizationId":"org-a"}');
          checks=checks+pg_temp.check_true(result->>'version'='1','mapping version recorded');
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_import_missive_attachment(%L,%L,%L,1,0,%L,%L,%L,2,%L)',w,actor,'sql-fixture@example.test',gen_random_uuid(),'hash','{}','company-a'));
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_import_missive_attachment(%L,%L,%L,1,0,%L,%L,%L,1,%L)',w,actor,'sql-fixture@example.test',gen_random_uuid(),'hash','{}','other-company'));
          update public.title_memberships set role='operations' where workspace_id=w;
          checks=checks+pg_temp.expect_error('42501',format('select public.title_import_missive_attachment(%L,%L,%L,1,0,%L,%L,%L,1,%L)',w,actor,'sql-fixture@example.test',gen_random_uuid(),'hash','{}','company-a'));
          update public.title_memberships set role='owner' where workspace_id=w;
          request=gen_random_uuid();
          expected_state='{"companies":[{"id":"company-a"}],"inbox":[],"attachment":"immutable-fixture"}'::jsonb;
          result=public.title_import_missive_attachment(w,actor,'sql-fixture@example.test',1,0,request,'good-hash',expected_state,1,'company-a');
          checks=checks+pg_temp.check_true(result->>'revision'='1' and result->>'replayed'='false','attachment commit');
          result=public.title_import_missive_attachment(w,actor,'sql-fixture@example.test',1,0,request,'good-hash','{}',1,'company-a');
          checks=checks+pg_temp.check_true(result->>'replayed'='true','attachment receipt replay');
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_import_missive_attachment(%L,%L,%L,1,1,%L,%L,%L,1,%L)',w,actor,'sql-fixture@example.test',request,'changed-hash','{}','company-a'));
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_import_missive_attachment(%L,%L,%L,1,0,%L,%L,%L,1,%L)',w,actor,'sql-fixture@example.test',gen_random_uuid(),'hash','{}','company-a'));
          checks=checks+pg_temp.check_true((select detail->'actions' from public.title_audit where workspace_id=w and action='workspace.commands')='["importMissiveAttachment"]'::jsonb,'attachment audit label');
          checks=checks+pg_temp.check_true((select state from public.title_workspaces where id=w)=expected_state and (select count(*) from public.title_command_receipts where workspace_id=w)=1,'rejected attachment operations preserve state/receipt');
          event='{"organizationId":"org-a","teamId":"team-a","companyId":"company-a","mappingVersion":1,"messageId":"message-a","conversationId":"conversation-a","subject":"Fictional source"}'::jsonb;
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"mappingVersion":2}'::jsonb));
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"companyId":"other-company"}'::jsonb));
          checks=checks+pg_temp.check_true((select count(*) from public.title_jobs where workspace_id=w)=0,'rejected mapping creates no queue records');
          checks=checks+pg_temp.check_true(public.title_enqueue_missive_event(w,event),'first incoming source enqueued');
          checks=checks+pg_temp.check_true(not public.title_enqueue_missive_event(w,event),'duplicate source acknowledged without another queue record');
          checks=checks+pg_temp.check_true((select count(*) from public.title_jobs where workspace_id=w)=1 and (select status from public.title_jobs where workspace_id=w)='queued','queue remains one pending event');
          result=public.title_save_missive_mapping(w,actor,'sql-fixture@example.test',1,1,'{"companyId":"company-a","teamId":"team-a","organizationId":"org-a"}');
          checks=checks+pg_temp.expect_error('PT409',format('select public.title_enqueue_missive_event(%L,%L)',w,event||'{"messageId":"superseded-event"}'::jsonb));
          event=event||'{"mappingVersion":2}'::jsonb;
          checks=checks+pg_temp.check_true(not public.title_enqueue_missive_event(w,event),'dedup identity survives same-destination mapping version change');
          expected_state=expected_state||'{"inbox":[{"missive":{"organizationId":"org-a","messageId":"message-a"}},{"missive":{"organizationId":"org-a","messageId":"late-message"}}]}'::jsonb;
          request=gen_random_uuid();
          result=public.title_import_missive(w,actor,'sql-fixture@example.test',1,1,request,'reviewed-message',expected_state,2,'company-a');
          checks=checks+pg_temp.check_true(result->>'revision'='2' and result->>'replayed'='false','reviewed message commit');
          checks=checks+pg_temp.check_true((select status from public.title_jobs where workspace_id=w and external_id='org-a:message-a')='completed','message import completes queued event atomically');
          result=public.title_import_missive(w,actor,'sql-fixture@example.test',1,1,request,'reviewed-message','{}',2,'company-a');
          checks=checks+pg_temp.check_true(result->>'replayed'='true' and (select revision from public.title_workspaces where id=w)=2,'replay uses persisted state and does not advance revision');
          checks=checks+pg_temp.check_true(public.title_enqueue_missive_event(w,event||'{"messageId":"late-message"}'::jsonb),'late source event recorded');
          checks=checks+pg_temp.check_true((select status from public.title_jobs where workspace_id=w and external_id='org-a:late-message')='completed','already-imported late event is completed immediately');
          checks=checks+pg_temp.check_true(public.title_enqueue_missive_event(w,event||'{"messageId":"failed-message"}'::jsonb),'next review event queued');
          request=gen_random_uuid();
          perform set_config('title_test.fail_queue','yes',true);
          checks=checks+pg_temp.expect_error('PTTST',format('select public.title_import_missive(%L,%L,%L,1,2,%L,%L,%L,2,%L)',w,actor,'sql-fixture@example.test',request,'rollback-message',expected_state||jsonb_build_object('inbox',(expected_state->'inbox')||'[{"missive":{"organizationId":"org-a","messageId":"failed-message"}}]'::jsonb),'company-a'));
          perform set_config('title_test.fail_queue','no',true);
          checks=checks+pg_temp.check_true((select state from public.title_workspaces where id=w)=expected_state and (select revision from public.title_workspaces where id=w)=2,'queue failure rolls back document state/revision');
          checks=checks+pg_temp.check_true(not exists(select 1 from public.title_command_receipts where workspace_id=w and request_id=request) and not exists(select 1 from public.title_audit where workspace_id=w and request_id=request),'queue failure rolls back receipt and audit');
          checks=checks+pg_temp.check_true((select status from public.title_jobs where workspace_id=w and external_id='org-a:failed-message')='queued','queue failure retains pending source event');
          -- Exercise the listing against its actual stored SQL function, including
          -- the UI's 100-row page plus a 101st-row has-more sentinel.
          insert into public.title_workspaces(name,state) values('Pending queue SQL fixture','{"companies":[{"id":"former-company"},{"id":"current-company"}],"inbox":[]}') returning id into listing_workspace;
          insert into public.title_integrations(workspace_id,provider,status,config) values(listing_workspace,'missive','configured',
            '{"mapping":{"organizationId":"org-a","teamId":"current-team","companyId":"current-company","version":3}}');
          insert into public.title_jobs(workspace_id,provider,external_id,kind,payload,status,created_at)
            select listing_workspace,'missive','completed-'||n,'incoming_review',jsonb_build_object('messageId','completed-'||n),'completed',
              '2026-09-14 13:00:00+00'::timestamptz+n*interval '1 second' from generate_series(1,100) n;
          insert into public.title_jobs(workspace_id,provider,external_id,kind,payload,status,created_at) values(listing_workspace,'missive','org-a:legacy-pending','incoming_review',
            '{"messageId":"legacy-pending","companyId":"former-company","teamId":"former-team","organizationId":"org-a","mappingVersion":1}',
            'queued','2026-09-14 12:00:00+00');
          checks=checks+pg_temp.check_true((select count(*) from public.title_pending_missive_events(listing_workspace,0))=1,
            '100 recent completed records cannot bury one older pending event');
          checks=checks+pg_temp.check_true((select payload->>'companyId'='former-company' and payload->>'teamId'='former-team' and payload->>'mappingVersion'='1'
            from public.title_pending_missive_events(listing_workspace,0)),'former routing remains visible with original company/team/version');
          insert into public.title_jobs(id,workspace_id,provider,external_id,kind,payload,status,created_at)
            select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,listing_workspace,'missive','pending-'||n,'incoming_review',
              jsonb_build_object('messageId','pending-'||lpad(n::text,3,'0')),'queued','2026-09-14 12:01:00+00' from generate_series(1,99) n;
          checks=checks+pg_temp.check_true((select count(*) from public.title_pending_missive_events(listing_workspace,0))=100,
            'exactly 100 pending rows fit one page without sentinel');
          checks=checks+pg_temp.check_true((select count(*) from public.title_pending_missive_events(listing_workspace,100))=0,
            'offset 100 is empty when only 100 pending rows exist');
          insert into public.title_jobs(id,workspace_id,provider,external_id,kind,payload,status,created_at) values(
            '00000000-0000-4000-8000-000000000100',listing_workspace,'missive','pending-100','incoming_review','{"messageId":"pending-100"}',
            'queued','2026-09-14 12:01:00+00');
          select array_agg(payload->>'messageId' order by created_at,id) into first_page from public.title_pending_missive_events(listing_workspace,0);
          select array_agg(payload->>'messageId' order by created_at,id) into next_page from public.title_pending_missive_events(listing_workspace,100);
          checks=checks+pg_temp.check_true(array_length(first_page,1)=101,'101st pending row signals another page');
          checks=checks+pg_temp.check_true(first_page[1]='legacy-pending' and first_page[2]='pending-001' and first_page[100]='pending-099',
            'pending order is oldest first, with stable ID tie-breaking');
          checks=checks+pg_temp.check_true(next_page=array['pending-100'] and first_page[101]=next_page[1],
            'next page begins with sentinel row, without skipping or duplicating a displayed row');
          checks=checks+pg_temp.check_true((select array_agg(payload->>'messageId' order by created_at,id) from public.title_pending_missive_events(listing_workspace,0))=first_page,
            'unchanged queue page order is repeatable');
          checks=checks+pg_temp.check_true((select count(*) from public.title_pending_missive_events(w,0))=1 and
            (select payload->>'messageId' from public.title_pending_missive_events(w,0))='failed-message','pending results are isolated to the requested workspace');
          checks=checks+pg_temp.expect_error('P0001',format('select * from public.title_pending_missive_events(%L,-1)',listing_workspace));
          checks=checks+pg_temp.expect_error('P0001',format('select * from public.title_pending_missive_events(%L,null)',listing_workspace));
          checks=checks+pg_temp.expect_error('P0001',format('select * from public.title_pending_missive_events(%L,1000001)',listing_workspace));
          update public.title_memberships set active=false,version=2 where workspace_id=w;
          checks=checks+pg_temp.expect_error('42501',format('select public.title_import_missive_attachment(%L,%L,%L,1,2,%L,%L,%L,2,%L)',w,actor,'sql-fixture@example.test',gen_random_uuid(),'revoked','{}','company-a'));
          checks=checks+pg_temp.expect_error('42501',format('select public.title_import_missive(%L,%L,%L,1,2,%L,%L,%L,2,%L)',w,actor,'sql-fixture@example.test',gen_random_uuid(),'revoked','{}','company-a'));
          raise exception 'Rollback successful round fixtures' using errcode='PTCMP';
        exception when sqlstate 'PTCMP' then count_passed=count_passed+1;
        end;
      end loop;
      checks=checks+pg_temp.check_true(count_passed=5,'all five independent rounds passed');
      checks=checks+pg_temp.check_true((select count(*) from public.title_workspaces)=0 and (select count(*) from public.title_jobs)=0 and (select count(*) from public.title_command_receipts)=0,'all synthetic round records rolled back');
      raise notice 'PASS: % transaction assertions across five rounds, using only a disposable local PostgreSQL socket',checks;
    end $$;
    select 'Missive SQL verification complete: five independent rounds passed';
  `);
  console.log(result.trim());
} finally {
  try { if (started) command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
