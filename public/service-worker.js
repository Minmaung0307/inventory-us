/* /service-worker.js */
const CACHE = 'inv-app-v3';
const ASSETS = [
  '/', '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.webmanifest?v=3',
  '/icons/icon-192.png?v=3',
  '/icons/icon-512.png?v=3',
  '/icons/icon-512-maskable.png?v=3',
  '/icons/apple-touch-icon.png?v=3',
  '/apple-touch-icon.png?v=3'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});