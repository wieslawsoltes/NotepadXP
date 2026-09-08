const string={type:'string'},integer={type:'integer'},boolean={type:'boolean'};
const range={start:{...integer,minimum:0},end:{...integer,minimum:0}};
function tool(name,description,properties={},required=[],readOnly=false){return{name,description,inputSchema:{type:'object',properties:{...properties,tabId:{type:'string',description:'Optional authorized browser tab ID; omit when exactly one tab is connected.'}},required,additionalProperties:false},annotations:{title:name.replaceAll('_',' '),readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}};}
export const TOOLS=[
  tool('app_list_tabs','List browser tabs that the user has explicitly authorized for MCP control.',{},[],true),
  tool('app_get_state','Read document metadata, selection, cursor, font, viewport, dialogs, and renderer state. Does not include document text.',{},[],true),
  tool('document_read','Read a bounded text range. Offsets and lengths are UTF-16 code units; internal newlines are LF.',{offset:{...integer,minimum:0,default:0},length:{...integer,minimum:0,maximum:262144,default:65536}},[],true),
  tool('document_set_text','Replace the document with supplied text. Requires discardChanges=true when the existing document has unsaved changes. Marks the new text unsaved.',{text:{...string,maxLength:8388608},name:{...string,maxLength:255},discardChanges:boolean},['text']),
  tool('document_new','Create an empty Untitled document. Requires discardChanges=true when the existing document is modified.',{discardChanges:boolean}),
  tool('document_open_base64','Open text-file bytes supplied as base64. Supports ANSI, UTF-8, and UTF-16 LE/BE. No arbitrary filesystem access.',{data:{...string,maxLength:12582912},name:{...string,maxLength:255},encoding:{type:'string',enum:['auto','ansi','utf-8','utf-16le','utf-16be']},discardChanges:boolean},['data','name']),
  tool('document_insert','Insert text at a specified UTF-16 offset, or replace the current selection when position is omitted.',{text:{...string,maxLength:8388608},position:{...integer,minimum:0},expectedRevision:integer},['text']),
  tool('document_apply_edits','Atomically apply non-overlapping edits using offsets in the original revision. All edits form one undo step.',{edits:{type:'array',maxItems:1000,items:{type:'object',properties:{...range,text:{...string,maxLength:8388608}},required:['start','end','text'],additionalProperties:false}},expectedRevision:integer},['edits','expectedRevision']),
  tool('document_export','Export current document as base64 bytes. Does not mark it saved or write to disk. Limited to 8 MiB; use document_read for larger files.',{encoding:{type:'string',enum:['ansi','utf-8','utf-16le','utf-16be']},eol:{type:'string',enum:['CRLF','LF','CR']},bom:boolean},[],true),
  tool('document_save','Save through an already user-authorized writable file handle, or open Save As for the user. A browser file picker cannot be bypassed.',{saveAs:boolean}),
  tool('edit_select','Set the selection. start is the anchor, end is the active cursor. A reversed range selects backward.',range,['start','end']),
  tool('edit_find','Find literal text without wrapping. Returns a match and selects it unless select=false.',{query:{...string,minLength:1,maxLength:65536},matchCase:boolean,direction:{type:'string',enum:['up','down']},from:{...integer,minimum:0},select:boolean},['query']),
  tool('edit_replace','Replace the selected matching occurrence, find the next occurrence, or replace all literal matches in one undo step.',{query:{...string,minLength:1,maxLength:65536},replacement:{...string,maxLength:8388608},all:boolean,matchCase:boolean},['query','replacement']),
  tool('edit_undo','Undo the most recent edit or grouped typing.'),
  tool('edit_redo','Redo the most recently undone edit.'),
  tool('edit_time_date','Insert the current local time and date, equivalent to F5.'),
  tool('view_goto','Place the caret at a 1-based logical line and column. Works independently of the classic Go To dialog.',{line:{...integer,minimum:1},column:{...integer,minimum:1}},['line']),
  tool('view_scroll','Scroll to an absolute visual line (1-based) and/or pixel coordinates. Does not change the selection.',{line:{...integer,minimum:1},x:{type:'number',minimum:0},y:{type:'number',minimum:0}}),
  tool('view_set_options','Set wrapping, status bar preference, and font. Like XP, the status bar is hidden while Word Wrap is on.',{wordWrap:boolean,statusBar:boolean,fontFamily:{...string,maxLength:100},fontSize:{type:'number',minimum:1,maximum:200},fontStyle:{type:'string',enum:['Regular','Bold','Italic','Bold Italic']}}),
  tool('file_page_setup','Read or set paper, orientation, margins in inches, and Notepad header/footer commands.',{paper:{type:'string',enum:['Letter','A4','Legal','A5']},orientation:{type:'string',enum:['Portrait','Landscape']},left:{type:'number',minimum:0},right:{type:'number',minimum:0},top:{type:'number',minimum:0},bottom:{type:'number',minimum:0},header:{...string,maxLength:1024},footer:{...string,maxLength:1024}}),
  tool('ui_command','Invoke a named menu/window command. Commands that need user interaction open the corresponding dialog and return immediately.',{command:{type:'string',enum:['new','open','save','saveAs','pageSetup','print','exit','undo','redo','cut','copy','paste','delete','find','findNext','replace','goto','selectAll','timeDate','wordWrap','font','statusBar','help','about','agent','minimize','maximize','restore','focus']}},['command']),
  tool('ui_dialog','Inspect, fill, or activate controls in the frontmost application dialog. Native browser/OS dialogs remain user-controlled. Controls are addressed by their returned IDs, names, or data-action values.',{action:{type:'string',enum:['inspect','set','click','close']},control:string,value:{type:['string','number','boolean']}},['action']),
  tool('app_get_metrics','Read renderer timing, visible instance count, rope size, worker status, and document revision.',{},[],true),
  tool('app_capture_viewport','Capture the text viewport as a PNG image. The capture is reproduced from the same render scene; it does not include native dialogs.',{},[],true)
];
export const READ_ONLY_TOOLS=new Set(TOOLS.filter(t=>t.annotations.readOnlyHint).map(t=>t.name));
export function validateArguments(name,args){
  const definition=TOOLS.find(t=>t.name===name);if(!definition)throw new Error(`Unknown tool: ${name}`);
  function check(schema,value,path){
    if(schema.type){const types=Array.isArray(schema.type)?schema.type:[schema.type];const ok=types.some(type=>type==='integer'?Number.isInteger(value):type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type);if(!ok)throw new TypeError(`${path} has the wrong type`);}
    if(schema.enum&&!schema.enum.includes(value))throw new Error(`${path} has an unsupported value`);
    if(typeof value==='number'&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))throw new RangeError(`${path} is outside the allowed range`);
    if(typeof value==='string'&&((schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength)))throw new RangeError(`${path} has an invalid length`);
    if(Array.isArray(value)){if(schema.maxItems!==undefined&&value.length>schema.maxItems)throw new RangeError(`${path} has too many items`);value.forEach((v,i)=>check(schema.items,v,`${path}[${i}]`));}
    if(schema.type==='object'){for(const key of schema.required||[])if(value[key]===undefined)throw new Error(`Missing ${path}.${key}`);for(const [key,v]of Object.entries(value)){if(!schema.properties?.[key]){if(schema.additionalProperties===false)throw new Error(`Unknown ${path}.${key}`);}else check(schema.properties[key],v,`${path}.${key}`);}}
  }
  check(definition.inputSchema,args??{},'arguments');return definition;
}
