import test from "node:test";
import assert from "node:assert/strict";
import { listMissiveConversations, listMissiveMessages, readMissiveMessage, previewMissiveMessage, importMissiveText,
  existingMissiveImport, missivePlainText, executeCommands, emptyWorkspace, projectWorkspace, commitmentSnapshot } from "../.local-test/missive/api.mjs";
const config = { token: "TEST-TOKEN", workspaceId: "workspace" };
const owner = { userId: crypto.randomUUID(), email: "owner@example.com", role: "owner", companyIds: [], allCompanies: true, restricted: true, version: 1, partnerMembers: [] };
const mapping = { version: 1, organizationId: "org", teamId: "team", teamName: "Intake", companyId: "A", approvedAt: "2026-09-12", approvedBy: owner.email };
const conversation = { id: "conversation", organization: {id: "org"}, team: {id: "team"}, subject: "Title request", last_activity_at: 1789200000 };
const raw = {id: "message", type: "email", draft: false, conversation, subject: "Revision request", body: "<p>Please review &amp; update.</p>",
  delivered_at: 1789200000, updated_at: 1789200001, created_at: 1789199999, from_field: {name: "Attorney", address: "attorney@example.com"},
  to_fields: [{name: "Title", address: "title@example.com"}], references: ["original-message"],
  attachments: [{id: "attachment", filename: "final.pdf", media_type: "application", sub_type: "pdf", size: 1234, url: "https://private.invalid/signed-secret"}]};
