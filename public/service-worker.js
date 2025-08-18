/* Simple offline cache with version bumping.
   Cache-first for same-origin GET; bypass POST/PUT; skip opaque cross-origin. */
const VERSION = 'v7';
const ASSETS = [
  '/', '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
  '/about.html','/policy.html','/license.html','/guide.html','/setup-guide.html','/contact.html',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(
    caches.open(VERSION).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if (req.method !== 'GET') return; // don’t cache writes
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // keep it simple

  e.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req).then(res=>{
        if (!res || res.status !== 200) return res;
        const copy = res.clone();
        caches.open(VERSION).then(c=>c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=>cached);
    })
  );
});