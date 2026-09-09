/**
 * Home Assistant onboarding client — only what homeAssistantAdminBootstrap.ts
 * needs.
 *
 * HA core has no OIDC and no header-trust that works behind a trusted proxy
 * (§311), so it's exposed directly with its own login (§344). The dashboard
 * runs HA's onboarding so there's no manual step and no
 * first-visitor-claims-owner race.
 *
 * Both endpoints are unauthenticated and only work before onboarding is
 * finished:
 *  - GET  /api/onboarding        → [{step, done}, …]; the `user` step's `done`
 *                                  is the idempotency signal.
 *  - POST /api/onboarding/users  → 200 {auth_code} on success, 403 "User step
 *                                  already done" once claimed.
 * (home-assistant/core `components/onboarding/views.py`.)
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type HaOnboardingState = 'done' | 'needs-user' | 'unreachable';

/**
 * GET /api/onboarding. A valid step array with a `user` entry means HA is up
 * and ready; anything else (still booting, 404, non-JSON) → keep polling.
 */
export async function getOnboardingState(baseUrl: string): Promise<HaOnboardingState> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/onboarding`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return 'unreachable';
  }
  if (response.status !== 200) {
    return 'unreachable';
  }
  let steps: unknown;
  try {
    steps = await response.json();
  } catch {
    return 'unreachable';
  }
  if (!Array.isArray(steps)) {
    return 'unreachable';
  }
  const userStep = steps.find(
    (s): s is { step: string; done: boolean } =>
      !!s && typeof s === 'object' && (s as { step?: unknown }).step === 'user'
  );
  if (!userStep) {
    return 'unreachable';
  }
  return userStep.done ? 'done' : 'needs-user';
}

export interface HaOwnerInput {
  name: string;
  username: string;
  password: string;
  /** HA wants a URL-shaped client_id — the app's public URL does the job. */
  clientId: string;
  language: string;
}

export type HaCreateOwnerResult = 'created' | 'already-done' | 'failed';

/** POST /api/onboarding/users. 403 ("User step already done") is the idempotent success. */
export async function createOwner(baseUrl: string, input: HaOwnerInput): Promise<HaCreateOwnerResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/onboarding/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        username: input.username,
        password: input.password,
        client_id: input.clientId,
        language: input.language,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }
  if (response.status === 200) {
    return 'created';
  }
  if (response.status === 403) {
    return 'already-done';
  }
  return 'failed';
}
