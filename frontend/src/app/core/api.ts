import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment';

const configuredApiUrl = environment.apiUrl.trim().replace(/\/+$/, '');

// When an absolute API URL is configured the backend is addressed directly, so
// routes live at its root (e.g. https://api.example.com/auth/login). Without
// one, requests are same-origin and go through the nginx /api/ proxy.
export const API_BASE_URL = configuredApiUrl || '/api';

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
      if (
        'details' in apiError &&
        Array.isArray(apiError.details) &&
        apiError.details.every((detail: unknown) => typeof detail === 'string')
      ) {
        return apiError.details.join(' ');
      }
      return apiError.error;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
