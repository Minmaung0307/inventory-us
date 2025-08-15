/* Simple, safe PWA service worker (GET-only caching) */
const CACHE = 'inventory-cache-v5';
const CORE_ASSETS = [
  '/', '/index.html', 'css/styles.css', 'js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never cache non-GET (avoids HEAD error)

  const url = new URL(req.url);

  // same-origin: cache-first, then network
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return resp;
        }).catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  // cross-origin (e.g., YouTube): network-only
  // Don’t attempt to cache or modify; avoids CORS/opaque issues.
});