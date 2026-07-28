// Budget Planner Service Worker
// Add this file to your GitHub Pages repo alongside index.html
const CACHE = 'budget-planner-v2';

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(['./index.html', './']);
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return clients.claim(); })
  );
});

// Network-first: always try to fetch the freshest copy so a new deploy
// (and its bumped __APP_VERSION) is visible the moment the app is opened.
// Cache is only a fallback for offline use.
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function(res) {
      if (res && res.status === 200) {
        caches.open(CACHE).then(function(cache) { cache.put(e.request, res.clone()); });
      }
      return res;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
