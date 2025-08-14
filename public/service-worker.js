const CACHE = 'inv-v7';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Very important: only SPA-fallback for real navigations.
// Never return index.html for scripts, css, images, etc.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Let non-GET (POST/PUT/HEAD) go straight through (fixes your HEAD error).
  if (req.method !== 'GET') return;

  // Navigations → network first, fallback to cached index.html when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets → cache-first, then network, and cache successful basic responses
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Only cache good same-origin/basic responses
        const copy = resp.clone();
        if (copy.ok && copy.type === 'basic') {
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});