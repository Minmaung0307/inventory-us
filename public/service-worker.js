const CACHE = 'inventory-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=> k===CACHE?null:caches.delete(k))))
  );
});
self.addEventListener('fetch', (e)=>{
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(cached=> cached || fetch(request).then(resp=>{
      const copy = resp.clone();
      caches.open(CACHE).then(c=> c.put(request, copy)).catch(()=>{});
      return resp;
    }).catch(()=> cached))
  );
});