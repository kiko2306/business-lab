/**
 * NocoDB client — the org-user REST calls nocodbUserProvisioning.ts needs.
 *
 * All three routes are plain OSS — checked against nocodb/nocodb's
 * `org-users.controller.ts` / `users.service.ts` source, no Business/
 * Enterprise license gate anywhere on this path (unlike the Collaboration/
 * View/Script Meta APIs, which upstream's own docs do gate). `POST
 * /api/v1/users` only invites (email + role, no password — and a bare
 * community install has no SMTP plugin configured, so that invite email
 * never sends anyway), so setting the real password drives the same reset
 * flow a human clicking that link would: `generate-reset-url` mints a token
 * as the signed-in super admin, then the *public* `auth/password/reset/
 * :token` applies it through NocoDB's own bcrypt path. No docker exec, no
 * internals — just the REST API NocoDB ships.
 */

const REQUEST_TIMEOUT_MS = 15_000;

/** POST /api/v1/auth/user/signin. Returns the `xc-auth` JWT, or null on any failure. */
export async function signIn(baseUrl: string, email: string, password: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/api/v1/auth/user/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || response.status !== 200) return null;
  const body: unknown = await response.json().catch(() => null);
  const token = (body as { token?: unknown })?.token;
  return typeof token === 'string' ? token : null;
}

export type InviteUserResult = 'created' | 'already-exists' | 'failed';

// nocodb-sdk's OrgUserRoles enum — org-user-add only accepts these two string
// values (org-users.service.ts#userAdd), not the plain 'viewer'/'creator'
// names the role dropdown displays. Found live (2026-09-16): the bare name
// 400s with "Invalid role".
const ORG_VIEWER_ROLE = 'org-level-viewer';

/** POST /api/v1/users, signed in as the org super admin. Community edition allows only viewer/creator roles. */
export async function inviteUser(baseUrl: string, token: string, email: string): Promise<InviteUserResult> {
  const response = await fetch(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xc-auth': token },
    body: JSON.stringify({ email, roles: ORG_VIEWER_ROLE }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response) return 'failed';
  if (response.status === 200) return 'created';
  const body: unknown = await response.json().catch(() => null);
  const msg = (body as { msg?: unknown })?.msg;
  if (typeof msg === 'string' && /already exist/i.test(msg)) return 'already-exists';
  return 'failed';
}

/** GET /api/v1/users?query=<email> — the create response carries no id, so a lookup is the only way to get one. */
export async function findUserId(baseUrl: string, token: string, email: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/api/v1/users?query=${encodeURIComponent(email)}`, {
    headers: { 'xc-auth': token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || response.status !== 200) return null;
  const body: unknown = await response.json().catch(() => null);
  const list = (body as { list?: unknown })?.list;
  if (!Array.isArray(list)) return null;
  const match = list.find(
    (u) => typeof (u as { email?: unknown })?.email === 'string' && (u as { email: string }).email.toLowerCase() === email.toLowerCase()
  ) as { id?: unknown } | undefined;
  return typeof match?.id === 'string' ? match.id : null;
}

/** `generate-reset-url` + the public `password/reset` — one round trip from the caller's view. */
export async function setPassword(baseUrl: string, token: string, userId: string, password: string): Promise<boolean> {
  const resetResponse = await fetch(`${baseUrl}/api/v1/users/${userId}/generate-reset-url`, {
    method: 'POST',
    headers: { 'xc-auth': token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!resetResponse || resetResponse.status !== 200) return false;
  const resetBody: unknown = await resetResponse.json().catch(() => null);
  const resetToken = (resetBody as { reset_password_token?: unknown })?.reset_password_token;
  if (typeof resetToken !== 'string') return false;

  const applyResponse = await fetch(`${baseUrl}/auth/password/reset/${resetToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  return applyResponse?.status === 200;
}

/** GET /api/v1/app-settings, as the super admin. Null on any failure. */
export async function getAppSettings(baseUrl: string, token: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${baseUrl}/api/v1/app-settings`, {
    headers: { 'xc-auth': token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || response.status !== 200) return null;
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
}

/** POST /api/v1/app-settings, as the super admin. It replaces the whole object, so send every key. */
export async function saveAppSettings(baseUrl: string, token: string, settings: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`${baseUrl}/api/v1/app-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xc-auth': token },
    body: JSON.stringify(settings),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  return Boolean(response && response.status >= 200 && response.status < 300);
}
