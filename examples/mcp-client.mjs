#!/usr/bin/env node
/** Local HTTP MCP example. Read-only by default; --insert explicitly writes. */
const endpoint=new URL(process.env.NOTEPAD_URL||'http://127.0.0.1:8787/mcp');
if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname))throw new Error('This example only connects to the local HTTP companion.');
const token=process.env.NOTEPAD_TOKEN;
if(!token||token.length<16)throw new Error('Set NOTEPAD_TOKEN to the token printed by the running local server.');
let session=null,version=null,sequence=0;
const headers=()=>({Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':version}:{})});
async function request(method,params={},notify=false){
 const response=await fetch(endpoint,{method:'POST',headers:headers(),body:JSON.stringify({jsonrpc:'2.0',...(notify?{}:{id:++sequence}),method,params}),signal:AbortSignal.timeout(125000)});
 if(!response.ok)throw new Error(`HTTP ${response.status}: ${await response.text()}`);
 if(response.status===202)return null;
 const packet=await response.json();if(packet.error)throw new Error(packet.error.message);
 if(method==='initialize'){session=response.headers.get('mcp-session-id');version=packet.result.protocolVersion;}
 return packet.result;
}
async function tool(name,args={}){const result=await request('tools/call',{name,arguments:args});if(result.isError)throw new Error(result.content?.[0]?.text||'Tool error');return result.structuredContent??JSON.parse(result.content[0].text);}
try{
 await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'notepad-example',version:'1.0.0'}});
 await request('notifications/initialized',{},true);
 const tools=await request('tools/list');console.log(`${tools.tools.length} tools: ${tools.tools.map(t=>t.name).join(', ')}`);
 if(!process.argv.includes('--list-tools')){
  const {tabs}=await tool('app_list_tabs');console.log('Authorized tabs:',tabs);
  if(!tabs.length)throw new Error('Open the server URL and choose Help > AI Agent Control > Enable Control, then run this example again.');
  if(tabs.length!==1)throw new Error('This example expects exactly one authorized tab; disconnect other tabs.');
  const state=await tool('app_get_state');console.log('State:',state);
  const insert=process.argv.find(a=>a.startsWith('--insert='));
  if(insert){await tool('document_insert',{text:insert.slice('--insert='.length),position:state.selection.head,expectedRevision:state.revision});console.log('Explicit insertion completed.');}
  console.log('Document preview:',await tool('document_read',{offset:0,length:256}));
 }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(session)try{await fetch(endpoint,{method:'DELETE',headers:headers(),signal:AbortSignal.timeout(3000)});}catch{}}
