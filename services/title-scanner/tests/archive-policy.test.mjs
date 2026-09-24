import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInspectableArchive } from '../src/archive-policy.mjs';
import { zipFixture } from './zip-fixture.mjs';
const clean = Buffer.from('Fictional readable archive content.');
test('plain documents and fully readable ZIP/OOXML-sized members remain inspectable', async () => {
  await assertInspectableArchive(clean);
  await assertInspectableArchive(zipFixture(clean, 'word/document.xml'));
  await assertInspectableArchive(zipFixture(zipFixture(clean), 'nested.zip'));
});
test('encrypted, unsupported compression, corrupt CRC, mismatched sizes, malformed and hidden ZIP records fail closed', async () => {
  const valid = zipFixture(clean);
  const central = valid.indexOf(Buffer.from('504b0102', 'hex'));
  const cases = [valid.subarray(0, valid.length - 1)];
  const encrypted = Buffer.from(valid); encrypted.writeUInt16LE(1, 6); encrypted.writeUInt16LE(1, central + 8); cases.push(encrypted);
  const compression = Buffer.from(valid); compression.writeUInt16LE(99, 8); compression.writeUInt16LE(99, central + 10); cases.push(compression);
  const crc = Buffer.from(valid); crc.writeUInt32LE(0, 14); crc.writeUInt32LE(0, central + 16); cases.push(crc);
  const size = Buffer.from(valid); size.writeUInt32LE(clean.length + 1, 22); size.writeUInt32LE(clean.length + 1, central + 24); cases.push(size);
  const mismatch = Buffer.from(valid); mismatch.writeUInt32LE(clean.length + 1, 22); cases.push(mismatch);
  // Insert an unlisted local record before the central directory and keep EOCD offsets valid.
  const hidden = Buffer.concat([valid.subarray(0, central), Buffer.alloc(30), valid.subarray(central)]);
  hidden.writeUInt32LE(central + 30, hidden.length - 6); cases.push(hidden);
  for (const fixture of cases) await assert.rejects(assertInspectableArchive(fixture));
});
test('expansion, aggregate bytes, nested depth, unsupported archives and abort are bounded', async () => {
  await assert.rejects(assertInspectableArchive(zipFixture(Buffer.alloc(25 * 1024 * 1024 + 1))));
  await assert.rejects(assertInspectableArchive(zipFixture(clean), undefined, { bytes: 100 * 1024 * 1024, entries: 0 }));
  await assert.rejects(assertInspectableArchive(zipFixture(clean), undefined, { bytes: 0, entries: 2048 }));
  let nested = clean; for (let i = 0; i < 5; i++) nested = zipFixture(nested);
  await assert.rejects(assertInspectableArchive(nested));
  for (const hex of ['526172211a0700', '377abcaf271c', '1f8b0800', '425a68', 'fd377a585a00', '4d534346']) {
    const archive = Buffer.from(hex, 'hex'); await assert.rejects(assertInspectableArchive(archive));
    await assert.rejects(assertInspectableArchive(zipFixture(archive)));
  }
  await assert.rejects(assertInspectableArchive(zipFixture(clean), AbortSignal.abort()));
});
