// Real navigation hook + status-only guards. Fictional draft state; no auth or remote service calls.
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const web=fileURLToPath(new URL('../',import.meta.url));
let browser,server,origin,context,page,errors=[];
before(async()=>{
 const result=await build({absWorkingDir:web,bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:web,loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{useWorkspaceView}from'./components/title/use-workspace-view';
 import{useWorkspaceNavigationGuard}from'./components/title/use-workspace-navigation-guard';
 import{allowWorkspaceNavigation}from'./lib/title/workspace-navigation-guard';
 function Editor({scope,label}){const[text,setText]=useState('Saved fictional details');const[busy,setBusy]=useState(false);useWorkspaceNavigationGuard(scope,{dirty:text!=='Saved fictional details',busy});return <section><label>{label}<input aria-label={label} value={text} onChange={e=>setText(e.target.value)}/></label><button onClick={()=>setBusy(x=>!x)}>{busy?'Finish':'Start'} {label} save</button><output aria-label={label+' busy'}>{String(busy)}</output></section>}
 function App(){const[identity,setIdentity]=useState({userId:'fictional-owner',email:'owner@example.test',role:'owner',workspaceId:'fixture'});const[allowed,setAllowed]=useState(true);const[company,setCompany]=useState(0);const[accepted,setAccepted]=useState(0);const nav=useWorkspaceView(identity,'Stephenie',true,()=>{setCompany(0);setAccepted(x=>x+1)});return <><output aria-label="Route">{nav.view+'/'+nav.page}</output><output aria-label="Accepted navigations">{accepted}</output><button onClick={()=>nav.navigate('Onboarding')}>Applications</button><button onClick={()=>nav.navigate('Documents')}>Documents</button><button onClick={()=>nav.navigate('Settings')}>Settings</button><button onClick={()=>nav.switchView('production')}>Production</button><button onClick={()=>setIdentity({...identity,userId:'second-fictional-owner'})}>Change account</button><button onClick={()=>setAllowed(false)}>Revoke application access</button><button onClick={()=>setCompany(1)}>Open company</button><button onClick={()=>{if(allowWorkspaceNavigation('company-detail'))setCompany(x=>x+1)}}>Replace company</button>{nav.page==='Onboarding'&&allowed&&<Editor key={identity.userId} scope="workspace" label="Page draft"/>}{company>0&&<Editor key={company} scope="company-detail" label="Company draft"/>}</>}
 createRoot(document.getElementById('root')).render(<App/>);`}});
 server=createServer((req,res)=>{if(req.url==='/app.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(result.outputFiles[0].contents);}else{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.mjs"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({channel:'chrome',headless:true})}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[])});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}});
async function open(hash='#agency/onboarding'){
 errors=[];context=await browser.newContext();await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/'+hash);await page.waitForFunction(()=>document.querySelector('[aria-label="Route"]')?.textContent==='agency/'+(location.hash.includes('settings')?'Settings':'Onboarding'));
}
async function at(expected){await page.waitForFunction(value=>document.querySelector('[aria-label="Route"]')?.textContent===value,expected)}
async function hash(expected){await page.waitForFunction(value=>location.hash===value,expected)}
function decide(accept){let count=0;const handler=async dialog=>{count++;assert.equal(dialog.type(),'confirm');if(accept)await dialog.accept();else await dialog.dismiss()};page.on('dialog',handler);return()=>{page.off('dialog',handler);return count}}

test('cancelled route/view navigation preserves the draft and confirmed discard prompts once',async()=>{
 await open();await page.getByLabel('Page draft',{exact:true}).fill('Unsaved fictional applicant');
 let done=decide(false);await page.getByRole('button',{name:'Documents',exact:true}).click();await at('agency/Onboarding');assert.equal(done(),1);assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Unsaved fictional applicant');
 done=decide(false);await page.getByRole('button',{name:'Production',exact:true}).click();await at('agency/Onboarding');assert.equal(done(),1);assert.equal(await page.evaluate(()=>localStorage.getItem('title:workspace-view:v1:fixture:fictional-owner')),null);
 done=decide(true);await page.getByRole('button',{name:'Documents',exact:true}).click();await at('agency/Documents');assert.equal(done(),1);assert.equal(await page.getByLabel('Page draft',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Applications',exact:true}).click();await at('agency/Onboarding');assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Saved fictional details');
});
test('a pending write blocks route/view/hash navigation without offering to discard it',async()=>{
 await open();await page.getByRole('button',{name:'Start Page draft save',exact:true}).click();const done=decide(true);
 await page.getByRole('button',{name:'Documents',exact:true}).click();await page.getByRole('button',{name:'Production',exact:true}).click();await at('agency/Onboarding');
 await page.evaluate(()=>{location.hash='#production/orders'});await hash('#agency/onboarding');await at('agency/Onboarding');assert.equal(done(),0);assert.equal(await page.getByLabel('Accepted navigations').textContent(),'0');
 const prevented=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented});assert.equal(prevented,true);
 await page.getByRole('button',{name:'Finish Page draft save',exact:true}).click();await page.getByRole('button',{name:'Documents',exact:true}).click();await at('agency/Documents');
});
test('cancelled Back restores the original history entry, then accepting Back and Forward still works',async()=>{
 await open('#agency/settings');await page.getByRole('button',{name:'Applications',exact:true}).click();await at('agency/Onboarding');await page.getByLabel('Page draft',{exact:true}).fill('Keep fictional draft');
 let done=decide(false);await page.goBack();await hash('#agency/onboarding');await at('agency/Onboarding');assert.equal(done(),1);assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Keep fictional draft');
 done=decide(true);await page.goBack();await at('agency/Settings');assert.equal(done(),1);await page.goForward();await at('agency/Onboarding');assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Saved fictional details');
});
test('cancelled Forward restores the draft without removing the forward route',async()=>{
 await open();await page.getByRole('button',{name:'Settings',exact:true}).click();await at('agency/Settings');await page.goBack();await at('agency/Onboarding');await page.getByLabel('Page draft',{exact:true}).fill('Retain on Forward');
 let done=decide(false);await page.goForward();await hash('#agency/onboarding');await at('agency/Onboarding');assert.equal(done(),1);assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Retain on Forward');
 done=decide(true);await page.goForward();await at('agency/Settings');assert.equal(done(),1);
});
test('direct hash change uses the same guard and preserves earlier Back history on cancel',async()=>{
 await open('#agency/settings');await page.getByRole('button',{name:'Applications',exact:true}).click();await page.getByLabel('Page draft',{exact:true}).fill('Keep across hash edits');
 let done=decide(false);await page.evaluate(()=>{location.hash='#production/orders'});await hash('#agency/onboarding');await at('agency/Onboarding');assert.equal(done(),1);assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Keep across hash edits');
 done=decide(true);await page.goBack();await at('agency/Settings');assert.equal(done(),1);
});
test('company replacement guards only the closing dialog; full route navigation confirms all drafts once',async()=>{
 await open();await page.getByLabel('Page draft',{exact:true}).fill('Underlying fictional draft');await page.getByRole('button',{name:'Open company',exact:true}).click();
 let done=decide(false);await page.getByRole('button',{name:'Replace company',exact:true}).click();assert.equal(done(),0);assert.equal(await page.getByLabel('Page draft',{exact:true}).inputValue(),'Underlying fictional draft');
 await page.getByLabel('Company draft',{exact:true}).fill('Second fictional draft');done=decide(false);await page.getByRole('button',{name:'Replace company',exact:true}).click();assert.equal(done(),1);assert.equal(await page.getByLabel('Company draft',{exact:true}).inputValue(),'Second fictional draft');
 done=decide(true);await page.getByRole('button',{name:'Documents',exact:true}).click();await at('agency/Documents');assert.equal(done(),1);assert.equal(await page.getByLabel('Company draft',{exact:true}).count(),0);
});
test('account changes and access revocation remove guards without blocking authorization cleanup',async()=>{
 await open();await page.getByLabel('Page draft',{exact:true}).fill('Private fictional draft');await page.getByRole('button',{name:'Start Page draft save',exact:true}).click();let done=decide(false);await page.getByRole('button',{name:'Change account',exact:true}).click();await at('agency/Overview');assert.equal(done(),0);assert.equal(await page.getByLabel('Page draft',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Applications',exact:true}).click();await page.getByLabel('Page draft',{exact:true}).fill('Another private fictional draft');await page.getByRole('button',{name:'Start Page draft save',exact:true}).click();await page.getByRole('button',{name:'Revoke application access',exact:true}).click();done=decide(false);await page.getByRole('button',{name:'Documents',exact:true}).click();await at('agency/Documents');assert.equal(done(),0);
});
