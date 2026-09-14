// Execute the actual deployed HTTP handler. Only Auth/database/provider transport
// is synthetic; routing, account checks, parsers and response handling are real.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
const wid = "11111111-1111-4111-8111-111111111111", actor = "22222222-2222-4222-8222-222222222222";
const email = "operator@example.test", token = "missive_pat-SYNTHETIC_HTTP_FIXTURE";
const route = { id: "route:org:team:A", organizationId: "org", teamId: "team", companyId: "A", teamName: "Synthetic inbox",
  enabled: true, version: 1, approvedBy: email, approvedAt: "2026-09-14T12:00:00Z" };
const otherWid = "44444444-4444-4444-8444-444444444444";
let state, handler;
const ok = data => ({ data, error: null });
const failure = (code, message) => ({ data: null, error: { code, message } });
function workspaceState() {
  const value = { version: 1, user: email, expenses: {}, business: {}, rules: [] };
  for (const key of ['companies','orders','documents','tasks','inbox','activity','revisions','fieldRevisions','replyDrafts','importTemplates','approvedReports','expansionStates','statementDeliveries','deliveries','ownershipHistory']) value[key] = [];
  for (const key of ['policies','commitments','cpls','onboarding','credentials','closes','handoffs','corrections','followups']) value.business[key] = [];
  value.orchestration = { version: 1, profiles: [], fieldMaps: [], links: [], controls: [], readiness: [], proposals: [], events: [] };
  value.materials = { version: 1, items: [], publications: [] };
  value.companies = ['A','B'].map(id => ({ id, name: `Fixture company ${id}`, initials: id, color: 'blue', contact: 'Fixture contact', email: `${id}@example.test`, location: 'Charlotte', jurisdiction: 'NC', stage: 'Onboarding', steps: [], members: [{ name: 'Member', share: 100 }] }));
  value.orders = ['A','B'].map(companyId => ({ id: `order-${companyId}`, companyId, address: '100 Fixture Road', client: 'Fixture buyer', type: 'Purchase', underwriter: 'Fixture carrier', owner: email, jurisdiction: 'NC', status: 'New', due: '2026-09-20', premium: 100, rate: .4, month: '2026-09', fields: [], notes: '', exception: '', delivered: false, remitted: false }));
  return value;
}
function fixture(overrides = {}) {
  return { credentialReadFails: false, membership: {}, metadata: { exists: true, configured: true, revision: 1, verifiedAt: '2026-09-14T12:00:00Z' },
    credentialToken: token, integration: { status: 'configured', config: { schemaVersion: 2, revision: 1, mappings: [structuredClone(route)] } },
    revision: 1, workspaceState: workspaceState(), receipts: [], audit: [], assets: [],
    events: [{ id: 'event-1', status: 'queued', payload: { organizationId: 'org', teamId: 'team', companyId: 'A', messageId: 'message', conversationId: 'conversation', receivedAt: '2026-09-14T12:00:00Z' } }], ...overrides };
}
const scope = id => id === wid ? state : state.others.get(id);
const currentMembership = (id, f) => f && f.membership !== null ? { workspace_id: id, user_id: actor, role: 'owner', all_companies: true, company_ids: [], restricted_access: true, partner_members: [], active: true, version: 1, ...f.membership } : null;
globalThis.__titleHttpClient = {
  auth: {
    getUser: async () => ({ data: { user: { id: actor, email, email_confirmed_at: '2026-01-01T12:00:00Z' } }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: actor, session_id: '33333333-3333-4333-8333-333333333333', aal: 'aal2' } }, error: null }),
  },
  from(table) {
    state.tables.push(table);
    const record = { table, filters: [] }; state.queries.push(record);
    const rows = () => {
      const fixtures = [[wid, state], ...state.others.entries()];
      if (table === 'title_memberships') return fixtures.map(([id,f]) => currentMembership(id,f)).filter(Boolean);
      if (table === 'title_bootstrap') return [{ singleton: true, workspace_id: wid }];
      if (table === 'title_integrations') return fixtures.filter(([,f]) => f.integration).map(([id,f]) => ({ workspace_id: id, provider: 'missive', ...f.integration }));
      if (table === 'title_workspaces') return fixtures.map(([id,f]) => ({ id, name: `Fixture ${id}`, revision: f.revision, state: f.workspaceState }));
      if (table === 'title_command_receipts') return fixtures.flatMap(([id,f]) => f.receipts.map(row => ({ workspace_id: id, ...row })));
      if (table === 'title_audit') return fixtures.flatMap(([id,f]) => f.audit.map(row => ({ workspace_id: id, ...row })));
      if (table === 'title_assets') return fixtures.flatMap(([id,f]) => f.assets.map(row => ({ workspace_id: id, ...row })));
      throw Error(`Unexpected fixture table ${table}`);
    };
    const filtered = () => rows().filter(row => record.filters.every(([key,value]) => row[key] === value));
    const query = {
      select() { return this; }, eq(key,value) { record.filters.push([key,value]); return this; }, order() { return this; }, limit() { return this; },
      maybeSingle: async () => { const values = filtered(); assert(values.length <= 1, `Missing scoping filter for ${table}`); return ok(values[0] || null); },
      single: async () => { const values = filtered(); assert.equal(values.length,1, `Missing or incorrect scoping filter for ${table}`); return ok(values[0]); },
      then(resolve,reject) { return Promise.resolve(ok(filtered())).then(resolve,reject); },
    };
    return query;
  },
  async rpc(name,args) {
    state.rpcs.push({ name, args });
    if (name === 'title_security_state') { assert.equal(args.p_user,actor); return ok({ session_valid: true, password_change_required: false, has_totp: true, session_totp: true, ...state.security }); }
    const f = scope(args.p_workspace); assert(f, `Unexpected RPC workspace ${args.p_workspace}`);
    if (name.startsWith('title_') && name !== 'title_pending_missive_events') {
      const member = currentMembership(args.p_workspace,f);
      if (!member?.active || args.p_actor !== actor || args.p_access_version !== member.version || !(member.role === 'owner' || member.role === 'admin' && member.all_companies))
        return failure('42501','Synthetic current membership rejection');
    }
    if (name === 'title_missive_credential_status') return ok(f.metadata);
    if (name === 'title_read_missive_credential') return f.credentialReadFails ? failure('P0001','Synthetic Vault failure') : ok({ ...f.metadata, token: f.metadata.exists ? f.credentialToken : null });
    if (name === 'title_save_missive_credential') {
      if (args.p_expected !== f.metadata.revision) return failure('PT409','Synthetic credential revision conflict');
      return ok({ configured: args.p_token !== null, revision: args.p_expected + 1, verifiedAt: '2026-09-14T12:00:00Z', source: 'workspace' });
    }
    if (name === 'title_save_missive_route') {
      const current = f.integration?.config || { schemaVersion: 2, revision: 0, mappings: [] };
      if (args.p_expected !== current.revision) return failure('PT409','Synthetic routing revision conflict');
      const saved = { ...args.p_mapping, id: `route:${args.p_mapping.organizationId}:${args.p_mapping.teamId}:${args.p_mapping.companyId}`, version: current.revision + 1, approvedBy: email, approvedAt: '2026-09-14T12:00:00Z' };
      const mappings = current.mappings.filter(m => m.id !== saved.id).concat(saved);
      return ok({ schemaVersion: 2, revision: current.revision + 1, mappings });
    }
    if (name === 'title_pending_missive_events') return ok(f.events.slice(args.p_offset,args.p_offset+101));
    if (name === 'title_import_missive_routed') {
      const routing = f.integration?.config, selected = routing?.mappings.find(m => m.id === args.p_mapping_id && m.enabled);
      if (f.integration?.status === 'disabled' || !selected || routing.revision !== args.p_routing_revision || selected.version !== args.p_mapping_version || selected.companyId !== args.p_company || args.p_expected !== f.revision)
        return failure('PT409','Synthetic commit boundary conflict');
      f.workspaceState = structuredClone(args.p_state); f.revision++;
      f.receipts.push({ request_id: args.p_request, actor_id: actor, payload_hash: args.p_hash });
      return ok({ revision: f.revision, replayed: false });
    }
    throw Error(`Unexpected fixture RPC ${name}`);
  },
};
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://backend.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' })[name] }, serve: fn => { handler = fn; } };
await import('../.local-api-test/handler.mjs');
delete globalThis.Deno;
const rawMessage = () => ({ id: 'message', type: 'email', draft: false, conversation: { id: 'conversation', organization: { id: 'org' }, team: { id: 'team' } },
  subject: 'Fixture received title email', body: '<p>Please review the title request.</p>', delivered_at: 1789400000, updated_at: 1789400001, created_at: 1789399999,
  from_field: { name: 'Fixture attorney', address: 'attorney@example.test' }, to_fields: [{ name: 'Title', address: 'title@example.test' }], attachments: [] });
