import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID, createCipheriv, createHash } from 'node:crypto';
import { offsitePlan, uploadOffsite, fetchOffsite } from '../offsite.mjs';
import { verifyBundle } from '../recovery.mjs';
import { Miniflare, convertV4MiniflareOptions } from '../../../web/node_modules/miniflare/dist/src/index.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const project = 'a'.repeat(20), dest = randomUUID(), id = randomUUID();
const key = randomBytes(32), writer = randomBytes(32).toString('hex'), reader = randomBytes(32).toString('hex');
const envNames = ['TITLE_OFFSITE_TEST_KEY','TITLE_OFFSITE_TEST_WRITE','TITLE_OFFSITE_TEST_READ'];
// Authenticated encrypted transport fixture; payload is synthetic, not a restorable SQL dump.
async function fixture(dir) {
  await fs.mkdir(dir, { mode: 0o700 });
  const encrypt = async (name, bytes) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(`title-recovery-v1/${id}/${name}`)); await fs.writeFile(path.join(dir,name),Buffer.concat([iv,c.update(bytes),c.final(),c.getAuthTag()]),{mode:0o600}); return {name,bytes:bytes.length,sha256:hash(bytes)}; };
  const entries = [];
  entries.push({...await encrypt('00000000.enc', Buffer.alloc(8*1024*1024+199,67)), kind:'database'});
  entries.push({...await encrypt('00000001.enc', Buffer.from('SYNTHETIC_ROLE_FIXTURE')), kind:'roles'});
  const root = Buffer.from(randomBytes(32).toString('hex'));
  entries.push({...await encrypt('00000002.enc', root), kind:'vault-root-key'});
  const manifest = {format:'title-recovery-v1',archiveId:id,createdAt:new Date().toISOString(),source:{id:project,kind:'managed-supabase',host:`db.${project}.supabase.co`,bootstrapRole:'postgres'},roles:[],roleMemberships:[],serverVersion:'170011',objects:[],entries,vaultKeyFingerprint:hash(root)};
  await encrypt('manifest.enc',Buffer.from(JSON.stringify(manifest)));
  await fs.writeFile(path.join(dir,'bundle.json'),JSON.stringify({format:manifest.format,archiveId:id}),{mode:0o600});
}

