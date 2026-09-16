/**
 * ITFlow setup-wizard client — only what itflowAdminBootstrap.ts needs.
 *
 * ITFlow has no OIDC (Authelia is OIDC-only), no env-var admin seed, and its
 * client portal has to be public — so it's exposed directly with its own
 * login, and the dashboard runs its first-run wizard so there's no manual
 * step and no first-visitor-claims-admin race (§344).
 *
 * The wizard is `setup/index.php` — sequential `application/x-www-form-
 * urlencoded` POSTs, **no CSRF token, no session cookie needed** (each handler
 * guards itself against a second run by checking the DB).
 *
 * The itfloworg/itflow image does NOT create the schema on boot — its
 * entrypoint only `git clone`s the PHP source and, if `config.php` already
 * exists, seds the DB host/password into it. `config.php` and the schema are
 * written by the wizard's **first** step, `add_database`: it connects with the
 * posted credentials, writes `config.php`, then imports `db.sql` line by line.
 * §346/§348 skipped that step (assumed the image had done it) and POSTed
 * `add_user` into an empty database — every table missing, errors suppressed,
 * and the final telemetry POST then locked setup with no admin. So the step
 * order here is: add_database → add_user → add_company_settings →
 * add_localization_settings → add_telemetry. The telemetry POST appends
 * `$config_enable_setup = 0` to config.php, after which `setup/` 302s to
 * `/login.php` — the idempotent "already done" signal.
 * Source: itflow-org/itflow `setup/index.php`.
 */

const REQUEST_TIMEOUT_MS = 15_000;

// The setup wizard always writes `$config_https_only = TRUE` (setup/index.php)
// — login.php then 403s any request that isn't HTTPS *or* fronted by a proxy
// that says so via X-Forwarded-Proto. This backend talks to the container
// directly (not through the Cloudflare Tunnel / NPM), so it has to send the
// same header a real proxy would rather than actually being on HTTPS.
const PROXY_HEADERS = { 'X-Forwarded-Proto': 'https' };

function extractCsrfToken(html: string): string | null {
  const match = /name="csrf_token"\s+value="([^"]*)"/i.exec(html);
  return match ? match[1] : null;
}

/** Fold Set-Cookie header values to a `Cookie` request header (name=value only). */
function cookieHeader(setCookies: string[]): string {
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

async function postForm(baseUrl: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/setup/index.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

export type ItflowSetupState = 'needs-setup' | 'already-setup' | 'unreachable';

/**
 * GET `setup/`. 200 → the wizard is open. A redirect (opaque, because
 * `redirect: 'manual'`) → `$config_enable_setup == 0`, i.e. setup finished.
 * Anything else / a network error → not reachable yet.
 */
export async function getSetupState(baseUrl: string): Promise<ItflowSetupState> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/setup/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'unreachable';
  }
  if (isRedirect(response)) {
    return 'already-setup';
  }
  return response.status === 200 ? 'needs-setup' : 'unreachable';
}

export interface ItflowWizardInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
  timezone: string;
  dbHost: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

export type ItflowWizardResult = 'completed' | 'already-setup' | 'failed';

/**
 * Whether the database step has produced a working `config.php`. GET
 * `setup/?database`: with `config.php` present the page says "already
 * configured" (and offers `?user`); without it, it re-renders the
 * `add_database` form. This is the check §348/§349 were missing — proof the
 * schema import ran, not just that a later form rendered.
 */
async function databaseStepDone(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/setup/?database`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    const body = await response.text();
    return body.includes('already configured') && !body.includes('name="add_database"');
  } catch {
    return false;
  }
}

/**
 * Run the wizard POSTs in order. Each ITFlow handler no-ops on a second run
 * (`add_database` redirects to `?user` once `config.php` exists; the rest
 * check their own DB rows), so a partially-completed wizard is carried
 * forward, not duplicated. Returns 'completed' once the telemetry POST has
 * redirected and `setup/` reports `already-setup`.
 */
export async function runSetupWizard(baseUrl: string, input: ItflowWizardInput): Promise<ItflowWizardResult> {
  try {
    // 1. Database — writes config.php and imports db.sql. Redirects to ?user
    //    on success (or if config.php already exists); a 200 body means the
    //    connection test failed.
    const db = await postForm(baseUrl, {
      add_database: '1',
      host: input.dbHost,
      database: input.dbName,
      username: input.dbUser,
      password: input.dbPassword,
    });
    if (!isRedirect(db)) {
      return 'failed';
    }
    if (!(await databaseStepDone(baseUrl))) {
      return 'failed';
    }

    // 2. Admin user (role 3). No-ops (redirects ?company) if users exist.
    await postForm(baseUrl, { add_user: '1', name: input.name, email: input.email, password: input.password });
    // 3. Company. All fields blank bar the name; no-ops if a company row exists.
    await postForm(baseUrl, {
      add_company_settings: '1',
      name: input.companyName,
      country: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      phone: '',
      email: '',
      website: '',
      tax_id: '',
    });
    // 4. Localization. Defaults; no-ops if already done.
    await postForm(baseUrl, {
      add_localization_settings: '1',
      locale: 'en_US',
      currency_code: 'USD',
      timezone: input.timezone,
    });
    // 5. Telemetry — no share_data, so no phone-home. Writes
    //    $config_enable_setup = 0 and redirects to /login.php.
    const final = await postForm(baseUrl, { add_telemetry: '1' });
    if (!isRedirect(final)) {
      return 'failed';
    }
    return (await getSetupState(baseUrl)) === 'already-setup' ? 'completed' : 'failed';
  } catch {
    return 'failed';
  }
}

export type ItflowSignInResult = { state: 'signed-in'; cookie: string } | { state: 'failed' };

/**
 * GET + POST `/login.php` (the unified agent/client form). A wrong
 * email/password, or the wizard's own MFA step, re-renders the form
 * (200) — `failed`, same as a network error. A correct one redirects
 * (opaque here) to `agent/<start page>` and Devise-style session
 * regeneration means the cookie to use afterwards is whatever the POST
 * response set, not the pre-login one. Only covers a plain password
 * login — an ITFlow admin with MFA turned on in their own profile can't
 * be driven this way (see itflowAdminBootstrap.ts's own note on enabling
 * 2FA after the fact).
 */
export async function signIn(baseUrl: string, email: string, password: string): Promise<ItflowSignInResult> {
  let formResponse: Response;
  try {
    formResponse = await fetch(`${baseUrl}/login.php`, { headers: PROXY_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { state: 'failed' };
  }
  if (formResponse.status !== 200) return { state: 'failed' };
  const formCookie = cookieHeader(readSetCookies(formResponse.headers));
  if (!formCookie) return { state: 'failed' };

  const body = new URLSearchParams({ email, password, login: '1' });
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/login.php`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...PROXY_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: formCookie },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { state: 'failed' };
  }
  if (!isRedirect(response)) return { state: 'failed' };
  const postLoginCookies = readSetCookies(response.headers);
  return { state: 'signed-in', cookie: postLoginCookies.length ? cookieHeader(postLoginCookies) : formCookie };
}