beforeEach(() => {
  state = { ...fixture(), tables: [], queries: [], rpcs: [], providerCalls: [], security: {}, others: new Map(), env: {}, providerStatus: 200 };
  globalThis.Deno = { env: { get: name => state.env[name] } };
  globalThis.fetch = async (url,options) => {
    state.providerCalls.push({ url: String(url), options });
    if (state.providerStatus !== 200) return new Response('Synthetic private provider rejection',{status:state.providerStatus});
    const data = String(url).includes('/organizations?') ? { organizations: [{ id: 'org', name: 'Fixture org' }] } :
      String(url).includes('/messages/') ? { messages: rawMessage() } :
      { teams: [{ id: 'team', name: 'Synthetic inbox', organization: 'org', team_inbox_enabled: true }] };
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };
});
async function request(path,body,workspaceId=wid) {
  const response = await handler(new Request(`https://backend.example.test/functions/v1/title-api/integrations/missive${path}${body ? '' : `?workspaceId=${workspaceId}`}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer synthetic-session', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify({ workspaceId, ...body }) } : {}),
  }));
  return { status: response.status, body: await response.json() };
}
const importInput = () => ({ expectedRoutingRevision: 1, mappingId: route.id, expectedRevision: 1, requestId: crypto.randomUUID(), messageId: 'message', orderId: 'order-A', kind: 'Revision', fingerprint: 'unreviewed-fixture' });
const noProvider = () => { assert.equal(state.providerCalls.length,0); assert(!state.rpcs.some(r => r.name === 'title_read_missive_credential')); };
test("settings metadata remains readable when the saved credential cannot decrypt", async () => {
  state.credentialReadFails = true;
  const result = await request(""); assert.equal(result.status, 200); assert.equal(result.body.status, "ready");
  assert(!state.rpcs.some(r => r.name === "title_read_missive_credential")); assert.equal(state.providerCalls.length, 0);
});
test("paused routing remains operable during credential failure", async () => {
  state.credentialReadFails = true;
  const result = await request("/mapping", { expectedRoutingRevision: 1, mappingId: route.id, companyId: "A", teamId: "team", enabled: false });
  assert.equal(result.status, 200); assert.equal(result.body.routing.mappings[0].enabled, false);
  assert.equal(state.providerCalls.length, 0); assert(!state.rpcs.some(r => r.name === "title_read_missive_credential"));
});
test("saved event queue remains readable without decrypting a provider token", async () => {
  state.credentialReadFails = true;
  const result = await request("/events", { expectedRoutingRevision: 1, offset: 0 });
  assert.equal(result.status, 200); assert.equal(result.body.events[0].companyId, "A"); assert.equal(state.providerCalls.length, 0);
});
test("stale credential forms fail before making provider requests", async () => {
  const result = await request("/credential", { expectedRevision: 0, token });
  assert.equal(result.status, 409); assert.equal(state.providerCalls.length, 0);
  assert(!state.rpcs.some(r => r.name === "title_save_missive_credential"));
});
test("credential metadata never returns token or decrypts its bytes", async () => {
  state.credentialReadFails = true;
  const result = await request("/credential"); assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ["configured", "revision", "source", "verifiedAt"]);
  assert(!JSON.stringify(result.body).includes(token)); assert(!state.rpcs.some(r => r.name === "title_read_missive_credential"));
});
test("credential verification uses fixed metadata GETs before the save RPC", async () => {
  const result = await request("/credential", { expectedRevision: 1, token }); assert.equal(result.status, 200);
  assert.equal(state.providerCalls.length, 2); assert(state.providerCalls.every(c => c.url.startsWith("https://public.missiveapp.com/v1/") && c.options.method === "GET" && c.options.headers.Authorization === `Bearer ${token}`));
  assert.equal(state.rpcs.find(r => r.name === "title_save_missive_credential").args.p_token, token);
  assert(!JSON.stringify(result.body).includes(token));
});
test("disconnect does not depend on provider access or old decrypted bytes", async () => {
  state.credentialReadFails = true;
  const result = await request("/credential", { expectedRevision: 1, token: null }); assert.equal(result.status, 200); assert.equal(result.body.configured, false);
  assert.equal(state.providerCalls.length, 0);
});
test("normal provider operations still report credential failure without exposing internal details", async () => {
  state.credentialReadFails = true;
  const result = await request("/check", {}); assert.equal(result.status, 500); assert(!JSON.stringify(result.body).includes("Synthetic Vault failure"));
});
test("account setup and current administrator membership are required by the real handler", async () => {
  state.security.session_totp = false; assert.equal((await request("/credential")).status, 403);
  assert(!state.rpcs.some(r => r.name === "title_missive_credential_status"));
  state.security.session_totp = true; state.membership = { role: "admin", all_companies: false };
  assert.equal((await request("/credential")).status, 403); assert(!state.rpcs.some(r => r.name === "title_missive_credential_status"));
});

test('disabled integration retains its pending queue during a credential outage',async()=>{
  state.integration.status='disabled';state.integration.config.mappings[0].enabled=false;
  state.metadata={exists:true,configured:false,revision:2,verifiedAt:null};state.credentialReadFails=true;
  const result=await request('/events',{expectedRoutingRevision:1,offset:0});
  assert.equal(result.status,200);assert.equal(result.body.events.length,1);assert.deepEqual(result.body.events[0].candidateRouteIds,[]);noProvider();
});
test('a workspace without an integration can inspect historical pending events at revision zero',async()=>{
  state.integration=null;state.credentialReadFails=true;
  const result=await request('/events',{expectedRoutingRevision:0});
  assert.equal(result.status,200);assert.equal(result.body.events[0].messageId,'message');assert.deepEqual(result.body.events[0].candidateRouteIds,[]);noProvider();
});
test('shared queue projection offers only active companies and restores choices after re-enable',async()=>{
  const second={...route,id:'route:org:team:B',companyId:'B',version:2};
  state.integration.config={schemaVersion:2,revision:3,mappings:[{...route,enabled:false,version:3},second]};
  state.events[0].payload={...state.events[0].payload,companyId:null,candidateRoutes:[{id:route.id,companyId:'A',version:3},{id:second.id,companyId:'B',version:2}]};
  let result=await request('/events',{expectedRoutingRevision:3});assert.equal(result.status,200);
  assert.equal(result.body.events[0].companyId,null);assert.equal(result.body.events[0].originallyShared,true);assert.deepEqual(result.body.events[0].candidateRouteIds,[second.id]);
  state.integration.config.revision=4;state.integration.config.mappings[0]={...route,version:4};
  result=await request('/events',{expectedRoutingRevision:4});assert.equal(result.status,200);assert.deepEqual(result.body.events[0].candidateRouteIds,[route.id,second.id]);noProvider();
});
test('single-company captured events never acquire another company choice through HTTP projection',async()=>{
  state.integration.config.mappings=[{...route,enabled:false},{...route,id:'route:org:team:B',companyId:'B'}];
  const result=await request('/events',{expectedRoutingRevision:1});assert.equal(result.status,200);
  assert.equal(result.body.events[0].companyId,'A');assert.deepEqual(result.body.events[0].candidateRouteIds,[]);noProvider();
});
test('stale, disabled and paused imports fail before decrypting or reading provider data',async()=>{
  for(const path of ['/import','/attachments/import'])for(const mode of ['stale-routing','disabled','paused','missing-route','missing-integration']){
    state.integration=fixture().integration;state.rpcs=[];state.providerCalls=[];state.credentialReadFails=true;
    const input={...importInput(),attachmentId:'attachment'};
    if(mode==='stale-routing')input.expectedRoutingRevision=0;
    if(mode==='disabled')state.integration.status='disabled';
    if(mode==='paused')state.integration.config.mappings[0].enabled=false;
    if(mode==='missing-route')input.mappingId='route:org:team:B';
    if(mode==='missing-integration'){state.integration=null;input.expectedRoutingRevision=0;}
    assert.equal((await request(path,input)).status,409,`${path}: ${mode}`);noProvider();
    assert(!state.rpcs.some(r=>r.name==='title_import_missive_routed'));
  }
});
test('a stale workspace revision blocks new text import before provider access',async()=>{
  const result=await request('/import',{...importInput(),expectedRevision:0});
  assert.equal(result.status,409);assert.match(result.body.error,/newer version/);noProvider();
});
test('a second workspace without membership cannot read integration metadata or queue',async()=>{
  state.others.set(otherWid,fixture({membership:null}));
  for(const [path,input] of [['/credential',undefined],['/events',{expectedRoutingRevision:1}]]){
    const result=await request(path,input,otherWid);assert.equal(result.status,403);
  }
  assert(!state.rpcs.some(r=>r.name==='title_missive_credential_status'));noProvider();
  const queries=state.queries.filter(q=>q.table==='title_memberships');assert.equal(queries.length,2);
  assert(queries.every(q=>q.filters.some(([key,value])=>key==='workspace_id'&&value===otherWid)&&q.filters.some(([key,value])=>key==='user_id'&&value===actor)&&q.filters.some(([key,value])=>key==='active'&&value===true)));
});
test('environment fallback bound to one workspace is unavailable to another owned workspace',async()=>{
  state.env={MISSIVE_API_TOKEN:'SYNTHETIC_ENV_TOKEN',MISSIVE_WORKSPACE_ID:wid};
  state.others.set(otherWid,fixture({metadata:{exists:false,configured:false,revision:0,verifiedAt:null},credentialToken:null,integration:null}));
  const settings=await request('',undefined,otherWid);assert.equal(settings.status,200);assert.equal(settings.body.status,'token_required');
  assert.equal(settings.body.importEnabled,false);assert(!JSON.stringify(settings.body).includes('SYNTHETIC_ENV_TOKEN'));
  const checked=await request('/check',{},otherWid);assert.equal(checked.status,409);assert.equal(state.providerCalls.length,0);
  assert(state.rpcs.filter(r=>r.name.startsWith('title_missive_credential')||r.name==='title_read_missive_credential').every(r=>r.args.p_workspace===otherWid));
});
test('owned workspaces use their own credential and exact SQL scope',async()=>{
  const secondToken='missive_pat-SECOND_WORKSPACE_FIXTURE';state.others.set(otherWid,fixture({credentialToken:secondToken}));
  const result=await request('/check',{},otherWid);assert.equal(result.status,200);assert.equal(state.providerCalls.length,2);
  assert(state.providerCalls.every(c=>c.options.headers.Authorization===`Bearer ${secondToken}`));
  assert(!JSON.stringify(result.body).includes(secondToken));
  assert(state.rpcs.filter(r=>r.name!=='title_security_state').every(r=>r.args.p_workspace===otherWid));
  assert(state.queries.filter(q=>q.table==='title_integrations').every(q=>q.filters.some(([key,value])=>key==='workspace_id'&&value===otherWid)));
});
test('pending event pagination is applied within the requested workspace',async()=>{
  state.events=Array.from({length:105},(_,i)=>({id:`event-${i}`,status:'queued',payload:{...fixture().events[0].payload,messageId:`message-${i}`}}));
  state.others.set(otherWid,fixture({events:[{id:'private-other',status:'queued',payload:{...fixture().events[0].payload,messageId:'other-message'}}]}));
  let result=await request('/events',{expectedRoutingRevision:1,offset:0});assert.equal(result.status,200);assert.equal(result.body.events.length,100);assert.equal(result.body.nextOffset,100);
  result=await request('/events',{expectedRoutingRevision:1,offset:100});assert.equal(result.status,200);assert.equal(result.body.events.length,5);assert.equal(result.body.nextOffset,null);assert.equal(result.body.events[0].messageId,'message-100');
  result=await request('/events',{expectedRoutingRevision:1,offset:0},otherWid);assert.equal(result.body.events.length,1);assert.equal(result.body.events[0].messageId,'other-message');
  assert.deepEqual(state.rpcs.filter(r=>r.name==='title_pending_missive_events').map(r=>[r.args.p_workspace,r.args.p_offset]),[[wid,0],[wid,100],[otherWid,0]]);noProvider();
});
test('provider token rejection cannot reach credential save',async()=>{
  state.providerStatus=401;
  const result=await request('/credential',{expectedRevision:1,token});assert.equal(result.status,502);
  assert.equal(state.providerCalls.length,1);assert(!state.rpcs.some(r=>r.name==='title_save_missive_credential'||r.name==='title_read_missive_credential'));
  assert(!JSON.stringify(result.body).includes('Synthetic private provider'));assert(!JSON.stringify(result.body).includes(token));
});
test('credential revision changing during provider verification is rejected by the commit boundary',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const result=await original(...args);state.metadata.revision=2;return result;};
  const result=await request('/credential',{expectedRevision:1,token});assert.equal(result.status,409);assert.equal(state.providerCalls.length,2);
  assert.equal(state.rpcs.find(r=>r.name==='title_save_missive_credential').args.p_expected,1);
});
async function importThroughHttp(){
  const preview=await request('/preview',{expectedRoutingRevision:1,mappingId:route.id,messageId:'message'});assert.equal(preview.status,200,JSON.stringify(preview.body));
  const input={...importInput(),fingerprint:preview.body.fingerprint};
  const imported=await request('/import',input);assert.equal(imported.status,200,JSON.stringify(imported.body));assert.equal(imported.body.imported,true);
  return input;
}
test('real preview and text import preserve source while receipt replay needs no credential decryption',async()=>{
  const input=await importThroughHttp();assert.equal(state.workspaceState.inbox.length,1);assert.equal(state.workspaceState.inbox[0].companyId,'A');assert.equal(state.workspaceState.inbox[0].missive.mappingVersion,1);
  const saved=structuredClone(state.workspaceState);state.credentialReadFails=true;state.rpcs=[];state.providerCalls=[];
  const result=await request('/import',input);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.replayed,true);
  assert.deepEqual(state.workspaceState,saved);noProvider();assert(!state.rpcs.some(r=>r.name==='title_import_missive_routed'));
  const receiptQueries=state.queries.filter(q=>q.table==='title_command_receipts');assert(receiptQueries.every(q=>q.filters.some(([key,value])=>key==='workspace_id'&&value===wid)));
});
test('a new request for an already imported source also returns without provider access',async()=>{
  const input=await importThroughHttp();state.credentialReadFails=true;state.rpcs=[];state.providerCalls=[];
  const result=await request('/import',{...input,requestId:crypto.randomUUID(),expectedRevision:state.revision});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.alreadyImported,true);assert.equal(state.workspaceState.inbox.length,1);noProvider();
});
test('a reused receipt for changed request content fails before decrypting',async()=>{
  const input=await importThroughHttp();state.credentialReadFails=true;state.rpcs=[];state.providerCalls=[];
  const result=await request('/import',{...input,kind:'Finals'});assert.equal(result.status,409);assert.match(result.body.error,/different change/);noProvider();
});
test('an already imported message cannot be reassigned to another shared company through HTTP',async()=>{
  await importThroughHttp();const second={...route,id:'route:org:team:B',companyId:'B',version:2};state.integration.config={schemaVersion:2,revision:2,mappings:[route,second]};
  state.credentialReadFails=true;state.rpcs=[];state.providerCalls=[];
  const result=await request('/import',{...importInput(),expectedRoutingRevision:2,mappingId:second.id,expectedRevision:state.revision,orderId:'order-B'});
  assert.equal(result.status,409);assert.match(result.body.error,/another destination/);assert.equal(state.workspaceState.inbox[0].companyId,'A');noProvider();
});
