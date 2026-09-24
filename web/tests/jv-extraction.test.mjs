import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({entryPoints:['lib/title/jv-extraction.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {extractJVFields,jvCandidatePatch}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const source = (text,page=2,method='pdf-text')=>({text,page,method});
test('captures only labeled applicant fields with exact page evidence',()=>{
 const text='JOINT VENTURE APPLICATION\nName: Avery Example\nEmail: avery@example.test\nPhone: (555) 010-2345\nDOB: 1988-02-20\nSSN: 123-45-6789\nDriver’s License #: EX123456\nCurrent Address: 100 Fictional Lane, Example NC 28000';
 const found=extractJVFields([source(text)]);assert.equal(found.length,7);
 assert.equal(found.find(x=>x.field==='ssn').value,'123456789');
 for(const row of found){assert.equal(row.page,2);assert.ok(text.includes(row.quote));assert.equal(Object.keys(jvCandidatePatch(row)).length,1);}
});
test('blank welcome application creates no invented candidates or business company name',()=>{
 const text='WELCOME TO BALLANTYNE TITLE\nDomain name purchased\nJOINT VENTURE APPLICATION\nName: __________________\nEmail: __________________\nSSN: ___-__-____\nDOB: MM/DD/YYYY\nDriver License #: __________\nCurrent address: ______\nWould you like ownership in your name or business?';
 assert.deepEqual(extractJVFields([source(text)]),[]);
});
test('ambiguous numeric dates, crossed fields, and unlabeled narrative remain manual',()=>{
 assert.deepEqual(extractJVFields([source('DOB: 01/02/1980\nName: Email:\nName: Avery Example Email: a@example.test\nThe applicant is Avery Example.\nCurrent address: unknown')]),[]);
});
test('OCR digit confusions and impossible values are not silently repaired',()=>{
 assert.deepEqual(extractJVFields([source('SSN: 123-4O-6789\nSSN: 000-12-1234\nDOB: 1988-02-30\nEmail: bad mail\nPhone: Call me',1,'ocr')]),[]);
 const [found]=extractJVFields([source('Name: Avery Example',1,'ocr')]);assert.match(found.warning,/OCR/);assert.equal(found.method,'ocr');
});
test('different applicants with the same field remain distinct candidates',()=>{
 const found=extractJVFields([source('Name: Avery Example',2),source('Name: Jordan Example',3)]);
 assert.equal(found.length,2);assert.deepEqual(found.map(x=>x.page),[2,3]);
});
test('duplicate pages, huge source and control characters fail with non-sensitive errors',()=>{
 for(const pages of [[source('Name: Avery'),source('Name: Jordan')],[source('PRIVATE'.repeat(10000))],[source('Name: PRIVATE\u0000')]]){
  assert.throws(()=>extractJVFields(pages),e=>!e.message.includes('PRIVATE'));
 }
 assert.throws(()=>jvCandidatePatch({field:'__proto__',value:'PRIVATE'}));
});
test('flattened adjacent fields and unsavable birth dates cannot become an applicant value',()=>{
 for(const text of ['Name  Avery Example  Email  avery@example.test','Name:\tAvery Example\tEmail\tavery@example.test','DOB: 0000-01-01','DOB: 2100-01-01',`Name: ${'A'.repeat(201)}`,'Phone: 5-5----']) assert.deepEqual(extractJVFields([source(text)]),[]);
});
