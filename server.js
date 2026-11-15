// aquí y allá — servidor local de desarrollo (solo archivos estáticos)
// En producción la página vive en GitHub Pages y los navegadores se hablan por un
// repetidor MQTT público (ver public/js/net.js). Esto solo sirve public/ comprimido y con
// ETag para probar en tu compu: npm start → http://localhost:3000

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = import.meta.dirname;
const PUB = path.join(ROOT, 'public');

/* ───────────── estáticos ───────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};
const cache = new Map(); // ruta -> { mtime, type, raw, br, gz, etag }

async function getFile(rel) {
  const abs = path.join(PUB, rel);
  if (!abs.startsWith(PUB + path.sep)) return null;
  let st;
  try { st = await stat(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const hit = cache.get(abs);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const raw = await readFile(abs);
  const type = MIME[path.extname(abs)] || 'application/octet-stream';
  const compressible = /text|javascript|json|svg|manifest/.test(type);
  const entry = {
    mtime: st.mtimeMs,
    type,
    raw,
    br: compressible ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) : null,
    gz: compressible ? zlib.gzipSync(raw, { level: 9 }) : null,
    etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16) + '"',
  };
  cache.set(abs, entry);
  return entry;
}

const server = http.createServer((req, res) => {
  // una URL malformada nunca debe tumbar el servidor
  serveStatic(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('petición inválida');
  });
});

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/healthz') { res.writeHead(200).end('ok'); return; }

  const f = await getFile(path.normalize(p).replace(/^([/\\])+/, ''));
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }).end('no existe'); return; }

  const headers = {
    'content-type': f.type,
    'etag': f.etag,
    // siempre revalidar: si no cambió, la respuesta es un 304 de ~100 bytes
    'cache-control': 'no-cache',
    'vary': 'accept-encoding',
    'x-content-type-options': 'nosniff',
  };
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers).end(); return; }

  const ae = req.headers['accept-encoding'] || '';
  let body = f.raw;
  if (f.br && ae.includes('br')) { body = f.br; headers['content-encoding'] = 'br'; }
  else if (f.gz && ae.includes('gzip')) { body = f.gz; headers['content-encoding'] = 'gzip'; }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

server.listen(PORT, () => {
  console.log(`
  aquí y allá ♥  http://localhost:${PORT}
`);
});
