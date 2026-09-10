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
