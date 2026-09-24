import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const originalFetch=globalThis.fetch,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let fixture;
const scope={workspaceId:'fictional-workspace',userId:'fictional-user',companyId:'fictional-company'};
globalThis.__portalClient={auth:{async getSession(){fixture.authCalls++;if(fixture.holdAuthAt===fixture.authCalls)await new Promise(resolve=>fixture.releaseAuth=resolve);return {data:{session:fixture.user?{access_token:'FICTIONAL-TOKEN',user:{id:fixture.user}}:null}}}}};
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw new Error('Portal must not read localStorage')},setItem(){throw new Error('Portal must not write localStorage')},removeItem(){throw new Error('Portal must not modify localStorage')}}});
globalThis.fetch=async(url,init)=>{assert.equal(new URL(url).origin,'https://fictional.example.test');fixture.requests.push({url:String(url),init});if(fixture.holdFetch)await new Promise(resolve=>fixture.releaseFetch=resolve);if(fixture.status!==200)return Response.json({error:'PRIVATE-DOWNLOAD-ERROR'},{status:fixture.status});if(String(url).endsWith('/download-attachment'))return new Response(fixture.downloadBody??'FICTIONAL ORIGINAL',{headers:{'Content-Type':'text/plain'}});return Response.json({requests:[],mailConfigured:true});};
const compiled=await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/backend/jv-portal-client';export {setActiveWorkspace} from './lib/backend/client';`},bundle:true,write:false,platform:'node',format:'esm',define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://fictional.example.test"','process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'"fictional-key"'},plugins:[{name:'fake-portal-auth',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__portalClient'}))}}]});
const client=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
beforeEach(()=>{fixture={user:scope.userId,authCalls:0,requests:[],status:200};client.setActiveWorkspace(scope.workspaceId)});
after(()=>{globalThis.fetch=originalFetch;delete globalThis.__portalClient;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage});
async function until(check){for(let n=0;n<50;n++){if(check())return;await new Promise(resolve=>setImmediate(resolve))}assert.ok(check(),'fixture boundary reached')}
const forbidden=error=>error.status===403&&!error.message.includes('PRIVATE');
test('scoped client rejects changed workspace and account before staff requests or downloads',async()=>{
 for(const kind of ['list','download']){client.setActiveWorkspace('elsewhere');await assert.rejects(kind==='list'?client.jvPortalClientRequest(scope,'list'):client.jvPortalDownload(scope,'request','attachment'),forbidden);client.setActiveWorkspace(scope.workspaceId);fixture.user='other-user';await assert.rejects(kind==='list'?client.jvPortalClientRequest(scope,'list'):client.jvPortalDownload(scope,'request','attachment'),forbidden);fixture.user=scope.userId}assert.equal(fixture.requests.length,0);
});
test('staff mutations pin scope and authenticate before and after the response',async()=>{
 await client.jvPortalClientRequest(scope,'create',{recipientName:'Fictional Recipient',email:'recipient@example.test',workspaceId:'forged',companyId:'forged',requestId:'fictional-request'});const [request]=fixture.requests;assert.equal(new URL(request.url).pathname,'/functions/v1/title-api/jv-portal/create');assert.equal(new URL(request.url).search,'');assert.equal(request.init.method,'POST');assert.equal(request.init.cache,'no-store');assert.equal(request.init.headers.Authorization,'Bearer FICTIONAL-TOKEN');assert.deepEqual(JSON.parse(request.init.body),{recipientName:'Fictional Recipient',email:'recipient@example.test',workspaceId:scope.workspaceId,companyId:scope.companyId,requestId:'fictional-request'});assert.ok(fixture.authCalls>=2);
});
test('workspace change during the initial auth lookup prevents a staff mutation',async()=>{
 fixture.holdAuthAt=1;const pending=client.jvPortalClientRequest(scope,'send',{id:'fictional-request',expectedVersion:4});await until(()=>fixture.releaseAuth);client.setActiveWorkspace('elsewhere');fixture.releaseAuth();await assert.rejects(pending,forbidden);assert.equal(fixture.requests.length,0);
});
test('workspace change during any repeated auth lookup prevents a staff mutation',async()=>{
 fixture.holdAuthAt=2;const pending=client.jvPortalClientRequest(scope,'send',{id:'fictional-request',expectedVersion:4});await until(()=>fixture.releaseAuth);client.setActiveWorkspace('elsewhere');fixture.releaseAuth();await assert.rejects(pending,forbidden);assert.equal(fixture.requests.length,0);
});
for(const change of ['workspace','account'])test(`late JSON response after ${change} switch is discarded`,async()=>{
 fixture.holdFetch=true;const pending=client.jvPortalClientRequest(scope,'list');await until(()=>fixture.releaseFetch);if(change==='workspace')client.setActiveWorkspace('elsewhere');else fixture.user='different-user';fixture.releaseFetch();await assert.rejects(pending,forbidden);
});
test('binary originals use scoped POST, no-store, current token and return a detached bounded Blob',async()=>{
 const blob=await client.jvPortalDownload(scope,'fictional-request','fictional-attachment');assert.equal(await blob.text(),'FICTIONAL ORIGINAL');assert.equal(blob.type,'text/plain');const [request]=fixture.requests;assert.equal(new URL(request.url).pathname,'/functions/v1/title-api/jv-portal/download-attachment');assert.equal(request.init.method,'POST');assert.equal(request.init.cache,'no-store');assert.equal(request.init.headers.Authorization,'Bearer FICTIONAL-TOKEN');assert.deepEqual(JSON.parse(request.init.body),{workspaceId:scope.workspaceId,companyId:scope.companyId,id:'fictional-request',attachmentId:'fictional-attachment'});assert.equal(fixture.authCalls,2);
});
for(const change of ['workspace','account'])test(`late binary response after ${change} switch is discarded`,async()=>{
 fixture.holdFetch=true;const pending=client.jvPortalDownload(scope,'request','attachment');await until(()=>fixture.releaseFetch);if(change==='workspace')client.setActiveWorkspace('elsewhere');else fixture.user='different-user';fixture.releaseFetch();await assert.rejects(pending,forbidden);
});
test('binary download refuses excessive streamed bytes and never echoes server details',async()=>{
 fixture.downloadBody=new ReadableStream({start(c){c.enqueue(new Uint8Array(10*1024*1024));c.enqueue(new Uint8Array(1));c.close()}});await assert.rejects(client.jvPortalDownload(scope,'request','attachment'),error=>error.status===413);fixture.status=403;await assert.rejects(client.jvPortalDownload(scope,'request','attachment'),error=>error.status===403&&!error.message.includes('PRIVATE-DOWNLOAD-ERROR'));
});
