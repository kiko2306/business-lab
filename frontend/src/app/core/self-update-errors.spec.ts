import { HttpErrorResponse } from '@angular/common/http';
import { en } from '../i18n/en';
import { ptPT } from '../i18n/pt-pt';
import { selfUpdateErrorKey } from './self-update-errors';

// plan.md §837 (§834 fix 3): the Updates toasts preferred the server's English
// sentence over the translated fallback, so a pt-PT owner read git and docker
// output in a toast. Every failure here maps to a key.
const http = (status: number, error: unknown = { error: 'English from the server' }) => new HttpErrorResponse({ status, error });

describe('selfUpdateErrorKey', () => {
  it('says the connection is the problem when the server cannot be reached', () => {
    expect(selfUpdateErrorKey(http(0, null), 'selfUpdate.errors.checkFailed')).toBe('auth.error.network');
  });

  it('says to wait when the limiter answers', () => {
    expect(selfUpdateErrorKey(http(429), 'selfUpdate.errors.startFailed')).toBe('auth.error.tooMany');
  });

  it('says an update is already running on a 409', () => {
    expect(selfUpdateErrorKey(http(409), 'selfUpdate.errors.startFailed')).toBe('selfUpdate.errors.alreadyRunning');
  });

  it('falls back to the action\'s own message for anything else, never the server\'s words', () => {
    for (const status of [400, 403, 500, 503]) {
      expect(selfUpdateErrorKey(http(status), 'selfUpdate.errors.checkFailed')).toBe('selfUpdate.errors.checkFailed');
    }
    expect(selfUpdateErrorKey(new Error('boom'), 'selfUpdate.errors.loadStatus')).toBe('selfUpdate.errors.loadStatus');
  });

  it('only names keys that exist in both languages', () => {
    const keys = new Set<string>();
    for (const status of [0, 400, 409, 429, 500]) keys.add(selfUpdateErrorKey(http(status), 'selfUpdate.errors.checkFailed'));
    for (const key of keys) {
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
  });
});
