// Actual shared components + compiled global CSS, with synthetic content only.
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';
const web = fileURLToPath(new URL('../', import.meta.url));
let browser, server, context, page, origin;
const errors = [];
before(async () => {
  const bundle = await build({absWorkingDir:web,outfile:'glass.mjs',write:false,bundle:true,platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:web,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger} from './components/ui/sidebar';
    import {WorkspaceSwitcher} from './components/title/workspace-switcher';
    import {Button} from './components/ui/button';
    import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from './components/ui/dialog';
    import {Search,ChevronRight,Building2} from 'lucide-react';
    function Fixture(){const [view,setView]=React.useState('agency');return <SidebarProvider style={{'--sidebar-width':'248px'}}>
      <Sidebar className="app-sidebar"><SidebarHeader><button className="brand"><span className="brand-wordmark"><span className="brand-name">Ballantyne</span><span className="brand-company">Title Company</span></span></button><WorkspaceSwitcher view={view} onChange={setView}/></SidebarHeader><SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton className="nav-button" isActive><Building2/><span>Overview</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarContent></Sidebar>
      <main className="app-main"><header className="topbar"><span><SidebarTrigger className="mobile-menu"/>Agency<ChevronRight size={13}/><strong>Overview</strong></span><div><button className="search-global"><Search size={16}/>Search anything…<kbd>⌘ K</kbd></button></div></header>
      <div className="page-content"><div className="page-heading"><div><h1>Agency overview</h1><p>Your companies and next steps.</p></div></div><div className="metrics"><div className="metric"><div>Companies</div><strong>25</strong><small>Across your agency</small></div></div>
      <section className="panel"><div className="section-heading"><h2>Company documents</h2></div><div style={{padding:24}}><p>Read original documents clearly.</p><Dialog><DialogTrigger asChild><Button style={{marginTop:20}}>Review document</Button></DialogTrigger><DialogContent className="modal"><DialogTitle>Review document</DialogTitle><DialogDescription>Check the source before saving.</DialogDescription><label className="field-label">File reference<input data-slot="input" defaultValue="Test document"/></label><Button>Save reviewed fields</Button></DialogContent></Dialog></div></section></div></main></SidebarProvider>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `}});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.mjs')).contents;
  const globalFile=new URL('../app/globals.css',import.meta.url);
  const compiled=await postcss([tailwindcss({base:web})]).process(await readFile(globalFile,'utf8'),{from:fileURLToPath(globalFile)});
  const css=compiled.css+'\n'+(bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
  server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/app.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(js);}
    else if(path==='/app.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);}
    else if(path.startsWith('/brand/fonts/')){try{const bytes=await readFile(new URL('../public'+path,import.meta.url));res.writeHead(200,{'content-type':'font/woff2'});res.end(bytes);}catch{res.writeHead(404);res.end();}}
    else{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:'chrome',headless:true});}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[]);});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
async function open(options={}){context=await browser.newContext({viewport:{width:1360,height:900},...options});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('heading',{name:'Agency overview',exact:true}).waitFor();}
const style=async(selector,key)=>page.locator(selector).first().evaluate((el,k)=>getComputedStyle(el)[k],key);
test('glass navigation keeps source surfaces solid and keyboard focus visible',async()=>{
  await open();assert.notEqual(await style('.topbar','backdropFilter'),'none');assert.equal(await style('.panel','backgroundColor'),'rgb(255, 255, 255)');assert.equal(await style('.metric','backgroundColor'),'rgb(255, 255, 255)');
  await page.getByRole('button',{name:'Production',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Production',exact:true}).getAttribute('aria-pressed'),'true');
  const review=page.getByRole('button',{name:'Review document',exact:true});await page.keyboard.press('Tab');await review.focus();assert.equal(await review.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();assert.equal(await style('[data-slot=input]','backgroundColor'),'rgb(255, 255, 255)');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
});
test('high contrast and reduced motion disable translucent and moving surfaces',async()=>{
  await open({contrast:'more',reducedMotion:'reduce'});assert.equal(await style('.topbar','backdropFilter'),'none');assert.ok((await style('.nav-button','transitionDuration')).split(', ').every(s=>parseFloat(s)<=.00001));await page.getByRole('button',{name:'Review document',exact:true}).click();assert.equal(await style('[data-slot=dialog-content]','backgroundColor'),'rgb(255, 255, 255)');assert.equal(await style('[data-slot=dialog-overlay]','backdropFilter'),'none');
});
test('reduced transparency makes the material opaque',async()=>{
  await open();const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches),true);assert.equal(await style('.topbar','backdropFilter'),'none');await page.getByRole('button',{name:'Review document',exact:true}).click();assert.equal(await style('[data-slot=dialog-content]','backgroundColor'),'rgb(255, 255, 255)');await cdp.detach();
});
test('phone navigation and input dialogs stay within a 390 CSS-pixel viewport',async()=>{
  await open({viewport:{width:390,height:844}});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'Toggle Sidebar'}).click();await page.getByRole('button',{name:'Production',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Production',exact:true}).getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Review document',exact:true}).click();const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);assert.equal(await style('[data-slot=input]','fontSize'),'16px');
});
test('forced colors retain active navigation and visible dialog boundaries',async()=>{
  await open({forcedColors:'active'});assert.equal(await style('.topbar','backdropFilter'),'none');assert.equal(await style('.nav-button[data-active=true]','borderTopWidth'),'2px');await page.getByRole('button',{name:'Review document',exact:true}).click();assert.equal(await style('[data-slot=dialog-content]','borderTopStyle'),'solid');
});
