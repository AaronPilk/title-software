import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from '../../../web/node_modules/miniflare/dist/src/index.js';
import worker from '../src/worker.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const source='a'.repeat(20),destination=randomUUID(),id=randomUUID(),write=randomBytes(32).toString('hex'),read=randomBytes(32).toString('hex');
const bindings={BACKUP_SOURCE_ID:source,BACKUP_DESTINATION_ID:destination,BACKUP_ACCOUNT_BOUNDARY:'same-account',BACKUP_WRITE_TOKEN:write,BACKUP_READ_TOKEN:read};
const h=token=>({authorization:`Bearer ${token}`,'x-title-source':source,'x-title-destination':destination});

test('backup Worker enforces auth, scope, stream bounds, digest and create-only R2 writes', {timeout:60_000},async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'title-backup-test',modules:true,script:await readFile(new URL('../src/worker.mjs',import.meta.url),'utf8'),compatibilityDate:'2026-09-24',compatibilityFlags:['nodejs_compat'],port:0,bindings,r2Buckets:['ARCHIVES']}));
 const bytes=Buffer.from('encrypted-fixture-bytes'),sha=digest(bytes),url=`https://backup.example.test/v1/archives/${id}/${sha}`;
 const put=(token=write,body=bytes,extra={})=>({method:'PUT',headers:{...h(token),'content-type':'application/octet-stream','x-title-sha256':sha,...extra},body});
 try{
  await t.test('missing/incorrect tokens and unconfigured or shared keys fail closed',async()=>{
   assert.equal((await mf.dispatchFetch(url,put('bad'))).status,401);assert.equal((await mf.dispatchFetch(url,{method:'GET'})).status,401);
   assert.equal((await worker.fetch(new Request(url,put()),{...bindings,BACKUP_READ_TOKEN:write,ARCHIVES:{}})).status,503);
   assert.equal((await worker.fetch(new Request(url,put()),{...bindings,BACKUP_ACCOUNT_BOUNDARY:'unverified',ARCHIVES:{}})).status,503);
  });
  await t.test('writer cannot read, reader cannot write, no list/delete/CORS surface',async()=>{
   assert.equal((await mf.dispatchFetch(url,put(read))).status,403);
   assert.equal((await mf.dispatchFetch(url,{headers:h(write)})).status,403);
   assert.equal((await mf.dispatchFetch(url,{method:'DELETE',headers:h(write)})).status,405);
   assert.equal((await mf.dispatchFetch('https://backup.example.test/v1/archives',{headers:h(read)})).status,404);
   assert.equal((await mf.dispatchFetch(url,put(write,bytes,{origin:'https://evil.example'}))).status,400);
  });
  await t.test('source/destination and content digest checked before storing',async()=>{
   assert.equal((await mf.dispatchFetch(url,put(write,bytes,{'x-title-source':'b'.repeat(20)}))).status,409);
   assert.equal((await mf.dispatchFetch(url,put(write,Buffer.from('corrupt')))).status,422);
   assert.equal((await mf.dispatchFetch(url,put(write,bytes,{'x-title-sha256':'b'.repeat(64)}))).status,400);
   assert.equal((await mf.getR2Bucket('ARCHIVES')).list instanceof Function,true);
  });
  await t.test('body streamed past 8MiB is rejected even without content length',async()=>{
   const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(8*1024*1024));c.enqueue(new Uint8Array(1));c.close();}});
   const r=await worker.fetch(new Request(url,{method:'PUT',headers:{...h(write),'content-type':'application/octet-stream','x-title-sha256':sha},body,duplex:'half'}),{...bindings,ARCHIVES:{put(){throw new Error('must not write');}}});assert.equal(r.status,413);
  });
  await t.test('absolute deadline cancels an authenticated stalled body before any R2 write',async t=>{
   t.mock.timers.enable({apis:['setTimeout']});let cancelled=false,puts=0;
   const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
   const pending=worker.fetch(new Request(url,{method:'PUT',headers:{...h(write),'content-type':'application/octet-stream','x-title-sha256':sha},body,duplex:'half'}),{...bindings,ARCHIVES:{put(){puts++;}}});
   await Promise.resolve();t.mock.timers.tick(30_001);const response=await pending;
   assert.equal(response.status,408);assert.equal(cancelled,true);assert.equal(puts,0);t.mock.timers.reset();
  });
  await t.test('atomic create-only handles concurrent puts and immutable reads',async()=>{
   const responses=await Promise.all([mf.dispatchFetch(url,put()),mf.dispatchFetch(url,put())]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
   const r=await mf.dispatchFetch(url,{headers:h(read)});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-title-sha256'),sha);
   assert.equal((await mf.dispatchFetch(url,put())).status,409);
   const head=await mf.dispatchFetch(url,{method:'HEAD',headers:h(write)});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(bytes.length));
  });
 }finally{await mf.dispose();}
});
