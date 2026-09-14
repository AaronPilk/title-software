import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

let browser, context, page; const errors=[];
before(async()=>{
  try { browser=await chromium.launch({headless:true}); } catch { browser=await chromium.launch({channel:"chrome",headless:true}); }
  context=await browser.newContext();
  await context.route("**/*",route=>{
    if(!route.request().url().startsWith(process.env.WORKSPACE_REFRESH_ORIGIN+"/")) {errors.push("Unexpected external request");return route.abort();}
    return route.continue();
  });
  page=await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror",error=>errors.push(error.message));
});
beforeEach(async()=>{await page.goto(process.env.WORKSPACE_REFRESH_ORIGIN);await page.getByRole("heading",{name:"Connected workspace refresh verification"}).waitFor();assert.equal(await page.getByLabel("Workspace revision").innerText(),"1");});
after(async()=>{await context?.close();await browser?.close();});
const readFailure=async(message="Synthetic read unavailable",status=503)=>page.evaluate(({message,status})=>window.refreshFixture.readFailures.push({message,status}),{message,status});
const writeFailure=async(message="Synthetic save rejected",status=503)=>page.evaluate(({message,status})=>window.refreshFixture.writeFailures.push({message,status}),{message,status});
const refresh=async()=>{await page.getByRole("button",{name:"Read latest records",exact:true}).click();};
const waitOutput=async(label,value)=>{
  try {await page.waitForFunction(({label,value})=>document.querySelector(`[aria-label="${label}"]`)?.textContent===value,{label,value});}
  catch(error){throw new Error(`${error.message}\nProvider UI: ${await page.locator("body").innerText()}`,{cause:error});}
};

test("actual provider returns false and labels an ordinary refresh failure as a read failure",async()=>{
  await readFailure();await refresh();await waitOutput("Refresh return","false");
  assert.match(await page.locator(".shared-mode-bar").innerText(),/Could not refresh records/);
  assert.doesNotMatch(await page.locator(".shared-mode-bar").innerText(),/Changes not saved/);
  assert.equal(await page.getByRole("alert").innerText(),"Synthetic read unavailable");assert.equal(await page.getByLabel("Workspace revision").innerText(),"1");
});
test("actual provider returns true, accepts the newer revision and clears a previous read error",async()=>{
  await readFailure();await refresh();await waitOutput("Refresh return","false");
  await page.evaluate(()=>{window.refreshFixture.remote.revision=2;window.refreshFixture.remote.state.companies[0].contact="Refreshed contact";});
  await refresh();await waitOutput("Refresh return","true");assert.equal(await page.getByLabel("Workspace revision").innerText(),"2");assert.equal(await page.getByLabel("Current contact").innerText(),"Refreshed contact");
  assert.equal(await page.locator(".shared-mode-bar").innerText(),"All changes saved");assert.equal(await page.getByRole("alert").count(),0);
});
test("a write failure stays Changes not saved when a later manual refresh also fails",async()=>{
  await writeFailure();await page.getByRole("button",{name:"Save contact",exact:true}).click();await waitOutput("Write return","false");
  assert.match(await page.locator(".shared-mode-bar").innerText(),/Changes not saved/);
  await readFailure("Read failed after rejected write");await refresh();await waitOutput("Refresh return","false");
  assert.match(await page.locator(".shared-mode-bar").innerText(),/Changes not saved/);assert.equal(await page.getByRole("alert").innerText(),"Synthetic save rejected");
  assert.notEqual(await page.getByLabel("Current contact").innerText(),"Saved contact");
});
test("a rejected write and its automatic conflict refresh keep the original write failure",async()=>{
  await writeFailure("Synthetic conflict needs review",409);await readFailure("Automatic reload unavailable");
  await page.getByRole("button",{name:"Save contact",exact:true}).click();await waitOutput("Write return","false");
  assert.match(await page.locator(".shared-mode-bar").innerText(),/Changes not saved/);assert.equal(await page.getByRole("alert").innerText(),"Synthetic conflict needs review");
  assert.deepEqual(await page.evaluate(()=>window.refreshFixture.calls.map(call=>call.path)),["/commands","/state"]);
});
test("a successful command remains saved when a subsequent refresh fails",async()=>{
  await page.getByRole("button",{name:"Save contact",exact:true}).click();await waitOutput("Write return","true");
  assert.equal(await page.getByLabel("Workspace revision").innerText(),"2");assert.equal(await page.getByLabel("Current contact").innerText(),"Saved contact");
  await readFailure("Refresh unavailable after successful save");await refresh();await waitOutput("Refresh return","false");
  assert.match(await page.locator(".shared-mode-bar").innerText(),/Could not refresh records/);assert.doesNotMatch(await page.locator(".shared-mode-bar").innerText(),/Changes not saved/);
  assert.equal(await page.getByLabel("Current contact").innerText(),"Saved contact");assert.equal(await page.evaluate(()=>window.refreshFixture.remote.revision),2);
});
test("a committed import followed by refresh failure reports imported with refresh pending",async()=>{
  await readFailure("Read unavailable after import commit");await page.getByRole("button",{name:"Import then refresh",exact:true}).click();await waitOutput("Import outcome","Imported; refresh pending");
  assert.equal(await page.getByLabel("Refresh return").innerText(),"false");assert.match(await page.locator(".shared-mode-bar").innerText(),/Could not refresh records/);assert.doesNotMatch(await page.locator(".shared-mode-bar").innerText(),/Changes not saved/);
  assert.equal(await page.getByLabel("Workspace revision").innerText(),"1");assert.equal(await page.evaluate(()=>window.refreshFixture.remote.revision),2);
  await refresh();await waitOutput("Refresh return","true");assert.equal(await page.getByLabel("Workspace revision").innerText(),"2");assert.equal(await page.getByLabel("Current contact").innerText(),"Imported contact");
  assert.deepEqual(await page.evaluate(()=>window.refreshFixture.calls.map(call=>call.path)),["/fixture-import","/state","/state"]);
});
test("unauthorized refresh returns false and requests sign-out",async()=>{
  await readFailure("Synthetic session expired",401);await refresh();await waitOutput("Refresh return","false");assert.equal(await page.evaluate(()=>window.refreshFixture.signOuts),1);
});
test("unauthorized refresh still returns false when sign-out transport also fails",async()=>{
  await page.evaluate(()=>{window.refreshFixture.signOutFailure=true;});
  await readFailure("Synthetic session expired",401);await refresh();await waitOutput("Refresh return","false");
  assert.equal(await page.evaluate(()=>window.refreshFixture.signOuts),1);
  assert.match(await page.locator(".shared-mode-bar").innerText(),/Could not refresh records/);
  assert.equal(await page.getByRole("alert").innerText(),"Synthetic session expired");
});
test("synthetic provider workflows have no runtime errors or external requests",async()=>{assert.deepEqual(errors,[]);});
