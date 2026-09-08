// One-time, hash-checked source assembly for the initial repository import.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, '.bootstrap/manifest.json'), 'utf8'));
const allowed = new Set(['src/app.mjs', 'src/style.css']);
for (const entry of manifest) {
  if (!allowed.delete(entry.path)) throw new Error(`Unexpected or repeated target: ${entry.path}`);
  const pieces = [];
  for (const part of entry.parts) {
    if (!/^\.bootstrap\/(?:app\.mjs|style\.css)\.\d{2}\.part$/.test(part)) throw new Error('Invalid part path');
    pieces.push(await fs.readFile(path.join(root, part)));
  }
  const bytes = Buffer.concat(pieces);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Integrity check failed: ${entry.path}`);
  const target = path.join(root, entry.path);
  try {
    const existing = await fs.readFile(target);
    if (!existing.equals(bytes)) throw new Error(`Refusing to overwrite a different file: ${entry.path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(target, bytes, {flag: 'wx'});
  }
  console.log(`Verified ${entry.path}: ${bytes.length} bytes`);
}
if (allowed.size) throw new Error('The source manifest is incomplete');
