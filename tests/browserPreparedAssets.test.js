import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,get} from 'node:http';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {prepareBrowserAssets,createBrowserAssetTrace,serveBrowserAsset} from '../tools/browser_asset_response.mjs';

const file=resolve('public/animations/bjj/standing_stance.glb');
const prepared=await prepareBrowserAssets([file]);
test('prepared canonical entity remains exact through encoding negotiation and repeated real HTTP requests',async()=>{
  const trace=createBrowserAssetTrace(),entry=prepared.get(file);
  const server=createServer((request,response)=>{
    const record=trace.begin(response);record.row.path='/standing_stance.glb';record.row.preparedHit=true;record.mark('cacheHit');
    serveBrowserAsset(response,{file,body:entry.body,prepared:entry,trace:record,contentType:'model/gltf-binary',acceptEncoding:request.headers['accept-encoding']});
  });
  await new Promise(res=>server.listen(0,'127.0.0.1',res));
  try{
    for(const acceptEncoding of ['gzip','gzip','identity','gzip;q=0, *;q=1','GZip; q=0.5','*;q=0.3']){
      const result=await new Promise((res,rej)=>{
        const req=get(`http://127.0.0.1:${server.address().port}/standing_stance.glb`,{headers:{'Accept-Encoding':acceptEncoding}},response=>{
          const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>res({headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',rej);
        });req.on('error',rej);
      });
      assert.equal(result.headers.vary,'Accept-Encoding');assert.equal(result.headers['cache-control'],'public, max-age=60');
      assert.equal(Number(result.headers['content-length']),result.body.length);
      assert.deepEqual(result.headers['content-encoding']==='gzip'?gunzipSync(result.body):result.body,entry.body);
      if(result.headers['content-encoding']==='gzip')assert.deepEqual(result.body,entry.gzipBody);
      assert.equal(result.headers['server-timing'],'read;dur=0.000, gzip;dur=0.000');
    }
    await new Promise(setImmediate);
    assert.equal(trace.evidence.requests.length,6);
    for(const row of trace.evidence.requests){
      assert.equal(row.status,200);assert.equal(row.complete,true);
      assert.equal(row.phases.readStart,undefined);assert.equal(row.phases.gzipStart,undefined);
      assert.ok(row.phases.headers.monotonicMs>=row.phases.request.monotonicMs);
      assert.ok(row.phases.writeFinished.monotonicMs>=row.phases.headers.monotonicMs);
      assert.ok(row.phases.closed.monotonicMs>=row.phases.writeFinished.monotonicMs);
    }
  }finally{server.closeAllConnections();await new Promise((res,rej)=>server.close(e=>e?rej(e):res()));}
});
test('prepared payload cannot be attached to a different source buffer',()=>{
  assert.throws(()=>serveBrowserAsset({}, {file,body:Buffer.from('different'),prepared:prepared.get(file)}),/does not belong/);
});
test('preparation refuses unbounded, duplicate, empty and non-GLB input',async()=>{
  for(const files of [[],Array.from({length:17},(_,i)=>`${i}.glb`),[file,file],['thing.wasm']])await assert.rejects(prepareBrowserAssets(files));
});
test('trace storage has a hard row bound and reports dropped diagnostics',()=>{
  const trace=createBrowserAssetTrace(),response={once(){}};
  for(let i=0;i<4100;i++)trace.begin(response);
  assert.equal(trace.evidence.requests.length,4096);assert.equal(trace.evidence.dropped,4);
});
