/**
 * ITFlow setup-wizard client — only what itflowAdminBootstrap.ts needs.
 *
 * ITFlow has no OIDC (Authelia is OIDC-only), no env-var admin seed, and its
 * client portal has to be public — so it's exposed directly with its own
 * login, and the dashboard runs its first-run wizard so there's no manual
 * step and no first-visitor-claims-admin race (§344/§346).
 *
 * The wizard is `setup/index.php` — four `application/x-www-form-urlencoded`
 * POSTs (add_user / add_company_settings / add_localization_settings /
 * add_telemetry), **no CSRF token, no session cookie needed** (each handler
 * guards itself against a second run via a DB check).
 *
 * §346 first attempt stranded a fresh ITFlow: the `itfloworg` image runs its
 * source download + DB migration on first boot with no ready signal, so a
 * bare `200 /setup/` was treated as "ready", the POSTs hit missing tables
 * (suppressed mysqli errors still redirect), and the telemetry step locked
 * setup (`$config_enable_setup = 0`) with no schema. The readiness gate here
 * is content-based: `GET /setup/?user` renders the `add_user` FORM only when
 * `$install_is_live` is false — which the source computes from
 * `SELECT COUNT(*) FROM users` and **fails closed** (treats a missing table
 * as "live"). So the form's presence means: schema up, no users. And each
 * step is verified before the next — the telemetry POST never runs unless the
 * user was actually created.
 */

const REQUEST_TIMEOUT_MS = 15_000;

/** setup/index.php renders this form field only when it's genuinely at the user step. */
const USER_FORM_MARKER = 'name="add_user"';

async function postForm(baseUrl: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/setup/index.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function isRedirect(r: Response): boolean {
  return r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400);
}

/** GET setup/?user and report whether the add_user form is on the page. */
async function userStepFormPresent(baseUrl: string): Promise<boolean | null> {
  let r: Response;
  try {
    r = await fetch(`${baseUrl}/setup/?user`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (r.status !== 200) {
    return null;
  }
  let html = '';
  try {
    html = await r.text();
  } catch {
    return null;
  }
  return html.includes(USER_FORM_MARKER);
}

export type ItflowSetupState = 'needs-setup' | 'already-setup' | 'not-ready' | 'unreachable';

/**
 * `already-setup`  — `GET /setup/` redirects (setup finished / locked).
 * `needs-setup`    — the schema is up, no users, `?user` offers the add_user form.
 * `not-ready`      — reachable but the wizard isn't at the user step yet
 *                    (first boot still downloading source / migrating). Keep polling.
 * `unreachable`    — no useful response.
 */
export async function getSetupState(baseUrl: string): Promise<ItflowSetupState> {
  let root: Response;
  try {
    root = await fetch(`${baseUrl}/setup/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return 'unreachable';
  }
  if (isRedirect(root)) {
    return 'already-setup';
  }
  if (root.status !== 200) {
    return 'unreachable';
  }
  const formPresent = await userStepFormPresent(baseUrl);
  if (formPresent === null) {
    return 'unreachable';
  }
  return formPresent ? 'needs-setup' : 'not-ready';
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
 * Run the wizard, verifying as it goes. `add_user` first, then re-check the
 * `?user` page — if the form is gone, the user exists and it's safe to
 * continue; if it's still there, the POST failed and we bail **without
 * running the telemetry step** (that's what locked a broken setup in §346).
 * Company + localization are best-effort (each ITFlow handler no-ops on a
 * re-run). Success is `GET /setup/` finally redirecting to `/login.php`.
 */
export async function runSetupWizard(baseUrl: string, input: ItflowWizardInput): Promise<ItflowWizardResult> {
  try {
    await postForm(baseUrl, { add_user: '1', name: input.name, email: input.email, password: input.password });

    // Verify the user was actually created before touching anything else.
    const stillNeedsUser = await userStepFormPresent(baseUrl);
    if (stillNeedsUser !== false) {
      return 'failed';
    }

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
    await postForm(baseUrl, {
      add_localization_settings: '1',
      locale: 'en_US',
      currency_code: 'USD',
      timezone: input.timezone,
    });
    // Telemetry — no share_data, so no phone-home. Writes
    // $config_enable_setup = 0 and redirects to /login.php.
    await postForm(baseUrl, { add_telemetry: '1' });

    // Final proof: /setup/ now redirects away.
    let check: Response;
    try {
      check = await fetch(`${baseUrl}/setup/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return 'failed';
    }
    return isRedirect(check) ? 'completed' : 'failed';
  } catch {
    return 'failed';
  }
}
