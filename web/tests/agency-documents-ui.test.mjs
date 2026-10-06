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
 import {businessDay} from './lib/title/business-date';
 import {syncAgencyMaintenance,completeAgencyMaintenance} from './lib/title/agency-maintenance';
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
 window.installMaintenance=()=>{canonical.agencyMaintenance={records:[{id:'renewal-domain',revision:1,scope:'company',companyId:'C1',memberId:'',kind:'Domain',title:'Domain renewal',active:true,nextDueOn:'2029-01-01',intervalYears:3,schedule:'anniversary',source:'Fictional renewal notice',verifiedOn:'2026-10-06',notes:'',owner:'',documentIds:[],standing:'Unknown'}],history:[]};revision++;emit()};
 window.completeDomainCycle=()=>{const r=canonical.agencyMaintenance.records.find(r=>r.kind==='Domain');syncAgencyMaintenance(canonical,businessDay(),'C1');completeAgencyMaintenance(canonical,{maintenanceId:r.id,expectedRevision:r.revision,cycleOn:r.nextDueOn,completedOn:businessDay(),notes:'Fictional renewal complete',documentIds:[],nextDueOn:(Number(businessDay().slice(0,4))+1)+businessDay().slice(4)});revision++;emit()};
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
  import {CompanyOverviewDetails,CompanyFolders,CompanyCardFacts} from './components/title/company-workspace';
  import {CompanyLogo} from './components/title/company-logo';
  import {DocumentPreview} from './components/title/documents';
  import {useWorkspace} from '@/lib/title/store';import {allowWorkspaceNavigation} from './lib/title/workspace-navigation-guard';
  window.tryNavigate=()=>allowWorkspaceNavigation('company-detail');
  function App(){const {s}=useWorkspace();const [preview,setPreview]=useState(null);const c=s.companies.find(c=>c.id==='C1');return <><main><CompanyCardFacts company={c}/><CompanyLogo company={c}/><CompanyOverviewDetails company={c}/><CompanyFolders company={c} onDoc={setPreview}/></main>{preview&&<DocumentPreview doc={preview} onClose={()=>setPreview(null)}/>}<div id="ready"/></>;}
  createRoot(document.getElementById('root')).render(<App/>);
 `},plugins:[{name:'fictional-command-transport',setup(b){
  b.onResolve({filter:/^@\/lib\/title\/store$/},()=>({path:'store',namespace:'fixture'}));
  b.onLoad({filter:/^store$/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:web,contents:storeFixture}));
  b.onResolve({filter:/^\.\/(document-text-review|publications|deliveries)$/},a=>({path:a.path,namespace:'document-child'}));
  b.onLoad({filter:/.*/,namespace:'document-child'},a=>({loader:'tsx',contents:`export const ${a.path.includes('document-text-review')?'DocumentTextReview':a.path.includes('publications')?'PublicationManager':'DeliveryManager'}=()=>null;`}));
  b.onResolve({filter:/^sonner$/},()=>({path:'toast',namespace:'fixture'}));
  b.onLoad({filter:/^toast$/,namespace:'fixture'},()=>({loader:'tsx',contents:`export const toast={success:()=>{},error:message=>window.fixtureFailures.push(String(message)),info:()=>{}};export const Toaster=()=>null;`}));
 }}]});
 server=createServer((req,res)=>{if(req.url==='/app.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bundle.outputFiles[0].contents)}else{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:24px}main{max-width:850px}button,input,select{margin:4px;padding:8px}fieldset{display:block}label{display:block;margin:4px} [data-slot="dialog-content"]{position:fixed;left:5vw;top:3vh;background:white;width:85vw;max-height:88vh;overflow:auto;padding:24px;border:2px solid black;z-index:100} [data-slot="dialog-overlay"]{position:fixed;inset:0;background:#7779;z-index:99}svg{width:18px;height:18px}.company-avatar{display:inline-block;width:48px;height:48px}</style></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({channel:'chrome',headless:true})}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[])});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}});
async function open(suffix='',live=false){await context?.close();errors=[];context=await browser.newContext({viewport:{width:1500,height:1200}});const site=live?'https://agency.example.test':origin;await context.route('**/*',async r=>r.request().url().startsWith(site+'/')?live?r.fulfill({response:await r.fetch({url:origin+new URL(r.request().url()).pathname})}):r.continue():r.abort());await context.addInitScript(()=>{window.copiedLinks=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async link=>window.copiedLinks.push(link)}})});page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(site+suffix);await page.locator('#ready').waitFor({state:'attached'});}
const state=()=>page.evaluate(()=>window.readFixture());
const dialog=name=>page.getByRole('dialog',{name,exact:true});

async function upload(file){const d=dialog('Upload documents');await d.getByLabel('Select documents',{exact:true}).setInputFiles(file);await d.getByRole('button',{name:'Review documents',exact:true}).click();return d;}

test('company contact editor saves multiple emails, primary address, website applicability, and renewal terms',async()=>{
 await open();await page.getByRole('button',{name:'Edit details',exact:true}).click();const d=dialog('Company details');
 await d.getByLabel('Company address',{exact:true}).fill('100 Fictional Lane, Charlotte, NC 28202');
 await d.getByRole('button',{name:'Add email address',exact:true}).click();await d.getByLabel('Email label 1',{exact:true}).fill('Orders');await d.getByLabel('Email address 1',{exact:true}).fill('orders@example.test');
 await d.getByRole('button',{name:'Add email address',exact:true}).click();await d.getByLabel('Email label 2',{exact:true}).fill('Owner');await d.getByLabel('Email address 2',{exact:true}).fill('owner@example.test');
 await d.getByLabel('Company domain',{exact:true}).fill('fictional.example.test');await d.getByLabel('Website Not Needed',{exact:true}).check();
 await d.getByLabel('Domain renewal date',{exact:true}).fill('2028-10-06');await d.getByLabel('Domain renewal term',{exact:true}).selectOption('3');
 await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});
 const saved=await state(),company=saved.state.companies[0];assert.deepEqual(saved.failures,[]);assert.equal(company.email,'orders@example.test');assert.equal(company.desk.emails.length,2);assert.equal(company.desk.emails[0].primary,true);assert.equal(company.desk.websiteNotNeeded,true);assert.equal(company.desk.renewals.find(r=>r.service==='Domain').renewalYears,3);assert.equal(company.desk.folders.length,8);
 await page.getByRole('button',{name:'Edit details',exact:true}).click();await dialog('Company details').getByRole('radio',{name:'Primary',exact:true}).nth(1).check();await dialog('Company details').getByRole('button',{name:'Save company details',exact:true}).click();await dialog('Company details').waitFor({state:'detached'});assert.equal((await state()).state.companies[0].email,'owner@example.test');
});
test('company cabinet renames and moves a document, marks final, removes to Trash and restores the same original',async()=>{
 await open();await page.getByLabel('File options for Cedar formation.txt',{exact:true}).click();const original=(await state()).state.documents.find(d=>d.id==='formation');
 let row=page.locator('div').filter({has:page.getByLabel('Folder for Cedar formation.txt',{exact:true})}).filter({has:page.getByRole('button',{name:'Rename',exact:true})}).last();
 await row.getByRole('button',{name:'Rename',exact:true}).click();const rename=dialog('Rename document');await rename.getByLabel('Document name',{exact:true}).fill('Company formation current.txt');await rename.getByRole('button',{name:'Save name',exact:true}).click();await rename.waitFor({state:'detached'});
 await page.getByLabel('Folder for Company formation current.txt',{exact:true}).selectOption('agency-folder-2');await page.getByLabel('Version designation for Company formation current.txt',{exact:true}).selectOption('Final');
 row=page.locator('div').filter({has:page.getByLabel('Folder for Company formation current.txt',{exact:true})}).filter({has:page.getByRole('button',{name:'Delete',exact:true})}).last();await row.getByRole('button',{name:'Delete',exact:true}).click();const remove=dialog('Move document to Trash');await remove.getByRole('button',{name:'Move to Trash',exact:true}).click();await remove.waitFor({state:'detached'});
 assert.equal(await page.getByLabel('Folder for Company formation current.txt',{exact:true}).count(),0);await page.getByRole('button',{name:'Trash',exact:true}).click();await page.getByRole('button',{name:'Restore',exact:true}).click();await page.getByLabel('Company document folder',{exact:true}).selectOption('all');
 const saved=await state(),doc=saved.state.documents.find(d=>d.id==='formation');assert.deepEqual(saved.failures,[]);assert.equal(doc.archivedAt,undefined);assert.equal(doc.name,original.name);assert.equal(doc.assetId,original.assetId);assert.equal(doc.version,original.version);assert.equal(doc.displayName,'Company formation current.txt');assert.equal(doc.folderId,'agency-folder-2');assert.equal(doc.designation,undefined);assert.equal(saved.assetWrites.length,0);assert.equal(saved.state.documents.length,3);
});
test('linked logo cannot be deleted and logo controls change after selection then remove only its selection',async()=>{
 await open();await page.getByRole('button',{name:'Edit details',exact:true}).click();const d=dialog('Company details');await d.getByLabel('Company logo',{exact:true}).selectOption('logo-existing');await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Change logo',exact:true}).waitFor();await page.getByLabel('File options for Cedar logo.png',{exact:true}).click();const row=page.locator('div').filter({has:page.getByLabel('Folder for Cedar logo.png',{exact:true})}).filter({has:page.getByRole('button',{name:'Delete',exact:true})}).last();assert.equal(await row.getByRole('button',{name:'Delete',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Remove logo',exact:true}).click();await page.getByRole('button',{name:'Upload company logo',exact:true}).waitFor();const saved=await state();assert.equal(saved.state.companies[0].desk.logoDocumentId,'');assert.ok(saved.state.documents.find(d=>d.id==='logo-existing'));assert.equal(saved.assetWrites.length,0);
});
test('stale rename is rejected without overwriting document placement',async()=>{
 await open();await page.getByLabel('File options for Cedar formation.txt',{exact:true}).click();const row=page.locator('div').filter({has:page.getByLabel('Folder for Cedar formation.txt',{exact:true})}).filter({has:page.getByRole('button',{name:'Rename',exact:true})}).last();await row.getByRole('button',{name:'Rename',exact:true}).click();const d=dialog('Rename document');await d.getByLabel('Document name',{exact:true}).fill('Stale name.txt');await page.evaluate(()=>window.changeFolder('formation','agency-folder-2'));await d.getByRole('button',{name:'Save name',exact:true}).click();await d.getByRole('alert').waitFor();const saved=await state();assert.equal(saved.state.documents.find(d=>d.id==='formation').displayName,undefined);assert.equal(saved.state.documents.find(d=>d.id==='formation').folderId,'agency-folder-2');
});
test('company upload defaults sensitive records to Restricted and leaves access controls collapsed',async()=>{
 await open();await page.getByRole('button',{name:'Upload',exact:true}).click();const d=await upload({name:'fictional-tax.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional only')});assert.equal(await d.getByLabel('Document visibility',{exact:true}).inputValue(),'Restricted');assert.equal(await d.getByLabel('Document visibility',{exact:true}).isVisible(),false);await d.getByRole('button',{name:'Save documents',exact:true}).click();await d.waitFor({state:'detached'});const saved=await state();assert.deepEqual(saved.failures,[]);assert.equal(saved.state.documents.find(d=>d.name==='fictional-tax.txt').visibility,'Restricted');
});


test('profile displays the renewed maintenance date and updates its canonical record with compare-and-swap',async()=>{
 await open();await page.evaluate(()=>window.installMaintenance());await page.getByRole('button',{name:'Edit details',exact:true}).click();const d=dialog('Company details');assert.equal(await d.getByLabel('Domain renewal date',{exact:true}).inputValue(),'2029-01-01');assert.equal(await d.getByLabel('Domain renewal term',{exact:true}).inputValue(),'3');await d.getByLabel('Domain renewal date',{exact:true}).fill('2030-01-01');await d.getByLabel('Domain renewal term',{exact:true}).selectOption('2');await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});const saved=await state();assert.deepEqual(saved.failures,[]);assert.equal(saved.state.agencyMaintenance.records[0].nextDueOn,'2030-01-01');assert.equal(saved.state.agencyMaintenance.records[0].intervalYears,2);assert.equal(saved.state.agencyMaintenance.records[0].revision,2);assert.deepEqual(saved.state.agencyMaintenance.history,[]);assert.ok(saved.calls.at(-1).commands.some(command=>command.name==='saveAgencyMaintenance'));
});


test('company cards show all three renewal dates with explicit unavailable and website-not-needed states',async()=>{
 await open();const dates=page.locator('[aria-label="Company service renewal dates"]');assert.deepEqual(await dates.locator('dt').allTextContents(),['Domain','Email','Website']);assert.deepEqual(await dates.locator('dd').allTextContents(),['No date','No date','No date']);await page.evaluate(()=>window.installMaintenance());assert.deepEqual(await dates.locator('dd').allTextContents(),['2029-01-01','No date','No date']);await page.getByRole('button',{name:'Edit details',exact:true}).click();const d=dialog('Company details');await d.getByLabel('Email renewal date',{exact:true}).fill('2028-02-03');await d.getByLabel('Website Not Needed',{exact:true}).check();await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});assert.deepEqual(await dates.locator('dd').allTextContents(),['2029-01-01','2028-02-03','Not needed']);
});


test('the company cabinet keeps common actions visible and management and filters secondary',async()=>{
 await open();const cabinet=page.locator('[aria-label="Company file library"]');
 assert.equal(await cabinet.getByLabel('Company document folder',{exact:true}).inputValue(),'all');
 assert.equal(await cabinet.getByLabel('Company document folder',{exact:true}).locator('option').count(),10);
 assert.equal(await cabinet.getByRole('button',{name:'New folder',exact:true}).count(),0);
 assert.equal(await cabinet.getByRole('button',{name:/^Rename 0/}).count(),0);
 assert.equal(await cabinet.getByLabel('Document access filter',{exact:true}).count(),0);
 assert.doesNotMatch(await cabinet.innerText(), /Restricted|Internal|Partner Portal|publication/);
 assert.equal(await cabinet.getByLabel('Document type filter',{exact:true}).isVisible(),false);
 assert.equal(await cabinet.getByLabel('Folder for Cedar formation.txt',{exact:true}).isVisible(),false);
 assert.equal(await cabinet.getByRole('button',{name:'Download Cedar formation.txt',exact:true}).isVisible(),true);
 assert.equal(await cabinet.getByRole('button',{name:'Copy staff link for Cedar formation.txt',exact:true}).isDisabled(),true);
 await cabinet.getByText('More filters',{exact:true}).click();assert.equal(await cabinet.getByLabel('Document type filter',{exact:true}).isVisible(),true);
 await cabinet.getByLabel('Document type filter',{exact:true}).selectOption('Formation');assert.equal(await cabinet.getByRole('button',{name:'Download Cedar logo.png',exact:true}).count(),0);
 await cabinet.getByLabel('File options for Cedar formation.txt',{exact:true}).click();assert.equal(await cabinet.getByLabel('Folder for Cedar formation.txt',{exact:true}).isVisible(),true);
 assert.deepEqual((await state()).calls,[]);
});
test('Agency preview shows one download and no publication flow; staff links copy a protected record URL',async()=>{
 await open('',true);const before=await state();const cabinet=page.locator('[aria-label="Company file library"]');
 await cabinet.getByRole('button').filter({hasText:'Cedar formation.txt'}).first().click();const preview=dialog('Cedar formation.txt');
 await preview.getByText('fictional formation',{exact:true}).waitFor();
 assert.equal(await preview.getByRole('button',{name:/Download/}).count(),1);
 assert.doesNotMatch(await preview.innerText(),/Partner|publication|Restricted|Internal/);
 await preview.getByRole('button',{name:'Copy staff link for Cedar formation.txt',exact:true}).click();
 await preview.getByRole('status').filter({hasText:'Staff link copied'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.copiedLinks),['https://agency.example.test/#agency/documents/00000000-0000-4000-8000-000000000001/formation']);
 const after=await state();assert.deepEqual(after.state,before.state);assert.deepEqual(after.calls,[]);assert.deepEqual(after.assetWrites,[]);
});
test('saving service dates creates tracking and clearing a date or website opt-out pauses it without deleting history',async()=>{
 await open();const today=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 await page.getByRole('button',{name:'Edit details',exact:true}).click();let d=dialog('Company details');
 await d.getByLabel('Domain renewal date',{exact:true}).fill(today);await d.getByLabel('Domain renewal term',{exact:true}).selectOption('2');await d.getByLabel('Website renewal date',{exact:true}).fill(today);
 await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});
 let saved=await state();assert.deepEqual(saved.failures,[]);assert.equal(saved.state.agencyMaintenance.records.length,2);assert.equal(saved.state.agencyMaintenance.records.find(r=>r.kind==='Domain').intervalYears,2);assert.equal(saved.state.tasks.filter(t=>t.phaseOne?.kind==='maintenance'&&t.phaseOne.applicable).length,2);assert.equal(saved.state.agencyMaintenance.notifications.enabled,false);
 await page.evaluate(()=>window.completeDomainCycle());const history=(await state()).state.agencyMaintenance.history;
 await page.getByRole('button',{name:'Edit details',exact:true}).click();d=dialog('Company details');await d.getByLabel('Domain renewal date',{exact:true}).fill('');await d.getByLabel('Website Not Needed',{exact:true}).check();await d.getByRole('button',{name:'Save company details',exact:true}).click();await d.waitFor({state:'detached'});
 saved=await state();assert.deepEqual(saved.failures,[]);assert.equal(saved.state.agencyMaintenance.records.length,2);assert.equal(saved.state.agencyMaintenance.records.every(r=>!r.active),true);assert.deepEqual(saved.state.agencyMaintenance.history,history);assert.equal(saved.state.tasks.some(t=>!t.done&&t.phaseOne?.kind==='maintenance'&&t.phaseOne.applicable),false);
});


test('compact folder selection filters files while folder creation and rename stay under Manage folders',async()=>{
 await open();const cabinet=page.locator('[aria-label="Company file library"]');
 await cabinet.getByLabel('File options for Cedar formation.txt',{exact:true}).click();await cabinet.getByLabel('Folder for Cedar formation.txt',{exact:true}).selectOption('agency-folder-2');
 await cabinet.getByLabel('Company document folder',{exact:true}).selectOption('agency-folder-2');assert.equal(await cabinet.getByRole('button',{name:'Download Cedar formation.txt',exact:true}).count(),1);assert.equal(await cabinet.getByRole('button',{name:'Download Cedar logo.png',exact:true}).count(),0);
 await cabinet.getByLabel('Company document folder',{exact:true}).selectOption('');assert.equal(await cabinet.getByRole('button',{name:'Download Cedar formation.txt',exact:true}).count(),0);assert.equal(await cabinet.getByRole('button',{name:'Download Cedar logo.png',exact:true}).count(),1);
 await cabinet.getByText('Manage folders',{exact:true}).click();await cabinet.getByRole('button',{name:'New folder',exact:true}).click();let d=dialog('New folder');await d.getByLabel('Folder name',{exact:true}).fill('Archive records');await d.getByRole('button',{name:'Save folder',exact:true}).click();await d.waitFor({state:'detached'});
 const created=(await state()).state.companies[0].desk.folders.find(f=>f.name==='Archive records');await cabinet.getByLabel('Company document folder',{exact:true}).selectOption(created.id);
 await cabinet.getByRole('button',{name:'Rename Archive records',exact:true}).click();d=dialog('Rename folder');await d.getByLabel('Folder name',{exact:true}).fill('Historical records');await d.getByRole('button',{name:'Save folder',exact:true}).click();await d.waitFor({state:'detached'});
 assert.equal(await cabinet.getByLabel('Company document folder',{exact:true}).locator('option:checked').innerText(),'Historical records');assert.deepEqual((await state()).failures,[]);
});
