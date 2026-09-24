// Real PDF reader -> actual backend transition validation -> serialized storage.
// No hosted records, provider calls, or real client originals enter this test.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const web = fileURLToPath(new URL("../", import.meta.url));
const output = await build({ write: false, bundle: true, platform: "node", format: "esm", target: "es2022", logLevel: "silent",
  stdin: { resolveDir: web, contents: 'export * from "./lib/title/package-reader"; export { verifyPackageTransition, documentPackageRequest } from "./lib/backend/document-packages"; export { emptyWorkspace } from "./lib/backend/workspace"; export { analyzeTitleDocuments } from "./lib/title/document-intelligence";' },
  plugins: [{ name: "package-flow-ocr-fixture", setup(builder) {
    builder.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: pathToFileURL(resolve(web, "node_modules", args.path)).href, external: true }));
    builder.onResolve({ filter: /^\.\/local-ocr$/ }, args => args.importer.endsWith("package-reader.ts") ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export async function recognizeDocumentPage(blob,page,options){return globalThis.__packageFlowOcr(blob,page,options);}' }));
  } }],
});
const { readDocumentPackage, packageSha256, verifyPackageTransition, documentPackageRequest, emptyWorkspace, analyzeTitleDocuments } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + "\n//# sourceURL=package-backend-flow-bundle.mjs").toString("base64")}`);
const access = "workspace-A:operator-A:4";
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(count, content = page => `Fictional physical page ${page}`) {
  const objects = [], add = value => objects.push(value);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let page = 1; page <= count; page++) {
    const id = objects.length + 1, lines = content(page).split("\n");
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = `BT /F1 12 Tf 72 720 Td ${lines.map(line => `(${line.replace(/[\\()]/g, "\\$&")}) Tj 0 -16 Td`).join(" ")} ET`;
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.7\n"; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([body], { type: "application/pdf" });
}
function document(id = "original-A") { return { id, assetId: `asset-${id}`, version: 1, name: `${id}.pdf`, mime: "application/pdf", companyId: "company-A", orderId: "order-A", visibility: "Internal", sourceRole: "security-instrument" }; }
async function persistent(sources) {
  let row = { sources: await Promise.all(sources.map(async ({ document: doc, blob }) => ({ documentId: doc.id, assetId: doc.assetId, version: doc.version, name: doc.name,
    mime: doc.mime, companyId: doc.companyId, orderId: doc.orderId, visibility: doc.visibility, sourceRole: doc.sourceRole, sha256: await packageSha256(blob), bytes: blob.size }))), checkpoint: null, pages: {}, version: 1 };
  row.sources.sort((a, b) => a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0);
  const attempts = []; let failNext = false, loseAck = false;
  return {
    get row() { return clone(row); }, get attempts() { return attempts; },
    failNextWrite() { failNext = true; }, loseNextAcknowledgement() { loseAck = true; },
    loadCheckpoint: async identities => { assert.deepEqual(identities, row.sources); return clone(row.checkpoint); },
    onBatch: async (batch, checkpoint) => {
      const before = clone(row); attempts.push(clone(batch));
      const verified = await verifyPackageTransition(before, clone(batch), clone(checkpoint), access);
      if (failNext && batch.pages.length) { failNext = false; assert.deepEqual(row, before); throw Error("Atomic checkpoint write rejected"); }
      // The complete new row replaces the prior serialized row atomically.
      row = clone({ ...row, checkpoint: verified.checkpoint, pages: { ...row.pages, ...verified.pages }, version: row.version + 1 });
      if (loseAck && batch.pages.length) { loseAck = false; throw Error("Saved acknowledgement lost"); }
    },
    reverseCheckpointSources() { row.checkpoint.sources.reverse(); },
  };
}

test("500-page real reader saves backend-verified receipts and late title fields survive serialized reopen", async () => {
  globalThis.__packageFlowOcr = async () => assert.fail("Text fixture unexpectedly required OCR");
  const sources = [{ document: document(), blob: fixture(500, page => page === 500 ? "DEED OF TRUST\nLoan amount: $876,543.21" : `Fictional search page ${page}`) }];
  const storage = await persistent(sources);
  const first = await readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(first.status, "complete"); assert.equal(first.completedPages, 500); assert.equal(Object.keys(storage.row.pages).length, 500);
  assert.ok(storage.attempts.every(batch => batch.pages.length <= 10));
  const stored = storage.row;
  const analysis = analyzeTitleDocuments([{ id: sources[0].document.id, name: sources[0].document.name, version: 1, pages: Object.values(stored.pages) }]);
  const candidate = analysis.fields.find(field => field.fieldId === "loanAmount").candidates.find(candidate => candidate.rawValue === "$876,543.21");
  assert.ok(candidate); assert.equal(candidate.evidence.page, 500); assert.equal(candidate.evidence.documentId, "original-A"); assert.match(candidate.evidence.quote, /876,543\.21/);
  const before = storage.attempts.length;
  const reopened = await readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(reopened.completedPages, 500); assert.ok(storage.attempts.slice(before).every(batch => batch.pages.length === 0));
  assert.deepEqual(storage.row.pages, stored.pages);
});

test("cancel and reload resumes only unread scanned pages through real backend transition validation", async () => {
  const sources = [{ document: document(), blob: fixture(25, () => "") }], storage = await persistent(sources), abort = new AbortController(), calls = [];
  globalThis.__packageFlowOcr = async (_blob, page) => { calls.push(page); if (page === 4) abort.abort(); return { text: `Fictional scan ${page}`, confidence: 83 }; };
  const paused = await readDocumentPackage(sources, { accessIdentity: access, signal: abort.signal, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(paused.status, "cancelled"); assert.equal(Object.keys(storage.row.pages).length, 3);
  calls.length = 0; globalThis.__packageFlowOcr = async (_blob, page) => { calls.push(page); return { text: `Fictional resumed scan ${page}`, confidence: 88 }; };
  const resumed = await readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(resumed.status, "complete"); assert.deepEqual(calls, Array.from({ length: 22 }, (_, i) => i + 4));
  assert.equal(storage.row.pages["original-A:1"].text, "Fictional scan 1");
});

test("failed atomic save does not advance checkpoints and reopening after lost acknowledgement preserves exactly one page copy", async () => {
  const sources = [{ document: document(), blob: fixture(25) }], storage = await persistent(sources);
  storage.failNextWrite();
  await assert.rejects(readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch }), /Atomic checkpoint write rejected/);
  assert.deepEqual(storage.row.pages, {}); assert.deepEqual(storage.row.checkpoint.sources[0].completed, []);
  storage.loseNextAcknowledgement();
  await assert.rejects(readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch }), /Saved acknowledgement lost/);
  assert.equal(Object.keys(storage.row.pages).length, 10); assert.equal(storage.row.checkpoint.sources[0].completed.length, 10);
  const before = storage.attempts.length;
  const resumed = await readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(resumed.status, "complete"); assert.equal(Object.keys(storage.row.pages).length, 25);
  assert.ok(storage.attempts.slice(before).flatMap(batch => batch.attemptedPages).every(page => page > 10));
});

test("multiple originals use server-canonical identity order and reversed stored checkpoint arrays resume safely", async () => {
  const sources = [{ document: document("original-z"), blob: fixture(2) }, { document: document("original-A"), blob: fixture(3) }], storage = await persistent(sources);
  const first = await readDocumentPackage(sources, { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(first.completedPages, 5); assert.deepEqual(first.checkpoint.sources.map(source => source.identity.documentId), ["original-A", "original-z"]);
  storage.reverseCheckpointSources();
  const reopened = await readDocumentPackage([...sources].reverse(), { accessIdentity: access, loadCheckpoint: storage.loadCheckpoint, onBatch: storage.onBatch });
  assert.equal(reopened.completedPages, 5); assert.equal(Object.keys(storage.row.pages).length, 5);
  assert.deepEqual(reopened.checkpoint.sources.map(source => source.identity.documentId), ["original-A", "original-z"]);
});

test("PostgreSQL jsonb object-key reordering survives authenticated open, scan saves, reload, retry and field review", async () => {
  // jsonb preserves array order but does not preserve JavaScript object insertion
  // order. Rebuild every nested object before each RPC read, including identity,
  // receipt, issue, page and review evidence objects.
  const jsonb = value => Array.isArray(value) ? value.map(jsonb) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)).reverse().map(([key, item]) => [key, jsonb(item)])) : value;
  const inputs = [
    { document: { ...document("original-z"), sourceRole: undefined }, blob: fixture(2) },
    { document: { ...document("original-A"), sourceRole: undefined }, blob: fixture(25, page => page === 1 ? "" : page === 2 ? "DEED OF TRUST\nLoan amount: $275,000.00\nTrustee: Example Trustee, Inc." : `Fictional page ${page}`) },
  ];
  const state = emptyWorkspace();
  state.companies = [{ id: "company-A", name: "Fictional Package Title", initials: "FP", color: "blue", contact: "Example", email: "fictional@example.test", location: "Charlotte", jurisdiction: "NC", stage: "Onboarding", steps: [], members: [] }];
  state.orders = [{ id: "order-A", companyId: "company-A", address: "123 Synthetic Lane", client: "Fictional Buyer", type: "Purchase", underwriter: "WFG", owner: "Operator", jurisdiction: "NC", status: "New", due: "2026-09-24", premium: 0, rate: 0, month: "2026-09", fields: [], notes: "", exception: "", delivered: false, remitted: false }];
  state.documents = inputs.map(({ document: doc, blob }) => ({ ...doc, category: "Title", date: "2026-09-23", size: `${blob.size} bytes` }));
  const assets = await Promise.all(inputs.map(async ({ document: doc, blob }) => ({ id: doc.assetId, document_id: doc.id, company_id: doc.companyId, sha256: await packageSha256(blob), byte_size: blob.size, mime: blob.type })));
  let row = null, loads = 0, sourceHash;
  const actions = [], context = { workspaceId: "workspace-A", access: { userId: "operator-A", email: "fictional@example.test", role: "operations", companyIds: ["company-A"], allCompanies: false, restricted: false, version: 4, partnerMembers: [] }, state, revision: 1, assets,
    rpc: async args => {
      const { p_action: action, p_input: input } = args; actions.push(action);
      if (action === "open" || action === "load") {
        if (!row) { assert.equal(action, "open"); sourceHash = input.sourcesHash; row = { id: "11111111-1111-4111-8111-111111111111", version: 1, sources: clone(input.sources), checkpoint: null, pages: {}, decisions: [] }; }
        if (action === "open") assert.equal(input.sourcesHash, sourceHash, "Canonical source hash changed solely due to stored key order");
        row = jsonb(clone(row)); loads++;
        return clone(row);
      }
      assert.equal(input.expectedVersion, row.version);
      if (action === "save") {
        row = jsonb({ ...row, version: row.version + 1, checkpoint: input.checkpoint, pages: { ...row.pages, ...input.pages }, decisions: Object.keys(input.pages).length ? [] : row.decisions });
        return { version: row.version };
      }
      assert.equal(action, "review"); row = jsonb({ ...row, version: row.version + 1, decisions: input.decisions });
      return jsonb({ version: row.version, decisions: clone(row.decisions) });
    },
  };
  const open = () => documentPackageRequest("open", { documentIds: inputs.map(input => input.document.id) }, context);
  let session = await open();
  assert.deepEqual(session.sources.map(source => source.documentId), ["original-A", "original-z"]);
  // This specifically guards the UI's JSON.stringify identity comparison.
  assert.notEqual(JSON.stringify(row.sources), JSON.stringify(session.sources), "The fixture must actually change stored identity key order");
  const originalIdentity = JSON.stringify(session.sources), abort = new AbortController();
  const scan = async pause => readDocumentPackage(inputs, {
    accessIdentity: session.accessIdentity, ...(pause ? { signal: abort.signal } : {}),
    loadCheckpoint: async identities => { assert.equal(JSON.stringify(identities), JSON.stringify(session.sources)); return session.checkpoint; },
    onBatch: async (batch, checkpoint) => {
      const response = await documentPackageRequest("save", { id: session.id, expectedVersion: session.version, batch, checkpoint }, context);
      session = { ...session, version: response.version, checkpoint };
      if (pause && batch.pages.length) abort.abort();
    },
  });
  globalThis.__packageFlowOcr = async () => { throw Object.assign(Error("Fictional OCR timeout"), { code: "timeout" }); };
  const paused = await scan(true);
  assert.equal(paused.status, "cancelled"); assert.equal(paused.completedPages, 9); assert.equal(row.checkpoint.sources[0].issues[0].reason, "timeout");
  session = await open();
  assert.equal(JSON.stringify(session.sources), originalIdentity); assert.equal(session.pages.length, 9);
  const analyze = value => analyzeTitleDocuments(value.sources.map(source => ({ id: source.documentId, name: source.name, version: source.version,
    pages: value.pages.filter(page => page.documentId === source.documentId) })).filter(doc => doc.pages.length));
  let analysis = analyze(session);
  let loan = analysis.fields.find(field => field.fieldId === "loanAmount").candidates[0];
  const record = async (candidate, action = "accepted", value) => {
    const response = await documentPackageRequest("review", { id: session.id, expectedVersion: session.version, decisions: [{ candidateId: candidate.id, action, ...(value ? { value } : {}), note: "Compared the value and document relationship against the original page." }] }, context);
    session = { ...session, version: response.version, decisions: response.decisions }; return response;
  };
  await record(loan); assert.equal(row.decisions.length, 1);
  session = await open(); assert.equal(session.decisions[0].evidence.page, 2); assert.equal(session.decisions[0].reviewerId, "operator-A");
  globalThis.__packageFlowOcr = async (_blob, page) => ({ text: `Recovered physical page ${page}`, confidence: 88, rotation: 0 });
  const resumed = await scan(false);
  assert.equal(resumed.status, "complete"); assert.equal(resumed.completedPages, 27); assert.equal(row.decisions.length, 0, "New page evidence must invalidate prior decisions");
  session = await open(); assert.equal(JSON.stringify(session.sources), originalIdentity); assert.equal(session.pages.length, 27);
  assert.deepEqual(session.checkpoint.sources.flatMap(source => source.issues), []);
  analysis = analyze(session); loan = analysis.fields.find(field => field.fieldId === "loanAmount").candidates[0];
  const trustee = analysis.fields.find(field => field.fieldId === "trustee").candidates[0];
  await record(loan); session = await open(); await record(trustee); session = await open();
  assert.equal(session.decisions.length, 2); assert.equal(session.decisions.find(decision => decision.fieldId === "loanAmount").reviewedValue, "$275,000.00");
  await record(loan, "corrected", "$275,100.00"); session = await open();
  assert.equal(session.decisions.length, 2); assert.equal(session.decisions.find(decision => decision.fieldId === "loanAmount").reviewedValue, "$275,100.00");
  assert.equal(session.decisions.find(decision => decision.fieldId === "trustee").reviewedValue, "Example Trustee, Inc.");
  // Order-insensitive equality must still reject changed identity values.
  const savedName = row.sources[0].name; row.sources[0].name = "Substituted original.pdf";
  await assert.rejects(open(), error => error.status === 409); row.sources[0].name = savedName;
  assert.ok(loads > 15); assert.ok(actions.includes("save")); assert.ok(actions.includes("review"));
});
