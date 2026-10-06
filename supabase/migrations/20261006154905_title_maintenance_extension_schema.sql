-- Correct the freshly installed, unused scheduler extension before its first run.
-- pg_net is not relocatable. Refuse to remove any queued requests or history;
-- DROP without CASCADE also refuses unexpected dependencies. All runs atomically.
do $$
begin
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_net' and n.nspname='public') then
    if exists(select 1 from net.http_request_queue) or exists(select 1 from net._http_response) then
      raise exception 'pg_net has request history; review extension migration before continuing.';
    end if;
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
