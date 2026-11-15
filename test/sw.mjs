// La lista de sw.js debe tener todos los archivos de public/ (si falta uno, sin señal no abriría)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(root).map((f) => relative(root, f).split(sep).join('/')).filter((f) => f !== 'sw.js').map((f) => (f === 'index.html' ? './' : f)).sort();
const src = readFileSync(join(root, 'sw.js'), 'utf8');
if (!/const VERSION = 'dev';/.test(src)) throw new Error("sw.js: falta const VERSION = 'dev'; (el workflow la reemplaza)");
const listed = [...src.match(/const FILES = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
const missing = files.filter((f) => !listed.includes(f)), extra = listed.filter((f) => !files.includes(f));
if (missing.length || extra.length) { console.error('sw.js FILES desactualizada', { missing, extra }); process.exit(1); }
console.log(`✓ sw.js guarda los ${listed.length} archivos de la app`);
