/** Native workerd regression: Node fetch accepts redirect:'error', workerd does not.
 * Native fetch and local rate-limit binding run here; all outbound traffic is
 * captured by an in-process sink. No hosted resources or real secrets are used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../../web/node_modules/esbuild/lib/main.js';
import { Miniflare, convertV4MiniflareOptions } from '../../../web/node_modules/miniflare/dist/src/index.js';
import { readFile } from 'node:fs/promises';

const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const compiled=await build({entryPoints:['src/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const origin='https://applications.example.test';
const gateway='fictional-runtime-gateway-at-least-32-characters';
const request=()=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.14'},body:JSON.stringify({session:'A'.repeat(43)})});

test('native workerd forwards controlled responses and refuses every upstream redirect without following it',async()=>{
 const calls=[];let mode='forbidden';
 const mf=new Miniflare(convertV4MiniflareOptions({
  name:'title-applications-native-test',modules:true,script:compiled.outputFiles[0].text,
  compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags??[],port:0,
  bindings:{JV_PORTAL_GATEWAY_KEY:gateway,JV_PUBLIC_ENDPOINT:config.vars.JV_PUBLIC_ENDPOINT},
  ratelimits:{PORTAL_REQUESTS:{namespace_id:'202609241',simple:{limit:90,period:60}}},
  outboundService:async req=>{
   calls.push({url:req.url,method:req.method,gateway:req.headers.get('X-JV-Gateway-Key'),body:await req.text()});
   assert.equal(req.url,config.vars.JV_PUBLIC_ENDPOINT+'/load');
   if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://never-follow.example.test/credential-sink'}});
   if(mode==='setup')return Response.json({error:'Application service setup is incomplete. Contact the sender.'},{status:503});
   return Response.json({error:'This application link or session is unavailable.'},{status:403});
  },
 }));
 try{
  let result=await mf.dispatchFetch(origin+'/api/load',request());
  assert.equal(result.status,403);assert.deepEqual(await result.json(),{error:'This application link or session is unavailable.'});
  assert.equal(calls.length,1);assert.equal(calls[0].gateway,gateway);assert.equal(calls[0].method,'POST');assert.deepEqual(JSON.parse(calls[0].body),{session:'A'.repeat(43)});
  mode='setup';result=await mf.dispatchFetch(origin+'/api/load',request());
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'Application service setup is incomplete. Contact the sender.'});
  mode='redirect';result=await mf.dispatchFetch(origin+'/api/load',request());
  assert.equal(result.status,503);assert.equal(result.headers.get('location'),null);assert.equal(calls.length,3);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('referrer-policy'),'no-referrer');
  result=await mf.dispatchFetch(origin+'/api/load',{...request(),body:'x'.repeat(131073)});
  assert.equal(result.status,413);assert.equal(calls.length,3);
 }finally{await mf.dispose();}
});
