import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({entryPoints:['lib/title/jv-extraction.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {extractJVFields,jvCandidatePatch,extractJVApplication,jvApplicationCandidatePatch}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
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

const completePerson = `Name: Avery Example
Email: avery@example.test
Phone: (555) 010-2345
DOB: 1988-02-20
SSN: 123-45-6789
Driver’s License #: EX123456
Current Address: 100 Fictional Lane, Example NC 28000
Ownership: [ ] Individual [x] Business
Owner business name: Fictional Example LLC
Owner business status: Existing
Formation reference: Fictional formation record 2021
Residence History (last five years)
Address | From | To
100 Fictional Lane | 2023-01-01 | Present
200 Example Road | 2020-01-01 | 2022-12-31
Employment History
Employer: Fictional Employer
Role: Analyst
Address: 500 Test Street
From: 2020-01-01
To: Present`;
test('whole returned packet captures each section and all rows without inventing absent company fields',()=>{
 const text=`Applicant 1\n${completePerson}\nLogo / colors / design preferences: Blue and white, simple wordmark\nAdditional notes: Call after 3 pm.`;
 const found=extractJVApplication([source(text)],'2026-09-24');
 assert.deepEqual(found.issues,[]);assert.deepEqual(found.missing,[]);
 const patch=jvApplicationCandidatePatch(found,found.candidates.map(x=>x.id),{'applicant-1':'existing-person'});
 assert.equal(patch.applicants.length,1);assert.equal(patch.applicants[0].targetApplicantId,'existing-person');
 const person=patch.applicants[0].patch;
 assert.equal(person.name,'Avery Example');assert.equal(person.ownershipType,'business');assert.equal(person.businessStatus,'existing');assert.equal(person.businessName,'Fictional Example LLC');assert.equal(person.businessReference,'Fictional formation record 2021');
 assert.equal(person.residenceHistory.length,2);assert.equal(person.employmentHistory.length,1);assert.equal(person.residenceHistory[0].to,'');assert.equal(person.employmentHistory[0].role,'Analyst');
 assert.equal(patch.logoPreferences,'Blue and white, simple wordmark');assert.equal(patch.notes,'Call after 3 pm.');
 for(const row of found.candidates){assert.equal(row.page,2);assert.ok(text.includes(row.quote));assert.equal(row.method,'pdf-text')}
 assert.deepEqual(Object.keys(patch).sort(),['applicants','logoPreferences','notes']);
});
test('multiple applicants and repeated physical application forms preserve source-person boundaries',()=>{
 const found=extractJVApplication([source('Joint Venture Application\nName: Jordan Example\nEmail: jordan@example.test',4),source(`Joint Venture Application\n${completePerson}`,2)]);
 assert.equal(found.applicants.length,2);
 const patch=jvApplicationCandidatePatch(found,found.candidates.map(x=>x.id));
 assert.equal(patch.applicants[0].patch.name,'Avery Example');assert.equal(patch.applicants[1].patch.name,'Jordan Example');assert.equal(patch.applicants[1].patch.email,'jordan@example.test');assert.equal(patch.applicants[1].patch.ssn,undefined);
 const explicit=extractJVApplication([source('Applicant 1\nName: Avery Example\nApplicant 2\nName: Jordan Example\nEmail: jordan@example.test')]);
 assert.deepEqual(explicit.candidates.map(x=>x.applicantKey),['applicant-1','applicant-2','applicant-2']);
});
test('batch applies only reviewed candidates and rejects competing values or shared destinations',()=>{
 const found=extractJVApplication([source('Applicant 1\nName: Avery Example\nEmail: first@example.test\nEmail: second@example.test\nApplicant 2\nName: Jordan Example\nAdditional notes: Fictional note')]);
 const email=found.candidates.filter(x=>x.field==='email');assert.ok(email.every(x=>x.conflict));assert.match(found.issues[0].message,/competing/);
 assert.throws(()=>jvApplicationCandidatePatch(found,email.map(x=>x.id)),/only one/);
 const selected=found.candidates.filter(x=>x.field==='name');assert.throws(()=>jvApplicationCandidatePatch(found,selected.map(x=>x.id),{'applicant-1':'same','applicant-2':'same'}),/different existing applicant/);
 const patch=jvApplicationCandidatePatch(found,[email[1].id]);assert.deepEqual(patch.applicants[0].patch,{email:'second@example.test'});assert.equal(patch.notes,undefined);
});
test('ambiguous ownership marks, numeric dates, missing row ends and handwriting remain manual',()=>{
 for(const ownership of ['[x] Individual [x] Business','[ ] Individual [ ] Business','Individual / Business','[?] Individual [ ] Business']){
  const found=extractJVApplication([source(`Name: Avery Example\nOwnership: ${ownership}`)]);assert.equal(found.candidates.some(x=>x.field==='ownershipType'),false);assert.ok(found.issues.length);
 }
 const found=extractJVApplication([source(`Applicant 1\nDOB: 01/02/1980\nDriver’s License #: [illegible]\nResidence History\nAddress: 100 Fictional Lane\nFrom: 2021-01-01\nEmployment History\nEmployer: Fictional Employer\nFrom: 2021-01-01\nTo: 09/24/2026`,2,'ocr')]);
 assert.equal(found.candidates.length,0);assert.ok(found.issues.length>=4);assert.ok(found.missing.some(x=>/five years/.test(x)));
 const clear=extractJVApplication([source('Name: Avery Example\nDOB (MM/DD/YYYY): 01/02/1980\nOwnership: ☑ Individual ☐ Business',2,'ocr')]);
 assert.equal(clear.candidates.find(x=>x.field==='dob').value,'1980-01-02');assert.equal(clear.candidates.find(x=>x.field==='ownershipType').value,'individual');assert.ok(clear.candidates.every(x=>/OCR/.test(x.warning)));
});
test('five-year gaps and partial scan history rows are explicit, never silently treated as complete',()=>{
 const found=extractJVApplication([source(`Name: Avery Example\nResidence History\nAddress | From | To\n100 Fictional Lane | 2020-01-01 | 2022-01-01\n200 Example Road | 2023-01-01 | Present\nEmployment History\nEmployer | From | To\nUnemployed | 2020-01-01 | Present`)],'2026-09-24');
 assert.ok(found.missing.some(x=>/residence history.*gaps/.test(x)));assert.equal(found.missing.some(x=>/employment history/.test(x)),false);
 const split=extractJVApplication([source('Name: Avery Example\nResidence History\nAddress: 100 Fictional Lane\nFrom: 2020-01-01',2),source('To: Present',3)]);
 assert.equal(split.candidates.some(x=>x.field==='residenceHistory'),false);assert.ok(split.issues.some(x=>/incomplete/.test(x.message)));
});
test('blank source instructions and malformed table rows do not become values',()=>{
 const found=extractJVApplication([source('Joint Venture Application\nName: Enter your full name\nOwnership: Individual / Business\nBusiness name: ______\nResidence History\nAddress | From | To\nFill every blank with your answer\nLogo preferences:\nAdditional notes:')]);
 assert.equal(found.candidates.length,0);assert.ok(found.issues.length);
});
test('history continuation pages retain their applicant and field bounds reject unsafe drafts',()=>{
 const found=extractJVApplication([source('Joint Venture Application\nName: Avery Example',2),source('Joint Venture Application\nEmployment History\n| Employer | From | To |\n| Fictional Employer | 2020-01-01 | Present |',3)]);
 assert.equal(found.applicants.length,1);assert.equal(found.candidates.find(x=>x.field==='employmentHistory').applicantKey,'applicant-1');
 const unsafe=extractJVApplication([source('Name: Avery Example\nOwnership: __proto__\nBusiness name: Fictional LLC  Business status: Existing')]);assert.equal(unsafe.candidates.length,1);assert.ok(unsafe.issues.length>=2);
 const rows=Array.from({length:41},(_,i)=>`Fictional address ${i+1} | 2020-01-01 | Present`).join('\n');
 const capped=extractJVApplication([source(`Name: Avery Example\nResidence History\nAddress | From | To\n${rows}`)]);assert.equal(capped.candidates.filter(x=>x.field==='residenceHistory').length,40);assert.ok(capped.issues.some(x=>/exceeds 40/.test(x.message)));
});

// Synthetic responses in the supplied Canva form's real label layout. No private original or applicant data.
const returnedTemplate = (name='Avery Fictional', email='avery@example.test', ownership='[x] Individual [ ] Business') => `JOINT VENTURE
APPLI CATI ON
Ballantyne
TITLE COMPANY
PLEASE COMPLETE THE FOLLOWING. THE INFORMATION IS NEEDED TO APPLY FOR
LICENSES WITH NIPR AND UNDERWRITERS.
NAME:
${name}
EMAIL:
${email}
PHONE NUMBER:
(555) 010-2345
DATE OF BIRTH:
1988-02-20
SOCIAL SECURITY #
123-45-6789
DRIVERS LICENSE #:
EX123456
CURRENT ADDRESS:
100 Fictional Lane, Example NC 28000
WILL OWNERSHIP BE INDIVIDUAL OR BUSINESS?
${ownership}
(IF YOU WANT TO SET UP A NEW LLC FOR YOUR OWNERSHIP INTEREST, WE CAN ASSIST WITH THIS. PLEASE NOTE THIS WILL
NEED TO BE DONE PRIOR TO SETTING UP THE NEW VENTURE)
RESIDENCE LAST 5 YEARS:
Address | From | To
100 Fictional Lane | 2020-01-01 | Present
EMPLOYMENT HISTORY
LAST 5YEARS:
Employer | From | To
Fictional Employer | 2020-01-01 | Present
LOGO: PLEASE LET US KNOW IF YOU HAVE A PREFERENCE OR SUGGESTOINS FOR LOGO.
COLORS, DESIGN ETC. IF YOU HAVE A CURRENT LOGO YOU WOULD LIKE US TO RECREATE,
PLEASE LET US KNOW.
Navy and silver, use a simple wordmark.
ANY OTHER INFORMATION YOU THINK WE SHOULD KNOW OR SUGGESTIONS?
Call after 3 pm.
WWW.BALLANTYNETITLE.COM`;
test('supplied application labels and adjacent printed answers fill the complete private intake with source evidence',()=>{
 const text=returnedTemplate();const found=extractJVApplication([source(text)],'2026-09-24');
 assert.deepEqual(found.issues,[]);assert.deepEqual(found.missing,[]);assert.equal(found.applicants.length,1);
 const patch=jvApplicationCandidatePatch(found,found.candidates.map(item=>item.id));const person=patch.applicants[0].patch;
 assert.equal(person.name,'Avery Fictional');assert.equal(person.email,'avery@example.test');assert.equal(person.ssn,'123456789');assert.equal(person.ownershipType,'individual');assert.equal(person.residenceHistory.length,1);assert.equal(person.employmentHistory.length,1);
 assert.equal(patch.logoPreferences,'Navy and silver, use a simple wordmark.');assert.equal(patch.notes,'Call after 3 pm.');
 for(const candidate of found.candidates){assert.equal(candidate.page,2);assert.ok(text.includes(candidate.quote),candidate.field);}
 assert.equal(patch.companyName,undefined);assert.equal(person.businessName,undefined);
});
test('blank supplied application creates no applicant facts, prompt text, logo or footer values',()=>{
 const text=returnedTemplate().split('\n').filter(line=>!['Avery Fictional','avery@example.test','(555) 010-2345','1988-02-20','123-45-6789','EX123456','100 Fictional Lane, Example NC 28000','[x] Individual [ ] Business','Address | From | To','100 Fictional Lane | 2020-01-01 | Present','Employer | From | To','Fictional Employer | 2020-01-01 | Present','Navy and silver, use a simple wordmark.','Call after 3 pm.'].includes(line)).join('\n');
 const found=extractJVApplication([source(text)]);assert.deepEqual(found.candidates,[]);
});
test('separate completed application pages and explicit applicant headings retain person boundaries',()=>{
 const found=extractJVApplication([source(returnedTemplate(),2),source(returnedTemplate('Jordan Fictional','jordan@example.test'),3)]);
 assert.equal(found.applicants.length,2);const patch=jvApplicationCandidatePatch(found,found.candidates.filter(item=>item.applicantKey).map(item=>item.id));
 assert.deepEqual(patch.applicants.map(item=>item.patch.name),['Avery Fictional','Jordan Fictional']);assert.deepEqual(patch.applicants.map(item=>item.patch.email),['avery@example.test','jordan@example.test']);
 const headed=extractJVApplication([source('Applicant 1\nNAME:\nAvery Fictional\nEMAIL:\nApplicant 2\nNAME:\nJordan Fictional\nEMAIL:\njordan@example.test')]);
 assert.deepEqual(headed.candidates.map(item=>[item.field,item.applicantKey]),[['name','applicant-1'],['name','applicant-2'],['email','applicant-2']]);
});
test('adjacent answer capture stays on its page and does not invent ownership from blank or double selections',()=>{
 for(const ownership of ['[x] Individual [x] Business','[ ] Individual [ ] Business','Individual / Business']){
  const found=extractJVApplication([source(returnedTemplate('Avery Fictional','avery@example.test',ownership))]);assert.equal(found.candidates.some(item=>item.field==='ownershipType'),false);assert.ok(found.issues.some(item=>/Ownership choice/.test(item.message)));
 }
 const split=extractJVApplication([source('NAME:',2),source('Jordan Fictional\nEMAIL:\njordan@example.test',3)]);assert.equal(split.candidates.some(item=>item.field==='name'),false);
 const blank=extractJVApplication([source('NAME:\nEMAIL:\nPHONE NUMBER:\nWWW.BALLANTYNETITLE.COM')]);assert.deepEqual(blank.candidates,[]);
 const spaced=extractJVApplication([source('NAME:\n\nAvery  Fictional\nANY OTHER INFORMATION YOU THINK WE SHOULD KNOW OR SUGGESTIONS?\nPreferred callback: after 3 pm.')]);assert.equal(spaced.candidates.find(item=>item.field==='name').value,'Avery  Fictional');assert.equal(spaced.candidates.find(item=>item.field==='notes').value,'Preferred callback: after 3 pm.');
});
test('a repeated form cannot reuse a numbered applicant or manufacture a person from the next field',()=>{
 const found=extractJVApplication([source('Applicant 2\nName: Avery Fictional\nEmail: avery@example.test',2),source('JOINT VENTURE APPLI CATI ON\nNAME:\nJordan Fictional\nEMAIL:\njordan@example.test',3)]);
 assert.equal(new Set(found.applicants.map(item=>item.key)).size,2);
 const patch=jvApplicationCandidatePatch(found,found.candidates.map(item=>item.id));assert.deepEqual(patch.applicants.map(item=>item.patch.name),['Avery Fictional','Jordan Fictional']);assert.deepEqual(patch.applicants.map(item=>item.patch.email),['avery@example.test','jordan@example.test']);
 const continuation=extractJVApplication([source('Joint Venture Application\nName: Avery Fictional',2),source('Joint Venture Application\nNAME:\nEmail: avery@example.test',3)]);
 assert.equal(continuation.applicants.length,1);assert.equal(continuation.candidates.find(item=>item.field==='email').applicantKey,'applicant-1');
});
