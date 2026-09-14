import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { imageDimensions, boundedRaster, ocrCitation, OCR_LIMITS } from "../.local-test/ocr/api.mjs";

const pngHeader = (width, height) => { const b = new Uint8Array(24); b.set([137,80,78,71,13,10,26,10],0); b.set([73,72,68,82],12); const v=new DataView(b.buffer); v.setUint32(16,width); v.setUint32(20,height); return b; };
test("PNG dimensions are inspected before image decoding", () => assert.deepEqual(imageDimensions(pngHeader(1200,800),"image/png"), { width:1200,height:800 }));
test("oversized raster headers and unknown file types are rejected", () => { assert.throws(() => imageDimensions(pngHeader(10000,10000),"image/png"), /12 megapixels/); assert.throws(() => imageDimensions(new Uint8Array(24),"image/png"), /not a readable/); assert.throws(() => imageDimensions(pngHeader(20,20),"image/svg+xml"), /not a readable/); });
test("JPEG marker dimensions are read and malformed segment lengths rejected", () => { const b=Uint8Array.from([255,216,255,224,0,4,0,0,255,192,0,7,8,2,0,4,0]); assert.deepEqual(imageDimensions(b,"image/jpeg"), {width:1024,height:512}); b[10]=255; assert.throws(() => imageDimensions(b,"image/jpeg")); });
test("OCR render allocation is bounded regardless of requested scale", () => { for (const dims of [[612,792,200/72],[10000,10000,4],[1,1,2]]) { const r=boundedRaster(...dims); assert.ok(r.width*r.height <= OCR_LIMITS.rasterPixels); } for (const dims of [[0,10],[Infinity,100],[NaN,1],[10001,1]]) assert.throws(() => boundedRaster(...dims)); });
test("OCR citations preserve identity, version, physical page and confidence caveat", () => { const result={page:7,text:"Owner Example Buyer",confidence:91.4,language:"English",engine:"Tesseract.js 7.0.0"}; const doc={id:"synthetic-d",name:"Synthetic.pdf",version:3,mime:"application/pdf"}; const citation=ocrCitation(doc,result,"Example Buyer"); assert.match(citation,/version 3 · PDF page 7/); assert.match(citation,/Document: synthetic-d/); assert.match(citation,/not an accuracy guarantee/); assert.throws(() => ocrCitation(doc,result,"Invented wording")); assert.match(ocrCitation({...doc,mime:"image/png"},{...result,page:1},result.text), /Image 1/); });

