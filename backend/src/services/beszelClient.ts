/**
 * Beszel REST client — thin, mirrors guacamoleClient.ts's shape.
 *
 * Beszel is a PocketBase app, so this talks the stock PocketBase REST API,
 * not a Beszel-specific one. Endpoint paths and field names are from
 * PocketBase 0.28 (the version bundled in henrygd/beszel v0.18.x) and from
 * Beszel's own `internal/users/users.go` for the `role` enum.
 *
 * Auth is as a PocketBase **superuser**: Beszel's first-run `CreateFirstUser`
 * seeds a `_superusers` record with the same `USER_EMAIL`/`USER_PASSWORD`
 * (our `BESZEL_ADMIN_EMAIL`/`BESZEL_ADMIN_PASSWORD`) as the first `users`
 * row, so those credentials authenticate against
 * `/api/collections/_superusers/auth-with-password`. A superuser bypasses
 * the `users` collection's superuser-only create rule, which is why this
 * needs no raw sqlite (unlike `beszel-init`'s universal-token insert, which
 * has no REST equivalent).
 *
 * The token goes in a bare `Authorization` header (no `Bearer` prefix) —
 * PocketBase's own convention.
 */

import { requestJson } from '../utils/httpJson';

export type BeszelRole = 'admin' | 'user' | 'readonly';

export interface BeszelUser {
  id: string;
  email: string;
  role: BeszelRole;
}

/**
 * POST /api/collections/_superusers/auth-with-password. Returns null when
 * the credentials are rejected (someone changed the superuser password in
 * Beszel by hand since first run — nothing this sync can do about that). A
 * network-level failure rejects instead, so "not reachable yet" is
 * distinguishable from "reachable but refused".
 */
export async function beszelSuperuserLogin(
  baseUrl: string,
  identity: string,
  password: string
): Promise<string | null> {
  const response = await requestJson<{ token?: string }>(
    `${baseUrl}/api/collections/_superusers/auth-with-password`,
    { method: 'POST', body: { identity, password } }
  );
  if (response.statusCode !== 200 || !response.body?.token) {
    return null;
  }
  return response.body.token;
}

/**
 * GET /api/collections/users/records. The full user list — a homelab never
 * has enough accounts to page, so one request with a generous perPage is
 * fine.
 */
export async function beszelListUsers(baseUrl: string, token: string): Promise<BeszelUser[]> {
  const response = await requestJson<{ items?: BeszelUser[] }>(
    `${baseUrl}/api/collections/users/records?perPage=500&fields=id,email,role`,
    { headers: { Authorization: token } }
  );
  if (response.statusCode !== 200 || !response.body?.items) {
    throw new Error(`Unable to list Beszel users: ${response.statusCode}`);
  }
  return response.body.items;
}

/**
 * POST /api/collections/users/records. Creates a verified account with a
 * throwaway random password nobody is told — the trusted-header path
 * (`TRUSTED_AUTH_HEADER`) only ever looks the account up by email, it never
 * checks the password. `verified: true` is set because an unverified
 * PocketBase auth record can't start a session.
 */
export async function beszelCreateUser(
  baseUrl: string,
  token: string,
  email: string,
  password: string,
  role: BeszelRole
): Promise<void> {
  const response = await requestJson(`${baseUrl}/api/collections/users/records`, {
    method: 'POST',
    headers: { Authorization: token },
    body: { email, password, passwordConfirm: password, role, verified: true },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Unable to create Beszel user ${email}: ${response.statusCode}`);
  }
}

/** PATCH /api/collections/users/records/{id} — role only. */
export async function beszelSetUserRole(
  baseUrl: string,
  token: string,
  id: string,
  role: BeszelRole
): Promise<void> {
  const response = await requestJson(`${baseUrl}/api/collections/users/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: token },
    body: { role },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Unable to update Beszel user ${id}: ${response.statusCode}`);
  }
}

/**
 * DELETE /api/collections/users/records/{id}. PocketBase auth records have
 * no "disabled" flag, so revoke means delete here — unlike guacamoleSync,
 * which disables. Safe in practice: this sync is the only thing that creates
 * Beszel accounts on this stack, and the first-run seed admin (the
 * universal-token owner) is never in the sync's wanted set nor deleted.
 */
export async function beszelDeleteUser(baseUrl: string, token: string, id: string): Promise<void> {
  const response = await requestJson(`${baseUrl}/api/collections/users/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Unable to delete Beszel user ${id}: ${response.statusCode}`);
  }
}
