import { execFileSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
const results=[];
for(let pass=1;pass<=5;pass++){
 const start=Date.now();
 const domain=execFileSync(process.execPath,['scripts/test-domain.mjs'],{encoding:'utf8'});
 const backend=execFileSync(process.execPath,['scripts/backend/test.mjs'],{encoding:'utf8'});
 const count=text=>Number(text.match(/tests (\d+)/)?.[1]||0);
 results.push({pass,domain:count(domain),backend:count(backend),passed:true,elapsedMs:Date.now()-start});
 console.log(`Pass ${pass}: ${count(domain)} domain + ${count(backend)} backend tests passed.`);
}
mkdirSync('../.local/backend-verification',{recursive:true});
writeFileSync('../.local/backend-verification/local-runs.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
