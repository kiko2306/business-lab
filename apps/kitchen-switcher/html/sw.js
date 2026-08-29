/*
 * Minimal service worker — exists only to satisfy PWA installability
 * criteria. This page has nothing worth caching (it's two tabs and an
 * iframe pointing at other apps), so it does no offline caching at all,
 * just registers so the browser offers "Add to Home Screen"/"Install".
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
