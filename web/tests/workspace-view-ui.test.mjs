// Actual navigation hook and switcher with synthetic identity and route screens.
// This fixture does not sign in, assign permissions, or contact a backend.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = fileURLToPath(new URL("../", import.meta.url));
let server, browser, context, page, origin;
let errors = [];
const people = {
  stephenie: { userId: "staff-s", email: "s.tocado@rtocado.com", role: "operations", workspaceId: "workspace-a" },
  john: { userId: "staff-j", email: "john@ballantynetitle.com", role: "operations", workspaceId: "workspace-a" },
  tyler: { userId: "staff-t", email: "tyler@ballantyne-title.com", role: "operations", workspaceId: "workspace-a" },
  partner: { userId: "partner-fixture", email: "partner@example.test", role: "partner", workspaceId: "workspace-a" },
};
before(async () => {
  const bundle = await build({
    absWorkingDir: web, write: false, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {useWorkspaceView} from './components/title/use-workspace-view';
      import {WorkspaceSwitcher} from './components/title/workspace-switcher';
      const people=${JSON.stringify(people)};
      const query=new URLSearchParams(location.search);
      function App(){
        const [identity,setIdentity]=useState(people[query.get('person')||'stephenie']);
        const [demoUser,setDemoUser]=useState(query.get('demo')||'Stephenie');
        const [ready,setReady]=useState(!query.has('hydrate'));
        const navigation=useWorkspaceView(identity,demoUser,ready);
        window.changeFixtureIdentity=(person,workspaceId)=>setIdentity(person?{...people[person],workspaceId:workspaceId||people[person].workspaceId}:undefined);
        window.completeFixtureHydration=()=>{setDemoUser('Tyler');setReady(true);};
        if(!ready)return <p>Loading fixture workspace</p>;
        const pages=identity?.role==='partner'?['Partner portal','Settings']:['Tasks','Orders','Onboarding','Settings'];
        return <>
          {identity?.role!=='partner'&&<WorkspaceSwitcher view={navigation.view} onChange={navigation.switchView}/>}
          <output data-testid="location">{navigation.view}/{navigation.page}</output>
          <nav aria-label="Fixture route links">{pages.map(name=><button key={name} onClick={()=>navigation.navigate(name)}>Go to {name}</button>)}</nav>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "fixture-css", setup(builder) {
      builder.onResolve({filter:/\.module\.css$/},()=>({path:"styles",namespace:"fixture"}));
      builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export default {};"}));
    } }],
  });
  server=createServer((req,res)=>{
    if(new URL(req.url,"http://localhost").pathname==="/app.mjs"){
      res.writeHead(200,{"content-type":"text/javascript"});res.end(bundle.outputFiles[0].contents);
    }else{
      res.writeHead(200,{"content-type":"text/html"});
      res.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>');
    }
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:"chrome",headless:true});}
});
afterEach(async()=>{await context?.close();assert.deepEqual(errors,[]);});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
async function open({person="stephenie",hash="",demo,hydrate=false,blockedStorage=false,preferences={}}={}){
  errors=[];context=await browser.newContext();
  await context.route("**/*",route=>{
    if(!route.request().url().startsWith(`${origin}/`)){errors.push("Unexpected external request");return route.abort();}
    return route.continue();
  });
  await context.addInitScript(({blockedStorage,preferences})=>{
    if(blockedStorage){Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Storage unavailable","SecurityError");}});}
    else for(const[key,value]of Object.entries(preferences))localStorage.setItem(key,value);
  },{blockedStorage,preferences});
  page=await context.newPage();page.setDefaultTimeout(4000);
  page.on("pageerror",error=>errors.push(error.message));
  const query=new URLSearchParams({person,...(demo?{demo}:{}),...(hydrate?{hydrate:"1"}:{})});
  await page.goto(`${origin}/?${query}${hash}`);
  if(hydrate)await page.getByText("Loading fixture workspace",{exact:true}).waitFor();
  else await page.getByTestId("location").waitFor();
}
async function at(view,route){
  await page.waitForFunction(expected=>document.querySelector('[data-testid="location"]')?.textContent===expected,`${view}/${route}`);
}
async function switchTo(name){await page.getByRole("button",{name,exact:true}).click();}
async function go(name){await page.getByRole("button",{name:`Go to ${name}`,exact:true}).click();}
for(const[person,view]of[["stephenie","agency"],["john","agency"],["tyler","production"]]){
  test(`${person} starts in the requested view`,async()=>{
    await open({person});await at(view,"Overview");
    assert.equal(await page.getByRole("button",{name:view==="agency"?"Agency":"Production",exact:true}).getAttribute("aria-pressed"),"true");
  });
}
test("explicit view preference survives reload and a later visit without a route",async()=>{
  await open();await switchTo("Production");await at("production","Overview");
  assert.equal(await page.evaluate(()=>localStorage.getItem("title:workspace-view:v1:workspace-a:staff-s")),"production");
  await page.reload();await at("production","Overview");
  await page.goto(`${origin}/?person=stephenie`);await at("production","Overview");
});
test("view preferences stay separate for each account and workspace",async()=>{
  await open();await switchTo("Production");await at("production","Overview");
  await page.evaluate(()=>window.changeFixtureIdentity("john"));await at("agency","Overview");
  await page.evaluate(()=>window.changeFixtureIdentity("stephenie","workspace-b"));await at("agency","Overview");
  await page.evaluate(()=>window.changeFixtureIdentity("stephenie","workspace-a"));await at("production","Overview");
  assert.equal(await page.evaluate(()=>localStorage.getItem("title:workspace-view:v1:workspace-a:staff-j")),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem("title:workspace-view:v1:workspace-b:staff-s")),null);
});
for(const[person,hash,view]of[["tyler","#agency/tasks","agency"],["stephenie","#production/tasks","production"]]){
  test(`explicit ${hash} shares both view and page for ${person}`,async()=>{
    await open({person,hash});await at(view,"Tasks");
    await page.reload();await at(view,"Tasks");
  });
}
test("legacy page bookmarks still open and select a compatible view",async()=>{
  await open({hash:"#tasks"});await at("agency","Tasks");
  await page.goto(`${origin}/?person=stephenie#orders`);await at("production","Orders");
  await page.goto(`${origin}/?person=tyler#onboarding`);await at("agency","Onboarding");
});
test("cross-links select their view while shared pages preserve the current view",async()=>{
  await open();await go("Orders");await at("production","Orders");
  assert.equal(new URL(page.url()).hash,"#production/orders");
  await go("Tasks");await at("production","Tasks");
  await go("Onboarding");await at("agency","Onboarding");
  assert.equal(new URL(page.url()).hash,"#agency/onboarding");
  await go("Settings");await at("agency","Settings");
});
test("browser back and forward restore explicit view and page together",async()=>{
  await open({hash:"#agency/tasks"});await at("agency","Tasks");
  await go("Orders");await at("production","Orders");
  await go("Onboarding");await at("agency","Onboarding");
  await page.goBack();await at("production","Orders");
  await page.goBack();await at("agency","Tasks");
  await page.goForward();await at("production","Orders");
});
test("navigation works when browser storage is unavailable",async()=>{
  await open({blockedStorage:true});await at("agency","Overview");
  await switchTo("Production");await at("production","Overview");
  await go("Tasks");await at("production","Tasks");
  await page.reload();await at("production","Tasks");
});
test("invalid stored preferences fall back to the account default",async()=>{
  await open({person:"tyler",preferences:{"title:workspace-view:v1:workspace-a:staff-t":"unknown"}});
  await at("production","Overview");
});
test("a new account starts with its own preference rather than the prior account route",async()=>{
  await open({hash:"#agency/onboarding"});await at("agency","Onboarding");
  await page.evaluate(()=>window.changeFixtureIdentity("tyler"));await at("production","Overview");
  assert.equal(new URL(page.url()).hash,"#production/overview");
});
test("local demo hydration preserves an explicit shared deep link",async()=>{
  await open({person:"demo",demo:"Stephenie",hydrate:true,hash:"#agency/tasks"});
  await page.evaluate(()=>window.completeFixtureHydration());await at("agency","Tasks");
  assert.equal(new URL(page.url()).hash,"#agency/tasks");
});
test("local demo hydration uses the saved persona default without an explicit route",async()=>{
  await open({person:"demo",demo:"Stephenie",hydrate:true});
  await page.evaluate(()=>window.completeFixtureHydration());await at("production","Overview");
});
test("partners remain in their portal or settings and have no view switcher",async()=>{
  await open({person:"partner",hash:"#production/orders"});await at("agency","Partner portal");
  assert.equal(await page.getByRole("group",{name:"Workspace view",exact:true}).count(),0);
  await go("Settings");await at("agency","Settings");
  await page.reload();await at("agency","Settings");
  await go("Partner portal");await at("agency","Partner portal");
});
