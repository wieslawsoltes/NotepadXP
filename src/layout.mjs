import * as Rope from './rope.mjs';
export function wrapLine(text,start,width,measure,mono,advance) {
  const result=[];if(!text.length)return result;
  if(mono && /^[\x20-\x7e]*$/.test(text)) {
    const cols=Math.max(1,Math.floor(width/advance));let p=0;
    while(p+cols<text.length){let end=p+cols;const blank=text.lastIndexOf(' ',end-1);if(blank>=p)end=blank+1;result.push(start+end);p=end;}
    return result;
  }
  let rowStart=0,i=0,x=0,lastSpace=-1;
  while(i<text.length){const cp=String.fromCodePoint(text.codePointAt(i));const w=cp==='\t'?(Math.floor(x/(advance*8))+1)*advance*8-x:measure(cp);
    if(x+w>width && i>rowStart){const next=lastSpace>rowStart?lastSpace:i;result.push(start+next);rowStart=i=next;x=0;lastSpace=-1;continue;}
    x+=w;i+=cp.length;if(/\s/u.test(cp))lastSpace=i;
  }
  return result;
}
export function buildWrap(root,width,font,mono,advance) {
  const ctx=new OffscreenCanvas(1,1).getContext('2d');ctx.font=font;
  const rows=[0];let offset=0,pending='';
  for(const part of Rope.chunks(root)){
    pending+=part;let cursor=0,at;
    while((at=pending.indexOf('\n',cursor))!==-1){const text=pending.slice(cursor,at);for(const p of wrapLine(text,offset,width,s=>ctx.measureText(s).width,mono,advance))rows.push(p);offset+=text.length+1;rows.push(offset);cursor=at+1;}
    pending=pending.slice(cursor);
  }
  // Avoid argument-count limits for extremely long wrapped paragraphs.
  for(const p of wrapLine(pending,offset,width,s=>ctx.measureText(s).width,mono,advance))rows.push(p);
  return new Float64Array(rows);
}
/* Bounded lazy width checkpoints. ASCII fixed-pitch blocks take constant time.
 * Tabs retain eight-character stops; other runs use the browser's font metrics. */
export class RowMetrics {
  constructor(model,start,end,renderer){this.model=model;this.root=model.root;this.start=start;this.end=end;this.r=renderer;this.points=[0];this.blocks=new Map();this.simple=renderer.monospace&&Rope.simpleRange(this.root,start,end);}
  block(index) {
    if(this.blocks.has(index))return this.blocks.get(index);
    while(this.points.length<=index)this.block(this.points.length-1);
    const base=this.start+index*512,end=Math.min(this.end,base+512),text=Rope.slice(this.root,base,end),startX=this.points[index];
    let x=startX;
    const simple=this.r.monospace&&/^[\x20-\x7e]*$/.test(text);
    let positions=null;
    if(simple)x+=text.length*this.r.advance;
    else {positions=new Float64Array(text.length+1);positions[0]=x;let i=0;
      for(const cp of text){const w=cp==='\t'?(Math.floor((x+.001)/(this.r.advance*8))+1)*this.r.advance*8-x:this.r.measure.measureText(cp).width;x+=w;if(cp.length===2)positions[i+1]=positions[i];i+=cp.length;positions[i]=x;}
    }
    this.points[index+1]=x;const block={text,base,startX,endX:x,simple,positions};this.blocks.set(index,block);return block;
  }
  xAt(offset) {if(this.simple)return Math.max(0,Math.min(this.end-this.start,offset-this.start))*this.r.advance;const rel=Math.max(0,Math.min(this.end-this.start,offset-this.start)),index=Math.floor(rel/512);const b=this.block(index);return b.simple?b.startX+(rel-index*512)*this.r.advance:b.positions[rel-index*512];}
  offsetAt(x) {
    if(this.simple)return this.start+Math.max(0,Math.min(this.end-this.start,Math.round(x/this.r.advance)));
    if(x<=0)return this.start;
    const count=Math.ceil((this.end-this.start)/512);
    let i=0;
    // Width checkpoints are built only as far as a requested viewport/caret.
    while(i<count){const b=this.block(i);if(b.endX>=x){if(b.simple)return Math.min(this.end,b.base+Math.max(0,Math.min(b.text.length,Math.round((x-b.startX)/this.r.advance))));let lo=0,hi=b.text.length;while(lo<hi){const m=(lo+hi)>>>1;if(b.positions[m]<x)lo=m+1;else hi=m;}let p=lo;if(p&&x-b.positions[p-1]<b.positions[p]-x)p--;if(p>0&&/[\uDC00-\uDFFF]/.test(b.text[p]))p--;return b.base+p;}i++;}
    return this.end;
  }
  runs(left,right) {
    const first=this.offsetAt(Math.max(0,left-20)),last=this.offsetAt(right+20),runs=[];
    let start=first;
    // Do not begin in the middle of a surrogate pair.
    if(start>this.start&&/[\uDC00-\uDFFF]/.test(Rope.slice(this.root,start,start+1)))start--;
    const text=Rope.slice(this.root,start,Math.min(this.end,last+2));let x=this.xAt(start),current='',runX=x;
    const flush=()=>{if(current){runs.push({text:current,x:runX,width:x-runX});current='';}runX=x;};
    for(const cp of text){if(cp==='\t'){flush();x=(Math.floor((x+.001)/(this.r.advance*8))+1)*this.r.advance*8;runX=x;continue;}const w=this.r.monospace&&/^[\x20-\x7e]$/.test(cp)?this.r.advance:this.r.measure.measureText(cp).width;if(x-runX>480){flush();}current+=cp;x+=w;}
    flush();return runs;
  }
}
