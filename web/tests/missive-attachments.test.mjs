import test from "node:test";
import assert from "node:assert/strict";
import { downloadMissiveAttachment, attachMissiveAttachment, existingMissiveAttachment, missiveAttachmentsEnabled,
  MAX_MISSIVE_ATTACHMENT_BYTES, readMissiveMessage, previewMissiveMessage, importMissiveText,
  executeCommands, emptyWorkspace, projectWorkspace } from "../.local-test/missive/api.mjs";
const owner = { userId: crypto.randomUUID(), email: "owner@example.com", role: "owner", companyIds: [], allCompanies: true, restricted: true, version: 1, partnerMembers: [] };
const config = { token: "TEST-TOKEN", workspaceId: "workspace", attachmentOrigins: ["https://storage.test-files.net"] };
const mapping = { version: 1, organizationId: "org", teamId: "team", teamName: "Intake", companyId: "A", approvedAt: "2026-09-12", approvedBy: owner.email };
const bytes = new TextEncoder().encode("%PDF-1.7\nSynthetic attachment contract fixture\n%%EOF\n");
const raw = {
  id: "message", type: "email", draft: false,
  conversation: { id: "conversation", organization: { id: "org" }, team: { id: "team" } },
  subject: "Received attachment", body: "<p>Please review the attached file.</p>",
  delivered_at: 1789200000, updated_at: 1789200001, created_at: 1789199999,
  from_field: { name: "Attorney", address: "attorney@example.com" }, to_fields: [],
  attachments: [{ id: "attachment", filename: "final.pdf", media_type: "application", sub_type: "pdf", size: bytes.length,
    url: "https://storage.test-files.net/source.pdf?signature=TEST-PRIVATE-LINK" }],
};
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function fixture() {
  const s = emptyWorkspace(owner.email);
  s.companies = ["A", "B"].map(id => ({ id, name: `Company ${id}`, initials: id, color: "blue", contact: "Person", email: "person@example.com", location: "Charlotte", jurisdiction: "NC", stage: "Onboarding", steps: [], members: [{ name: "Member", share: 100 }] }));
  s.orders = ["A", "B"].map(companyId => ({ id: `O-${companyId}`, companyId, address: "Test address", client: "Buyer", type: "Purchase", underwriter: "WFG", owner: "Test", jurisdiction: "NC", status: "New", due: "2026-09-12", premium: 100, rate: .4, month: "2026-09", fields: [], notes: "", exception: "", delivered: false, remitted: false }));
  return s;
}
async function imported(value = raw) {
  const message = await readMissiveMessage(config, "workspace", owner, mapping, value.id, async () => json({ messages: value }));
  return importMissiveText(fixture(), owner, mapping, message, "O-A", "Finals", (await previewMissiveMessage(message)).fingerprint, crypto.randomUUID());
}
function provider({ value = raw, binary = bytes, responseOptions = {}, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://public.missiveapp.com/")) return json({ messages: value });
    return new Response(binary, { headers: { "Content-Type": "application/pdf", "Content-Length": String(binary.length) }, ...responseOptions });
  };
}
async function artifact(s, options = {}, a = owner, c = config, m = mapping) {
  return downloadMissiveAttachment(c, "workspace", a, m, s, "message", "attachment", provider(options));
}
const edit = (id, value) => [{ id: crypto.randomUUID(), name: "editDraft", args: [[{ table: "documents", id, value }]] }];

