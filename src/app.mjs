import * as Rope from './rope.mjs';
import {TextModel} from './model.mjs';
import {TextRenderer} from './renderer.mjs';
import {EditorView} from './editor.mjs';
import {WorkerClient} from './worker-client.mjs';
import {ENCODINGS,CODEPAGES,decodeBytes,encodedBlob} from './encoding.mjs';
import {$,escapeHTML,Dialogs,MenuBar,makeDraggable,wireScrollbar,BrowserFiles} from './ui.mjs';
import {DEFAULT_PAGE,validatePage,preparePrint} from './printing.mjs';
import {TOOLS,READ_ONLY_TOOLS,validateArguments} from './tools.mjs';
const MENUS=[
 {label:'&File',items:[['&New','new','Ctrl+N'],['&Open…','open','Ctrl+O'],['&Save','save','Ctrl+S'],['Save &As…','saveAs'],null,['Page Set&up…','pageSetup'],['&Print…','print','Ctrl+P'],null,['E&xit','exit']]},
 {label:'&Edit',items:[['&Undo','undo','Ctrl+Z'],null,['Cu&t','cut','Ctrl+X'],['&Copy','copy','Ctrl+C'],['&Paste','paste','Ctrl+V'],['De&lete','delete','Del'],null,['&Find…','find','Ctrl+F'],['Find &Next','findNext','F3'],['&Replace…','replace','Ctrl+H'],['&Go To…','goto','Ctrl+G'],null,['Select &All','selectAll','Ctrl+A'],['Time/&Date','timeDate','F5']]},
 {label:'F&ormat',items:[['&Word Wrap','wordWrap'],['&Font…','font']]},
 {label:'&View',items:[['&Status Bar','statusBar']]},
 {label:'&Help',items:[['&Help Topics','help'],null,['&About Notepad','about'],null,['AI A&gent Control…','agent','Ctrl+Alt+M']]}
];
const FONT_FAMILIES=['Arial','Arial Black','Comic Sans MS','Courier New','Fixedsys','Georgia','Impact','Lucida Console','Lucida Sans Unicode','Microsoft Sans Serif','Tahoma','Terminal','Times New Roman','Trebuchet MS','Verdana'];
const FONT_STYLES=['Regular','Bold','Italic','Bold Italic'];
const FONT_SIZES=[8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72];
function timeDate(){const now=new Date();return`${now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})} ${now.toLocaleDateString()}`;}
function cleanName(name){name=String(name||'Untitled').trim();if(!name||/[\x00-\x1f\\/]/.test(name)||name.length>255)throw new Error('Please enter a valid file name (no slashes or control characters).');return name;}
// Small original vector icons; no extracted Windows artwork or font assets.
function placeIcon(kind){
  const folder='<path d="M3 8h10l3 3h13v17H3z" fill="#d49d27" stroke="#8c6b29"/><path d="M4 10h10l3 3h11v14H4z" fill="#ffdf78"/><path d="M2 15h28l-4 13H4z" fill="#f8cf64" stroke="#ba8a24"/><path d="M4 16h23" stroke="#fff4b8"/>';
  const monitor='<path d="M13 24h7v4h5v2H8v-2h5z" fill="#c1c1c5" stroke="#747889"/><rect x="3" y="3" width="26" height="21" rx="2" fill="#dddfe8" stroke="#737989"/><rect x="5" y="5" width="22" height="16" fill="#3985d4"/><path d="M5 16q7-9 13-3t9-1v9H5z" fill="#57a038"/><path d="M6 7h20" stroke="#91c8ff"/><circle cx="25" cy="22" r=".8" fill="#39871a"/>';
  const paper='<path d="M8 2h15l5 5v22H8z" fill="#fafcff" stroke="#7890ab"/><path d="M23 2v6h5" fill="#d0e6f8" stroke="#7890ab"/><path d="M11 11h13m-13 4h13m-13 4h10m-10 4h10" stroke="#8ba8cb"/>';
  const body=kind==='desktop'?monitor:kind==='computer'?'<rect x="1" y="5" width="10" height="24" fill="#e5e6e9" stroke="#737989"/><path d="M3 9h6m-6 3h6m-6 3h6" stroke="#838991"/><circle cx="6" cy="24" r="1" fill="#54a53d"/><g transform="translate(8 2) scale(.8)">'+monitor+'</g>':kind==='recent'?paper+'<circle cx="9" cy="23" r="8" fill="#f3f7ff" stroke="#777faf" stroke-width="2"/><path d="M9 18v5l4 2" fill="none" stroke="#566590" stroke-width="1.5"/>':kind==='documents'?folder+'<g transform="translate(4 0) scale(.65)">'+paper+'</g>':folder;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="27" height="27" aria-hidden="true">${body}</svg>`;
}
function encodingOptions(includeAuto=false){return`${includeAuto?'<option value="auto">Auto-detect</option>':''}${ENCODINGS.map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}`;}
function base64Bytes(bytes){let output='';for(let i=0;i<bytes.length;i+=24576)output+=btoa(String.fromCharCode(...bytes.subarray(i,i+24576)));return output;}
function bytesFromBase64(data){if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw new Error('Invalid base64');const raw=atob(data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
class NotepadApp {
  constructor(){
    let stored={};try{stored=JSON.parse(localStorage.getItem('NotepadXP-settings')||'{}');}catch{}
    this.options={wordWrap:false,statusBar:false,fontFamily:'Lucida Console',fontSize:10,fontStyle:'Regular',codepage:'windows-1252',...stored};
    if(!Number.isFinite(this.options.fontSize)||this.options.fontSize<1||this.options.fontSize>200)this.options.fontSize=10;
    if(typeof this.options.fontFamily!=='string')this.options.fontFamily='Lucida Console';if(!FONT_STYLES.includes(this.options.fontStyle))this.options.fontStyle='Regular';if(!CODEPAGES.includes(this.options.codepage))this.options.codepage='windows-1252';
    this.page={...DEFAULT_PAGE};this.name='Untitled';this.encoding='ansi';this.eol='CRLF';this.bom=true;this.fileHandle=null;this.writableHandle=false;this.virtualPath=null;
    this.model=new TextModel();this.worker=new WorkerClient(this.model);this.renderer=new TextRenderer($('#gpu-canvas'),$('#fallback-canvas'));
    this.renderer.setFont(this.options.fontFamily,this.options.fontSize,this.options.fontStyle);
    this.view=new EditorView(this.model,this.renderer,$('#editor'),$('#text-input'),this.worker);
    this.dialogs=new Dialogs(()=>this.view.focus());this.files=new BrowserFiles();this.menu=new MenuBar(MENUS,c=>this.run(c),c=>this.enabled(c),c=>this.checked(c));
    this.search={query:'',replacement:'',matchCase:false,direction:'down'};this.findDialog=null;this.busyCount=0;this.log=[];this.tabId=crypto.randomUUID?.()||Math.random().toString(36).slice(2);
    this.agentEnabled=false;this.agentReadOnly=false;this.agentAbort=null;this.agentToken='';
    try{const fragment=new URLSearchParams(location.hash.slice(1));this.agentToken=fragment.get('token')||sessionStorage.getItem('NotepadXP-bridge-token')||'';if(fragment.has('token')){sessionStorage.setItem('NotepadXP-bridge-token',this.agentToken);history.replaceState(null,'',location.pathname+location.search);}}catch{}
    this.view.onCommand=c=>this.run(c);this.view.onError=e=>this.error(e);this.view.onContextMenu=(x,y)=>{this.menu.close();this.menu.show([['&Undo','undo'],null,['Cu&t','cut'],['&Copy','copy'],['&Paste','paste'],['&Delete','delete'],null,['Select &All','selectAll']],x,y);};
    const v=wireScrollbar($('#vscroll'),this.view,true),h=wireScrollbar($('#hscroll'),this.view,false);this.view.onScroll=()=>{v();h();};
    this.model.onChange(e=>{this.updateTitle();this.updateStatus();if(this.agentEnabled&&!['selection','saved'].includes(e.type))this.pushAgentState();});
    this.bindWindow();this.bindKeys();this.bindFiles();this.applyOptions();this.updateTitle();
    this.renderer.onInvalidate=()=>this.view.schedule();this.ready=this.renderer.init().then(()=>{this.view.resize();this.view.focus();return this.state();});
    window.addEventListener('beforeunload',e=>{if(this.model.dirty){e.preventDefault();e.returnValue='';}});
  }
  async run(command){try{return await this.command(command);}catch(error){await this.error(error);return false;}}
  async error(error){console.error(error);return this.dialogs.message(error?.message||String(error),{icon:'!'});}
  async busy(label,fn){this.busyCount++;$('#busy-label').textContent=label;$('#busy').hidden=false;try{return await fn();}finally{this.busyCount--;$('#busy').hidden=this.busyCount===0;}}
  updateTitle(){const title=`${this.name} - Notepad`;$('#title').textContent=title;document.title=title;$('#restore-window span').textContent=title;}
  updateStatus(){const p=this.model.positionAt();$('#status-position').textContent=`Ln ${(p.line+1).toLocaleString()}, Col ${(p.column+1).toLocaleString()}`;}
  applyOptions(){const o=this.options;this.renderer.setFont(o.fontFamily,o.fontSize,o.fontStyle);this.view.rowCache.clear();this.view.setWrap(o.wordWrap);$('#editor-frame').classList.toggle('wrapped',!!o.wordWrap);$('#hscroll').hidden=!!o.wordWrap;$('#scroll-corner').hidden=!!o.wordWrap;$('#statusbar').hidden=!!o.wordWrap||!o.statusBar;this.view.resize();try{localStorage.setItem('NotepadXP-settings',JSON.stringify(o));}catch{}this.updateStatus();}
  checked(c){return c==='wordWrap'?this.options.wordWrap:c==='statusBar'?this.options.statusBar:false;}
  enabled(c){const selection=this.model.start!==this.model.end;if(c==='undo')return !!this.model.undoStack.length;if(c==='redo')return !!this.model.redoStack.length;if(['cut','copy','delete'].includes(c))return selection;if(['goto','statusBar'].includes(c))return !this.options.wordWrap;if(['find','findNext'].includes(c))return this.model.length>0;return true;}
  async command(command){
    if(!this.enabled(command)&&!['focus','restore'].includes(command))return false;
    switch(command){
      case'focus':this.view.focus();return true;
      case'new':if(await this.confirmDiscard()){this.newDocument();return true;}return false;
      case'open':if(await this.confirmDiscard())return this.fileDialog(false);return false;
      case'save':return this.save();case'saveAs':return this.fileDialog(true);
      case'pageSetup':return this.pageSetupDialog();case'print':return this.print();
      case'exit':if(await this.confirmDiscard())this.exit();return true;
      case'undo':this.model.undo();this.view.focus();return true;case'redo':this.model.redo();this.view.focus();return true;
      case'cut':return this.copy(true);case'copy':return this.copy(false);case'paste':return this.paste();
      case'delete':this.model.insert('');this.view.focus();return true;
      case'find':this.showFind(false);return true;case'replace':this.showFind(true);return true;
      case'findNext':if(!this.search.query){this.showFind(false);return true;}return this.findNext(true);
      case'goto':return this.gotoDialog();case'selectAll':this.model.select(0,this.model.length);this.view.focus();return true;
      case'timeDate':this.model.insert(timeDate());this.view.focus();return true;
      case'wordWrap':this.options.wordWrap=!this.options.wordWrap;this.applyOptions();this.view.focus();return true;
      case'font':return this.fontDialog();case'statusBar':this.options.statusBar=!this.options.statusBar;this.applyOptions();this.view.focus();return true;
      case'help':return this.helpDialog();case'about':return this.aboutDialog();case'agent':return this.agentDialog();
      case'minimize':$('#window').hidden=true;$('#restore-window').hidden=false;return true;
      case'maximize':this.toggleMaximize();return true;
      case'restore':if(!$('#window').hidden&&$('#window').classList.contains('maximized'))this.toggleMaximize();$('#window').hidden=false;$('#restore-window').hidden=true;$('.closed-message')?.remove();this.view.resize();this.view.focus();return true;
      default:throw new Error(`Unknown command: ${command}`);
    }
  }
  async confirmDiscard(){if(!this.model.dirty)return true;const result=await this.dialogs.message(`The text in the ${this.name} file has changed.\n\nDo you want to save the changes?`,{buttons:[['yes','Yes'],['no','No'],['cancel','Cancel']],icon:'?',width:410});if(result==='yes')return !!(await this.save());return result==='no';}
  newDocument(){this.findDialog?.close();this.name='Untitled';this.encoding='ansi';this.eol='CRLF';this.bom=true;this.fileHandle=null;this.writableHandle=false;this.virtualPath=null;this.view.scrollX=this.view.scrollY=0;this.model.load(null);this.view.focus();}
  exit(){this.dialogs.closeAll();this.menu.close();$('#window').hidden=true;$('#restore-window').hidden=true;const panel=document.createElement('section');panel.className='closed-message';panel.innerHTML='<img src="assets/notepad.svg" alt=""><p>Notepad is closed.</p><button class="xp-button default">Open Notepad</button>';panel.querySelector('button').onclick=()=>{this.newDocument();this.run('restore');};document.body.append(panel);}
  toggleMaximize(){const el=$('#window');el.classList.toggle('maximized');$('#maximize').title=el.classList.contains('maximized')?'Restore Down':'Maximize';$('#maximize').setAttribute('aria-label',$('#maximize').title);this.view.resize();}
  bindWindow(){makeDraggable($('#window'),$('#titlebar'),{isWindow:true});$('#titlebar').ondblclick=e=>{if(!e.target.closest('button'))this.toggleMaximize();};$('#minimize').onclick=()=>this.run('minimize');$('#maximize').onclick=()=>this.run('maximize');$('#close-window').onclick=()=>this.run('exit');$('#restore-window').onclick=()=>this.run('restore');
    $('.app-icon').onclick=e=>{e.stopPropagation();this.systemMenu();};
    let resize=null;const grip=$('#resize-grip');grip.onpointerdown=e=>{const r=$('#window').getBoundingClientRect();resize={x:e.clientX,y:e.clientY,width:r.width,height:r.height};$('#window').style.left=`${r.left}px`;$('#window').style.top=`${r.top}px`;$('#window').style.transform='none';grip.setPointerCapture(e.pointerId);e.preventDefault();};grip.onpointermove=e=>{if(!resize)return;$('#window').style.width=`${Math.max(245,resize.width+e.clientX-resize.x)}px`;$('#window').style.height=`${Math.max(170,resize.height+e.clientY-resize.y)}px`;};grip.onpointerup=()=>{resize=null;};
    window.addEventListener('resize',()=>this.view.resize());visualViewport?.addEventListener('resize',()=>{if(innerWidth<=600){$('#window').style.height=`${visualViewport.height}px`;this.view.resize();}});
  }
  systemMenu(){const r=$('#titlebar').getBoundingClientRect();this.menu.close();this.menu.show([['&Restore','restore'],['Mi&nimize','minimize'],['Ma&ximize','maximize'],null,['&Close','exit','Alt+F4']],r.left,r.bottom);}
  bindKeys(){document.addEventListener('keydown',e=>{
    const ctrl=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();if(e.ctrlKey&&e.altKey&&key==='m'){e.preventDefault();this.agentDialog();return;}
    if(e.altKey&&e.key===' '){e.preventDefault();this.systemMenu();return;}
    if(e.target.closest('.xp-dialog')||this.menu.popup)return;
    let command=null;
    if(ctrl&&!e.altKey){command={n:'new',o:'open',s:e.shiftKey?'saveAs':'save',p:'print',a:'selectAll',f:'find',h:'replace',g:'goto',z:e.shiftKey?'redo':'undo',y:'redo'}[key];}
    else if(e.key==='F3'){if(e.shiftKey){this.search.direction=this.search.direction==='down'?'up':'down';}command='findNext';}
    else if(e.key==='F5')command='timeDate';else if(e.key==='F1')command='help';else if(e.altKey&&e.key==='F4')command='exit';else if(e.shiftKey&&e.key==='F10'){const p=this.view.caretRect(),r=$('#editor').getBoundingClientRect();this.view.onContextMenu(r.left+p.x,r.top+p.y+this.renderer.lineHeight);e.preventDefault();}
    if(command){e.preventDefault();this.run(command);}
  });}
  bindFiles(){const win=$('#window');win.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';win.classList.add('drop-target');}});win.addEventListener('dragleave',e=>{if(!win.contains(e.relatedTarget))win.classList.remove('drop-target');});win.addEventListener('drop',async e=>{e.preventDefault();win.classList.remove('drop-target');const file=e.dataTransfer.files[0];if(file&&await this.confirmDiscard())try{await this.openFile(file);}catch(error){this.error(error);}});}
  async openFile(file,{encoding='auto',handle=null,path=null}={}){
    if(file.size>512*1024*1024){const result=await this.dialogs.message('This file is larger than 512 MiB and may exceed the memory available to this browser. Continue?',{buttons:[['yes','Yes'],['no','No']],icon:'?'});if(result!=='yes')return false;}
    const revision=this.model.revision;
    const result=await this.busy('Opening file…',()=>this.worker.request('open',{file,encoding,codepage:this.options.codepage}));
    const writable=!!handle&&await handle.queryPermission?.({mode:'readwrite'})==='granted';
    if(revision!==this.model.revision)throw new Error('The document changed while the file was opening. Your edits were not overwritten.');
    this.name=cleanName(file.name||'Untitled.txt');this.encoding=result.encoding;this.eol=result.eol;this.bom=result.bom;this.fileHandle=handle;this.writableHandle=writable;this.virtualPath=path;this.view.scrollX=this.view.scrollY=0;this.model.load(result.root);
    if(this.model.slice(0,5).split('\n')[0]==='.LOG'){this.model.select(this.model.length);this.model.insert(`\n${timeDate()}\n`);}
    this.updateTitle();this.view.focus();return true;
  }
  async save(){
    if(this.fileHandle){
      let permission=await this.fileHandle.queryPermission?.({mode:'readwrite'});
      if(permission!=='granted')permission=await this.fileHandle.requestPermission?.({mode:'readwrite'});
      this.writableHandle=permission==='granted';
      if(!this.writableHandle)throw new Error('Write permission was not granted. Use Save As to save a separate copy.');
      return this.writeSnapshot(this.model.root,this.name,this.encoding,this.fileHandle,this.virtualPath);
    }
    return this.fileDialog(true);
  }
  async writeSnapshot(root,name,encoding,handle=null,path=null){
    const options={eol:this.eol,bom:encoding!=='ansi',codepage:this.options.codepage};
    const {blob}=await this.busy('Saving file…',()=>this.worker.request('encode',{root,encoding,options}));
    if(handle){const writable=await handle.createWritable();try{await writable.write(blob);await writable.close();}catch(error){try{await writable.abort();}catch{}throw error;}}
    else {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    this.name=name;this.encoding=encoding;this.bom=encoding!=='ansi';this.fileHandle=handle;this.writableHandle=!!handle;this.virtualPath=path||`/My Documents/${name}`;this.model.markSaved(root);this.updateTitle();
    try{await this.files.put({path:this.virtualPath,name,blob,modified:Date.now(),folder:false});}catch(error){await this.dialogs.message('The file was saved, but the browser could not retain a copy in Browser Documents.\n\n'+error.message);}
    return true;
  }
  async fileDialog(save){
    const existing=this.dialogs.stack.find(d=>d.title===(save?'Save As':'Open'));if(existing)return existing.promise;
    let folder='/My Documents',selected=null,pendingFile=null,pendingHandle=null;
    const dialog=this.dialogs.open(save?'Save As':'Open',`<div class="file-toolbar"><label for="file-location">${save?'Save in:':'Look in:'}</label><select id="file-location"><option>/My Documents</option><option>/Desktop</option><option>/Recent Documents</option></select><button class="small-tool" data-action="up" title="Up One Level" aria-label="Up One Level">↰</button><button class="small-tool" data-action="folder" title="Create New Folder" aria-label="Create New Folder">▣</button><button class="xp-button" data-action="browse">Browse…</button></div><div class="file-main"><aside class="places"><button data-place="/Recent Documents"><span class="place-icon">${placeIcon('recent')}</span>My Recent<br>Documents</button><button data-place="/Desktop"><span class="place-icon">${placeIcon('desktop')}</span>Desktop</button><button data-place="/My Documents" class="selected"><span class="place-icon">${placeIcon('documents')}</span>My Documents</button><button data-place="browse"><span class="place-icon">${placeIcon('computer')}</span>My Computer</button></aside><div class="file-list" role="listbox" aria-label="Files"></div></div><div class="file-bottom"><div><div class="field"><label for="file-name">File name:</label><input id="file-name" type="text" autocomplete="off"></div><div class="field"><label for="file-type">${save?'Save as type:':'Files of type:'}</label><select id="file-type"><option value="text">Text Documents (*.txt)</option><option value="all">All Files</option></select></div><div class="field"><label for="file-encoding">Encoding:</label><select id="file-encoding">${encodingOptions(!save)}</select></div></div><div class="file-buttons"><button class="xp-button default" data-action="confirm">${save?'Save':'Open'}</button><button class="xp-button" data-action="cancel">Cancel</button></div></div><p class="file-note">Folders shown here are browser storage. Browse opens files on your device.</p>`,{width:560,focus:'#file-name'});
    dialog.query('#file-name').value=save?(this.name==='Untitled'?'*.txt':this.name):'';dialog.query('#file-encoding').value=save?this.encoding:'auto';
    const navigate=async path=>{folder=path;selected=null;pendingFile=null;pendingHandle=null;const select=dialog.query('#file-location');if(![...select.options].some(o=>o.value===path))select.add(new Option(path,path));select.value=path;for(const b of dialog.el.querySelectorAll('[data-place]'))b.classList.toggle('selected',b.dataset.place===path);await refresh();};
    const refresh=async()=>{const all=await this.files.all();const list=dialog.query('.file-list');if(dialog.closed)return;list.replaceChildren();let records=folder==='/Recent Documents'?all.filter(r=>!r.folder).sort((a,b)=>b.modified-a.modified).slice(0,30):all.filter(r=>r.path.slice(0,r.path.lastIndexOf('/'))===folder);if(dialog.query('#file-type').value==='text')records=records.filter(r=>r.folder||/\.txt$/i.test(r.name));
      for(const record of records){const button=document.createElement('button');button.className='file-item';button.setAttribute('role','option');button.innerHTML=`${record.folder?'<span>▰</span>':'<img src="assets/notepad.svg" alt="">'}<span>${escapeHTML(record.name)}</span>`;button.title=record.name;button.onclick=()=>{selected=record;pendingFile=null;pendingHandle=null;for(const b of list.children)b.classList.remove('selected');button.classList.add('selected');if(!record.folder)dialog.query('#file-name').value=record.name;};button.ondblclick=()=>record.folder?navigate(record.path):confirm();list.append(button);}
      if(!records.length)list.innerHTML='<div class="empty-folder">No documents in this folder.<br>Choose Browse to open a file from your device.</div>';
    };
    const choose=async()=>{
      try{
        pendingFile=null;pendingHandle=null;
        if(window.showOpenFilePicker){try{const [handle]=await showOpenFilePicker({multiple:false,types:[{description:'Text Documents',accept:{'text/plain':['.txt','.log','.ini','.csv','.md']}}],excludeAcceptAllOption:false});pendingHandle=handle;pendingFile=await handle.getFile();}catch(error){if(!['SecurityError','NotSupportedError'].includes(error.name))throw error;}}
        if(!pendingFile){pendingFile=await new Promise(resolve=>{const input=$('#file-input');input.value='';input.onchange=()=>resolve(input.files[0]||null);input.oncancel=()=>resolve(null);input.click();});pendingHandle=null;}
        if(!pendingFile)return;dialog.query('#file-name').value=pendingFile.name;selected=null;dialog.query('.file-list').innerHTML=`<button class="file-item selected"><img src="assets/notepad.svg" alt=""><span>${escapeHTML(pendingFile.name)}</span></button>`;dialog.query('.file-item').ondblclick=confirm;
      }catch(error){if(error.name!=='AbortError')this.error(error);}
    };
    const confirm=async()=>{
      try{
        if(save){let name=dialog.query('#file-name').value.trim();if(name==='*.txt'||!name){dialog.query('#file-name').focus();dialog.query('#file-name').select();return;}
          const quoted=name.startsWith('"')&&name.endsWith('"');if(quoted)name=name.slice(1,-1);name=cleanName(name);if(!quoted&&dialog.query('#file-type').value==='text'&&!name.includes('.'))name+='.txt';
          const encoding=dialog.query('#file-encoding').value,root=this.model.root;let handle=null;
          if(window.showSaveFilePicker){try{handle=await showSaveFilePicker({suggestedName:name,types:[{description:'Text Documents',accept:{'text/plain':['.txt']}}],excludeAcceptAllOption:false});name=handle.name||name;}catch(error){if(error.name==='AbortError')return;if(!['SecurityError','NotSupportedError'].includes(error.name))throw error;}}
          if(!handle){const all=await this.files.all();if(all.some(f=>f.path===`${folder}/${name}`)){const result=await this.dialogs.message(`${name} already exists.\nDo you want to replace it?`,{title:'Confirm Save As',buttons:[['yes','Yes'],['no','No']],icon:'?'});if(result!=='yes')return;}}
          await this.writeSnapshot(root,name,encoding,handle,`${folder==='/Recent Documents'?'/My Documents':folder}/${name}`);dialog.close(true);
        }else{
          if(selected?.folder){await navigate(selected.path);return;}
          if(!pendingFile){const name=dialog.query('#file-name').value;selected=selected||(await this.files.all()).find(r=>!r.folder&&r.path===`${folder}/${name}`);if(selected?.blob)pendingFile=new File([selected.blob],selected.name,{lastModified:selected.modified});}
          if(!pendingFile){await this.dialogs.message('File not found.\nCheck the file name, or choose Browse to open a file from your device.');return;}
          const success=await this.openFile(pendingFile,{encoding:dialog.query('#file-encoding').value,handle:pendingHandle,path:selected?.path||null});if(success)dialog.close(true);
        }
      }catch(error){if(error.name!=='AbortError')this.error(error);}
    };
    dialog.query('[data-action="confirm"]').onclick=confirm;dialog.query('[data-action="cancel"]').onclick=()=>dialog.close(false);dialog.query('[data-action="browse"]').onclick=choose;
    dialog.query('#file-location').onchange=e=>navigate(e.target.value);dialog.query('#file-type').onchange=refresh;for(const b of dialog.el.querySelectorAll('[data-place]'))b.onclick=()=>b.dataset.place==='browse'?choose():navigate(b.dataset.place);
    dialog.query('[data-action="up"]').onclick=()=>navigate(folder.includes('/',1)?folder.slice(0,folder.lastIndexOf('/')):'/My Documents');
    dialog.query('[data-action="folder"]').onclick=()=>{const d=this.dialogs.open('New Folder','<div class="field"><label for="folder-name">Name:</label><input id="folder-name" type="text" value="New Folder"></div><div class="dialog-actions"><button class="xp-button default" data-action="ok">OK</button><button class="xp-button" data-action="cancel">Cancel</button></div>',{width:300,focus:'#folder-name'});d.query('[data-action="cancel"]').onclick=()=>d.close();d.query('[data-action="ok"]').onclick=async()=>{try{const name=cleanName(d.query('#folder-name').value);await this.files.put({path:`${folder}/${name}`,name,folder:true,modified:Date.now()});d.close();refresh();}catch(error){this.error(error);}};};
    await refresh();return dialog.promise;
  }
  async copy(cut=false){
    if(this.model.start===this.model.end)return false;const start=this.model.start,end=this.model.end,revision=this.model.revision,text=this.model.selectedText.replace(/\n/g,'\r\n');
    try{await navigator.clipboard.writeText(text);}catch{this.view.focus();if(!document.execCommand('copy')){await this.dialogs.message('Your browser did not allow clipboard access. Select the text and press Ctrl+C (or Command+C).');return false;}}
    if(cut&&revision===this.model.revision)this.model.edit(start,end,'');this.view.focus();return true;
  }
  async paste(){
    try{const text=await navigator.clipboard.readText();this.model.insert(text);this.view.focus();return true;}catch{
      const dialog=this.dialogs.open('Paste','<p>Your browser requires a paste gesture. Paste text below, then choose Paste.</p><textarea id="paste-text" rows="6" style="width:100%;resize:vertical" aria-label="Text to paste"></textarea><div class="dialog-actions"><button class="xp-button default" data-action="paste">Paste</button><button class="xp-button" data-action="cancel">Cancel</button></div>',{width:420,focus:'#paste-text'});
      dialog.query('[data-action="paste"]').onclick=()=>{this.model.insert(dialog.query('#paste-text').value);dialog.close(true);};dialog.query('[data-action="cancel"]').onclick=()=>dialog.close(false);return dialog.promise;
    }
  }
  showFind(replaceMode){
    if(this.findDialog&&!this.findDialog.closed&&this.findDialog.title===(replaceMode?'Replace':'Find')){this.findDialog.query('#find-query').focus();return;}
    this.findDialog?.close();
    const selection=this.model.end-this.model.start<=65536?this.model.selectedText:'';if(selection&&!selection.includes('\n'))this.search.query=selection;
    const dialog=this.dialogs.open(replaceMode?'Replace':'Find',`<div class="find-layout"><div class="find-fields"><div class="field"><label for="find-query">Find what:</label><input id="find-query" type="text"></div>${replaceMode?'<div class="field"><label for="replace-text">Replace with:</label><input id="replace-text" type="text"></div>':''}<div class="find-options"><label><input id="match-case" type="checkbox">Match case</label>${replaceMode?'':'<fieldset><legend>Direction</legend><label><input type="radio" name="direction" value="up">Up</label><label><input type="radio" name="direction" value="down">Down</label></fieldset>'}</div></div><div class="find-buttons"><button class="xp-button default" data-action="findNext">Find Next</button>${replaceMode?'<button class="xp-button" data-action="replace">Replace</button><button class="xp-button" data-action="replaceAll">Replace All</button>':''}<button class="xp-button" data-action="cancel">Cancel</button></div></div>`,{width:replaceMode?430:410,modeless:true,focus:'#find-query',onClose:()=>{if(this.findDialog===dialog)this.findDialog=null;}});
    this.findDialog=dialog;dialog.query('#find-query').value=this.search.query;dialog.query('#match-case').checked=this.search.matchCase;if(replaceMode)dialog.query('#replace-text').value=this.search.replacement;else dialog.query(`input[name="direction"][value="${this.search.direction}"]`).checked=true;
    const read=()=>{this.search.query=dialog.query('#find-query').value;this.search.matchCase=dialog.query('#match-case').checked;if(replaceMode){this.search.replacement=dialog.query('#replace-text').value;this.search.direction='down';}else this.search.direction=dialog.query('input[name="direction"]:checked').value;for(const b of dialog.el.querySelectorAll('[data-action="findNext"],[data-action="replace"],[data-action="replaceAll"]'))b.disabled=!this.search.query;};
    for(const input of dialog.el.querySelectorAll('input'))input.addEventListener('input',read);read();
    dialog.query('[data-action="findNext"]').onclick=()=>{read();this.findNext(true).catch(e=>this.error(e));};
    if(replaceMode){dialog.query('[data-action="replace"]').onclick=()=>{read();this.replaceCurrent(true).catch(e=>this.error(e));};dialog.query('[data-action="replaceAll"]').onclick=()=>{read();this.replaceAll().catch(e=>this.error(e));};}
    dialog.query('[data-action="cancel"]').onclick=()=>dialog.close();
  }
  async findNext(showFailure=false,options={}){
    const query=options.query??this.search.query;if(!query)return null;
    const direction=options.direction??this.search.direction,from=options.from??(direction==='up'?this.model.start:this.model.end),revision=this.model.revision;
    const result=await this.worker.request('find',{query:Rope.normalize(query),options:{direction,from,matchCase:options.matchCase??this.search.matchCase},revision});
    if(result.revision!==this.model.revision)throw new Error('The document changed during search. Try again.');
    if(result.match){if(options.select!==false){this.model.select(result.match.start,result.match.end);this.view.active=true;this.view.schedule();}return result.match;}
    if(showFailure)await this.dialogs.message(`Cannot find "${query}"`,{icon:'i',width:330});return null;
  }
  async replaceCurrent(showFailure=false){
    const{query,replacement,matchCase}=this.search;if(!query)return false;
    const selected=this.model.selectedText;const matches=matchCase?selected===query:new RegExp(`^${Rope.escapeRegex(query)}$`,'i').test(selected);
    if(matches)this.model.insert(replacement);return this.findNext(showFailure,{direction:'down'});
  }
  async replaceAll(options={}){
    const query=options.query??this.search.query,replacement=options.replacement??this.search.replacement;if(!query)return 0;const revision=this.model.revision;
    const result=await this.busy('Replacing text…',()=>this.worker.request('replaceAll',{query:Rope.normalize(query),replacement:Rope.normalize(replacement),options:{matchCase:options.matchCase??this.search.matchCase},revision}));
    if(result.revision!==this.model.revision)throw new Error('The document changed during replacement. Your edits were not overwritten.');
    if(result.count)this.model.replaceRoot(result.root);$('#live-region').textContent=`Replaced ${result.count.toLocaleString()} occurrence${result.count===1?'':'s'}.`;return result.count;
  }
  gotoDialog(){
    const dialog=this.dialogs.open('Go To Line','<label for="goto-line">Line number:</label><input id="goto-line" type="text" inputmode="numeric" style="display:block;width:100%;margin-top:5px"><div class="dialog-actions"><button class="xp-button default" data-action="go">Go To</button><button class="xp-button" data-action="cancel">Cancel</button></div>',{width:255,focus:'#goto-line'});
    dialog.query('#goto-line').value=this.model.positionAt().line+1;dialog.query('[data-action="cancel"]').onclick=()=>dialog.close();dialog.query('[data-action="go"]').onclick=async()=>{const line=Number(dialog.query('#goto-line').value);if(!Number.isInteger(line)||line<1||line>this.model.lineCount){await this.dialogs.message(`The line number is beyond the total number of lines.\nEnter a number from 1 to ${this.model.lineCount.toLocaleString()}.`,{icon:'!'});return;}this.model.select(this.model.lineStart(line-1));dialog.close(true);};return dialog.promise;
  }
  fontDialog(){
    const dialog=this.dialogs.open('Font',`<div class="font-lists"><div class="font-col"><label for="font-family">Font:</label><input id="font-family" type="text"><select id="font-family-list" size="7" aria-label="Font list">${FONT_FAMILIES.map(f=>`<option>${f}</option>`).join('')}</select></div><div class="font-col"><label for="font-style">Font style:</label><input id="font-style" type="text"><select id="font-style-list" size="7" aria-label="Font style list">${FONT_STYLES.map(f=>`<option>${f}</option>`).join('')}</select></div><div class="font-col"><label for="font-size">Size:</label><input id="font-size" type="text" inputmode="decimal"><select id="font-size-list" size="7" aria-label="Font size list">${FONT_SIZES.map(f=>`<option>${f}</option>`).join('')}</select></div></div><div class="font-bottom"><div><fieldset><legend>Sample</legend><div class="font-sample">AaBbYyZz</div></fieldset><div class="field" style="margin-top:13px"><label for="font-script" style="min-width:36px">Script:</label><select id="font-script"><option>Western</option><option>Central European</option><option>Cyrillic</option><option>Greek</option><option>Hebrew</option><option>Arabic</option><option>Japanese</option></select></div></div><div class="font-actions"><button class="xp-button default" data-action="ok">OK</button><button class="xp-button" data-action="cancel">Cancel</button></div></div>`,{width:435,focus:'#font-family'});
    for(const [id,value] of [['font-family',this.options.fontFamily],['font-style',this.options.fontStyle],['font-size',this.options.fontSize]]){dialog.query(`#${id}`).value=value;dialog.query(`#${id}-list`).value=value;dialog.query(`#${id}-list`).onchange=e=>{dialog.query(`#${id}`).value=e.target.value;sample();};dialog.query(`#${id}`).oninput=()=>sample();}
    const sample=()=>{const family=dialog.query('#font-family').value.replace(/["\\;]/g,''),style=dialog.query('#font-style').value,size=Number(dialog.query('#font-size').value)||10;const preview=dialog.query('.font-sample');preview.style.fontFamily=`"${family}",monospace`;preview.style.fontSize=`${Math.min(100,Math.max(1,size))}pt`;preview.style.fontStyle=style.includes('Italic')?'italic':'normal';preview.style.fontWeight=style.includes('Bold')?'bold':'normal';preview.textContent={Western:'AaBbYyZz','Central European':'ĄąĆćŁłŽž',Cyrillic:'АаБбВвЯя',Greek:'ΑαΒβΩω',Hebrew:'אבגד שלום',Arabic:'مرحبا بالعالم',Japanese:'あいうえお漢字'}[dialog.query('#font-script').value];};
    dialog.query('#font-script').onchange=sample;sample();dialog.query('[data-action="cancel"]').onclick=()=>dialog.close(false);
    dialog.query('[data-action="ok"]').onclick=async()=>{const family=dialog.query('#font-family').value.trim(),size=Number(dialog.query('#font-size').value),style=dialog.query('#font-style').value;if(!family||family.length>100||!Number.isFinite(size)||size<1||size>200||!FONT_STYLES.includes(style)){await this.dialogs.message('Choose a font, a listed style, and a size between 1 and 200 points.',{icon:'!'});return;}Object.assign(this.options,{fontFamily:family,fontStyle:style,fontSize:size});this.applyOptions();dialog.close(true);};return dialog.promise;
  }
  pageSetupDialog(){
    const dialog=this.dialogs.open('Page Setup',`<div class="page-grid"><div><fieldset><legend>Paper</legend><div class="field"><label for="page-paper" style="min-width:42px">Size:</label><select id="page-paper"><option>Letter</option><option>A4</option><option>Legal</option><option>A5</option></select></div><div class="field" style="margin-bottom:0"><label for="page-source" style="min-width:42px">Source:</label><select id="page-source"><option>Automatically Select</option></select></div></fieldset><div style="display:flex;gap:12px;margin:12px 0"><fieldset><legend>Orientation</legend><label style="display:block;margin-bottom:7px"><input type="radio" name="orientation" value="Portrait">Portrait</label><label><input type="radio" name="orientation" value="Landscape">Landscape</label></fieldset><fieldset style="flex:1"><legend>Margins (inches)</legend><div class="margins-grid">${['left','right','top','bottom'].map(k=>`<label>${k[0].toUpperCase()+k.slice(1)}:<input id="page-${k}" type="text" inputmode="decimal" aria-label="${k} margin"></label>`).join('')}</div></fieldset></div></div><fieldset><legend>Preview</legend><div class="page-preview"><div class="paper-preview"><div class="paper-lines"></div></div></div></fieldset></div><div class="field"><label for="page-header" style="min-width:46px">Header:</label><input id="page-header" type="text"></div><div class="field"><label for="page-footer" style="min-width:46px">Footer:</label><input id="page-footer" type="text"></div><div class="dialog-actions"><button class="xp-button default" data-action="ok">OK</button><button class="xp-button" data-action="cancel">Cancel</button><button class="xp-button" data-action="help">Help</button></div>`,{width:535,focus:'#page-paper'});
    for(const key of ['paper','left','right','top','bottom','header','footer'])dialog.query(`#page-${key}`).value=this.page[key];dialog.query(`input[name="orientation"][value="${this.page.orientation}"]`).checked=true;
    const preview=()=>dialog.query('.paper-preview').classList.toggle('landscape',dialog.query('input[name="orientation"]:checked').value==='Landscape');for(const r of dialog.el.querySelectorAll('input[name="orientation"]'))r.onchange=preview;preview();
    dialog.query('[data-action="cancel"]').onclick=()=>dialog.close(false);dialog.query('[data-action="help"]').onclick=()=>this.dialogs.message('Header and footer commands:\n\n&f  File name    &p  Page number\n&d  Date             &t  Time\n&l  Align left       &c  Center\n&r  Align right     &&  Print an ampersand\n\nTurn off the browser’s own headers and footers in its print dialog to avoid duplicates.',{title:'Page Setup Help',width:430});
    dialog.query('[data-action="ok"]').onclick=async()=>{try{const page={...this.page};for(const key of ['paper','header','footer'])page[key]=dialog.query(`#page-${key}`).value;for(const key of ['left','right','top','bottom'])page[key]=Number(dialog.query(`#page-${key}`).value);page.orientation=dialog.query('input[name="orientation"]:checked').value;validatePage(page);this.page=page;dialog.close(true);}catch(error){this.error(error);}};return dialog.promise;
  }
  async print(){
    const frame=$('#print-frame');frame.hidden=false;frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    const result=await this.busy('Preparing pages…',()=>preparePrint(this.model,this.renderer,this.page,this.name,frame));this.lastPrint=result;frame.contentWindow.focus();frame.contentWindow.print();this.view.focus();return result;
  }
  aboutDialog(){
    const dialog=this.dialogs.open('About Notepad',`<div style="padding:5px 9px"><div class="about-header">Notepad <sup>xp</sup></div><div class="about-sub">Web edition</div><hr class="about-rule"><div class="about-layout"><img src="assets/notepad.svg" alt="Notepad"><div>Notepad XP Web Edition<br>Version 1.0.0<br><br>Windows XP Service Pack 3-style interface<br>Original HTML, JavaScript, and WebGPU implementation.<br><br>This application is not affiliated with Microsoft.<br>Windows and Notepad are Microsoft trademarks.</div></div><hr class="about-rule"><p>Renderer: <strong>${escapeHTML(this.renderer.mode)}</strong><br>Worker: ${this.worker.worker?'Active':'Main-thread fallback'} · Local files stay on your device.</p><div class="dialog-actions"><button class="xp-button default" data-action="ok">OK</button></div></div>`,{width:440});dialog.query('[data-action="ok"]').onclick=()=>dialog.close();return dialog.promise;
  }
  helpDialog(){
    const dialog=this.dialogs.open('Notepad Help',`<div class="help-content"><h3>Using Notepad</h3><p>Type plain text in the editing area. Use File to create, open, save, set up a page, or print a document. Drop a text file onto the window to open it.</p><h3>Editing and searching</h3><p>Use the Edit menu to undo, cut, copy, paste, delete, find, replace, go to a line, select all, or insert the time and date. Find searches in the selected direction and does not wrap around the document. Replace All is a single undo operation.</p><table><tr><td><kbd>Ctrl+N / O / S</kbd></td><td>New / Open / Save</td></tr><tr><td><kbd>Ctrl+F / H / G</kbd></td><td>Find / Replace / Go To</td></tr><tr><td><kbd>F3</kbd> / <kbd>F5</kbd></td><td>Find Next / Time and Date</td></tr><tr><td><kbd>Ctrl+Z / Y</kbd></td><td>Undo / Redo</td></tr><tr><td><kbd>Ctrl+P</kbd></td><td>Print</td></tr><tr><td><kbd>Alt</kbd> + underlined letter</td><td>Open a menu; use arrows and Enter</td></tr><tr><td><kbd>Ctrl+Home / End</kbd></td><td>Start / end of document</td></tr></table><h3>Word Wrap, font, and status bar</h3><p>Word Wrap fits text to the window without inserting line breaks. Following classic Notepad behavior, Go To and Status Bar are disabled while wrapping is enabled. Font changes the entire document’s display, not its plain-text contents.</p><h3>Files and encodings</h3><p>Save As supports ANSI, Unicode (UTF-16 little endian), Unicode big endian, and UTF-8. Unicode saves include a byte-order mark. Existing line-ending style is retained; new documents use Windows CRLF. Saving text that cannot be represented in the chosen ANSI code page is blocked rather than silently losing characters.</p><p>A file whose first line is <kbd>.LOG</kbd> receives a time/date entry when opened. Browser Documents are local copies stored by this site, not your operating system’s folders. A real device file picker or download completes disk operations.</p><h3>Touch and mobile</h3><p>Tap to place the caret and open the keyboard. Drag to scroll. Hold a word to select it; drag the selection handles to adjust the range. Menus and dialogs remain in the XP style, with larger touch targets where needed.</p><h3>Printing</h3><p>Page Setup controls paper, orientation, margins, header, and footer. Use &amp;f, &amp;p, &amp;d, &amp;t, and &amp;l/&amp;c/&amp;r. Disable the browser’s own headers and footers for clean output.</p><h3>Agent control</h3><p>AI Agent Control is available from Help or <kbd>Ctrl+Alt+M</kbd>. External MCP clients require the included local server and your explicit tab authorization. No arbitrary system-file or shell access is exposed.</p><h3>Renderer and compatibility</h3><p>WebGPU batches cached text runs and selections. A Canvas 2D renderer is used when WebGPU is unavailable. Font rasterization, native file/print dialogs, and operating-system keyboard shortcuts depend on your browser and installed fonts.</p></div><div class="dialog-actions"><button class="xp-button" data-action="agent">Agent Control…</button><button class="xp-button default" data-action="close">Close</button></div>`,{width:610});dialog.query('[data-action="close"]').onclick=()=>dialog.close();dialog.query('[data-action="agent"]').onclick=()=>{dialog.close();this.agentDialog();};return dialog.promise;
  }
  agentDialog(){
    const existing=this.dialogs.stack.find(d=>d.title==='AI Agent Control');if(existing){existing.el.focus();return existing.promise;}
    const dialog=this.dialogs.open('AI Agent Control',`<div class="agent-status"><strong id="agent-status-label"></strong><br><span id="agent-status-detail"></span></div><p>External agents connect through the included local MCP server. Only explicitly authorized tabs can be controlled. Text remains local unless your connected agent reads it.</p><div class="field"><label for="agent-token">Access token:</label><input id="agent-token" type="password" autocomplete="off" placeholder="Token printed by the local server"></div><div class="field"><label for="agent-permission">Permission:</label><select id="agent-permission"><option value="full">Full document and app control</option><option value="read">Read-only document inspection</option></select></div><div class="field"><label for="ansi-codepage">ANSI code page:</label><select id="ansi-codepage">${CODEPAGES.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="agent-tools"><button class="xp-button default" data-action="connect">Enable Control</button><button class="xp-button" data-action="disconnect">Disable Control</button><button class="xp-button" data-action="refresh">Refresh</button></div><div class="agent-log" id="agent-log" aria-label="Agent activity"></div><p class="muted">Start: <code>node mcp/server.mjs</code><br>Stdio MCP: <code>node mcp/server.mjs --stdio</code><br>Open the localhost URL printed by that process, then enable control here.</p><div class="dialog-actions"><button class="xp-button" data-action="tools">Available Tools…</button><button class="xp-button" data-action="close">Close</button></div>`,{width:540,focus:'#agent-token'});
    dialog.query('#agent-token').value=this.agentToken;dialog.query('#agent-permission').value=this.agentReadOnly?'read':'full';dialog.query('#ansi-codepage').value=this.options.codepage;
    const refresh=()=>{if(dialog.closed)return;dialog.query('#agent-status-label').textContent=this.agentEnabled?'Agent control enabled':'Agent control disabled';dialog.query('#agent-status-detail').textContent=`${this.renderer.mode} · ${this.model.length.toLocaleString()} characters · ${this.model.lineCount.toLocaleString()} lines · Tab ${this.tabId.slice(0,8)}`;dialog.query('#agent-log').textContent=this.log.join('\n')||'No agent activity in this tab.';dialog.query('[data-action="connect"]').disabled=this.agentEnabled;dialog.query('[data-action="disconnect"]').disabled=!this.agentEnabled;};this.refreshAgentDialog=refresh;refresh();
    dialog.query('[data-action="connect"]').onclick=async()=>{try{this.agentToken=dialog.query('#agent-token').value.trim();this.agentReadOnly=dialog.query('#agent-permission').value==='read';await this.enableAgent();refresh();}catch(error){this.error(error);}};
    dialog.query('[data-action="disconnect"]').onclick=()=>{this.disableAgent();refresh();};dialog.query('[data-action="refresh"]').onclick=refresh;dialog.query('[data-action="close"]').onclick=()=>dialog.close();dialog.query('#ansi-codepage').onchange=e=>{this.options.codepage=e.target.value;try{localStorage.setItem('NotepadXP-settings',JSON.stringify(this.options));}catch{}};
    dialog.query('[data-action="tools"]').onclick=()=>{const d=this.dialogs.open('MCP Tools',`<div class="help-content">${TOOLS.map(t=>`<h3>${escapeHTML(t.name)}</h3><p>${escapeHTML(t.description)}</p>`).join('')}</div><div class="dialog-actions"><button class="xp-button default" data-action="ok">OK</button></div>`,{width:570});d.query('[data-action="ok"]').onclick=()=>d.close();};return dialog.promise;
  }
  addLog(message){this.log.push(`${new Date().toLocaleTimeString()}  ${message}`);if(this.log.length>100)this.log.shift();this.refreshAgentDialog?.();}
  async bridgeFetch(path,body,signal){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.agentToken}`,...(this.agentTabKey?{'X-Notepad-Tab-Key':this.agentTabKey}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});if(!response.ok){let message;try{message=(await response.json()).error;}catch{}throw new Error(message||`Local MCP bridge returned HTTP ${response.status}.`);}return response.status===204?{}:response.json();}
  async enableAgent(){
    if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname)||!/^https?:$/.test(location.protocol))throw new Error('External MCP control requires this page to be opened from the included localhost server. Run node mcp/server.mjs and open the URL it prints.');
    if(this.agentToken.length<16)throw new Error('Enter the access token printed by the local MCP server.');
    const paired=await this.bridgeFetch('/bridge/connect',{tabId:this.tabId,readOnly:this.agentReadOnly,state:this.state()});this.agentTabKey=paired.tabKey;this.agentEnabled=true;this.agentAbort=new AbortController();try{sessionStorage.setItem('NotepadXP-bridge-token',this.agentToken);}catch{}this.addLog(`Control enabled (${this.agentReadOnly?'read-only':'full control'}).`);this.pollAgent(this.agentAbort.signal);
  }
  disableAgent(){this.agentEnabled=false;this.agentAbort?.abort();this.bridgeFetch('/bridge/disconnect',{tabId:this.tabId}).catch(()=>{});this.addLog('Control disabled.');}
  async pushAgentState(){clearTimeout(this.agentStateTimer);this.agentStateTimer=setTimeout(()=>{if(this.agentEnabled)this.bridgeFetch('/bridge/state',{tabId:this.tabId,state:this.state()}).catch(()=>{});},250);}
  async pollAgent(signal){let failures=0;while(this.agentEnabled&&!signal.aborted){try{const reply=await this.bridgeFetch(`/bridge/poll?tabId=${encodeURIComponent(this.tabId)}`,undefined,signal);failures=0;for(const job of reply.commands||[]){if(!this.agentEnabled)break;let result,error;try{if(this.agentReadOnly&&!READ_ONLY_TOOLS.has(job.name))throw new Error('This tab is authorized for read-only inspection.');result=await this.execute(job.name,job.arguments||{});this.addLog(`${job.name} ✓`);}catch(e){error=e.message;this.addLog(`${job.name} — ${error}`);}await this.bridgeFetch('/bridge/result',{tabId:this.tabId,id:job.id,result,error},signal);}}catch(error){if(signal.aborted)break;failures++;this.addLog(error.message);if(failures>=3){this.agentEnabled=false;this.refreshAgentDialog?.();break;}await new Promise(r=>setTimeout(r,1500));}}}
  dialogState(){const dialog=this.dialogs.stack.at(-1);if(!dialog)return null;const controls=[...dialog.el.querySelectorAll('input,select,textarea,button')].map((el,index)=>({id:el.id||el.dataset.action||el.dataset.result||`${el.name?el.name+'-':''}control-${index}`,tag:el.tagName.toLowerCase(),type:el.type||'',label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,150),value:el.type==='password'?'[redacted]':el.type==='checkbox'||el.type==='radio'?el.checked:el.value??null,disabled:el.disabled,options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.textContent})):undefined}));return{title:dialog.title,modeless:dialog.modeless,controls};}
  state(){const m=this.model,p=m.positionAt();return{app:'Notepad XP',version:'1.0.0',name:this.name,modified:m.dirty,revision:m.revision,length:m.length,lineCount:m.lineCount,encoding:this.encoding,ansiCodepage:this.options.codepage,eol:this.eol,bom:this.bom,hasWritableHandle:!!this.writableHandle,selection:{anchor:m.anchor,head:m.head,start:m.start,end:m.end,length:m.end-m.start},cursor:{line:p.line+1,column:p.column+1,offset:m.head},undoAvailable:!!m.undoStack.length,redoAvailable:!!m.redoStack.length,view:{...this.options,statusBarVisible:!this.options.wordWrap&&this.options.statusBar,scrollX:this.view.scrollX,scrollY:this.view.scrollY,width:this.renderer.width,height:this.renderer.height,visualRows:this.view.rows,maximized:$('#window').classList.contains('maximized'),minimized:$('#window').hidden},renderer:this.renderer.mode,rendererFallbackReason:this.renderer.reason||null,worker:!!this.worker.worker,agent:{enabled:this.agentEnabled,readOnly:this.agentReadOnly,tabId:this.tabId},dialog:this.dialogState(),pageSetup:{...this.page}};}
  metrics(){let leaves=0;const walk=n=>{if(!n)return;if(n.source)leaves++;else{walk(n.left);walk(n.right);}};walk(this.model.root);return{...this.renderer.metrics,renderer:this.renderer.mode,frames:this.renderer.frames,adapter:this.renderer.adapterInfo||{},document:{length:this.model.length,lines:this.model.lineCount,revision:this.model.revision,ropeHeight:this.model.root?.height||0,ropeLeaves:leaves,undoDepth:this.model.undoStack.length,redoDepth:this.model.redoStack.length},worker:!!this.worker.worker,wrapIndexRows:this.view.wrapRows?.length||0,viewport:{width:this.renderer.width,height:this.renderer.height,dpr:this.renderer.dpr},memory:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null};}
  async execute(name,args={}){
    validateArguments(name,args);const m=this.model;
    const requireDiscard=()=>{if(m.dirty&&!args.discardChanges)throw new Error('The current document has unsaved changes. Save it first or explicitly pass discardChanges=true.');};
    const revision=()=>{if(args.expectedRevision!==undefined&&args.expectedRevision!==m.revision)throw new Error(`Revision conflict: expected ${args.expectedRevision}, current ${m.revision}`);};
    switch(name){
      case'app_list_tabs':return[{tabId:this.tabId,name:this.name,readOnly:this.agentReadOnly,enabled:this.agentEnabled}];
      case'app_get_state':return this.state();
      case'document_read':{const offset=args.offset??0,length=args.length??65536;if(offset>m.length)throw new RangeError('Offset exceeds document length');const end=Math.min(m.length,offset+length);return{text:m.slice(offset,end),offset,end,length:end-offset,totalLength:m.length,revision:m.revision,hasMore:end<m.length};}
      case'document_new':requireDiscard();this.newDocument();return this.state();
      case'document_set_text':requireDiscard();this.name=cleanName(args.name||'Untitled');this.fileHandle=null;this.writableHandle=false;this.virtualPath=null;this.encoding='utf-8';this.bom=true;this.eol='CRLF';this.view.scrollX=this.view.scrollY=0;m.load(args.text,false);return this.state();
      case'document_open_base64':{requireDiscard();const bytes=bytesFromBase64(args.data);await this.openFile(new File([bytes],cleanName(args.name)),{encoding:args.encoding||'auto'});return this.state();}
      case'document_insert':revision();if(args.position!==undefined)m.edit(args.position,args.position,args.text);else m.insert(args.text);return this.state();
      case'document_apply_edits':m.applyEdits(args.edits,args.expectedRevision);return this.state();
      case'document_export':{if(m.length>8*1024*1024)throw new Error('Use document_read in chunks for documents larger than 8 MiB.');const encoding=args.encoding||this.encoding,blob=encodedBlob(m.root,encoding,{eol:args.eol||this.eol,bom:args.bom??(encoding!=='ansi'),codepage:this.options.codepage});if(blob.size>8*1024*1024)throw new Error('Encoded output exceeds the 8 MiB export limit. Use document_read in chunks.');return{name:this.name,encoding,eol:args.eol||this.eol,byteLength:blob.size,data:base64Bytes(new Uint8Array(await blob.arrayBuffer())),mimeType:'text/plain',revision:m.revision};}
      case'document_save':if(this.fileHandle&&this.writableHandle&&!args.saveAs){await this.save();return{saved:true,state:this.state()};}this.fileDialog(true).catch(e=>this.error(e));return{saved:false,requiresUserInteraction:true,dialog:'Save As'};
      case'edit_select':if(args.start>m.length||args.end>m.length)throw new RangeError('Selection exceeds document length');m.select(args.start,args.end);return this.state();
      case'edit_find':{const match=await this.findNext(false,args);return{match,revision:m.revision,cursor:this.state().cursor};}
      case'edit_replace':{if(args.all)return{count:await this.replaceAll(args),revision:m.revision};this.search={...this.search,query:args.query,replacement:args.replacement,matchCase:!!args.matchCase,direction:'down'};const before=m.revision,match=await this.replaceCurrent(false);return{replaced:m.revision!==before,nextMatch:match,revision:m.revision};}
      case'edit_undo':return{changed:m.undo(),state:this.state()};case'edit_redo':return{changed:m.redo(),state:this.state()};
      case'edit_time_date':m.insert(timeDate());return this.state();
      case'view_goto':if(args.line>m.lineCount)throw new RangeError('Line exceeds document line count');m.select(m.offsetAt(args.line-1,(args.column??1)-1));return this.state();
      case'view_scroll':if(args.line!==undefined)this.view.scrollY=(args.line-1)*this.renderer.lineHeight;if(args.x!==undefined)this.view.scrollX=args.x;if(args.y!==undefined)this.view.scrollY=args.y;this.view.clamp();this.view.schedule();return this.state();
      case'view_set_options':for(const k of ['wordWrap','statusBar','fontFamily','fontSize','fontStyle'])if(args[k]!==undefined)this.options[k]=args[k];this.applyOptions();return this.state();
      case'file_page_setup':{const page={...this.page};for(const k of ['paper','orientation','left','right','top','bottom','header','footer'])if(args[k]!==undefined)page[k]=args[k];validatePage(page);this.page=page;return page;}
      case'ui_command':this.run(args.command);await Promise.resolve();return{command:args.command,state:this.state(),note:'Native pickers and pending dialogs require user interaction or further dialog commands.'};
      case'ui_dialog':{const dialog=this.dialogs.stack.at(-1);if(!dialog)throw new Error('No application dialog is open.');if(args.action==='inspect')return this.dialogState();if(args.action==='close'){dialog.close();return this.dialogState();}const controls=[...dialog.el.querySelectorAll('input,select,textarea,button')],states=this.dialogState().controls,index=states.findIndex(c=>c.id===args.control),control=controls[index];if(!control)throw new Error('Unknown dialog control. Inspect the dialog for control IDs.');if(control.type==='password')throw new Error('Access-token controls cannot be manipulated by an agent.');if(args.action==='set'){if(!['INPUT','SELECT','TEXTAREA'].includes(control.tagName))throw new Error('This control is not editable');if(control.type==='checkbox'||control.type==='radio')control.checked=!!args.value;else control.value=String(args.value??'');control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));}else if(args.action==='click'){if(control.disabled)throw new Error('This control is disabled');control.click();}await Promise.resolve();return this.dialogState();}
      case'app_get_metrics':return this.metrics();
      case'app_capture_viewport':this.view.render();return{mimeType:'image/png',data:this.renderer.screenshot().split(',')[1],width:this.renderer.width,height:this.renderer.height};
      default:throw new Error('Unknown tool');
    }
  }
}
const app=new NotepadApp();
window.notepad=Object.freeze({ready:app.ready,execute:(name,args)=>app.execute(name,args),getState:()=>app.state(),getMetrics:()=>app.metrics(),getTools:()=>structuredClone(TOOLS),screenshot:()=>app.renderer.screenshot()});
