/**
 * Mealie REST client — thin, mirrors guacamoleClient.ts's shape.
 *
 * Endpoint paths and body shapes are verified against the mealie source at
 * `mealie-next` (mealie/routes/auth/auth.py, mealie/routes/users/crud.py,
 * mealie/routes/groups/controller_group_ai_providers.py and
 * mealie/schema/group/ai_providers.py), not assumed — this drives a real
 * password rotation and the AI-provider config.
 *
 * `/api/auth/token` takes an OAuth2 password form (`username`/`password`,
 * form-encoded), like Guacamole's `/api/tokens`; everything else is JSON with
 * a `Authorization: Bearer` header. Mealie's models accept camelCase keys on
 * the wire (`populate_by_name`), so that is what we send.
 */

import { requestJson } from '../utils/httpJson';

/** POST /api/auth/token. Returns the bearer token, or null if rejected. */
export async function mealieLogin(baseUrl: string, username: string, password: string): Promise<string | null> {
  const form = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const response = await requestJson<{ access_token?: string }>(`${baseUrl}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    rawBody: Buffer.from(form),
  });

  if (response.statusCode !== 200 || !response.body?.access_token) {
    return null;
  }
  return response.body.access_token;
}

/**
 * PUT /api/users/password — Mealie's self-service change. It re-verifies
 * `currentPassword` server-side, so the token just needs to be the target
 * user's own. Returns true on 2xx.
 */
export async function mealieChangePassword(
  baseUrl: string,
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const response = await requestJson(`${baseUrl}/api/users/password`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: { currentPassword, newPassword },
  });
  return response.statusCode >= 200 && response.statusCode < 300;
}

export interface MealieAiProviderInput {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

export interface MealieAiSettings {
  defaultProviderId: string | null;
  /** id → name for every provider defined in this group. */
  providers: { id: string; name: string }[];
}

/**
 * GET /api/groups/ai-providers/settings. The group's AI config plus a summary
 * of every provider in it. A fresh group with no row yet answers with nulls
 * and an empty list (or a non-200 we treat the same way) — the first
 * `mealieSetAiSettings` PUT creates the row.
 */
export async function mealieGetAiSettings(baseUrl: string, token: string): Promise<MealieAiSettings> {
  const response = await requestJson<{
    default_provider_id?: string | null;
    providers?: { id: string; name: string }[];
  }>(`${baseUrl}/api/groups/ai-providers/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.statusCode !== 200 || !response.body) {
    return { defaultProviderId: null, providers: [] };
  }
  return {
    defaultProviderId: response.body.default_provider_id ?? null,
    providers: response.body.providers ?? [],
  };
}

/** POST /api/groups/ai-providers/providers → the new provider's id. */
export async function mealieCreateAiProvider(
  baseUrl: string,
  token: string,
  data: MealieAiProviderInput
): Promise<string> {
  const response = await requestJson<{ id?: string }>(`${baseUrl}/api/groups/ai-providers/providers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  });
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.body?.id) {
    throw new Error(`Mealie: could not create AI provider (${response.statusCode})`);
  }
  return response.body.id;
}

/** PUT /api/groups/ai-providers/providers/{id}. */
export async function mealieUpdateAiProvider(
  baseUrl: string,
  token: string,
  id: string,
  data: MealieAiProviderInput
): Promise<void> {
  const response = await requestJson(`${baseUrl}/api/groups/ai-providers/providers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Mealie: could not update AI provider ${id} (${response.statusCode})`);
  }
}

/** DELETE /api/groups/ai-providers/providers/{id}. Best-effort — never throws. */
export async function mealieDeleteAiProvider(baseUrl: string, token: string, id: string): Promise<void> {
  await requestJson(`${baseUrl}/api/groups/ai-providers/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

/**
 * PUT /api/groups/ai-providers/settings. `default_provider_id` null turns AI
 * off (`ai_enabled` is computed = it's non-null). The audio/image slots stay
 * unset — we only wire text parsing.
 */
export async function mealieSetAiSettings(
  baseUrl: string,
  token: string,
  defaultProviderId: string | null
): Promise<void> {
  const response = await requestJson(`${baseUrl}/api/groups/ai-providers/settings`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: { default_provider_id: defaultProviderId, audio_provider_id: null, image_provider_id: null },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Mealie: could not update AI settings (${response.statusCode})`);
  }
}