/**
 * GET `path` for a session-bound `csrf_token`, refreshing the cookie the
 * same way docusealClient.ts's form drivers do. Every modal page's real
 * HTML body is wrapped as `{"content": "..."}` by `includes/modal_footer.php`
 * (unconditionally — not just for actual AJAX callers), so the token has to
 * be pulled out of the decoded `content` string, not the raw JSON text.
 */
async function fetchCsrfToken(baseUrl: string, cookie: string, path: string): Promise<{ token: string; cookie: string } | null> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { headers: { ...PROXY_HEADERS, Cookie: cookie }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (response.status !== 200) return null;
  let html: string;
  try {
    const parsed = JSON.parse(await response.text()) as { content?: unknown };
    if (typeof parsed.content !== 'string') return null;
    html = parsed.content;
  } catch {
    return null;
  }
  const token = extractCsrfToken(html);
  if (!token) return null;
  const refreshed = readSetCookies(response.headers);
  return { token, cookie: refreshed.length ? cookieHeader(refreshed) : cookie };
}

export interface ItflowAddUserInput {
  cookie: string;
  name: string;
  email: string;
  password: string;
  roleId: number;
}

export type ItflowAddUserResult = 'created' | 'failed';

/**
 * POST `admin/post.php` (`add_user`), signed in as an existing admin —
 * `admin/post/users.php`'s own handler, driven through the real session so
 * ITFlow's `encryptUserSpecificKey()` can read the live
 * `$_SESSION`/`$_COOKIE` values it needs to wrap the site's credential-
 * encryption master key for the new user (the same session-only capability
 * itflowAdminBootstrap.ts's `reconcileAdminPassword` found no cold-script
 * equivalent for). ITFlow's own `users` table has no unique constraint on
 * `user_email` and `add_user` never checks for a duplicate — re-running
 * this for the same address creates a second row, so callers must look up
 * an existing account themselves first and call `updateUserPassword`
 * instead.
 */
export async function addUser(baseUrl: string, input: ItflowAddUserInput): Promise<ItflowAddUserResult> {
  const csrf = await fetchCsrfToken(baseUrl, input.cookie, '/admin/modals/user/user_add.php');
  if (!csrf) return 'failed';

  const body = new URLSearchParams({
    csrf_token: csrf.token,
    add_user: '1',
    name: input.name,
    email: input.email,
    password: input.password,
    role: String(input.roleId),
  });
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/admin/post.php`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...PROXY_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }
  return isRedirect(response) ? 'created' : 'failed';
}

export interface ItflowUpdateUserPasswordInput {
  cookie: string;
  userId: number;
  name: string;
  email: string;
  roleId: number;
  newPassword: string;
}

export type ItflowUpdatePasswordResult = 'updated' | 'failed';

/**
 * POST `admin/post.php` (`edit_user`) for an already-existing user id.
 * Same session requirement as `addUser` — `edit_user`'s password branch
 * calls the same `encryptUserSpecificKey()`. `name`/`email`/`role` are
 * resubmitted because the handler's `UPDATE` sets them unconditionally
 * alongside the password.
 */
export async function updateUserPassword(baseUrl: string, input: ItflowUpdateUserPasswordInput): Promise<ItflowUpdatePasswordResult> {
  const csrf = await fetchCsrfToken(baseUrl, input.cookie, `/admin/modals/user/user_edit.php?id=${input.userId}`);
  if (!csrf) return 'failed';

  const body = new URLSearchParams({
    csrf_token: csrf.token,
    edit_user: '1',
    user_id: String(input.userId),
    name: input.name,
    email: input.email,
    role: String(input.roleId),
    new_password: input.newPassword,
  });
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/admin/post.php`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...PROXY_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }
  return isRedirect(response) ? 'updated' : 'failed';
}
