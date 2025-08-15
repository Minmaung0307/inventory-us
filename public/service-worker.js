
/* Minimal, safe SW: cache only GET requests; never cache opaque/HEAD/POST/etc. */
const CACHE_NAME = 'inv-cache-v3';
const ASSETS = [
  '/',            // if you serve index.html at /
  '/index.html',
  'css/styles.css',
  'js/app.js',
  'https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css',
  // optional: icons
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  // Avoid data: images and chrome-extension, etc.
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Network-first for navigation; cache-first for same-origin files
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
        return res;
      }).catch(async () => {
        const cached = await caches.match(req);
        return cached || caches.match('/index.html');
      })
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        // only cache "basic" same-origin successful responses
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});