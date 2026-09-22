// Run against a locally served production pilot build, never a signed-in session.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.TITLE_PILOT_TEST_URL || "http://127.0.0.1:5189";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use an isolated local pilot build");
for (const [path,status] of [["/",200],["/brand/ballantyne-title-logo.png",200],["/api/assistant",405],["/qa-missing-page",404]])
  test("production response policy covers " + path,async()=>{
    const response=await fetch(base+path,{signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,status);
    assert.equal(response.headers.get("x-content-type-options"),"nosniff");
    assert.equal(response.headers.get("x-frame-options"),"DENY");
    assert.equal(response.headers.get("referrer-policy"),"no-referrer");
    const csp=response.headers.get("content-security-policy")||"";
    for(const directive of ["object-src 'none'","frame-ancestors 'none'","frame-src 'none'","worker-src 'self' blob:"])
      assert.ok(csp.includes(directive),directive);
    assert.ok(!csp.includes("'unsafe-eval'"));
    await response.body?.cancel();
  });
test("production sign-in hydrates on desktop and mobile under the response policy",async()=>{
  let browser;
  try {browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:"chrome"});}
  try{
    for(const width of [1440,390]){
      const context=await browser.newContext({viewport:{width,height:900}});
      const page=await context.newPage(),errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
      await page.goto(base,{waitUntil:"networkidle"});
      await page.getByRole("button",{name:"Sign in",exact:true}).waitFor();
      await page.getByLabel("Email",{exact:true}).fill("fictional@example.test");
      assert.equal(await page.getByLabel("Email",{exact:true}).inputValue(),"fictional@example.test");
      assert.deepEqual(errors,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await context.close();
    }
  }finally{await browser.close();}
});
