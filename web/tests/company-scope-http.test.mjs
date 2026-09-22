// Real API route and authorization code; only identity/database transport is synthetic.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
const wid = "11111111-1111-4111-8111-111111111111", actor = "22222222-2222-4222-8222-222222222222";
const snapshot = '2026-09[["order-B","B","Fictional Carrier",654321,0.3]]{"B":123456}[["B",[{"name":"B_ONLY_CONFIDENTIAL_OWNER","share":100}]]]';
let state, membership, saves, handler;
const ok = data => ({ data, error: null });
function fixture() {
  const data = { version: 1, user: "owner@example.test", expenses: {}, business: {}, rules: [{ id: "qa-rule", name: "Fictional automation", enabled: false, runs: 0, lastRun: "Never" }] };
  for (const key of ["companies", "orders", "documents", "tasks", "inbox", "activity", "revisions", "fieldRevisions", "replyDrafts", "importTemplates", "approvedReports", "expansionStates", "statementDeliveries", "deliveries", "ownershipHistory"]) data[key] = [];
  for (const key of ["policies", "commitments", "cpls", "onboarding", "credentials", "closes", "handoffs", "corrections", "followups"]) data.business[key] = [];
  data.materials = { version: 1, items: [], publications: [] };
  data.orchestration = { version: 1, profiles: [], fieldMaps: [], links: [], controls: [], readiness: [], proposals: [], events: [] };
  data.companies = ["A", "B"].map(id => ({ id, name: "Fictional company " + id, initials: id, color: "blue", contact: "Fictional contact", email: id + "@example.test", location: "Charlotte", jurisdiction: "NC", stage: "Onboarding", steps: [], members: [] }));
  data.approvedReports = [snapshot];
  return data;
}
globalThis.__titleHttpClient = {
  auth: {
    getUser: async () => ok({ user: { id: actor, email: "staff@example.test", email_confirmed_at: "2026-09-01", is_anonymous: false } }),
    getClaims: async () => ok({ claims: { sub: actor, session_id: "33333333-3333-4333-8333-333333333333", aal: "aal2" } }),
  },
  from(table) {
    const filters = [];
    const rows = () => ({ title_memberships: [membership], title_workspaces: [{ id: wid, name: "Fictional workspace", state, revision: 1 }], title_assets: [], title_audit: [], title_command_receipts: [] }[table] || []).filter(r => filters.every(([k,v]) => r[k] === v));
    return {
      select() { return this; }, eq(k,v) { filters.push([k,v]); return this; }, order() { return this; }, limit() { return this; },
      async single() { assert.equal(rows().length,1); return ok(structuredClone(rows()[0])); },
      async maybeSingle() { assert(rows().length <= 1); return ok(structuredClone(rows()[0] || null)); },
      then(resolve,reject) { return Promise.resolve(ok(structuredClone(rows()))).then(resolve,reject); },
    };
  },
  async rpc(name,args) {
    if (name === "title_security_state") return ok({ session_valid: true, password_change_required: false, has_totp: true, session_totp: true });
    if (name === "title_commit") { saves++; state = structuredClone(args.p_state); return ok({ revision: 2, replayed: false }); }
    throw Error("Unexpected synthetic RPC " + name);
  },
};
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-only" })[key] }, serve: fn => { handler = fn; } };
await import("../.local-api-test/handler.mjs");
beforeEach(() => {
  state = fixture(); saves = 0;
  membership = { workspace_id: wid, user_id: actor, role: "finance", company_ids: ["A"], all_companies: false, restricted_access: false, active: true, version: 1, partner_members: [] };
});
async function request(commands) {
  const response = await handler(new Request("https://example.test/functions/v1/title-api/" + (commands ? "commands" : "state?workspaceId=" + wid), {
    method: commands ? "POST" : "GET", headers: { Authorization: "Bearer synthetic-only", "Content-Type": "application/json" },
    ...(commands ? { body: JSON.stringify({ workspaceId: wid, requestId: crypto.randomUUID(), expectedRevision: 1, commands }) } : {}),
  }));
  return { status: response.status, body: await response.json() };
}
const edit = (table,value,id="value") => [{ id: crypto.randomUUID(), name: "editDraft", args: [[{ table, id, value }]] }];
for (const role of ["finance", "admin", "operations", "onboarding", "viewer", "partner"])
  for (const company_ids of [["A"], []])
    test(role + " with " + company_ids.length + " companies receives no legacy workspace approval data", async () => {
      Object.assign(membership,{ role, company_ids });
      const result = await request(); assert.equal(result.status,200);
      assert.deepEqual(result.body.state.approvedReports,[]);
      assert(!JSON.stringify(result.body).includes("B_ONLY_CONFIDENTIAL_OWNER"));
      assert.deepEqual(state.approvedReports,[snapshot]);
    });
