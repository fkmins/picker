/* Flipkart Minutes Service Worker — v16
 *  - Shell files: network-first with 3.5s fallback to cache
 *  - CDN / fonts / images: stale-while-revalidate
 *  - Google Apps Script API calls: bypass cache
 */
var VERSION = 'v16';
var SHELL_CACHE = 'fk-shell-' + VERSION;
var STATIC_CACHE = 'fk-static-' + VERSION;
var STATIC_MAX = 50;
var NET_TIMEOUT = 3500;
var SHELL = [
  './',
  'index.html',
  'completion.html',
  'common.css',
  'common.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/disprz.logo.webp'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(
        SHELL.map(function (u) {
          return cache.add(new Request(u, { cache: 'reload' })).catch(function () {});
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== SHELL_CACHE && k !== STATIC_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function isApi(url) {
  return url.hostname.indexOf('script.google.com') !== -1 || url.hostname.indexOf('googleusercontent.com') !== -1;
}

function trim(cache) {
  return cache.keys().then(function (keys) {
    return Promise.all(
      keys.slice(0, Math.max(0, keys.length - STATIC_MAX)).map(function (k) { return cache.delete(k); })
    );
  });
}

function fromCache(req) {
  return caches.match(req, { ignoreSearch: req.mode === 'navigate' });
}

function networkFirst(event, req) {
  var network = fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then(function (c) { return c.put(req, copy); }));
    }
    return res;
  });
  event.waitUntil(network.catch(function () {}));

  var slow = new Promise(function (resolve) { setTimeout(resolve, NET_TIMEOUT); })
    .then(function () { return fromCache(req).then(function (hit) { return hit || network; }); });

  return Promise.race([network, slow]).catch(function () {
    return fromCache(req).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html').then(function (h) { return h || Response.error(); });
      return Response.error();
    });
  });
}

function staleWhileRevalidate(event, req) {
  var network = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      var copy = res.clone();
      return caches.open(STATIC_CACHE)
        .then(function (c) { return c.put(req, copy).then(function () { return trim(c); }); })
        .catch(function () {})
        .then(function () { return res; });
    }
    return res;
  });
  event.waitUntil(network.catch(function () {}));
  return caches.match(req).then(function (cached) {
    return cached || network;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.protocol.indexOf('http') !== 0 || isApi(url)) return;
  if (url.origin === self.location.origin && /manifest\.json$/.test(url.pathname)) return;

  event.respondWith(url.origin === self.location.origin ? networkFirst(event, req) : staleWhileRevalidate(event, req));
});