const json = v => new Response(JSON.stringify(v));
const fetchMessage = async (value = raw) => readMissiveMessage(config, "workspace", owner, mapping, "message", async () => json({messages: value}));
function fixture() {
  const s = emptyWorkspace();
  s.companies = ["A", "B"].map(id => ({id, name: `Company ${id}`, initials: id, color: "blue", contact: "Person", email: "person@example.com", location: "Charlotte", jurisdiction: "NC", stage: "Onboarding", steps: [], members: [{name: "Member", share: 100}]}));
  s.orders = ["A", "B"].map(companyId => ({ id: `O-${companyId}`, companyId, address: "Test address", client: "Buyer", type: "Purchase", underwriter: "WFG", owner: "Test", jurisdiction: "NC", status: "New", due: "2026-09-12", premium: 100, rate: .4, month: "2026-09", fields: [], notes: "", exception: "", delivered: false, remitted: false }));
  return s;
}
const edit = (table, id, value, insert = false) => [{id: crypto.randomUUID(), name: "editDraft", args: [[{table,id,value,insert}]]}];
async function imported(s = fixture(), message) {
  message ||= await fetchMessage();
  const preview = await previewMissiveMessage(message);
  return importMissiveText(s, owner, mapping, message, "O-A", "Revision", preview.fingerprint, crypto.randomUUID());
}
test("message DTO preserves review headers and exact HTML but never signed download URLs", async () => {
  const message = await fetchMessage(); const preview = await previewMissiveMessage(message);
  assert.equal(message.html, raw.body); assert.equal(preview.body, "Please review & update.");
  assert.equal(preview.headers.to[0].address, "title@example.com");
  assert.ok(!JSON.stringify(message).includes("signed-secret")); assert.ok(!("html" in preview));
  assert.equal(message.attachments[0].status, "not_downloaded");
});
test("missing/redacted bodies, drafts, outgoing messages and scope mismatches are rejected", async () => {
  for (const extra of [{body: undefined}, {body: null}, {draft: true}, {author: {id: "staff"}}, {type: "twilio_message"}, {id: "wrong"}, {conversation: {...conversation, team: {id: "other"}}}, {conversation: {id:"guest"}}])
    await assert.rejects(fetchMessage({...raw, ...extra}));
  assert.equal((await fetchMessage({...raw, body:""})).html, "");
});
test("HTML display keeps table values separate and never loads embedded content", () => {
  const value = missivePlainText('<script>secret()</script><style>bad</style><table><tr><td>250000</td><td>300000</td></tr></table><img src="https://tracking.invalid"><p>&#x1F3E0; &lt;script&gt;</p>');
  assert.match(value, /250000 \| 300000/); assert.ok(!value.includes("secret()")); assert.ok(!value.includes("tracking.invalid")); assert.match(value, /🏠 <script>/);
});
test("timestamp ties preserve every returned conversation before pagination", async () => {
  const list = Array.from({length:51}, (_,i)=>({...conversation,id:`c${i}`,last_activity_at:i===0?200:100}));
  const result = await listMissiveConversations(config,"workspace",owner,mapping,undefined,async () => json({conversations:list}));
  assert.equal(result.rows.length,51); assert.equal(result.until,100);
  const end = await listMissiveConversations(config,"workspace",owner,mapping,undefined,async () => json({conversations:list.map(c=>({...c,last_activity_at:100}))}));
  assert.equal(end.until,null);
});
test("guest rows do not block valid conversations and still determine the page cursor", async () => {
  const list = Array.from({length:49}, (_,i)=>({...conversation,id:`c${i}`,last_activity_at:200}));
  list.push({id:"guest",last_activity_at:100});
  const result = await listMissiveConversations(config,"workspace",owner,mapping,undefined,async () => json({conversations:list}));
  assert.equal(result.rows.length,49); assert.equal(result.skipped,1); assert.equal(result.until,100);
  await assert.rejects(listMissiveConversations(config,"workspace",owner,mapping,undefined,async () => json({conversations:[{...conversation,team:{id:"other"}}]})), /approved Missive team/);
});
test("message listing resolves merged conversations and skips outgoing/drafts without losing pagination", async () => {
  const calls=[];
  const result = await listMissiveMessages(config,"workspace",owner,mapping,"old",undefined,async url => {
    calls.push(url); return json(url.endsWith("/old")?{conversations:[{...conversation,id:"merged"}]}:{messages:Array.from({length:11},(_,i)=>({...raw,id:`m${i}`,delivered_at:200-i,author:i===0?{id:"staff"}:null,draft:i===1}))});
  });
  assert.ok(calls[1].includes("/merged/messages")); assert.equal(result.rows.length,9); assert.equal(result.until,190);
});
test("provider destinations and pagination inputs cannot become arbitrary URLs", async () => {
  for (const id of ["../evil", "x?token=secret", "https://attacker.invalid", "x/y"])
    await assert.rejects(readMissiveMessage(config,"workspace",owner,mapping,id,()=>assert.fail("fetched")), /identifier/);
  await assert.rejects(listMissiveConversations(config,"workspace",owner,mapping,"https://attacker.invalid",()=>assert.fail("fetched")));
});
test("reviewed import stores one immutable source plus mail and keeps pending attachments out of evidence", async () => {
  const s = fixture(), before = JSON.stringify(s), next = await imported(s);
  assert.equal(JSON.stringify(s),before); assert.equal(next.inbox.length,1); assert.equal(next.documents.length,1);
  const m=next.inbox[0],d=next.documents[0]; assert.equal(m.missive.sourceDocumentId,d.id);
  assert.deepEqual(m.documentIds,[]); assert.deepEqual(m.attachments,[]); assert.equal(d.assetId,undefined);
  assert.equal(d.sourceRole,undefined); assert.equal(m.missive.attachments[0].status,"not_downloaded");
  assert.equal(JSON.parse(d.text).html,raw.body); assert.equal(m.status,"New");
  assert.equal(JSON.stringify(commitmentSnapshot(s,s.orders[0])),JSON.stringify(commitmentSnapshot(next,next.orders[0])));
});
test("preview fingerprints catch body, recipient and update changes", async () => {
  const message=await fetchMessage(), fingerprint=(await previewMissiveMessage(message)).fingerprint;
  for(const extra of [{html:"changed"},{headers:{...message.headers,to:[{name:"",address:"other@example.com"}]}},{headers:{...message.headers,updatedAt:message.headers.updatedAt+1}}])
    await assert.rejects(importMissiveText(fixture(),owner,mapping,{...message,...extra},"O-A","Revision",fingerprint,crypto.randomUUID()),/source changed/);
});
test("duplicate imports preserve original snapshot and cannot silently change routing", async () => {
  const next=await imported(); const again=await imported(next);
  assert.deepEqual(again,next); assert.equal(existingMissiveImport(next,"org","message","A","O-A").id,next.inbox[0].id);
  assert.throws(()=>existingMissiveImport(next,"org","message","B","O-B"),/another destination/);
  const restored=fixture(); assert.equal((await imported(restored)).inbox.length,1);
});
test("unauthorized accounts, wrong company files, issued files and unreviewed kinds cannot import", async () => {
  const m=await fetchMessage(), fp=(await previewMissiveMessage(m)).fingerprint;
  for(const role of ["viewer","partner","operations","finance","onboarding"])
    await assert.rejects(importMissiveText(fixture(),{...owner,role},mapping,m,"O-A","Revision",fp,crypto.randomUUID()),e=>e.status===403);
  await assert.rejects(importMissiveText(fixture(),owner,mapping,m,"O-B","Revision",fp,crypto.randomUUID()),/open title file/);
  const locked=fixture();locked.orders[0].status="Issued";await assert.rejects(importMissiveText(locked,owner,mapping,m,"O-A","Revision",fp,crypto.randomUUID()));
  await assert.rejects(importMissiveText(fixture(),owner,mapping,m,"O-A",undefined,fp,crypto.randomUUID()),/request type/);
});
test("generic writes cannot spoof provenance, reroute imported mail, delete its source or promote it to evidence", async () => {
  const s=await imported(),mail=s.inbox[0],doc=s.documents[0];
  for(const v of [{companyId:"B",orderId:"O-B"},{orderId:"",documentIds:[]},{missive:{}},{body:"forged"}])
    assert.throws(()=>executeCommands(s,edit("inbox",mail.id,v),owner));
  assert.throws(()=>executeCommands(s,edit("documents",doc.id,{sourceRole:"Preliminary opinion"}),owner),/reclassified/);
  assert.throws(()=>executeCommands(s,edit("inbox","missive:forged",{},true),owner),/reviewed importer/);
  assert.throws(()=>executeCommands(s,edit("inbox","ordinary",{missive:{},email:"a@example.com",from:"A",subject:"A",body:"A"},true),owner),/Unsupported field/);
  const archived=executeCommands(s,edit("inbox",mail.id,{status:"Archived"}),owner); assert.equal(archived.inbox[0].status,"Archived");
});
test("company scope and restricted source visibility hide imported mail and body", async () => {
  const s=await imported();
  assert.equal(projectWorkspace(s,{...owner,allCompanies:false,companyIds:["B"],role:"operations",restricted:false}).inbox.length,0);
  s.documents[0].visibility="Restricted";
  assert.equal(projectWorkspace(s,{...owner,role:"operations",restricted:false}).inbox.length,0);
});
test("maximum accepted provider IDs remain valid for subsequent workspace changes", async () => {
  const m=await fetchMessage(); m.organizationId="o".repeat(100);m.id="m".repeat(100);
  const map={...mapping,organizationId:m.organizationId};
  const s=await importMissiveText(fixture(),owner,map,m,"O-A","Revision",(await previewMissiveMessage(m)).fingerprint,crypto.randomUUID());
  assert.ok(s.inbox[0].id.length<180);
  assert.equal(executeCommands(s,edit("inbox",s.inbox[0].id,{status:"Archived"}),owner).inbox[0].status,"Archived");
});
test("large and empty message bodies retain complete source while display remains bounded", async () => {
  const long=await imported(fixture(),await fetchMessage({...raw,body:"x".repeat(100000)}));
  assert.ok(long.inbox[0].body.length<20000); assert.equal(JSON.parse(long.documents[0].text).html.length,100000);
  const empty=await imported(fixture(),await fetchMessage({...raw,body:""}));assert.equal(empty.inbox[0].body,"(Message body is empty.)");
});
