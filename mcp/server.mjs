#!/usr/bin/env node
/** Dependency-free local MCP server. The MCP transport is pinned to the
 * published 2025-11-25 protocol (also negotiates 2025-06-18 / 2025-03-26).
 * Browser commands use a separate authenticated, explicitly paired channel.
 * This process never exposes arbitrary filesystem or shell tools. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {TOOLS,READ_ONLY_TOOLS,validateArguments} from '../src/tools.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VERSIONS=['2025-11-25','2025-06-18','2025-03-26'];
const MAX_BODY=16*1024*1024;
class RPCError extends Error{constructor(code,message){super(message);this.code=code;}}
class HTTPError extends Error{constructor(status,message){super(message);this.status=status;}}
function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
function json(res,status,data,headers={}){const body=data===null?'':JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(body);}
async function readJSON(req){
 const length=Number(req.headers['content-length']||0);if(length>MAX_BODY){req.resume();throw new HTTPError(413,'Request exceeds 16 MiB.');}
 const body=await new Promise((resolve,reject)=>{let chunks=[],size=0,done=false;req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>MAX_BODY){done=true;chunks=[];reject(new HTTPError(413,'Request exceeds 16 MiB.'));return;}chunks.push(chunk);});req.on('end',()=>{if(!done){done=true;resolve(Buffer.concat(chunks).toString('utf8'));}});req.on('error',error=>{if(!done){done=true;reject(error);}});});
 try{return JSON.parse(body);}catch{throw new RPCError(-32700,'Parse error');}
}
function errorPacket(id,error){return{jsonrpc:'2.0',id:id??null,error:{code:error.code||-32603,message:error.message||'Internal error'}};}
export async function createNotepadServer({port=8787,token=crypto.randomBytes(32).toString('hex'),quiet=false}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Port must be an integer from 0 through 65535.');
 if(typeof token!=='string'||token.length<16||token.length>512)throw new Error('NOTEPAD_TOKEN must have 16–512 characters.');
 const tabs=new Map(),jobs=new Map(),sessions=new Map();let actualPort=port,closing=false;
 const stdioSession={id:'stdio',initialized:false,negotiated:null,lastSeen:Date.now()};
 let standaloneHash='';try{const html=await fs.readFile(path.join(ROOT,'NotepadXP.html'),'utf8');const match=html.match(/<script>([\s\S]*?)<\/script>/);if(match)standaloneHash=` 'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`;}catch{}
 const origins=()=>new Set([`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`]);
 const removeTab=(id,reason='The user disconnected this browser tab.')=>{const tab=tabs.get(id);if(!tab)return;tab.poll?.finish([]);tabs.delete(id);for(const [jobId,job] of jobs)if(job.tabId===id){clearTimeout(job.timer);job.reject(new Error(reason));jobs.delete(jobId);}};
 const listTabs=()=>({tabs:[...tabs.values()].map(t=>({tabId:t.id,name:t.state?.name||'Untitled',readOnly:t.readOnly,revision:t.state?.revision??null,length:t.state?.length??null,lastSeen:new Date(t.lastSeen).toISOString()}))});
 const selectTab=args=>{if(args?.tabId){const tab=tabs.get(args.tabId);if(!tab)throw new Error('The requested tab is not authorized or is disconnected.');return tab;}if(tabs.size===0)throw new Error('No browser tab is authorized. Open the localhost URL printed by this server and choose Help → AI Agent Control → Enable Control.');if(tabs.size>1)throw new Error('More than one tab is authorized. Call app_list_tabs and pass tabId.');return tabs.values().next().value;};
 const callBrowser=(name,args={},requestKey=null)=>{
   validateArguments(name,args);if(name==='app_list_tabs')return Promise.resolve(listTabs());
   const tab=selectTab(args);if(tab.readOnly&&!READ_ONLY_TOOLS.has(name))throw new Error('This browser tab is authorized for read-only inspection.');
   if(tab.queue.length>=16||jobs.size>=128)throw new Error('Too many pending browser operations.');
   return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{jobs.delete(id);tab.queue=tab.queue.filter(j=>j.id!==id);reject(new Error('The browser operation timed out. A delivered operation may still finish; inspect document revision before retrying a write.'));},120000);timer.unref();jobs.set(id,{id,tabId:tab.id,resolve,reject,timer,requestKey});tab.queue.push({id,name,arguments:args});if(tab.poll){const pending=tab.queue.splice(0);tab.poll.finish(pending);}});
 };
 async function toolResult(name,args,key){
  try{
   const value=await callBrowser(name,args,key);
   if(name==='app_capture_viewport')return{content:[{type:'image',data:value.data,mimeType:value.mimeType}],structuredContent:{width:value.width,height:value.height,mimeType:value.mimeType}};
   const text=JSON.stringify(value);return{content:[{type:'text',text}],...(text.length<524288?{structuredContent:Array.isArray(value)?{items:value}:value}:{}),isError:false};
  }catch(error){return{content:[{type:'text',text:error.message}],isError:true};}
 }
 async function handle(message,session=stdioSession){
  let id=null,notification=false;
  try{
   if(!message||typeof message!=='object'||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')throw new RPCError(-32600,'Invalid JSON-RPC request');
   notification=!Object.hasOwn(message,'id');id=message.id??null;if(!notification&&typeof id!=='string'&&typeof id!=='number'&&id!==null)throw new RPCError(-32600,'Invalid request ID');
   const p=message.params??{};if(typeof p!=='object'||p===null||Array.isArray(p))throw new RPCError(-32602,'Parameters must be an object');session.lastSeen=Date.now();let result;
   if(message.method==='initialize'){
    if(session.negotiated)throw new RPCError(-32600,'This session is already initialized');
    if(typeof p.protocolVersion!=='string')throw new RPCError(-32602,'protocolVersion is required');
    session.negotiated=VERSIONS.includes(p.protocolVersion)?p.protocolVersion:VERSIONS[0];
    result={protocolVersion:session.negotiated,capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},serverInfo:{name:'notepad-xp',version:'1.0.0'},instructions:'Open the localhost URL printed on stderr and explicitly enable a browser tab in Help > AI Agent Control. Call app_list_tabs first. UTF-16 offsets and LF newlines are used internally. No shell or unrestricted filesystem access is available. Native file and print dialogs require user interaction. Before destructive document replacement, save or explicitly request discardChanges.'};
   }else if(message.method==='notifications/initialized'){if(session.negotiated)session.initialized=true;result=null;}
   else if(message.method==='ping')result={};
   else if(message.method==='notifications/cancelled'){
    const key=`${session.id}:${String(p.requestId)}`;for(const [jobId,job]of jobs)if(job.requestKey===key){const tab=tabs.get(job.tabId);if(tab){const queued=tab.queue.some(j=>j.id===jobId);tab.queue=tab.queue.filter(j=>j.id!==jobId);if(queued){clearTimeout(job.timer);jobs.delete(jobId);job.reject(new Error('Request cancelled before delivery.'));}}}result=null;
   }else if(message.method.startsWith('notifications/'))result=null;
   else{
    if(!session.initialized)throw new RPCError(-32002,'Send initialize, then notifications/initialized, before calling server features');
    const key=`${session.id}:${String(id)}`;
    switch(message.method){
     case'tools/list':result={tools:TOOLS};break;
     case'tools/call':if(typeof p.name!=='string'||!TOOLS.some(t=>t.name===p.name))throw new RPCError(-32602,'Unknown tool');result=await toolResult(p.name,p.arguments||{},key);break;
     case'resources/list':result={resources:[{uri:'notepad://state',name:'Notepad state',description:'Active document metadata and UI state.',mimeType:'application/json'},{uri:'notepad://document',name:'Document text',description:'First 65,536 UTF-16 code units. Use document_read for subsequent ranges.',mimeType:'text/plain'},{uri:'notepad://metrics',name:'Renderer metrics',mimeType:'application/json'}]};break;
     case'resources/templates/list':result={resourceTemplates:[]};break;
     case'resources/read':{
      let url;try{url=new URL(p.uri);}catch{throw new RPCError(-32602,'Invalid resource URI');}
      if(url.protocol!=='notepad:'||!['state','document','metrics'].includes(url.hostname))throw new RPCError(-32002,'Unknown resource');
      const args=url.searchParams.get('tabId')?{tabId:url.searchParams.get('tabId')}:{};
      const data=await callBrowser({state:'app_get_state',document:'document_read',metrics:'app_get_metrics'}[url.hostname],args,key);
      result={contents:[{uri:p.uri,mimeType:url.hostname==='document'?'text/plain':'application/json',text:url.hostname==='document'?data.text:JSON.stringify(data)}]};break;
     }
     default:throw new RPCError(-32601,'Method not found');
    }
   }
   return notification?null:{jsonrpc:'2.0',id,result};
  }catch(error){return notification?null:errorPacket(id,error);}
 }
 const server=http.createServer(async(req,res)=>{
  try{
   const allowedHosts=new Set([`127.0.0.1:${actualPort}`,`localhost:${actualPort}`]);if(!allowedHosts.has(req.headers.host))throw new HTTPError(403,'Invalid Host header. Only this localhost endpoint is permitted.');
   const origin=req.headers.origin;if(origin&&!origins().has(origin))throw new HTTPError(403,'Origin is not permitted.');
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
   res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'${standaloneHash}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
   if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Mcp-Session-Id,MCP-Protocol-Version');}
   const url=new URL(req.url,`http://127.0.0.1:${actualPort}`);
   if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Accept,Mcp-Session-Id,MCP-Protocol-Version,X-Notepad-Tab-Key','Access-Control-Max-Age':'600'});res.end();return;}
   const protectedPath=url.pathname==='/mcp'||url.pathname.startsWith('/bridge/');
   if(protectedPath){const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';if(!equalSecret(bearer,token)){res.setHeader('WWW-Authenticate','Bearer realm="Notepad XP"');throw new HTTPError(401,'A valid bearer token is required.');}}
   if(url.pathname==='/mcp'){
    if(req.method==='GET'){res.setHeader('Allow','POST, DELETE');throw new HTTPError(405,'This MCP server returns JSON responses to POST requests; a standalone SSE stream is not offered.');}
    if(req.method==='DELETE'){const id=req.headers['mcp-session-id'];if(!id||!sessions.has(id))throw new HTTPError(404,'Unknown MCP session.');sessions.delete(id);res.writeHead(204);res.end();return;}
    if(req.method!=='POST')throw new HTTPError(405,'Use POST for MCP requests.');
    if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))throw new HTTPError(415,'Content-Type must be application/json.');
    const accept=String(req.headers.accept||'');if(!accept.includes('application/json')||!accept.includes('text/event-stream'))throw new HTTPError(406,'Accept must include application/json and text/event-stream.');
    const message=await readJSON(req);if(Array.isArray(message)){json(res,400,errorPacket(null,new RPCError(-32600,'Batch requests are not supported by this protocol revision.')));return;}
    let session,newSession=false;
    if(message?.method==='initialize'){
      if(sessions.size>=64)throw new HTTPError(429,'Too many MCP sessions.');session={id:crypto.randomUUID(),initialized:false,negotiated:null,lastSeen:Date.now()};sessions.set(session.id,session);newSession=true;
    }else {const id=req.headers['mcp-session-id'];if(!id)throw new HTTPError(400,'Mcp-Session-Id is required after initialization.');session=sessions.get(id);if(!session)throw new HTTPError(404,'MCP session not found. Initialize a new session.');const version=req.headers['mcp-protocol-version'];if(version&&(!VERSIONS.includes(version)||version!==session.negotiated))throw new HTTPError(400,'Unsupported or mismatched MCP-Protocol-Version.');}
    const packet=await handle(message,session);
    if(newSession&&packet?.error){sessions.delete(session.id);json(res,400,packet);return;}
    if(packet===null){res.writeHead(202);res.end();return;}
    json(res,200,packet,newSession?{'Mcp-Session-Id':session.id,'MCP-Protocol-Version':session.negotiated}:{});return;
   }
   if(url.pathname.startsWith('/bridge/')){
    if(req.method!=='GET'&&req.method!=='POST')throw new HTTPError(405,'Unsupported browser bridge method.');
    const data=req.method==='POST'?await readJSON(req):null;
    if(url.pathname==='/bridge/connect'&&req.method==='POST'){
      if(typeof data?.tabId!=='string'||data.tabId.length<8||data.tabId.length>100||typeof data.readOnly!=='boolean')throw new HTTPError(400,'Invalid browser registration.');
      if(tabs.has(data.tabId))throw new HTTPError(409,'This tab is already connected. Disable control before reconnecting.');
      if(tabs.size>=16)throw new HTTPError(429,'Too many authorized browser tabs.');
      const tab={id:data.tabId,key:crypto.randomBytes(32).toString('hex'),readOnly:data.readOnly,state:data.state||{},queue:[],lastSeen:Date.now(),poll:null};tabs.set(tab.id,tab);json(res,200,{connected:true,tabId:tab.id,tabKey:tab.key});return;
    }
    const tabId=data?.tabId||url.searchParams.get('tabId'),tab=tabs.get(tabId);if(!tab)throw new HTTPError(404,'Browser tab is not connected.');
    if(!equalSecret(req.headers['x-notepad-tab-key'],tab.key))throw new HTTPError(403,'Invalid browser pairing key.');tab.lastSeen=Date.now();
    if(url.pathname==='/bridge/disconnect'&&req.method==='POST'){removeTab(tabId);json(res,200,{disconnected:true});return;}
    if(url.pathname==='/bridge/state'&&req.method==='POST'){tab.state=data.state||{};json(res,200,{ok:true});return;}
    if(url.pathname==='/bridge/poll'&&req.method==='GET'){
      if(tab.poll)throw new HTTPError(409,'A browser poll is already pending.');if(tab.queue.length){json(res,200,{commands:tab.queue.splice(0)});return;}
      let finished=false;const finish=commands=>{if(finished)return;finished=true;clearTimeout(timer);tab.poll=null;if(!res.destroyed)json(res,200,{commands});};
      const timer=setTimeout(()=>finish([]),25000);timer.unref();tab.poll={finish};res.on('close',()=>{if(!finished){finished=true;clearTimeout(timer);tab.poll=null;}});return;
    }
    if(url.pathname==='/bridge/result'&&req.method==='POST'){
      const job=jobs.get(data.id);if(job&&job.tabId===tabId){clearTimeout(job.timer);jobs.delete(data.id);data.error?job.reject(new Error(String(data.error))):job.resolve(data.result);}json(res,200,{ok:true});return;
    }
    throw new HTTPError(404,'Unknown browser bridge endpoint.');
   }
   if(req.method!=='GET'&&req.method!=='HEAD')throw new HTTPError(405,'Static files support GET and HEAD.');
   const decoded=decodeURIComponent(url.pathname),file=decoded==='/'?'index.html':decoded.slice(1);
   const permitted=file==='index.html'||file==='NotepadXP.html'||/^src\/[a-z][a-z0-9-]*\.(?:mjs|css)$/.test(file)||file==='assets/notepad.svg';
   if(!permitted)throw new HTTPError(404,'Not found.');
   let bytes;try{bytes=await fs.readFile(path.join(ROOT,file));}catch{throw new HTTPError(404,'Not found.');}
   const type={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){if(res.headersSent){res.end();return;}if(error instanceof RPCError)json(res,400,errorPacket(null,error));else json(res,error.status||500,{error:error.status?error.message:'Internal server error.'});}
 });
 server.requestTimeout=130000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{actualPort=server.address().port;resolve();});});
 const cleanup=setInterval(()=>{const now=Date.now();for(const [id,session]of sessions)if(now-session.lastSeen>30*60*1000)sessions.delete(id);for(const [id,tab]of tabs)if(now-tab.lastSeen>120000)removeTab(id,'The browser tab stopped responding.');},30000);cleanup.unref();
 const close=async()=>{if(closing)return;closing=true;clearInterval(cleanup);for(const id of [...tabs.keys()])removeTab(id,'The local server is shutting down.');await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});};
 if(!quiet)process.stderr.write(`Notepad XP local server\nOpen: http://127.0.0.1:${actualPort}/#token=${token}\nMCP HTTP endpoint: http://127.0.0.1:${actualPort}/mcp\nUse the token as a Bearer token. Enable a browser tab before calling editing tools.\n`);
 return{server,port:actualPort,token,url:`http://127.0.0.1:${actualPort}`,handle,close,listTabs};
}
async function main(){
 const argv=process.argv.slice(2),stdio=argv.includes('--stdio');let port=Number(process.env.NOTEPAD_PORT||8787);
 const i=argv.indexOf('--port');if(i>=0)port=Number(argv[i+1]);const inline=argv.find(a=>a.startsWith('--port='));if(inline)port=Number(inline.slice(7));
 if(argv.includes('--help')){process.stdout.write('Usage: node mcp/server.mjs [--stdio] [--port 8787]\nEnvironment: NOTEPAD_PORT, NOTEPAD_TOKEN (optional; a random token is the default).\n');return;}
 const app=await createNotepadServer({port,token:process.env.NOTEPAD_TOKEN||undefined});
 const stop=()=>app.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
 if(stdio){
  let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{pending+=chunk;if(pending.length>MAX_BODY&&!pending.includes('\n')){process.stdout.write(JSON.stringify(errorPacket(null,new RPCError(-32600,'Stdio message too large')))+'\n');pending='';return;}let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at).trim();pending=pending.slice(at+1);if(!line)continue;if(line.length>MAX_BODY){process.stdout.write(JSON.stringify(errorPacket(null,new RPCError(-32600,'Stdio message too large')))+'\n');continue;}let message;try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify(errorPacket(null,new RPCError(-32700,'Parse error')))+'\n');continue;}app.handle(message).then(packet=>{if(packet)process.stdout.write(JSON.stringify(packet)+'\n');}).catch(error=>process.stdout.write(JSON.stringify(errorPacket(message.id,error))+'\n'));}});
  process.stdin.on('end',stop);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`Notepad XP: ${error.message}\n`);process.exitCode=1;});
