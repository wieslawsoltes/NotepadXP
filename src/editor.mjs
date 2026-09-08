import * as Rope from './rope.mjs';
import {RowMetrics,buildWrap} from './layout.mjs';
export class EditorView {
  constructor(model,renderer,host,input,worker) {
    this.model=model;this.r=renderer;this.host=host;this.input=input;this.worker=worker;
    this.scrollX=0;this.scrollY=0;this.wrap=false;this.wrapRows=null;this.rowCache=new Map();this.active=false;this.caretOn=true;this.padding=2;
    this.pending=false;this.goalX=null;this.composing=false;this.touchMode=false;
    this.graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
    this.bind();this.syncInput();
    model.onChange(e=>this.changed(e));
    new ResizeObserver(()=>this.resize()).observe(host);
    document.fonts?.ready.then(()=>this.resize());
    this.blink=setInterval(()=>{if(this.active&&!this.composing&&this.model.start===this.model.end){this.caretOn=!this.caretOn;this.schedule();}},530);
  }
  resize() {const rect=this.host.getBoundingClientRect();this.r.resize(rect.width,rect.height);this.rowCache.clear();if(this.wrap)this.reflow();this.clamp();this.schedule();}
  get rows(){return this.wrap&&this.wrapRows?this.wrapRows.length:this.model.lineCount;}
  get height(){return this.rows*this.r.lineHeight;}
  get width(){return this.wrap?this.r.width:Math.max(this.r.width,(this.model.root?.maxLine||0)*this.r.advance+this.padding*2+30,this.measuredWidth||0);}
  clamp(){this.scrollY=Math.max(0,Math.min(this.scrollY,Math.max(0,this.height-this.r.height)));this.scrollX=this.wrap?0:Math.max(0,Math.min(this.scrollX,Math.max(0,this.width-this.r.width)));}
  rowStart(row){row=Math.max(0,Math.min(this.rows-1,row));return this.wrap&&this.wrapRows?Math.min(this.model.length,this.wrapRows[row]):this.model.lineStart(row);}
  rowEnd(row){let end=row+1<this.rows?this.rowStart(row+1):this.model.length;if(Rope.charAt(this.model.root,end-1)==='\n')end--;return Math.max(this.rowStart(row),end);}
  rowForOffset(offset){if(!this.wrap||!this.wrapRows)return this.model.positionAt(offset).line;let lo=0,hi=this.wrapRows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.wrapRows[mid]<=offset)lo=mid+1;else hi=mid;}return Math.max(0,lo-1);}
  metrics(row){const start=this.rowStart(row),end=this.rowEnd(row),key=`${start}:${end}`;let m=this.rowCache.get(key);if(!m){m=new RowMetrics(this.model,start,end,this.r);this.rowCache.set(key,m);if(this.rowCache.size>180)this.rowCache.delete(this.rowCache.keys().next().value);}return m;}
  changed(event){
    if(!['selection','saved'].includes(event.type)){
      this.rowCache.clear();this.measuredWidth=0;
      if(this.wrap){
        if(event.type==='edit'&&this.wrapRows){const delta=event.text.length-(event.end-event.start);this.wrapRows=this.wrapRows.map(p=>p<=event.start?p:p>=event.end?p+delta:event.start);}
        this.reflow();
      }
    }
    this.caretOn=true;this.syncInput();this.ensureVisible();this.schedule();this.onChange?.(event);
  }
  async reflow(){
    clearTimeout(this.wrapTimer);if(!this.wrap){this.wrapRows=null;this.schedule();return;}
    const width=Math.max(this.r.advance,this.r.width-this.padding*2),revision=this.model.revision;
    if(this.model.length<180000){this.wrapRows=buildWrap(this.model.root,width,this.r.font,this.r.monospace,this.r.advance);this.rowCache.clear();this.clamp();this.schedule();return;}
    this.wrapTimer=setTimeout(async()=>{try{const result=await this.worker.request('wrap',{width,font:this.r.font,monospace:this.r.monospace,advance:this.r.advance,revision});if(this.wrap&&result.revision===this.model.revision&&Math.abs(result.width-(this.r.width-this.padding*2))<1){this.wrapRows=result.rows;this.rowCache.clear();this.clamp();this.ensureVisible();this.schedule();}}catch(e){if(!e.message.includes('Stale'))this.onError?.(e);}},100);
  }
  setWrap(value){this.wrap=!!value;this.scrollX=0;this.wrapRows=null;this.rowCache.clear();this.reflow();this.ensureVisible();this.schedule();}
  schedule(){if(this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.render();});}
  render(){
    if(!this.r.font)return;this.clamp();const lineHeight=this.r.lineHeight,first=Math.floor(this.scrollY/lineHeight),last=Math.min(this.rows,Math.ceil((this.scrollY+this.r.height)/lineHeight)+1);
    const runs=[],selections=[],m=this.model;let caret=null;
    for(let row=first;row<last;row++){
      const metrics=this.metrics(row),start=metrics.start,end=metrics.end,y=row*lineHeight-this.scrollY;
      let selection=null;
      if(m.start!==m.end&&m.start<=end&&m.end>start){
        const x0=metrics.xAt(Math.max(start,m.start))+this.padding-this.scrollX;
        let x1=metrics.xAt(Math.min(end,m.end))+this.padding-this.scrollX;
        if(m.end>end)x1+=this.r.advance;
        const left=Math.max(0,x0),right=Math.min(this.r.width,x1);
        if(right>left){selections.push({x:left,y,width:right-left,height:lineHeight});selection=[left,right];}
      }
      for(const run of metrics.runs(this.scrollX-this.padding,this.scrollX+this.r.width))runs.push({...run,x:run.x+this.padding-this.scrollX,y,selection});
      if(!this.wrap&&metrics.points.length>1)this.measuredWidth=Math.max(this.measuredWidth||0,metrics.points.at(-1)+30);
    }
    const p=this.caretRect();
    if(this.active&&this.caretOn&&m.start===m.end&&!this.composing&&p.y>=-lineHeight&&p.y<this.r.height)caret={x:Math.round(p.x),y:p.y+1,width:1,height:lineHeight-2};
    this.r.render({runs,selections,caret,active:this.active});this.updateInputPosition(p);this.updateHandles();this.onScroll?.();
  }
  caretRect(offset=this.model.head){const row=this.rowForOffset(offset),metrics=this.metrics(row);return{x:this.padding+metrics.xAt(Math.min(offset,metrics.end))-this.scrollX,y:row*this.r.lineHeight-this.scrollY,width:1,height:this.r.lineHeight};}
  ensureVisible(){if(!this.r.font||this.composing)return;const p=this.caretRect(),h=this.r.lineHeight;this.measuredWidth=Math.max(this.measuredWidth||0,p.x+this.scrollX+this.r.advance+4);if(p.y<0)this.scrollY+=p.y;else if(p.y+h>this.r.height)this.scrollY+=p.y+h-this.r.height;if(!this.wrap){if(p.x<2)this.scrollX=Math.max(0,this.scrollX+p.x-2);else if(p.x>this.r.width-5)this.scrollX+=p.x-this.r.width+5;}this.clamp();}
  scroll(dx,dy){this.scrollX+=dx;this.scrollY+=dy;this.clamp();this.schedule();}
  hit(clientX,clientY){const rect=this.host.getBoundingClientRect(),row=Math.max(0,Math.min(this.rows-1,Math.floor((clientY-rect.top+this.scrollY)/this.r.lineHeight)));return this.metrics(row).offsetAt(clientX-rect.left+this.scrollX-this.padding);}
  focus(){this.input.focus({preventScroll:true});this.active=true;this.caretOn=true;this.schedule();}
  syncInput(){if(this.composing)return;const m=this.model;let start=Math.max(0,m.start-1024),end=Math.min(m.length,m.end+1024);this.largeSelection=end-start>32768;if(this.largeSelection){start=m.start;end=Math.min(m.start+1024,m.length);}const value=m.slice(start,end);this.proxyStart=start;this.proxyValue=value;this.input.value=value;try{this.input.setSelectionRange(Math.min(value.length,m.start-start),Math.min(value.length,m.end-start),m.anchor>m.head?'backward':'forward');}catch{} }
  updateInputPosition(p){this.input.style.left=`${Math.max(0,Math.min(this.r.width-5,p.x))}px`;this.input.style.top=`${Math.max(0,Math.min(this.r.height-this.r.lineHeight,p.y))}px`;this.input.style.height=`${this.r.lineHeight}px`;this.input.style.font=this.r.font;}
  applyProxy(){const old=this.proxyValue??'',value=this.input.value;if(old===value)return;let a=0,b=0;while(a<old.length&&a<value.length&&old[a]===value[a])a++;while(b<old.length-a&&b<value.length-a&&old[old.length-1-b]===value[value.length-1-b])b++;this.model.edit(this.proxyStart+a,this.proxyStart+old.length-b,value.slice(a,value.length-b),'typing');}
  step(position,direction){
    if(direction<0&&position<=0)return 0;if(direction>0&&position>=this.model.length)return this.model.length;
    const start=Math.max(0,position-128),end=Math.min(this.model.length,position+128),text=this.model.slice(start,end);
    if(this.graphemes){const boundaries=[...this.graphemes.segment(text)].map(s=>s.index+start);boundaries.push(end);if(direction<0){for(let i=boundaries.length-1;i>=0;i--)if(boundaries[i]<position)return boundaries[i];}else for(const b of boundaries)if(b>position)return b;}
    return Math.max(0,Math.min(this.model.length,position+direction));
  }
  word(position,direction){const m=this.model,isWord=c=>/[\p{L}\p{N}_]/u.test(c);let p=position;
    if(direction<0){while(p>0&&/\s/u.test(m.slice(p-1,p)))p--;if(p>0){const kind=isWord(m.slice(p-1,p));while(p>0&&!/\s/u.test(m.slice(p-1,p))&&isWord(m.slice(p-1,p))===kind)p=this.step(p,-1);}}
    else {if(p<m.length){const kind=isWord(m.slice(p,p+1));while(p<m.length&&!/\s/u.test(m.slice(p,p+1))&&isWord(m.slice(p,p+1))===kind)p=this.step(p,1);}while(p<m.length&&/\s/u.test(m.slice(p,p+1)))p=this.step(p,1);}return p;}
  selectWord(p){const m=this.model,isWord=c=>/[\p{L}\p{N}_]/u.test(c);const kind=isWord(m.slice(p,p+1));let a=p,b=p;while(a>0&&m.slice(a-1,a)!=='\n'&&isWord(m.slice(a-1,a))===kind)a=this.step(a,-1);while(b<m.length&&m.slice(b,b+1)!=='\n'&&isWord(m.slice(b,b+1))===kind)b=this.step(b,1);m.select(a,b);}
  keydown(e){
    if(this.composing||e.isComposing)return;const m=this.model,ctrl=e.ctrlKey||e.metaKey,key=e.key;let next=null;
    if(key==='ArrowLeft'||key==='ArrowRight') {const dir=key==='ArrowLeft'?-1:1;next=!e.shiftKey&&m.start!==m.end&&!ctrl?(dir<0?m.start:m.end):ctrl?this.word(m.head,dir):this.step(m.head,dir);this.goalX=null;}
    else if(['ArrowUp','ArrowDown','PageUp','PageDown'].includes(key)){
      if(ctrl&&(key==='ArrowUp'||key==='ArrowDown')){this.scroll(0,(key==='ArrowUp'?-1:1)*this.r.lineHeight);e.preventDefault();return;}
      const row=this.rowForOffset(m.head),x=this.goalX??this.metrics(row).xAt(m.head);this.goalX=x;
      const delta=(key.includes('Up')?-1:1)*(key.startsWith('Page')?Math.max(1,Math.floor(this.r.height/this.r.lineHeight)-1):1);
      const target=row+delta;next=target<0?0:target>=this.rows?m.length:this.metrics(target).offsetAt(x);
    } else if(key==='Home'||key==='End'){const row=this.rowForOffset(m.head);next=ctrl?(key==='Home'?0:m.length):(key==='Home'?this.rowStart(row):this.rowEnd(row));this.goalX=null;}
    else if(key==='Backspace'||key==='Delete'){
      e.preventDefault();if(e.shiftKey&&key==='Delete'&&m.start!==m.end){this.onCommand?.('cut');return;}
      if(m.start!==m.end)m.insert('');else {const dir=key==='Backspace'?-1:1,p=ctrl?this.word(m.head,dir):this.step(m.head,dir);m.edit(Math.min(p,m.head),Math.max(p,m.head),'');}return;
    } else if(key==='Tab'&&!ctrl&&!e.altKey){e.preventDefault();m.insert('\t','typing');return;}
    else if(ctrl&&key==='Insert'){e.preventDefault();this.onCommand?.('copy');return;}
    else if(e.shiftKey&&key==='Insert'){e.preventDefault();this.onCommand?.('paste');return;}
    if(next!==null){e.preventDefault();m.select(e.shiftKey?m.anchor:next,next);}
  }
  bind(){
    const input=this.input,m=this.model;
    input.addEventListener('keydown',e=>this.keydown(e));
    input.addEventListener('focus',()=>{this.active=true;this.caretOn=true;this.schedule();});
    input.addEventListener('blur',()=>{this.active=false;this.schedule();});
    input.addEventListener('beforeinput',e=>{
      if(this.composing||e.isComposing)return;
      const type=e.inputType;
      if(type==='insertText'&&e.data!==null){e.preventDefault();m.insert(e.data,'typing');}
      else if(type==='insertLineBreak'||type==='insertParagraph'){e.preventDefault();m.insert('\n','typing');}
      else if(type==='historyUndo'||type==='historyRedo'){e.preventDefault();type==='historyUndo'?m.undo():m.redo();}
      else if(type.startsWith('delete')){e.preventDefault();if(m.start!==m.end)m.insert('');else{const dir=type.includes('Backward')?-1:1,p=type.includes('Word')?this.word(m.head,dir):this.step(m.head,dir);m.edit(Math.min(p,m.head),Math.max(p,m.head),'');}}
    });
    input.addEventListener('input',()=>{if(this.composing){const el=document.getElementById('composition');el.textContent=input.value.slice(input.selectionStart??0);return;}this.applyProxy();});
    input.addEventListener('compositionstart',()=>{this.composing=true;this.compositionSelection=[m.start,m.end];document.getElementById('composition').hidden=false;});
    input.addEventListener('compositionupdate',e=>{const el=document.getElementById('composition'),p=this.caretRect();el.textContent=e.data;el.style.cssText=`left:${p.x}px;top:${p.y}px;font:${this.r.font};height:${this.r.lineHeight}px`;});
    input.addEventListener('compositionend',()=>{this.composing=false;document.getElementById('composition').hidden=true;this.applyProxy();this.syncInput();this.schedule();});
    input.addEventListener('copy',e=>{if(m.start===m.end)return;e.preventDefault();e.clipboardData.setData('text/plain',m.selectedText.replace(/\n/g,'\r\n'));});
    input.addEventListener('cut',e=>{if(m.start===m.end)return;e.preventDefault();e.clipboardData.setData('text/plain',m.selectedText.replace(/\n/g,'\r\n'));m.insert('');});
    input.addEventListener('paste',e=>{e.preventDefault();m.insert(e.clipboardData.getData('text/plain'));});
    this.host.addEventListener('wheel',e=>{e.preventDefault();const scale=e.deltaMode===1?this.r.lineHeight:e.deltaMode===2?this.r.height:1;this.scroll(e.shiftKey?e.deltaY*scale:e.deltaX*scale,e.shiftKey?0:e.deltaY*scale);},{passive:false});
    this.host.addEventListener('contextmenu',e=>{e.preventDefault();this.onContextMenu?.(e.clientX,e.clientY);});
    this.host.addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('selection-handle'))return;if(e.button!==0)return;
      const p=this.hit(e.clientX,e.clientY);this.touchMode=e.pointerType==='touch';
      this.drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,offset:p,anchor:e.shiftKey?m.anchor:p,touch:this.touchMode,moving:false,selecting:!this.touchMode};
      this.host.setPointerCapture(e.pointerId);
      if(this.touchMode){this.longPress=setTimeout(()=>{if(this.drag&&!this.drag.moving){this.selectWord(p);this.drag.selecting=true;this.drag.anchor=m.anchor;this.focus();navigator.vibrate?.(20);}},480);}
      else {e.preventDefault();if(e.detail===3){const line=m.positionAt(p).line;m.select(m.lineStart(line),Math.min(m.length,m.lineEnd(line)+1));this.drag.anchor=m.anchor;}
        else if(e.detail===2){this.selectWord(p);this.drag.anchor=m.anchor;}else m.select(this.drag.anchor,p);this.focus();}
    });
    this.host.addEventListener('pointermove',e=>{const d=this.drag;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.lastX,dy=e.clientY-d.lastY;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6){d.moving=true;clearTimeout(this.longPress);}if(d.touch&&!d.selecting){this.scroll(-dx,-dy);}else if(d.moving){const rect=this.host.getBoundingClientRect();if(e.clientY<rect.top)this.scroll(0,e.clientY-rect.top);if(e.clientY>rect.bottom)this.scroll(0,e.clientY-rect.bottom);if(!this.wrap&&e.clientX>rect.right)this.scroll(e.clientX-rect.right,0);m.select(d.anchor,this.hit(e.clientX,e.clientY));}d.lastX=e.clientX;d.lastY=e.clientY;});
    const end=e=>{const d=this.drag;if(!d||d.id!==e.pointerId)return;clearTimeout(this.longPress);if(d.touch&&!d.moving&&!d.selecting){m.select(d.offset);this.focus();}this.drag=null;this.updateHandles();};
    this.host.addEventListener('pointerup',end);this.host.addEventListener('pointercancel',end);
    for(const role of ['start','end']){
      const handle=document.createElement('div');handle.className='selection-handle';handle.dataset.role=role;handle.hidden=true;this.host.append(handle);
      handle.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();handle.setPointerCapture(e.pointerId);handle.dragging=true;});
      handle.addEventListener('pointermove',e=>{if(!handle.dragging)return;const p=this.hit(e.clientX,e.clientY-this.r.lineHeight);m.select(role==='start'?p:m.start,role==='end'?p:m.end);});
      handle.addEventListener('pointerup',()=>{handle.dragging=false;this.focus();});
    }
  }
  updateHandles(){for(const h of this.host.querySelectorAll('.selection-handle')){const show=this.touchMode&&this.model.start!==this.model.end;h.hidden=!show;if(show){const p=this.caretRect(h.dataset.role==='start'?this.model.start:this.model.end);h.style.left=`${p.x}px`;h.style.top=`${p.y+this.r.lineHeight}px`;}}}
}
