/**
 * Jellyfin client — the user-management REST calls jellyfinUserProvisioning.ts
 * needs. Jellyfin ships a full REST API for this (unlike Kimai/Home
 * Assistant, no cold DB script or WebSocket workaround required):
 * `Users/AuthenticateByName` to sign in, `Users/New` to create, and an
 * admin can set another user's password directly via `Users/{id}/Password`
 * with no `CurrentPw` — the same thing the Jellyfin web UI's own
 * Dashboard > Users > Password tab does when an admin edits someone else's
 * account. Disable/re-enable flips `Policy.IsDisabled`, fetched and posted
 * back whole since there's no partial-policy-update endpoint.
 *
 * Every call needs a client-identifying auth header or Jellyfin 400s, even
 * on sign-in. Found live (2026-09-16) against a real 12.0.0 server: the
 * legacy `X-Emby-Authorization` header (still what most third-party
 * examples show) gets ignored and 400s here — this version's own OpenAPI
 * spec (`/api-docs/openapi.json`) names the security scheme `Authorization`,
 * and only that header name actually authenticates.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_AUTH_HEADER =
  'MediaBrowser Client="business-lab", Device="business-lab", DeviceId="business-lab", Version="1.0.0"';

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: token ? `${CLIENT_AUTH_HEADER}, Token="${token}"` : CLIENT_AUTH_HEADER,
  };
  return headers;
}

/** POST /Users/AuthenticateByName. Returns the access token, or null on any failure. */
export async function signIn(baseUrl: string, username: string, password: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ Username: username, Pw: password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  const token = (body as { AccessToken?: unknown })?.AccessToken;
  return typeof token === 'string' ? token : null;
}

/** GET /Users (admin-only, lists every account) — matched by Name, Jellyfin's own login identifier. */
export async function findUserByName(baseUrl: string, token: string, name: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/Users`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body)) return null;
  const match = body.find(
    (u) => typeof (u as { Name?: unknown })?.Name === 'string' && (u as { Name: string }).Name.toLowerCase() === name.toLowerCase()
  ) as { Id?: unknown } | undefined;
  return typeof match?.Id === 'string' ? match.Id : null;
}

/** POST /Users/New. Returns the new user's Id, or null on failure. */
export async function createUser(baseUrl: string, token: string, name: string, password: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/Users/New`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ Name: name, Password: password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  const id = (body as { Id?: unknown })?.Id;
  return typeof id === 'string' ? id : null;
}

/** POST /Users/{id}/Password — admin resetting another user's password needs no CurrentPw. */
export async function setPassword(baseUrl: string, token: string, userId: string, newPassword: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/Users/${userId}/Password`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ NewPw: newPassword }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  return response?.ok ?? false;
}

/** GET the user's current Policy then POST it back with IsDisabled flipped — no partial-update endpoint exists. */
export async function setDisabled(baseUrl: string, token: string, userId: string, disabled: boolean): Promise<boolean> {
  const getResponse = await fetch(`${baseUrl}/Users/${userId}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!getResponse || !getResponse.ok) return false;
  const user: unknown = await getResponse.json().catch(() => null);
  const policy = (user as { Policy?: Record<string, unknown> })?.Policy;
  if (!policy) return false;

  const postResponse = await fetch(`${baseUrl}/Users/${userId}/Policy`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ ...policy, IsDisabled: disabled }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  return postResponse?.ok ?? false;
}
