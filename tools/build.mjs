import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modules=['rope','model','encoding','layout','renderer','editor','ui','worker-client','printing','tools'];
const alias=name=>'NP_'+name.replaceAll('-','_');
async function compile(name,includeReturn=true){
 let source=await fs.readFile(path.join(ROOT,`src/${name}.mjs`),'utf8');
 const exports=[...source.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([$\w]+)/g)].map(m=>m[1]);
 source=source.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\/([^'"]+)\.mjs['"];?/g,(_,local,dep)=>`const ${local}=${alias(dep)};`);
 source=source.replace(/import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)\.mjs['"];?/g,(_,names,dep)=>`const {${names}}=${alias(dep)};`);
 source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let))/g,'');
 // This branch is not used by the standalone build, but import.meta cannot
 // appear in an ordinary script. Its worker always comes from the embedded Blob.
 source=source.replace(/new URL\('\.\/worker\.mjs',import\.meta\.url\)/g,"new URL('src/worker.mjs',location.href)");
 return `const ${alias(name)}=(()=>{\n${source}\n${includeReturn?`return {${exports.join(',')}};`:''}\n})();\n`;
}
let worker='';for(const name of ['rope','encoding','layout'])worker+=await compile(name);worker+=await compile('worker',false);
let script=`globalThis.__NP_WORKER_SOURCE__=${JSON.stringify(worker)};\n`;
for(const name of modules)script+=await compile(name);script+=await compile('app',false);
let html=await fs.readFile(path.join(ROOT,'index.html'),'utf8');
const css=await fs.readFile(path.join(ROOT,'src/style.css'),'utf8');
const icon=await fs.readFile(path.join(ROOT,'assets/notepad.svg'),'utf8');const iconURL='data:image/svg+xml;base64,'+Buffer.from(icon).toString('base64');
// The same SVG is embedded into generated dialogs as well as the initial shell.
script=script.replaceAll('assets/notepad.svg',iconURL);
html=html.replace('<link rel="stylesheet" href="src/style.css">',()=>`<style>${css}</style>`).replaceAll('assets/notepad.svg',iconURL);
html=html.replace('<script type="module" src="src/app.mjs"></script>',()=>`<script>\n${script.replace(/<\/script/gi,'<\\/script')}\n</script>`);
await fs.writeFile(path.join(ROOT,'NotepadXP.html'),html);
console.log(`Built NotepadXP.html (${Buffer.byteLength(html).toLocaleString()} bytes; no external runtime dependencies).`);
