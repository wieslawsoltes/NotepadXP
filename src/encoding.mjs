import * as Rope from './rope.mjs';
export const ENCODINGS = [['ansi','ANSI'],['utf-16le','Unicode'],['utf-16be','Unicode big endian'],['utf-8','UTF-8']];
export const CODEPAGES = ['windows-1252','windows-1250','windows-1251','windows-1253','windows-1254','windows-1255','windows-1256','windows-1257','windows-1258'];
// WHATWG Windows-1252 index. A few small-ICU Node builds alias the
// decoder to Latin-1; keep the same result in those runtimes and browsers.
const CP1252 = [0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,
  0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,
  0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,
  0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178].map(c=>String.fromCharCode(c));
const native1252 = new TextDecoder('windows-1252').decode(new Uint8Array([128])) === '€';
function decode(bytes, label) {
  const text = new TextDecoder(label, {ignoreBOM:true}).decode(bytes);
  return label === 'windows-1252' && !native1252
    ? text.replace(/[\x80-\x9f]/g, c=>CP1252[c.charCodeAt(0)-128]) : text;
}
const codeMaps = new Map();
function encoderMap(codepage) {
  if (!CODEPAGES.includes(codepage)) throw new Error('Unsupported ANSI code page');
  if (codeMaps.has(codepage)) return codeMaps.get(codepage);
  const map = new Map();
  for (let i = 0; i < 256; i++) { const char = decode(new Uint8Array([i]), codepage); if (char !== '\ufffd') map.set(char, i); }
  codeMaps.set(codepage, map); return map;
}
export function detectEncoding(bytes, requested = 'auto', codepage = 'windows-1252') {
  if (requested !== 'auto' && !ENCODINGS.some(([v]) => v === requested)) throw new Error('Unsupported encoding');
  let encoding = requested, bom = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = requested === 'auto' ? 'utf-16le' : requested; bom = encoding === 'utf-16le' ? 2 : 0; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = requested === 'auto' ? 'utf-16be' : requested; bom = encoding === 'utf-16be' ? 2 : 0; }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { encoding = requested === 'auto' ? 'utf-8' : requested; bom = encoding === 'utf-8' ? 3 : 0; }
  if (encoding === 'auto') {
    // Conservative BOM-less UTF-16 detection, without XP's destructive heuristic.
    let even = 0, odd = 0; const n = Math.min(bytes.length, 8192) & ~1;
    for (let i = 0; i < n; i += 2) { if (!bytes[i]) even++; if (!bytes[i+1]) odd++; }
    if (n >= 4 && odd > n * .2 && even < n * .02) encoding = 'utf-16le';
    else if (n >= 4 && even > n * .2 && odd < n * .02) encoding = 'utf-16be';
    else encoding = 'ansi';
  }
  return {encoding, bom, decoder: encoding === 'ansi' ? codepage : encoding};
}
export function decodeBytes(bytes, requested = 'auto', codepage = 'windows-1252') {
  let info = detectEncoding(bytes, requested, codepage);
  if (requested === 'auto' && info.encoding === 'ansi') {
    try {
      const utf = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      if (/[^\x00-\x7f]/.test(utf)) info = {encoding:'utf-8', bom:0, decoder:'utf-8'};
    } catch { /* Legacy single-byte text. */ }
  }
  const text = decode(bytes.subarray(info.bom), info.decoder);
  const first = text.match(/\r\n|\r|\n/), eol = first ? first[0] === '\r\n' ? 'CRLF' : first[0] === '\r' ? 'CR' : 'LF' : 'CRLF';
  return {text:Rope.normalize(text), encoding:info.encoding, eol, bom:!!info.bom};
}
export function encodeText(text, encoding = 'utf-8', {codepage='windows-1252', allowLossy=false} = {}) {
  if (encoding === 'utf-8') return new TextEncoder().encode(text);
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const bytes = new Uint8Array(text.length * 2), be = encoding === 'utf-16be';
    for (let i=0; i<text.length; i++) { const c=text.charCodeAt(i); bytes[i*2+(be?1:0)]=c&255; bytes[i*2+(be?0:1)]=c>>>8; }
    return bytes;
  }
  if (encoding !== 'ansi') throw new Error('Unsupported encoding');
  const map = encoderMap(codepage), result=[];
  for (const char of text) { const value=map.get(char); if (value === undefined && !allowLossy) throw new Error(`This file contains characters that cannot be saved in ${codepage}. Choose Unicode or UTF-8 to preserve your text.`); result.push(value ?? 63); }
  return new Uint8Array(result);
}
export function* encodeChunks(root, encoding='ansi', {eol='CRLF', bom=true, codepage='windows-1252', allowLossy=false} = {}) {
  if (bom) {
    if (encoding==='utf-8') yield new Uint8Array([239,187,191]);
    else if (encoding==='utf-16le') yield new Uint8Array([255,254]);
    else if (encoding==='utf-16be') yield new Uint8Array([254,255]);
  }
  let pending='';
  for (let text of Rope.chunks(root)) {
    text=pending+text; pending='';
    const last=text.charCodeAt(text.length-1);
    if (last>=0xd800 && last<=0xdbff) { pending=text.slice(-1); text=text.slice(0,-1); }
    if (eol==='CRLF') text=text.replace(/\n/g,'\r\n'); else if (eol==='CR') text=text.replace(/\n/g,'\r');
    if (text) yield encodeText(text,encoding,{codepage,allowLossy});
  }
  if (pending) yield encodeText(pending,encoding,{codepage,allowLossy});
}
export function encodedBlob(root, encoding, options) { return new Blob([...encodeChunks(root,encoding,options)],{type:'text/plain'}); }
