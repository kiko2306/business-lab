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
