import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled=await build({stdin:{contents:"export {executeCommands,emptyWorkspace} from './lib/backend/workspace';",resolveDir:fileURLToPath(new URL("../",import.meta.url))},write:false,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {executeCommands,emptyWorkspace}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const userId='22222222-2222-4222-8222-222222222222', second='33333333-3333-4333-8333-333333333333';
const access={userId:crypto.randomUUID(),email:'owner@example.test',role:'owner',companyIds:[],allCompanies:true,restricted:true,partnerMembers:[],version:1,
 assignableStaff:[{userId,email:'staff@example.test',role:'operations',companyIds:['A'],allCompanies:false},{userId:second,email:'second@example.test',role:'operations',companyIds:['A'],allCompanies:false}]};
function fixture(){const s=emptyWorkspace();s.companies=[{id:'A',name:'Fictional A',jurisdiction:'NC',operatingStates:['NC'],members:[],steps:[]}];s.orders=[{id:'O',companyId:'A',address:'Fictional address',client:'Fictional client',type:'Purchase',underwriter:'',owner:'staff@example.test',assigneeId:userId,jurisdiction:'NC',status:'New',due:'2026-09-21',premium:100,rate:.4,month:'2026-09',fields:[],notes:'',exception:'',delivered:false,remitted:false}];s.tasks=[{id:'T',companyId:'A',scope:'production',title:'Fictional task',owner:'staff@example.test',assigneeId:userId,due:'2026-09-21',done:false,priority:'Normal'}];return s;}
const edit=(table,id,value,insert=false)=>[{id:crypto.randomUUID(),name:'editDraft',args:[[{table,id,value,insert}]]}];
for(const [table,id] of [['orders','O'],['tasks','T']]){
 test(`${table} reassignment persists stable identity and canonical account label together`,()=>{const next=executeCommands(fixture(),edit(table,id,{assigneeId:second,owner:'Forged label'}),access);assert.equal(next[table][0].assigneeId,second);assert.equal(next[table][0].owner,'second@example.test');});
 test(`${table} label-only change cannot detach an existing stable assignment`,()=>assert.throws(()=>executeCommands(fixture(),edit(table,id,{owner:'Someone Else'}),access),/Choose a workspace staff/));
 test(`${table} removed or company-ineligible account is rejected`,()=>{for(const staff of [[],[{...access.assignableStaff[1],companyIds:['B']}],[{...access.assignableStaff[1],role:'viewer'}]])assert.throws(()=>executeCommands(fixture(),edit(table,id,{assigneeId:second}),{...access,assignableStaff:staff}),/no longer has access/);});
 test(`${table} unrelated change preserves an older display-only assignment`,()=>{const s=fixture();delete s[table][0].assigneeId;s[table][0].owner='Legacy name';const next=executeCommands(s,edit(table,id,table==='orders'?{notes:'review'}:{done:true}),access);assert.equal(next[table][0].owner,'Legacy name');assert.equal(next[table][0].assigneeId,undefined);});
}
test('new order stores reviewed stable assignment',()=>{const s=fixture();const next=executeCommands(s,edit('orders','NEW',{companyId:'A',address:'New fictional address',client:'Client',jurisdiction:'NC',premium:0,assigneeId:second,owner:'Forged'},true),access);assert.equal(next.orders[0].assigneeId,second);assert.equal(next.orders[0].owner,'second@example.test');});
test('finance staff can receive a task but not a production order',()=>{const a={...access,assignableStaff:[{...access.assignableStaff[1],role:'finance'}]};assert.equal(executeCommands(fixture(),edit('tasks','T',{assigneeId:second}),a).tasks[0].assigneeId,second);assert.throws(()=>executeCommands(fixture(),edit('orders','O',{assigneeId:second}),a),/no longer has access/);});

for (const [table,id] of [['orders','O'],['tasks','T']]) {
 test(`${table} connected manual creation requires account identity`,()=>{const s=fixture(), row={...s[table][0],id:'new'};delete row.assigneeId;assert.throws(()=>executeCommands(s,edit(table,'new',row,true),{...access,requireStaffAssignments:true}),/Choose a workspace staff/);});
 test(`${table} connected legacy reassignment requires account identity but unrelated edits remain usable`,()=>{const s=fixture();delete s[table][0].assigneeId;const a={...access,requireStaffAssignments:true};assert.throws(()=>executeCommands(s,edit(table,id,{owner:'Unverified person'}),a),/Choose a workspace staff/);const change=table==='tasks'?{done:true}:{notes:'Reviewed'};assert.doesNotThrow(()=>executeCommands(s,edit(table,id,change),a));});
}
for(const commands of [[null],[false],[[]],[{id:crypto.randomUUID(),name:'editDraft',args:[[null]]}]])test(`malformed command returns a validation error ${JSON.stringify(commands)}`,()=>assert.throws(()=>executeCommands(fixture(),commands,access),error=>error.status===400));
