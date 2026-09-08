import * as Rope from './rope.mjs';
export class TextModel {
  constructor(text = '') {
    this.root = Rope.fromText(Rope.normalize(text)); this.savedRoot = this.root;
    this.anchor = 0; this.head = 0; this.revision = 0; this.undoStack = []; this.redoStack = [];
    this.listeners = new Set(); this.group = null; this.historyLimit = 256;
  }
  get length() { return Rope.length(this.root); }
  get lineCount() { return Rope.lineCount(this.root); }
  get dirty() { return this.root !== this.savedRoot; }
  get start() { return Math.min(this.anchor, this.head); }
  get end() { return Math.max(this.anchor, this.head); }
  get selectedText() { return this.slice(this.start, this.end); }
  slice(start = 0, end = this.length) { return Rope.slice(this.root, start, end); }
  positionAt(offset = this.head) { return Rope.positionAt(this.root, offset); }
  offsetAt(line, column = 0) { return Rope.offsetAt(this.root, line, column); }
  lineStart(line) { return Rope.lineStart(this.root, line); }
  lineEnd(line) { return line < this.lineCount - 1 ? this.lineStart(line + 1) - 1 : this.length; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(event) { for (const fn of this.listeners) fn(event); }
  select(anchor, head = anchor) {
    if (!Number.isFinite(anchor) || !Number.isFinite(head)) throw new TypeError('Selection offsets must be finite');
    this.anchor = Math.max(0, Math.min(this.length, Math.trunc(anchor)));
    this.head = Math.max(0, Math.min(this.length, Math.trunc(head)));
    this.group = null; this.emit({type: 'selection'});
  }
  snapshot() { return {root: this.root, anchor: this.anchor, head: this.head}; }
  remember(kind = 'edit', start = -1) {
    const now = Date.now();
    const grouped = kind === 'typing' && this.group?.kind === kind && now - this.group.time < 800 && this.group.end === start;
    if (!grouped) { this.undoStack.push(this.snapshot()); if (this.undoStack.length > this.historyLimit) this.undoStack.shift(); }
    this.redoStack.length = 0; this.group = {kind, time: now, end: start};
  }
  edit(start, end, text, kind = 'edit') {
    text = Rope.normalize(text);
    if (start === end && !text.length) return;
    const next = Rope.replace(this.root, start, end, text);
    this.remember(kind, start); this.root = next; this.anchor = this.head = start + text.length;
    if (this.group) this.group.end = this.head;
    this.revision++; this.emit({type: 'edit', start, end, text});
  }
  insert(text, kind = 'edit') { this.edit(this.start, this.end, text, kind); }
  applyEdits(edits, expectedRevision = this.revision) {
    if (expectedRevision !== this.revision) throw new Error(`Revision conflict: expected ${expectedRevision}, current ${this.revision}`);
    const sorted = edits.map(e => ({...e, text: Rope.normalize(e.text)})).sort((a,b) => a.start - b.start || a.end - b.end);
    let priorEnd = -1;
    for (const e of sorted) {
      if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end < e.start || e.end > this.length || e.start < priorEnd) throw new RangeError('Edits must be valid, non-overlapping ranges in the original document');
      priorEnd = e.end;
    }
    if (!sorted.length) return;
    let next = this.root;
    for (let i = sorted.length - 1; i >= 0; i--) { const e = sorted[i]; next = Rope.replace(next, e.start, e.end, e.text); }
    this.remember(); this.root = next; this.head = this.anchor = Math.min(this.head, this.length); this.revision++;
    this.emit({type: 'batch', edits: sorted});
  }
  replaceRoot(root, kind = 'replaceAll') {
    if (root === this.root) return;
    this.remember(kind); this.root = root; this.anchor = this.head = Math.min(this.head, this.length);
    this.revision++; this.emit({type: 'reset'});
  }
  load(root, markSaved = true) {
    this.root = typeof root === 'string' ? Rope.fromText(Rope.normalize(root)) : root;
    this.savedRoot = markSaved ? this.root : Symbol('unsaved');
    this.anchor = this.head = 0; this.undoStack = []; this.redoStack = []; this.group = null;
    this.revision++; this.emit({type: 'reset'});
  }
  markSaved(root = this.root) { this.savedRoot = root; this.emit({type: 'saved'}); }
  undo() {
    const state = this.undoStack.pop(); if (!state) return false;
    this.redoStack.push(this.snapshot()); Object.assign(this, state); this.group = null;
    this.revision++; this.emit({type: 'reset'}); return true;
  }
  redo() {
    const state = this.redoStack.pop(); if (!state) return false;
    this.undoStack.push(this.snapshot()); Object.assign(this, state); this.group = null;
    this.revision++; this.emit({type: 'reset'}); return true;
  }
  find(query, options = {}) { return Rope.find(this.root, Rope.normalize(query), {from: this.end, ...options}); }
  replaceAll(query, replacement, options = {}) {
    const result = Rope.replaceAll(this.root, Rope.normalize(query), replacement, options);
    if (result.count) this.replaceRoot(result.root); return result.count;
  }
}
