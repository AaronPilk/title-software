import test from 'node:test';
import assert from 'node:assert/strict';
import {credentialStatus,workspaceMissiveConfig,credentialChange,verifyCredentialChange} from '../.local-test/missive/api.mjs';
const token='missive_pat-SYNTHETIC_TEST_CREDENTIAL_ONLY';
const fallback={workspaceId:'workspace-a',token:'SYNTHETIC_ENVIRONMENT_CREDENTIAL'};
const absent={exists:false,revision:0,token:null,verifiedAt:null};
const saved={exists:true,revision:4,token,verifiedAt:'2026-09-14T12:00:00Z'};
const owner={userId:'owner',email:'owner@example.test',role:'owner',companyIds:[],allCompanies:true,restricted:true,version:1,partnerMembers:[]};
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const response=path=>String(path).includes('/organizations?')?json({organizations:[{id:'org',name:'Synthetic organization'}]}):json({teams:[{id:'team',name:'Synthetic inbox',organization:'org',team_inbox_enabled:true}]});

test('credential status contains only safe metadata and never either token',()=>{
 for(const record of [saved,absent,{...saved,token:null}]){
  const status=credentialStatus(record,fallback,'workspace-a');
  assert.deepEqual(Object.keys(status).sort(),['configured','revision','source','verifiedAt']);
  assert(!JSON.stringify(status).includes(token));assert(!JSON.stringify(status).includes(fallback.token));
 }
 assert.deepEqual(credentialStatus(saved,fallback,'workspace-a'),{configured:true,revision:4,source:'workspace',verifiedAt:saved.verifiedAt});
});
test('environment fallback is available only to its exact bound workspace',()=>{
 assert.equal(credentialStatus(absent,fallback,'workspace-a').source,'environment');
 assert.equal(credentialStatus(absent,fallback,'workspace-b').source,'none');
 assert.deepEqual(workspaceMissiveConfig(absent,fallback,'workspace-b'),{workspaceId:'workspace-b'});
 assert.deepEqual(workspaceMissiveConfig(absent,fallback,'workspace-a'),fallback);
 assert.deepEqual(workspaceMissiveConfig(absent,{token},'workspace-a'),{workspaceId:'workspace-a'});
});
test('saved workspace token replaces the environment and binds the requested workspace',()=>{
 assert.deepEqual(workspaceMissiveConfig(saved,fallback,'workspace-b'),{workspaceId:'workspace-b',token});
 assert.equal(credentialStatus(saved,fallback,'workspace-b').source,'workspace');
});
test('disconnect tombstone suppresses environment fallback',()=>{
 const tombstone={...saved,revision:5,token:null,verifiedAt:null};
 assert.deepEqual(credentialStatus(tombstone,fallback,'workspace-a'),{configured:false,revision:5,source:'workspace',verifiedAt:null});
 assert.deepEqual(workspaceMissiveConfig(tombstone,fallback,'workspace-a'),{workspaceId:'workspace-a',token:undefined});
});
test('credential validator retains complete token literally and permits explicit disconnect',()=>{
 assert.deepEqual(credentialChange({workspaceId:'workspace-a',expectedRevision:0,token}),{expectedRevision:0,token});
 assert.deepEqual(credentialChange({expectedRevision:4,token:null}),{expectedRevision:4,token:null});
 assert.equal(credentialChange({expectedRevision:4,token:'a'.repeat(16)}).token.length,16);
 assert.equal(credentialChange({expectedRevision:4,token:'a'.repeat(4096)}).token.length,4096);
});
test('malformed revisions and unexpected settings are rejected without echoing tokens',()=>{
 for(const input of [null,[],{},'string',{expectedRevision:1,token,endpoint:'https://elsewhere.test'},{expectedRevision:1,token,accessVersion:1},...[undefined,null,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1].map(expectedRevision=>({expectedRevision,token}))]){
  assert.throws(()=>credentialChange(input),error=>!error.message.includes(token));
 }
});
test('truncated, whitespace, quoted, header and control-character token input is rejected',()=>{
 for(const value of [undefined,15,{},'', 'a'.repeat(15),'a'.repeat(4097),' '+token,token+'\n','"'+token+'"','Bearer '+token,token+'!',token+'\u0000'])
  assert.throws(()=>credentialChange({expectedRevision:1,token:value}),/complete Missive token/);
});
test('nonadministrators and scoped administrators cannot verify or disconnect credentials',async()=>{
 for(const access of ['operations','accounting','partner','viewer'].map(role=>({...owner,role})).concat([{...owner,role:'admin',allCompanies:false}])){
  for(const value of [token,null])await assert.rejects(verifyCredentialChange({expectedRevision:0,token:value},'workspace-a',access,()=>assert.fail('network request')),/Organization-wide administrator/);
 }
});
test('global admin verifies fixed metadata endpoints with complete token before save can proceed',async()=>{
 const requests=[];
 const result=await verifyCredentialChange({expectedRevision:3,token},'workspace-a',{...owner,role:'admin'},async(url,init)=>{
  requests.push(String(url));assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.redirect,'error');return response(url);
 });
 assert.deepEqual(requests,['https://public.missiveapp.com/v1/organizations?limit=200&offset=0','https://public.missiveapp.com/v1/teams?limit=200&offset=0']);
 assert.deepEqual(result.change,{expectedRevision:3,token});assert.equal(result.check.status,'verified');assert.equal(result.check.teamInboxes.length,1);
 assert(!JSON.stringify(result.check).includes(token));
});
test('explicit disconnect performs no provider request',async()=>{
 const result=await verifyCredentialChange({expectedRevision:4,token:null},'workspace-a',owner,()=>assert.fail('network request'));
 assert.deepEqual(result,{change:{expectedRevision:4,token:null},check:null});
});
test('provider rejection prevents the caller from reaching save and hides provider details',async()=>{
 for(const status of [401,403,429,500]){
  let saved=false;
  await assert.rejects((async()=>{const result=await verifyCredentialChange({expectedRevision:0,token},'workspace-a',owner,async()=>new Response('private provider response '+token,{status}));saved=true;return result;})(),error=>!error.message.includes(token)&&!error.message.includes('private provider'));
  assert.equal(saved,false);
 }
});
test('failed second discovery call cannot save a partially verified token',async()=>{
 let count=0,saved=false;
 await assert.rejects((async()=>{await verifyCredentialChange({expectedRevision:0,token},'workspace-a',owner,async url=>++count===1?response(url):new Response('unavailable',{status:500}));saved=true;})());
 assert.equal(count,2);assert.equal(saved,false);
});
test('metadata-only credential status works without reading decrypted token bytes',()=>{
 assert.deepEqual(credentialStatus({exists:true,configured:true,revision:8,verifiedAt:saved.verifiedAt},fallback,'workspace-a'),{configured:true,revision:8,verifiedAt:saved.verifiedAt,source:'workspace'});
 assert.deepEqual(credentialStatus({exists:true,configured:false,revision:9,verifiedAt:null},fallback,'workspace-a'),{configured:false,revision:9,verifiedAt:null,source:'workspace'});
});