let browser, context, page; const errors=[], requests=[];
before(async () => {
  try { browser=await chromium.launch({headless:true}); } catch { browser=await chromium.launch({channel:"chrome",headless:true}); }
  context=await browser.newContext();
  await context.route("**/*", route => {
    const url=route.request().url(); requests.push(url);
    if (!url.startsWith(process.env.OCR_TEST_ORIGIN + "/")) { errors.push(`Unexpected external OCR request: ${new URL(url).origin}`); return route.abort(); }
    return route.continue();
  });
  page=await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.OCR_TEST_ORIGIN); await page.waitForFunction(() => !!window.ocrApi);
  await page.evaluate(() => {
    window.makeScan=async (text="LOAN AMOUNT 250000", type="image/png") => {
      const canvas=document.createElement("canvas"); canvas.width=1200; canvas.height=260;
      const ctx=canvas.getContext("2d"); ctx.fillStyle="white"; ctx.fillRect(0,0,1200,260); ctx.fillStyle="black"; ctx.font="bold 54px Arial"; ctx.fillText(text,55,115); ctx.font="36px Arial"; ctx.fillText("SYNTHETIC TEST DOCUMENT",55,180);
      return await new Promise(done => canvas.toBlob(done,type,0.96));
    };
    window.makeScannedPdf=async () => {
      const encoder=new TextEncoder(), objects=[], offsets=[0]; let length=0; const chunks=[];
      const append=part => { const b=typeof part === "string" ? encoder.encode(part) : part; chunks.push(b); length+=b.length; };
      const jpgs=await Promise.all(["IGNORE FIRST PAGE","LOAN AMOUNT 250000"].map(async text => new Uint8Array(await (await window.makeScan(text,"image/jpeg")).arrayBuffer())));
      objects.push(["<< /Type /Catalog /Pages 2 0 R >>"],["<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>"]);
      jpgs.forEach((jpg,index) => {
        const start=3+index*3, content=`q 600 0 0 130 0 0 cm /Im0 Do Q`;
        objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 130] /Resources << /XObject << /Im0 ${start+1} 0 R >> >> /Contents ${start+2} 0 R >>`],
          [`<< /Type /XObject /Subtype /Image /Width 1200 /Height 260 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`,jpg,"\nendstream"],
          [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
      });
      append("%PDF-1.7\n"); objects.forEach((parts,i) => {offsets.push(length);append(`${i+1} 0 obj\n`);parts.forEach(append);append("\nendobj\n");}); const xref=length;
      append(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`); offsets.slice(1).forEach(n=>append(`${String(n).padStart(10,"0")} 00000 n \n`)); append(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(chunks,{type:"application/pdf"});
    };
  });
});
after(async () => { await context?.close(); await browser?.close(); });
test("real browser OCR reads a synthetic PNG with word confidence using local assets", {timeout:100000}, async () => {
  const result=await page.evaluate(async () => window.ocrApi.recognizeDocumentPage(await window.makeScan(),1));
  assert.match(result.text,/LOAN AMOUNT 250000/); assert.equal(result.page,1); assert.ok(result.words.some(word => word.text === "250000" && word.confidence>0)); assert.ok(result.width*result.height<=OCR_LIMITS.rasterPixels);
});
test("real scanned PDF OCR reads only the selected physical page", {timeout:100000}, async () => {
  const { text, result }=await page.evaluate(async () => {const file=await window.makeScannedPdf();return {text:await window.ocrApi.extractPdfText(file),result:await window.ocrApi.recognizeDocumentPage(file,2)};});
  assert.equal(text.reason,"empty"); assert.equal(result.page,2); assert.match(result.text,/LOAN AMOUNT 250000/); assert.doesNotMatch(result.text,/IGNORE FIRST PAGE/);
});
test("unsupported, malformed, excessive size and out-of-range pages fail before recognition", async () => {
  const results=await page.evaluate(async () => {
    const api=window.ocrApi, failures=[];
    for(const [file,n] of [[new Blob(["svg"],{type:"image/svg+xml"}),1],[new Blob(["not pdf"],{type:"application/pdf"}),1],[{size:api.OCR_LIMITS.bytes+1},1],[await window.makeScannedPdf(),3],[await window.makeScan(),2]]) {
      try {await api.recognizeDocumentPage(file,n);failures.push("unexpected success");} catch(error){failures.push(error.code);}
    }return failures;
  });
  assert.deepEqual(results,["unsupported","unreadable","size","page","page"]);
});
test("pre-cancelled OCR and a bounded timeout return clear outcomes", async () => {
  const results=await page.evaluate(async () => {const api=window.ocrApi, file=await window.makeScan(), abort=new AbortController();abort.abort();const results=[];for(const options of [{signal:abort.signal},{timeoutMs:1}]) {try{await api.recognizeDocumentPage(file,1,options);}catch(error){results.push(error.code);}}return results;});
  assert.deepEqual(results,["cancelled","timeout"]);
});
test("cancellation during engine startup terminates supervisor and child workers", async () => {
  const result=await page.evaluate(async () => {const abort=new AbortController();try {await window.ocrApi.recognizeDocumentPage(await window.makeScan(),1,{signal:abort.signal,onProgress:progress=>{if(progress.phase === "Loading OCR engine")abort.abort();}});}catch(error){return error.code;}});
  assert.equal(result,"cancelled");
  await page.waitForTimeout(350);
  const cdp=await context.newCDPSession(page); const {targetInfos}=await cdp.send("Target.getTargets"); await cdp.detach();
  assert.equal(targetInfos.filter(target=>target.type==="worker" && /local-ocr|ocr\/v7/.test(target.url)).length,0);
});
test("OCR makes no requests to third parties and leaves no text in persistent browser storage", async () => {
  assert.ok(requests.some(url=>url.includes("eng.traineddata.gz"))); assert.ok(requests.some(url=>url.includes("tesseract-core"))); assert.deepEqual(errors,[]);
  const stored=await page.evaluate(async()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),databases:await indexedDB.databases()}));
  assert.deepEqual(stored,{local:[],session:[],databases:[]});
});
