// Minimal, safe GET-only cache
const CACHE = 'inv-cache-v3';
const ASSETS = [
  '/', '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
  '/about.html', '/policy.html', '/license.html', '/guide.html', '/setup-guide.html',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e)=>{
  if (e.request.method !== 'GET') return; // don't handle POST/PUT
  e.respondWith(
    caches.match(e.request).then((hit)=>{
      const fetcher = fetch(e.request).then(res=>{
        try{
          const copy = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
        }catch{}
        return res;
      }).catch(()=> hit || caches.match('/index.html'));
      return hit || fetcher;
    })
  );
});