test('encrypted offsite transport through native workerd and real local R2', {timeout:120_000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'title-offsite-')), archive = path.join(root,'archive');
  const prior = Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
  process.env[envNames[0]]=key.toString('hex'); process.env[envNames[1]]=writer; process.env[envNames[2]]=reader;
  const config={archiveKeyEnv:envNames[0],maxEntryBytes:16*1024*1024,maxTotalBytes:32*1024*1024,source:{id:project},offsite:{endpoint:'https://backup.example.test',destinationId:dest,accountBoundary:'same-account',writerTokenEnv:envNames[1],readerTokenEnv:envNames[2],retentionEvidence:'Fictional local retention test only',maxCiphertextBytes:32*1024*1024}};
  const worker = await fs.readFile(new URL('../../../services/title-backups/src/worker.mjs',import.meta.url),'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({name:'title-offsite-native-test',modules:true,script:worker,compatibilityDate:'2026-09-24',compatibilityFlags:['nodejs_compat'],port:0,r2Buckets:['ARCHIVES'],bindings:{BACKUP_SOURCE_ID:project,BACKUP_DESTINATION_ID:dest,BACKUP_ACCOUNT_BOUNDARY:'same-account',BACKUP_WRITE_TOKEN:writer,BACKUP_READ_TOKEN:reader}}));
  const originalFetch=globalThis.fetch;let requests=0;
  const bridge=async(url,options)=>{requests++;assert.equal(new URL(url).origin,'https://backup.example.test');assert.equal(options.redirect,'error');return mf.dispatchFetch(String(url),options);};
  globalThis.fetch=bridge;
  try {
    await fixture(archive); const bucket=await mf.getR2Bucket('ARCHIVES');
    await t.test('plan authenticates all entries without network or plaintext outputs',async()=>{
      const result=await offsitePlan(config,archive);assert.equal(result.dryRun,true);assert.equal(result.accountBoundary,'same-account');assert.equal(requests,0);assert.match(result.limitation,/not independent/);
      assert.equal((await verifyBundle(config,archive)).archiveId,id);
    });
    await t.test('rejects tampered archives, missing keys and undersized capacity before any network',async()=>{
      const p=path.join(archive,'00000001.enc'),original=await fs.readFile(p),bad=Buffer.from(original);bad[13]^=1;await fs.writeFile(p,bad);
      await assert.rejects(uploadOffsite(config,archive),/authentication/);assert.equal(requests,0);await fs.writeFile(p,original);
      await assert.rejects(uploadOffsite({...config,offsite:{...config.offsite,maxCiphertextBytes:2}},archive),/capacity/);assert.equal(requests,0);
      delete process.env[envNames[0]];await assert.rejects(uploadOffsite(config,archive),/secret/);process.env[envNames[0]]=key.toString('hex');assert.equal(requests,0);
    });
    await t.test('all encrypted bytes including >8MiB entry upload and fetch exactly',async()=>{
      const sent=await uploadOffsite(config,archive);assert.equal(sent.uploaded,true);assert.equal(sent.remoteRecoveryVerified,false);
      const prefix=`${project}/${dest}/${id}/`;const listing=await bucket.list({prefix});assert.ok(listing.objects.length>=7);assert.ok(listing.objects.some(o=>o.key.endsWith('receipt.json')));
      for(const object of listing.objects){assert.ok(object.size<=8*1024*1024);const stored=await bucket.get(object.key);const bytes=Buffer.from(await stored.arrayBuffer());assert.equal(hash(bytes),stored.customMetadata.sha256);assert.equal(bytes.includes(key),false);assert.equal(bytes.includes(Buffer.from(key.toString('hex'))),false);assert.equal(bytes.includes(Buffer.from('SYNTHETIC_ROLE_FIXTURE')),false);}
      const target=path.join(root,'fetched');const result=await fetchOffsite(config,id,target);assert.equal(result.fetchedAndVerified,true);assert.equal(result.hostedRestoreComplete,false);assert.equal(result.retentionVerifiedByTool,false);
      for(const name of await fs.readdir(archive)){assert.deepEqual(await fs.readFile(path.join(target,name)),await fs.readFile(path.join(archive,name)));assert.equal((await fs.stat(path.join(target,name))).mode&0o777,0o600);}
      assert.equal((await fs.stat(target)).mode&0o777,0o700);assert.equal((await verifyBundle(config,target)).archiveId,id);
    });
    await t.test('identical upload resumes without overwriting R2 objects',async()=>{
      const before=(await bucket.list()).objects.map(o=>[o.key,o.version]);await uploadOffsite(config,archive);const after=(await bucket.list()).objects.map(o=>[o.key,o.version]);assert.deepEqual(after,before);
    });
    await t.test('rejects endpoint/source/archive/account-boundary mixups',async()=>{
      await assert.rejects(uploadOffsite({...config,source:{id:'b'.repeat(20)}},archive),/another source/);
      await assert.rejects(uploadOffsite({...config,offsite:{...config.offsite,destinationId:randomUUID()}},archive),/binding/);
      await assert.rejects(uploadOffsite({...config,offsite:{...config.offsite,accountBoundary:'independent-account'}},archive),/binding/);
      await assert.rejects(offsitePlan({...config,offsite:{...config.offsite,endpoint:'http://backup.example.test'}},archive),/HTTPS/);
    });
    await t.test('separate read credential required and existing destination untouched',async()=>{
      const target=path.join(root,'exists');await fs.mkdir(target);await fs.writeFile(path.join(target,'keep'),'keep');await assert.rejects(fetchOffsite(config,id,target),/already exists/);assert.equal(await fs.readFile(path.join(target,'keep'),'utf8'),'keep');
      process.env[envNames[2]]=writer;await assert.rejects(fetchOffsite(config,id,path.join(root,'writer-read')),/unavailable/);process.env[envNames[2]]=reader;
    });
    await t.test('tampered signed receipt rejected before filesystem writes',async()=>{
      const keyName=`${project}/${dest}/${id}/receipt.json`,original=Buffer.from(await(await bucket.get(keyName)).arrayBuffer());const altered=JSON.parse(original);altered.payload.destinationId=randomUUID();await bucket.put(keyName,JSON.stringify(altered),{customMetadata:{sha256:hash(Buffer.from(JSON.stringify(altered)))}});
      const target=path.join(root,'bad-receipt');await assert.rejects(fetchOffsite(config,id,target),/authentication/);assert.equal(await fs.stat(target).catch(()=>null),null);
      await bucket.put(keyName,original,{customMetadata:{sha256:hash(original)}});
    });
    await t.test('missing or corrupt encrypted chunks never publish a fetched bundle',async()=>{
      const k=(await bucket.list()).objects.find(o=>o.size===8*1024*1024).key,old=await bucket.get(k),bytes=Buffer.from(await old.arrayBuffer()),meta=old.customMetadata;
      await bucket.delete(k);const target=path.join(root,'missing');await assert.rejects(fetchOffsite(config,id,target),/missing/);assert.equal(await fs.stat(target).catch(()=>null),null);assert.deepEqual((await fs.readdir(root)).filter(n=>n.startsWith('.offsite-encrypted-')),[]);
      const corrupt=Buffer.from(bytes);corrupt[50]^=1;await bucket.put(k,corrupt,{customMetadata:meta});await assert.rejects(fetchOffsite(config,id,path.join(root,'corrupt')),/integrity/);
      await bucket.put(k,bytes,{customMetadata:meta});
    });
    await t.test('wrong archive key rejects remote receipt and body limit aborts oversized response',async()=>{
      process.env[envNames[0]]=randomBytes(32).toString('hex');await assert.rejects(fetchOffsite(config,id,path.join(root,'wrong-key')),/authentication/);process.env[envNames[0]]=key.toString('hex');
      globalThis.fetch=async(url,opts)=>String(url).endsWith('receipt.json')?new Response('x',{headers:{'content-length':String(8*1024*1024+1)}}):bridge(url,opts);
      await assert.rejects(fetchOffsite(config,id,path.join(root,'over-response')),/Invalid completed/);globalThis.fetch=bridge;
    });
  } finally {globalThis.fetch=originalFetch;await mf.dispose();for(const name of envNames){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}await fs.rm(root,{recursive:true,force:true});}
});
