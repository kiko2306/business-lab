import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The single source of truth for the version shown in the dashboard footer.
 * Read from package.json — which the Docker build copies into the runtime
 * image — so cutting a release is one edit to that file, and the value the
 * API reports is the one that was actually built and deployed (plan.md
 * §131.4). `__dirname` is `dist/` at runtime and `src/` under vitest; the
 * package.json sits one level up from both.
 */
function readAppVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Fall through to the placeholder — a missing/unreadable package.json
    // should not stop the API from booting.
  }
  return '0.0.0';
}

export const APP_VERSION = readAppVersion();
