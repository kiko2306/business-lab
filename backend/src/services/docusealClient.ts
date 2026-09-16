/**
 * DocuSeal client — only what docusealAdminBootstrap.ts needs.
 *
 * DocuSeal's community edition has no OIDC/SAML: SSO is a Pro-only feature
 * (the `sso_settings` route just renders a settings page; there are no
 * omniauth/saml auth routes, and `devise_for :users` is `sessions` +
 * `passwords` only). So Authelia can only sit in front as forward-auth and
 * DocuSeal keeps its own password login — the one thing we can automate is
 * the first-run `/setup` wizard, so there's no manual "create the account"
 * step (§341).
 *
 * `/setup` is a Rails form (CSRF token + session cookie), not a JSON API.
 * `getSetupState` does GET /setup to grab the `authenticity_token` + the
 * `_docuseal_session` cookie; `createFirstAdmin` POSTs the form with them.
 * Once any user exists, `SetupController#ensure_first_user_not_created!`
 * redirects both GET and POST away from /setup — which `fetch` surfaces as an
 * opaque redirect, and which this treats as the idempotent "already done".
 *
 * `signIn` + `updateProfileEmail` are the same two-step form dance applied to
 * `/sign_in` and `/settings/profile/update_contact`, for re-syncing the
 * account's email when it drifts from the current Authelia admin (§475). The
 * `User` model's `devise :...` line has no `:confirmable` module — checked on
 * the running image's `app/models/user.rb` — so `ProfileController#update_contact`
 * applies an email change immediately, no confirmation link required.
 */

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Pull Rails' CSRF token out of the served /setup HTML — the `<meta>` tag, or
 * the hidden form input as a fallback. Exported for testing: this is the one
 * bit of screen-scraping here and the markup is not contractual.
 */
export function extractAuthenticityToken(html: string): string | null {
  const meta = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i.exec(html);
  if (meta) return meta[1];
  const input = /name="authenticity_token"\s+value="([^"]+)"/i.exec(html);
  return input ? input[1] : null;
}

/** Fold Set-Cookie header values to a `Cookie` request header (name=value only). */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');
}

function readSetCookies(headers: Headers): string[] {
  const withGetter = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

export type DocusealSetupState =
  | { state: 'needs-setup'; token: string; cookie: string }
  | { state: 'already-setup' }
  | { state: 'unreachable' };

/**
 * GET /setup. 200 with a parseable token → the wizard is open. A redirect
 * (opaque, because `redirect: 'manual'`) → a user already exists. Anything
 * else, including a network error → not reachable yet.
 */
export async function getSetupState(baseUrl: string): Promise<DocusealSetupState> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/setup`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { state: 'unreachable' };
  }

  // `redirect: 'manual'` surfaces a 3xx as an opaque redirect (type
  // 'opaqueredirect', status 0). From /setup that only happens via
  // ensure_first_user_not_created!, i.e. setup is already complete.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return { state: 'already-setup' };
  }
  if (response.status !== 200) {
    return { state: 'unreachable' };
  }

  const token = extractAuthenticityToken(await response.text());
  const cookie = cookieHeader(readSetCookies(response.headers));
  if (!token || !cookie) {
    // 200 but no token/cookie — the app is still booting its assets.
    return { state: 'unreachable' };
  }
  return { state: 'needs-setup', token, cookie };
}

export interface DocusealFirstAdminInput {
  token: string;
  cookie: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  accountName: string;
  /** DocuSeal validates this is an http(s) URL and stores it as APP_URL. */
  appUrl: string;
}

export type DocusealCreateAdminResult = 'created' | 'already-setup' | 'failed';

/**
 * POST /setup. Success is a redirect to /newsletter (opaque here) → 'created'.
 * A 422 is a validation or CSRF failure → 'failed' (retried on the next
 * start). A redirect that turns out to be /sign_in is covered by
 * 'already-setup' too — indistinguishable from success at this layer, and
 * both mean "an admin now exists", which is all the caller needs.
 */
export async function createFirstAdmin(
  baseUrl: string,
  input: DocusealFirstAdminInput
): Promise<DocusealCreateAdminResult> {
  const body = new URLSearchParams({
    authenticity_token: input.token,
    'user[first_name]': input.firstName,
    'user[last_name]': input.lastName,
    'user[email]': input.email,
    'user[password]': input.password,
    'account[name]': input.accountName,
    'account[timezone]': 'UTC',
    'account[locale]': 'en-US',
    'encrypted_config[value]': input.appUrl,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/setup`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: input.cookie,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }

  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return 'created';
  }
  return 'failed';
}

export type DocusealSignInResult = { state: 'signed-in'; cookie: string } | { state: 'failed' };

/**
 * GET /sign_in for a token + cookie, then POST the login form. A wrong
 * email/password re-renders the form (200) — `failed`, same as a network
 * error. A correct one redirects (opaque here) and Devise regenerates the
 * session, so the cookie to use afterwards is whatever the POST response set,
 * not the pre-login one.
 */
export async function signIn(baseUrl: string, email: string, password: string): Promise<DocusealSignInResult> {
  let formResponse: Response;
  try {
    formResponse = await fetch(`${baseUrl}/sign_in`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { state: 'failed' };
  }
  if (formResponse.status !== 200) return { state: 'failed' };
  const token = extractAuthenticityToken(await formResponse.text());
  const formCookie = cookieHeader(readSetCookies(formResponse.headers));
  if (!token || !formCookie) return { state: 'failed' };

  const body = new URLSearchParams({
    authenticity_token: token,
    'user[email]': email,
    'user[password]': password,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/sign_in`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: formCookie },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { state: 'failed' };
  }
  if (response.type !== 'opaqueredirect' && !(response.status >= 300 && response.status < 400)) {
    return { state: 'failed' };
  }
  const postLoginCookies = readSetCookies(response.headers);
  return { state: 'signed-in', cookie: postLoginCookies.length ? cookieHeader(postLoginCookies) : formCookie };
}

export type DocusealUpdateEmailResult = 'updated' | 'failed';

export interface DocusealUpdateEmailInput {
  cookie: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * GET /settings/profile for a session-bound CSRF token, then PATCH
 * /settings/profile/update_contact — `ProfileController#update_contact`,
 * `current_user.update(email:, first_name:, last_name:)`. Success redirects
 * back to the same page (opaque here); a validation failure re-renders (200).
 */
export async function updateProfileEmail(
  baseUrl: string,
  input: DocusealUpdateEmailInput
): Promise<DocusealUpdateEmailResult> {
  let formResponse: Response;
  try {
    formResponse = await fetch(`${baseUrl}/settings/profile`, {
      headers: { Cookie: input.cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }
  if (formResponse.status !== 200) return 'failed';
  const token = extractAuthenticityToken(await formResponse.text());
  if (!token) return 'failed';

  const body = new URLSearchParams({
    _method: 'patch',
    authenticity_token: token,
    'user[first_name]': input.firstName,
    'user[last_name]': input.lastName,
    'user[email]': input.email,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/settings/profile/update_contact`, {
      method: 'PATCH',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: input.cookie },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return 'updated';
  }
  return 'failed';
}
