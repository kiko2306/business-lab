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
  let data = { title: 'Comparador de Preços', body: 'Um preço desceu.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — fall back to the default text above.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'price-drop',
    })
  );
});

// Focuses an already-open app tab if there is one, otherwise opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
