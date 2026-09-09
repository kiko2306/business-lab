/**
 * Immich REST client — thin, mirrors guacamoleClient.ts / mealieClient.ts.
 *
 * Only what immichAdminBootstrap.ts needs: a reachability ping and the
 * unauthenticated first-admin sign-up. Paths verified against Immich's
 * `server/src/controllers/auth.controller.ts` (`POST /auth/admin-sign-up`,
 * `GET /server/ping`).
 */

import { requestJson } from '../utils/httpJson';

/** GET /api/server/ping → `{ res: 'pong' }` once the API is serving. */
export async function immichPing(baseUrl: string): Promise<boolean> {
  const response = await requestJson<{ res?: string }>(`${baseUrl}/api/server/ping`, { timeout: 5000 });
  return response.statusCode === 200 && response.body?.res === 'pong';
}

export type ImmichAdminSignUpResult = 'created' | 'already-exists' | 'failed';

/**
 * POST /api/auth/admin-sign-up. Unauthenticated, and only works while Immich
 * has no admin yet — a second call returns 400 ("The server already has an
 * admin"), which is the idempotent success case here.
 */
export async function immichAdminSignUp(
  baseUrl: string,
  email: string,
  password: string,
  name: string
): Promise<ImmichAdminSignUpResult> {
  const response = await requestJson<{ message?: string }>(`${baseUrl}/api/auth/admin-sign-up`, {
    method: 'POST',
    body: { email, password, name },
    timeout: 15000,
  });
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return 'created';
  }
  if (response.statusCode === 400 && /already has an admin/i.test(response.body?.message ?? response.raw)) {
    return 'already-exists';
  }
  return 'failed';
}
