/**
 * Guacamole REST API client — thin, mirrors npmClient.ts's shape.
 *
 * Endpoint paths and field names are verified against the guacamole-client
 * source (org.apache.guacamole.rest.auth.TokenRESTService and
 * org.apache.guacamole.rest.user.UserResource, at the pinned 1.6.0 tag), not
 * assumed from the public docs — this drives a real credential change.
 *
 * `/api/tokens` takes form-encoded `username`/`password`, not JSON (Jersey's
 * `@FormParam`), unlike every other client in this codebase — the one thing
 * here that isn't like npmClient.ts.
 */

import { requestJson } from '../utils/httpJson';

const DEFAULT_DATA_SOURCE = 'postgresql';

export interface GuacamoleSession {
  authToken: string;
  dataSource: string;
}

/**
 * POST /api/tokens. Returns null when the credentials are rejected (a 200
 * with no token never happens on this endpoint) — the caller decides what
 * that means (wrong password, or already rotated). A network-level failure
 * (Guacamole not reachable yet) rejects instead of resolving, so it can be
 * told apart from "reachable but refused".
 */
export async function guacamoleLogin(baseUrl: string, username: string, password: string): Promise<GuacamoleSession | null> {
  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const response = await requestJson<{ authToken?: string; dataSource?: string }>(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    rawBody: Buffer.from(body),
  });

  if (response.statusCode !== 200 || !response.body?.authToken) {
    return null;
  }
  return { authToken: response.body.authToken, dataSource: response.body.dataSource || DEFAULT_DATA_SOURCE };
}

/** DELETE /api/tokens/{token}. Best-effort — never throws. */
export async function guacamoleLogout(baseUrl: string, session: GuacamoleSession): Promise<void> {
  await requestJson(`${baseUrl}/api/tokens/${session.authToken}`, { method: 'DELETE' }).catch(() => undefined);
}

/**
 * PUT /api/session/data/{dataSource}/users/{username}/password. Guacamole's
 * own self-service password endpoint: it re-verifies `oldPassword` against
 * the target user server-side, so the session just needs UPDATE permission
 * on that user (trivially true for a user changing their own password).
 */
export async function guacamoleSetPassword(
  baseUrl: string,
  session: GuacamoleSession,
  username: string,
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  const response = await requestJson(
    `${baseUrl}/api/session/data/${session.dataSource}/users/${encodeURIComponent(username)}/password`,
    {
      method: 'PUT',
      headers: { 'Guacamole-Token': session.authToken },
      body: { oldPassword, newPassword },
    }
  );
  return response.statusCode >= 200 && response.statusCode < 300;
}
