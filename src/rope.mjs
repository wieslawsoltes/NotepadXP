/* Persistent AVL piece rope. All positions are UTF-16 code-unit offsets.
 * Leaves reference immutable source buffers; edits copy only logarithmic paths.
 * Line metrics make line lookup and horizontal extent independent of file size. */
const CHUNK = 32768;
const H = n => n?.height || 0;
const N = n => n?.length || 0;
const B = n => n?.newlines || 0;
function lowerBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
function source(text) {
  const found = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) found.push(i);
  return {text, breaks: new Uint32Array(found)};
}
function leaf(src, start = 0, length = src.text.length) {
  if (!length) return null;
  const lo = lowerBound(src.breaks, start), hi = lowerBound(src.breaks, start + length);
  const newlines = hi - lo;
  const prefix = newlines ? src.breaks[lo] - start : length;
  const suffix = newlines ? start + length - src.breaks[hi - 1] - 1 : length;
  let maxLine = Math.max(prefix, suffix);
  for (let i = lo + 1; i < hi; i++) maxLine = Math.max(maxLine, src.breaks[i] - src.breaks[i - 1] - 1);
  return {source: src, start, length, newlines, prefix, suffix, maxLine, lo, hi, height: 1, simple: /^[\x20-\x7e\n]*$/.test(src.text.slice(start,start+length))};
}
function branch(left, right) {
  if (!left) return right;
  if (!right) return left;
  return {left, right, simple: left.simple && right.simple, height: 1 + Math.max(H(left), H(right)), length: N(left) + N(right),
    newlines: B(left) + B(right), prefix: B(left) ? left.prefix : N(left) + right.prefix,
    suffix: B(right) ? right.suffix : N(right) + left.suffix,
    maxLine: Math.max(left.maxLine, right.maxLine, left.suffix + right.prefix)};
}
function balance(left, right) {
  if (H(left) > H(right) + 1) {
    if (H(left.left) >= H(left.right)) return branch(left.left, branch(left.right, right));
    return branch(branch(left.left, left.right.left), branch(left.right.right, right));
  }
  if (H(right) > H(left) + 1) {
    if (H(right.right) >= H(right.left)) return branch(branch(left, right.left), right.right);
    return branch(branch(left, right.left.left), branch(right.left.right, right.right));
  }
  return branch(left, right);
}
export function concat(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (H(left) > H(right) + 1) return balance(left.left, concat(left.right, right));
  if (H(right) > H(left) + 1) return balance(concat(left, right.left), right.right);
  return branch(left, right);
}
export function fromText(text) {
  if (typeof text !== 'string') throw new TypeError('Text must be a string');
  const leaves = [];
  for (let i = 0; i < text.length; i += CHUNK) leaves.push(leaf(source(text.slice(i, i + CHUNK))));
  function build(a, b) { if (b <= a) return null; if (b - a === 1) return leaves[a]; const m = (a + b) >>> 1; return branch(build(a, m), build(m, b)); }
  return build(0, leaves.length);
}
export function split(root, position) {
  if (!root) return [null, null];
  if (position <= 0) return [null, root];
  if (position >= N(root)) return [root, null];
  if (root.source) return [leaf(root.source, root.start, position), leaf(root.source, root.start + position, N(root) - position)];
  if (position < N(root.left)) { const [a, b] = split(root.left, position); return [a, concat(b, root.right)]; }
  const [a, b] = split(root.right, position - N(root.left));
  return [concat(root.left, a), b];
}
export function replace(root, start, end, inserted) {
  const length = N(root);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > length) throw new RangeError('Invalid text range');
  const [a, tail] = split(root, start); const [, b] = split(tail, end - start);
  return concat(concat(a, typeof inserted === 'string' ? fromText(inserted) : inserted), b);
}
export function* chunks(root, start = 0, end = N(root), base = 0) {
  if (!root || start >= end || end <= base || start >= base + N(root)) return;
  if (root.source) {
    const a = Math.max(0, start - base), b = Math.min(N(root), end - base);
    if (b > a) yield root.source.text.slice(root.start + a, root.start + b);
  } else { yield* chunks(root.left, start, end, base); yield* chunks(root.right, start, end, base + N(root.left)); }
}
export function slice(root, start = 0, end = N(root)) { return [...chunks(root, Math.max(0, start), Math.min(N(root), end))].join(''); }
export function subrope(root, start, end) { return split(split(root, end)[0], start)[1]; }
export function length(root) { return N(root); }
export function lineCount(root) { return B(root) + 1; }
export function lineStart(root, line) {
  if (line <= 0) return 0;
  if (line > B(root)) return N(root);
  let node = root, offset = 0, target = line - 1;
  while (node && !node.source) {
    if (target < B(node.left)) node = node.left;
    else { target -= B(node.left); offset += N(node.left); node = node.right; }
  }
  return offset + node.source.breaks[node.lo + target] - node.start + 1;
}
export function positionAt(root, offset) {
  offset = Math.max(0, Math.min(N(root), offset));
  let node = root, rest = offset, line = 0;
  while (node && !node.source) {
    if (rest < N(node.left)) node = node.left;
    else { rest -= N(node.left); line += B(node.left); node = node.right; }
  }
  if (node) line += lowerBound(node.source.breaks, node.start + rest) - node.lo;
  return {line, column: offset - lineStart(root, line)};
}
export function offsetAt(root, line, column = 0) {
  line = Math.max(0, Math.min(lineCount(root) - 1, line));
  const start = lineStart(root, line), end = line < B(root) ? lineStart(root, line + 1) - 1 : N(root);
  return start + Math.max(0, Math.min(end - start, column));
}
export function charAt(root, offset) { return slice(root, offset, offset + 1); }
export function normalize(text) { return text.replace(/\r\n?/g, '\n'); }
export function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* Scan bounded windows with query overlap. Match indexes remain UTF-16 offsets,
 * including case-insensitive Unicode matches (unlike lowercasing a whole file). */
