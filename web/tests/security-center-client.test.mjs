import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const originalFetch=globalThis.fetch; const requests=[]; let release;
const w='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001';
globalThis.__securityAuth={auth:{getSession:()=>new Promise(resolve=>{release=(userId=actor)=>resolve({data:{session:{access_token:'fixture',user:{id:userId}}}});})}};
globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json(new URL(url).pathname.endsWith('/members')?{members:[{user_id:actor,email:' current@example.test ',role:'owner',partner_members:[{memberName:'not a label'}]}],invitations:[{email:'not-returned@example.test'}]}:{items:[],nextCursor:null});};
after(()=>{globalThis.fetch=originalFetch;delete globalThis.__securityAuth;});
const bundle=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:'export * from "./lib/backend/security-center-client";export {setActiveWorkspace} from "./lib/backend/client";'},write:false,bundle:true,platform:'node',format:'esm',logLevel:'silent',define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://fictional.example.test"','process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'"fixture"'},plugins:[{name:'auth',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__securityAuth;'}));}}]});
const client=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
test('security requests pin workspace and account for reads, reviews, and exports',async()=>{
  const cursor={createdAt:'2026-09-24T00:00:00.123456+00:00',id:'30000000-0000-4000-8000-000000000001'};
  const calls=[()=>client.loadSecurityCenter(w,actor),()=>client.loadSecurityMemberLabels(w,actor),()=>client.listSecurityEvents(w,actor,cursor),()=>client.recordAccessReview({workspaceId:w,snapshotDigest:'a'.repeat(32),note:'Reviewed'},actor),()=>client.exportSecurityEvents(w,actor,cursor)];
  for(const request of calls){
    client.setActiveWorkspace(w); const before=requests.length; let pending=request(); release('10000000-0000-4000-8000-000000000002'); await assert.rejects(pending,/account changed/); assert.equal(requests.length,before);
    client.setActiveWorkspace(w); pending=request(); client.setActiveWorkspace('another-workspace'); release(); await assert.rejects(pending,/workspace changed/); assert.equal(requests.length,before);
    client.setActiveWorkspace(w); pending=request(); release(); await pending; assert.equal(requests.length,before+1);
  }
  const last=new URL(requests.at(-1).url); assert.equal(last.pathname,'/functions/v1/title-api/security/events/export'); assert.equal(last.searchParams.get('workspaceId'),w); assert.equal(last.searchParams.get('before'),cursor.createdAt); assert.equal(last.searchParams.get('limit'),'100');
  assert.deepEqual(JSON.parse(requests.at(-2).init.body),{workspaceId:w,snapshotDigest:'a'.repeat(32),note:'Reviewed'});
});

test('current member labels use the identity-pinned directory and return only display labels',async()=>{
  client.setActiveWorkspace(w);const pending=client.loadSecurityMemberLabels(w,actor);release();const labels=await pending;
  assert.deepEqual(labels,[{userId:actor,email:'current@example.test'}]);
  const request=new URL(requests.at(-1).url);assert.equal(request.pathname,'/functions/v1/title-api/members');assert.equal(request.searchParams.get('workspaceId'),w);
});
