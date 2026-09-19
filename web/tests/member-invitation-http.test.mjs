// Actual title-api HTTP handler; SQL semantics are verified separately in disposable PostgreSQL.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const workspaceId='11111111-1111-4111-8111-111111111111', actorId='22222222-2222-4222-8222-222222222222';
const invitationId='44444444-4444-4444-8444-444444444444', requestId='55555555-5555-4555-8555-555555555555';
const targetId='66666666-6666-4666-8666-666666666666', actorEmail='owner@example.test';
const originalFetch=globalThis.fetch, originalDeno=globalThis.Deno;
let handler, fixture;
const ok=data=>({data,error:null});
const grant=(extra={})=>({email:'staff@example.test',role:'operations',companyIds:['A'],allCompanies:false,restricted:false,partnerMembers:[],requestId,...extra});
const client={
 auth:{getUser:async()=>ok({user:{id:actorId,email:actorEmail,email_confirmed_at:'2026-01-01'}}),
 getClaims:async()=>ok({claims:{sub:actorId,session_id:'33333333-3333-4333-8333-333333333333',aal:'aal2'}})},
 async rpc(name,args){
  if(name==='title_security_state') return ok({session_valid:true,password_change_required:false,has_totp:true,session_totp:true});
  fixture.calls.push({name,args:structuredClone(args)});
  return fixture.rpcError?{data:null,error:fixture.rpcError}:ok(fixture.result);
 },
 from(table){
  const query={table,filters:[],columns:'*'};fixture.queries.push(query);
  const rows=()=>{
   if(table==='title_memberships') return [{workspace_id:workspaceId,user_id:actorId,role:fixture.role,all_companies:fixture.allCompanies,company_ids:['A'],restricted_access:true,partner_members:[],active:true,version:7}];
   if(table==='title_invitations') return fixture.invitations;
   throw Error(`Unexpected direct table read ${table}`);
  };
  const selected=()=>rows().filter(row=>query.filters.every(([key,value])=>row[key]===value));
  return {select(columns='*'){query.columns=columns;return this;},eq(key,value){query.filters.push([key,value]);return this;},
   async maybeSingle(){const values=selected();assert(values.length<=1);return ok(values[0]||null);},
   then(resolve,reject){return Promise.resolve(ok(selected())).then(resolve,reject);},
   insert(){throw Error('Access mutation must use a transaction RPC');},update(){throw Error('Access mutation must use a transaction RPC');}};
 }
};
globalThis.__titleInvitationClient=client;
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://synthetic.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'})[name]},serve:callback=>{handler=callback;}};
globalThis.fetch=async()=>{throw Error('No live provider request allowed');};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/title-api/index.ts',import.meta.url))],write:false,bundle:true,format:'esm',platform:'node',target:'es2022',logLevel:'silent',plugins:[{name:'fixture',setup(builder){builder.onResolve({filter:/^npm:@supabase\/supabase-js@/},()=>({path:'client',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__titleInvitationClient;'}));}}]});
await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
beforeEach(()=>{fixture={role:'owner',allCompanies:true,calls:[],queries:[],invitations:[],rpcError:null,result:{id:invitationId,version:1,expires_at:'2099-01-01',replayed:false}};});
after(()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__titleInvitationClient;});
async function call(path,input){const response=await handler(new Request(`https://synthetic.example.test/functions/v1/title-api${path}`,{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({workspaceId,...input})}));return {status:response.status,body:await response.json()};}
const invite=input=>call('/members/invite',input??grant());
test('prepare routes the canonical exact grant and current actor version to one transaction',async()=>{
 const r=await invite(grant({email:' STAFF@example.test ',companyIds:['B','A','B']}));assert.equal(r.status,200);assert.match(r.body.status,/prepared; no email sent/);
 assert.deepEqual(fixture.calls,[{name:'title_prepare_invitation',args:{p_workspace:workspaceId,p_actor:actorId,p_email:actorEmail,p_access_version:7,p_recipient:'staff@example.test',p_role:'operations',p_companies:['A','B'],p_all_companies:false,p_restricted:false,p_partner_members:[],p_invitation:null,p_expected:null,p_reissue:false,p_request:requestId}}]);
});
test('a new prepare without an idempotency key cannot reach the mutation RPC',async()=>{const r=await invite(grant({requestId:undefined}));assert.equal(r.status,400);assert.equal(fixture.calls.length,0);});
test('edit carries invitation identity and reviewed version, never a fresh create request',async()=>{const r=await invite(grant({invitationId,expectedVersion:3}));assert.equal(r.status,200);assert.match(r.body.status,/updated/);assert.equal(fixture.calls[0].args.p_expected,3);assert.equal(fixture.calls[0].args.p_invitation,invitationId);assert.equal(fixture.calls[0].args.p_request,null);});
for(const value of [undefined,0,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1])test(`edit rejects invalid reviewed version ${value}`,async()=>{const r=await invite(grant({invitationId,expectedVersion:value}));assert.equal(r.status,409);assert.equal(fixture.calls.length,0);});
for(const role of ['viewer','partner','operations','onboarding','finance'])test(`${role} cannot administer invitations`,async()=>{fixture.role=role;assert.equal((await invite()).status,403);assert.equal(fixture.calls.length,0);});
test('company-scoped admin cannot administer invitations',async()=>{fixture.role='admin';fixture.allCompanies=false;assert.equal((await invite()).status,403);});
for(const [name,change] of Object.entries({email:{email:'bad'},role:{role:'owner'},companies:{companyIds:{}},partners:{partnerMembers:{}},boolean:{allCompanies:'false'},member:{partnerMembers:[{companyId:'A'}]}}))test(`invalid ${name} rejected before RPC`,async()=>{assert.equal((await invite(grant(change))).status,400);assert.equal(fixture.calls.length,0);});
for(const [code,status] of [['40001',409],['PT409',409],['42501',403],['22023',400]])test(`SQL ${code} failure preserves HTTP meaning without fallback writes`,async()=>{fixture.rpcError={code,message:'Synthetic transaction rejected'};const r=await invite();assert.equal(r.status,status);assert.equal(r.body.error,'Synthetic transaction rejected');assert.equal(fixture.calls.length,1);});
test('exact replay is visibly reported without a second persistence path',async()=>{fixture.result.replayed=true;const r=await invite();assert.equal(r.status,200);assert.equal(r.body.replayed,true);assert.match(r.body.status,/already prepared/);});
test('cancel is scoped to workspace, identity and reviewed invitation version',async()=>{fixture.result={cancelled:true,id:invitationId,version:4};const r=await call('/members/invitations/cancel',{invitationId,expectedVersion:3});assert.equal(r.status,200);assert.equal(fixture.calls[0].name,'title_cancel_invitation');assert.equal(fixture.calls[0].args.p_workspace,workspaceId);assert.equal(fixture.calls[0].args.p_expected,3);});
test('reissue reads only the invitation in this workspace and passes its stored grant',async()=>{
 fixture.invitations=[{id:invitationId,workspace_id:workspaceId,email:'staff@example.test',role:'viewer',company_ids:['B'],all_companies:false,restricted_access:false,partner_members:[]}];
 const r=await call('/members/invitations/reissue',{invitationId,expectedVersion:4,role:'admin',allCompanies:true});assert.equal(r.status,200);
 assert.equal(fixture.calls[0].args.p_role,'viewer');assert.deepEqual(fixture.calls[0].args.p_companies,['B']);assert.equal(fixture.calls[0].args.p_reissue,true);assert.equal(fixture.calls[0].args.p_expected,4);
});
test('cross-workspace invitation cannot be reissued',async()=>{fixture.invitations=[{id:invitationId,workspace_id:targetId}];assert.equal((await call('/members/invitations/reissue',{invitationId,expectedVersion:1})).status,404);assert.equal(fixture.calls.length,0);});
test('member revoke invokes only atomic revoke-and-cancel RPC with target version',async()=>{
 fixture.result={revoked:true,cancelledInvitations:1,version:5};const r=await call('/members/revoke',{userId:targetId,expectedVersion:4});assert.equal(r.status,200);assert.equal(r.body.cancelledInvitations,1);
 assert.deepEqual(fixture.calls,[{name:'title_revoke_member',args:{p_workspace:workspaceId,p_actor:actorId,p_email:actorEmail,p_access_version:7,p_target:targetId,p_expected:4}}]);
});
test('member revoke without a reviewed target version fails closed',async()=>{assert.equal((await call('/members/revoke',{userId:targetId})).status,409);assert.equal(fixture.calls.length,0);});

for (const field of ['accepted_at','revoked_at']) test(`terminal ${field} replay cannot be reported as a pending invitation`,async()=>{fixture.result[field]='2026-09-19T00:00:00Z';assert.equal((await invite()).status,409);assert.equal(fixture.calls.length,1);});

test('expired create replay requires explicit renewal',async()=>{fixture.result.expires_at='2000-01-01';fixture.result.replayed=true;assert.equal((await invite()).status,409);assert.equal(fixture.calls.length,1);});
