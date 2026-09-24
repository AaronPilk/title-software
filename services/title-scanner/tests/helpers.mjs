import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';

export function tlsFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'title-scanner-tls-'));
  const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem');
  const configPath = join(directory, 'openssl.cnf');
  writeFileSync(configPath, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-config', configPath], { stdio: 'ignore' });
  return { directory, keyPath, certPath, key: readFileSync(keyPath), cert: readFileSync(certPath), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
export function baseConfig(tls) { return { ...tls, token: 'local-test-token-'.repeat(3), host: '127.0.0.1', port: 0,
  socketPath: '/missing/title-scanner.sock', maxBytes: 1024, timeoutMs: 1000, maxConcurrent: 2, maxSignatureAgeMs: 48 * 3600000 }; }
export function headersFor(bytes, token) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream',
  'Content-Length': String(bytes.length), 'X-Content-SHA256': createHash('sha256').update(bytes).digest('hex'),
  'X-Scan-Protocol': '1', 'X-Scan-Request-ID': randomUUID() }; }
export function request(server, ca, bytes, headers, path = '/v1/scan') {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path, ca, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(bytes);
  });
}
export async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server; }
export async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
