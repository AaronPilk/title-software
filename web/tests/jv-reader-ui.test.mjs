import test,{before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const web=fileURLToPath(new URL('../',import.meta.url));let browser,server,origin,context,page;let errors=[];
before(async()=>{
 const result=await build({absWorkingDir:web,write:false,bundle:true,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {JVApplicationReader} from './components/title/jv-application-reader';import {newJVApplicant} from './lib/title/jv-application';const applicant=newJVApplicant('fictional-person'),other=newJVApplicant('other-person');const full=new URLSearchParams(location.search).has('full');if(full)applicant.residenceHistory=[{id:'old-row',address:'Old fictional address',from:'2020-01-01',to:''}];window.fills=[];window.applicationFills=[];createRoot(document.getElementById('root')).render(<JVApplicationReader companyId="fictional-company" applicant={applicant} applicationApplicants={[applicant,other]} onApplicationFill={full?((patch,source)=>window.applicationFills.push({patch,source})):undefined} onFill={(patch,source)=>window.fills.push({patch,source})}/>);`},plugins:[{name:'fictional-jv-reader',setup(b){
 b.onResolve({filter:/^@\/lib\/title\/store$/},()=>({path:'store',namespace:'fixture'}));
 b.onResolve({filter:/^@\/lib\/title\/source-field-reader$/},()=>({path:'reader',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/documents$/},()=>({path:'preview',namespace:'fixture'}));
 b.onLoad({filter:/^store$/,namespace:'fixture'},()=>({loader:'js',resolveDir:web,contents:`import {useSyncExternalStore} from 'react';const doc={id:'fictional-app',companyId:'fictional-company',name:'Fictional application.pdf',category:'Applications',visibility:'Restricted',version:1,assetId:'fictional-asset',mime:'application/pdf'};let state={s:{documents:[doc,{...doc,id:'wrong-company',companyId:'elsewhere',name:'Wrong company.pdf'},{...doc,id:'public-app',visibility:'Internal',name:'Unrestricted.pdf'},{...doc,id:'order-app',orderId:'file-1',name:'Title file.pdf'}]},connection:{workspaceId:'workspace',access:{userId:'person',version:1}}};const listeners=new Set();window.changeOriginal=()=>{state={...state,s:{documents:[{...doc,version:2,assetId:'new-asset'}]}};listeners.forEach(fn=>fn())};export const useWorkspace=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);export const getAsset=async()=>new Blob(['fictional'],{type:'application/pdf'});` }));
 b.onLoad({filter:/^reader$/,namespace:'fixture'},()=>({loader:'js',contents:`export const readFieldSource=async()=>window.nextScan?await window.nextScan:({status:'complete',totalPages:2,unreadPages:[],pages:window.fixturePages||[{page:2,text:'Name: Avery Example\\nSSN: 123-45-6789',method:'pdf-text'}],issues:[],notes:[]});`}));
 b.onLoad({filter:/^preview$/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:web,contents:`import React from 'react';export const DocumentPreview=({initialPage,onClose})=><div role="dialog"><p>Original page {initialPage}</p><button onClick={onClose}>Close original</button></div>;`}));
 }}]});
 server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].contents:'<div id="root"></div><script type="module" src="/app.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({channel:'chrome',headless:true})}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[])});after(async()=>{await browser?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r))});
async function open(full=false){errors=[];context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin+(full?'?full=1':''));await page.getByRole('button',{name:'Read an uploaded application',exact:true}).click();}
async function scan(){await page.getByRole('combobox',{name:'Application original'}).selectOption('fictional-app');await page.getByRole('button',{name:'Find applicant fields',exact:true}).click();await page.getByText('2 labeled suggestions.',{exact:false}).waitFor();}
test('application reader lists only this company restricted application originals',async()=>{await open();const options=await page.getByRole('combobox',{name:'Application original'}).locator('option').allTextContents();assert.equal(options.length,2);assert.ok(options[1].includes('Fictional application'));});
test('candidate is added only after explicit original/applicant confirmation; evidence opens exact physical page',async()=>{await open();await scan();await page.locator('summary').filter({hasText:'Applicant name'}).click();const use=page.getByRole('button',{name:'Use reviewed applicant name',exact:true});assert.equal(await use.isDisabled(),true);await page.getByRole('button',{name:'View original page 2',exact:true}).first().click();await page.getByRole('dialog').getByText('Original page 2').waitFor();await page.getByRole('button',{name:'Close original'}).click();await page.getByRole('checkbox',{name:'I checked applicant name on page 2 and it belongs to this applicant.',exact:true}).check();await use.click();assert.deepEqual(await page.evaluate(()=>window.fills),[{patch:{name:'Avery Example'},source:'fictional-app'}]);});
test('rerun and original replacement clear prior confirmations and extracted private text',async()=>{await open();await scan();await page.locator('summary').filter({hasText:'Social Security number'}).click();await page.getByRole('checkbox',{name:'I checked social security number on page 2 and it belongs to this applicant.',exact:true}).check();await page.getByRole('button',{name:'Find applicant fields',exact:true}).click();await page.locator('summary').filter({hasText:'Social Security number'}).click();const use=page.getByRole('button',{name:'Use reviewed social security number',exact:true});assert.equal(await use.isDisabled(),true);await page.evaluate(()=>window.changeOriginal());assert.equal(await page.getByRole('button',{name:'Use reviewed social security number',exact:true}).count(),0);assert.equal(await page.getByText('SSN: 123-45-6789',{exact:true}).count(),0);});

const fullPacket = `Applicant 1
Name: Avery Example
Email: avery@example.test
Phone: (555) 010-2345
DOB: 1988-02-20
SSN: 123-45-6789
Driver’s License #: EX123456
Current Address: 100 Fictional Lane
Ownership: [x] Business [ ] Individual
Owner business name: Fictional Owner LLC
Owner business status: Existing
Formation reference: Fictional filing reference
Residence History
Address | From | To
100 Fictional Lane | 2020-01-01 | Present
Employment History
Employer | Role | Address | From | To
Fictional Employer | Analyst | 100 Test Road | 2020-01-01 | Present
Applicant 2
Name: Jordan Example
Email: jordan@example.test
Ownership: Individual
Logo preferences: Navy and white wordmark
Additional notes: Fictional notes for review`;
async function fullScan(text=fullPacket,method='pdf-text'){
 await page.evaluate(({text,method})=>{window.fixturePages=[{page:2,text,method}]},{text,method});
 await page.getByRole('combobox',{name:'Application original'}).selectOption('fictional-app');
 await page.getByRole('button',{name:'Find application fields',exact:true}).click();
 await page.getByText('application suggestions for',{exact:false}).waitFor();
}
async function reviewAll(){for(const details of await page.locator('details.jv-candidate').all()){await details.locator('summary').click();await details.getByRole('checkbox').check()}}
test('whole packet review maps multiple applicants, checks original pages, and applies only confirmed draft fields',async()=>{
 await open(true);await fullScan();const apply=page.getByRole('button',{name:'Apply reviewed application',exact:true});assert.equal(await apply.isDisabled(),true);
 assert.equal(await page.getByRole('combobox',{name:'Source applicant 1 destination',exact:true}).inputValue(),'fictional-person');assert.equal(await page.getByRole('combobox',{name:'Source applicant 2 destination',exact:true}).inputValue(),'');
 await reviewAll();assert.equal(await apply.isDisabled(),true);
 await page.getByRole('button',{name:'View original page 2',exact:true}).first().click();await page.getByRole('dialog').getByText('Original page 2').waitFor();await page.getByRole('button',{name:'Close original',exact:true}).click();
 await page.getByRole('checkbox',{name:/Replace existing source applicant 1 residence history/}).check();await apply.click();
 const fills=await page.evaluate(()=>window.applicationFills);assert.equal(fills.length,1);assert.equal(fills[0].source,'fictional-app');assert.equal(fills[0].patch.applicants.length,2);
 const [first,second]=fills[0].patch.applicants;assert.equal(first.targetApplicantId,'fictional-person');assert.equal(first.patch.ownershipType,'business');assert.equal(first.patch.residenceHistory.length,1);assert.equal(first.patch.employmentHistory.length,1);assert.equal(first.patch.businessReference,'Fictional filing reference');assert.equal(second.targetApplicantId,undefined);assert.equal(second.patch.name,'Jordan Example');assert.equal(second.patch.ssn,undefined);assert.equal(fills[0].patch.logoPreferences,'Navy and white wordmark');assert.equal(fills[0].patch.notes,'Fictional notes for review');
 assert.equal(await apply.isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.fills),[]);
});
test('review resolves scalar conflicts, keeps unchecked fields out, and invalidates confirmations after remapping',async()=>{
 await open(true);await fullScan('Applicant 1\nName: Avery Example\nEmail: first@example.test\nEmail: second@example.test\nAdditional notes: Unchecked fictional note');
 const first=page.locator('details.jv-candidate').filter({hasText:'Email: first@example.test'}),second=page.locator('details.jv-candidate').filter({hasText:'Email: second@example.test'});
 await first.locator('summary').click();await first.getByRole('checkbox').check();await second.locator('summary').click();await second.getByRole('checkbox').check();assert.equal(await first.getByRole('checkbox').isChecked(),false);
 await page.getByRole('combobox',{name:'Source applicant 1 destination',exact:true}).selectOption('other-person');assert.equal(await second.getByRole('checkbox').isChecked(),false);assert.equal(await page.getByRole('button',{name:'Apply reviewed application',exact:true}).isDisabled(),true);
 await second.getByRole('checkbox').check();await page.getByRole('button',{name:'Apply reviewed application',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.applicationFills[0].patch),{applicants:[{sourceApplicantKey:'applicant-1',label:'Source applicant 1',patch:{email:'second@example.test'},targetApplicantId:'other-person'}]});
});
test('OCR ambiguity and history gaps appear with manual feedback; rotation invalidates reviewed suggestions',async()=>{
 await open(true);await fullScan('Applicant 1\nName: Avery Example\nOwnership: [x] Individual [x] Business\nDOB: 01/02/1980\nResidence History\nAddress | From | To\n100 Fictional Lane | 2025-01-01 | Present','ocr');
 await page.getByText(/Ownership choice is incomplete, ambiguous or invalid/).waitFor();await page.locator('summary').filter({hasText:'Missing details and completeness feedback'}).click();await page.getByText(/provide residence history covering the full last five years without gaps/).waitFor();
 const name=page.locator('details.jv-candidate').filter({hasText:'Applicant name'});await name.locator('summary').click();await name.getByText(/OCR can misread handwriting/).waitFor();await name.getByRole('checkbox').check();
 await page.getByRole('combobox',{name:'Application scan orientation',exact:true}).selectOption('90');assert.equal(await page.getByRole('button',{name:'Apply reviewed application',exact:true}).count(),0);await page.getByText('Read the application again to use the new orientation.',{exact:true}).waitFor();
});
test('a late old scan cannot publish private candidates after original replacement',async()=>{
 await open(true);await page.getByRole('combobox',{name:'Application original'}).selectOption('fictional-app');
 await page.evaluate(()=>{window.nextScan=new Promise(resolve=>{window.resolveScan=resolve})});
 await page.getByRole('button',{name:'Find application fields',exact:true}).click();await page.getByRole('button',{name:'Cancel reading',exact:true}).waitFor();
 await page.evaluate(()=>window.changeOriginal());
 await page.evaluate(()=>window.resolveScan({status:'complete',totalPages:2,unreadPages:[],pages:[{page:2,text:'Name: Stale Fictional Person\nSSN: 123-45-6789',method:'pdf-text'}],issues:[],notes:[]}));
 assert.equal(await page.getByText('application suggestions for',{exact:false}).count(),0);assert.equal(await page.getByText('SSN: 123-45-6789',{exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>window.applicationFills),[]);
});
