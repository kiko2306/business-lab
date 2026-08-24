import { HttpErrorResponse } from '@angular/common/http';

const browserLocation = globalThis.location;
const apiOrigin = browserLocation?.port === '4200' ? 'http://localhost:3000' : '';

export const API_BASE_URL = `${apiOrigin}/api`;

export function extractErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (error instanceof HttpErrorResponse) {
    const apiError = error.error;
    if (typeof apiError === 'string' && apiError.trim()) {
      return apiError;
    }
    if (apiError && typeof apiError === 'object' && 'error' in apiError && typeof apiError.error === 'string') {
      return apiError.error;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
