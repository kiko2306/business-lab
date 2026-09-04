/**
 * Guacamole REST API client — thin, mirrors npmClient.ts's shape.
 *
 * Endpoint paths and field names are verified against the guacamole-client
 * source (org.apache.guacamole.rest.auth.TokenRESTService,
 * org.apache.guacamole.rest.user.UserResource and
 * org.apache.guacamole.rest.directory.DirectoryResource/
 * DirectoryObjectResource, at the pinned 1.6.0 tag), not assumed from the
 * public docs — this drives real account changes.
 *
 * `/api/tokens` takes form-encoded `username`/`password`, not JSON (Jersey's
 * `@FormParam`), unlike every other client in this codebase — the one thing
 * here that isn't like npmClient.ts. Everything else is plain JSON.
 *
 * User CRUD is the generic Guacamole "directory" pattern: `POST
 * .../users` creates, `GET`/`PUT`/`DELETE .../users/{username}` read/replace/
 * remove one. `disabled` is a real top-level boolean field on the user
 * object (`APIUser.isDisabled()`), not an attribute — so it round-trips
 * through a plain GET-modify-PUT with no attribute-map bookkeeping.
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

export interface GuacamoleUser {
  username: string;
  disabled: boolean;
  attributes: Record<string, string | null>;
}

/** GET /api/session/data/{dataSource}/users/{username}. Null on a 404. */
export async function guacamoleGetUser(
  baseUrl: string,
  session: GuacamoleSession,
  username: string
): Promise<GuacamoleUser | null> {
  const response = await requestJson<GuacamoleUser>(
    `${baseUrl}/api/session/data/${session.dataSource}/users/${encodeURIComponent(username)}`,
    { headers: { 'Guacamole-Token': session.authToken } }
  );

  if (response.statusCode === 404) {
    return null;
  }
  if (response.statusCode !== 200 || !response.body) {
    throw new Error(`Unable to look up Guacamole user ${username}: ${response.statusCode}`);
  }
  return response.body;
}

/**
 * GET /api/session/data/{dataSource}/users. The full directory, keyed by
 * username — `DirectoryResource.getObjects()`'s shape, not a paginated list.
 */
export async function guacamoleListUsers(
  baseUrl: string,
  session: GuacamoleSession
): Promise<Record<string, GuacamoleUser>> {
  const response = await requestJson<Record<string, GuacamoleUser>>(
    `${baseUrl}/api/session/data/${session.dataSource}/users`,
    { headers: { 'Guacamole-Token': session.authToken } }
  );

  if (response.statusCode !== 200 || !response.body) {
    throw new Error(`Unable to list Guacamole users: ${response.statusCode}`);
  }
  return response.body;
}

/**
 * POST /api/session/data/{dataSource}/users. Creates an enabled user with no
 * attributes — connection/permission grants stay a manual Guacamole-UI step
 * (§200's own scope line), not something this client touches.
 */
export async function guacamoleCreateUser(
  baseUrl: string,
  session: GuacamoleSession,
  username: string,
  password: string
): Promise<void> {
  const response = await requestJson(`${baseUrl}/api/session/data/${session.dataSource}/users`, {
    method: 'POST',
    headers: { 'Guacamole-Token': session.authToken },
    body: { username, password, disabled: false, attributes: {} },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Unable to create Guacamole user ${username}: ${response.statusCode}`);
  }
}

/**
 * Flip a user's `disabled` flag via GET-modify-PUT, preserving whatever
 * attributes it already carries (a blind PUT with an empty attribute map
 * would silently wipe them). Throws if the user doesn't exist — the caller
 * (guacamoleSync.ts) creates before it ever tries to enable/disable.
 */
export async function guacamoleSetUserDisabled(
  baseUrl: string,
  session: GuacamoleSession,
  username: string,
  disabled: boolean
): Promise<void> {
  const user = await guacamoleGetUser(baseUrl, session, username);
  if (!user) {
    throw new Error(`Cannot change disabled state: Guacamole user ${username} does not exist`);
  }
  if (user.disabled === disabled) {
    return;
  }

  const response = await requestJson(
    `${baseUrl}/api/session/data/${session.dataSource}/users/${encodeURIComponent(username)}`,
    {
      method: 'PUT',
      headers: { 'Guacamole-Token': session.authToken },
      body: { username, disabled, attributes: user.attributes },
    }
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Unable to update Guacamole user ${username}: ${response.statusCode}`);
  }
}
