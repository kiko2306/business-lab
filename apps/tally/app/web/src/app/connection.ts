import { Injectable, signal } from '@angular/core';

/**
 * Whether the *browser* has a connection — distinct from a shop's agent being
 * away. The service worker is a deliberate no-op, so an installed app with no
 * connectivity otherwise showed only a failed request.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionService {
  readonly offline = signal(typeof navigator !== 'undefined' && navigator.onLine === false);

  constructor() {
    window.addEventListener('offline', () => this.offline.set(true));
    window.addEventListener('online', () => this.offline.set(false));
  }
}
