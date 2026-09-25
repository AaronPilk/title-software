import test,{before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const web=process.env.TITLE_COMPANY_TEST_WEB || fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(web+'/package.json');
const {build}=require('esbuild'); const {chromium}=require('playwright');
let browser,context,page,server,origin;let errors=[];
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const storeFixture=`
 import {useSyncExternalStore} from 'react';
 import {emptyWorkspace,executeCommands,projectWorkspace,allowedAsset} from './lib/backend/workspace';
 import {captureCommands} from './lib/title/command-log';
 import {validateBusinessMutation} from './lib/title/business';
 const listeners=new Set(); const wid='00000000-0000-4000-8000-000000000001';
 const owner={userId:'00000000-0000-4000-8000-000000000002',email:'fixture@example.test',role:'owner',allCompanies:true,restricted:true,companyIds:[],partnerMembers:[],version:1,requireStaffAssignments:true,assignableStaff:[{userId:'00000000-0000-4000-8000-000000000002',email:'fixture@example.test',role:'owner',allCompanies:true,companyIds:[]}]};
 let access=owner,canonical=emptyWorkspace(owner.email),revision=1;
 for(const id of ['C1','C2']) canonical.companies.push({id,name:id==='C1'?'Cedar Fictional Title':'Pine Fictional Title',initials:id==='C1'?'CF':'PF',color:'blue',contact:'',email:'',location:'Fictional City',jurisdiction:'NC',stage:'Onboarding',steps:Array(7).fill(false),members:[]});
 const doc=(id,companyId,name,category,mime)=>({id,companyId,name,category,mime,visibility:'Internal',date:'2026-09-25',size:'1 KB',version:1,assetId:'asset-'+id});
 canonical.documents.push(doc('logo-existing','C1','Cedar logo.png','Branding','image/png'),doc('formation','C1','Cedar formation.txt','Formation','text/plain'),doc('foreign-logo','C2','Pine logo.png','Branding','image/png'));
 const bytes=Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0));
 const assets=new Map([['asset-logo-existing',new Blob([bytes],{type:'image/png'})],['asset-foreign-logo',new Blob([bytes],{type:'image/png'})],['asset-formation',new Blob(['fictional formation'],{type:'text/plain'})]]);
 window.calls=[];window.assetWrites=[];window.assetReads=[];window.fixtureFailures=[];window.confirmations=[];window.confirmAnswer=true;
 window.confirm=text=>{window.confirmations.push(text);return window.confirmAnswer};
 let snapshot={s:projectWorkspace(canonical,access),connection:{workspaceId:wid,revision,access,saving:false}};
 const emit=()=>{snapshot={s:projectWorkspace(canonical,access),connection:{workspaceId:wid,revision,access,saving:false}};listeners.forEach(fn=>fn())};
 window.readFixture=()=>({state:structuredClone(canonical),revision,access:structuredClone(access),calls:structuredClone(window.calls),assetWrites:structuredClone(window.assetWrites),assetReads:structuredClone(window.assetReads),failures:[...window.fixtureFailures]});
 window.changeAccess=(patch)=>{access={...access,...patch,version:access.version+1};emit()};
 window.changeFolder=(documentId,folderId)=>{canonical=executeCommands(canonical,[{id:crypto.randomUUID(),name:'editDraft',args:[[{table:'documents',id:documentId,value:{folderId}}]]}],owner);revision++;emit()};
 window.renameFolder=(id,name)=>{canonical.companies[0].desk.folders=canonical.companies[0].desk.folders.map(f=>f.id===id?{...f,name}:f);revision++;emit()};
 async function update(fn,title,detail,expectedRevision){
  try{const oldRevision=revision;if(expectedRevision!==undefined&&expectedRevision!==revision)throw Error('Records changed after review');
   const optimistic=structuredClone(snapshot.s),commands=captureCommands(optimistic,fn);validateBusinessMutation(snapshot.s,optimistic);
   if(window.holdNextUpdate){window.holdNextUpdate=false;await new Promise(resolve=>window.releaseUpdate=resolve)}
   if(oldRevision!==revision)throw Error('Workspace changed');
   canonical=executeCommands(canonical,commands,access);revision++;window.calls.push({title,detail,commands});emit();
   if(window.uncertainNext){window.uncertainNext=false;return false}return true;
  }catch(e){window.fixtureFailures.push(e.message);return false}
 }
 export function useWorkspace(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot);return {...current,ready:true,update};}
 export const useOptionalWorkspace=useWorkspace;
 export async function saveAsset(id,file,binding){window.assetWrites.push({id,name:file.name,mime:file.type,binding});if(window.holdNextAsset){window.holdNextAsset=false;await new Promise(resolve=>window.releaseAsset=resolve)}if(binding.expectedWorkspaceId!==wid||binding.expectedUserId!==access.userId)throw Error('Workspace changed');assets.set(id,new Blob([await file.arrayBuffer()],{type:file.type}));}
 export async function getAssetForDocument(doc,binding){window.assetReads.push({id:doc.id,binding});if(binding.expectedWorkspaceId!==wid||binding.expectedUserId!==access.userId||!allowedAsset(canonical,access,doc.assetId))throw Error('Document outside access');const blob=assets.get(doc.assetId);if(!blob)throw Error('Original unavailable');return blob;}
 export const getAsset=async(id)=>assets.get(id);export const download=()=>{};export const exportCsv=()=>{};export const exportFullBackup=()=>{};export const parseBackupFile=()=>{};
`;
before(async()=>{
 const bundle=await build({absWorkingDir:web,bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent',loader:{'.css':'empty','.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_SUPABASE_URL':'""','process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'""','process.env.NEXT_PUBLIC_TITLE_HOSTED_PILOT':'"false"'},stdin:{resolveDir:web,loader:'tsx',contents:`
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {CompanyOverviewDetails,CompanyFolders} from './components/title/company-workspace';
  import {CompanyLogo} from './components/title/company-logo';import {NewCompany} from './components/title/companies';
  import {useWorkspace} from '@/lib/title/store';import {allowWorkspaceNavigation} from './lib/title/workspace-navigation-guard';
  window.tryNavigate=()=>allowWorkspaceNavigation('company-detail');
  function App(){const {s}=useWorkspace();const [create,setCreate]=useState(new URLSearchParams(location.search).has('new'));const c=s.companies.find(c=>c.id==='C1');return <><main><CompanyLogo company={c}/><CompanyOverviewDetails company={c}/><CompanyFolders company={c} onDoc={d=>window.preview=d.id}/></main>{create&&<NewCompany open onClose={()=>{setCreate(false);window.createdClosed=true}}/>}<div id="ready"/></>;}
  createRoot(document.getElementById('root')).render(<App/>);
 `},plugins:[{name:'fictional-command-transport',setup(b){
  b.onResolve({filter:/^@\/lib\/title\/store$/},()=>({path:'store',namespace:'fixture'}));
  b.onLoad({filter:/^store$/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:web,contents:storeFixture}));
  b.onResolve({filter:/^sonner$/},()=>({path:'toast',namespace:'fixture'}));
  b.onLoad({filter:/^toast$/,namespace:'fixture'},()=>({loader:'tsx',contents:`export const toast={success:()=>{},error:message=>window.fixtureFailures.push(String(message)),info:()=>{}};export const Toaster=()=>null;`}));
 }}]});
 server=createServer((req,res)=>{if(req.url==='/app.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bundle.outputFiles[0].contents)}else{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:24px}main{max-width:850px}button,input,select{margin:4px;padding:8px}fieldset{display:block}label{display:block;margin:4px} [data-slot="dialog-content"]{position:fixed;left:5vw;top:3vh;background:white;width:85vw;max-height:88vh;overflow:auto;padding:24px;border:2px solid black;z-index:100} [data-slot="dialog-overlay"]{position:fixed;inset:0;background:#7779;z-index:99}svg{width:18px;height:18px}.company-avatar{display:inline-block;width:48px;height:48px}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({channel:'chrome',headless:true})}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[])});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}});
async function open(suffix=''){await context?.close();errors=[];context=await browser.newContext({viewport:{width:1500,height:1200}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+suffix);await page.locator('#ready').waitFor({state:'attached'});}
const state=()=>page.evaluate(()=>window.readFixture());
const dialog=name=>page.getByRole('dialog',{name,exact:true});
async function folder(name){await page.getByRole('button',{name:'New folder',exact:true}).click();const d=dialog('New folder');await d.getByLabel('Folder name',{exact:true}).fill(name);await d.getByRole('button',{name:'Save folder',exact:true}).click();await d.waitFor({state:'detached'});return (await state()).state.companies[0].desk.folders.find(f=>f.name===name).id;}
async function upload(file){const d=dialog('Upload documents');await d.getByLabel('Select documents',{exact:true}).setInputFiles(file);await d.getByRole('button',{name:'Review documents',exact:true}).click();return d;}

test('three renewals, both states, multiple underwriters and protected logo survive actual command execution',async()=>{
 await open();await page.getByRole('button',{name:'Edit details',exact:true}).click();const d=dialog('Company details');
 assert.deepEqual(await d.getByLabel('Company logo',{exact:true}).locator('option').allTextContents(),['Use initials','Cedar logo.png']);
 await d.getByLabel('Company logo',{exact:true}).selectOption('logo-existing');await d.getByRole('checkbox',{name:'South Carolina',exact:true}).check();
 await d.getByRole('checkbox',{name:'WFG',exact:true}).check();await d.getByRole('checkbox',{name:'Commonwealth',exact:true}).check();
 const expected=[];for(const [i,service] of ['Domain','Email','Website'].entries()){const renewalOn='2027-0'+(i+2)+'-12',provider=service+' provider',reference=service+' reference';expected.push({service,renewalOn,provider,reference});await d.getByLabel(service+' renewal date',{exact:true}).fill(renewalOn);await d.getByLabel(service+' provider',{exact:true}).fill(provider);await d.getByLabel(service+' reference',{exact:true}).fill(reference)}
 await page.evaluate(()=>window.confirmAnswer=false);assert.equal(await page.evaluate(()=>window.tryNavigate()),false);
 await d.getByRole('button',{name:'Save company details',exact:true}).click();assert.deepEqual((await state()).failures,[]);await d.waitFor({state:'detached'});
 const saved=await state();assert.deepEqual(saved.failures,[]);assert.deepEqual(saved.state.companies[0].desk.renewals,expected);assert.deepEqual(saved.state.companies[0].operatingStates,['NC','SC']);assert.deepEqual(saved.state.business.onboarding[0].requiredUnderwriters,['WFG','Commonwealth']);assert.equal(saved.state.companies[0].desk.logoDocumentId,'logo-existing');
 const image=page.getByRole('img',{name:'Cedar Fictional Title logo',exact:true});await image.waitFor();await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===1);assert.match(await image.getAttribute('src'),/^blob:/);assert.equal((await state()).assetReads[0].binding.expectedUserId,'00000000-0000-4000-8000-000000000002');assert.equal(await page.evaluate(()=>window.tryNavigate()),true);
});

test('folder creation, rename, move and stale rename rejection preserve company scope',async()=>{
 await open();const id=await folder('Formation');await page.getByLabel('Folder for Cedar formation.txt',{exact:true}).selectOption(id);assert.equal((await state()).state.documents.find(d=>d.id==='formation').folderId,id);
 await page.getByRole('button',{name:'Rename Formation',exact:true}).click();let d=dialog('Rename folder');await d.getByLabel('Folder name',{exact:true}).fill('Company formation');await d.getByRole('button',{name:'Save folder',exact:true}).click();await d.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Company formation',exact:true}).click();assert.equal(await page.getByLabel('Folder for Cedar logo.png',{exact:true}).count(),0);assert.equal(await page.getByLabel('Folder for Cedar formation.txt',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Rename Company formation',exact:true}).click();d=dialog('Rename folder');await d.getByLabel('Folder name',{exact:true}).fill('Stale draft');await page.evaluate(id=>window.renameFolder(id,'Collaborator rename'),id);await d.getByRole('button',{name:'Save folder',exact:true}).click();await d.getByRole('alert').waitFor();assert.equal((await state()).state.companies[0].desk.folders[0].name,'Collaborator rename');assert.equal((await state()).state.companies[1].desk,undefined);
});

test('folder editor and byte uploads block navigation; real uploaded originals retain selected folder',async()=>{
 await open();const id=await folder('Originals');await page.getByRole('button',{name:'Originals',exact:true}).click();await page.getByRole('button',{name:'Upload',exact:true}).click();
 const d=await upload({name:'folder-original.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional original only')});await page.evaluate(()=>window.holdNextAsset=true);await d.getByRole('button',{name:'Save documents',exact:true}).click();await page.waitForFunction(()=>!!window.releaseAsset);assert.equal(await page.evaluate(()=>window.tryNavigate()),false);await page.evaluate(()=>window.releaseAsset());await d.waitFor({state:'detached'});
 const saved=await state(),doc=saved.state.documents.find(d=>d.name==='folder-original.txt');assert.equal(doc.folderId,id);assert.equal(doc.companyId,'C1');assert.equal(doc.orderId,undefined);assert.equal(saved.assetWrites[0].binding.companyId,'C1');assert.deepEqual(saved.failures,[]);
 await page.getByRole('button',{name:'Rename Originals',exact:true}).click();await dialog('Rename folder').getByLabel('Folder name',{exact:true}).fill('Unsaved name');await page.evaluate(()=>window.confirmAnswer=false);assert.equal(await page.evaluate(()=>window.tryNavigate()),false);await page.keyboard.press('Escape');assert.equal(await dialog('Rename folder').isVisible(),true);
});

test('logo upload starts in Branding and then selects the protected original',async()=>{
 await open();await page.getByRole('button',{name:'Upload company logo',exact:true}).click();const d=await upload({name:'uploaded-logo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});assert.equal(await d.getByLabel('Document category',{exact:true}).inputValue(),'Branding');await d.getByRole('button',{name:'Save documents',exact:true}).click();await d.waitFor({state:'detached'});await page.waitForFunction(()=>window.readFixture().state.companies[0].desk?.logoDocumentId?.startsWith('doc-'));
 const saved=await state(),id=saved.state.companies[0].desk.logoDocumentId,doc=saved.state.documents.find(d=>d.id===id);assert.equal(doc.name,'uploaded-logo.png');assert.equal(doc.category,'Branding');assert.equal(doc.visibility,'Internal');assert.equal(saved.calls.length,2);assert.deepEqual(saved.failures,[]);await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===1);
});

test('uncertain upload retry notices a subsequently changed folder',async()=>{
 await open();const first=await folder('First'),second=await folder('Second');await page.getByRole('button',{name:'First',exact:true}).click();await page.getByRole('button',{name:'Upload',exact:true}).click();const d=await upload({name:'uncertain.txt',mimeType:'text/plain',buffer:Buffer.from('fictional retry original')});await page.evaluate(()=>window.uncertainNext=true);await d.getByRole('button',{name:'Save documents',exact:true}).click();await d.getByRole('alert').waitFor();const saved=await state(),doc=saved.state.documents.find(d=>d.name==='uncertain.txt');assert.equal(doc.folderId,first);await page.evaluate(({id,folder})=>window.changeFolder(id,folder),{id:doc.id,folder:second});await d.getByRole('button',{name:'Save documents',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('different details'));assert.equal(await d.isVisible(),true);assert.equal((await state()).assetWrites.length,1);assert.equal((await state()).state.documents.filter(d=>d.name==='uncertain.txt').length,1);
});

test('new company needs no contact and preserves both selected states and underwriters',async()=>{
 await open('/?new');const d=dialog('Add a company');await d.getByLabel('Company name',{exact:true}).fill('Juniper Synthetic Ventures');await d.getByLabel('City',{exact:true}).fill('Fictional Raleigh');await d.getByRole('checkbox',{name:'South Carolina',exact:true}).check();await d.getByRole('checkbox',{name:'WFG',exact:true}).check();await d.getByRole('checkbox',{name:'First American',exact:true}).check();await d.getByRole('button',{name:'Add company',exact:true}).click();await d.waitFor({state:'detached'});
 const result=await state();assert.deepEqual(result.failures,[]);const c=result.state.companies.find(c=>c.name==='Juniper Synthetic Ventures');assert.equal(c.contact,'');assert.equal(c.email,'');assert.deepEqual(c.operatingStates,['NC','SC']);assert.deepEqual(result.state.business.onboarding.find(o=>o.companyId===c.id).requiredUnderwriters,['WFG','First American']);assert.equal(result.state.tasks.find(t=>t.companyId===c.id).assigneeId,result.access.userId);
});

test('a company creator without restricted access is not offered an unsavable underwriter selection',async()=>{
 await open('/?new');await page.evaluate(()=>window.changeAccess({restricted:false}));const d=dialog('Add a company');
 assert.equal(await d.getByRole('checkbox',{name:'WFG',exact:true}).count(),0);
 await d.getByLabel('Company name',{exact:true}).fill('Nonrestricted Synthetic Company');await d.getByLabel('City',{exact:true}).fill('Fictional City');
 await d.getByRole('button',{name:'Add company',exact:true}).click();await d.waitFor({state:'detached'});
 const result=await state();assert.deepEqual(result.failures,[]);const company=result.state.companies.find(c=>c.name==='Nonrestricted Synthetic Company');assert.ok(company);
 assert.deepEqual(result.state.business.onboarding.find(row=>row.companyId===company.id)?.requiredUnderwriters || [],[]);
});

test('editing states without selecting an underwriter does not silently add WFG',async()=>{
 await open();await page.getByRole('button',{name:'Edit details',exact:true}).click();const d=dialog('Company details');
 await d.getByRole('checkbox',{name:'South Carolina',exact:true}).check();await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});
 const saved=await state();assert.deepEqual(saved.failures,[]);assert.deepEqual(saved.state.business.onboarding[0].requiredUnderwriters,[]);
 await page.getByRole('button',{name:'Edit details',exact:true}).click();assert.equal(await dialog('Company details').getByRole('checkbox',{name:'WFG',exact:true}).isChecked(),false);
});
