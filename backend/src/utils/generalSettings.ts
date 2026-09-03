import { query } from './database';
import { getExposureConfig } from './exposureSettings';

export const TIMEZONE_SETTING_KEY = 'app_timezone';
export const DASHBOARD_URL_SETTING_KEY = 'dashboard_url';

// Applied to every managed app that reads ${TZ} unless that app's own .env
// pins a different value. Changeable from Settings in the dashboard.
export const DEFAULT_TIMEZONE = 'Europe/Lisbon';

/** True for an IANA zone name Node recognises (e.g. "Europe/Lisbon", "UTC"). */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) {
    return false;
  }
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getAppTimezone(): Promise<string> {
  try {
    const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [TIMEZONE_SETTING_KEY]);
    const stored = result.rows[0]?.value;
    return stored && isValidTimezone(stored) ? stored : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export async function setAppTimezone(tz: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [TIMEZONE_SETTING_KEY, tz]
  );
}

/** A syntactically valid absolute http(s) URL with no path/query. */
export function isValidDashboardUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && (url.pathname === '/' || url.pathname === '');
  } catch {
    return false;
  }
}

/** The operator-set dashboard URL, or '' if unset. */
export async function getStoredDashboardUrl(): Promise<string> {
  try {
    const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [
      DASHBOARD_URL_SETTING_KEY,
    ]);
    return result.rows[0]?.value?.trim() ?? '';
  } catch {
    return '';
  }
}

export async function setDashboardUrl(url: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [DASHBOARD_URL_SETTING_KEY, url.trim().replace(/\/+$/, '')]
  );
}

/**
 * Base URL for links the dashboard emails (invite / set-password, plan.md
 * §158): the operator-set value if present, otherwise a `dashboard.<domain>`
 * guess from the exposure base domain, otherwise null — the caller refuses to
 * send a link it can't build.
 */
export async function getDashboardBaseUrl(): Promise<string | null> {
  const stored = await getStoredDashboardUrl();
  if (stored) {
    return stored.replace(/\/+$/, '');
  }
  const exposure = await getExposureConfig();
  if (exposure?.baseDomain) {
    return `https://dashboard.${exposure.baseDomain}`;
  }
  return null;
}
