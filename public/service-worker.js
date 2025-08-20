const CACHE = 'inv-spa-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (/gstatic|firebaseio|firebase|emailjs\.com/.test(url.hostname)) return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fetched = fetch(e.request).then(r=>{
        const copy = r.clone();
        caches.open(CACHE).then(c=> c.put(e.request, copy)).catch(()=>{});
        return r;
      }).catch(()=> cached);
      return cached || fetched;
    })
  );
});