import * as Rope from './rope.mjs';
import {buildWrap} from './layout.mjs';
import {decodeBytes, encodedBlob} from './encoding.mjs';
let root=null, revision=-1;
self.onmessage = async ({data:m}) => {
  try {
    if (m.type==='sync') {root=m.root; revision=m.revision; return;}
    if (m.type==='edit') { if (m.before!==revision) throw new Error('Worker revision mismatch'); root=Rope.replace(root,m.start,m.end,m.text); revision=m.revision; return; }
    if (m.type==='batch') { for(let i=m.edits.length-1;i>=0;i--){const e=m.edits[i];root=Rope.replace(root,e.start,e.end,e.text);} revision=m.revision;return;}
    let result;
    if (m.type==='open') {
      const decoded=decodeBytes(new Uint8Array(await m.file.arrayBuffer()),m.encoding,m.codepage);
      result={root:Rope.fromText(decoded.text),encoding:decoded.encoding,eol:decoded.eol,bom:decoded.bom};
    } else if (m.type==='find') {
      if (m.revision!==revision) throw new Error('Document changed during search. Try again.');
      result={match:Rope.find(root,m.query,m.options),revision};
    } else if (m.type==='replaceAll') {
      if (m.revision!==revision) throw new Error('Document changed during replacement. Try again.');
      result={...Rope.replaceAll(root,m.query,m.replacement,m.options),revision};
    } else if (m.type==='wrap') {
      if(m.revision!==revision) throw new Error('Stale wrap request');
      result={rows:buildWrap(root,m.width,m.font,m.monospace,m.advance),revision,width:m.width};
    } else if (m.type==='encode') result={blob:encodedBlob(m.root,m.encoding,m.options)};
    else throw new Error('Unknown worker command');
    self.postMessage({id:m.id,result});
  } catch(error) {self.postMessage({id:m.id,error:error.message});}
};
