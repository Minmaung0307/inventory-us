/* Minimal, safe SW: cache on install; respond with cache-first for GET requests.
   Avoids using HEAD (fixes the earlier Cache.put HEAD error). */
const CACHE = 'inv-cache-v3';
const ASSETS = [
  '/', 'index.html',
  'css/styles.css', 'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE && caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return; // never cache non-GET
  e.respondWith(
    caches.match(request).then(res => res || fetch(request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(request, copy)).catch(()=>{});
      return r;
    }).catch(()=> caches.match('/')))
  );
});