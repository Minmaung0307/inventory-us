/* Minimal, safe SW: only caches GET; skips HEAD/POST; avoids the image-upload crash */
const CACHE_NAME = 'inv-cache-v4';
const PRECACHE = [
  '/',           // if your server serves index.html at /
  './index.html',
  './css/styles.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .catch(() => {}) // don’t fail install on precache errors
  );
});

self.addEventListener('activate', (event) => {
  clients.claim();
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) {
    return; // let the network handle it
  }

  event.respondWith((async () => {
    // try cache first
    const cached = await caches.match(req);
    if (cached) return cached;

    // then network
    try {
      const res = await fetch(req);
      // Only cache successful, basic (same-origin) GET responses
      if (res && res.status === 200 && res.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        // Avoid cloning/caching opaque or streaming bodies incorrectly
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Optional: offline fallback for root
      if (req.mode === 'navigate') {
        const offline = await caches.match('/index.html');
        if (offline) return offline;
      }
      throw err;
    }
  })());
});