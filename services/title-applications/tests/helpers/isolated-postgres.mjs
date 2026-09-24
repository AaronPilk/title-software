/** Dedicated socket-only PostgreSQL fixture. No configured database URL or credentials are read. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const fixtureIds = {
  workspace: "e9200000-0000-4000-8000-000000000010",
  owner: "e9100000-0000-4000-8000-000000000010",
  staff: "e9100000-0000-4000-8000-000000000011",
  company: "C1",
};
export const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export const jsonLiteral = value => `${literal(JSON.stringify(value))}::jsonb`;

export function createIsolatedPostgres(repo) {
  const dirs = [process.env.TITLE_TEST_PG_BIN, ...(process.env.PATH || "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean);
  const binary = name => { for (const dir of dirs) { const candidate = path.join(dir, name); try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {} } throw new Error(`Local PostgreSQL ${name} is required. Set TITLE_TEST_PG_BIN. Hosted databases are never used.`); };
  const bins = Object.fromEntries(["initdb", "pg_ctl", "psql"].map(name => [name, binary(name)]));
  const dir = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "title-jv-browser-pg-"));
  const data = path.join(dir, "data"), user = "title_jv_browser_fixture", port = "55461";
  const command = (name, args, options = {}) => execFileSync(bins[name], args, { encoding: "utf8", maxBuffer: 8_000_000, stdio: ["pipe", "pipe", "pipe"], ...options });
  const args = ["-X", "-h", dir, "-p", port, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At"];
  const sql = input => command("psql", args, { input });
  let started = false;
  const stop = () => { try { if (started) { command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); started = false; } } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
  try {
    command("initdb", ["-D", data, `--username=${user}`, "--auth-local=trust", "--auth-host=reject", "--no-locale"]);
    command("pg_ctl", ["-D", data, "-l", path.join(dir, "server.log"), "-o", `-k '${dir}' -h '' -p ${port} -F`, "-w", "start"]); started = true;
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      grant usage on schema auth to service_role; grant execute on function auth.uid() to service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
    for (const name of ["20260912142734_title_backend_foundation.sql", "20260912145118_title_verified_access_gateway.sql", "20260912145505_title_explicit_conflicts.sql", "20260919215301_title_staff_access_lifecycle.sql"]) sql(fs.readFileSync(path.join(repo, "supabase/migrations", name), "utf8"));
    // This exercises the Vault API and actual encrypted PostgreSQL values. It does
    // not validate Supabase's Vault extension implementation or its hosted key setup.
    sql(`create extension pgcrypto; create schema vault;
      create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null,name text unique,description text);
      create view vault.decrypted_secrets as select id,public.pgp_sym_decrypt(decode(secret,'base64'),'FICTIONAL_BROWSER_KEY_ONLY') as decrypted_secret from vault.secrets;
      create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql set search_path='' as $$ declare result uuid; begin
        insert into vault.secrets(secret,name,description) values(encode(public.pgp_sym_encrypt(new_secret,'FICTIONAL_BROWSER_KEY_ONLY'),'base64'),new_name,new_description) returning id into result; return result; end $$;
      create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void language plpgsql set search_path='' as $$ begin
        update vault.secrets set secret=encode(public.pgp_sym_encrypt(new_secret,'FICTIONAL_BROWSER_KEY_ONLY'),'base64') where id=secret_id;
        if not found then raise exception 'Fictional fixture unavailable'; end if; end $$;
      revoke all on schema vault from public,anon,authenticated,service_role;
      revoke all on all tables in schema vault from public,anon,authenticated,service_role;
      revoke all on all functions in schema vault from public,anon,authenticated,service_role;
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);`);
    for (const name of ["20260924150748_title_jv_intake.sql", "20260924155947_title_jv_recipient_portal.sql"]) sql(fs.readFileSync(path.join(repo, "supabase/migrations", name), "utf8"));
    const { workspace, owner, staff, company } = fixtureIds;
    sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.test',now()),('${staff}','staff@example.test',now());
      set role service_role;
      insert into public.title_workspaces(id,name,state) values('${workspace}','Fictional integrated recipient test','{"companies":[{"id":"${company}","name":"Fictional Integrated Venture"},{"id":"C2","name":"Other Fictional Venture"}],"documents":[]}');
      insert into public.title_memberships(workspace_id,user_id,role,company_ids,all_companies,restricted_access)
        values('${workspace}','${owner}','owner','{}',true,true),('${workspace}','${staff}','onboarding',array['${company}'],false,true);`);
    async function rpc(name, input) {
      const fields = {
        title_jv_portal_staff: ["p_workspace", "p_actor", "p_access_version", "p_company", "p_action", "p_input"],
        title_jv_portal_public: ["p_action", "p_credential", "p_ip_hash", "p_input"],
        title_jv_intake: ["p_workspace", "p_actor", "p_access_version", "p_company", "p_action", "p_input"],
      }[name];
      if (!fields || fields.some(key => !Object.hasOwn(input, key)) || Object.keys(input).length !== fields.length) throw new Error("Unexpected fixture RPC shape.");
      const params = fields.map(key => key === "p_input" ? jsonLiteral(input[key]) : literal(input[key])).join(",");
      try {
        const output = sql(`set role service_role; select public.${name}(${params});`);
        return JSON.parse(output.trim().split("\n").filter(line => line.startsWith("{") || line === "null").at(-1));
      } catch (error) {
        const code = String(error.stderr || "").match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
        // Match the hosted RPC's structured error boundary without exposing SQL values.
        throw Object.assign(new Error("Isolated fixture RPC failed."), { code: code || "fixture_failure" });
      }
    }
    return { sql, rpc, stop };
  } catch (error) { stop(); throw error; }
}
