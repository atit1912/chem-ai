// ChemNexus AI 4.1 — Service Worker
// พัฒนาโปรแกรมโดย ธุรกิจพันธุ์กุ้งขาว 2
// Strategy: หน้าแอป + chemicals.json = network-first (อัปโหลดแล้วเห็นทันที, ออฟไลน์ใช้ของในแคช)
//           ไฟล์อื่นของเว็บ = cache-first
const CACHE_NAME = 'chemnexus-v4.1.0';
const CACHE_URLS = [
  './index.html',
  './manifest.json',
];
const NETWORK_FIRST = (url) =>
  url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/chemicals.json');
// External resources to cache when available
const EXTERNAL_CACHE = [
  'https://fonts.googleapis.com/css2?family=Sarabun',
  'https://unpkg.com/@phosphor-icons/web',
];
// ── INSTALL ── cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      return cache.addAll(CACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});
// ── ACTIVATE ── clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});
// ── FETCH ── serve from cache, fallback to network
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  // Skip chrome-extension and other non-http
  if (!request.url.startsWith('http')) return;
  // หน้าแอป + chemicals.json: network-first
  if (url.origin === self.location.origin && NETWORK_FIRST(url)) {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          const key = url.pathname.endsWith('/chemicals.json') ? './chemicals.json' : request;
          caches.open(CACHE_NAME).then(cache => cache.put(key, copy));
        }
        return response;
      }).catch(() =>
        caches.match(url.pathname.endsWith('/chemicals.json') ? './chemicals.json' : request)
          .then(r => r || caches.match('./index.html'))
      )
    );
    return;
  }
  // App shell + known externals: cache-first
  if (
    url.origin === self.location.origin ||
    EXTERNAL_CACHE.some(u => request.url.startsWith(u.split('?')[0]))
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // Serve from cache, update in background
          fetch(request)
            .then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME).then(cache => cache.put(request, response));
              }
            })
            .catch(() => {});
          return cached;
        }
        // Not in cache — fetch and cache it
        return fetch(request).then(response => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          return response;
        }).catch(() => {
          // Offline fallback for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
    );
    return;
  }
  // Firestore API calls: network-first (Firebase SDK handles offline internally)
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com')) {
    event.respondWith(fetch(request).catch(() => new Response('', {status: 503})));
    return;
  }
  // Everything else: network-first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
// ── MESSAGE ── handle skip-waiting from client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