export function* findMatches(root, query, {from = 0, to = N(root), matchCase = false} = {}) {
  if (!query) return;
  if (query.length > 65536) throw new RangeError('Search text is limited to 65,536 code units');
  const regex = new RegExp(escapeRegex(query), matchCase ? 'g' : 'gi');
  let accepted = Math.max(0, from); to = Math.min(N(root), to);
  for (let base = accepted; base < to; base += 65536) {
    const coreEnd = Math.min(to, base + 65536);
    const text = slice(root, base, Math.min(to, coreEnd + query.length - 1));
    regex.lastIndex = Math.max(0, accepted - base);
    let m;
    while ((m = regex.exec(text))) {
      const pos = base + m.index;
      if (pos >= coreEnd) break;
      if (pos + m[0].length <= to) { yield {start: pos, end: pos + m[0].length}; accepted = pos + m[0].length; }
      if (!m[0].length) regex.lastIndex++;
    }
  }
}
export function find(root, query, opts = {}) {
  if (opts.direction === 'up') {
    if (!query) return null;
    if (query.length > 65536) throw new RangeError('Search text is limited to 65,536 code units');
    const to = Math.min(N(root), opts.from ?? N(root));
    const regex = new RegExp(escapeRegex(query), opts.matchCase ? 'g' : 'gi');
    for (let end = to; end > 0; end -= 65536) {
      const start = Math.max(0, end - 65536 - query.length + 1);
      const text = slice(root, start, end); let found = null, match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text))) {found={start:start+match.index,end:start+match.index+match[0].length};regex.lastIndex=match.index+1;}
      if (found) return found;
    }
    return null;
  }
  return findMatches(root, query, opts).next().value || null;
}
export function replaceAll(root, query, replacement, opts = {}) {
  let output = null, cursor = 0, count = 0;
  const inserted = fromText(normalize(replacement));
  for (const m of findMatches(root, query, opts)) {
    output = concat(output, subrope(root, cursor, m.start));
    output = concat(output, inserted); cursor = m.end; count++;
  }
  if (!count) return {root, count: 0};
  return {root: concat(output, subrope(root, cursor, N(root))), count};
}
export function validate(root) {
  if (!root) return {length: 0, newlines: 0, height: 0};
  if (root.source) { if (root.length <= 0) throw new Error('Empty leaf'); return root; }
  validate(root.left); validate(root.right);
  const expected = branch(root.left, root.right);
  for (const key of ['length','newlines','height','prefix','suffix','maxLine']) if (root[key] !== expected[key]) throw new Error(`Bad ${key}`);
  if (Math.abs(H(root.left) - H(root.right)) > 1) throw new Error('Unbalanced rope');
  return root;
}

export function simpleRange(root,start=0,end=N(root),base=0) {
  if(!root||end<=base||start>=base+N(root))return true;
  if(root.simple)return true;
  if(root.source)return /^[\x20-\x7e\n]*$/.test(root.source.text.slice(root.start+Math.max(0,start-base),root.start+Math.min(root.length,end-base)));
  return simpleRange(root.left,start,end,base)&&simpleRange(root.right,start,end,base+N(root.left));
}
