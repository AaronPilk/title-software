import net from 'node:net';
import { assertInspectableArchive } from './archive-policy.mjs';

const MAX_REPLY = 4096;
/** One socket and one command per request. No document paths are passed to the daemon. */
export function clamdCommand(socketPath, command, bytes, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let reply = Buffer.alloc(0), settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (error) reject(new Error('scanner_unavailable')); else resolve(value);
    };
    const onAbort = () => finish(new Error());
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.on('error', () => finish(new Error()));
    socket.on('end', () => { if (!settled) finish(new Error()); });
    socket.on('close', () => { if (!settled) finish(new Error()); });
    socket.on('data', chunk => {
      if (reply.length + chunk.length > MAX_REPLY) return finish(new Error());
      reply = Buffer.concat([reply, chunk]);
      const end = reply.indexOf(0);
      if (end < 0) return;
      if (end !== reply.length - 1 || reply.subarray(0, end).includes(10)) return finish(new Error());
      finish(null, reply.subarray(0, end).toString('utf8'));
    });
    socket.once('connect', async () => {
      try {
        // Drain backpressure before queuing more data, while the shared request deadline stays active.
        const write = chunk => new Promise((yes, no) => {
          if (settled || signal?.aborted) return no(new Error());
          socket.write(chunk, error => error ? no(error) : yes());
        });
        await write(Buffer.from(`z${command}\0`));
        if (command === 'INSTREAM') {
          for (let offset = 0; offset < bytes.length; offset += 65536) {
            const chunk = bytes.subarray(offset, offset + 65536);
            const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length);
            await write(length); await write(chunk);
          }
          await write(Buffer.alloc(4));
        }
      } catch { finish(new Error()); }
    });
  });
}

function versionMetadata(value, now, maxSignatureAgeMs) {
  const match = /^ClamAV ([0-9]+\.[0-9]+\.[0-9]+(?:[a-zA-Z0-9.+_-]{0,32})?)\/([0-9]{1,12})\/(.{1,100})$/.exec(value);
  const stamp = match ? Date.parse(`${match[3]} UTC`) : NaN;
  if (!match || !Number.isFinite(stamp) || stamp > now + 60000 || now - stamp > maxSignatureAgeMs)
    throw new Error('scanner_unavailable');
  return { engineVersion: `ClamAV ${match[1]}`, signatureVersion: match[2], signatureUpdatedAt: new Date(stamp).toISOString() };
}

/** Authenticated readiness exposes engine health only, never document content or identifiers. */
export async function inspectClamd(config, signal) {
  const before = await clamdCommand(config.socketPath, 'VERSION', null, signal);
  const metadata = versionMetadata(before, Date.now(), config.maxSignatureAgeMs);
  if (await clamdCommand(config.socketPath, 'PING', null, signal) !== 'PONG' ||
      await clamdCommand(config.socketPath, 'VERSION', null, signal) !== before) throw new Error('scanner_unavailable');
  return { status: 'ready', ...metadata };
}

export async function scanWithClamd(bytes, config, signal) {
  await assertInspectableArchive(bytes, signal);
  const before = await clamdCommand(config.socketPath, 'VERSION', null, signal);
  const metadata = versionMetadata(before, Date.now(), config.maxSignatureAgeMs);
  const reply = await clamdCommand(config.socketPath, 'INSTREAM', bytes, signal);
  let status;
  if (reply === 'stream: OK') status = 'clean';
  else if (/^stream: [\x20-\x7e]{1,200} FOUND$/.test(reply)) status = 'infected';
  else throw new Error('scanner_unavailable');
  // Do not claim a definition version if the engine reloaded while the document was scanning.
  if (await clamdCommand(config.socketPath, 'VERSION', null, signal) !== before) throw new Error('scanner_unavailable');
  return { status, ...metadata };
}
