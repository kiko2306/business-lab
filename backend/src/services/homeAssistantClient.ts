/**
 * Home Assistant client — onboarding (for homeAssistantAdminBootstrap.ts) and
 * admin user management (for homeAssistantUserProvisioning.ts, §480).
 *
 * HA core has no OIDC and no header-trust that works behind a trusted proxy
 * (§311), so it's exposed directly with its own login (§344). The dashboard
 * runs HA's onboarding so there's no manual step and no
 * first-visitor-claims-owner race.
 *
 * Both onboarding endpoints are unauthenticated and only work before
 * onboarding is finished:
 *  - GET  /api/onboarding        → [{step, done}, …]; the `user` step's `done`
 *                                  is the idempotency signal.
 *  - POST /api/onboarding/users  → 200 {auth_code} on success, 403 "User step
 *                                  already done" once claimed.
 * (home-assistant/core `components/onboarding/views.py`.)
 *
 * Everything past onboarding — creating/updating a *second* user — has no
 * REST API at all. It's the same OAuth2 flow HA's own mobile app uses to log
 * a user in with a plain username/password (`components/auth/login_flow.py`,
 * `components/auth/__init__.py` — `developers.home-assistant.io/docs/auth_api`),
 * followed by admin-only commands over the WebSocket API
 * (`components/config/auth.py`, `components/config/auth_provider_homeassistant.py`):
 *
 *  1. POST /auth/login_flow            → {flow_id, ...} (a form step)
 *  2. POST /auth/login_flow/{flow_id}  → {type: create_entry, result: <code>}
 *  3. POST /auth/token (form-urlencoded, per HA's own doc comment on the
 *     endpoint) → {access_token, ...}
 *  4. ws://…/api/websocket: `auth_required` → send `{type:"auth",
 *     access_token}` → `auth_ok`, then one `{id, type: "config/auth/…", …}`
 *     command per call, matching `{id, type:"result", success, result}` back.
 *
 * `client_id`/`redirect_uri` only need to share a scheme+host
 * (`indieauth.verify_redirect_uri` — no external fetch), so both are just the
 * app's own base URL; no app-registration step needed first.
 */

import WebSocket from 'ws';

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

export type HaTokenResult = { state: 'ok'; accessToken: string } | { state: 'failed' };

/**
 * The username/password login flow a native HA client uses, not a browser
 * SSO redirect — steps 1-3 of the module doc comment. A fresh access token
 * per call, not a stored long-lived one: nothing here needs to survive past
 * the WebSocket commands it's about to authorize (matches itflowClient.ts's
 * `signIn` — sign in fresh each time rather than keep a secret alive).
 */
export async function getAdminAccessToken(baseUrl: string, username: string, password: string): Promise<HaTokenResult> {
  const clientId = `${baseUrl}/`;
  try {
    const flowResponse = await fetch(`${baseUrl}/auth/login_flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, handler: ['homeassistant', null], redirect_uri: clientId, type: 'authorize' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (flowResponse.status !== 200) return { state: 'failed' };
    const flow = (await flowResponse.json()) as { flow_id?: string };
    if (!flow.flow_id) return { state: 'failed' };

    const stepResponse = await fetch(`${baseUrl}/auth/login_flow/${flow.flow_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, username, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (stepResponse.status !== 200) return { state: 'failed' };
    const step = (await stepResponse.json()) as { type?: string; result?: string };
    if (step.type !== 'create_entry' || !step.result) return { state: 'failed' };

    const tokenResponse = await fetch(`${baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code: step.result }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (tokenResponse.status !== 200) return { state: 'failed' };
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) return { state: 'failed' };
    return { state: 'ok', accessToken: token.access_token };
  } catch {
    return { state: 'failed' };
  }
}

export interface HaUserInfo {
  id: string;
  username: string | null;
  name: string;
  is_active: boolean;
  is_owner: boolean;
}

export type HaWsResult = { success: true; result: unknown } | { success: false };

/**
 * One admin command over the WebSocket API (step 4 of the module doc
 * comment) — a fresh connection per call, not a pooled one: these run rarely
 * (a grant/revoke), so the simplicity of "connect, auth, ask, close" wins
 * over reusing a connection across calls.
 */
export function runHaWsCommand(baseUrl: string, accessToken: string, command: Record<string, unknown>): Promise<HaWsResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: HaWsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* closing a socket that already failed is not an error worth reporting */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ success: false }), REQUEST_TIMEOUT_MS);
    const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/websocket`);

    socket.on('error', () => finish({ success: false }));
    socket.on('message', (data) => {
      let message: { type?: string; id?: number; success?: boolean; result?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        finish({ success: false });
        return;
      }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
        return;
      }
      if (message.type === 'auth_invalid') {
        finish({ success: false });
        return;
      }
      if (message.type === 'auth_ok') {
        socket.send(JSON.stringify({ id: 1, ...command }));
        return;
      }
      if (message.type === 'result' && message.id === 1) {
        finish(message.success ? { success: true, result: message.result } : { success: false });
      }
    });
  });
}
