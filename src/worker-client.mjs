import * as Rope from './rope.mjs';
import {decodeBytes,encodedBlob} from './encoding.mjs';
import {buildWrap} from './layout.mjs';
export class WorkerClient {
  constructor(model){this.model=model;this.pending=new Map();this.sequence=0;this.worker=null;
    try{
      this.url=globalThis.__NP_WORKER_SOURCE__?URL.createObjectURL(new Blob([globalThis.__NP_WORKER_SOURCE__],{type:'text/javascript'})):new URL('./worker.mjs',import.meta.url);
      this.worker=new Worker(this.url,{type:'module'});
      this.worker.onmessage=({data})=>{const task=this.pending.get(data.id);if(!task)return;this.pending.delete(data.id);clearTimeout(task.timer);data.error?task.reject(new Error(data.error)):task.resolve(data.result);};
      this.worker.onerror=e=>{this.worker?.terminate();this.worker=null;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error(e.message||'Background worker failed.'));}this.pending.clear();};
      this.sync();
    }catch{this.worker=null;}
    model.onChange(e=>{if(!this.worker)return;if(e.type==='edit')this.worker.postMessage({...e,before:model.revision-1,revision:model.revision});else if(e.type==='batch')this.worker.postMessage({...e,revision:model.revision});else if(e.type==='reset')this.sync();});
  }
  sync(){this.worker?.postMessage({type:'sync',root:this.model.root,revision:this.model.revision});}
  request(type,args={}){
    if(!this.worker)return this.fallback(type,args);
    return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('The operation took too long. The document has not been changed.'));},120000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({type,id,...args});});
  }
  async fallback(type,m){await new Promise(r=>setTimeout(r,0));
    if(type==='open'){const d=decodeBytes(new Uint8Array(await m.file.arrayBuffer()),m.encoding,m.codepage);return{root:Rope.fromText(d.text),encoding:d.encoding,eol:d.eol,bom:d.bom};}
    if(type==='encode')return{blob:encodedBlob(m.root,m.encoding,m.options)};
    if(type==='find')return{match:Rope.find(this.model.root,m.query,m.options),revision:this.model.revision};
    if(type==='replaceAll')return{...Rope.replaceAll(this.model.root,m.query,m.replacement,m.options),revision:this.model.revision};
    if(type==='wrap')return{rows:buildWrap(this.model.root,m.width,m.font,m.monospace,m.advance),revision:this.model.revision,width:m.width};
    throw new Error('Unknown background operation');
  }
}
