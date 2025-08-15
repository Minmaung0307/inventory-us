/* service-worker.js */
const CACHE = "inv-cache-v3";
const CORE = [
  "/", "index.html", "styles.css", "app.js",
  "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png"
];

// Install: pre-cache core
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for GET; ignore HEAD/POST/etc.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // avoid HEAD crash & non-idempotent methods

  event.respondWith(
    caches.match(req).then((hit) => {
      const fetchPromise = fetch(req).then((net) => {
        // Only cache successful, basic same-origin GET responses
        if (net && net.ok && net.type === "basic") {
          const copy = net.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(()=>{});
        }
        return net;
      }).catch(() => hit); // offline -> use cache
      return hit || fetchPromise;
    })
  );
});