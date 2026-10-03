import { HttpErrorResponse } from '@angular/common/http';

export type AuthErrorContext = 'login' | 'mfa' | 'invitation' | 'setup';

/**
 * The i18n key for a failure on a sign-in page (plan.md §827).
 *
 * `extractErrorMessage` prefers the backend's sentence, which is English
 * whatever the person's language and rarely says what to try. These pages map
 * the failure to a key instead, so every message is translated and says its
 * next step. The one thing read from the body is whether a 401 on the code
 * step means the sign-in itself timed out (auth.ts says "has expired"): both
 * cases are a 401 with no code field to tell them apart.
 */
export function authErrorKey(error: unknown, context: AuthErrorContext): string {
  const status = error instanceof HttpErrorResponse ? error.status : -1;
  if (status === 0) return 'auth.error.network';
  if (status === 429) return 'auth.error.tooMany';
  if (status >= 500) return 'auth.error.server';

  switch (context) {
    case 'login':
      return status === 401 ? 'login.error.badCredentials' : 'login.error.signInFailed';
    case 'mfa': {
      const body = error instanceof HttpErrorResponse ? error.error : null;
      const expired = status === 401 && typeof body?.error === 'string' && /expired/i.test(body.error);
      return expired ? 'login.error.mfaExpired' : 'login.error.codeRejected';
    }
    case 'invitation':
      // A 400 is the password itself being refused; the rest mean the link.
      return status === 400 ? 'setPassword.errors.setFailed' : 'setPassword.errors.invalidLink';
    case 'setup':
      return status === 409 ? 'setup.errors.usernameTaken' : 'setup.errors.setupFailed';
  }
}
