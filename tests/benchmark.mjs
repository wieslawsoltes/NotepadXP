/** Reproducible CPU text-engine benchmark; no rendering or disk-I/O claims. */
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import fs from 'node:fs/promises';
import * as R from '../src/rope.mjs';
const out=new URL('../docs/benchmark-results.json',import.meta.url);
const round=n=>Math.round(n*1000)/1000;
function time(fn){const start=performance.now();const value=fn();return{ms:performance.now()-start,value};}
function benchmark(mib){
 global.gc?.();const before=process.memoryUsage();
 const line='0123456789 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 abcdef\n';
 const block=line.repeat(127)+'REPLACE_ME '+line.slice(11);
 const target=mib*1024*1024;
 const text=(block.repeat(Math.ceil(target/block.length)).slice(0,target))+'~END_MARKER~';
 const built=time(()=>R.fromText(text));let root=built.value;R.validate(root);
 let checksum=0;const lookups=time(()=>{for(let i=0;i<10000;i++){const at=(Math.imul(i,104729)>>>0)%text.length;const p=R.positionAt(root,at);checksum+=R.offsetAt(root,p.line,p.column)===at?1:0;}});
 const latencies=[],snapshots=[];let seed=42;
 const edits=time(()=>{for(let i=0;i<1000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const at=seed%R.length(root);const start=performance.now();root=R.replace(root,at,at+1,'x');latencies.push(performance.now()-start);snapshots.push(root);if(snapshots.length>64)snapshots.shift();}});
 R.validate(root);latencies.sort((a,b)=>a-b);
 const found=time(()=>R.find(built.value,'~END_MARKER~'));
 const replaced=time(()=>R.replaceAll(built.value,'REPLACE_ME','UPDATED_TEXT',{matchCase:true}));
 const slice=time(()=>R.slice(root,Math.floor(text.length/2),Math.floor(text.length/2)+4096));
 const after=process.memoryUsage();
 return{datasetMiB:mib,utf16CodeUnits:text.length,logicalLines:R.lineCount(built.value),buildMs:round(built.ms),positionRoundTrips10000Ms:round(lookups.ms),positionChecksPassed:checksum,randomEdits1000Ms:round(edits.ms),editMedianMs:round(latencies[500]),editP95Ms:round(latencies[950]),findEndMarkerMs:round(found.ms),endMarkerFoundAt:found.value.start,replaceAllMs:round(replaced.ms),replacementCount:replaced.value.count,slice4096Ms:round(slice.ms),heapUsedMiBAfter:round(after.heapUsed/1048576),rssMiBAfter:round(after.rss/1048576),heapDeltaMiB:round((after.heapUsed-before.heapUsed)/1048576)};
}
// Warm up smaller trees; measure each requested dataset once.
benchmark(.5);
const requested=process.argv.slice(2).map(Number),sizes=requested.length?requested:[10,100];
if(sizes.some(n=>!Number.isFinite(n)||n<=0||n>256))throw new Error('Dataset sizes must be 0 < MiB <= 256.');
const results=sizes.map(benchmark);
const report={generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,explicitGC:!!global.gc},method:'Single warmed-up run per synthetic ASCII dataset; CPU persistent-rope operations only. 64 recent roots retained during 1,000 single-character replacement edits. All original-coordinate lookup round trips and tree invariants verified. Includes no browser worker transfer, rendering, encoding, storage, or file-read time. Timing is environment-specific, not a performance guarantee.',results};
await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
