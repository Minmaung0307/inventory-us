/* Inventory PWA Service Worker (safe clone + caching) */
const CACHE = 'inv-cache-v3';

const CORE_ASSETS = [
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/contact.html',
  '/policy.html',
  '/license.html',
  '/setup-guide.html',
  '/guide.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET; leave POST/PUT/etc to the network.
  if (req.method !== 'GET') return;

  // Navigation / HTML -> network-first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const network = await fetch(req);
        // Clone immediately, then cache in background
        const copy = network.clone();
        event.waitUntil(
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        );
        return network;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || caches.match('/index.html');
      }
    })());
    return;
  }

  // Static assets -> cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const network = await fetch(req);

      // Only cache same-origin, basic 200 responses (avoid opaque/cross-origin)
      const sameOrigin = new URL(req.url).origin === self.location.origin;
      if (sameOrigin && network && network.ok && network.type === 'basic') {
        const copy = network.clone();
        event.waitUntil(
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        );
      }
      return network;
    } catch (err) {
      // total failure -> return whatever we had (likely undefined)
      return cached;
    }
  })());
});

// Optional: allow page to tell SW to activate immediately
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});