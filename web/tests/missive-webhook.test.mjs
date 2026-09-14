import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMissiveWebhook,webhookConfigured} from '../.local-test/missive/api.mjs';
const config={workspaceId:'workspace',secret:'synthetic-local-test-secret-32-characters',ruleIds:['incoming-rule']};
const mapping={version:2,organizationId:'org-a',teamId:'team-a',companyId:'company-a'};
const payload=()=>({rule:{id:'incoming-rule'},conversation:{id:'thread-a',organization:{id:'org-a'},team:{id:'team-a'}},latest_message:{id:'message-a',type:'email',delivered_at:1789400000,subject:'Review source'}});
async function signed(value,more={}) {
 const body=typeof value==='string'?value:JSON.stringify(value),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),x=>x.toString(16).padStart(2,'0')).join('');
 return new Request('https://events.example.test',{method:'POST',headers:{'X-Hook-Signature':'sha256='+mac,...more},body});
}
function fixture(){const events=new Map();let reads=0;return {events,get reads(){return reads},store:{async mapping(w){reads++;assert.equal(w,'workspace');return mapping},async enqueue(w,e){assert.equal(w,'workspace');const key=e.externalId;if(events.has(key))return false;events.set(key,structuredClone(e));return true}}};}
test('signed events queue only bounded source metadata for review',async()=>{const f=fixture(),r=await handleMissiveWebhook(await signed(payload()),config,f.store);assert.equal(r.status,202);assert.equal(f.events.size,1);const e=[...f.events.values()][0];assert.equal(e.payload.companyId,'company-a');assert.equal(e.payload.mappingVersion,2);assert.equal(e.kind,'incoming_review');assert.equal(e.payload.messageId,'message-a');assert.match(e.payload.payloadHash,/^[a-f0-9]{64}$/);assert.equal('body' in e.payload,false)});
test('repeated rules and timestamps for the same message enqueue once',async()=>{const f=fixture();for(let i=0;i<5;i++){const p=payload();p.latest_message.delivered_at+=i;const r=await handleMissiveWebhook(await signed(p),config,f.store);assert.equal((await r.json()).replayed,i>0)}assert.equal(f.events.size,1)});
test('signature is verified before lookup or queue access',async()=>{const f=fixture(),req=await signed(payload());req.headers.set('X-Hook-Signature','sha256='+'00'.repeat(32));assert.equal((await handleMissiveWebhook(req,config,f.store)).status,401);assert.equal(f.reads,0);assert.equal(f.events.size,0)});
test('signature applies to exact raw body bytes',async()=>{const f=fixture(),req=await signed(payload());const changed=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(payload())+' '});assert.equal((await handleMissiveWebhook(changed,config,f.store)).status,401)});
test('unconfigured intake never queues',async()=>{const f=fixture();for(const partial of [{},{...config,secret:'short'},{...config,workspaceId:''},{...config,ruleIds:[]}]){assert.equal(webhookConfigured(partial),false);assert.equal((await handleMissiveWebhook(await signed(payload()),partial,f.store)).status,503)}assert.equal(f.reads,0)});
test('disabled and wrong company inbox mappings are rejected',async()=>{for(const m of [null,{...mapping,teamId:'other'},{...mapping,organizationId:'other'}]){let queued=false;const r=await handleMissiveWebhook(await signed(payload()),config,{async mapping(){return m},async enqueue(){queued=true;return true}});assert.equal(r.status,409);assert.equal(queued,false)}});
test('only explicitly configured rules can enqueue',async()=>{const p=payload();p.rule.id='other';const f=fixture();assert.equal((await handleMissiveWebhook(await signed(p),config,f.store)).status,403);assert.equal(f.reads,0)});
test('non-email and rule validation events do not create work',async()=>{for(const p of [{rule:{id:'incoming-rule'}},{...payload(),latest_message:{type:'sms'}}]){const f=fixture(),r=await handleMissiveWebhook(await signed(p),config,f.store);assert.equal(r.status,200);assert.equal((await r.json()).queued,false);assert.equal(f.reads,0)}});
test('invalid JSON and incomplete source identifiers fail without writes',async()=>{for(const p of ['{', {...payload(),conversation:{}},{...payload(),latest_message:{...payload().latest_message,delivered_at:'today'}}]){const f=fixture();assert.equal((await handleMissiveWebhook(await signed(p),config,f.store)).status,400);assert.equal(f.events.size,0)}});
test('oversized payloads fail before store access',async()=>{const f=fixture();assert.equal((await handleMissiveWebhook(await signed('x'.repeat(262145)),config,f.store)).status,413);assert.equal(f.reads,0)});
test('queue errors return a retryable response without exposing provider errors',async()=>{const r=await handleMissiveWebhook(await signed(payload()),config,{async mapping(){return mapping},async enqueue(){throw Error('private database details')}});assert.equal(r.status,503);assert(!(await r.text()).includes('private'))});

test('explicit signed setup mode validates new rules without any database access',async()=>{
 const f=fixture(),setup={...config,validationOnly:true,ruleIds:[]};
 assert.equal(webhookConfigured(setup),false);
 for(const p of [payload(),{rule:{id:'new-not-enrolled-yet'}},{}]){
  const r=await handleMissiveWebhook(await signed(p),setup,f.store);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{received:true,queued:false,validationOnly:true});
 }
 assert.equal(f.reads,0);assert.equal(f.events.size,0);
});
test('setup mode still requires valid signature and server identity',async()=>{
 const f=fixture(),req=await signed({});req.headers.delete('X-Hook-Signature');
 assert.equal((await handleMissiveWebhook(req,{...config,validationOnly:true},f.store)).status,401);
 assert.equal((await handleMissiveWebhook(await signed({}),{...config,workspaceId:'',validationOnly:true},f.store)).status,503);
 assert.equal(f.reads,0);
});
test('a mapping change detected during the atomic enqueue returns retryable failure',async()=>{
 const r=await handleMissiveWebhook(await signed(payload()),config,{async mapping(){return mapping},async enqueue(){throw Object.assign(Error('Inbox mapping changed'),{code:'PT409'})}});
 assert.equal(r.status,503);assert.equal((await r.json()).error,'Event could not be queued. Retry later.');
});
