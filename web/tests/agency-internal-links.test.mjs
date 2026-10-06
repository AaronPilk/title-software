import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({entryPoints:[fileURLToPath(new URL('../lib/title/internal-document-link.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {internalDocumentLink,readInternalDocumentLink}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test('staff links carry only encoded workspace and document identity, never an original or access credential',()=>{
  const link=internalDocumentLink({workspaceId:'workspace-one',documentId:'document / #?',origin:'https://title.example.test/settings?secret=never#token'});
  assert.equal(link,'https://title.example.test/#agency/documents/workspace-one/document%20%2F%20%23%3F');
  assert.deepEqual(readInternalDocumentLink(new URL(link).hash),{workspaceId:'workspace-one',documentId:'document / #?'});
});
test('local or insecure origins and unusable identifiers cannot produce a staff link',()=>{
  for(const origin of ['http://title.example.test','https://localhost:5173','https://127.0.0.1','https://[::1]','file:///tmp/app'])assert.throws(()=>internalDocumentLink({workspaceId:'w',documentId:'d',origin}));
  for(const id of ['', 'x'.repeat(201), 'bad\nvalue'])assert.throws(()=>internalDocumentLink({workspaceId:'w',documentId:id,origin:'https://title.example.test'}));
});
test('parser rejects unrelated routes, excess segments and malformed IDs',()=>{
  for(const hash of ['#agency/documents','#agency/documents/w/d/extra','#production/documents/w/d','#agency/documents//d','#agency/documents/w/%','#agency/documents/w/%00','#agency/documents/w/'+ 'x'.repeat(201)])assert.equal(readInternalDocumentLink(hash),null);
});
