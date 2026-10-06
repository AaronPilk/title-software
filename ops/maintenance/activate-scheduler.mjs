/** Env-only secret provisioning; no secret, provider body or SQL is logged. */
import fs from 'node:fs';
const required = ['SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF','SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exitCode = 1; }
else if (!/^[a-z0-9]{10,40}$/.test(process.env.SUPABASE_PROJECT_REF) || process.env.SUPABASE_SERVICE_ROLE_KEY.length < 20) { console.error('Invalid project reference or service-key configuration.'); process.exitCode = 1; }
else if (!process.argv.includes('--activate')) console.log('Configuration is present. Run with --activate after deploying title-maintenance and its database migration. Email delivery is controlled separately and remains disabled by default.');
else {
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  const ref = process.env.SUPABASE_PROJECT_REF;
  const endpoint = `https://${ref}.supabase.co/functions/v1/title-maintenance`;
  const secretSql = (name, value) => `select vault.update_secret(id,${literal(value)}) from vault.secrets where name=${literal(name)}; select vault.create_secret(${literal(value)},${literal(name)},'Agency maintenance scheduler') where not exists(select 1 from vault.secrets where name=${literal(name)});`;
  const sql = `begin;\n${fs.readFileSync(new URL('./activate-scheduler.sql', import.meta.url),'utf8')}\n${secretSql('title_maintenance_worker_url',endpoint)}\n${secretSql('title_maintenance_service_role_key',process.env.SUPABASE_SERVICE_ROLE_KEY)}\ncommit;`;
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Activation failed.'); }
    await response.body?.cancel();
    console.log('Hourly scheduler registered and Vault configuration provisioned in the existing project. This command did not run a tick or enable email delivery.');
  } catch { console.error('Scheduler activation failed. Check database extension support and management-token access. Secret values were not logged.'); process.exitCode=1; }
}
