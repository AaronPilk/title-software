import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle=await build({stdin:{contents:"export * from './lib/backend/jv-portal'; export * from './lib/title/jv-portal'; export { newJVApplicant } from './lib/title/jv-application'; export { emptyWorkspace, ApiError } from './lib/backend/workspace';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},write:false,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {jvPortalPublicRequest,jvPortalStaffRequest,jvPortalUpload,jvPortalHash,newJVRecipientPayload,validateRecipientPayload,newJVApplicant,emptyWorkspace}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const id='f0100000-0000-4000-8000-000000000010',attachmentId='f0200000-0000-4000-8000-000000000010',jobId='f0300000-0000-4000-8000-000000000010';
const token='A'.repeat(43),session='B'.repeat(43);
const bytes=new TextEncoder().encode('FICTIONAL ORIGINAL');
const sha256=await jvPortalHash(bytes);
const attachment={id:attachmentId,name:'fictional.txt',mime:'text/plain',bytes:bytes.byteLength,sha256};
const base={workspaceId:'W1',companyId:'C1'};
const response=()=>({id,companyName:'Fictional Company',recipientName:'Fictional Recipient',status:'Draft',version:1,expiresAt:'2026-12-01T00:00:00Z',payload:newJVRecipientPayload(),attachments:[],correctionNote:'',submittedAt:null,secretId:'NEVER_PROJECT_THIS',workspaceId:'SECRET_WORKSPACE'});
const staffResponse=()=>({id,recipientName:'Fictional Recipient',email:'recipient@example.test',status:'Draft',version:1,expiresAt:'2026-12-01T00:00:00Z',submittedAt:null,deliveryStatus:'not_sent',appliedVersion:null,needsMerge:false,notificationStatus:'not_sent',secretId:'NEVER_PROJECT_THIS',payload:{ssn:'NEVER_PROJECT_THIS'}});
function complete(){const p=newJVRecipientPayload();Object.assign(p.applicants[0],{name:'Fictional Applicant',email:'applicant@example.test',phone:'7045550101',dob:'1980-01-01',ssn:'123456789',driverLicense:'FAKE-DL',currentAddress:'10 Example Street',ownershipType:'individual',residenceHistory:[{id:'r1',address:'10 Example Street',from:'2000-01-01',to:''}],employmentHistory:[{id:'e1',employer:'Example Company',role:'',address:'',from:'2000-01-01',to:''}]});return p;}
function fixture(){const calls=[],emails=[],stored=[];const state=emptyWorkspace();state.companies=[{id:'C1',name:'Fictional Company'}];let handler=async()=>({application:response()});const ctx={workspaceId:'W1',state,access:{userId:'U1',email:'staff@example.test',role:'onboarding',companyIds:['C1'],allCompanies:false,restricted:true,version:7,partnerMembers:[]},portalUrl:'https://applications.example.test',trustedIp:'192.0.2.10',mailConfigured:true,rpc:async(name,args)=>{calls.push({name,...structuredClone(args)});return handler(name,args);},sendEmail:async job=>{emails.push(job);return{status:'sent',providerId:'provider-fictional'};},storage:{upload:async(path,b,mime)=>stored.push({path,b,mime}),download:async()=>bytes,remove:async path=>{throw new Error(`Unexpected deletion ${path}`);}}};return{ctx,calls,emails,stored,handle:fn=>handler=fn,public:(action,input)=>jvPortalPublicRequest(action,input,ctx),staff:(action,input={})=>jvPortalStaffRequest(action,{...base,...input},ctx)};}

test('recipient projection cannot carry steps, sources, review metadata, unknown fields or unsafe identity values',()=>{
 assert.equal(newJVRecipientPayload().applicants.length,1);
 for(const value of [{...complete(),steps:[]},{...complete(),sourceDocumentIds:[]},{...complete(),reviewedBy:'forged'},{...complete(),schemaVersion:1},{applicants:[]},null,[]])assert.throws(()=>validateRecipientPayload(value));
 const p=complete();p.applicants[0].ssn='000000000';assert.throws(()=>validateRecipientPayload(p));
 const hostile={get applicants(){throw new Error('PRIVATE ERROR');},logoPreferences:'',notes:''};assert.throws(()=>validateRecipientPayload(hostile),e=>!e.message.includes('PRIVATE ERROR'));
 const canonical=validateRecipientPayload(complete());assert.equal(canonical.applicants[0].ssn,'123456789');
 const many=complete();many.applicants=Array.from({length:21},(_,i)=>newJVApplicant(`p-${i}`));assert.throws(()=>validateRecipientPayload(many));
});

test('start uses stored recipient only, salted code hash and trusted IP hash, never returns challenge/link/email',async()=>{
 const f=fixture();f.handle(async(_,{p_action})=>p_action==='start'?{job:{jobId,to:'stored@example.test',recipientName:'Stored',companyName:'Company'}}:{});
 const r=await f.public('start',{token});assert.deepEqual(r,{message:'If this link is available, a verification code has been sent.'});assert.equal(f.emails.length,1);assert.equal(f.emails[0].to,'stored@example.test');assert.match(f.emails[0].code,/^\d{6}$/);assert.equal(f.calls[0].p_credential,await jvPortalHash(token));assert.equal(f.calls[0].p_input.codeHash,await jvPortalHash(`${token}:${f.emails[0].code}`));assert.equal(f.calls[0].p_ip_hash,await jvPortalHash(f.ctx.trustedIp));assert.ok(!JSON.stringify(f.calls).includes(token));assert.equal(f.calls[1].p_action,'challenge-result');
 await assert.rejects(()=>f.public('start',{token,email:'attacker@example.test'}),e=>e.status===400);
 const invalid=fixture();invalid.handle(async()=>({}));assert.deepEqual(await invalid.public('start',{token}),r);assert.equal(invalid.emails.length,0);
});

test('verify exposes fresh 256-bit session only once and strict public projection',async()=>{
 const f=fixture();f.handle(async()=>({expiresAt:'2026-11-24T01:00:00Z',application:response(),tokenHash:'PRIVATE'}));const r=await f.public('verify',{token,code:'123456'});assert.match(r.session,/^[A-Za-z0-9_-]{43}$/);assert.equal(f.calls[0].p_input.sessionHash,await jvPortalHash(r.session));assert.equal(f.calls[0].p_input.codeHash,await jvPortalHash(`${token}:123456`));assert.equal(r.application.secretId,undefined);assert.equal(r.application.workspaceId,undefined);assert.equal(r.tokenHash,undefined);
 f.handle(async()=>({errorCode:'challenge_failed'}));await assert.rejects(()=>f.public('verify',{token,code:'123456'}),e=>e.status===401);
 f.handle(async()=>({errorCode:'forbidden'}));await assert.rejects(()=>f.public('verify',{token,code:'123456'}),e=>e.status===403);
 for(const value of ['12345','1234567','abcdef',123456])await assert.rejects(()=>f.public('verify',{token,code:value}),e=>e.status===400);
});

test('save and submit are bounded recipient-only operations with CAS and actual readiness',async()=>{
 const f=fixture();await f.public('save',{session,expectedVersion:1,payload:newJVRecipientPayload()});assert.equal(f.calls[0].p_action,'save');assert.deepEqual(Object.keys(f.calls[0].p_input).sort(),['expectedVersion','payload']);assert.equal(f.calls[0].p_input.payload.steps,undefined);
 for(const p of [newJVRecipientPayload(),{...complete(),applicants:[]}])await assert.rejects(()=>f.public('submit',{session,expectedVersion:1,payload:p}),e=>e.status===400);
 const count=f.calls.length;for(const patch of [{expectedVersion:0},{expectedVersion:1.5},{companyId:'C2'},{status:'Reviewed'},{actor:'forged'},{payload:{...complete(),steps:[]}}])await assert.rejects(()=>f.public('save',{session,expectedVersion:1,payload:complete(),...patch}));assert.equal(f.calls.length,count);
 await f.public('submit',{session,expectedVersion:1,payload:complete()});
});

test('RPC failures and typed returned errors never expose private provider/database error text',async()=>{
 const mapping={forbidden:403,challenge_failed:401,conflict:409,invalid:400,unavailable:503,rate_limit:429};
 for(const [errorCode,status] of Object.entries(mapping)){const f=fixture();f.handle(async()=>({errorCode,message:'PRIVATE VALUES'}));await assert.rejects(()=>f.public('load',{session}),e=>e.status===status&&!e.message.includes('PRIVATE'));}
 for(const [code,status] of [['42501',403],['PT409',409],['40001',409],['22023',400],['PT503',503],['unexpected',503]]){const f=fixture();f.handle(async()=>{throw{code,message:'PRIVATE SSN'};});await assert.rejects(()=>f.public('load',{session}),e=>e.status===status&&!e.message.includes('PRIVATE'));}
});

test('staff authorization and projections exclude payload/secret and allow only current company-scoped roles',async()=>{
 for(const role of ['owner','admin','onboarding']){const f=fixture();f.ctx.access.role=role;f.handle(async()=>({requests:[staffResponse()]}));const r=await f.staff('list');assert.equal(r.requests[0].payload,undefined);assert.equal(r.requests[0].secretId,undefined);assert.equal(r.mailConfigured,true);}
 for(const mutate of [c=>c.access.role='partner',c=>c.access.role='operations',c=>c.access.role='finance',c=>c.access.restricted=false,c=>c.access.companyIds=['C2'],c=>c.state.companies=[]]){const f=fixture();mutate(f.ctx);await assert.rejects(()=>f.staff('list'),e=>e.status===403);assert.equal(f.calls.length,0);}
 const f=fixture();await assert.rejects(()=>f.staff('list',{workspaceId:'OTHER'}),e=>e.status===400);await assert.rejects(()=>f.staff('list',{recipientEmail:'attacker@example.test'}),e=>e.status===400);
});

test('create returns one fragment capability and only hashes it in RPC; explicit send binds persisted recipient/job',async()=>{
 const f=fixture();f.handle(async(_,{p_action})=>p_action==='create'?{request:staffResponse(),tokenIssued:true}:{request:{...staffResponse(),version:2,deliveryStatus:'sent'},job:p_action==='send'?{jobId,to:'stored@example.test',recipientName:'Stored',companyName:'Company'}:undefined});
 const result=await f.staff('create',{requestId:id,recipientName:' Recipient ',email:'CONTACT@example.test'});const secret=new URL(result.link).hash.slice(1);assert.match(secret,/^[A-Za-z0-9_-]{43}$/);assert.equal(f.calls[0].p_input.tokenHash,await jvPortalHash(secret));assert.equal(f.calls[0].p_input.email,'contact@example.test');assert.equal(f.emails.length,0);
 await f.staff('send',{id,expectedVersion:1});assert.equal(f.emails.length,1);assert.equal(f.emails[0].kind,'invitation');assert.equal(f.emails[0].to,'stored@example.test');assert.equal(f.emails[0].idempotencyKey,jobId);assert.equal(f.calls.at(-1).p_action,'delivery-result');
 const retry=fixture();retry.handle(async()=>({request:staffResponse(),tokenIssued:false}));assert.equal((await retry.staff('create',{requestId:id,recipientName:'Recipient',email:'contact@example.test'})).link,undefined);
});

test('missing mail configuration fails before creating OTP/send jobs and list reports the configuration',async()=>{
 const f=fixture();f.ctx.mailConfigured=false;await assert.rejects(()=>f.public('start',{token}),e=>e.status===503);await assert.rejects(()=>f.staff('send',{id,expectedVersion:1}),e=>e.status===503);assert.equal(f.calls.length,0);f.handle(async()=>({requests:[]}));assert.equal((await f.staff('list')).mailConfigured,false);
});

test('provider uncertainty is recorded without error content and committed submissions survive notification reporting failure',async()=>{
 const f=fixture();f.ctx.sendEmail=async()=>{throw new Error('PRIVATE PROVIDER ERROR');};f.handle(async(_,{p_action})=>p_action==='submit'?{application:{...response(),status:'Submitted'},notificationJob:{jobId,to:'staff@example.test',recipientName:'Recipient',companyName:'Company'}}:{errorCode:'unavailable'});
 const submitted=await f.public('submit',{session,expectedVersion:1,payload:complete()});assert.equal(submitted.status,'Submitted');assert.equal(f.calls.at(-1).p_input.status,'unknown');assert.ok(!JSON.stringify(f.calls).includes('PRIVATE PROVIDER'));
});

test('uploads validate actual bytes, reserve quota before I/O, finalize after I/O and never delete uncertain originals',async()=>{
 const f=fixture();f.handle(async(_,{p_action})=>p_action==='reserve-attachment'?{id:attachmentId,objectPath:'jv-recipient/random/object'}:{application:{...response(),attachments:[attachment]}});
 const result=await jvPortalUpload(session,{name:'fictional.txt',type:'text/plain',bytes},f.ctx);assert.equal(result.attachments.length,1);assert.deepEqual(f.calls.map(c=>c.p_action),['reserve-attachment','finalize-attachment']);assert.equal(f.stored[0].path,'jv-recipient/random/object');assert.equal(f.calls[0].p_input.sha256,sha256);
 for(const file of [{name:'bad.exe',type:'application/octet-stream',bytes},{name:'fake.pdf',type:'application/pdf',bytes},{name:'../file.txt',type:'text/plain',bytes},{name:'bad.txt',type:'text/plain',bytes:new Uint8Array([0])},{name:'empty.txt',type:'text/plain',bytes:new Uint8Array()},{name:'large.txt',type:'text/plain',bytes:new Uint8Array(10485761)}])await assert.rejects(()=>jvPortalUpload(session,file,f.ctx),e=>e.status===400);
 const failed=fixture();failed.handle(async(_,{p_action})=>p_action==='reserve-attachment'?{id:attachmentId,objectPath:'path'}:{});failed.ctx.storage.upload=async()=>{throw new Error('PRIVATE');};await assert.rejects(()=>jvPortalUpload(session,{name:'f.txt',type:'text/plain',bytes},failed.ctx),e=>e.status===503);assert.equal(failed.calls.at(-1).p_action,'cancel-attachment');
 const uncertain=fixture();uncertain.handle(async(_,{p_action})=>p_action==='reserve-attachment'?{id:attachmentId,objectPath:'path'}:{errorCode:'forbidden'});await assert.rejects(()=>jvPortalUpload(session,{name:'f.txt',type:'text/plain',bytes},uncertain.ctx),e=>e.status===403);assert.equal(uncertain.stored.length,1);
});

test('public and staff downloads validate hash and bytes and reauthorize after storage read',async()=>{
 for(const staff of [false,true]){const f=fixture();f.handle(async()=>({objectPath:'original-path',attachment:{...attachment,secret:'hidden'}}));const r=staff?await f.staff('download-attachment',{id,attachmentId}):await f.public('download',{session,attachmentId});assert.deepEqual(r.bytes,bytes);assert.equal(f.calls.length,2);assert.equal(r.objectPath,undefined);
 const revoked=fixture();let calls=0;revoked.handle(async()=>++calls===1?{objectPath:'path',attachment}:{errorCode:'forbidden'});await assert.rejects(()=>staff?revoked.staff('download-attachment',{id,attachmentId}):revoked.public('download',{session,attachmentId}),e=>e.status===403);
 const replaced=fixture();replaced.handle(async()=>({objectPath:'path',attachment:{...attachment,sha256:'a'.repeat(64)}}));await assert.rejects(()=>staff?replaced.staff('download-attachment',{id,attachmentId}):replaced.public('download',{session,attachmentId}),e=>e.status===503);}
});
