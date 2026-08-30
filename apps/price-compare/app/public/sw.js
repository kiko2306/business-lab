/*
 * Minimal service worker — exists mainly to satisfy PWA installability
 * criteria, plus the push/notificationclick handlers below for price-drop
 * alerts. No offline caching: this app is nothing without its live API
 * (prices, categories), so caching the shell would just show a stale
 * skeleton with no data when offline.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = { title: 'Comparador de Preços', body: '', drops: [] };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — fall back to the default text above.
  }
  const isPriceDrop = Array.isArray(data.drops) && data.drops.length > 0;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: isPriceDrop ? 'price-drop' : 'pc-notice',
      data,
    })
  );
});

// Tapping a price-drop notification shows the full details popup (the OS
// text is often truncated): postMessage an already-open tab, or encode
// the data in the URL a new tab opens with — app.js init() picks it up.
// Any other notification just focuses/opens the app (at data.url if set).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const isPriceDrop = Array.isArray(data.drops) && data.drops.length > 0;
  const target = isPriceDrop ? '/?priceDrop=' + encodeURIComponent(JSON.stringify(data)) : data.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if (isPriceDrop) client.postMessage({ type: 'PRICE_DROP_NOTIFICATION', data });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    })
  );
});
