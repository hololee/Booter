
const CACHE_NAME = 'booter-cache-v1';
const urlsToCache = [
  '/',
  '/offline',
  '/static/css/style.css',
  '/static/js/main-controller.js',
  '/static/js/pc-manager.js',
  '/static/js/ui-manager.js',
  '/static/js/vm-manager.js',
  '/static/js/websocket-manager.js',
  '/static/resources/logo.svg',
  '/static/resources/favicon_light.svg',
  '/static/resources/favicon_dark.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).catch(() => {
          return caches.match('/offline');
        });
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
