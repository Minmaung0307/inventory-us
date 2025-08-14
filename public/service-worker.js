/* service-worker.js — robust, GET-only, same-origin cache
   Bump CACHE_NAME when you deploy new builds to invalidate old caches. */
const CACHE_NAME = 'inv-cache-v7';
const CORE_ASSETS = [
  '/',                // if you serve index at /
  '/index.html',      // keep both for safety; one will match in your setup
  '/styles.css',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/license.html',
  '/policy.html',
  '/setup-guide.html',
  '/guide.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.addAll(CORE_ASSETS); } catch (_) { /* don’t crash on first run */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => (n !== CACHE_NAME ? caches.delete(n) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests. Let the browser do the rest.
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // For navigation: network-first with cached fallback
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(()=>{});
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(req))
            || (await cache.match('/index.html'))
            || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // For static assets: cache-first, then update in background (stale-while-revalidate)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then(resp => {
      // Only cache successful same-origin/basic responses
      if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'default')) {
        cache.put(req, resp.clone()).catch(()=>{});
      }
      return resp;
    }).catch(() => null);

    // serve cache if present, else wait for network, else give a light fallback
    if (cached) return cached;
    const net = await networkPromise;
    if (net) return net;

    // Optional image fallback
    if (req.destination === 'image') {
      const fallback = await cache.match('/icons/icon-512.png');
      if (fallback) return fallback;
    }
    return new Response('', { status: 404 });
  })());
});