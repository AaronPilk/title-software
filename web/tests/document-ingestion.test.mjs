import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({ stdin: { contents: "export * from './lib/backend/document-ingestion'; export { jvPortalUpload } from './lib/backend/jv-portal'; export { newJVRecipientPayload } from './lib/title/jv-portal';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022' });
const { prepareDocumentIngestion, jvPortalUpload, newJVRecipientPayload } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const workspace = '10000000-0000-4000-8000-000000000001', invitation = '20000000-0000-4000-8000-000000000001', company = 'fictional-company';
const bytes = new TextEncoder().encode('Fictional recipient document.');
const env = { TITLE_SCANNER_URL: 'https://scanner.example.test/v1/scan', TITLE_SCANNER_TOKEN: 'synthetic-scanner-token-32-characters' };
const digest = async b => Buffer.from(await crypto.subtle.digest('SHA-256', b)).toString('hex');
function fixture(options = {}) {
  const calls = [], writes = [], receipts = new Map(), reservations = new Map();
  let policy = options.policy ?? 'required', counter = 0;
  const fetcher = async (_url, init) => {
    calls.push('scan'); if (options.scanThrows) throw Error('PRIVATE SCANNER ERROR');
    const result = { status: options.scanStatus ?? 'clean', protocolVersion: 1, requestId: init.headers['X-Scan-Request-ID'],
      sha256: init.headers['X-Content-SHA256'], byteLength: init.body.byteLength, scannedAt: new Date().toISOString(),
      engineVersion: 'ClamAV 1.5.4', signatureVersion: '28133', signatureUpdatedAt: new Date().toISOString(), ...options.receiptOverride };
    assert.equal(result.sha256, options.receiptOverride?.sha256 ?? await digest(init.body)); return Response.json(result);
  };
  const rpc = async (name, args) => {
    if (name === 'title_prepare_document_ingestion') {
      calls.push('prepare'); assert.equal(args.p_workspace, null); assert.equal(args.p_company, null);
      const r = reservations.get(args.p_path);
      if (!r || r.state !== 'pending' || options.expired || r.sha !== args.p_sha || r.size !== args.p_bytes) throw Error('PRIVATE RESERVATION ERROR');
      if ('invalidBinding' in options) return options.invalidBinding;
      return { workspaceId: workspace, companyId: company, policy };
    }
    if (name === 'title_record_document_scan') {
      calls.push('record'); assert.equal(args.p_workspace, workspace); assert.equal(args.p_company, company);
      const r = reservations.get(args.p_path); assert.equal(args.p_sha, r.sha); assert.equal(args.p_bytes, r.size);
      if (options.activateAtRecord) policy = 'required';
      if (options.recordFailure || (!args.p_receipt && policy === 'required')) throw Error('PRIVATE RECEIPT ERROR');
      if (args.p_receipt) {
        assert.equal(args.p_receipt.status, 'clean'); assert.equal(args.p_receipt.sha256, args.p_sha);
        assert.equal(args.p_receipt.byteLength, args.p_bytes); assert.equal(args.p_receipt.protocolVersion, 1);
      }
      assert.equal(receipts.has(args.p_path), false); receipts.set(args.p_path, structuredClone(args)); return null;
    }
    if (name === 'title_record_security_event') {
      calls.push(args.p_event_type); assert.equal(args.p_actor, null); assert.equal(args.p_workspace, workspace); assert.equal(args.p_company_id, company);
      assert.doesNotMatch(JSON.stringify(args), /Fictional recipient document|PRIVATE/);
      if (options.auditFailure) throw Error('PRIVATE AUDIT ERROR'); return null;
    }
    assert.equal(name, 'title_jv_portal_public'); calls.push(args.p_action);
    if (args.p_action === 'reserve-attachment') {
      const id = `30000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, objectPath = `jv-recipient/${invitation}/${id}`;
      reservations.set(objectPath, { id, sha: args.p_input.sha256, size: args.p_input.bytes, state: 'pending' }); return { id, objectPath };
    }
    const target = [...reservations.entries()].find(([, r]) => r.id === args.p_input.attachmentId); assert.ok(target);
    const [path, r] = target;
    if (args.p_action === 'cancel-attachment') { r.state = 'cancelled'; return {}; }
    assert.equal(args.p_action, 'finalize-attachment'); if (options.finalizeFailure) throw Error('PRIVATE FINALIZATION ERROR');
    assert.ok(receipts.has(path)); assert.ok(writes.some(write => write.path === path)); r.state = 'ready';
    return { application: { id: invitation, companyName: 'Fictional Company', recipientName: 'Fictional Recipient', status: 'Draft', version: counter,
      expiresAt: '2026-12-01T00:00:00Z', payload: newJVRecipientPayload(), attachments: [{ id: r.id, name: 'fixture.txt', mime: 'text/plain', bytes: r.size, sha256: r.sha }], correctionNote: '', submittedAt: null } };
  };
  const context = { trustedIp: '192.0.2.10', rpc, storage: {
    upload: async (path, content, mime) => {
      const prepared = await prepareDocumentIngestion({ path, bytes: content }, options.config ?? env, rpc, fetcher);
      calls.push('storage'); if (options.storageFailure) throw Error('PRIVATE STORAGE ERROR');
      assert.ok(prepared instanceof Uint8Array); writes.push({ path, bytes: new Uint8Array(prepared), mime });
    }, download: async () => assert.fail('unexpected download'), remove: async () => assert.fail('uncertain originals must not be deleted'),
  } };
  return { calls, writes, receipts, reservations, rpc, fetcher, context, options,
    upload: () => jvPortalUpload('A'.repeat(43), { name: 'fixture.txt', type: 'text/plain', bytes: new Uint8Array(bytes) }, context) };
}
test('recipient upload uses actual helper and byte-bound receipt before storage/finalization', async () => {
  const f = fixture(); const result = await f.upload(); assert.equal(result.attachments.length, 1);
  assert.deepEqual(f.calls, ['reserve-attachment', 'prepare', 'scan', 'record', 'storage', 'finalize-attachment']);
  assert.equal(f.receipts.size, 1); assert.deepEqual(f.writes[0].bytes, bytes); assert.equal([...f.receipts.values()][0].p_sha, await digest(f.writes[0].bytes));
});
test('pending setup stays explicitly unscanned without scanner transmission', async () => {
  const f = fixture({ policy: 'pending_setup' }); await f.upload(); assert.ok(!f.calls.includes('scan'));
  assert.equal([...f.receipts.values()][0].p_receipt, null); assert.equal(f.writes.length, 1);
});
test('policy activation at receipt persistence stops pending setup before storage', async () => {
  const f = fixture({ policy: 'pending_setup', activateAtRecord: true });
  await assert.rejects(f.upload, e => e.status === 503 && !e.message.includes('PRIVATE'));
  assert.equal(f.writes.length, 0); assert.equal(f.receipts.size, 0); assert.equal(f.calls.at(-1), 'cancel-attachment');
});
test('infected, missing scanner, scanner errors, wrong hash, stale signatures and failed audits never store recipient bytes', async () => {
  for (const options of [{ scanStatus: 'infected' }, { config: {} }, { scanThrows: true }, { receiptOverride: { sha256: '0'.repeat(64) } },
    { receiptOverride: { signatureUpdatedAt: '2020-01-01T00:00:00Z' } }, { scanStatus: 'infected', auditFailure: true }]) {
    const f = fixture(options); await assert.rejects(f.upload, e => e.status === 503 && !e.message.includes('PRIVATE'));
    assert.equal(f.writes.length, 0); assert.equal(f.receipts.size, 0); assert.equal(f.calls.at(-1), 'cancel-attachment');
    assert.ok(f.calls.some(c => ['document.scan_blocked', 'document.scan_unavailable'].includes(c)));
  }
});
test('expired reservations and malformed bindings fail before scan/storage', async () => {
  for (const options of [{ expired: true }, ...[null, {}, { workspaceId: workspace, companyId: company, policy: 'unknown' },
    { workspaceId: 42, companyId: company, policy: 'required' }].map(invalidBinding => ({ invalidBinding }))]) {
    const f = fixture(options); await assert.rejects(f.upload, e => e.status === 503);
    assert.equal(f.writes.length, 0); assert.equal(f.receipts.size, 0); assert.ok(!f.calls.includes('scan'));
  }
});
test('clean result without durable receipt cannot reach recipient storage', async () => {
  const f = fixture({ recordFailure: true }); await assert.rejects(f.upload, e => e.status === 503);
  assert.equal(f.writes.length, 0); assert.equal(f.receipts.size, 0); assert.ok(f.calls.includes('scan')); assert.ok(!f.calls.includes('storage'));
});
test('storage failure leaves an unused receipt; retry gets a new path and scan', async () => {
  const options = { storageFailure: true }, f = fixture(options); await assert.rejects(f.upload, e => e.status === 503);
  assert.equal(f.receipts.size, 1); assert.equal(f.writes.length, 0); options.storageFailure = false; await f.upload();
  assert.equal(f.receipts.size, 2); assert.equal(f.writes.length, 1); assert.equal(f.calls.filter(c => c === 'scan').length, 2);
});
test('uncertain finalization retains private bytes for reconciliation', async () => {
  const f = fixture({ finalizeFailure: true }); await assert.rejects(f.upload, e => e.status === 503 && !e.message.includes('PRIVATE'));
  assert.equal(f.writes.length, 1); assert.equal(f.receipts.size, 1); assert.ok(!f.calls.includes('cancel-attachment'));
});
test('returned storage snapshot stays byte-bound when the original Uint8Array or pooled Buffer mutates during RPC', async () => {
  for (const source of [new Uint8Array(bytes), Buffer.from(bytes)]) {
    const f = fixture(); const path = `jv-recipient/${invitation}/30000000-0000-4000-8000-000000000001`;
    f.reservations.set(path, { id: 'test', sha: await digest(source), size: source.byteLength, state: 'pending' });
    const rpc = async (name, args) => { const result = await f.rpc(name, args); if (name === 'title_prepare_document_ingestion') source.fill(88); return result; };
    const prepared = await prepareDocumentIngestion({ path, bytes: source }, env, rpc, f.fetcher);
    assert.ok(prepared instanceof Uint8Array); assert.notEqual(prepared.buffer, source.buffer);
    assert.deepEqual(prepared, bytes); assert.equal(await digest(prepared), [...f.receipts.values()][0].p_sha);
  }
});
