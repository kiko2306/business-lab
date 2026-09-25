// Present only because some browsers (Android Chrome) want a fetch handler
// before they offer "Install". It deliberately does nothing: every figure here
// is live and sits behind Authelia, so caching a response would show stale or
// signed-out data as though it were current.
self.addEventListener('fetch', () => {});
