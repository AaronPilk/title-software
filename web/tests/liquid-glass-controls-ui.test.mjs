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
    import {Segments} from './components/title/shared';
    import {useIsMobile} from './hooks/use-mobile';
    import {Button} from './components/ui/button';
    import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from './components/ui/dialog';
    import {Search,ChevronRight,Building2} from 'lucide-react';
    function Fixture(){const [view,setView]=React.useState('agency');const [filing,setFiling]=React.useState('Open files');const mobile=useIsMobile();return <SidebarProvider style={{'--sidebar-width':'104px'}}>
      <Sidebar className="app-sidebar"><SidebarHeader><button className="brand" aria-label="Ballantyne Title overview"><span className="brand-wordmark"><span className="brand-name">Ballantyne</span><span className="brand-company">Title Company</span></span></button>{mobile&&<WorkspaceSwitcher view={view} onChange={setView}/>}</SidebarHeader><SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton className="nav-button" aria-label="Overview" aria-current="page" isActive><Building2/><span>Overview</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarContent></Sidebar>
      <main className="app-main"><header className="topbar"><span className="workspace-breadcrumb"><SidebarTrigger className="mobile-menu"/>Agency<ChevronRight size={13}/><strong>Overview</strong></span>{!mobile&&<div className="toolbar-workspace"><WorkspaceSwitcher view={view} onChange={setView}/></div>}<div className="toolbar-actions"><button className="search-global"><Search size={16}/>Search anything…<kbd>⌘ K</kbd></button></div></header>
      <div className="page-content"><div className="workspace-content scene-content"><div className="page-heading"><div><h1>Agency overview</h1><p>Your companies and next steps.</p></div></div><div className="metrics"><div className="metric"><div>Companies</div><strong>25</strong><small>Across your agency</small></div><div className="metric"><div>Monthly premium</div><strong>$123,456.78</strong><small>Fictional sample amount</small></div><div className="metric"><div>Open files</div><strong>124</strong><small>Fictional sample count</small></div><div className="metric"><div>Pending reviews</div><strong>15</strong><small>Fictional sample count</small></div></div>
      <section className="panel"><div className="section-heading"><h2>Company documents</h2></div><div style={{padding:24}}><p>Read original documents clearly.</p><Segments value={filing} onChange={setFiling} items={['Open files','All files']}/><div className="company-card-metrics"><div><strong>24</strong><small>Open tasks</small></div></div><Dialog><DialogTrigger asChild><Button style={{marginTop:20}}>Review document</Button></DialogTrigger><DialogContent className="modal"><DialogTitle>Review document</DialogTitle><DialogDescription>Check the source before saving.</DialogDescription><label className="field-label">File reference<input data-slot="input" defaultValue="Test document"/></label><Button>Save reviewed fields</Button></DialogContent></Dialog></div></section></div><div className="workspace-content work-surface"><section className="panel"><p>Neutral data workspace keeps detailed records readable.</p></section></div></div></main></SidebarProvider>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `}});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.mjs')).contents;
  const globalFile=new URL('../app/globals.css',import.meta.url);
  const compiled=await postcss([tailwindcss({base:web})]).process(await readFile(globalFile,'utf8'),{from:fileURLToPath(globalFile)});
  const css=compiled.css+'\n'+(bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
  server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/app.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(js);}
    else if(path==='/app.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);}
    else if(path.startsWith('/brand/')){try{const bytes=await readFile(new URL('../public'+path,import.meta.url));res.writeHead(200,{'content-type':path.endsWith('.woff2')?'font/woff2':/\.jpe?g$/.test(path)?'image/jpeg':path.endsWith('.webp')?'image/webp':'image/png'});res.end(bytes);}catch{res.writeHead(404);res.end();}}
    else{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:'chrome',headless:true});}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[]);});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
async function open(options={}){context=await browser.newContext({viewport:{width:1360,height:900},...options});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('heading',{name:'Agency overview',exact:true}).waitFor();}
const style=async(selector,key)=>page.locator(selector).first().evaluate((el,k)=>getComputedStyle(el)[k],key);
function rgba(value){const values=value.match(/[\d.]+/g)?.map(Number);assert.ok(values?.length>=3,'browser exposes RGB material colors');return[...values.slice(0,3),values[3]??1];}
function luminance(rgb){return rgb.slice(0,3).map(c=>{const s=c/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function imageLayers(value){let depth=0,start=0;const result=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&depth===0){result.push(value.slice(start,i));start=i+1;}}result.push(value.slice(start));return result;}
function composite(ink,backing){return ink.slice(0,3).map((channel,index)=>channel*ink[3]+backing[index]*(1-ink[3]));}
async function materialBackgroundRange(surfaceSelector){
  const ancestors=await page.locator(surfaceSelector).first().evaluate(element=>{
    const elements=[],rows=[];
    for(let el=element;el;el=el.parentElement)elements.unshift(el);
    const add=css=>rows.push({color:css.backgroundColor,image:css.backgroundImage,opacity:css.opacity});
    for(const el of elements){
      add(getComputedStyle(el));
      // The fixed scene is painted above body's fallback color and below the app.
      // Reading ancestors alone would incorrectly erase the photo's brightness range.
      if(el===document.body){const scene=getComputedStyle(el,'::before');if(scene.content!=='none'&&scene.content!=='normal'&&scene.display!=='none')add(scene);}
    }
    return rows;
  });
  // Bound every scene-image pixel by black and white, then composite actual material
  // colors and gradient stops in CSS painting order. Channel intervals are conservative:
  // an image or gradient can contain any intermediate brightness, not only its endpoints.
  let range=[[0,0,0],[255,255,255]];
  const paint=colors=>{const possible=colors.flatMap(color=>range.map(backing=>composite(color,backing)));range=[0,1].map((_,edge)=>[0,1,2].map(channel=>Math[edge?'max':'min'](...possible.map(color=>color[channel]))));};
  for(const surface of ancestors){
    assert.equal(Number(surface.opacity),1,'material contrast model requires opaque element compositing');paint([rgba(surface.color)]);
    for(const layer of imageLayers(surface.image).reverse()){
      if(layer.trim()==='none')continue;
      if(layer.includes('url(')){range=[[0,0,0],[255,255,255]];continue;}
      const stops=layer.match(/rgba?\([^)]+\)/g)||[];assert.ok(stops.length,'gradient color stops are included in the contrast bound');paint(stops.map(rgba));
    }
  }
  return range;
}
async function readableMaterialText(textSelector,surfaceSelector){
  const ink=rgba(await style(textSelector,'color')),range=await materialBackgroundRange(surfaceSelector);
  const inkLight=luminance(ink),low=luminance(range[0]),high=luminance(range[1]);
  assert.ok(inkLight<low||inkLight>high,`${textSelector} cannot blend into an intermediate scene brightness`);
  for(const backing of range)assert.ok(contrast(composite(ink,backing),backing)>=4.5,`${textSelector} retains at least 4.5:1 contrast over the bounded scene`);
}
test('contrast bounds include the visible scene photo above the fixed body color',async()=>{
  await open();
  await page.evaluate(()=>{
    const control=document.createElement('p');control.id='photo-contrast-control';control.textContent='Low-opacity contrast regression';
    control.style.cssText='position:fixed;left:20px;bottom:20px;color:rgb(187,187,187);background:rgba(22,29,38,.05);padding:8px';
    document.body.append(control);
  });
  const range=await materialBackgroundRange('#photo-contrast-control');
  assert.ok(range[1][0]-range[0][0]>80,'the translucent control includes the photo brightness range instead of only the fixed body color');
  await assert.rejects(readableMaterialText('#photo-contrast-control','#photo-contrast-control'),/retains at least 4\.5:1 contrast/,'a bright photo pixel can make this intentionally weak control unreadable');
  await page.addStyleTag({content:'body::before { display: none !important; }'});
  const hiddenRange=await materialBackgroundRange('#photo-contrast-control');
  assert.deepEqual(hiddenRange[0],hiddenRange[1],'a hidden photo contributes no brightness range');
  await readableMaterialText('#photo-contrast-control','#photo-contrast-control');
});
test('glass cards keep readable text, solid inputs and visible keyboard focus',async()=>{
  await open();assert.notEqual(await style('.topbar','backdropFilter'),'none');await readableMaterialText('.scene-content .panel p','.scene-content .panel');await readableMaterialText('.metric > div','.metric');await readableMaterialText('.work-surface .panel p','.work-surface .panel');await readableMaterialText('.workspace-breadcrumb','.topbar');await readableMaterialText('.scene-content .page-heading p','.scene-content');
  await page.getByRole('button',{name:'Production',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Production',exact:true}).getAttribute('aria-pressed'),'true');
  const review=page.getByRole('button',{name:'Review document',exact:true});await page.keyboard.press('Tab');await review.focus();assert.equal(await review.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();assert.equal(await style('[data-slot=input]','backgroundColor'),'rgb(255, 255, 255)');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
});
test('scene tabs retain readable selected and unselected labels and company totals',async()=>{
  await open();
  for(const state of ['active','inactive']){const selector=`.scene-content [data-slot="tabs-trigger"][data-state="${state}"]`;await readableMaterialText(selector,selector);}
  await readableMaterialText('.scene-content .company-card-metrics strong','.scene-content .panel');
  await page.getByRole('tab',{name:'All files',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'All files',exact:true}).getAttribute('aria-selected'),'true');
  for(const state of ['active','inactive']){const selector=`.scene-content [data-slot="tabs-trigger"][data-state="${state}"]`;await readableMaterialText(selector,selector);}
});
test('high contrast and reduced motion disable translucent and moving surfaces',async()=>{
  await open({contrast:'more',reducedMotion:'reduce'});assert.equal(await style('.topbar','backdropFilter'),'none');assert.ok((await style('.nav-button','transitionDuration')).split(', ').every(s=>parseFloat(s)<=.00001));await page.getByRole('button',{name:'Review document',exact:true}).click();assert.equal(await style('[data-slot=dialog-content]','backgroundColor'),'rgb(255, 255, 255)');assert.equal(await style('[data-slot=dialog-overlay]','backdropFilter'),'none');
  for(const surface of ['.panel','.metric']){assert.equal(rgba(await style(surface,'backgroundColor'))[3],1);assert.equal(await style(surface,'backdropFilter'),'none');}
});
test('reduced transparency makes the material opaque',async()=>{
  await open();const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches),true);assert.equal(await style('.topbar','backdropFilter'),'none');await page.getByRole('button',{name:'Review document',exact:true}).click();assert.equal(await style('[data-slot=dialog-content]','backgroundColor'),'rgb(255, 255, 255)');
  for(const surface of ['.panel','.metric']){assert.equal(rgba(await style(surface,'backgroundColor'))[3],1);assert.equal(await style(surface,'backdropFilter'),'none');}
  await cdp.detach();
});
for(const width of [390,320])test(`phone navigation and input dialogs stay within a ${width} CSS-pixel viewport`,async()=>{
  await open({viewport:{width,height:844}});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'Toggle Sidebar'}).click();await page.getByRole('button',{name:'Production',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Production',exact:true}).getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Review document',exact:true}).click();const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.equal(await style('[data-slot=input]','fontSize'),'16px');
});
test('forced colors retain active navigation and visible dialog boundaries',async()=>{
  await open({forcedColors:'active'});assert.equal(await style('.topbar','backdropFilter'),'none');assert.equal(await style('.nav-button[data-active=true]','borderTopWidth'),'2px');await page.getByRole('button',{name:'Review document',exact:true}).click();assert.equal(await style('[data-slot=dialog-content]','borderTopStyle'),'solid');
  for(const surface of ['.panel','.metric'])assert.equal(await style(surface,'backdropFilter'),'none');
});
for(const width of [1360,960,390,320])test(`financial values remain readable and fully contained at ${width}px`,async()=>{
  await open({viewport:{width,height:900}});
  const amount=page.getByText('$123,456.78',{exact:true});
  assert.equal(await amount.evaluate(el=>{
    const card=el.closest('.metric').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
    return parseFloat(getComputedStyle(el).fontSize)>=24&&[...range.getClientRects()].every(rect=>rect.left>=card.left&&rect.right<=card.right+1&&rect.bottom<=card.bottom+1);
  }),true,'every currency digit stays inside its card at a readable font size');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
