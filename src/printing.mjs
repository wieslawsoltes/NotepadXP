import * as Rope from './rope.mjs';
import {buildWrap} from './layout.mjs';
import {escapeHTML} from './ui.mjs';
export const DEFAULT_PAGE={paper:'Letter',orientation:'Portrait',left:.75,right:.75,top:.75,bottom:.75,header:'&f',footer:'Page &p',source:'Automatically Select'};
export function expandHeader(template,{name,page,date=new Date()}){
  const result={left:'',center:'',right:''};let alignment='center';
  for(let i=0;i<template.length;i++){
    if(template[i]!=='&'){result[alignment]+=template[i];continue;}
    const key=template[++i];if(!key){result[alignment]+='&';break;}
    if('lcr'.includes(key.toLowerCase())){alignment={l:'left',c:'center',r:'right'}[key.toLowerCase()];continue;}
    const value={f:name,p:String(page),d:date.toLocaleDateString(),t:date.toLocaleTimeString(), '&':'&'}[key.toLowerCase()];result[alignment]+=value===undefined?'&'+key:value;
  }
  return result;
}
export function validatePage(page){
  if(!['Letter','A4','Legal','A5'].includes(page.paper)||!['Portrait','Landscape'].includes(page.orientation))throw new Error('Invalid paper size or orientation.');
  for(const k of ['left','right','top','bottom'])if(!Number.isFinite(page[k])||page[k]<0||page[k]>10)throw new Error('Margins must be between 0 and 10 inches.');
  let [w,h]=({Letter:[8.5,11],A4:[210/25.4,297/25.4],Legal:[8.5,14],A5:[148/25.4,210/25.4]})[page.paper];if(page.orientation==='Landscape')[w,h]=[h,w];
  if(w-page.left-page.right<.5||h-page.top-page.bottom<.5)throw new Error('The margins leave too little room for text.');
  return{width:w,height:h};
}
export async function preparePrint(model,renderer,page,name,frame){
  const dimensions=validatePage(page),root=model.root,width=(dimensions.width-page.left-page.right)*96;
  const rows=buildWrap(root,width,renderer.font,renderer.monospace,renderer.advance);
  const reserve=(page.header?renderer.lineHeight*2:0)+(page.footer?renderer.lineHeight*2:0);
  const perPage=Math.max(1,Math.floor(((dimensions.height-page.top-page.bottom)*96-reserve)/renderer.lineHeight));
  const count=Math.max(1,Math.ceil(rows.length/perPage));
  if(count>2000)throw new Error(`This document would print ${count.toLocaleString()} pages. Print a smaller document (maximum 2,000 pages per job).`);
  const now=new Date();let pages=[];
  const headerHTML=(template,index)=>{const h=expandHeader(template,{name,page:index,date:now});return`<div class="hf"><span>${escapeHTML(h.left)}</span><span>${escapeHTML(h.center)}</span><span>${escapeHTML(h.right)}</span></div>`;};
  for(let p=0;p<count;p++){
    let lines=[];for(let row=p*perPage;row<Math.min(rows.length,(p+1)*perPage);row++){let end=row+1<rows.length?rows[row+1]:Rope.length(root);if(Rope.charAt(root,end-1)==='\n')end--;lines.push(escapeHTML(Rope.slice(root,rows[row],end)));}
    pages.push(`<section class="page">${page.header?headerHTML(page.header,p+1):''}<pre>${lines.join('\n')}</pre>${page.footer?headerHTML(page.footer,p+1):''}</section>`);
    if(p%30===29)await new Promise(r=>setTimeout(r,0));
  }
  const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(name)}</title><style>@page{size:${dimensions.width}in ${dimensions.height}in;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{color:#000;background:#fff;font:${renderer.font};line-height:${renderer.lineHeight}px}.page{width:${dimensions.width}in;height:${dimensions.height}in;padding:${page.top}in ${page.right}in ${page.bottom}in ${page.left}in;display:flex;flex-direction:column;break-after:page;overflow:hidden}.page:last-child{break-after:auto}pre{font:inherit;line-height:inherit;white-space:pre;tab-size:8;margin:0;flex:1}.hf{height:${renderer.lineHeight*2}px;display:grid;grid-template-columns:1fr 1fr 1fr;flex-shrink:0;white-space:pre}.hf span:nth-child(2){text-align:center}.hf span:nth-child(3){text-align:right}</style></head><body>${pages.join('')}</body></html>`);doc.close();await doc.fonts.ready;return{pages:count,rows:rows.length};
}
