import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import * as R from '../src/rope.mjs';
// Execute the actual browser-worker module in a Node worker with a minimal
// message-port shim. This is not a browser/OffscreenCanvas integration test.
const source=`import {parentPort} from 'node:worker_threads';
globalThis.self={postMessage:m=>parentPort.postMessage(m)};
await import(${JSON.stringify(new URL('../src/worker.mjs',import.meta.url).href)});
parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});`;
async function client(t){
 const w=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));t.after(()=>w.terminate());
 await new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);});let id=0;
 return {send:m=>w.postMessage(m),request:async m=>{const n=++id;return new Promise((resolve,reject)=>{const done=reply=>{if(reply.id!==n)return;w.off('message',done);reply.error?reject(new Error(reply.error)):resolve(reply.result);};w.on('message',done);w.postMessage({...m,id:n});});}};
}
test('actual worker module synchronizes, searches, and processes incremental edits',async t=>{
 const c=await client(t);c.send({type:'sync',root:R.fromText('one two one'),revision:0});
 assert.deepEqual((await c.request({type:'find',query:'two',options:{},revision:0})).match,{start:4,end:7});
 c.send({type:'edit',before:0,revision:1,start:4,end:7,text:'THREE'});
 assert.deepEqual((await c.request({type:'find',query:'THREE',options:{},revision:1})).match,{start:4,end:9});
 await assert.rejects(c.request({type:'find',query:'one',options:{},revision:0}),/changed/);
});
test('actual worker module returns persistent replace-all roots without mutating its mirror',async t=>{
 const c=await client(t);c.send({type:'sync',root:R.fromText('one ONE one'),revision:9});
 const result=await c.request({type:'replaceAll',query:'one',replacement:'two',options:{},revision:9});
 assert.equal(R.slice(result.root),'two two two');assert.equal(result.count,3);assert.equal(result.revision,9);
 assert.deepEqual((await c.request({type:'find',query:'ONE',options:{matchCase:true},revision:9})).match,{start:4,end:7});
});
test('actual worker module decodes Blob files and encodes snapshot bytes',async t=>{
 const c=await client(t),file=new Blob([new Uint8Array([255,254]),Buffer.from('café\r\n📝','utf16le')]);
 const opened=await c.request({type:'open',file,encoding:'auto',codepage:'windows-1252'});
 assert.equal(opened.encoding,'utf-16le');assert.equal(R.slice(opened.root),'café\n📝');
 const {blob}=await c.request({type:'encode',root:opened.root,encoding:'utf-8',options:{bom:true,eol:'CRLF'}});
 assert.equal(new TextDecoder().decode(await blob.arrayBuffer()),'café\r\n📝');
});
test('actual worker module applies original-coordinate batches in reverse order',async t=>{
 const c=await client(t);c.send({type:'sync',root:R.fromText('0123456789'),revision:0});
 c.send({type:'batch',revision:1,edits:[{start:1,end:3,text:'A'},{start:7,end:9,text:'B'}]});
 assert.deepEqual((await c.request({type:'find',query:'0A3456B9',options:{},revision:1})).match,{start:0,end:8});
});