test("download capability requires explicit exact HTTPS storage origins", () => {
  assert.equal(missiveAttachmentsEnabled(config), true);
  for (const origins of [undefined, [], ["https://storage.test-files.net/path"], ["http://storage.test-files.net"], ["https://user:secret@storage.test-files.net"], ["https://127.0.0.1"], ["https://localhost"], ["https://storage.test-files.net/"], ["https://storage.test-files.net:8443"], ["https://storage.test-files.net", "garbage"]])
    assert.equal(missiveAttachmentsEnabled({ ...config, attachmentOrigins: origins }), false);
});
test("fresh metadata is fetched with token, signed download without credentials or redirects", async () => {
  const s = await imported(), calls = [], result = await artifact(s, { calls });
  assert.equal(calls.length, 2); assert.equal(calls[0].url, "https://public.missiveapp.com/v1/messages/message");
  assert.equal(calls[0].init.headers.Authorization, "Bearer TEST-TOKEN");
  assert.equal(calls[1].init.headers.Authorization, undefined); assert.equal(calls[1].init.credentials, "omit");
  assert.equal(calls[1].init.redirect, "error"); assert.equal(calls[1].init.referrerPolicy, "no-referrer");
  assert.deepEqual(result.bytes, bytes); assert.equal(result.providerSource.importedBy, owner.email);
  assert.ok(!JSON.stringify(result).includes("TEST-PRIVATE-LINK")); assert.ok(!JSON.stringify(result).includes("TEST-TOKEN"));
});
test("server storage artifacts attach to the original company and file without changing source provenance", async () => {
  const s = await imported(), before = structuredClone(s), a = await artifact(s);
  const next = await attachMissiveAttachment(s, owner, mapping, a, crypto.randomUUID());
  assert.deepEqual(s, before); assert.equal(next.documents.length, 2);
  assert.deepEqual(next.inbox, s.inbox); assert.deepEqual(next.documents.find(d => d.id === s.documents[0].id), s.documents[0]);
  const doc = next.documents.find(d => d.id === a.documentId);
  assert.equal(doc.companyId, "A"); assert.equal(doc.orderId, "O-A"); assert.equal(doc.sourceRole, undefined);
  assert.equal(doc.assetId, a.assetId); assert.equal(doc.visibility, "Internal"); assert.equal(doc.providerSource.sourceMailId, s.inbox[0].id);
  assert.deepEqual(existingMissiveAttachment(next, owner, mapping, "message", "attachment"), doc);
});
test("repeated imports resolve the same identity and preserve the first import record", async () => {
  const s = await imported(), a = await artifact(s), next = await attachMissiveAttachment(s, owner, mapping, a, crypto.randomUUID());
  const second = await artifact(s);
  assert.equal(a.documentId, second.documentId); assert.equal(a.assetId, second.assetId);
  const again = await attachMissiveAttachment(next, owner, mapping, second, crypto.randomUUID());
  assert.deepEqual(again, next);
  await assert.rejects(attachMissiveAttachment(next, owner, mapping, { ...second, sha256: "0".repeat(64) }, crypto.randomUUID()), /immutable/);
});
test("reviewed imported manifest is required before any network operation", async () => {
  const s = await imported();
  await assert.rejects(downloadMissiveAttachment(config, "workspace", owner, mapping, fixture(), "message", "attachment", () => assert.fail("fetched")), /Import and review/);
  await assert.rejects(downloadMissiveAttachment(config, "workspace", owner, mapping, s, "message", "not-in-manifest", () => assert.fail("fetched")), /manifest/);
  await assert.rejects(downloadMissiveAttachment({ ...config, attachmentOrigins: [] }, "workspace", owner, mapping, s, "message", "attachment", () => assert.fail("fetched")), /not configured/);
});
test("nonadministrators cannot import or inspect attachment history through this integration", async () => {
  const s = await imported();
  for (const role of ["viewer", "partner", "operations", "finance", "onboarding", "admin"]) {
    const access = { ...owner, role, allCompanies: role !== "admin" };
    await assert.rejects(artifact(s, {}, access), e => e.status === 403);
    assert.throws(() => existingMissiveAttachment(s, access, mapping, "message", "attachment"), e => e.status === 403);
  }
});
test("company, inbox and issued-file changes cannot reroute a saved attachment", async () => {
  const s = await imported();
  for (const changed of [{ ...mapping, companyId: "B" }, { ...mapping, teamId: "other" }])
    await assert.rejects(artifact(s, {}, owner, config, changed), /different destination/);
  const locked = structuredClone(s); locked.orders[0].status = "Issued";
  await assert.rejects(artifact(locked), /open title file/);
});
test("restricted original sources are inaccessible without restricted access", async () => {
  const s = await imported(); s.documents[0].visibility = "Restricted";
  await assert.rejects(artifact(s, {}, { ...owner, restricted: false }), /Import and review|unavailable/);
  const a = await artifact(s), next = await attachMissiveAttachment(s, owner, mapping, a, crypto.randomUUID());
  assert.equal(next.documents.find(d => d.id === a.documentId).visibility, "Restricted");
  assert.equal(projectWorkspace(next, { ...owner, role: "operations", allCompanies: false, companyIds: ["B"], restricted: false }).documents.length, 0);
});
test("fresh provider metadata changes reject the download before reading binary data", async () => {
  const s = await imported();
  for (const change of [{ filename: "changed.pdf" }, { size: bytes.length + 1 }, { id: "different" }, { sub_type: "octet-stream" }]) {
    const value = { ...raw, attachments: [{ ...raw.attachments[0], ...change }] }, calls = [];
    await assert.rejects(artifact(s, { value, calls }), /changed/); assert.equal(calls.length, 1);
  }
  for (const conversation of [{ ...raw.conversation, id: "merged" }, { ...raw.conversation, team: { id: "other" } }])
    await assert.rejects(artifact(s, { value: { ...raw, conversation } }), /changed|approved Missive team/);
});
test("provider signed URLs must remain on explicitly configured origins", async () => {
  const s = await imported();
  for (const url of ["http://storage.test-files.net/a", "https://storage.test-files.net.evil.net/a", "https://other.test-files.net/a", "https://user:secret@storage.test-files.net/a", "https://storage.test-files.net/a#fragment", "https://127.0.0.1/a", "/relative", undefined]) {
    const calls = [], value = { ...raw, attachments: [{ ...raw.attachments[0], url }] };
    await assert.rejects(artifact(s, { value, calls }), /storage origin|valid attachment download URL/); assert.equal(calls.length, 1);
  }
});
test("redirects, authentication failures and missing objects leave the workspace unchanged", async () => {
  const s = await imported(), before = structuredClone(s);
  for (const status of [206, 301, 302, 401, 403, 404, 500])
    await assert.rejects(artifact(s, { responseOptions: { status } }), /unavailable/);
  assert.deepEqual(s, before);
});
test("unexpected response MIME and size reject binary metadata before import", async () => {
  const s = await imported();
  for (const headers of [{ "Content-Type": "text/html" }, { "Content-Length": "100000000" }, { "Content-Length": "-1" }, { "Content-Length": "oops" }])
    await assert.rejects(artifact(s, { responseOptions: { headers } }), /reviewed metadata/);
});
test("stream overflow and truncation are bounded even without Content-Length", async () => {
  const s = await imported();
  await assert.rejects(artifact(s, { binary: new Uint8Array(bytes.length + 1), responseOptions: { headers: {} } }), e => e.status === 413);
  await assert.rejects(artifact(s, { binary: bytes.slice(0, -1), responseOptions: { headers: {} } }), /incomplete/);
});
test("same-length HTML does not become a PDF merely through provider metadata", async () => {
  const s = await imported();
  await assert.rejects(artifact(s, { binary: new Uint8Array(bytes.length).fill(60) }), /contents do not match/);
});
test("download errors never echo provider URLs, tokens or response bodies", async () => {
  const s = await imported();
  let count = 0;
  await assert.rejects(downloadMissiveAttachment(config, "workspace", owner, mapping, s, "message", "attachment", async () => {
    if (count++ === 0) return json({ messages: raw }); throw new Error("TEST-TOKEN TEST-PRIVATE-LINK");
  }), e => /could not be downloaded/.test(e.message) && !/TEST-TOKEN|TEST-PRIVATE-LINK/.test(e.message));
});
test("unsupported names, unsupported types, zero and oversized manifests are rejected before download", async () => {
  for (const change of [{ filename: "../file.pdf" }, { filename: "file\\x.pdf" }, { filename: "file\u0000.pdf" }, { filename: "file.pdf.exe" }, { filename: " file.pdf" }, { filename: "x".repeat(252) + ".pdf" }, { sub_type: "octet-stream" }, { size: 0 }, { size: MAX_MISSIVE_ATTACHMENT_BYTES + 1 }]) {
    const value = { ...raw, attachments: [{ ...raw.attachments[0], ...change }] }, s = await imported(value), calls = [];
    await assert.rejects(artifact(s, { value, calls }), /not supported|50 MB/); assert.equal(calls.length, 0);
  }
});
test("canonical artifact validation rejects altered identities, destinations, metadata and bytes", async () => {
  const s = await imported(), a = await artifact(s);
  for (const patch of [{ companyId: "B" }, { orderId: "O-B" }, { documentId: "arbitrary" }, { assetId: "arbitrary" }, { filename: "other.pdf" }, { mime: "text/plain" }, { bytes: bytes.slice(1) }, { sha256: "f".repeat(64) }, { providerSource: { ...a.providerSource, importedBy: "spoofed@example.com" } }, { providerSource: { ...a.providerSource, mappingVersion: 99 } }, { providerSource: { ...a.providerSource, sourceDocumentId: "missing" } }])
    await assert.rejects(attachMissiveAttachment(s, owner, mapping, { ...a, ...patch }, crypto.randomUUID()), /does not match/);
});
test("provider attachment provenance is immutable while manual source classification remains available", async () => {
  const s = await imported(), a = await artifact(s), next = await attachMissiveAttachment(s, owner, mapping, a, crypto.randomUUID());
  assert.throws(() => executeCommands(next, edit(a.documentId, { providerSource: { ...a.providerSource, attachmentId: "other" } }), owner));
  const classified = executeCommands(next, edit(a.documentId, { sourceRole: "Preliminary opinion" }), owner);
  assert.equal(classified.documents.find(d => d.id === a.documentId).sourceRole, "Preliminary opinion");
  assert.deepEqual(classified.documents.find(d => d.id === a.documentId).providerSource, a.providerSource);
  assert.throws(() => executeCommands(next, edit(s.documents[0].id, { sourceRole: "Preliminary opinion" }), owner), /reclassified/);
});
test("new source restrictions hide already-saved attachments even if their own visibility was internal", async () => {
  const s = await imported(), a = await artifact(s), next = await attachMissiveAttachment(s, owner, mapping, a, crypto.randomUUID());
  next.documents.find(d => d.id === s.documents[0].id).visibility = "Restricted";
  const limited = { ...owner, role: "operations", restricted: false };
  assert.equal(projectWorkspace(next, limited).documents.length, 0);
  assert.equal(projectWorkspace(next, limited).inbox.length, 0);
});
test("a completed import can be found after file issuance without starting another download", async () => {
  const s = await imported(), a = await artifact(s), next = await attachMissiveAttachment(s, owner, mapping, a, crypto.randomUUID());
  next.orders[0].status = "Issued";
  assert.equal(existingMissiveAttachment(next, owner, mapping, "message", "attachment").id, a.documentId);
});
