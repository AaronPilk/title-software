/** Env-only secret provisioning; no secret, provider body or SQL is logged. */
import fs from 'node:fs';
const required = ['SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF','TITLE_MAINTENANCE_SCHEDULER_KEY'];
const missing = required.filter(name => !process.env[name]);
// This catches configuration mistakes only; the Edge gateway verifies the signature.
function schedulerKeyValid(value, ref) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return false;
    const parts = value.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.role === 'service_role' && claims.ref === ref && Number.isSafeInteger(claims.exp) && claims.exp > Date.now() / 1000;
  } catch { return false; }
}
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exitCode = 1; }
else if (!/^[a-z0-9]{10,40}$/.test(process.env.SUPABASE_PROJECT_REF) || !schedulerKeyValid(process.env.TITLE_MAINTENANCE_SCHEDULER_KEY, process.env.SUPABASE_PROJECT_REF)) { console.error('Invalid project reference or scheduler JWT role, project or expiration.'); process.exitCode = 1; }
else if (!process.argv.includes('--activate')) console.log('Scheduler JWT claims match the project and are unexpired; signature is checked by the Edge gateway. Install this exact TITLE_MAINTENANCE_SCHEDULER_KEY in the function environment, deploy title-maintenance and apply its migration before running --activate. Email delivery is controlled separately and remains disabled by default.');
else {
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  const ref = process.env.SUPABASE_PROJECT_REF;
  const endpoint = `https://${ref}.supabase.co/functions/v1/title-maintenance`;
  const secretSql = (name, value) => `select vault.update_secret(id,${literal(value)}) from vault.secrets where name=${literal(name)}; select vault.create_secret(${literal(value)},${literal(name)},'Agency maintenance scheduler') where not exists(select 1 from vault.secrets where name=${literal(name)});`;
  const sql = `begin;\n${fs.readFileSync(new URL('./activate-scheduler.sql', import.meta.url),'utf8')}\n${secretSql('title_maintenance_worker_url',endpoint)}\n${secretSql('title_maintenance_service_role_key',process.env.TITLE_MAINTENANCE_SCHEDULER_KEY)}\ncommit;`;
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Activation failed.'); }
    await response.body?.cancel();
    console.log('Hourly scheduler registered and Vault configuration provisioned in the existing project. This command did not run a tick or enable email delivery.');
  } catch { console.error('Scheduler activation failed. Check database extension support and management-token access. Secret values were not logged.'); process.exitCode=1; }
}
