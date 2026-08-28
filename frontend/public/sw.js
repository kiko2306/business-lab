/*
 * Minimal service worker for installability + a resilient app shell.
 *
 * Deliberately conservative: Angular emits content-hashed filenames, so
 * hashed assets are safe to cache immutably, but index.html and anything
 * under /api must always hit the network. Getting this wrong strands users
 * on a stale build, so the rules here are explicit rather than clever.
 */
const VERSION = 'v1';
const SHELL_CACHE = `homelab-shell-${VERSION}`;
const ASSET_CACHE = `homelab-assets-${VERSION}`;

// Precache just enough to render an offline shell.
const SHELL_URLS = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Never intercept cross-origin or API traffic.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) {
    return;
  }

  // Navigations: network-first so a new deploy is picked up immediately,
  // falling back to the cached shell only when truly offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Hashed build assets (js/css/fonts/images): cache-first, they never change
  // in place.
  if (/\.(?:js|css|woff2?|ttf|png|svg|jpg|jpeg|webp|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
});
