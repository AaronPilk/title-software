import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const wid='11111111-1111-4111-8111-111111111111', actor='22222222-2222-4222-8222-222222222222', invitation='33333333-3333-4333-8333-333333333333', request='44444444-4444-4444-8444-444444444444', deliveryId='55555555-5555-4555-8555-555555555555';
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
let f,handler;
const ok=data=>({data,error:null});
const providerResult=async(kind,args)=>{f.sends.push({kind,args});if(f.providerThrow)throw Error('PRIVATE_PROVIDER_ERROR');return {data:{user:{secret:'PRIVATE_AUTH_TOKEN'}},error:f.providerError};};
const client={auth:{getUser:async()=>ok({user:{id:actor,email:'owner@example.test',email_confirmed_at:'2026-01-01'}}),getClaims:async()=>ok({claims:{sub:actor,session_id:request,aal:'aal2'}}),
 admin:{inviteUserByEmail:(...args)=>providerResult('invite',args)},signInWithOtp:(...args)=>providerResult('magiclink',args)},
 rpc(name,args){f.calls.push({name,args});let result;
  if(name==='title_security_state')result=ok({session_valid:true,password_change_required:false,has_totp:true,session_totp:true});
  else if(name==='title_begin_invitation_email')result=f.beginError?{data:null,error:f.beginError}:ok(f.begin);
  else if(name==='title_finish_invitation_email'){f.finishes++;result=f.finishErrors-->0?{data:null,error:{code:'08006',message:'PRIVATE_DB_ERROR'}}:ok({id:deliveryId,status:args.p_status});}
  else throw Error(`Unexpected RPC ${name}`);
  const promise=Promise.resolve(result);promise.abortSignal=signal=>{assert(signal instanceof AbortSignal);return promise;};return promise;
 },
 from(table){assert.equal(table,'title_memberships');const filters=[];return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},async maybeSingle(){assert(filters.some(([k,v])=>k==='workspace_id'&&v===wid));return ok({role:f.role,all_companies:true,company_ids:[],restricted_access:true,partner_members:[],version:4});}};}
};
globalThis.__emailFixture=client;
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://synthetic.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',TITLE_INVITATION_EMAIL_ENABLED:f?.enabled,TITLE_INVITATION_REDIRECT_URL:f?.redirect})[key]},serve:callback=>{handler=callback;}};
globalThis.fetch=async()=>{throw Error('No actual mail or network is permitted in these tests');};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/title-api/index.ts',import.meta.url))],write:false,bundle:true,format:'esm',platform:'node',target:'es2022',logLevel:'silent',plugins:[{name:'email-fixture',setup(b){b.onResolve({filter:/^npm:@supabase\/supabase-js@/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__emailFixture;'}));}}]});
await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
beforeEach(()=>{f={role:'owner',enabled:'true',redirect:'https://pilot.example.test/',calls:[],sends:[],finishes:0,finishErrors:0,providerError:null,providerThrow:false,beginError:null,begin:{id:deliveryId,send:true,email:'invited@example.test',kind:'invite',status:'sending'}};});
after(()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__emailFixture;});
async function send(more={}){const response=await handler(new Request('https://synthetic.example.test/functions/v1/title-api/members/invitations/send',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({workspaceId:wid,invitationId:invitation,expectedVersion:2,requestId:request,...more})}));const body=await response.json();assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|access_token|refresh_token/);return {status:response.status,body};}
test('delivery disabled by default reaches neither lease nor provider',async()=>{f.enabled=undefined;assert.equal((await send()).status,503);assert.equal(f.sends.length,0);assert(!f.calls.some(c=>c.name==='title_begin_invitation_email'));});
for(const redirect of ['http://unsafe.example.test/','https://user:password@pilot.example.test/','https://pilot.example.test/?next=elsewhere','https://pilot.example.test/#token','broken'])test(`invalid configured redirect is not used: ${redirect}`,async()=>{f.redirect=redirect;assert.equal((await send()).status,503);assert.equal(f.sends.length,0);});
test('operations cannot request setup mail',async()=>{f.role='operations';assert.equal((await send()).status,403);assert.equal(f.sends.length,0);});
test('lease conflicts prevent all provider traffic',async()=>{f.beginError={code:'40001',message:'Invitation changed'};assert.equal((await send()).status,409);assert.equal(f.sends.length,0);});
test('new account receives Auth invitation only to persisted recipient with configured redirect',async()=>{const r=await send({email:'attacker@example.test',redirectTo:'https://attacker.example.test'});assert.equal(r.status,200);assert.equal(r.body.status,'sent');assert.equal(r.body.recorded,true);assert.deepEqual(f.sends,[{kind:'invite',args:['invited@example.test',{redirectTo:'https://pilot.example.test/'}]}]);assert.match(r.body.message,/provider accepted/);assert.match(r.body.message,/not been confirmed/);});
test('existing account uses passwordless setup link without creating or resetting an account',async()=>{f.begin.kind='magiclink';const r=await send();assert.equal(r.body.status,'sent');assert.deepEqual(f.sends,[{kind:'magiclink',args:[{email:'invited@example.test',options:{shouldCreateUser:false,emailRedirectTo:'https://pilot.example.test/'}}]}]);});
for(const status of ['sending','sent','failed','unknown'])test(`replaying ${status} delivery never sends again`,async()=>{f.begin={id:deliveryId,send:false,status};const r=await send();assert.equal(r.body.status,status);assert.equal(f.sends.length,0);assert.equal(f.finishes,0);});
test('definitive provider rejection is recorded as failed',async()=>{f.providerError={status:422,message:'PRIVATE_PROVIDER_ERROR'};const r=await send();assert.equal(r.body.status,'failed');assert.equal(f.calls.at(-1).args.p_status,'failed');});
for(const error of [{status:503},{},'throw'])test(`uncertain provider result ${JSON.stringify(error)} is recorded without resending`,async()=>{if(error==='throw')f.providerThrow=true;else f.providerError=error;const r=await send();assert.equal(r.body.status,'unknown');assert.equal(f.sends.length,1);assert.match(r.body.message,/duplicate/);});
test('transient finalization failure retries only recording the identical outcome',async()=>{f.finishErrors=1;const r=await send();assert.equal(r.body.recorded,true);assert.equal(f.finishes,2);assert.equal(f.sends.length,1);const calls=f.calls.filter(c=>c.name==='title_finish_invitation_email');assert.deepEqual(calls[0].args,calls[1].args);});
test('unrecorded provider acceptance remains explicit and does not resend',async()=>{f.finishErrors=5;const r=await send();assert.equal(r.body.status,'sent');assert.equal(r.body.recorded,false);assert.match(r.body.message,/status could not be saved/);assert.equal(f.finishes,2);assert.equal(f.sends.length,1);});
test('delivery lease binds exact grant, actor and idempotency key',async()=>{await send();const call=f.calls.find(c=>c.name==='title_begin_invitation_email');assert.deepEqual(call.args,{p_workspace:wid,p_actor:actor,p_email:'owner@example.test',p_access_version:4,p_invitation:invitation,p_expected:2,p_request:request});});