for (const role of ["finance","admin","owner"])
  test("organization-wide " + role + " retains authorized financial approvals", async () => {
    Object.assign(membership,{ role, all_companies: true });
    const result = await request(); assert.equal(result.status,200); assert.deepEqual(result.body.state.approvedReports,[snapshot]);
    const saved = await request(edit("approvedReports",{ value: [snapshot,"reviewed-current-period"] }));
    assert.equal(saved.status,200); assert.equal(saves,1);
  });
for (const role of ["finance","admin"])
  test("scoped " + role + " cannot append global approval snapshots", async () => {
    membership.role=role; const result=await request(edit("approvedReports",{value:["forged-review"]}));
    assert.equal(result.status,403); assert.equal(saves,0); assert.deepEqual(state.approvedReports,[snapshot]);
  });
for (const company_ids of [["A"],[]])
  for (const table of ["rules","expansionStates"])
    test("scoped admin cannot change " + table + " with " + company_ids.length + " companies", async () => {
      Object.assign(membership,{role:"admin",company_ids});
      const before=structuredClone(state);
      const result=await request(table==="rules"?edit(table,{enabled:true},"qa-rule"):edit(table,{value:["CA"]}));
      assert.equal(result.status,403); assert.equal(saves,0); assert.deepEqual(state,before);
    });
for(const role of ["owner","admin"])
  test("workspace " + role + " can change global settings",async()=>{
    Object.assign(membership,{role,all_companies:true});
    const result=await request(edit("rules",{enabled:true},"qa-rule"));
    assert.equal(result.status,200);assert.equal(state.rules[0].enabled,true);
  });
test("scope reduction removes previously visible global data on the next read",async()=>{
  membership.all_companies=true;assert.deepEqual((await request()).body.state.approvedReports,[snapshot]);
  membership.all_companies=false;membership.version=2;
  assert.deepEqual((await request()).body.state.approvedReports,[]);
});
test("a mixed allowed and forbidden batch never commits partial company changes",async()=>{
  membership.role="admin";
  const commands=edit("companies",{contact:"Changed company contact"},"A").concat(edit("expansionStates",{value:["CA"]}));
  const result=await request(commands);assert.equal(result.status,403);assert.equal(saves,0);
  assert.equal(state.companies[0].contact,"Fictional contact");
});

for (const role of ["finance","admin"])
  for (const name of ["saveImportTemplate","deleteImportTemplate"])
    test("scoped " + role + " cannot change shared template via " + name,async()=>{
      membership.role=role;
      state.importTemplates=[{id:"shared-map",name:"Shared mapping",columnMap:{Amount:"Amount"},createdAt:"2026-09-01"}];
      const before=structuredClone(state);
      const result=await request([{id:crypto.randomUUID(),name,args:name==="saveImportTemplate"?["Shared mapping",{Private:"Description"}]:["shared-map"]}]);
      assert.equal(result.status,403);assert.equal(saves,0);assert.deepEqual(state,before);
      assert.deepEqual((await request()).body.state.importTemplates,[]);
    });
for(const role of ["owner","finance"])
  test("organization-wide " + role + " can maintain shared column mappings",async()=>{
    Object.assign(membership,{role,all_companies:true});
    const result=await request([{id:crypto.randomUUID(),name:"saveImportTemplate",args:["Fictional mapping",{Amount:"Amount"}]}]);
    assert.equal(result.status,200);assert.equal(saves,1);assert.equal(state.importTemplates[0].name,"Fictional mapping");
  });
for (const name of ["executeRules","loadDemoScenario"])
  test("scoped admin cannot run workspace-wide action " + name,async()=>{
    membership.role="admin";
    const result=await request([{id:crypto.randomUUID(),name,args:[]}]);
    assert.equal(result.status,403);assert.equal(saves,0);
  });

