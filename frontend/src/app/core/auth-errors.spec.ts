import { HttpErrorResponse } from '@angular/common/http';
import { en } from '../i18n/en';
import { ptPT } from '../i18n/pt-pt';
import { authErrorKey } from './auth-errors';

// plan.md §827 (P1): the sign-in pages showed the server's English sentence,
// even in pt-PT, and nothing said what to try. Every failure on these pages
// now maps to an i18n key; the backend's words never reach the screen.
const http = (status: number, error: unknown = { error: 'English from the server' }) =>
  new HttpErrorResponse({ status, error });

describe('authErrorKey', () => {
  it('says the connection is the problem when the server cannot be reached', () => {
    expect(authErrorKey(http(0, null), 'login')).toBe('auth.error.network');
  });

  it('says to wait when the limiter answers, in every context', () => {
    for (const context of ['login', 'mfa', 'invitation', 'setup'] as const) {
      expect(authErrorKey(http(429), context)).toBe('auth.error.tooMany');
    }
  });

  it('tells a server fault from the person\'s mistake', () => {
    expect(authErrorKey(http(503), 'login')).toBe('auth.error.server');
    expect(authErrorKey(http(500), 'setup')).toBe('auth.error.server');
  });

  it('names a wrong username or password as that, not "unable to sign in"', () => {
    expect(authErrorKey(http(401), 'login')).toBe('login.error.badCredentials');
  });

  it('tells a wrong code from a sign-in that timed out', () => {
    expect(authErrorKey(http(401, { error: 'That code is not valid.' }), 'mfa')).toBe('login.error.codeRejected');
    expect(authErrorKey(http(401, { error: 'This login attempt has expired. Start again.' }), 'mfa')).toBe(
      'login.error.mfaExpired',
    );
  });

  it('calls a spent or unknown invitation an invalid link', () => {
    expect(authErrorKey(http(410), 'invitation')).toBe('setPassword.errors.invalidLink');
    expect(authErrorKey(http(422), 'invitation')).toBe('setPassword.errors.invalidLink');
    expect(authErrorKey(http(400), 'invitation')).toBe('setPassword.errors.setFailed');
  });

  it('tells a taken username from a failed setup', () => {
    expect(authErrorKey(http(409), 'setup')).toBe('setup.errors.usernameTaken');
    expect(authErrorKey(http(400), 'setup')).toBe('setup.errors.setupFailed');
  });

  it('falls back to the context\'s own message for a non-HTTP failure', () => {
    expect(authErrorKey(new Error('boom'), 'login')).toBe('login.error.signInFailed');
    expect(authErrorKey(new Error('boom'), 'mfa')).toBe('login.error.codeRejected');
  });

  it('only ever names keys that exist in both languages', () => {
    const keys = new Set<string>();
    for (const status of [0, 400, 401, 404, 409, 410, 422, 429, 500]) {
      for (const context of ['login', 'mfa', 'invitation', 'setup'] as const) {
        keys.add(authErrorKey(http(status), context));
        keys.add(authErrorKey(http(status, { error: 'This login attempt has expired.' }), context));
      }
    }
    for (const key of keys) {
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
  });
});
