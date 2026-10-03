/* FK Minutes service worker
 *  - same-origin app files : network-first (updates reach users immediately), cache fallback offline
 *  - CDN / fonts / images  : stale-while-revalidate
 *  - Apps Script API calls : never touched
 */
var VERSION = 'v10';
var SHELL_CACHE = 'fk-shell-' + VERSION;
var STATIC_CACHE = 'fk-static-' + VERSION;
var SHELL = [
  './', 'index.html', 'completion.html', 'common.css', 'common.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

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
  return url.hostname.indexOf('script.google.com') !== -1 ||
         url.hostname.indexOf('googleusercontent.com') !== -1;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.protocol.indexOf('http') !== 0 || isApi(url)) return;
  /* manifest.json: always straight from the network so icon / name changes propagate */
  if (url.origin === self.location.origin && /manifest\.json$/.test(url.pathname)) return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then(function (c) { return c.put(req, copy); }));
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined);
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          var copy = res.clone();
          event.waitUntil(caches.open(STATIC_CACHE).then(function (c) { return c.put(req, copy); }));
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});

self.addEventListener('message', function (event) {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }));
  }
});
