/** Native workerd catches differences that Node Request/TransformStream mocks miss. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {build} from '../../../web/node_modules/esbuild/lib/main.js';
import {Miniflare,convertV4MiniflareOptions} from '../../../web/node_modules/miniflare/dist/src/index.js';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const token='fictional-native-scanner-token-12345678901234567890';
const compiled=await build({stdin:{contents:`
import {proxyRequest,routeScannerRequest,signatureRequest} from './services/title-scanner-host/src/gateway.ts';
import {createHash} from 'node:crypto';
export default {async fetch(request){
 const mode=request.headers.get('x-fixture-mode');
 // Construct malformed framing inside the native runtime: Undici refuses to send it over HTTP.
 if(mode==='short'||mode==='oversized-declared'){const headers=new Headers(request.headers);headers.set('content-length',mode==='short'?String(Number(headers.get('content-length'))+1):String(50*1024*1024+1));request=new Request(request.url,{method:'POST',headers,body:request.body});}
 if(new URL(request.url).pathname==='/signature'){const result=signatureRequest(new Request('https://database.clamav.net/daily.cvd'));return Response.json({redirect:result?.redirect});}
 return routeScannerRequest(request,'true',${JSON.stringify(token)},accepted=>proxyRequest(accepted,${JSON.stringify(token)},async upstream=>{
  if(upstream.redirect!=='manual')throw new Error('must not follow redirects');
  let size=0;const digest=createHash('sha256');
  if(upstream.body){const reader=upstream.body.getReader();for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;digest.update(item.value);}}
  if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://must-not-follow.example.test'}});
  if(mode==='oversized')return Response.json({diagnostic:'PRIVATE'+ 'x'.repeat(5000)});
  if(mode==='stall')return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});
  if(upstream.method==='GET')return Response.json({status:'ready',protocolVersion:1});
  return Response.json({status:'clean',protocolVersion:1,sha256:digest.digest('hex'),byteLength:size,requestId:upstream.headers.get('x-scan-request-id'),length:upstream.headers.get('content-length')});
 },length=>new FixedLengthStream(length),mode==='stall'?50:28000));
}};`,resolveDir:repo,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',external:['node:crypto']});
const hash=b=>createHash('sha256').update(b).digest('hex');
const options=(bytes,mode)=>({method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/octet-stream','content-length':String(bytes.length),'x-content-sha256':hash(bytes),'x-scan-protocol':'1','x-scan-request-id':randomUUID(),...(mode?{'x-fixture-mode':mode}:{})},body:bytes});

test('native scanner gateway: manual redirects, FixedLengthStream and 50MiB ceiling', {timeout:60_000},async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'scanner-native-gateway',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-24',compatibilityFlags:['nodejs_compat'],port:0}));
 try{
  await t.test('health and signature requests use native-supported manual redirect mode',async()=>{
   const r=await mf.dispatchFetch('https://scanner.example.test/v1/health',{headers:{authorization:`Bearer ${token}`}});assert.equal(r.status,200);assert.equal((await r.json()).status,'ready');
   const signature=await mf.dispatchFetch('https://scanner.example.test/signature');assert.equal((await signature.json()).redirect,'manual');
  });
  await t.test('exact 50MiB upload streams through native FixedLengthStream and preserves receipt',async()=>{
   const bytes=Buffer.alloc(50*1024*1024,37),init=options(bytes);
   const r=await mf.dispatchFetch('https://scanner.example.test/v1/scan',init);assert.equal(r.status,200);const receipt=await r.json();
   assert.equal(receipt.sha256,hash(bytes));assert.equal(receipt.byteLength,bytes.length);assert.equal(receipt.length,String(bytes.length));assert.equal(receipt.requestId,init.headers['x-scan-request-id']);
  });
  await t.test('oversized declared body, short native stream and upstream redirect fail closed',async()=>{
   const bytes=Buffer.from('Fictional native gateway fixture'),init=options(bytes,'oversized-declared');
   assert.equal((await mf.dispatchFetch('https://scanner.example.test/v1/scan',init)).status,413);
   const short=options(bytes,'short');
   assert.notEqual((await mf.dispatchFetch('https://scanner.example.test/v1/scan',short)).status,200);
   const redirect=await mf.dispatchFetch('https://scanner.example.test/v1/scan',options(bytes,'redirect'));assert.equal(redirect.status,503);assert.equal(redirect.headers.get('location'),null);
  });
  await t.test('native response length and deadline limits suppress upstream diagnostics',async()=>{
   const bytes=Buffer.from('Fictional response-bound fixture');
   const oversized=await mf.dispatchFetch('https://scanner.example.test/v1/scan',options(bytes,'oversized'));assert.equal(oversized.status,503);assert.doesNotMatch(await oversized.text(),/PRIVATE/);
   const stalled=await mf.dispatchFetch('https://scanner.example.test/v1/scan',options(bytes,'stall'));assert.equal(stalled.status,504);
  });
 }finally{await mf.dispose();}
});
