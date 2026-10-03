import { HttpErrorResponse } from '@angular/common/http';

/**
 * The i18n key for a failed Updates request (plan.md §837). `extractErrorMessage`
 * prefers the server's sentence, which is English whatever the person's
 * language and is often raw git or docker output; here the failure maps to a
 * key instead, and the server's words stay out of toasts. The raw text a
 * failed run carries is shown only behind "Technical details".
 */
export function selfUpdateErrorKey(error: unknown, fallbackKey: string): string {
  const status = error instanceof HttpErrorResponse ? error.status : -1;
  if (status === 0) return 'auth.error.network';
  if (status === 429) return 'auth.error.tooMany';
  if (status === 409) return 'selfUpdate.errors.alreadyRunning';
  return fallbackKey;
}
