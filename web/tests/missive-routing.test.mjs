import test from 'node:test';
import assert from 'node:assert/strict';
import { missiveRouteId, missiveRouting, selectMissiveRoute, requireRoutingRevision, missiveEventRoutes,
 handleMissiveWebhook } from '../.local-test/missive/api.mjs';
const approved={version:7,organizationId:'org-a',teamId:'team-a',teamName:'Shared inbox',companyId:'company-a',approvedAt:'2026-09-14',approvedBy:'owner@example.test'};
const route=(companyId,more={})=>{const m={...approved,companyId,...more};return {...m,id:missiveRouteId(m),enabled:true}};
const routing={schemaVersion:2,revision:8,mappings:[route('company-a'),route('company-b',{version:8})]};
test('legacy mapping becomes one stable route without changing approval or source version',()=>{
 const input={mapping:approved},copy=structuredClone(input),r=missiveRouting(input);
 assert.deepEqual(input,copy);assert.equal(r.revision,7);assert.equal(r.mappings.length,1);
 assert.deepEqual(r.mappings[0],{...approved,id:missiveRouteId(approved),enabled:true,productionOnly:false});
 assert.equal(selectMissiveRoute(r,7,r.mappings[0].id).companyId,'company-a');
});
test('empty integration supports first route while malformed saved versions fail closed',()=>{
 assert.deepEqual(missiveRouting(null),{schemaVersion:2,revision:0,mappings:[]});
 assert.deepEqual(missiveRouting({schemaVersion:2,revision:0,mappings:[]}),{schemaVersion:2,revision:0,mappings:[]});
 for(const config of [{schemaVersion:3},{schemaVersion:2,revision:1},{mapping:{...approved,version:0}},{...routing,revision:3},{...routing,mappings:[routing.mappings[0],routing.mappings[0]]}]) assert.throws(()=>missiveRouting(config));
});
test('all 25 joint ventures retain distinct identity on a shared inbox',()=>{
 const r=missiveRouting({schemaVersion:2,revision:31,mappings:Array.from({length:25},(_,i)=>route('llc-'+i,{version:i+7}))});
 assert.equal(r.mappings.length,25);assert.equal(new Set(r.mappings.map(m=>m.id)).size,25);
 for(const m of r.mappings) assert.equal(selectMissiveRoute(r,31,m.id).companyId,m.companyId);
 assert.equal(missiveEventRoutes(r,{organizationId:'org-a',teamId:'team-a'}).length,25);
});
test('shared inboxes always require explicit route selection',()=>{
 for(const id of [undefined,'','company-a','route:org-a:team-b:company-a']) assert.throws(()=>selectMissiveRoute(routing,8,id));
 assert.equal(selectMissiveRoute(routing,8,routing.mappings[1].id).companyId,'company-b');
});
test('changing any route invalidates an existing preview even when selected route version is unchanged',()=>{
 assert.equal(routing.mappings[0].version,7);
 for(const revision of [7,'8',undefined,null,9]) assert.throws(()=>requireRoutingRevision(routing,revision));
 assert.throws(()=>selectMissiveRoute(routing,7,routing.mappings[0].id));
});
test('paused, malformed and impersonated route identities are rejected',()=>{
 assert.throws(()=>selectMissiveRoute({...routing,mappings:[{...routing.mappings[0],enabled:false}]},8,routing.mappings[0].id));
 for(const change of [{id:'route:org-a:team-a:company-b'},{teamId:'https://elsewhere.test'},{enabled:'true'},{version:9},{approvedAt:'invalid'}]) assert.throws(()=>missiveRouting({...routing,mappings:[{...routing.mappings[0],...change}]}));
});
test('production-only inbox access must be explicit boolean approval and defaults to false',()=>{
 assert.equal(missiveRouting({mapping:approved}).mappings[0].productionOnly,false);
 for(const productionOnly of [true,false]) assert.equal(missiveRouting({...routing,mappings:[{...routing.mappings[0],productionOnly}]}).mappings[0].productionOnly,productionOnly);
 for(const productionOnly of ['true','false',0,1,null,{},[]]) assert.throws(()=>missiveRouting({...routing,mappings:[{...routing.mappings[0],productionOnly}]}));
});
test('events expose only exact organization and inbox matches',()=>{
 const r={...routing,mappings:[...routing.mappings,route('company-c',{teamId:'team-b'}),route('company-d',{organizationId:'org-b'}),{...route('company-e'),enabled:false}]};
 assert.deepEqual(missiveEventRoutes(r,{organizationId:'org-a',teamId:'team-a'}).map(m=>m.companyId),['company-a','company-b']);
 assert.equal(missiveEventRoutes(r,{organizationId:'org-c',teamId:'team-a'}).length,0);
});
test('legacy queued events preserve their approved company after multi-route upgrade',()=>{
 assert.deepEqual(missiveEventRoutes(routing,{organizationId:'org-a',teamId:'team-a',companyId:'company-a'}).map(m=>m.companyId),['company-a']);
 assert.equal(missiveEventRoutes(routing,{organizationId:'org-a',teamId:'team-a',companyId:'removed-company'}).length,0);
});
test('a new shared event permits explicit current routes without trusting caller candidate identity',()=>{
 const event={organizationId:'org-a',teamId:'team-a',companyId:null,candidateRoutes:[{id:'invented'}]};
 assert.deepEqual(missiveEventRoutes(routing,event).map(m=>m.companyId),['company-a','company-b']);
});
const config={workspaceId:'workspace',secret:'synthetic-local-shared-inbox-secret-32',ruleIds:['incoming-rule']};
const payload={rule:{id:'incoming-rule'},conversation:{id:'thread-a',organization:{id:'org-a'},team:{id:'team-a'}},latest_message:{id:'message-a',type:'email',delivered_at:1789400000,subject:'Shared incoming work'}};
async function signed(){const body=JSON.stringify(payload),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const mac=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex');return new Request('https://events.example.test',{method:'POST',headers:{'X-Hook-Signature':'sha256='+mac},body})}
test('shared webhook stores ambiguity and exact candidate evidence instead of choosing a company',async()=>{
 let event;const response=await handleMissiveWebhook(await signed(),config,{async mapping(){return routing},async enqueue(w,e){event=e;return true}});
 assert.equal(response.status,202);assert.equal(event.payload.companyId,null);assert.equal(event.payload.routingRevision,8);
 assert.deepEqual(event.payload.candidateRoutes,routing.mappings.map(({id,companyId,version})=>({id,companyId,version})));
 assert.equal(event.externalId,'org-a:message-a');
});
test('one company webhook is still straightforward but review remains required',async()=>{
 let event;const r={...routing,mappings:[routing.mappings[0]]};
 assert.equal((await handleMissiveWebhook(await signed(),config,{async mapping(){return r},async enqueue(w,e){event=e;return true}})).status,202);
 assert.equal(event.payload.companyId,'company-a');assert.equal(event.kind,'incoming_review');assert.equal(event.payload.candidateRoutes.length,1);
});
test('a queued single-company event cannot silently move when its inbox later becomes shared',()=>{
 const event={organizationId:'org-a',teamId:'team-a',companyId:'company-a',candidateRoutes:[{id:routing.mappings[0].id,companyId:'company-a',version:7}]};
 assert.deepEqual(missiveEventRoutes(routing,event).map(m=>m.companyId),['company-a']);
 assert.deepEqual(missiveEventRoutes({...routing,mappings:[{...routing.mappings[0],enabled:false},routing.mappings[1]]},event),[]);
});
test('temporarily pausing one company does not turn a shared-inbox email into another company source',async()=>{
 const paused={...routing,revision:9,mappings:[{...routing.mappings[0],enabled:false,version:9},routing.mappings[1]]};
 let event;
 assert.equal((await handleMissiveWebhook(await signed(),config,{async mapping(){return paused},async enqueue(w,e){event=e;return true}})).status,202);
 assert.equal(event.payload.companyId,null);
 assert.deepEqual(event.payload.candidateRoutes.map(m=>m.companyId),['company-a','company-b']);
 assert.deepEqual(missiveEventRoutes(paused,event.payload).map(m=>m.companyId),['company-b']);
 const restored={...paused,revision:10,mappings:[{...paused.mappings[0],enabled:true,version:10},paused.mappings[1]]};
 assert.deepEqual(missiveEventRoutes(restored,event.payload).map(m=>m.companyId),['company-a','company-b']);
});
