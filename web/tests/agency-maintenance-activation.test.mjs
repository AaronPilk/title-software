import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../../ops/maintenance/activate-scheduler.mjs',import.meta.url));
const project='fictionalproject123456';
const jwt=claims=>`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic_signature`;
const claims={role:'service_role',ref:project,exp:Math.floor(Date.now()/1000)+3600};
const run=key=>spawnSync(process.execPath,[script],{encoding:'utf8',env:{SUPABASE_ACCESS_TOKEN:'fictional-management-token',SUPABASE_PROJECT_REF:project,SUPABASE_SERVICE_ROLE_KEY:'fictional-database-key',...(key?{TITLE_MAINTENANCE_SCHEDULER_KEY:key}:{})}});
test('activation requires a dedicated scheduler key even when a database client key exists',()=>{const result=run();assert.equal(result.status,1);assert.match(result.stderr,/TITLE_MAINTENANCE_SCHEDULER_KEY/);assert.doesNotMatch(result.stderr,/fictional-database-key|fictional-management-token/);});
test('activation dry run validates scheduler role, project and expiry without provider or database calls',()=>{
 const valid=jwt(claims),result=run(valid);assert.equal(result.status,0);assert.match(result.stdout,/signature is checked by the Edge gateway/);assert.match(result.stdout,/exact TITLE_MAINTENANCE_SCHEDULER_KEY/);assert.ok(!result.stdout.includes(valid));
 for(const key of ['not-a-jwt',jwt({...claims,role:'anon'}),jwt({...claims,ref:'another-project'}),jwt({...claims,exp:1})]){const invalid=run(key);assert.equal(invalid.status,1);assert.match(invalid.stderr,/scheduler JWT role, project or expiration/);assert.ok(!invalid.stderr.includes(key));}
});
