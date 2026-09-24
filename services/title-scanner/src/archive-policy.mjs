import { fromBufferPromise } from 'yauzl';
import { crc32 } from 'node:zlib';

const MAX_ENTRY = 25 * 1024 * 1024;
const MAX_EXPANDED = 100 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const MAX_DEPTH = 4;
const zipMagic = bytes => bytes.length >= 4 && (bytes.readUInt32LE(0) === 0x04034b50 || bytes.readUInt32LE(0) === 0x06054b50);
function unsupportedArchive(bytes) {
  return ['526172211a07', '377abcaf271c', '1f8b', '425a68', 'fd377a585a00', '4d534346'].some(hex => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'))) ||
    (bytes.length > 262 && bytes.subarray(257, 262).toString() === 'ustar');
}
const deny = () => { throw new Error('scanner_unavailable'); };

/** ClamAV can silently skip very large ZIP members even with AlertExceedsMax. Independently bound and fully read ZIPs. */
export async function assertInspectableArchive(input, signal, budget = { bytes: 0, entries: 0 }, depth = 0) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (signal?.aborted || unsupportedArchive(bytes)) deny();
  if (!zipMagic(bytes)) return;
  if (depth >= MAX_DEPTH) deny();
  // Keep the accepted ZIP subset explicit: one disk, no ZIP64/SFX/trailing hidden payloads.
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { eocd = index; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) deny();
  const count = bytes.readUInt16LE(eocd + 10), centralSize = bytes.readUInt32LE(eocd + 12), centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || count !== bytes.readUInt16LE(eocd + 8) || centralOffset + centralSize !== eocd) deny();
  const zip = await fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  const ranges = [];
  try {
    for await (const entry of zip.eachEntry()) {
      if (signal?.aborted || ++budget.entries > MAX_ENTRIES || !Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize > MAX_ENTRY || ![0, 8].includes(entry.compressionMethod) ||
          (entry.generalPurposeBitFlag & (1 | 64)) || entry.extraFields.some(field => field.id === 1)) deny();
      const local = await zip.readLocalFileHeaderPromise(entry);
      if (local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
          (!(entry.generalPurposeBitFlag & 8) && (local.compressedSize !== entry.compressedSize || local.uncompressedSize !== entry.uncompressedSize || local.crc32 !== entry.crc32))) deny();
      const end = local.fileDataStart + entry.compressedSize;
      if (end > centralOffset) deny();
      ranges.push({ start: entry.relativeOffsetOfLocalHeader, end, descriptor: !!(entry.generalPurposeBitFlag & 8), entry });
      const stream = await zip.openReadStreamPromise(entry);
      const aborted = () => stream.destroy(new Error('scanner_unavailable'));
      signal?.addEventListener('abort', aborted, { once: true });
      const chunks = [], probe = []; let size = 0, checksum = 0, nested;
      const classify = () => {
        const prefix = Buffer.concat(probe);
        if (unsupportedArchive(prefix)) deny();
        nested = zipMagic(prefix);
        if (nested) chunks.push(prefix);
        probe.length = 0;
      };
      try {
        for await (const chunk of stream) {
          size += chunk.length; budget.bytes += chunk.length;
          if (signal?.aborted || size > MAX_ENTRY || budget.bytes > MAX_EXPANDED) deny();
          checksum = crc32(chunk, checksum);
          if (nested === undefined) { probe.push(chunk); if (size >= 512) classify(); }
          else if (nested) chunks.push(chunk);
        }
        if (nested === undefined) classify();
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) deny();
        if (nested) await assertInspectableArchive(Buffer.concat(chunks, size), signal, budget, depth + 1);
      } finally { signal?.removeEventListener('abort', aborted); stream.destroy(); }
    }
    // Every local record must belong to the central directory; reject overlaps, hidden records and ambiguous descriptors.
    ranges.sort((a, b) => a.start - b.start);
    let next = 0;
    for (const range of ranges) {
      if (range.start !== next) deny();
      next = range.end;
      if (range.descriptor) {
        if (next + 12 > centralOffset) deny();
        if (bytes.readUInt32LE(next) === 0x08074b50) next += 4;
        if (next + 12 > centralOffset || bytes.readUInt32LE(next) !== range.entry.crc32 ||
            bytes.readUInt32LE(next + 4) !== range.entry.compressedSize || bytes.readUInt32LE(next + 8) !== range.entry.uncompressedSize) deny();
        next += 12;
      }
    }
    if (next !== centralOffset) deny();
  } finally { zip.close(); }
}
