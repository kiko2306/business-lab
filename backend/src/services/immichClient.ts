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
  // Immich v3 reworded this to "Admin setup is not available" (seen live on
  // v3.2.4); older versions say "already has an admin". Matching only the old
  // text made every restart of an already-bootstrapped Immich log a failure.
  if (
    response.statusCode === 400 &&
    /already has an admin|admin setup is not available/i.test(response.body?.message ?? response.raw)
  ) {
    return 'already-exists';
  }
  return 'failed';
}

export const IMMICH_PHOTOS_PATH = '/mnt/photos';

interface ImmichLibrary {
  id: string;
  importPaths?: string[];
}

/**
 * Make sure an External Library imports the shared `photos/` folder
 * (compose mounts it read-only at /mnt/photos). Immich has no config-file
 * knob for libraries, so this logs in as the bootstrap admin (password login
 * stays on unless an admin turned it off) and creates it over REST. Safe to
 * repeat: it looks for an existing library with that import path first.
 */
export async function immichEnsurePhotosLibrary(
  baseUrl: string,
  email: string,
  password: string
): Promise<'created' | 'exists' | 'failed'> {
  const login = await requestJson<{ accessToken?: string; userId?: string }>(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: { email, password },
    timeout: 15000,
  });
  const token = login.body?.accessToken;
  const userId = login.body?.userId;
  if (login.statusCode >= 300 || !token || !userId) {
    return 'failed';
  }
  const headers = { Authorization: `Bearer ${token}` };

  const list = await requestJson<ImmichLibrary[]>(`${baseUrl}/api/libraries`, { headers, timeout: 15000 });
  if (list.statusCode >= 300 || !Array.isArray(list.body)) {
    return 'failed';
  }
  if (list.body.some((lib) => lib.importPaths?.includes(IMMICH_PHOTOS_PATH))) {
    return 'exists';
  }

  const created = await requestJson<ImmichLibrary>(`${baseUrl}/api/libraries`, {
    method: 'POST',
    headers,
    body: { ownerId: userId, name: 'Shared photos', importPaths: [IMMICH_PHOTOS_PATH] },
    timeout: 15000,
  });
  if (created.statusCode >= 300 || !created.body?.id) {
    return 'failed';
  }
  // Scan now so the first look already shows what is in the folder; later
  // changes ride Immich's own library watcher/cron.
  await requestJson(`${baseUrl}/api/libraries/${created.body.id}/scan`, {
    method: 'POST',
    headers,
    timeout: 15000,
  });
  return 'created';
}
