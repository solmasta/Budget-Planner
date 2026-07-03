// Budget Planner Service Worker
// Add this file to your GitHub Pages repo alongside index.html
const CACHE = 'budget-planner-v1';

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

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var network = fetch(e.request).then(function(res) {
        if (res && res.status === 200) {
          caches.open(CACHE).then(function(cache) { cache.put(e.request, res.clone()); });
        }
        return res;
      }).catch(function() { return cached; });
      return cached || network;
    })
  );
});
