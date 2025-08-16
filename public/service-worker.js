// super-safe, GET-only cache with SW update on next load
const CACHE = 'inv-app-v1';
const ASSETS = [
  './', 'index.html', 'css/styles.css', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg',
  'about.html','policy.html','license.html','guide.html','setup-guide.html','contact.html',
  'manifest.webmanifest'
];

self.addEventListener('install', (e)=> {
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e)=> {
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e)=> {
  if (e.request.method !== 'GET') return; // no HEAD/POST/etc
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp=>{
      const copy = resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return resp;
    }).catch(()=> cached || new Response('Offline', {status:200,headers:{'Content-Type':'text/plain'}})))
  );
});