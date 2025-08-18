/* Simple, safe cache for static assets (GET only) */
const CACHE = 'inv-cache-v3';
const ASSETS = [
  '/', '/index.html', '/css/styles.css', '/js/app.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', (e)=>{
  if (e.request.method!=='GET') return; // don’t cache POST/PUT/etc
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).then(net=>{
      const copy = net.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return net;
    }).catch(()=>r))
  );
});