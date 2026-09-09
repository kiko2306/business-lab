/**
 * ITFlow setup-wizard client — only what itflowAdminBootstrap.ts needs.
 *
 * ITFlow has no OIDC (Authelia is OIDC-only), no env-var admin seed, and its
 * client portal has to be public — so it's exposed directly with its own
 * login, and the dashboard runs its first-run wizard so there's no manual
 * step and no first-visitor-claims-admin race (§344).
 *
 * The wizard is `setup/index.php` — four sequential `application/x-www-form-
 * urlencoded` POSTs, **no CSRF token, no session cookie needed** (each handler
 * guards itself against a second run by checking the DB). The itfloworg image
 * writes `config.php` from `ITFLOW_DB_*` on first boot, so the database step
 * is already done and the wizard resumes at the user step. The final
 * (telemetry) POST appends `$config_enable_setup = 0` to config.php, after
 * which `setup/` 302s to `/login.php` — the idempotent "already done" signal.
 * Source: itflow-org/itflow `setup/index.php` (handlers add_user /
 * add_company_settings / add_localization_settings / add_telemetry).
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
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
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
}

export type ItflowWizardResult = 'completed' | 'already-setup' | 'failed';

/**
 * Run the four wizard POSTs in order. Each ITFlow handler no-ops on a second
 * run, so a partially-completed wizard (e.g. the user exists but the company
 * step didn't finish) is carried forward rather than duplicated. Returns
 * 'completed' once the telemetry POST redirects to /login.php.
 */
export async function runSetupWizard(baseUrl: string, input: ItflowWizardInput): Promise<ItflowWizardResult> {
  try {
    // 1. Admin user (role 3). No-ops (redirects ?company) if users exist.
    await postForm(baseUrl, { add_user: '1', name: input.name, email: input.email, password: input.password });
    // 2. Company. All fields blank bar the name; no-ops if a company row exists.
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
    // 3. Localization. Defaults; no-ops if already done.
    await postForm(baseUrl, {
      add_localization_settings: '1',
      locale: 'en_US',
      currency_code: 'USD',
      timezone: input.timezone,
    });
    // 4. Telemetry — no share_data, so no phone-home. Writes
    // $config_enable_setup = 0 and redirects to /login.php.
    const final = await postForm(baseUrl, { add_telemetry: '1' });
    if (final.type === 'opaqueredirect' || (final.status >= 300 && final.status < 400)) {
      return 'completed';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}
