const CACHE = 'geometry-lab-v5';
const ASSETS = ['./','./index.html','./geometry.js?v=5','./csg.js?v=5','./advanced.js?v=5','./library.js?v=5','./panel.js?v=5','../app.min.js?v=5','./icon.svg','./manifest.json','./study-sources.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => Promise.all(ASSETS.map(asset => cache.add(asset).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE &&
      (key.startsWith('geometry-lab-') || key === 'geometry-v1' || key === 'geometry-v2'))
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
