// ChemNexus AI 3.0 — Service Worker
// Developed by Atit Chimnan
// Strategy: Cache-first for app shell, network-first for external resources

const CACHE_NAME = 'chemnexus-v3.8.0';
const CACHE_URLS = [
  './index.html',
  './manifest.json',
  './firebase-config.js',
];

// External resources to cache when available
const EXTERNAL_CACHE = [
  'https://fonts.googleapis.com/css2?family=Sarabun',
  'https://unpkg.com/@phosphor-icons/web',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics-compat.js',
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
