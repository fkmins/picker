const CACHE_NAME = 'fk-minutes-cache-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  
  // Bypass Service Worker caching for the Google Apps Script API & Browser Extensions
  if (url.hostname.includes('script.google.com') || !url.protocol.startsWith('http')) {
    return; 
  }

  // Stale-While-Revalidate for UI Assets (Instant loading on phones)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // FIX: Clone the response IMMEDIATELY before doing any async cache operations
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
         // Ignore network errors on background asset updates
      });
      return cachedResponse || fetchPromise;
    })
  );
});
