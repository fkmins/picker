/* FK Minutes service worker
 *  - same-origin app files : network-first with a 4 s timeout (fresh when online, instant cache on weak signal / offline)
 *  - CDN / fonts / images  : stale-while-revalidate, capped cache size
 *  - Apps Script API calls : never touched
 */
var VERSION = 'v10';
var SHELL_CACHE = 'fk-shell-' + VERSION;
var STATIC_CACHE = 'fk-static-' + VERSION;
var STATIC_MAX = 40;                 // opaque cross-origin responses are expensive in the storage quota
var NET_TIMEOUT = 4000;
var SHELL = ['./', 'index.html', 'completion.html', 'common.css', 'common.js', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (u) {
        return cache.add(new Request(u, { cache: 'reload' })).catch(function () { /* a missing file must not block install */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE && k !== STATIC_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApi(url) {
  return url.hostname.indexOf('script.google.com') !== -1 || url.hostname.indexOf('googleusercontent.com') !== -1;
}

function trim(cache) {
  return cache.keys().then(function (keys) {
    return Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_MAX)).map(function (k) { return cache.delete(k); }));
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
  event.waitUntil(network.catch(function () {}));      // keep the worker alive so the cache update finishes

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
        .catch(function () { /* quota – ignore */ })
        .then(function () { return res; });
    }
    return res;
  });
  event.waitUntil(network.catch(function () {}));      // registered synchronously (calling it later can throw)
  return caches.match(req).then(function (cached) {
    return cached || network;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.protocol.indexOf('http') !== 0 || isApi(url)) return;
  /* manifest.json: always straight from the network so icon / name changes propagate */
  if (url.origin === self.location.origin && /manifest\.json$/.test(url.pathname)) return;

  event.respondWith(url.origin === self.location.origin ? networkFirst(event, req) : staleWhileRevalidate(event, req));
});
