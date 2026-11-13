import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
await mkdir('.nimi/local/test', {recursive:true});
await build({entryPoints:['src/production/remote-media.ts'],outfile:'.nimi/local/test/remote-consumer.mjs',bundle:true,platform:'node',format:'esm'});
const {createRemoteMedia}=await import(pathToFileURL(path.resolve('.nimi/local/test/remote-consumer.mjs')));

test('recovery reads the original target and never submits, uploads or creates a new render', async()=>{
  const bytes=new Uint8Array([1,2,3]);
  const digest='sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const operations=[];
  const media=createRemoteMedia({signal:new AbortController().signal,client:{integration:{
    listCatalog:async()=>[{integrationId:'openmontage.media.v1',targetRef:'original-pc',available:true,permittedOperations:['operation.read','result.read']}],
    invoke:async request=>{
      operations.push(request.operation);assert.equal(request.targetRef,'original-pc');
      const input=JSON.parse(request.inputJson);
      let result;
      if(request.operation==='operation.read'){assert.equal(input.id,'original-render');result={state:'completed',result:{blobId:'original-result',width:1280,height:720,durationSeconds:1,mimeType:'video/mp4'}};}
      else if(request.operation==='result.read'){assert.equal(input.id,'original-result');result={offset:0,nextOffset:3,size:3,digest,mimeType:'video/mp4',data:Buffer.from(bytes).toString('base64')};}
      else assert.fail('recovery must not invoke a write');
      return {status:'completed',resultJson:JSON.stringify(result)};
    },
  }}});
  const result=await media.readRenderResult('original-render','original-pc');
  assert.deepEqual(result.bytes,bytes);
  assert.deepEqual(operations,['operation.read','result.read']);
});

test('recovery cannot silently switch to another available PC provider', async()=>{
  let invoked=false;
  const media=createRemoteMedia({signal:new AbortController().signal,client:{integration:{
    listCatalog:async()=>[{integrationId:'openmontage.media.v1',targetRef:'different-pc',available:true,permittedOperations:['operation.read']}],
    invoke:async()=>{invoked=true;throw new Error('must not invoke');},
  }}});
  await assert.rejects(media.readRenderResult('original-render','original-pc'),/原 PC 媒体服务/);
  assert.equal(invoked,false);
});
