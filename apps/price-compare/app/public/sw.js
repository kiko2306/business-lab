/*
 * Minimal service worker — exists only to satisfy PWA installability
 * criteria. No offline caching: this app is nothing without its live API
 * (prices, categories), so caching the shell would just show a stale
 * skeleton with no data when offline.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
