/* Simple offline cache with stale-while-revalidate */
const CACHE = 'inv-cache-v8';
const CORE = [
  '/', 'index.html',
  'css/styles.css',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=> k===CACHE?null:caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(cached=>{
      const fetchPromise = fetch(req).then(netRes=>{
        const copy = netRes.clone();
        caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
        return netRes;
      }).catch(()=> cached || Promise.reject('offline'));
      return cached || fetchPromise;
    })
  );
});