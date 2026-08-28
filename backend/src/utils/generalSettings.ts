import { query } from './database';

export const TIMEZONE_SETTING_KEY = 'app_timezone';

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
