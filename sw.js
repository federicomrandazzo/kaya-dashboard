// Service worker del dashboard de Kaya.
// Regla de oro: NUNCA servir el index.html desde cache si hay red. El tablero se
// actualiza seguido y una version vieja cacheada es peor que no tener app.
// - HTML/JS propio -> network-first (cache solo como salvavidas sin senal)
// - logo e iconos   -> cache-first (no cambian)
// - Google Sheets / Apps Script -> ni se tocan (siempre red)
const CACHE = 'kaya-v2';
const ASSETS = ['./logo-kaya.png', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // datos de Google: siempre red

  const esEstatico = ASSETS.some(a => url.pathname.endsWith(a.replace('./', '')));
  if (esEstatico) {
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./')))
  );
});
