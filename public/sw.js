// Guarda la app en el teléfono: después de la primera visita abre al instante y sin gastar
// datos, aunque la señal esté fatal (solo hace falta la conexión al repetidor, que es diminuta).
// VERSION la pone el workflow de Pages con el commit: cada publicación se descarga una sola vez.
const VERSION = 'dev';
const CACHE = 'aya-' + VERSION;
// test/sw.mjs revisa que esta lista coincida con lo que hay en public/
const FILES = [
  './',
  'icon.svg',
  'css/style.css',
  'js/app.js',
  'js/audio.js',
  'js/critters.js',
  'js/mqtt.js',
  'js/rtc.js',
  'js/net.js',
  'js/room-core.js',
  'js/games/gato.js',
  'js/games/gato-rules.js',
  'js/games/billar.js',
  'js/games/billar-rules.js',
  'js/games/billar-physics.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = saltarse la caché HTTP (si no, podían mezclarse archivos de dos versiones)
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('aya-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith((async () => {
    // ignoreSearch: la página llega como ./?s=CODIGO
    const hit = await caches.match(r, { cacheName: CACHE, ignoreSearch: true });
    return hit || fetch(r);
  })());
});
