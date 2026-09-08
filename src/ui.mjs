export const $ = (selector, root=document) => root.querySelector(selector);
export function escapeHTML(value) {return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function accessLabel(text){return escapeHTML(text).replace(/&amp;([^&])/,'<u>$1</u>');}
export function accessKey(text){return text.match(/&([^&])/)?.[1].toLowerCase();}
export class Dialogs {
  constructor(onFocus){this.stack=[];this.onFocus=onFocus;}
  open(title,html,{width=380,modeless=false,focus,onClose}={}){
    const shade=document.createElement('div');shade.className=`dialog-shade${modeless?' modeless':''}`;
    const el=document.createElement('section');el.className='xp-dialog';el.style.width=`${width}px`;el.setAttribute('role','dialog');el.setAttribute('aria-modal',String(!modeless));el.setAttribute('aria-label',title);
    el.innerHTML=`<header class="titlebar"><span>${escapeHTML(title)}</span><div class="window-controls"><button class="caption-button close" aria-label="Close dialog"><i></i></button></div></header><div class="dialog-content">${html}</div>`;
    shade.append(el);$('#dialog-layer').append(shade);let resolve;
    const dialog={el,shade,modeless,title,query:s=>$(s,el),promise:new Promise(r=>{resolve=r;}),closed:false};
    dialog.close=(value=null)=>{if(dialog.closed)return;dialog.closed=true;shade.remove();this.stack=this.stack.filter(d=>d!==dialog);this.updateModal();onClose?.(value);resolve(value);if(!this.stack.length)this.onFocus?.();else this.stack.at(-1).el.querySelector('input,button')?.focus({preventScroll:true});};
    $('.caption-button.close',el).onclick=()=>dialog.close();
    el.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dialog.close();}
      if(e.key==='Tab'){const list=[...el.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(x=>!x.hidden&&x.offsetParent!==null);const index=list.indexOf(document.activeElement);if(e.shiftKey&&index<=0){e.preventDefault();list.at(-1)?.focus();}else if(!e.shiftKey&&index===list.length-1){e.preventDefault();list[0]?.focus();}}
      if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'&&e.target.tagName!=='BUTTON'&&e.target.tagName!=='SELECT'){const button=$('.xp-button.default',el);if(button&&!button.disabled){e.preventDefault();button.click();}}
    });
    this.stack.push(dialog);this.updateModal();makeDraggable(el,$('.titlebar',el));
    queueMicrotask(()=>{const target=focus?$(focus,el):$('input:not([type=radio]):not([type=checkbox]),.xp-button.default,button',el);target?.focus({preventScroll:true});if(target?.tagName==='INPUT'&&target.type==='text')target.select();});return dialog;
  }
  updateModal(){const modal=this.stack.findLast(d=>!d.modeless);$('#window').inert=!!modal;for(const d of this.stack){d.el.inert=!!modal&&d!==modal&&this.stack.indexOf(d)<this.stack.indexOf(modal);}}
  async message(text,{title='Notepad',buttons=[['ok','OK']],icon='i',width=410}={}){
    const dialog=this.open(title,`<div class="message-layout"><span class="message-icon">${escapeHTML(icon)}</span><p>${escapeHTML(text)}</p></div><div class="dialog-actions">${buttons.map(([id,label],i)=>`<button class="xp-button ${i===0?'default':''}" data-result="${escapeHTML(id)}">${escapeHTML(label)}</button>`).join('')}</div>`,{width});
    for(const button of dialog.el.querySelectorAll('[data-result]'))button.onclick=()=>dialog.close(button.dataset.result);return dialog.promise;
  }
  closeAll(){for(const d of [...this.stack])d.close();}
}
export function makeDraggable(el,handle,{isWindow=false}={}){
  let drag=null;
  handle.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button')||(isWindow&&(el.classList.contains('maximized')||innerWidth<=600)))return;const r=el.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};handle.setPointerCapture(e.pointerId);el.style.position='absolute';el.style.left=`${r.left}px`;el.style.top=`${r.top}px`;el.style.transform='none';e.preventDefault();});
  handle.addEventListener('pointermove',e=>{if(!drag)return;el.style.left=`${Math.max(-el.offsetWidth+70,Math.min(innerWidth-70,drag.left+e.clientX-drag.x))}px`;el.style.top=`${Math.max(0,Math.min(innerHeight-30,drag.top+e.clientY-drag.y))}px`;});
  handle.addEventListener('pointerup',()=>{drag=null;});handle.addEventListener('pointercancel',()=>{drag=null;});
}
export class MenuBar {
  constructor(definitions,onCommand,enabled,checked){this.definitions=definitions;this.onCommand=onCommand;this.enabled=enabled;this.checked=checked;this.current=-1;this.popup=null;
    definitions.forEach((def,index)=>{const button=document.createElement('button');button.innerHTML=accessLabel(def.label);button.setAttribute('role','menuitem');button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.tabIndex=-1;button.onclick=e=>{e.stopPropagation();if(this.current===index)this.close();else this.open(index);};button.onpointerenter=()=>{if(this.current!==-1&&this.current!==index)this.open(index);};$('#menubar').append(button);});
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('.popup-menu')&&!e.target.closest('#menubar'))this.close();});
    document.addEventListener('keydown',e=>this.keydown(e),true);
  }
  close(focus=false){this.popup?.remove();this.popup=null;this.current=-1;for(const b of $('#menubar').children){b.classList.remove('open');b.setAttribute('aria-expanded','false');}if(focus)this.onCommand('focus');}
  open(index){this.close();this.current=index;const button=$('#menubar').children[index];button.classList.add('open');button.setAttribute('aria-expanded','true');const r=button.getBoundingClientRect();this.show(this.definitions[index].items,r.left,r.bottom,index);}
  show(items,x,y,index=-2){this.popup?.remove();this.current=index;const menu=document.createElement('div');menu.className='popup-menu';menu.setAttribute('role','menu');
    for(const item of items){if(!item){menu.append(document.createElement('hr'));continue;}const [label,command,shortcut]=item;const b=document.createElement('button');b.innerHTML=`<span>${accessLabel(label)}</span>${shortcut?`<span class="shortcut">${escapeHTML(shortcut)}</span>`:''}`;b.dataset.command=command;b.dataset.access=accessKey(label)||'';b.setAttribute('role','menuitem');b.disabled=!this.enabled(command);if(this.checked(command)){b.classList.add('checked');b.setAttribute('role','menuitemcheckbox');b.setAttribute('aria-checked','true');}b.onclick=()=>{this.close();this.onCommand(command);};menu.append(b);}
    $('#menu-layer').append(menu);this.popup=menu;menu.style.left=`${Math.max(0,Math.min(x,innerWidth-menu.offsetWidth-2))}px`;menu.style.top=`${Math.max(0,Math.min(y,innerHeight-menu.offsetHeight-2))}px`;
  }
  keydown(e){
    if($('#dialog-layer').querySelector('.dialog-shade:not(.modeless)'))return;
    if(e.key==='Alt'){document.body.classList.add('show-access');return;}
    if(e.altKey&&!e.ctrlKey&&!e.metaKey){const i=this.definitions.findIndex(d=>accessKey(d.label)===e.key.toLowerCase());if(i!==-1){e.preventDefault();e.stopPropagation();this.open(i);this.popup.querySelector('button:not(:disabled)')?.focus();return;}}
    if(e.key==='F10'&&!e.shiftKey){e.preventDefault();this.open(0);this.popup.querySelector('button:not(:disabled)')?.focus();return;}
    if(!this.popup)return;
    const buttons=[...this.popup.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close(true);}
    else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();const step=e.key==='ArrowDown'?1:-1;buttons[(index+step+buttons.length)%buttons.length]?.focus();}
    else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&this.current>=0){e.preventDefault();e.stopPropagation();this.open((this.current+(e.key==='ArrowRight'?1:-1)+this.definitions.length)%this.definitions.length);this.popup.querySelector('button:not(:disabled)')?.focus();}
    else if(e.key==='Home'||e.key==='End'){e.preventDefault();(e.key==='Home'?buttons[0]:buttons.at(-1))?.focus();}
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){const button=buttons.find(b=>b.dataset.access===e.key.toLowerCase());if(button){e.preventDefault();e.stopPropagation();button.click();}}
  }
}
export function wireScrollbar(element,view,vertical){
  const track=$('.scroll-track',element),thumb=$('.scroll-thumb',element);let drag=null,timer=null;
  const dimension=()=>vertical?track.clientHeight:track.clientWidth;
  const extent=()=>vertical?view.height:view.width;
  const viewport=()=>vertical?view.r.height:view.r.width;
  const current=()=>vertical?view.scrollY:view.scrollX;
  const set=value=>{if(vertical)view.scrollY=value;else view.scrollX=value;view.clamp();view.schedule();};
  const scroll=direction=>view.scroll(vertical?0:direction*view.r.advance*3,vertical?direction*view.r.lineHeight:0);
  for(const [i,button] of [...element.querySelectorAll('.scroll-arrow')].entries())button.addEventListener('pointerdown',e=>{e.preventDefault();const dir=i?1:-1;scroll(dir);clearTimeout(timer);timer=setTimeout(()=>{timer=setInterval(()=>scroll(dir),45);},350);});
  const stop=()=>{clearTimeout(timer);clearInterval(timer);timer=null;drag=null;};document.addEventListener('pointerup',stop);document.addEventListener('pointercancel',stop);
  thumb.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();drag={position:vertical?e.clientY:e.clientX,start:current()};thumb.setPointerCapture(e.pointerId);});
  thumb.addEventListener('pointermove',e=>{if(!drag)return;const size=vertical?thumb.offsetHeight:thumb.offsetWidth,travel=dimension()-size;if(travel>0)set(drag.start+((vertical?e.clientY:e.clientX)-drag.position)/travel*Math.max(0,extent()-viewport()));});
  track.addEventListener('pointerdown',e=>{if(e.target.closest('.scroll-thumb'))return;const r=thumb.getBoundingClientRect(),before=vertical?e.clientY<r.top:e.clientX<r.left;set(current()+(before?-1:1)*viewport()*.9);});
  return ()=>{const total=extent(),visible=viewport(),trackSize=dimension(),disabled=total<=visible+.5;const size=Math.max(17,Math.min(trackSize,trackSize*visible/Math.max(total,1))),position=disabled?0:(trackSize-size)*current()/(total-visible);element.classList.toggle('disabled',disabled);thumb.style[vertical?'height':'width']=`${size}px`;thumb.style[vertical?'top':'left']=`${position}px`;element.setAttribute('aria-valuemin','0');element.setAttribute('aria-valuemax',String(Math.max(0,Math.round(total-visible))));element.setAttribute('aria-valuenow',String(Math.round(current())));};
}
export class BrowserFiles {
  constructor(){this.memory=new Map();this.dbPromise=null;}
  async db(){if(!this.dbPromise)this.dbPromise=new Promise(resolve=>{try{const r=indexedDB.open('NotepadXP-documents',1);r.onupgradeneeded=()=>{r.result.createObjectStore('files',{keyPath:'path'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);}catch{resolve(null);}});return this.dbPromise;}
  async all(){const db=await this.db();if(!db)return [...this.memory.values()];return new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async put(record){const db=await this.db();if(!db){this.memory.set(record.path,record);return;}await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  async remove(path){const db=await this.db();if(!db){this.memory.delete(path);return;}await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(path);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
}
